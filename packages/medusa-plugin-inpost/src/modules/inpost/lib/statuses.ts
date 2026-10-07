/**
 * SHIPX STATUSES AND WHAT THEY MEAN FOR THE STORE. Zero imports, so the admin
 * reads the same mapping as the server.
 *
 * The names come from the public dictionary GET /v1/statuses (53 statuses in
 * October 2026); their titles in English and Polish live in the admin
 * dictionaries (`status.<name>`). The grouping follows the warehouse app of a
 * Polish cosmetics wholesaler that ships its parcels with ShipX today. InPost adds statuses
 * without notice, so an unknown status counts as "in transit": the parcel is
 * somewhere on its way.
 */

/** Where a shipment is, from the store's point of view. */
export type ShipmentStage =
  | "preparing" // created, offers being prepared or waiting for payment: no label yet
  | "ready" // label ready: waiting for the courier, or for the drop-off at a locker or a point
  | "in_transit" // picked up and on its way (out for delivery to an address included)
  | "in_locker" // waiting for the customer in a locker or a point
  | "delivered"
  | "problem" // not collected in time, refused, undeliverable, claimed: a person should act
  | "returned" // on its way back, or back with the sender
  | "canceled"

/** Before payment: the label does not exist yet, and ShipX still allows a cancel. */
export const PRE_LABEL_STATUSES: readonly string[] = ["created", "offers_prepared", "offer_selected"]

/** ShipX cancels only these (DELETE /v1/shipments/:id answers invalid_action for any other). */
export const CANCELLABLE_STATUSES: readonly string[] = ["created", "offers_prepared", "offer_selected"]

export const IN_LOCKER_STATUSES: readonly string[] = [
  "ready_to_pickup",
  "ready_to_pickup_from_pok",
  "ready_to_pickup_from_pok_registered",
  "pickup_reminder_sent",
  "stack_in_customer_service_point",
  "stack_in_box_machine",
  "courier_avizo_in_customer_service_point",
]
const IN_LOCKER: ReadonlySet<string> = new Set(IN_LOCKER_STATUSES)

export const PROBLEM_STATUSES: readonly string[] = [
  "pickup_time_expired",
  "avizo",
  "claimed",
  "rejected_by_receiver",
  "undelivered",
  "undelivered_wrong_address",
  "undelivered_incomplete_address",
  "undelivered_unknown_receiver",
  "undelivered_cod_cash_receiver",
  "undelivered_no_mailbox",
  "undelivered_not_live_address",
  "undelivered_lack_of_access_letterbox",
  "oversized",
  "stack_parcel_pickup_time_expired",
  "stack_parcel_in_box_machine_pickup_time_expired",
  "ready_to_pickup_from_branch",
  "missing",
]
const PROBLEM: ReadonlySet<string> = new Set(PROBLEM_STATUSES)

export const RETURNED_STATUSES: readonly string[] = ["returned_to_sender", "taken_by_courier_from_customer_service_point", "return_pickup_confirmation_to_sender"]
const RETURNED: ReadonlySet<string> = new Set(RETURNED_STATUSES)

/** Statuses that end the tracking: the status pass stops reading the shipment. */
export const FINAL_STATUSES: readonly string[] = ["delivered", "returned_to_sender", "canceled", "return_pickup_confirmation_to_sender"]
const FINAL: ReadonlySet<string> = new Set(FINAL_STATUSES)

export function shipmentStage(status: string | null | undefined): ShipmentStage {
  if (!status) return "preparing"
  if (PRE_LABEL_STATUSES.includes(status)) return "preparing"
  if (status === "confirmed") return "ready"
  if (status === "delivered") return "delivered"
  if (status === "canceled") return "canceled"
  if (IN_LOCKER.has(status)) return "in_locker"
  if (RETURNED.has(status)) return "returned"
  if (PROBLEM.has(status)) return "problem"
  return "in_transit"
}

export function isFinalStatus(status: string | null | undefined): boolean {
  return Boolean(status) && FINAL.has(status as string)
}

export function isCancellable(status: string | null | undefined): boolean {
  return Boolean(status) && CANCELLABLE_STATUSES.includes(status as string)
}

/** ShipX hands out the label from `confirmed` on (and never for a canceled shipment). */
export function isLabelAvailable(status: string | null | undefined): boolean {
  return Boolean(status) && !PRE_LABEL_STATUSES.includes(status as string) && status !== "canceled"
}

/** InPost has the parcel: it was picked up from the sender or dropped off, so the Medusa fulfillment is shipped. */
export function isPickedUp(status: string | null | undefined): boolean {
  const stage = shipmentStage(status)
  return stage === "in_transit" || stage === "in_locker" || stage === "delivered" || stage === "problem" || stage === "returned"
}

/** A prepaid account: ShipX prepared offers and waits for one to be bought. */
export function needsPayment(status: string | null | undefined): boolean {
  return status === "offers_prepared"
}

const ORDER: readonly ShipmentStage[] = ["preparing", "ready", "in_transit", "in_locker", "delivered"]

/** How far a stage is along the normal road (problems, returns and cancels are off the road: -1). */
export function stageRank(stage: ShipmentStage): number {
  return ORDER.indexOf(stage)
}

/** Every status of the public dictionary, for the admin filters and tests. */
export const KNOWN_STATUSES: readonly string[] = [
  "created",
  "offers_prepared",
  "offer_selected",
  "confirmed",
  "dispatched_by_sender",
  "collected_from_sender",
  "taken_by_courier",
  "adopted_at_source_branch",
  "sent_from_source_branch",
  "ready_to_pickup_from_pok",
  "ready_to_pickup_from_pok_registered",
  "oversized",
  "adopted_at_sorting_center",
  "sent_from_sorting_center",
  "adopted_at_target_branch",
  "out_for_delivery",
  "ready_to_pickup",
  "pickup_reminder_sent",
  "delivered",
  "pickup_time_expired",
  "avizo",
  "claimed",
  "returned_to_sender",
  "canceled",
  "other",
  "dispatched_by_sender_to_pok",
  "out_for_delivery_to_address",
  "pickup_reminder_sent_address",
  "rejected_by_receiver",
  "undelivered_wrong_address",
  "undelivered_incomplete_address",
  "undelivered_unknown_receiver",
  "undelivered_cod_cash_receiver",
  "taken_by_courier_from_pok",
  "undelivered",
  "return_pickup_confirmation_to_sender",
  "ready_to_pickup_from_branch",
  "delay_in_delivery",
  "redirect_to_box",
  "canceled_redirect_to_box",
  "readdressed",
  "undelivered_no_mailbox",
  "undelivered_not_live_address",
  "undelivered_lack_of_access_letterbox",
  "missing",
  "stack_in_customer_service_point",
  "stack_parcel_pickup_time_expired",
  "unstack_from_customer_service_point",
  "courier_avizo_in_customer_service_point",
  "taken_by_courier_from_customer_service_point",
  "stack_in_box_machine",
  "unstack_from_box_machine",
  "stack_parcel_in_box_machine_pickup_time_expired",
]

/** The public tracking page of a number. */
export function trackingUrl(trackingNumber: string): string {
  return `https://inpost.pl/sledzenie-przesylek?number=${encodeURIComponent(trackingNumber)}`
}
