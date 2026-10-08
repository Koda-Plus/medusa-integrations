import type { CounterDraft, SummaryDraft } from "./kit-routes"

/**
 * EU Compliance in the koda.integration/1 contract, as pure functions over
 * the plugin's own rows (testable without a database): one line per product
 * with its GPSR record and per customer with data requests, and the board
 * counters. Nothing comes from order, cart or customer metadata.
 */

export const DSR_OPEN = ["pending", "in_progress"] as const
export const DSR_TYPES = ["access", "erasure", "portability", "restriction", "objection", "rectification"] as const

/** A compliance_product row as the summary needs it. */
export interface ProductRecord {
  product_id: string
  complete: boolean
  manufacturer_id: string | null
  responsible_person_id: string | null
}

/** A compliance_dsr row as the summary needs it. */
export interface DsrRow {
  customer_id: string
  type: string
  status: string
  created_at: string | Date | null
}

/** The line of one product from its GPSR record. Undefined when the product has no record. */
export function productSummary(id: string, record: ProductRecord | undefined, names: { manufacturer: string | null; responsible: string | null }): SummaryDraft | undefined {
  if (!record) return undefined
  if (record.complete) {
    const detail = names.manufacturer
      ? { key: "integration.product.manufacturer", params: { name: names.manufacturer } }
      : names.responsible
        ? { key: "integration.product.responsible", params: { name: names.responsible } }
        : undefined
    return {
      state: "ok",
      title: { key: "integration.product.complete" },
      ...(detail ? { detail } : {}),
      links: [{ kind: "admin", href: "/compliance" }],
    }
  }
  return {
    state: "attention",
    title: { key: "integration.product.incomplete" },
    detail: record.manufacturer_id ? { key: "integration.product.missingResponsible" } : { key: "integration.product.missingManufacturer" },
    links: [{ kind: "admin", href: "/compliance" }],
  }
}

/** The line of one customer from their data requests. Undefined without any. */
export function customerSummary(id: string, rows: DsrRow[]): SummaryDraft | undefined {
  if (rows.length === 0) return undefined
  const open = rows.filter((r) => (DSR_OPEN as readonly string[]).includes(r.status))
  const latest = [...rows].sort((a, b) => time(b.created_at) - time(a.created_at))[0]
  const detail =
    latest && (DSR_TYPES as readonly string[]).includes(latest.type) ? { key: `integration.customer.type.${latest.type}` } : undefined
  const links = [{ kind: "admin" as const, href: "/compliance" }]
  if (open.length > 0) {
    return { state: "attention", title: { key: "integration.customer.open", params: { count: open.length } }, ...(detail ? { detail } : {}), links }
  }
  return { state: "ok", title: { key: "integration.customer.done", params: { count: rows.length } }, ...(detail ? { detail } : {}), links }
}

function time(v: string | Date | null): number {
  return v ? new Date(v).getTime() : 0
}

/** The counts behind the board counters. */
export interface AttentionCounts {
  productsIncomplete: number
  dsrOpen: number
}

/** Board counters, each linking to the Compliance page. */
export function complianceCounters(c: AttentionCounts): CounterDraft[] {
  return [
    {
      key: "products_incomplete",
      scope: "products",
      count: c.productsIncomplete,
      tone: "orange",
      link: { kind: "admin", href: "/compliance" },
      entity: "product",
    },
    {
      key: "dsr_open",
      scope: "customers",
      count: c.dsrOpen,
      tone: "orange",
      link: { kind: "admin", href: "/compliance" },
      entity: "customer",
    },
  ]
}
