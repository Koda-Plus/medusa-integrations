/**
 * THE BRAND (`Marka`) OF A PRODUCT, from the source in the options. Pure,
 * zero runtime imports. The product metadata is set by the admin, so it may
 * be read; order and cart metadata never are (repo rule).
 */

import type { ResolvedFeedOptions } from "./options"

export interface BrandInput {
  metadata?: Record<string, unknown> | null
  type?: { value?: string | null } | null
  collection?: { title?: string | null } | null
  tags?: Array<{ value?: string | null } | null> | null
}

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

export function brandOf(p: BrandInput, brand: ResolvedFeedOptions["brand"]): string | null {
  if (!brand) return null
  if (brand.from === "type") return s(p.type?.value)
  if (brand.from === "collection") return s(p.collection?.title)
  if (brand.from === "tag") {
    const prefix = (brand.key ?? "").toLowerCase()
    for (const t of p.tags ?? []) {
      const value = s(t?.value)
      const rest = value && value.toLowerCase().startsWith(prefix) ? s(value.slice(prefix.length)) : null
      if (rest) return rest
    }
    return null
  }
  const raw = p.metadata && typeof p.metadata === "object" ? p.metadata[brand.key ?? "brand"] : null
  return s(raw)
}
