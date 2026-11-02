import { createHash } from "node:crypto"
import { DEMO_ROWS, OPTION_SPECS, type DpdOptionId, type ShipmentKind, type ShipmentStage, type ShipmentState } from "./constants"
import { toMinor } from "./money"

/**
 * DEMO MODE: sample DPD shipments built from the store's own newest orders,
 * so the Panel, its counters and the order card have something to show.
 * Deterministic: the same orders give the same rows (the scenario follows
 * the order's position, waybills come from a hash of the order id). Rows are
 * written with `mode: "demo"` and never meet sandbox or live rows; nothing
 * is sent to DPD.
 *
 * Everything DPD would give is invented and looks it: the Pickup points are
 * PL9DEMO01 to PL9DEMO05 (a real id never has "DEMO" in it), the waybills
 * start with 99 and end with "D", and no row links to the DPD tracking page.
 * No InfoServices event code is invented either: the rows carry a stage
 * (where the parcel is) and no status code.
 *
 * Stage 1 has no flow that moves a shipment, so the seeded rows stay where
 * they are; later stages run the demo through the same code paths as the
 * sandbox and live.
 */

export const DEMO_SEED_SOURCE = "demo"

/** Invented Pickup points, the shape of a DPD id (PUDO_ID_PATTERN) and nothing more. */
export const DEMO_POINTS: readonly string[] = ["PL9DEMO01", "PL9DEMO02", "PL9DEMO03", "PL9DEMO04", "PL9DEMO05"]

export function isDemoPoint(id: string | null | undefined): boolean {
  return typeof id === "string" && DEMO_POINTS.includes(id)
}

export type DemoOrder = {
  id: string
  display_id?: number | null
  currency_code?: string | null
  total?: unknown
  created_at?: string | Date | null
}

type Scenario = {
  option: DpdOptionId
  kind: ShipmentKind
  state: ShipmentState
  stage: ShipmentStage | null
  /** Index into DEMO_POINTS, for a Pickup option. */
  point?: number
  /** The destination of a courier option (Poland by default). */
  country?: string
  /** Boxes, one waybill each, once DPD gave the numbers. */
  boxes?: number
  handedOver?: boolean
  problems?: Array<{ code: string; field?: string }>
  error?: { code: string; message: string }
  /** How long ago DPD was last heard about it, in hours. */
  ageHours: number
}

/**
 * One scenario per order, newest order first. Together they fill every list
 * of the Panel (to_create, labeled, handed_over, in_transit, delivered,
 * problems, canceled, returns) and both attention counters.
 */
const SCENARIOS: readonly Scenario[] = [
  { option: "dpd-courier", kind: "outbound", state: "pending", stage: null, ageHours: 1 },
  { option: "dpd-pickup-cod", kind: "outbound", state: "pending", stage: null, point: 0, ageHours: 1 },
  { option: "dpd-courier-cod", kind: "outbound", state: "pending", stage: null, problems: [{ code: "weight_missing", field: "boxes.0.weight" }], ageHours: 2 },
  { option: "dpd-courier", kind: "outbound", state: "created", stage: null, boxes: 1, ageHours: 2 },
  { option: "dpd-pickup", kind: "outbound", state: "labeled", stage: null, point: 1, boxes: 1, ageHours: 3 },
  { option: "dpd-courier", kind: "outbound", state: "labeled", stage: "preparing", boxes: 2, ageHours: 4 },
  { option: "dpd-courier-cod", kind: "outbound", state: "labeled", stage: "ready", boxes: 1, handedOver: true, ageHours: 6 },
  { option: "dpd-pickup", kind: "outbound", state: "labeled", stage: "in_transit", point: 2, boxes: 1, handedOver: true, ageHours: 20 },
  { option: "dpd-courier", kind: "outbound", state: "labeled", stage: "in_transit", country: "DE", boxes: 1, handedOver: true, ageHours: 26 },
  { option: "dpd-pickup-cod", kind: "outbound", state: "labeled", stage: "in_point", point: 3, boxes: 1, handedOver: true, ageHours: 30 },
  { option: "dpd-courier", kind: "outbound", state: "labeled", stage: "delivered", boxes: 1, handedOver: true, ageHours: 48 },
  { option: "dpd-pickup", kind: "outbound", state: "labeled", stage: "delivered", point: 4, boxes: 1, handedOver: true, ageHours: 72 },
  { option: "dpd-courier", kind: "outbound", state: "failed", stage: null, error: { code: "INVALID_FIELDS", message: "Sample: DPD refused the receiver's postal code." }, ageHours: 5 },
  { option: "dpd-courier-cod", kind: "outbound", state: "unknown", stage: null, error: { code: "timeout", message: "Sample: no answer from DPD in time; looked up before anything is sent again." }, ageHours: 7 },
  { option: "dpd-courier", kind: "outbound", state: "canceled", stage: null, ageHours: 9 },
  { option: "dpd-return", kind: "return", state: "labeled", stage: "in_transit", boxes: 1, ageHours: 40 },
]

