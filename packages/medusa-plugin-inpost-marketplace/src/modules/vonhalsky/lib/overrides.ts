/**
 * WHAT A PERSON CHANGED ON ONE OFFER, beside what Medusa says: the name, the
 * description, the photos (replaced, removed, added, reordered), the package
 * dimensions and weight, the days to ship. Kept on the row (`overrides`) and
 * applied over the Medusa facts EVERYWHERE the facts count: the checks that
 * block a listing, the proposal sent to the marketplace, the offers list.
 * A field left out follows Medusa; a field set to null in an edit goes back
 * to Medusa's value.
 *
 * The values are checked against the marketplace's own rules before they are
 * kept, so an override can never be the reason an offer is refused: a name
 * of 7 to 150 characters with two words, a description of at least 100
 * characters of text, photos over https in a format the marketplace takes,
 * all four package numbers within the parcel limits, 0 to 60 days to ship.
 */

import { DESCRIPTION_MIN, TITLE_MAX, TITLE_MIN, fitsPackage, titleValid, type VariantFacts } from "./eligibility"
import { plainText } from "./offer-payload"

export interface OfferDimension {
  /** Millimetres. */
  length: number
  width: number
  height: number
  /** Grams. */
  weight: number
}

export interface OfferOverrides {
  title?: string
  description?: string
  /** Image URLs; the order is the priority on the marketplace (the first is the main photo). */
  images?: string[]
  dimension?: OfferDimension
  daysToShip?: number
}

export const OVERRIDE_FIELDS = ["title", "description", "images", "dimension", "daysToShip"] as const
export type OverrideField = (typeof OVERRIDE_FIELDS)[number]

/** The marketplace's limits: 20 photos, a description the API takes, a sane parcel weight. */
export const IMAGES_MAX = 20
export const DESCRIPTION_MAX = 100_000
export const WEIGHT_MAX_G = 1_000_000

/**
 * Picture formats the marketplace refuses (UC9, accepted IMAGE types: JPEG,
 * PNG, GIF, WebP). A URL with one of these extensions is left out instead of
 * failing the whole offer; a URL without an extension is sent as it is.
 */
const REFUSED_IMAGE = /\.(avif|heic|heif|svg|tiff?|bmp|ico|jxl)(?:[?#].*)?$/i

/** Whether the marketplace takes a picture of this URL (by its extension). */
export function imageAccepted(url: string): boolean {
  return !REFUSED_IMAGE.test(url)
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v)
const posInt = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= max ? v : null)

function imageUrl(v: unknown): string | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  if (s.length > 2000 || !/^https:\/\/[^\s]+$/i.test(s)) return null
  try {
    new URL(s)
  } catch {
    return null
  }
  return imageAccepted(s) ? s : null
}

function dimensionOf(v: unknown): OfferDimension | null {
  if (!isObj(v)) return null
  const d = { length: posInt(v.length, 1200), width: posInt(v.width, 1200), height: posInt(v.height, 1200), weight: posInt(v.weight, WEIGHT_MAX_G) }
  if (d.length === null || d.width === null || d.height === null || d.weight === null) return null
  const out = d as OfferDimension
  return fitsPackage(out) ? out : null
}

/**
 * The overrides kept on a row, read leniently: anything that does not pass
 * the rules (a row written by an older version, a hand edit) is dropped, so a
 * bad value falls back to Medusa's instead of being sent.
 */
export function overridesOf(v: unknown): OfferOverrides {
  if (!isObj(v)) return {}
  const out: OfferOverrides = {}
  if (typeof v.title === "string" && titleValid(v.title)) out.title = v.title.trim()
  if (typeof v.description === "string" && v.description.trim()) out.description = v.description.slice(0, DESCRIPTION_MAX)
  if (Array.isArray(v.images)) {
    const list = [...new Set(v.images.map(imageUrl).filter((x): x is string => Boolean(x)))].slice(0, IMAGES_MAX)
    if (list.length) out.images = list
  }
  const dim = dimensionOf(v.dimension)
  if (dim) out.dimension = dim
  if (typeof v.daysToShip === "number" && Number.isInteger(v.daysToShip) && v.daysToShip >= 0 && v.daysToShip <= 60) out.daysToShip = v.daysToShip
  return out
}

/** The fields a person set, in the order of the form. */
export function overriddenFields(o: OfferOverrides): OverrideField[] {
  return OVERRIDE_FIELDS.filter((f) => o[f] !== undefined)
}

export type EditRefusal = { field: OverrideField | null; code: string; message: string }
export type OverridesPatch = { set: OfferOverrides; clear: OverrideField[] }

