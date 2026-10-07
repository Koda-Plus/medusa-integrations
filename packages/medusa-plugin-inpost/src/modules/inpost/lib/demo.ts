import { createHash } from "node:crypto"
import { COURIER_SERVICE, DEMO_ROWS, LOCKER_SERVICE, type ParcelKind, type ParcelSize } from "./constants"
import type { Locker } from "./lockers"
import { toMinor } from "./money"
import type { PointDto } from "./points"
import { shipmentStage, stageRank } from "./statuses"
import type { NewParcel } from "./store"

/**
 * DEMO MODE: sample InPost shipments built from the store's own newest
 * orders, so the admin always has something to show and every button can be
 * tried. Deterministic: the same orders give the same rows (the scenario
 * follows the order's position, ids and numbers come from a hash of the order
 * id). Rows carry `demo: true` and never meet real ones; nothing is sent to
 * InPost, lockers are invented (prefix KSP, "Koda Supply"), tracking numbers
 * start with 99 and are never linked to the InPost tracking page.
 *
 * A shipment a person creates in the demo moves along a short timeline (a
 * label after a minute, in the locker after two hours); the seeded ones keep
 * their status, so every list of the Panel stays filled.
 */

export const DEMO_SEED_ACTOR = "demo-seed"

export const DEMO_LOCKERS: Array<Locker & { location: { lat: number; lng: number }; description: string }> = [
  {
    code: "KSP01M",
    name: "Paczkomat KSP01M",
    address: { line1: "ul. Narzędziowa 12", line2: "00-950 Warszawa", city: "Warszawa", post_code: "00-950" },
    location: { lat: 52.2297, lng: 21.0122 },
    description: "Przy wejściu do pasażu",
  },
  {
    code: "KSP02A",
    name: "Paczkomat KSP02A",
    address: { line1: "ul. Śrubowa 3", line2: "30-901 Kraków", city: "Kraków", post_code: "30-901" },
    location: { lat: 50.0614, lng: 19.9366 },
    description: "Obok stacji paliw",
  },
  {
    code: "KSP03K",
    name: "Paczkomat KSP03K",
    address: { line1: "ul. Kluczowa 7", line2: "50-901 Wrocław", city: "Wrocław", post_code: "50-901" },
    location: { lat: 51.1079, lng: 17.0385 },
    description: "Parking przy markecie",
  },
  {
    code: "KSP04P",
    name: "Paczkomat KSP04P",
    address: { line1: "ul. Wiertarska 21", line2: "61-901 Poznań", city: "Poznań", post_code: "61-901" },
    location: { lat: 52.4064, lng: 16.9252 },
    description: "Przy przystanku tramwajowym",
  },
  {
    code: "KSP05G",
    name: "Paczkomat KSP05G",
    address: { line1: "ul. Młotkowa 5", line2: "80-901 Gdańsk", city: "Gdańsk", post_code: "80-901" },
    location: { lat: 54.352, lng: 18.6466 },
    description: "Wejście od podwórza",
  },
]

/** The demo lockers as points, for the locker search of demo mode. */
export function demoPoints(): PointDto[] {
  return DEMO_LOCKERS.map((l) => ({
    code: l.code,
    name: `InPost Paczkomat ${l.code}`,
    type: ["parcel_locker"],
    status: "Operating",
    address: {
      line1: l.address?.line1 ?? "",
      line2: l.address?.line2 ?? "",
      street: (l.address?.line1 ?? "").replace(/\s+\d+\w*$/, ""),
      building_number: (l.address?.line1 ?? "").match(/(\d+\w*)$/)?.[1] ?? "",
      city: l.address?.city ?? "",
      post_code: l.address?.post_code ?? "",
      province: "",
    },
    location: l.location,
    description: l.description,
    opening_hours: "24/7",
    is_24_7: true,
    payment_available: true,
    distance: null,
  }))
}

