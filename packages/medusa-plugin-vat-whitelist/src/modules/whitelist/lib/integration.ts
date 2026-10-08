import type { CounterDraft, SummaryDraft } from "./kit-routes"

/**
 * VAT Whitelist in the koda.integration/1 contract, as pure functions over
 * the plugin's own rows: one line per customer whose company was checked,
 * and the board counters. Nothing comes from order or cart metadata.
 */

/** A whitelist_entity row as the summary needs it. */
export interface EntityRow {
  id: string
  nip: string
  state: string
  name: string | null
  customer_id: string | null
}

/** The line of one customer from their counterparty. Undefined when unchecked or unlinked. */
export function customerSummary(id: string, entity: EntityRow | undefined): SummaryDraft | undefined {
  if (!entity) return undefined
  const name = entity.name || entity.nip
  const links = [{ kind: "admin" as const, href: "/whitelist" }]
  switch (entity.state) {
    case "active":
      return { state: "ok", title: { key: "integration.customer.active", params: { name } }, links }
    case "exempt":
      return { state: "attention", title: { key: "integration.customer.exempt", params: { name } }, links }
    case "not_found":
    case "invalid":
      return { state: "failed", title: { key: "integration.customer.failed", params: { name } }, links }
    case "unavailable":
      return { state: "unavailable", title: { key: "integration.customer.unavailable", params: { name } }, links }
    default:
      return undefined
  }
}

/** The counts behind the board counter: linked counterparties that need a look. */
export function whitelistCounters(c: { unverified: number }): CounterDraft[] {
  return [
    {
      key: "unverified",
      scope: "customers",
      count: c.unverified,
      tone: "orange",
      link: { kind: "admin", href: "/whitelist" },
      entity: "customer",
    },
  ]
}