/**
 * An edit as the admin sends it: `{ title?, description?, images?, dimension?,
 * daysToShip? }`, a key left out stays as it is, null goes back to Medusa.
 * Every value is checked here; the first one that breaks a rule is refused
 * with a stable code the admin can show next to the field.
 */
export function parseOverridesPatch(input: unknown): OverridesPatch | EditRefusal {
  if (!isObj(input)) return { field: null, code: "invalid_overrides", message: "Send overrides as an object: { title, description, images, dimension, daysToShip }." }
  const set: OfferOverrides = {}
  const clear: OverrideField[] = []
  const unknown = Object.keys(input).filter((k) => !(OVERRIDE_FIELDS as readonly string[]).includes(k))
  if (unknown.length) return { field: null, code: "unknown_field", message: `Not a field of an offer edit: ${unknown.slice(0, 5).join(", ")}.` }
  for (const field of OVERRIDE_FIELDS) {
    if (!(field in input)) continue
    const v = input[field]
    if (v === null) {
      clear.push(field)
      continue
    }
    switch (field) {
      case "title": {
        if (typeof v !== "string" || !titleValid(v)) return { field, code: "title_invalid", message: `The name needs ${TITLE_MIN} to ${TITLE_MAX} characters and at least two words.` }
        set.title = v.trim()
        break
      }
      case "description": {
        if (typeof v !== "string" || v.length > DESCRIPTION_MAX) return { field, code: "description_invalid", message: "The description is text of at most 100 000 characters." }
        if ([...plainText(v).trim()].length < DESCRIPTION_MIN) return { field, code: "description_short", message: `The description needs at least ${DESCRIPTION_MIN} characters of text.` }
        set.description = v
        break
      }
      case "images": {
        if (!Array.isArray(v) || v.length === 0) return { field, code: "images_empty", message: "An offer needs at least one photo: send null to use Medusa's photos." }
        if (v.length > IMAGES_MAX) return { field, code: "images_too_many", message: `At most ${IMAGES_MAX} photos.` }
        const urls = v.map(imageUrl)
        const bad = v.find((_x, i) => !urls[i])
        if (bad !== undefined) return { field, code: "image_invalid", message: `Not a photo the marketplace takes (https, JPEG, PNG, GIF or WebP): ${String(bad).slice(0, 200)}` }
        set.images = [...new Set(urls as string[])]
        break
      }
      case "dimension": {
        if (!isObj(v)) return { field, code: "dimension_invalid", message: "Give length, width and height in mm and the weight in g, all four." }
        const sides = [v.length, v.width, v.height]
        if (!sides.every((x) => posInt(x, 100_000) !== null) || posInt(v.weight, WEIGHT_MAX_G) === null) {
          return { field, code: "dimension_invalid", message: "Length, width and height (mm) and the weight (g) are whole numbers above 0, all four." }
        }
        const d = dimensionOf(v)
        if (!d) return { field, code: "too_large", message: "Too large for a parcel: each side at most 1200 mm, the three together at most 2200 mm." }
        set.dimension = d
        break
      }
      case "daysToShip": {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 60) return { field, code: "days_invalid", message: "Days to ship is a whole number from 0 to 60." }
        set.daysToShip = v
        break
      }
    }
  }
  if (!clear.length && !Object.keys(set).length) return { field: null, code: "nothing_to_change", message: "Nothing to change: send at least one field (null goes back to Medusa)." }
  return { set, clear }
}

export function isRefusal(v: OverridesPatch | EditRefusal): v is EditRefusal {
  return "code" in v
}

/** The overrides after an edit, or null when nothing is overridden any more (the column stays clean). */
export function mergeOverrides(current: unknown, patch: OverridesPatch): OfferOverrides | null {
  const next: OfferOverrides = { ...overridesOf(current), ...patch.set }
  for (const f of patch.clear) delete next[f]
  return overriddenFields(next).length ? next : null
}

/** The facts the marketplace gets: an override wins over what Medusa says. */
export function applyOverrides<T extends Pick<VariantFacts, "title" | "description" | "images" | "dimension">>(facts: T, o: OfferOverrides): T {
  return {
    ...facts,
    ...(o.title !== undefined ? { title: o.title } : {}),
    ...(o.description !== undefined ? { description: o.description } : {}),
    ...(o.images !== undefined ? { images: o.images } : {}),
    ...(o.dimension !== undefined ? { dimension: { width: o.dimension.width, height: o.dimension.height, length: o.dimension.length, weight: o.dimension.weight } } : {}),
  }
}

/** The days to ship of one offer: its override, else the offer defaults. */
export function daysToShipOf(o: OfferOverrides, fallback: number): number {
  return o.daysToShip ?? fallback
}