/** The demo search: a code, a city, a post code or a street, by substring. */
export function searchDemoPoints(q: string | null | undefined, limit = 10): PointDto[] {
  const needle = String(q ?? "").trim().toLowerCase()
  const all = demoPoints()
  if (!needle) return all.slice(0, limit)
  return all
    .filter((p) => [p.code, p.address.city, p.address.post_code, p.address.line1].some((v) => v.toLowerCase().includes(needle)))
    .slice(0, limit)
}

export interface DemoOrder {
  id: string
  display_id?: number | null
  currency_code?: string | null
  total?: unknown
  created_at?: string | Date | null
}

interface Scenario {
  kind: ParcelKind
  cod: boolean
  size: ParcelSize
  state: "pending" | "created" | "skipped"
  status: string | null
  locker: number | null
  problems?: Array<{ code: string }>
  skip?: string
  offer?: { id: string; rate: number; currency: string; status: string }
  /** How long ago the shipment was created, in hours. */
  ageHours: number
}

const SCENARIOS: readonly Scenario[] = [
  { kind: "locker", cod: true, size: "small", state: "pending", status: null, locker: 0, ageHours: 1 },
  { kind: "courier", cod: false, size: "medium", state: "pending", status: null, locker: null, ageHours: 2 },
  { kind: "locker", cod: false, size: "medium", state: "pending", status: null, locker: null, problems: [{ code: "locker_missing" }], ageHours: 3 },
  { kind: "locker", cod: false, size: "medium", state: "created", status: "confirmed", locker: 1, ageHours: 4 },
  { kind: "courier", cod: false, size: "large", state: "created", status: "confirmed", locker: null, ageHours: 5 },
  { kind: "locker", cod: true, size: "small", state: "created", status: "offers_prepared", locker: 2, offer: { id: "1", rate: 13.99, currency: "PLN", status: "available" }, ageHours: 6 },
  { kind: "locker", cod: false, size: "small", state: "created", status: "adopted_at_sorting_center", locker: 3, ageHours: 20 },
  { kind: "courier", cod: true, size: "medium", state: "created", status: "out_for_delivery_to_address", locker: null, ageHours: 26 },
  { kind: "locker", cod: false, size: "medium", state: "created", status: "ready_to_pickup", locker: 4, ageHours: 30 },
  { kind: "locker", cod: true, size: "small", state: "created", status: "pickup_reminder_sent", locker: 0, ageHours: 60 },
  { kind: "locker", cod: false, size: "small", state: "created", status: "delivered", locker: 1, ageHours: 72 },
  { kind: "courier", cod: false, size: "medium", state: "created", status: "delivered", locker: null, ageHours: 80 },
  { kind: "locker", cod: true, size: "large", state: "created", status: "delivered", locker: 2, ageHours: 96 },
  { kind: "locker", cod: false, size: "medium", state: "created", status: "pickup_time_expired", locker: 3, ageHours: 140 },
  { kind: "courier", cod: false, size: "small", state: "created", status: "returned_to_sender", locker: null, ageHours: 200 },
  { kind: "locker", cod: false, size: "small", state: "skipped", status: null, locker: 4, skip: "inpost_shipment", ageHours: 8 },
]

function digits(seed: string, n: number): string {
  const hex = createHash("sha256").update(seed).digest("hex")
  let out = ""
  for (let i = 0; out.length < n; i++) out += String(parseInt(hex.charAt(i % hex.length), 16) % 10)
  return out.slice(0, n)
}

/** A fake ShipX id: 9 and eleven digits from the seed. */
export function demoShipmentId(seed: string): string {
  return `9${digits(`id:${seed}`, 11)}`
}

/** A fake tracking number: 24 digits starting with 99, never linked to InPost. */
export function demoTrackingNumber(seed: string): string {
  return `99${digits(`tn:${seed}`, 22)}`
}

export interface DemoRow extends NewParcel {
  status_at: Date | null
  cod_minor: number | null
  reference: string | null
  offer: Scenario["offer"] | null
}

/**
 * The demo rows of a list of orders (newest first): one scenario per order,
 * at most DEMO_ROWS. An order not in PLN gets the scenario without cash on
 * delivery (InPost collects in PLN only).
 */
