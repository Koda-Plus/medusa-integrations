import { AbstractPaymentProvider, MedusaError } from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { randomUUID } from "node:crypto"
import { createBasketAppClient, InpostPayApiError, type BasketAppClient } from "../../modules/inpostpay/lib/client"
import { PROVIDER_IDENTIFIER } from "../../modules/inpostpay/lib/constants"
import { refundMode, resolveOptions, type InpostPayPluginOptions, type ResolvedInpostPayOptions } from "../../modules/inpostpay/lib/options"
import { proofSecret, proofValid } from "../../modules/inpostpay/lib/proof"
import { pickTransaction, refundCommandId, refundWindowOpen, type InpostTransaction } from "../../modules/inpostpay/lib/refund"

type Cradle = Record<string, unknown>

function optional<T>(cradle: Cradle, key: string): T | null {
  try {
    return (cradle[key] as T | undefined) ?? null
  } catch {
    return null
  }
}

/** Minor units of a number, a string, a BigNumber (`numeric`) or a raw amount (`value`, what Medusa refunds with). */
const minor = (amount: unknown): number => {
  const o = amount as { numeric?: unknown; value?: unknown } | null
  const n = typeof amount === "number" ? amount : typeof amount === "string" ? Number(amount) : Number(o?.numeric ?? o?.value ?? NaN)
  return Number.isFinite(n) ? Math.round(Number((n * 100).toFixed(4))) : NaN
}

const day = (d: Date): string => d.toISOString().slice(0, 10)
const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** Pages of the transaction list read to find the paid transaction of an order. */
const TX_PAGES = 10
const TX_PER_PAGE = 100

/**
 * THE PAYMENT PROVIDER of InPost Pay by Koda Plus (identifier "inpost-pay";
 * registered with `id: "inpost-pay"` it is `pp_inpost-pay_inpost-pay`).
 *
 * The customer pays in the InPost app, never on the storefront, so this
 * provider has nothing to redirect to. It only takes sessions the plugin
 * created itself: the session data carries a proof (an HMAC of the basket,
 * the cart and the amount, see lib/proof.ts). A session a shopper creates
 * through the Store API has no valid proof and is never authorized.
 *
 *   demo          authorized at once; the data says `demo: true`
 *   sandbox/live  authorized when InPost hands the order over
 *                 (`POST /v1/izi/order`, a signed call): Medusa needs an
 *                 authorized session to turn the cart into an order, and
 *                 InPost creates the order before the customer pays. The
 *                 money state is InPost's payment status, which the plugin
 *                 keeps on the basket (AUTHORIZED, DECLINED, COD...) and
 *                 shows on the order. The plugin captures the payment
 *                 itself when InPost reports AUTHORIZED (`autoCapture`, on
 *                 by default).
 *   capture, cancel  recorded in the session data: InPost settles the money.
 *   refund        with `merchantSecret`: InPost Pay returns the money
 *                 (`POST /v1/izi/transaction/{id}/refund`, lib/refund.ts), and
 *                 a refund InPost refuses fails in Medusa too. Without it the
 *                 refund fails, unless `manualRefunds` says the store returns
 *                 the money in the merchant portal. Cash on delivery and the
 *                 demo are recorded only.
 *
 * It never breaks the boot: options are resolved leniently.
 */
class InpostPayPaymentProvider extends AbstractPaymentProvider<InpostPayPluginOptions> {
  static identifier = PROVIDER_IDENTIFIER

  static validateOptions(_options: Record<string, unknown>): void {
    /* lenient: resolveOptions never throws, the admin lists ignored values */
  }

  protected readonly options_: ResolvedInpostPayOptions
  protected readonly logger_: Pick<Logger, "info" | "warn" | "error">
  private client_: BasketAppClient | null = null

