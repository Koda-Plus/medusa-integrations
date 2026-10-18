import { AbstractPaymentProvider } from "@medusajs/framework/utils"
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
import { PROVIDER_IDENTIFIER } from "../../modules/inpostpay/lib/constants"
import { resolveOptions, type InpostPayPluginOptions, type ResolvedInpostPayOptions } from "../../modules/inpostpay/lib/options"
import { proofSecret, proofValid } from "../../modules/inpostpay/lib/proof"

type Cradle = Record<string, unknown>

function optional<T>(cradle: Cradle, key: string): T | null {
  try {
    return (cradle[key] as T | undefined) ?? null
  } catch {
    return null
  }
}

const minor = (amount: unknown): number => {
  const n = typeof amount === "number" ? amount : typeof amount === "string" ? Number(amount) : Number((amount as { numeric?: unknown } | null)?.numeric ?? NaN)
  return Number.isFinite(n) ? Math.round(Number((n * 100).toFixed(4))) : NaN
}

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
 *                 authorized session to turn the cart into an order. The
 *                 money state is InPost's payment status, which the plugin
 *                 keeps on the basket (AUTHORIZED, DECLINED, COD...) and
 *                 shows on the order. Capture in Medusa when InPost reports
 *                 AUTHORIZED (or when the courier collected cash on delivery).
 *   capture, cancel, refund  recorded in the session data only: settlements
 *                 and refunds of InPost Pay go through InPost (merchant
 *                 portal or InPost's returns API), not through this provider.
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
    const refunds = Array.isArray(data.refunds) ? (data.refunds as unknown[]) : []
    if (data.demo !== true) this.logger_.info("[inpostpay] A refund was recorded in Medusa; return the money through InPost (merchant portal or InPost's returns API).")
    return { data: { ...data, refunds: [...refunds, { amount: String(input.amount), at: new Date().toISOString() }].slice(-20) } }
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