export function demoRows(orders: DemoOrder[], now: Date): DemoRow[] {
  return orders.slice(0, Math.min(DEMO_ROWS, SCENARIOS.length)).map((order, i) => {
    const sc = SCENARIOS[i]
    const pln = String(order.currency_code ?? "").toLowerCase() === "pln"
    const cod = sc.cod && pln
    const locker = sc.kind === "locker" && sc.locker !== null ? DEMO_LOCKERS[sc.locker % DEMO_LOCKERS.length] : null
    const created = sc.state === "created"
    const at = new Date(now.getTime() - sc.ageHours * 3600_000)
    const displayId = typeof order.display_id === "number" ? order.display_id : null
    const minor = cod ? toMinor(order.total) : null
    return {
      order_id: order.id,
      display_id: displayId,
      fulfillment_id: null,
      demo: true,
      option_id: `inpost-${sc.kind === "locker" ? "paczkomat" : "kurier"}${cod ? "-cod" : ""}`,
      kind: sc.kind,
      cod,
      service: sc.kind === "locker" ? LOCKER_SERVICE : COURIER_SERVICE,
      locker_code: locker?.code ?? null,
      locker_name: locker?.name ?? null,
      locker_address: locker?.address ?? null,
      parcel_size: sc.size,
      parcel_no: 1,
      currency: pln ? "PLN" : String(order.currency_code ?? "").toUpperCase() || null,
      state: sc.state,
      skip_reason: sc.skip ?? null,
      external: false,
      shipment_id: created ? demoShipmentId(order.id) : null,
      status: sc.status,
      status_at: created ? at : null,
      tracking_number: created && sc.status !== "offers_prepared" ? demoTrackingNumber(order.id) : null,
      shipment_created_at: created ? at : null,
      created_by: DEMO_SEED_ACTOR,
      problems: sc.problems ?? null,
      cod_minor: created && minor !== null && minor > 0 ? minor : null,
      reference: created ? `Order ${displayId ?? order.id}` : null,
      offer: sc.offer ?? null,
    }
  })
}

const LOCKER_TIMELINE: ReadonlyArray<[number, string]> = [
  [0, "created"],
  [1, "confirmed"],
  [10, "collected_from_sender"],
  [30, "adopted_at_sorting_center"],
  [60, "out_for_delivery"],
  [120, "ready_to_pickup"],
  [360, "delivered"],
]

const COURIER_TIMELINE: ReadonlyArray<[number, string]> = [
  [0, "created"],
  [1, "confirmed"],
  [10, "collected_from_sender"],
  [30, "adopted_at_sorting_center"],
  [60, "out_for_delivery_to_address"],
  [180, "delivered"],
]

/** The status a simulated shipment has `minutes` after it was created. */
export function demoStatusAfter(kind: ParcelKind, minutes: number): string {
  const timeline = kind === "courier" ? COURIER_TIMELINE : LOCKER_TIMELINE
  let status = timeline[0][1]
  for (const [after, s] of timeline) if (minutes >= after) status = s
  return status
}

/**
 * Where a demo shipment a person created should be now, or null when it
 * stays where it is: seeded rows keep their status, and a status off the
 * timeline (a problem, a return, a cancel, an unpaid offer) never moves.
 */
export function demoNextStatus(row: { kind: string; status: string | null; created_by: string | null; shipment_created_at?: Date | string | null }, now: Date): string | null {
  if (row.created_by === DEMO_SEED_ACTOR || !row.shipment_created_at || !row.status) return null
  const timeline = row.kind === "courier" ? COURIER_TIMELINE : LOCKER_TIMELINE
  if (!timeline.some(([, s]) => s === row.status)) return null
  const started = new Date(row.shipment_created_at).getTime()
  if (!Number.isFinite(started)) return null
  const next = demoStatusAfter(row.kind === "courier" ? "courier" : "locker", (now.getTime() - started) / 60_000)
  if (next === row.status) return null
  return stageRank(shipmentStage(next)) >= stageRank(shipmentStage(row.status)) ? next : null
}
