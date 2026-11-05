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
import { OPTION_SPECS, POINTS_COUNTRY, PROVIDER_IDENTIFIER } from "../../modules/dpd/lib/constants"
import { resolveOptions, type DpdPluginOptions, type ResolvedDpdOptions } from "../../modules/dpd/lib/options"
import {
  checkoutError,
  fulfillmentOptions,
  methodDataFor,
  pudoSnapshotOf,
  readFulfillmentData,
  specOf,
  validateMethodData,
  type CheckoutContext,
  type CheckoutErrorCode,
} from "../../modules/dpd/lib/option-data"
import { createPointsSource, pointProblems, type PointCheck, type PointsSource } from "../../modules/dpd/lib/points"
import { POINTS_KEY } from "../../workflows/dpd/runtime"

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

/** The point problems the checkout has a sentence for (MESSAGES of option-data.ts). */
const POINT_CHECKOUT_CODES: readonly CheckoutErrorCode[] = ["pudo_not_found", "pudo_inactive", "pudo_no_delivery", "pudo_no_cod"]

function pointCheckoutCode(code: string): CheckoutErrorCode | null {
  return POINT_CHECKOUT_CODES.find((c) => c === code) ?? null
}

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
 *              `codCountries` allows, at a Pickup point only in Poland. The
 *              Pickup point is then checked with the points source of the
 *              mode: a point that is not there, not active, not handing out
 *              parcels (or without cash on delivery for a COD option) or
 *              outside Poland is refused, a checked point gets its public
 *              snapshot (dpd_pudo); a point that cannot be checked now is
 *              accepted without one (FAIL OPEN, logged). Demo mode accepts a
 *              point id outside its sample catalog without a check
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
  /** The points source of the mode. The provider lives in the fulfillment module's container and never resolves the dpd module: it builds its own from the same options. */
  protected readonly points_: PointsSource

  constructor(cradle: Cradle, options: DpdPluginOptions) {
    super()
    this.options_ = resolveOptions(options)
    this.logger_ = optional<Logger>(cradle, "logger") ?? console
    this.points_ = optional<PointsSource>(cradle, POINTS_KEY) ?? createPointsSource(this.options_, { logger: this.logger_ })
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

  /**
   * The checks at checkout: the format (validateMethodData), then the Pickup
   * point as the points source has it now. Only a positive answer refuses a
   * point (found with a problem, or not found); a point that could not be
   * checked is accepted without a snapshot (fail open). A snapshot the
   * client sent is never kept: validateMethodData answers the keys of
   * methodDataFor only.
   */
  async validateFulfillmentData(optionData: Record<string, unknown>, data: Record<string, unknown>, context: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = validateMethodData(optionData, data, context as CheckoutContext, this.options_)
    if (!result.ok) throw new MedusaError(MedusaError.Types.INVALID_DATA, result.error.message)
    const pudoId = result.data.dpd_pudo_id
    if (result.spec.kind !== "pickup" || !pudoId) return result.data
    const refuse = (code: CheckoutErrorCode): never => {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, checkoutError(code).message)
    }
    /* Stage 3 ships to Poland only (E21): a point that was not read (not in the demo catalog, or unchecked) is refused abroad by the prefix of its id. */
    const refuseAbroad = (): void => {
      if (pudoId.slice(0, 2) !== POINTS_COUNTRY) refuse(result.spec.cod ? "cod_pickup_abroad" : "pickup_abroad_later")
    }
    const check = await this.pointCheck(pudoId)

    if (check.status === "ok") {
      const first = pointProblems(check, { cod: result.spec.cod })
        .map((p) => pointCheckoutCode(p.code))
        .find((c): c is CheckoutErrorCode => c !== null)
      if (first) refuse(first)
      const country = check.point.address.country
      if (country !== POINTS_COUNTRY) refuse(result.spec.cod ? "cod_pickup_abroad" : "pickup_abroad_later")
      return { ...result.data, dpd_country: country, dpd_pudo: pudoSnapshotOf(check.point) }
    }

    if (check.status === "not_found") {
      /* PLAN D8: demo mode does not check that a point exists (a demo store may use real ids, from the PudoFinder widget). */
      if (this.options_.demo) {
        refuseAbroad()
        this.logger_.info(`[dpd] Demo mode: Pickup point ${pudoId} is not in the sample catalog; accepted without a check.`)
        return result.data
      }
      return refuse("pudo_not_found")
    }

    /* Unchecked: fail open (spec 11, O13), in Poland only. */
    refuseAbroad()
    this.logger_.warn(`[dpd] Could not check Pickup point ${pudoId} (${check.reason}); accepted without a check.`)
    return result.data
  }

  /** A fresh read of a point; a source that throws is an unchecked point (network). */
  protected async pointCheck(pudoId: string): Promise<PointCheck> {
    try {
      return await this.points_.details(pudoId)
    } catch {
      return { status: "unchecked", pudoId, reason: "network" }
    }
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