  constructor(cradle: Cradle, options: InpostPayPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [Cradle, InpostPayPluginOptions]))
    this.options_ = resolveOptions(options)
    this.logger_ = optional<Logger>(cradle, "logger") ?? console
  }

  /** Whether the data was written by this plugin, for this amount. */
  private trusted(data: Record<string, unknown> | undefined, amount?: unknown): boolean {
    if (!proofValid(proofSecret(this.options_), data)) return false
    if (amount !== undefined && Number.isFinite(minor(amount)) && Math.abs(minor(amount) - Number(data?.amount_minor)) > 1) return false
    return true
  }

  /** The Basket App client refunds go through (sandbox and live); tests replace it. */
  protected refundClient(): BasketAppClient {
    if (!this.client_) {
      const o = this.options_
      this.client_ = createBasketAppClient({
        mode: o.mode === "live" ? "live" : "sandbox",
        apiUrl: o.apiUrl,
        tokenUrl: o.tokenUrl,
        clientId: o.clientId,
        clientSecret: o.clientSecret,
        timeoutMs: o.timeoutMs,
        merchantSecret: o.merchantSecret,
      })
    }
    return this.client_
  }

  /** The clock; tests replace it. */
  protected now(): Date {
    return new Date()
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const data = (input.data ?? {}) as Record<string, unknown>
    const id = `ippay_${randomUUID().replace(/-/g, "")}`
    if (!this.trusted(data, input.amount)) {
      /* Kept as pending and never authorized: InPost Pay is paid in the app, not from the storefront. */
      return { id, status: "pending", data: { inpostpay: true, untrusted: true } }
    }
    return { id, status: "pending", data: { ...data, session_ref: id } }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = (input.data ?? {}) as Record<string, unknown>
    if (!this.trusted(data)) {
      this.logger_.warn("[inpostpay] A payment session without the plugin's proof was not authorized (InPost Pay is paid in the InPost app).")
      return { status: "error", data: { ...data, error: "not_created_by_inpost_pay" } }
    }
    return { status: "authorized", data: { ...data, authorized_at: new Date().toISOString() } }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: { ...(input.data ?? {}), captured_at: new Date().toISOString() } }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: { ...(input.data ?? {}), canceled_at: new Date().toISOString() } }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = (input.data ?? {}) as Record<string, unknown>
    const refunds = Array.isArray(data.refunds) ? (data.refunds as Array<Record<string, unknown>>) : []
    const amountMinor = minor(input.amount)
    const at = this.now().toISOString()
    const record = (entry: Record<string, unknown>, extra: Record<string, unknown> = {}): RefundPaymentOutput => ({
      data: { ...data, ...extra, refunds: [...refunds, { amount: (amountMinor / 100).toFixed(2), at, ...entry }].slice(-20) },
    })

    const mode = data.demo === true ? "demo" : refundMode(this.options_)
    if (mode === "demo") return record({ demo: true })
    if (data.inpost_payment_type === "CASH_ON_DELIVERY" || data.inpost_payment_status === "COD") {
      this.logger_.info("[inpostpay] A refund of a cash on delivery order was recorded in Medusa; InPost Pay holds none of that money, return it to the customer yourself.")
      return record({ cash_on_delivery: true })
    }
    if (mode === "manual") {
      this.logger_.info("[inpostpay] A refund was recorded in Medusa only (manualRefunds); return the money in merchant.inpost.pl.")
      return record({ manual: true })
    }
    if (mode === "off") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "InPost Pay refunds need the merchantSecret option (merchant.inpost.pl, API keys). Return the money in the merchant portal, or set manualRefunds: true to record such refunds in Medusa.",
      )
    }
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new MedusaError(MedusaError.Types.INVALID_DATA, "The refund amount is not a positive amount")
    if (!refundWindowOpen(this.now())) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "InPost Pay takes no refunds between 23:00 and 6:30 (Polish time). Try again after 6:30.")

    const client = this.refundClient()
    const transactionId = await this.transactionOf(client, data)
    const commandId = refundCommandId(str(data.basket_id), refunds.length, amountMinor)
    let status: string
    try {
      const result = await client.refund(transactionId, { commandId, body: { external_refund_id: commandId, refund_amount: amountMinor / 100 } })
      if (result.status === "FAILED") throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `InPost Pay refused the refund${result.description ? `: ${result.description}` : ""}`)
      status = result.status
    } catch (e) {
      if (e instanceof MedusaError) throw e
      if (e instanceof InpostPayApiError && (e.kind === "unavailable" || e.status >= 500)) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `InPost Pay gave no clear answer, the refund may have gone through: check merchant.inpost.pl. Repeating the same amount is safe, InPost does not refund one command twice (${e.message}).`,
        )
      }
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `InPost Pay refused the refund: ${(e as Error)?.message ?? e}`)
    }
    return record({ inpost: true, status, command_id: commandId }, { transaction_id: transactionId })
  }

  /**
   * The InPost transaction of this payment: the one saved by an earlier
   * refund, the payment reference of InPost's event, or the paid
   * transaction of the order in the store's transaction list.
   */
  private async transactionOf(client: BasketAppClient, data: Record<string, unknown>): Promise<string> {
    if (str(data.transaction_id)) return str(data.transaction_id)
    const orderId = str(data.order_id)
    if (!orderId) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This payment does not carry its Medusa order id, so its InPost transaction cannot be found. Return the money in merchant.inpost.pl.")
    }
    const fail = (reason: "none" | "refunded" | "ambiguous" | "incomplete"): never => {
      const why = {
        none: "InPost lists no paid transaction of this order",
        refunded: "InPost already refunded this order in full",
        ambiguous: "InPost lists more than one paid transaction of this order",
        incomplete: "the store has too many recent transactions to check them all",
      }[reason]
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `The refund did not go to InPost Pay: ${why}. Check merchant.inpost.pl.`)
    }
    if (str(data.payment_reference)) {
      const byRef = pickTransaction((await client.transactions({ transaction_id: str(data.payment_reference) })).items, orderId)
      if (byRef.ok) return byRef.transaction.transaction_id
    }
    const since = new Date(Date.parse(str(data.authorized_at)) || this.now().getTime())
    since.setUTCDate(since.getUTCDate() - 1)
    const items: InpostTransaction[] = []
    for (let page = 0; page < TX_PAGES; page++) {
      const r = await client.transactions({ date_from: day(since), date_to: day(this.now()), page, per_page: TX_PER_PAGE })
      items.push(...r.items)
      const pick = pickTransaction(items, orderId)
      if (pick.ok) return pick.transaction.transaction_id
      if (r.items.length < TX_PER_PAGE || (r.count !== null && items.length >= r.count)) return fail(pick.reason)
    }
    return fail("incomplete")
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const data = (input.data ?? {}) as Record<string, unknown>
    /* A changed amount invalidates the proof: the session goes back to pending and is never authorized. */
    const ok = this.trusted(data, input.amount)
    return { status: "pending", data: ok ? data : { ...data, proof: null } }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = (input.data ?? {}) as Record<string, unknown>
    if (data.canceled_at) return { status: "canceled", data }
    if (data.captured_at) return { status: "captured", data }
    if (data.authorized_at && this.trusted(data)) return { status: "authorized", data }
    return { status: "pending", data }
  }

  async getWebhookActionAndData(_payload: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    /* InPost reports through the Merchant API (/inpostpay/v1/izi/order/{id}/event), not through /hooks/payment. */
    return { action: "not_supported" }
  }
}

export default InpostPayPaymentProvider
