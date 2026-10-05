/**
 * PUBLISHING FROM MEDUSA: WHAT WOULD BE SENT, AND WHAT IS MISSING. Pure.
 *
 * One advert per variant, built from the product and the plugin options:
 *
 *   category       the OLX category mapped to one of the product's Medusa
 *                  categories (option `publish.categories`), or the product
 *                  metadata `olx_category_id`
 *   title          variant metadata `olx_title`, product metadata `olx_title`,
 *                  or the product title (plus the variant title when the
 *                  product has several variants)
 *   description    the product description as plain text, a SKU line (so the
 *                  advert links back even without `external_id`) and the
 *                  footer from the options
 *   external_id    the variant SKU: the key the sync links adverts by, and the
 *                  key of the lookup before every create
 *   price          the variant base price in the market currency
 *   images         the product images with an https URL, up to the category limit
 *   location,
 *   contact        from the options
 *   attributes     the category's attribute definitions from
 *                  `GET /categories/{id}/attributes`, filled from the category
 *                  mapping, the options and the product or variant metadata
 *                  `olx_attributes`, validated before anything is sent
 *
 * A candidate with anything missing is BLOCKED with the list of problems; a
 * candidate with nothing missing is READY and carries the exact body of
 * `POST /adverts`.
 */

import type { ResolvedPublishOptions } from "./options"
import { checkDescription, checkTitle, htmlToText, type Problem } from "./validation"

export type { Problem }

/* ------------------------------------------------------------------ */
/* Category definitions from OLX                                       */
/* ------------------------------------------------------------------ */

export interface AttributeDef {
  code: string
  label: string
  /** `attribute`, `price`, `salary`, or `package` for delivery. */
  type: string
  required: boolean
  numeric: boolean
  min: number | null
  max: number | null
  multiple: boolean
  values: Array<{ code: string; label: string }>
}

export interface CategoryInfo {
  id: number
  name: string
  photosLimit: number | null
  isLeaf: boolean | null
}

function listOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).data)) {
    return (raw as Record<string, unknown>).data as unknown[]
  }
  return []
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** `GET /categories/{id}/attributes`: an array (or `{ data: [...] }`) of definitions. */
export function parseAttributeDefs(raw: unknown): AttributeDef[] {
  const out: AttributeDef[] = []
  for (const item of listOf(raw)) {
    if (!item || typeof item !== "object") continue
    const a = item as Record<string, unknown>
    const code = typeof a.code === "string" ? a.code.trim() : ""
    if (!code) continue
    const v = a.validation && typeof a.validation === "object" ? (a.validation as Record<string, unknown>) : {}
    const values: AttributeDef["values"] = []
    if (Array.isArray(a.values)) {
      for (const x of a.values) {
        if (!x || typeof x !== "object") continue
        const c = String((x as Record<string, unknown>).code ?? "").trim()
        if (c) values.push({ code: c, label: String((x as Record<string, unknown>).label ?? c) })
      }
    }
    out.push({
      code,
      label: typeof a.label === "string" && a.label.trim() ? a.label.trim() : code,
      type: typeof v.type === "string" ? v.type : code === "delivery" ? "package" : "attribute",
      required: v.required === true,
      numeric: v.numeric === true,
      min: numOrNull(v.min),
      max: numOrNull(v.max),
      multiple: v.allow_multiple_values === true,
      values,
    })
  }
  return out
}

/** `GET /categories/{id}`: `{ data: { id, name, parent_id, photos_limit, is_leaf } }` or the object itself. */
export function parseCategory(raw: unknown): CategoryInfo | null {
  let o: unknown = raw
  if (o && typeof o === "object" && (o as Record<string, unknown>).data && typeof (o as Record<string, unknown>).data === "object") {
    o = (o as Record<string, unknown>).data
  }
  if (!o || typeof o !== "object") return null
  const c = o as Record<string, unknown>
  const id = Number(c.id)
  if (!Number.isInteger(id) || id <= 0) return null
  return {
    id,
    name: typeof c.name === "string" ? c.name : String(id),
    photosLimit: numOrNull(c.photos_limit),
    isLeaf: typeof c.is_leaf === "boolean" ? c.is_leaf : null,
  }
}

/* ------------------------------------------------------------------ */
/* Candidates and the plan of one candidate                            */
/* ------------------------------------------------------------------ */

export interface PublishCandidate {
  variantId: string
  productId: string
  sku: string
  productTitle: string
  variantTitle: string | null
  /** Whether the product has more than one variant. */
  multiVariant: boolean
  description: string | null
  /** Image URLs, thumbnail first. */
  images: string[]
  /** Base price in the market currency. */
  price: number | null
  categoryIds: string[]
  categoryHandles: string[]
  /** `olx_title`, `olx_category_id` and `olx_attributes` from product and variant metadata. */
  productMetadata: Record<string, unknown> | null
  variantMetadata: Record<string, unknown> | null
}

