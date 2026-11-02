/**
 * AN ORDER IN SUBIEKT AGAINST THE PLUGIN TABLES (0.3.0). Pure, tested.
 *
 * `GET /v1/orders/{id}` lists every document the bridge knows for an order,
 * with its status (`open`, `completed`: realized in Subiekt, `canceled`). The
 * plugin may miss one of them: the answer of a create was lost, a person
 * issued the ZK by hand, the event feed was reset. Each document gets a state:
 *
 * - `missing`: in Subiekt, not in the plugin. "Link" records it, so nothing
 *   issues a second one.
 * - `status_differs`: in both, Subiekt says another status (for example the
 *   ZK was realized or canceled there). "Update" records the new status.
 * - `same`: in both, same status.
 * - `only_local`: in the plugin, the bridge does not report it (deleted in
 *   Subiekt, or another database). Shown, never changed automatically.
 */

import type { ContractDocument } from "./contract"

export type ReconcileState = "missing" | "status_differs" | "same" | "only_local"

export interface LocalDocument {
  kind: string
  number: string
  status: string | null
}

export interface ReconcileEntry {
  kind: string
  number: string
  state: ReconcileState
  /** What the bridge says; null for `only_local`. */
  remoteStatus: string | null
  /** What the plugin stored; null for `missing`. */
  localStatus: string | null
  issuedAt: string | null
  ksefNumber: string | null
}

const key = (kind: string, number: string) => `${kind.trim().toUpperCase()}|${number.trim()}`

/** Bridge documents first (in its order, oldest first), then the plugin's own that the bridge does not report. */
export function compareOrderDocuments(local: readonly LocalDocument[], remote: readonly ContractDocument[]): ReconcileEntry[] {
  const mine = new Map(local.map((d) => [key(d.kind, d.number), d]))
  const out: ReconcileEntry[] = []
  const seen = new Set<string>()
  for (const d of remote) {
    if (!d?.kind || !d?.number) continue
    const k = key(d.kind, d.number)
    if (seen.has(k)) continue
    seen.add(k)
    const remoteStatus = d.status ?? "open"
    const stored = mine.get(k)
    out.push({
      kind: d.kind,
      number: d.number,
      state: !stored ? "missing" : (stored.status ?? "open") === remoteStatus ? "same" : "status_differs",
      remoteStatus,
      localStatus: stored ? stored.status ?? "open" : null,
      issuedAt: d.issued_at ?? null,
      ksefNumber: d.ksef_number ?? null,
    })
  }
  for (const d of local) {
    const k = key(d.kind, d.number)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ kind: d.kind, number: d.number, state: "only_local", remoteStatus: null, localStatus: d.status ?? "open", issuedAt: null, ksefNumber: null })
  }
  return out
}

/** Whether "Link" or "Update" applies to an entry. */
export function linkable(entry: Pick<ReconcileEntry, "state">): boolean {
  return entry.state === "missing" || entry.state === "status_differs"
}

/** The document a person asked to link, from a fresh bridge answer (never from the request body). */
export function findRemoteDocument(remote: readonly ContractDocument[], kind: string, number: string): ContractDocument | null {
  const k = key(kind, number)
  return remote.find((d) => d?.kind && d?.number && key(d.kind, d.number) === k) ?? null
}

/**
 * The queue task a linked document settles: a ZK settles `order.create`, an
 * FS or PA settles `order.document`. Only a task that has not produced it yet
 * and is not being sent right now; a canceled task stays canceled.
 */
export function taskSettledBy(kind: string): "order.create" | "order.document" | null {
  const k = kind.trim().toUpperCase()
  if (k === "ZK") return "order.create"
  if (k === "FS" || k === "PA") return "order.document"
  return null
}

export function settleableStatus(status: string): boolean {
  return status === "waiting" || status === "pending" || status === "unknown" || status === "failed"
}
