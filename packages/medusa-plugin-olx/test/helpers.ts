/**
 * Test doubles shared by the flow tests (not a test itself: the runner picks
 * up `*.test.ts` only).
 *
 *   memoryPlanStore         the atomic plan store with the SAME rules as the
 *                           SQL one: claim only from pending or failed, finish
 *                           only for the claim's owner, transitions only from
 *                           the given states, expired leases to unknown
 *   memoryPublicationStore  the same plus the unique row per variant and the
 *                           delete of unsent rows only
 */
import { PLAN_CLAIMABLE, PUBLICATION_CLAIMABLE, PUBLICATION_UNSENT, type NewPublication, type PlanItemStore, type PublicationStore } from "../src/modules/olx/lib/store.ts"

export type Row = Record<string, any>

function storeOver(rows: Map<string, Row>, claimable: readonly string[], inFlight: string): PlanItemStore {
  return {
    async claim(id, args) {
      const r = rows.get(id)
      if (!r || !claimable.includes(r.state)) return null
      Object.assign(r, { state: inFlight, claim_token: args.token, lease_until: args.leaseUntil, last_attempt_at: args.now })
      return { ...r }
    },
    async finish(id, token, patch) {
      const r = rows.get(id)
      if (!r || r.state !== inFlight || r.claim_token !== token) return false
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) r[k] = v
      r.claim_token = null
      r.lease_until = null
      return true
    },
    async transition(id, from, patch) {
      const r = rows.get(id)
      if (!r || !from.includes(r.state)) return null
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) r[k] = v
      return { ...r }
    },
    async expireLeases(now, demo) {
      let n = 0
      for (const r of rows.values()) {
        if (r.state === inFlight && r.lease_until && new Date(r.lease_until).getTime() < now.getTime() && Boolean(r.demo) === demo) {
          Object.assign(r, { state: "unknown", claim_token: null, lease_until: null, unknown_since: now })
          n += 1
        }
      }
      return n
    },
  }
}

export function memoryPlanStore(rows: Map<string, Row>): PlanItemStore {
  return storeOver(rows, PLAN_CLAIMABLE, "applying")
}

export function memoryPublicationStore(rows: Map<string, Row>): PublicationStore {
  let seq = 0
  return {
    ...storeOver(rows, PUBLICATION_CLAIMABLE, "publishing"),
    async insertIgnore(row: NewPublication) {
      for (const r of rows.values()) if (r.variant_id === row.variant_id && Boolean(r.demo) === row.demo) return null
      seq += 1
      const created = { id: `olxpub_${seq}`, attempts: 0, adopted: false, ...row }
      rows.set(created.id, created)
      return { ...created }
    },
    async deleteUnsent(ids) {
      let n = 0
      for (const id of ids) {
        const r = rows.get(id)
        if (r && PUBLICATION_UNSENT.includes(r.state)) {
          rows.delete(id)
          n += 1
        }
      }
      return n
    },
  }
}

export function planRow(over: Row): Row {
  return {
    id: over.id ?? `olxpi_${over.olx_id}`,
    writer: "lifecycle",
    action: "deactivate",
    reason: "sold_out",
    from_value: "active",
    to_value: "removed_by_user",
    approved_value: null,
    state: "pending",
    attempts: 0,
    last_error: null,
    note: null,
    planned_at: new Date("2026-10-05T10:00:00Z"),
    paused_at: null,
    unknown_since: null,
    claim_token: null,
    lease_until: null,
    title: "Advert",
    variant_id: "variant_1",
    product_id: "prod_1",
    sku: "SKU-1",
    demo: false,
    ...over,
  }
}

export const clock = {
  now: () => new Date("2026-10-06T12:00:00Z"),
  newToken: (() => {
    let n = 0
    return () => `token-${++n}`
  })(),
}
