/**
 * THE SETUP GUIDE, LIVE. Which steps of the guide are done and which ticks of
 * the go-live checklist are set, read from the status the admin page already
 * loads. Pure, tested: the admin renders these, it never decides them.
 */

import type { SubiektStatusResponse } from "./contract"
import { skewLevel } from "./diagnostics"

export type GuideStepId =
  | "subiekt"
  | "sdk"
  | "service"
  | "tunnel"
  | "access"
  | "medusa"
  | "connection"
  | "catalog"
  | "testOrder"
  | "documents"
  | "prices"
  | "live"

export type GuideStepState = "done" | "todo" | "optional" | "later"

export type GuideCheckKey =
  | "reachable"
  | "signatures"
  | "clock"
  | "contract"
  | "subiekt"
  | "stock"
  | "dryRun"
  | "zk"
  | "wz"
  | "writers"
  | "attention"
  | "webhook"

/** The steps in the order the guide shows them. */
export const GUIDE_STEPS: readonly GuideStepId[] = [
  "subiekt",
  "sdk",
  "service",
  "tunnel",
  "access",
  "medusa",
  "connection",
  "catalog",
  "testOrder",
  "documents",
  "prices",
  "live",
]

/** Checklist items that never hold the go-live back. */
export const OPTIONAL_CHECKS: ReadonlySet<GuideCheckKey> = new Set<GuideCheckKey>(["webhook"])

type Status = Pick<SubiektStatusResponse, "mode" | "configured" | "options" | "connection" | "diagnostics" | "writers" | "counts" | "lastRuns">

export function guideChecks(s: Status): Record<GuideCheckKey, boolean> {
  const h = s.connection.health
  const stock = s.lastRuns.stock
  return {
    reachable: s.connection.reachable,
    signatures: s.diagnostics.signature === "ok",
    clock: skewLevel(s.diagnostics.clockSkewMs) === "ok",
    contract: Boolean(h) && !s.diagnostics.legacy,
    subiekt: Boolean(h?.subiekt?.connected) && h?.subiekt?.licence !== "refused",
    stock: Boolean(stock && (stock.status === "success" || stock.status === "partial")),
    dryRun: !s.options.stockDryRun,
    zk: s.counts.zk > 0,
    wz: s.counts.wz > 0,
    // Nothing allowed means nothing to decide.
    writers: s.writers.filter((w) => w.allowed).every((w) => w.changedAt !== null),
    attention: s.counts.failed === 0,
    webhook: Boolean(s.diagnostics.webhook.lastAt),
  }
}

/** Ready to go live: every checklist item except the optional ones. */
export function readyForLive(checks: Record<GuideCheckKey, boolean>): boolean {
  return (Object.keys(checks) as GuideCheckKey[]).every((k) => OPTIONAL_CHECKS.has(k) || checks[k])
}

export function guideStepStates(s: Status): Record<GuideStepId, GuideStepState> {
  const checks = guideChecks(s)
  const done = (ok: boolean): GuideStepState => (ok ? "done" : "todo")
  const connected = Boolean(s.connection.health?.subiekt?.connected)
  const writer = (key: string) => s.writers.find((w) => w.key === key)
  const products = s.lastRuns.products
  const productsSupported = s.diagnostics.capabilities.includes("products")
  const productsRead = !productsSupported || !s.options.productSyncEnabled || Boolean(products && products.status !== "error")
  const prices = writer("prices")
  const creator = writer("products")
  return {
    subiekt: done(connected),
    // Sfera logs in only to a database of its own version: a login proves the SDK matches.
    sdk: done(connected),
    service: done(s.connection.reachable),
    tunnel: done(s.connection.reachable),
    access: s.options.cfAccess ? "done" : "optional",
    medusa: done(s.mode === "demo" || s.configured),
    connection: done(checks.reachable && connected && checks.signatures && checks.clock),
    catalog: done(checks.stock && productsRead),
    testOrder: done(checks.zk && checks.wz),
    documents: s.options.salesDocument === "none" ? "optional" : done(Boolean(writer("documents")?.active) && s.counts.fs + s.counts.pa > 0),
    prices: !prices?.allowed && !creator?.allowed ? "optional" : done(Boolean(prices?.active || creator?.active)),
    live: readyForLive(checks) ? "done" : "later",
  }
}