export interface CategoryDefinition {
  category: CategoryInfo | null
  attributes: AttributeDef[] | null
  /** Why the definition could not be read. Candidates of this category are blocked. */
  error: string | null
}

export interface PublishContext {
  options: ResolvedPublishOptions
  /** Upper-case market currency, e.g. PLN. */
  currency: string
  /** Label of the SKU line in the description, e.g. "Kod produktu". */
  skuLabel: string
  definitions: ReadonlyMap<number, CategoryDefinition>
}

export interface PublishPlanItem {
  variantId: string
  productId: string
  sku: string
  title: string
  olxCategoryId: number | null
  ready: boolean
  missing: Problem[]
  warnings: Problem[]
  /** The exact body of POST /adverts when ready, otherwise null. */
  payload: Record<string, unknown> | null
}

const DEFAULT_PHOTOS_LIMIT = 8

function meta(m: Record<string, unknown> | null, key: string): unknown {
  return m && typeof m === "object" ? m[key] : undefined
}

function metaAttributes(m: Record<string, unknown> | null): Record<string, string | string[]> {
  let v = meta(m, "olx_attributes")
  if (typeof v === "string") {
    try {
      v = JSON.parse(v)
    } catch {
      return {}
    }
  }
  const out: Record<string, string | string[]> = {}
  if (!v || typeof v !== "object" || Array.isArray(v)) return out
  for (const [code, value] of Object.entries(v as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number") {
      const s = String(value).trim()
      if (s) out[code.trim()] = s
    } else if (Array.isArray(value)) {
      const list = value.map((x) => String(x).trim()).filter(Boolean)
      if (list.length > 0) out[code.trim()] = list
    }
  }
  return out
}

/** Which OLX category a candidate goes to, with the mapping's default attributes. */
export function resolveCategory(
  c: PublishCandidate,
  options: ResolvedPublishOptions,
): { olxCategoryId: number; attributes: Record<string, string | string[]> } | null {
  const override = Number(meta(c.variantMetadata, "olx_category_id") ?? meta(c.productMetadata, "olx_category_id"))
  if (Number.isInteger(override) && override > 0) {
    const mapped = options.categories.find((m) => m.olxCategoryId === override)
    return { olxCategoryId: override, attributes: mapped?.attributes ?? {} }
  }
  for (const m of options.categories) {
    if (c.categoryIds.includes(m.medusaCategory) || c.categoryHandles.includes(m.medusaCategory)) {
      return { olxCategoryId: m.olxCategoryId, attributes: m.attributes }
    }
  }
  return null
}

export function advertTitle(c: PublishCandidate): string {
  const override = meta(c.variantMetadata, "olx_title") ?? meta(c.productMetadata, "olx_title")
  if (typeof override === "string" && override.trim()) return override.trim().replace(/\s+/g, " ")
  const variant = c.multiVariant && c.variantTitle ? ` ${c.variantTitle.trim()}` : ""
  return `${c.productTitle.trim()}${variant}`.replace(/\s+/g, " ")
}

export function advertDescription(c: PublishCandidate, skuLabel: string, footer: string): { full: string; body: string } {
  const body = htmlToText(c.description)
  const parts = [body, `${skuLabel}: ${c.sku}`]
  if (footer.trim()) parts.push(footer.trim())
  return { full: parts.filter(Boolean).join("\n\n"), body }
}

