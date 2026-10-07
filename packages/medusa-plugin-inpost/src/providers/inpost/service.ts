import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils"
import type {
  CalculatedShippingOptionPrice,
  CreateFulfillmentResult,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
  Logger,
} from "@medusajs/framework/types"
import { createShipxClient, type ShipxClient } from "../../modules/inpost/lib/client"
import { PROVIDER_IDENTIFIER } from "../../modules/inpost/lib/constants"
import { DEMO_LOCKERS } from "../../modules/inpost/lib/demo"
import { describeError } from "../../modules/inpost/lib/errors"
import { firstMinor, formatMinor } from "../../modules/inpost/lib/money"
import { canCallShipx, resolveOptions, type InpostPluginOptions, type ResolvedInpostOptions } from "../../modules/inpost/lib/options"
import { fulfillmentOptions, readFulfillmentData, specOf, validateMethodData, methodDataFor, type CheckoutContext } from "../../modules/inpost/lib/option-data"
import { labelFileName, simpleLabelPdf } from "../../modules/inpost/lib/pdf"
import { fetchPoints, pointsParams, TtlCache } from "../../modules/inpost/lib/points"
import { maskSecrets } from "../../modules/inpost/lib/security"

type Cradle = Record<string, unknown>

/** A dependency of the fulfillment module's container, or null (Awilix throws for unknown keys). */
function optional<T>(cradle: Cradle, key: string): T | null {
  try {
    return (cradle[key] as T | undefined) ?? null
  } catch {
    return null
  }
}

/** Locker checks at checkout, per process: an existing locker is remembered for an hour, a missing one for ten minutes. */
const EXISTING_LOCKERS = new TtlCache<true>(60 * 60 * 1000, 2000)
const MISSING_LOCKERS = new TtlCache<true>(10 * 60 * 1000, 2000)

/**
 * THE FULFILLMENT PROVIDER of InPost by Koda Plus, for Medusa's fulfillment
 * module (identifier "inpost"; registered as `{ id: "inpost" }` it is
 * `inpost_inpost`, the id earlier InPost providers of Koda Plus used, so
 * existing shipping options keep working).
 *
 *   options    four: Paczkomat, courier, and both with cash on delivery
 *              (ids inpost-paczkomat, inpost-kurier, inpost-paczkomat-cod,
 *              inpost-kurier-cod)
 *   checkout   a locker option needs a locker code of the right shape (and,
 *              with `verifyLockers`, a locker that exists); a courier option
 *              a full Polish address; cash on delivery a cart in PLN
 *   fulfill    RECORDS the choice (option, service, locker, the cash on
 *              delivery amount from the order total) and NEVER calls ShipX:
 *              the plugin's flows create the shipment from a plan a person
 *              reads, only when the shipment writer is armed
 *
 * It never breaks the boot and never throws while fulfilling: a fulfillment
 * must work even when InPost is down, the token is missing or the writer is
 * off. Prices are the shipping options' own (flat rate).
 */
class InpostFulfillmentProvider extends AbstractFulfillmentProviderService {
  static identifier = PROVIDER_IDENTIFIER

  /** Called by Medusa at boot. Never throws: problems are logged by the module and listed in the admin. */
  static validateOptions(_options: Record<string, unknown>): void {
    /* options are checked leniently in resolveOptions */
  }

  protected readonly options_: ResolvedInpostOptions
  protected readonly logger_: Pick<Logger, "info" | "warn" | "error">
  protected client_: ShipxClient | null = null

  constructor(cradle: Cradle, options: InpostPluginOptions) {
    super()
    this.options_ = resolveOptions(options)
    this.logger_ = optional<Logger>(cradle, "logger") ?? console
  }

  private client(): ShipxClient {
    if (!this.client_) {
      const o = this.options_
      this.client_ = createShipxClient({ token: o.apiToken, organizationId: o.organizationId, sandbox: o.sandbox, timeoutMs: o.timeoutMs, requestsPerMinute: o.requestsPerMinute })
    }
    return this.client_
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return fulfillmentOptions() as unknown as FulfillmentOption[]
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return specOf(data) !== null
  }

  async canCalculate(): Promise<boolean> {
    return false
  }

  async calculatePrice(): Promise<CalculatedShippingOptionPrice> {
    return { calculated_amount: 0, is_calculated_price_tax_inclusive: true }
  }

  /** Does the locker exist? Demo: the demo lockers and any well formed code. Live: the public points API, failing open. */
  private async lockerExists(code: string): Promise<boolean> {
    if (this.options_.demo) return true
    if (EXISTING_LOCKERS.get(code)) return true
    if (MISSING_LOCKERS.get(code)) return false
    try {
      const q = pointsParams({ q: code, limit: 1 })
      if ("error" in q) return true
      const points = await fetchPoints(q.params, { sandbox: this.options_.sandbox, timeoutMs: 3000 })
      const exists = points.some((p) => p.code === code)
      ;(exists ? EXISTING_LOCKERS : MISSING_LOCKERS).set(code, true)
      return exists
    } catch (err) {
      this.logger_.warn(`[inpost] Locker check of ${code} skipped (the points API did not answer): ${(err as Error)?.message ?? String(err)}`)
      return true
    }
  }

