/**
 * Links to Medusa records: how they are read and named. Pure, tested with
 * `node --test`.
 *
 * A link stores only the record's type and id. Its label is read from
 * Medusa (through Query) whenever a task is shown, so nothing is copied:
 * a renamed product shows its new title, an anonymized customer their new
 * data, a deleted record "not found".
 */

import { LINK_ADMIN_PATH, type LinkType } from "./constants"

/** What Query is asked for each type. */
export const LINK_QUERY: Record<LinkType, { entity: string; fields: string[] }> = {
  order: { entity: "order", fields: ["id", "display_id"] },
  product: { entity: "product", fields: ["id", "title"] },
  customer: { entity: "customer", fields: ["id", "email", "first_name", "last_name", "company_name"] },
}

export type LinkRecord = {
  id: string
  display_id?: number | string | null
  title?: string | null
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  company_name?: string | null
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

/** "#1042" for an order, the title of a product, the company, name or e-mail of a customer. */
export function linkLabel(type: LinkType, record: LinkRecord | null | undefined): string | null {
  if (!record) return null
  if (type === "order") {
    const n = record.display_id
    return n !== null && n !== undefined && String(n).trim() !== "" ? `#${n}` : null
  }
  if (type === "product") return text(record.title)
  const name = [text(record.first_name), text(record.last_name)].filter(Boolean).join(" ")
  return text(record.company_name) ?? (name || null) ?? text(record.email)
}

/** The record's page in the admin, as a router path. */
export function linkPath(type: LinkType, id: string): string {
  return `${LINK_ADMIN_PATH[type]}/${encodeURIComponent(id)}`
}
