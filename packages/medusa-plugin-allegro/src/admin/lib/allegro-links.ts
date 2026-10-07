import type { AllegroImportFilter, AllegroIssueFilter, AllegroOfferFilter, AllegroOrderFilter } from "../../modules/allegro/lib/contract"

/**
 * DEEP LINKS INTO THE ALLEGRO PAGE: `?filter=` picks a list and its filter,
 * `?q=` searches in it, `?list=` names the list when a filter alone would be
 * ambiguous. Board counters, record summaries and cards link here:
 *
 *   /allegro?filter=held                 imports held (Settings, Imports)
 *   /allegro?filter=attention&q=<form>   an import that needs a person
 *   /allegro?filter=stock                offers with stock problems
 *   /allegro?filter=issues               open returns and disputes
 *   /allegro?filter=all&q=<SKU>          the offers of a product
 *
 * Pure, so the mapping is tested without a browser.
 */

export type DeepLink =
  | { list: "offers"; filter: AllegroOfferFilter; q: string }
  | { list: "orders"; filter: AllegroOrderFilter; q: string }
  | { list: "imports"; filter: AllegroImportFilter; q: string }
  | { list: "issues"; filter: AllegroIssueFilter; q: string }

const OFFERS: readonly AllegroOfferFilter[] = ["all", "linked", "unmatched", "stock", "ended_in_stock", "ended", "drafts", "nokey"]
const ORDERS: readonly AllegroOrderFilter[] = ["all", "open", "sent", "cancelled", "unmatched", "imported", "held"]
const IMPORTS: readonly AllegroImportFilter[] = ["all", "imported", "held", "pending", "skipped", "attention", "cancelled"]
const ISSUES: readonly AllegroIssueFilter[] = ["all", "open", "needs_reply", "returns", "disputes", "claims"]

const pick = <T extends string>(list: readonly T[], value: string, fallback: T): T => ((list as readonly string[]).includes(value) ? (value as T) : fallback)

export function deepLinkOf(params: { get(name: string): string | null }): DeepLink | null {
  const list = (params.get("list") ?? "").trim()
  const filter = (params.get("filter") ?? "").trim()
  const q = (params.get("q") ?? "").trim().slice(0, 80)
  if (!list && !filter && !q) return null
  switch (list) {
    case "offers":
      return { list, filter: pick(OFFERS, filter, "all"), q }
    case "orders":
      return { list, filter: pick(ORDERS, filter, "all"), q }
    case "imports":
      return { list, filter: pick(IMPORTS, filter, "all"), q }
    case "issues":
      return { list, filter: pick(ISSUES, filter === "issues" ? "open" : filter, "open"), q: "" }
  }
  if (filter === "issues") return { list: "issues", filter: "open", q: "" }
  if (filter === "needs_reply" || filter === "returns" || filter === "disputes" || filter === "claims") return { list: "issues", filter, q: "" }
  if (filter === "held" || filter === "attention" || filter === "pending" || filter === "skipped" || filter === "imported" || filter === "cancelled") {
    return { list: "imports", filter, q }
  }
  if (filter === "open" || filter === "sent") return { list: "orders", filter, q }
  return { list: "offers", filter: pick(OFFERS, filter, "all"), q }
}