  async validateFulfillmentData(optionData: Record<string, unknown>, data: Record<string, unknown>, context: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = validateMethodData(optionData, data, context as CheckoutContext)
    if (!result.ok) throw new MedusaError(MedusaError.Types.INVALID_DATA, result.error.message)
    if (result.locker && this.options_.verifyLockers && !(await this.lockerExists(result.locker.code))) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `InPost has no parcel locker ${result.locker.code}. Choose the locker on the map again.`)
    }
    return result.data
  }

  /**
   * Records the choice on the fulfillment. No request to InPost: the plugin
   * records the row (subscriber of order.fulfillment_created) and creates
   * the shipment from its plan when the shipment writer is armed.
   */
  async createFulfillment(
    data: Record<string, unknown>,
    _items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    _fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>,
  ): Promise<CreateFulfillmentResult> {
    const read = readFulfillmentData(data)
    if (!read) {
      this.logger_.warn("[inpost] A fulfillment without an InPost option in its data: recorded as it came.")
      return { data: { ...(data ?? {}) }, labels: [] }
    }
    const method = methodDataFor(read.spec, read.locker, read.size)
    let cod: string | null = null
    if (read.spec.cod) {
      const o = (order ?? {}) as Record<string, unknown>
      const currency = String(o.currency_code ?? "").toLowerCase()
      const minor = firstMinor((o.summary as Record<string, unknown> | undefined)?.current_order_total, o.raw_total, o.total)
      if ((!currency || currency === "pln") && minor !== null && minor > 0) cod = formatMinor(minor)
    }
    return {
      data: {
        ...(data ?? {}),
        ...method,
        inpost_cod_amount: cod,
        inpost_recorded_at: new Date().toISOString(),
      },
      labels: [],
    }
  }

  /** Nothing to undo in InPost: the plugin follows the cancel (order.fulfillment_canceled) and offers to cancel a sent shipment. */
  async cancelFulfillment(_data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {}
  }

  /**
   * Returns go through InPost Manager or the InPost returns service. Refused
   * here with a clear error, so a return option on this provider never looks
   * like a return that was sent.
   */
  async createReturnFulfillment(_fulfillment: Record<string, unknown>): Promise<CreateFulfillmentResult> {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "InPost returns are not supported by this provider yet: use InPost Manager or the InPost returns service.")
  }

  /**
   * The documents a fulfillment has: the label, once the plugin wrote the
   * shipment id into the fulfillment data. (The abstract class types the
   * answer as never[] although IFulfillmentProvider allows any; the cast
   * keeps the documented shape.)
   */
  async getFulfillmentDocuments(data: Record<string, unknown>): Promise<never[]> {
    const shipmentId = typeof data?.inpost_shipment_id === "string" ? data.inpost_shipment_id : null
    const docs: Array<Record<string, unknown>> = shipmentId ? [{ type: "label", shipment_id: shipmentId, formats: ["A6", "A4"] }] : []
    return docs as never[]
  }

  /**
   * The label as a document, for custom code (Medusa itself does not call
   * this): `{ type, filename, content_type, base64 }`, or null. Live: fetched
   * from ShipX with the provider's token. Demo: a generated PDF. (The
   * abstract class types the answer as void; see getFulfillmentDocuments.)
   */
  async retrieveDocuments(fulfillmentData: Record<string, unknown>, documentType: string): Promise<void> {
    return (await this.labelDocument(fulfillmentData, documentType)) as unknown as void
  }

  private async labelDocument(fulfillmentData: Record<string, unknown>, documentType: string): Promise<Record<string, unknown> | null> {
    if (documentType !== "label") return null
    const shipmentId = typeof fulfillmentData?.inpost_shipment_id === "string" ? fulfillmentData.inpost_shipment_id : null
    if (!shipmentId) return null
    const filename = labelFileName(null, shipmentId)
    if (this.options_.demo) {
      const locker = DEMO_LOCKERS[0]
      const pdf = simpleLabelPdf([{ text: "InPost", size: 20, bold: true }, { text: "SIMULATED LABEL, NOT VALID FOR SHIPPING", size: 9, bold: true }, { text: `Shipment ${shipmentId}` }, { text: `Paczkomat ${locker.code}` }], this.options_.labelFormat)
      return { type: "label", filename, content_type: "application/pdf", base64: Buffer.from(pdf).toString("base64") }
    }
    if (!canCallShipx(this.options_)) return null
    const kind = readFulfillmentData(fulfillmentData)?.spec.kind ?? "locker"
    try {
      const file = await this.client().getLabel(shipmentId, this.options_.labelFormat === "A4" && kind === "locker" ? "normal" : "A6")
      return { type: "label", filename, content_type: file.contentType, base64: Buffer.from(file.data).toString("base64") }
    } catch (err) {
      const d = describeError(err)
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `[inpost] ${maskSecrets(d.message, [this.options_.apiToken])}`)
    }
  }
}

export default InpostFulfillmentProvider