/** Fills and validates the attributes of one category. */
export function buildAttributes(
  defs: readonly AttributeDef[],
  values: Record<string, string | string[]>,
  hasPrice: boolean,
): { attributes: Array<Record<string, unknown>>; missing: Problem[]; warnings: Problem[] } {
  const attributes: Array<Record<string, unknown>> = []
  const missing: Problem[] = []
  const warnings: Problem[] = []
  const known = new Set(defs.map((d) => d.code))
  for (const d of defs) {
    if (d.type === "price") {
      if (d.required && !hasPrice) missing.push({ code: "price" })
      continue
    }
    if (d.type === "salary") {
      if (d.required) missing.push({ code: "salary_category" })
      continue
    }
    if (d.type === "package" || d.code === "delivery") continue
    const raw = values[d.code]
    const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]
    if (list.length === 0) {
      if (d.required) missing.push({ code: "attribute_missing", detail: d.label === d.code ? d.code : `${d.label} (${d.code})` })
      continue
    }
    if (!d.multiple && list.length > 1) {
      missing.push({ code: "attribute_invalid", detail: `${d.code}: one value only` })
      continue
    }
    let invalid: string | null = null
    for (const value of list) {
      if (d.values.length > 0 && !d.values.some((x) => x.code === value)) {
        invalid = `${d.code}: "${value}" is not one of ${d.values.slice(0, 8).map((x) => x.code).join(", ")}${d.values.length > 8 ? ", ..." : ""}`
        break
      }
      if (d.numeric) {
        const n = Number(value.replace(",", "."))
        if (!Number.isFinite(n)) {
          invalid = `${d.code}: "${value}" is not a number`
          break
        }
        if (d.min !== null && n < d.min) {
          invalid = `${d.code}: ${value} is below ${d.min}`
          break
        }
        if (d.max !== null && n > d.max) {
          invalid = `${d.code}: ${value} is above ${d.max}`
          break
        }
      }
    }
    if (invalid) {
      missing.push({ code: "attribute_invalid", detail: invalid })
      continue
    }
    attributes.push(d.multiple ? { code: d.code, values: list } : { code: d.code, value: list[0] })
  }
  for (const code of Object.keys(values)) {
    if (!known.has(code)) warnings.push({ code: "attribute_unknown", detail: code })
  }
  return { attributes, missing, warnings }
}

export function planPublication(c: PublishCandidate, ctx: PublishContext): PublishPlanItem {
  const o = ctx.options
  const missing: Problem[] = []
  const warnings: Problem[] = []
  const title = advertTitle(c)
  const base = { variantId: c.variantId, productId: c.productId, sku: c.sku, title }

  const category = resolveCategory(c, o)
  if (!category) {
    return { ...base, olxCategoryId: null, ready: false, missing: [{ code: "category" }], warnings, payload: null }
  }
  const def = ctx.definitions.get(category.olxCategoryId)
  if (!def || def.error || !def.attributes) {
    missing.push({ code: "category_unavailable", detail: def?.error ?? String(category.olxCategoryId) })
  } else if (def.category && def.category.isLeaf === false) {
    missing.push({ code: "category_not_leaf", detail: String(category.olxCategoryId) })
  }

  if (!o.location) missing.push({ code: "location" })
  if (!o.contact) missing.push({ code: "contact" })
  if (c.price === null) missing.push({ code: "price" })

  missing.push(...checkTitle(title))
  const description = advertDescription(c, ctx.skuLabel, o.descriptionFooter)
  missing.push(...checkDescription(description.full))

  const limit = def?.category?.photosLimit && def.category.photosLimit > 0 ? def.category.photosLimit : DEFAULT_PHOTOS_LIMIT
  const httpsImages = c.images.filter((u) => /^https:\/\//i.test(u))
  if (c.images.length === 0) warnings.push({ code: "images_none" })
  else if (httpsImages.length < c.images.length) warnings.push({ code: "images_not_https", detail: String(c.images.length - httpsImages.length) })
  if (httpsImages.length > limit) warnings.push({ code: "images_trimmed", detail: String(limit) })
  const images = [...new Set(httpsImages)].slice(0, limit)

  const values = { ...o.attributes, ...category.attributes, ...metaAttributes(c.productMetadata), ...metaAttributes(c.variantMetadata) }
  let attributes: Array<Record<string, unknown>> = []
  if (def?.attributes) {
    const built = buildAttributes(def.attributes, values, c.price !== null)
    attributes = built.attributes
    missing.push(...built.missing)
    warnings.push(...built.warnings)
  }

  if (missing.length > 0) {
    return { ...base, olxCategoryId: category.olxCategoryId, ready: false, missing: unique(missing), warnings: unique(warnings), payload: null }
  }

  const location: Record<string, unknown> = { city_id: o.location!.cityId }
  if (o.location!.districtId) location.district_id = o.location!.districtId
  if (o.location!.latitude !== null && o.location!.longitude !== null) {
    location.latitude = o.location!.latitude
    location.longitude = o.location!.longitude
  }
  const contact: Record<string, unknown> = { name: o.contact!.name }
  if (o.contact!.phone) contact.phone = o.contact!.phone

  const payload: Record<string, unknown> = {
    title,
    description: description.full,
    category_id: category.olxCategoryId,
    advertiser_type: o.advertiserType,
    external_id: c.sku,
    contact,
    location,
    images: images.map((url) => ({ url })),
    price: { value: Math.round((c.price as number) * 100) / 100, currency: ctx.currency, negotiable: false },
    attributes,
  }
  return { ...base, olxCategoryId: category.olxCategoryId, ready: true, missing: [], warnings: unique(warnings), payload }
}

function unique(list: readonly Problem[]): Problem[] {
  const seen = new Set<string>()
  return list.filter((p) => {
    const key = `${p.code}\u0000${p.detail ?? ""}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