function digits(seed: string, n: number): string {
  const hex = createHash("sha256").update(seed).digest("hex")
  let out = ""
  for (let i = 0; out.length < n; i++) out += String(parseInt(hex.charAt(i % hex.length), 16) % 10)
  return out.slice(0, n)
}

/** An invented waybill: 99, eleven digits from the seed, "D" (14 characters, never linked to DPD). */
export function demoWaybill(seed: string): string {
  return `99${digits(`wb:${seed}`, 11)}D`
}

/** A demo row: the columns a new row takes, plus the ones a later step would set. */
export type DemoRow = {
  order_id: string
  display_id: number | null
  fulfillment_id: null
  return_id: null
  kind: ShipmentKind
  mode: "demo"
  option_id: DpdOptionId
  service: null
  pudo_id: string | null
  country_code: string
  session_type: "DOMESTIC" | "INTERNATIONAL" | null
  cod_minor: number | null
  currency: string | null
  reference: null
  waybills: string[] | null
  state: ShipmentState
  status: null
  stage: ShipmentStage | null
  problems: Array<{ code: string; field?: string }> | null
  handed_over_at: Date | null
  last_checked_at: Date | null
  error: string | null
  error_code: string | null
}

/**
 * The demo rows of a list of orders (newest first): one scenario per order,
 * at most DEMO_ROWS. Cash on delivery only for an order in PLN (the default
 * of `codCountries`); otherwise the same scenario without it. The amount is
 * known once DPD gave the numbers, as in the real flow.
 */
export function demoRows(orders: readonly DemoOrder[], now: Date): DemoRow[] {
  return orders.slice(0, Math.min(DEMO_ROWS, SCENARIOS.length)).map((order, i) => {
    const sc = SCENARIOS[i]
    const currency = String(order.currency_code ?? "").toUpperCase() || null
    const wantsCod = OPTION_SPECS.find((s) => s.id === sc.option)?.cod ?? false
    const cod = wantsCod && currency === "PLN"
    const option = (cod || !wantsCod ? sc.option : sc.option.replace(/-cod$/, "")) as DpdOptionId
    const pudo = sc.point !== undefined ? DEMO_POINTS[sc.point % DEMO_POINTS.length] : null
    const country = pudo ? pudo.slice(0, 2) : (sc.country ?? "PL")
    const numbered = sc.boxes !== undefined && sc.boxes > 0
    const at = new Date(now.getTime() - sc.ageHours * 3600_000)
    const minor = cod && numbered ? toMinor(order.total) : null
    return {
      order_id: order.id,
      display_id: typeof order.display_id === "number" ? order.display_id : null,
      fulfillment_id: null,
      return_id: null,
      kind: sc.kind,
      mode: "demo",
      option_id: option,
      service: null,
      pudo_id: pudo,
      country_code: country,
      session_type: numbered ? (country === "PL" ? "DOMESTIC" : "INTERNATIONAL") : null,
      cod_minor: minor !== null && minor > 0 ? minor : null,
      currency,
      reference: null,
      waybills: numbered ? Array.from({ length: sc.boxes ?? 1 }, (_, n) => demoWaybill(`${order.id}:${n}`)) : null,
      state: sc.state,
      status: null,
      stage: sc.stage,
      problems: sc.problems ?? null,
      handed_over_at: sc.handedOver ? at : null,
      last_checked_at: sc.stage ? at : null,
      error: sc.error?.message ?? null,
      error_code: sc.error?.code ?? null,
    }
  })
}

/** The history line of a seeded row. */
export function demoMessage(row: Pick<DemoRow, "state" | "stage" | "kind">): string {
  if (row.kind === "return") return "Sample return with an invented return waybill."
  switch (row.state) {
    case "pending":
      return "Sample shipment waiting to be created."
    case "created":
      return "Sample shipment with invented waybills, the label not printed yet."
    case "labeled":
      return row.stage ? `Sample shipment, stage ${row.stage}.` : "Sample shipment with a label, not handed to the courier yet."
    case "failed":
      return "Sample of a shipment DPD refused."
    case "unknown":
      return "Sample of an unclear answer from DPD."
    case "canceled":
      return "Sample of a canceled shipment."
    default:
      return "Sample shipment."
  }
}
