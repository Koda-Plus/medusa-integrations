import type { CounterDraft, SummaryDraft } from "./kit-routes"

/**
 * Packaging in the koda.integration/1 contract, as pure functions over the
 * plugin's own rows: one line per product with its ladder, and the board
 * counter of products without one.
 */

/** What the summary needs of a product's packaging. */
export interface PackagingRow {
  moq: number
  step: number
  units: Array<{ name: string; pieces: number }>
}

/** The line of one product from its packaging. Undefined without a ladder. */
export function productSummary(id: string, packaging: PackagingRow | undefined): SummaryDraft | undefined {
  if (!packaging || packaging.units.length === 0) return undefined
  const biggest = [...packaging.units].sort((a, b) => b.pieces - a.pieces)[0]
  const line = packaging.units
    .slice()
    .sort((a, b) => a.pieces - b.pieces)
    .map((u) => `${u.name} ${u.pieces}`)
    .join(" / ")
  const links = [{ kind: "admin" as const, href: "/packaging" }]
  const facts = packaging.moq > 0 ? { key: "integration.product.moq", params: { moq: packaging.moq, step: packaging.step > 0 ? packaging.step : packaging.moq } } : undefined
  return {
    state: "ok",
    title: { key: "integration.product.ladder", params: { line } },
    ...(facts ? { detail: facts } : {}),
    links,
    counts: { biggest: biggest.pieces },
  }
}

/** The board counter: products without a ladder. */
export function packagingCounters(c: { without: number }): CounterDraft[] {
  return [
    {
      key: "without_ladder",
      scope: "products",
      count: c.without,
      tone: "orange",
      link: { kind: "admin", href: "/packaging" },
      entity: "product",
    },
  ]
}
