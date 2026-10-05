/**
 * WRITERS: every write added in 0.2.0 has two switches.
 *
 *   1. The option (hard switch) in medusa-config.ts. False wins and the admin
 *      cannot override it: a developer can always switch a writer off for good.
 *   2. The toggle a person flips in the admin, stored in `subiekt_writer` with
 *      who and when. Off until someone arms it.
 *
 * A writer works only when both say yes AND the bridge can do it (its
 * capability). Stock writing predates this and keeps its own `stockDryRun`.
 *
 * Pure, tested.
 */

import type { WriterDto, WriterKey } from "./contract"
import type { ResolvedSubiektOptions } from "./options"

export const WRITER_KEYS: readonly WriterKey[] = ["prices", "products", "documents", "contractors"]

export const WRITER_OPTIONS: Record<WriterKey, string> = {
  prices: "priceWriter",
  products: "createMissingProducts",
  documents: "salesDocument",
  contractors: "createContractors",
}

export function isWriterKey(value: unknown): value is WriterKey {
  return typeof value === "string" && (WRITER_KEYS as readonly string[]).includes(value)
}

/** The hard switch: what the option allows. */
export function writerAllowed(key: WriterKey, o: Pick<ResolvedSubiektOptions, "priceWriter" | "createMissingProducts" | "salesDocument" | "createContractors" | "priceTarget" | "priceListId">): boolean {
  switch (key) {
    case "prices":
      return o.priceWriter && (o.priceTarget === "variant" || /^plist_/.test(o.priceListId))
    case "products":
      return o.createMissingProducts
    case "documents":
      return o.salesDocument !== "none"
    case "contractors":
      return o.createContractors
  }
}

/** Can the bridge do what the writer needs? */
export function writerSupported(key: WriterKey, salesDocument: ResolvedSubiektOptions["salesDocument"], capabilities: readonly string[]): boolean {
  const has = (c: string) => capabilities.includes(c)
  switch (key) {
    case "prices":
    case "products":
      return has("products")
    case "contractors":
      return has("contractors.create")
    case "documents":
      if (salesDocument === "fs") return has("documents.fs")
      if (salesDocument === "pa") return has("documents.pa")
      return has("documents.fs") || has("documents.pa")
  }
}

export interface WriterRow {
  key: string
  armed: boolean
  changed_by: string | null
  changed_at: Date | string | null
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function describeWriters(o: ResolvedSubiektOptions, rows: readonly WriterRow[], capabilities: readonly string[]): WriterDto[] {
  return WRITER_KEYS.map((key) => {
    const row = rows.find((r) => r.key === key)
    const allowed = writerAllowed(key, o)
    const armed = Boolean(row?.armed)
    const supported = writerSupported(key, o.salesDocument, capabilities)
    return {
      key,
      option: WRITER_OPTIONS[key],
      allowed,
      armed,
      active: allowed && armed && supported,
      unsupported: !supported,
      changedBy: row?.changed_by ?? null,
      changedAt: iso(row?.changed_at),
    }
  })
}
