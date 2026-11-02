import { BOX_SIDE_MAX_CM, BOX_SIDE_MIN_CM, BOX_WEIGHT_MAX_KG, BOX_WEIGHT_MIN_KG, COURIER_ORDER_MAX_KG, MAX_BOXES } from "./constants"
import type { FieldErrorDto, ProblemDto } from "./contract"
import { decimalString } from "./money"
import type { PlanOrder, PlanRow } from "./plan"

/**
 * THE BOXES OF A SHIPMENT (DPD parcels). Pure functions.
 *
 * By default one box, weighed from the variants of the fulfilled items (in
 * `weightUnit`), with the sides of `defaultBox` when it has them; when a
 * variant has no weight the default box stands in, and without one the plan
 * asks for a weight. A person may set the boxes by hand (up to MAX_BOXES);
 * those win until they go back to automatic.
 *
 * DPD limits per box: 0.01 to 700 kg, each side 1 to 300 cm, whole
 * centimetres. Weights are rounded UP to 0.01 kg, so a box is never declared
 * lighter than it is.
 */

export type PlanBox = { weightKg: number; lengthCm: number | null; widthCm: number | null; heightCm: number | null }
/** A box as stored on the row: what was sent, with its parcel reference and, once DPD gave it, the waybill. */
export type StoredBox = PlanBox & { reference: string | null; waybill: string | null }
/** dpd_shipment.boxes. `edited`: a person set the boxes, the plan uses `items`; false: the plan computes them and `items` is the last snapshot sent. */
export type StoredBoxes = { edited: boolean; items: StoredBox[] }
export type BoxesSource = "edited" | "variants" | "default_box" | "none"

type Obj = Record<string, unknown>

const SIDES = ["lengthCm", "widthCm", "heightCm"] as const

function obj(v: unknown): Obj | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null
}

/** A number from a number, a decimal string ("1.5", "1,5") or a BigNumber-like object; null otherwise. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  const s = decimalString(v)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function isSet(v: unknown): boolean {
  return v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")
}

function sideOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null
}

/** The stored JSON read back (an object, or the same as a JSON string); null for anything else. */
export function readStoredBoxes(value: unknown): StoredBoxes | null {
  let v: unknown = value
  if (typeof v === "string") {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  const o = obj(v)
  if (!o || typeof o.edited !== "boolean" || !Array.isArray(o.items)) return null
  const items: StoredBox[] = []
  for (const raw of o.items) {
    const b = obj(raw)
    if (!b || typeof b.weightKg !== "number" || !Number.isFinite(b.weightKg)) return null
    items.push({
      weightKg: b.weightKg,
      lengthCm: sideOrNull(b.lengthCm),
      widthCm: sideOrNull(b.widthCm),
      heightCm: sideOrNull(b.heightCm),
      reference: stringOrNull(b.reference),
      waybill: stringOrNull(b.waybill),
    })
  }
  return { edited: o.edited, items }
}

/** kg rounded UP to two decimals, at least 0.01. */
export function roundKg(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0) return BOX_WEIGHT_MIN_KG
  /* The inner round takes float noise off first: 1.2 * 100 is 120.00000000000001, which must stay 120. */
  const cents = Math.ceil(Math.round(kg * 100 * 1e6) / 1e6)
  return Math.max(BOX_WEIGHT_MIN_KG, cents / 100)
}

/**
 * The body of POST .../boxes: 1 to MAX_BOXES boxes, weights and sides as
 * numbers or decimal strings ("1,5" too). Errors name the field:
 * "boxes[1].weightKg" (zero based), and `fields` holds the same as
 * { index, field } for the admin. Weights come back rounded up to 0.01 kg,
 * sides to whole centimetres. Takes the array, or the body holding it under
 * `boxes`.
 */
export function parseBoxesInput(value: unknown): { ok: true; boxes: PlanBox[] } | { ok: false; errors: string[]; fields: FieldErrorDto[] } {
  const raw = Array.isArray(value) ? value : obj(value)?.boxes
  if (!Array.isArray(raw)) return { ok: false, errors: ["boxes"], fields: [] }
  if (raw.length < 1 || raw.length > MAX_BOXES) return { ok: false, errors: [`boxes (1 to ${MAX_BOXES})`], fields: [] }
  const errors: string[] = []
  const fields: FieldErrorDto[] = []
  const wrong = (index: number, field: "weightKg" | (typeof SIDES)[number]) => {
    errors.push(`boxes[${index}].${field}`)
    fields.push({ index, field })
  }
  const boxes: PlanBox[] = []
  raw.forEach((item, i) => {
    const b = obj(item)
    if (!b) {
      /* Not a box at all: its weight, the one field every box needs, is what is missing. */
      errors.push(`boxes[${i}]`)
      fields.push({ index: i, field: "weightKg" })
      return
    }
    const weight = num(b.weightKg)
    if (weight === null || weight < BOX_WEIGHT_MIN_KG || weight > BOX_WEIGHT_MAX_KG) wrong(i, "weightKg")
    const box: PlanBox = { weightKg: weight === null ? 0 : roundKg(weight), lengthCm: null, widthCm: null, heightCm: null }
    for (const side of SIDES) {
      if (!isSet(b[side])) continue
      const n = num(b[side])
      const whole = n === null ? null : Math.round(n)
      if (whole === null || whole < BOX_SIDE_MIN_CM || whole > BOX_SIDE_MAX_CM) wrong(i, side)
      else box[side] = whole
    }
    boxes.push(box)
  })
  return errors.length > 0 ? { ok: false, errors, fields } : { ok: true, boxes }
}

