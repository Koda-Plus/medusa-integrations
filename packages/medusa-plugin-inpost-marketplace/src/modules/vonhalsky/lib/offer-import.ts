/**
 * IMPORTING THE OFFERS ALREADY ON THE MARKETPLACE: the pure part, which
 * marketplace offer belongs to which offer row (one row per Medusa variant).
 *
 *   refresh    the offer is linked already (a row has its id): its state is read again
 *   link       a row matches it: by the external id (this plugin sends the
 *              variant id), then the SKU, then the EAN, then the
 *              manufacturer part number, each only when exactly one row
 *              matches; the first key that matches anything decides
 *   unmatched  nothing matches (no_match), more rows match the deciding key
 *              (ambiguous), or the matching row follows another offer
 *              already (taken). Reported to the person, never invented.
 *
 * A row may be linked once: a second marketplace offer for the same variant
 * is reported as taken, so two offers never share one row.
 */

import type { UnmatchedOfferDto } from "./contract"
import { normalizeEan } from "./eligibility"
import type { RemoteOffer } from "./remote"

export interface ImportRow {
  id: string
  variant_id: string
  sku?: string | null
  ean?: string | null
  mpn?: string | null
  remote_id?: string | null
}

export type MatchKey = "external_id" | "sku" | "ean" | "mpn"

export interface ImportPlan {
  refresh: Array<{ rowId: string; remote: RemoteOffer }>
  link: Array<{ rowId: string; remote: RemoteOffer; by: MatchKey }>
  unmatched: UnmatchedOfferDto[]
}

const textKey = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null)
const eanKey = (v: unknown): string | null => {
  const s = normalizeEan(v)
  return s && /^\d+$/.test(s) ? s.replace(/^0+(?=\d{8})/, "") : null
}

function index(rows: readonly ImportRow[], key: (r: ImportRow) => string | null): Map<string, ImportRow[]> {
  const out = new Map<string, ImportRow[]>()
  for (const r of rows) {
    const k = key(r)
    if (!k) continue
    const list = out.get(k) ?? []
    list.push(r)
    out.set(k, list)
  }
  return out
}

export function importPlan(remote: readonly RemoteOffer[], rows: readonly ImportRow[]): ImportPlan {
  const plan: ImportPlan = { refresh: [], link: [], unmatched: [] }
  const byRemote = new Map(rows.filter((r) => r.remote_id).map((r) => [String(r.remote_id), r]))
  const keys: Array<{ by: MatchKey; rows: Map<string, ImportRow[]>; of: (o: RemoteOffer) => string | null }> = [
    { by: "external_id", rows: index(rows, (r) => r.variant_id || null), of: (o) => o.externalId },
    { by: "sku", rows: index(rows, (r) => textKey(r.sku)), of: (o) => textKey(o.sku) },
    { by: "ean", rows: index(rows, (r) => eanKey(r.ean)), of: (o) => eanKey(o.ean) },
    { by: "mpn", rows: index(rows, (r) => textKey(r.mpn)), of: (o) => textKey(o.mpn) },
  ]
  const claimed = new Set<string>()
  const report = (o: RemoteOffer, reason: UnmatchedOfferDto["reason"]) => plan.unmatched.push({ id: o.id, name: o.name, sku: o.sku, ean: o.ean, status: o.status, reason })
  for (const o of remote) {
    const known = byRemote.get(o.id)
    if (known) {
      plan.refresh.push({ rowId: known.id, remote: o })
      continue
    }
    let decided: { by: MatchKey; rows: ImportRow[] } | null = null
    for (const k of keys) {
      const value = k.of(o)
      const hits = value ? k.rows.get(value) ?? [] : []
      if (hits.length) {
        decided = { by: k.by, rows: hits }
        break
      }
    }
    if (!decided) report(o, "no_match")
    else if (decided.rows.length > 1) report(o, "ambiguous")
    else {
      const row = decided.rows[0]
      if ((row.remote_id && row.remote_id !== o.id) || claimed.has(row.id)) report(o, "taken")
      else {
        claimed.add(row.id)
        plan.link.push({ rowId: row.id, remote: o, by: decided.by })
      }
    }
  }
  return plan
}
