import { normalizePhone, toMinor } from "./confirm"
import { PAYMENT_TYPES, type DeliveryType } from "./constants"
import { isDeliveryType, safeLockerCode } from "./delivery"
import { InpostPayFlowError } from "./errors"

/**
 * The body of InPost's `POST /v1/izi/order` (the "Creating an order" page of
 * the Merchant Backend API) as the plugin reads it: the basket, the buyer
 * (`account_info`), the delivery (type, parcel locker, courier address), the
 * payment type and the basket price InPost charged. Pure.
 */

export interface ParsedBuyer {
  email: string
  first_name: string
  last_name: string
  phone: string | null
  address: { address_1: string; address_2?: string | null; city: string; postal_code: string; country_code: string }
}

export interface ParsedOrder {
  basketId: string
  buyer: ParsedBuyer
  delivery: { type: DeliveryType; point: string | null }
  payment: { status: string | null; type: string | null }
  expectedTotalMinor: number | null
}

const text = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "")

export function parseInpostOrder(body: Record<string, any>): ParsedOrder {
  const details = body.order_details ?? {}
  const account = body.account_info ?? {}
  const delivery = body.delivery ?? {}
  const basketId = text(details.basket_id, 80)
  if (!basketId) throw new InpostPayFlowError(400, "BASKET_ID_MISSING", "order_details.basket_id is required")
  if (String(details.currency ?? "PLN").toUpperCase() !== "PLN") throw new InpostPayFlowError(400, "CURRENCY_NOT_SUPPORTED", "Only PLN is supported")
  const type = isDeliveryType(delivery.delivery_type) ? delivery.delivery_type : null
  if (!type) throw new InpostPayFlowError(400, "DELIVERY_TYPE_INVALID", "delivery.delivery_type must be APM, COURIER or DIGITAL")
  const email = text(account.mail, 200) || text(delivery.mail, 200)
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new InpostPayFlowError(400, "EMAIL_INVALID", "account_info.mail is required")
  const phone = normalizePhone(delivery.phone_number?.phone ?? account.phone_number?.phone, delivery.phone_number?.country_prefix ?? account.phone_number?.country_prefix)
  /* The courier goes to delivery_address; a locker or digital order uses the client address. */
  const da = type === "COURIER" && delivery.delivery_address ? delivery.delivery_address : null
  const ca = account.client_address ?? {}
  const details2 = ca.address_details ?? {}
  const street = [text(details2.street), text(details2.building)].filter(Boolean).join(" ")
  const fromDetails = street ? `${street}${details2.flat ? `/${text(details2.flat)}` : ""}` : ""
  const addressLine = text(da?.address) || text(ca.address) || fromDetails
  const point = type === "APM" ? safeLockerCode(delivery.delivery_point) : null
  if (type === "APM" && !point) throw new InpostPayFlowError(400, "DELIVERY_POINT_INVALID", "delivery.delivery_point is required for APM")
  const [first, ...rest] = text(da?.name).split(/\s+/).filter(Boolean)
  const paymentType = text(details.payment_type, 40)
  return {
    basketId,
    buyer: {
      email,
      first_name: (da && first) || text(account.name, 100) || "-",
      last_name: (da && rest.join(" ")) || text(account.surname, 100) || "-",
      phone: phone ? `${phone.country_prefix}${phone.phone}` : null,
      address: {
        address_1: addressLine || "-",
        city: text(da?.city ?? ca.city, 100) || "-",
        postal_code: text(da?.postal_code ?? ca.postal_code, 20) || "-",
        country_code: (text(da?.country_code ?? ca.country_code, 2) || "PL").toLowerCase(),
      },
    },
    delivery: { type, point },
    payment: {
      status: paymentType === "CASH_ON_DELIVERY" ? "COD" : "UNPAID",
      type: (PAYMENT_TYPES as readonly string[]).includes(paymentType) ? paymentType : null,
    },
    expectedTotalMinor: toMinor(details.basket_price?.gross),
  }
}
