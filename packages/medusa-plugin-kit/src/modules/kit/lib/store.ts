import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { KIT_MODULE } from "./constants"
import type { ResolvedKitOptions } from "./options"

/**
 * THE SETTINGS THE TEAM PICKS IN THE ADMIN, over the options: the tags new
 * subscribers get, the double opt-in form, the double opt-in switch. Pure
 * helpers over the container: the routes call them from outside the module.
 */

export type KitSettings = {
  tags: number[]
  form_id: number | null
  double_opt_in: boolean
  /** Extra tags by the source the storefront sends ("drop" -> the drop tag). */
  source_tags: Record<string, number[]>
  /** Tags an EXISTING active subscriber gets after an order (never subscribes anyone). */
  buyer_tags: number[]
  /** Also tag buyers with "<prefix><product title>" (the tag is created in Kit when missing). */
  product_tags: boolean
  /** The prefix of product tags, set in the admin. */
  product_tag_prefix: string
}

export const PRODUCT_TAG_PREFIX = "Bought: "

/** A prefix of at most 40 characters; an empty value falls back to the default. */
export function prefixOf(v: unknown): string {
  const p = typeof v === "string" ? v.replace(/\s+/g, " ").slice(0, 40) : ""
  return p.trim() ? p : PRODUCT_TAG_PREFIX
}

/** Positive integer ids only. */
export function idList(v: unknown): number[] {
  return (Array.isArray(v) ? v : []).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
}

/** A source key: lower case letters, digits, dash and underscore, at most 40 characters. */
export function sourceKey(v: unknown): string | null {
  const k = String(v ?? "").trim().toLowerCase()
  return /^[a-z0-9_-]{1,40}$/.test(k) ? k : null
}

/** A clean { source: tagIds } map; unknown shapes are dropped. */
export function sourceTagsOf(v: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  if (!v || typeof v !== "object" || Array.isArray(v)) return out
  for (const [k, ids] of Object.entries(v as Record<string, unknown>)) {
    const key = sourceKey(k)
    const list = idList(ids)
    if (key && list.length) out[key] = list
  }
  return out
}

/** The tags of one sign-up: the general ones plus the ones of its source, no duplicates. */
export function tagsForSource(settings: Pick<KitSettings, "tags" | "source_tags">, source: string | undefined): number[] {
  const extra = (source && settings.source_tags[source.toLowerCase()]) || []
  return [...new Set([...settings.tags, ...extra])]
}

/** The settings in effect: the options first, the admin settings override. */
export function effectiveSettings(o: ResolvedKitOptions, stored: Partial<KitSettings> | null): KitSettings {
  const s = stored ?? {}
  return {
    tags: Array.isArray(s.tags) ? s.tags : o.tags,
    form_id: typeof s.form_id === "number" ? s.form_id : o.formId,
    double_opt_in: typeof s.double_opt_in === "boolean" ? s.double_opt_in : o.doubleOptIn,
    source_tags: s.source_tags ? sourceTagsOf(s.source_tags) : {},
    buyer_tags: Array.isArray(s.buyer_tags) ? idList(s.buyer_tags) : [],
    product_tags: s.product_tags === true,
    product_tag_prefix: prefixOf(s.product_tag_prefix),
  }
}

export async function readSettings(scope: { resolve: (key: string) => unknown }): Promise<Partial<KitSettings> | null> {
  try {
    const svc = scope.resolve(KIT_MODULE) as any
    const rows = (await svc.listKitSettings({})) ?? []
    if (!Array.isArray(rows) || rows.length === 0) return null
    const out: Partial<KitSettings> = {}
    for (const row of rows) {
      if (row.key === "tags" && Array.isArray(row.value)) out.tags = (row.value as any[]).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
      if (row.key === "form_id" && (row.value === null || typeof row.value === "number")) out.form_id = row.value as number | null
      if (row.key === "double_opt_in" && typeof row.value === "boolean") out.double_opt_in = row.value as boolean
      if (row.key === "source_tags") out.source_tags = sourceTagsOf(row.value)
      if (row.key === "buyer_tags") out.buyer_tags = idList(row.value)
      if (row.key === "product_tags" && typeof row.value === "boolean") out.product_tags = row.value as boolean
      if (row.key === "product_tag_prefix" && typeof row.value === "string") out.product_tag_prefix = row.value
    }
    return out
  } catch {
    return null
  }
}

export async function writeSetting(scope: { resolve: (key: string) => unknown }, key: string, value: unknown): Promise<void> {
  const svc = scope.resolve(KIT_MODULE) as any
  const rows = (await svc.listKitSettings({ key })) ?? []
  if (Array.isArray(rows) && rows.length > 0) {
    await svc.updateKitSettings({ id: rows[0].id, value })
  } else {
    await svc.createKitSettings({ key, value })
  }
}

export function kitService(scope: { resolve: (key: string) => unknown }): any {
  return scope.resolve(KIT_MODULE)
}

export function loggerOf(scope: { resolve: (key: string) => unknown }) {
  return scope.resolve(ContainerRegistrationKeys.LOGGER) as { warn: (m: string) => void; error: (m: string) => void; info: (m: string) => void }
}