/**
 * Weight of the fulfillment items (or every order item without them):
 * variant.weight in `unit` times quantity. complete=false when an item is
 * missing or has no positive weight (or no positive quantity).
 */
export function variantWeightKg(order: PlanOrder, items: Array<{ line_item_id: string; quantity: unknown }> | null, unit: "g" | "kg"): { kg: number; complete: boolean } {
  const lines = order.items ?? []
  const wanted = items && items.length > 0 ? items : lines.map((l) => ({ line_item_id: l.id, quantity: l.quantity }))
  let sum = 0
  let complete = wanted.length > 0
  for (const w of wanted) {
    const line = lines.find((l) => l.id === w.line_item_id)
    const weight = num(line?.variant?.weight)
    const quantity = num(w.quantity)
    if (!line || weight === null || weight <= 0 || quantity === null || quantity <= 0) {
      complete = false
      continue
    }
    sum += weight * quantity
  }
  return { kg: unit === "g" ? sum / 1000 : sum, complete }
}

function between(n: number, min: number, max: number): boolean {
  return Number.isFinite(n) && n >= min && n <= max
}

/** box_invalid per field out of BOX_* limits, too_many_boxes over MAX_BOXES. */
export function boxProblems(boxes: readonly PlanBox[]): ProblemDto[] {
  const out: ProblemDto[] = []
  if (boxes.length > MAX_BOXES) out.push({ code: "too_many_boxes", detail: String(boxes.length) })
  boxes.forEach((b, i) => {
    if (!between(b.weightKg, BOX_WEIGHT_MIN_KG, BOX_WEIGHT_MAX_KG)) {
      out.push({ code: "box_invalid", field: `boxes[${i}].weightKg`, detail: `box ${i + 1}, weight ${BOX_WEIGHT_MIN_KG} to ${BOX_WEIGHT_MAX_KG} kg` })
    }
    for (const side of SIDES) {
      const v = b[side]
      if (v === null) continue
      if (!Number.isInteger(v) || !between(v, BOX_SIDE_MIN_CM, BOX_SIDE_MAX_CM)) {
        out.push({ code: "box_invalid", field: `boxes[${i}].${side}`, detail: `box ${i + 1}, ${side} ${BOX_SIDE_MIN_CM} to ${BOX_SIDE_MAX_CM} cm` })
      }
    }
  })
  return out
}

/** The boxes of a plan (spec 7.2). */
export function boxesForPlan(
  row: Pick<PlanRow, "boxes" | "fulfillment">,
  order: PlanOrder,
  o: { weightUnit: "g" | "kg"; defaultBox: { weightKg: number; lengthCm: number | null; widthCm: number | null; heightCm: number | null } | null },
): { boxes: PlanBox[]; source: BoxesSource; problems: ProblemDto[]; warnings: ProblemDto[] } {
  const problems: ProblemDto[] = []
  const warnings: ProblemDto[] = []
  let boxes: PlanBox[]
  let source: BoxesSource
  if (row.boxes?.edited === true) {
    boxes = row.boxes.items.map((b) => ({ weightKg: b.weightKg, lengthCm: b.lengthCm, widthCm: b.widthCm, heightCm: b.heightCm }))
    source = "edited"
    if (boxes.length === 0) problems.push({ code: "weight_missing" })
    problems.push(...boxProblems(boxes))
  } else {
    const { kg, complete } = variantWeightKg(order, row.fulfillment?.items ?? null, o.weightUnit)
    const sides = { lengthCm: o.defaultBox?.lengthCm ?? null, widthCm: o.defaultBox?.widthCm ?? null, heightCm: o.defaultBox?.heightCm ?? null }
    if (complete) {
      boxes = [{ weightKg: roundKg(kg), ...sides }]
      source = "variants"
    } else if (o.defaultBox) {
      boxes = [{ weightKg: roundKg(Math.max(kg, o.defaultBox.weightKg)), ...sides }]
      source = "default_box"
      warnings.push({ code: "weight_default_box" })
    } else {
      boxes = []
      source = "none"
      problems.push({ code: "weight_missing" })
    }
    problems.push(...boxProblems(boxes))
  }
  const heavy = boxes.findIndex((b) => b.weightKg > COURIER_ORDER_MAX_KG)
  if (heavy >= 0) warnings.push({ code: "courier_over_50kg", field: `boxes[${heavy}].weightKg` })
  return { boxes, source, problems, warnings }
}
