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
import { OPTION_SPECS, PROVIDER_IDENTIFIER } from "../../modules/dpd/lib/constants"
import { resolveOptions, type DpdPluginOptions, type ResolvedDpdOptions } from "../../modules/dpd/lib/options"
import { fulfillmentOptions, methodDataFor, readFulfillmentData, specOf, validateMethodData, type CheckoutContext } from "../../modules/dpd/lib/option-data"

type Cradle = Record<string, unknown>

/** A dependency of the fulfillment module's container, or null (Awilix throws for unknown keys). */
function optional<T>(cradle: Cradle, key: string): T | null {
  try {
    return (cradle[key] as T | undefined) ?? null
  } catch {
    return null
  }
}

const RETURN_SPEC = OPTION_SPECS.find((s) => s.kind === "return")

/**
 * THE FULFILLMENT PROVIDER of DPD by Koda Plus, for Medusa's fulfillment
 * module (identifier "dpd"; registered as `{ id: "dpd" }` it is `dpd_dpd`,
 * and the plugin finds DPD fulfillments by /^dpd_/).
 *
 *   options    five: courier, Pickup point, both with cash on delivery
 *              (dpd-courier, dpd-courier-cod, dpd-pickup, dpd-pickup-cod)
 *              and the return option dpd-return (is_return)
 *   checkout   the country must be one of `countries`; a courier option needs
 *              a complete address; a Pickup option a point id and a phone or
 *              an e-mail of the recipient; cash on delivery a currency
 *              `codCountries` allows, at a Pickup point only in Poland
 *   fulfill    RECORDS the choice and NEVER calls DPD. DPDServices cannot
 *              cancel a shipment, so a parcel created here and then rolled
 *              back by Medusa would stay in DPD without a trace: the
 *              plugin's flows create it from a plan a person reads, only
 *              when the shipment writer is armed
 *   cancel     refused once the parcel was handed to the courier (the
 *              protocol set `dpd_handed_over_at`), so Medusa never puts back
 *              stock that left the warehouse
 *   return     records nothing and never throws: the provider lives in the
 *              fulfillment module and does not know the order; the plugin's
 *              return subscribers build the return from the order
 *
 * It never breaks the boot and never throws while fulfilling: a fulfillment
 * must work even when DPD is down, the credentials are missing or the
 * writer is off. Prices are the shipping options' own (flat rate).
 */
class DpdFulfillmentProvider extends AbstractFulfillmentProviderService {
  static identifier = PROVIDER_IDENTIFIER

  /** Called by Medusa at boot. Never throws: problems are logged by the module and listed in the admin. */
  static validateOptions(_options: Record<string, unknown>): void {
    /* options are checked leniently in resolveOptions */
  }

  protected readonly options_: ResolvedDpdOptions
  protected readonly logger_: Pick<Logger, "info" | "warn" | "error">

  constructor(cradle: Cradle, options: DpdPluginOptions) {
    super()
    this.options_ = resolveOptions(options)
    this.logger_ = optional<Logger>(cradle, "logger") ?? console
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return fulfillmentOptions()
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

  /** The checks at checkout. Whether a Pickup point exists is checked from stage 3 on (MyPudoAPI, failing open). */
  async validateFulfillmentData(optionData: Record<string, unknown>, data: Record<string, unknown>, context: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = validateMethodData(optionData, data, context as CheckoutContext, this.options_)
    if (!result.ok) throw new MedusaError(MedusaError.Types.INVALID_DATA, result.error.message)
    return result.data
  }

  /**
   * Records the choice on the fulfillment. No request to DPD: the plugin
   * records its row (subscriber of order.fulfillment_created) and creates
   * the shipment from its plan. The data of a claim, an exchange, an order
   * edit or a draft order is the shipping option's own (`id`, `kind`,
   * `cod`, never checked by validateFulfillmentData): it gets the same
   * `dpd_*` keys. Data without a DPD option is kept as it came.
   */
  async createFulfillment(
    data: Record<string, unknown>,
    _items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    _order: Partial<FulfillmentOrderDTO> | undefined,
    _fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>,
  ): Promise<CreateFulfillmentResult> {
    const read = readFulfillmentData(data)
    if (!read) {
      this.logger_.warn("[dpd] A fulfillment without a DPD option in its data: recorded as it came.")
      return { data: { ...(data ?? {}) }, labels: [] }
    }
    return {
      data: {
        ...(data ?? {}),
        ...methodDataFor(read.spec, { pudoId: read.pudoId, country: read.country }),
        dpd_recorded_at: new Date().toISOString(),
      },
      labels: [],
    }
  }

  /**
   * Nothing to undo in DPD before the handover (DPDServices has no cancel;
   * the plugin follows order.fulfillment_canceled and keeps the shipment out
   * of protocols). After the handover the parcel is on its way: refused.
   */
  async cancelFulfillment(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const handedOver = data?.dpd_handed_over_at
    if (handedOver !== undefined && handedOver !== null && handedOver !== "") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "This DPD shipment was handed to the courier and cannot be canceled in Medusa. Contact DPD to stop it, or create a return.",
      )
    }
    return {}
  }

  /**
   * A return on the DPD return option. Writes nothing (the fulfillment
   * module does not give the provider the order) and never throws, because
   * an error here would abort the return in Medusa. The plugin creates the
   * return row from order.return_requested and the label from its plan.
   */
  async createReturnFulfillment(fulfillment: Record<string, unknown>): Promise<CreateFulfillmentResult> {
    const own = fulfillment?.data && typeof fulfillment.data === "object" && !Array.isArray(fulfillment.data) ? (fulfillment.data as Record<string, unknown>) : {}
    return {
      data: {
        ...own,
        ...(RETURN_SPEC ? methodDataFor(RETURN_SPEC) : {}),
        dpd_recorded_at: new Date().toISOString(),
      },
      labels: [],
    }
  }

  /**
   * The documents of a fulfillment. Stage 1 creates no labels, so there are
   * none. (The abstract class types the answer as never[].)
   */
  async getFulfillmentDocuments(_data: Record<string, unknown>): Promise<never[]> {
    return []
  }
}

export default DpdFulfillmentProvider
