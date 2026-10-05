import { test } from "node:test"
import assert from "node:assert/strict"
import { GUIDE_STEPS, guideChecks, guideStepStates, readyForLive } from "../src/modules/subiekt/lib/guide.ts"
import type { RunDto, SubiektStatusResponse, WriterDto } from "../src/modules/subiekt/lib/contract.ts"

const ALL = ["orders", "fulfillments", "stock", "events", "products", "contractors", "contractors.create", "documents.fs", "documents.pa", "documents.ksef", "webhook"]

function writer(key: WriterDto["key"], patch: Partial<WriterDto> = {}): WriterDto {
  return { key, option: key, allowed: false, armed: false, active: false, unsupported: false, changedBy: null, changedAt: null, ...patch }
}

function run(kind: RunDto["kind"], status: RunDto["status"]): RunDto {
  return { id: `run_${kind}`, kind, trigger: "manual", status, dryRun: false, message: null, stats: {}, startedAt: "2026-10-06T08:00:00.000Z", finishedAt: null, durationMs: 1200 }
}

/** A store that installed the plugin and configured nothing yet. */
function fresh(): Parameters<typeof guideChecks>[0] {
  return {
    mode: "live",
    configured: false,
    options: {
      prepaidProviders: [],
      stockSyncEnabled: true,
      stockLocationId: null,
      stockField: "quantity",
      stockDryRun: true,
      issueWzOnFulfillment: false,
      fulfillOnWz: false,
      eventsEnabled: true,
      productSyncEnabled: true,
      priceTarget: "variant",
      priceListId: null,
      priceLevel: null,
      priceType: "gross",
      priceCurrency: "pln",
      maxPriceChangesPerRun: 200,
      maxProductsPerRun: 20,
      nipSources: [],
      salesDocument: "none",
      salesDocumentAfter: "wz",
      cfAccess: false,
    },
    connection: {
      reachable: false,
      health: null,
      checkedAt: null,
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      eventsCursor: null,
      eventsReadAt: null,
    },
    diagnostics: {
      checkedAt: null,
      latencyMs: null,
      clockSkewMs: null,
      signature: "unknown",
      capabilities: [],
      legacy: false,
      missing: [],
      webhook: { lastAt: null, rejectedAt: null, rejectReason: null },
    },
    writers: [writer("prices"), writer("products"), writer("documents"), writer("contractors")],
    counts: { waiting: 0, pending: 0, running: 0, unknown: 0, failed: 0, succeeded24h: 0, documents: 0, zk: 0, wz: 0, fs: 0, pa: 0 },
    lastRuns: {},
  }
}

/** The same store a week later: connected, tested, every allowed writer decided. */
function live(): Parameters<typeof guideChecks>[0] {
  const s = fresh()
  s.configured = true
  s.options = { ...s.options, stockDryRun: false, salesDocument: "auto", cfAccess: true }
  s.connection = {
    ...s.connection,
    reachable: true,
    health: {
      status: "ok",
      capabilities: ALL,
      bridge: { name: "Subiekt nexo bridge", version: "0.2.0", contract: "1.1.0", mode: "sfera", sdk_version: "61.0.1.9371" },
      subiekt: { connected: true, database_version: "61.0.1.9371", licence: "ok" },
      time: "2026-10-06T08:00:00.000Z",
    } as SubiektStatusResponse["connection"]["health"],
  }
  s.diagnostics = { ...s.diagnostics, signature: "ok", clockSkewMs: 900, capabilities: ALL, webhook: { lastAt: "2026-10-06T07:59:00.000Z", rejectedAt: null, rejectReason: null } }
  s.writers = [
    writer("prices"),
    writer("products"),
    writer("documents", { allowed: true, armed: true, active: true, changedBy: "Anna", changedAt: "2026-10-05T10:00:00.000Z" }),
    writer("contractors"),
  ]
  s.counts = { ...s.counts, zk: 12, wz: 9, fs: 4, pa: 5, succeeded24h: 30 }
  s.lastRuns = { stock: run("stock", "success"), products: run("products", "success") }
  return s
}

test("a fresh install: every step to do, optional steps marked, nothing ticked but the empty queue", () => {
  const s = fresh()
  const states = guideStepStates(s)
  assert.deepEqual(Object.keys(states), [...GUIDE_STEPS])
  for (const id of ["subiekt", "sdk", "service", "tunnel", "medusa", "connection", "catalog", "testOrder"] as const) assert.equal(states[id], "todo", id)
  assert.equal(states.access, "optional")
  assert.equal(states.documents, "optional", "salesDocument none")
  assert.equal(states.prices, "optional", "no catalog writer allowed")
  assert.equal(states.live, "later")

  const checks = guideChecks(s)
  assert.equal(checks.attention, true)
  assert.equal(checks.writers, true, "nothing allowed, nothing to decide")
  assert.equal(checks.reachable || checks.signatures || checks.clock || checks.contract || checks.subiekt || checks.stock || checks.zk, false)
  assert.equal(readyForLive(checks), false)
})

test("a store in production: every step done and the go-live checklist complete", () => {
  const states = guideStepStates(live())
  for (const id of GUIDE_STEPS.filter((id) => id !== "prices")) assert.equal(states[id], "done", id)
  assert.equal(states.prices, "optional")
  assert.equal(readyForLive(guideChecks(live())), true)
})

test("the optional webhook never holds the go-live back, a failed task does", () => {
  const s = live()
  s.diagnostics = { ...s.diagnostics, webhook: { lastAt: null, rejectedAt: null, rejectReason: null } }
  assert.equal(guideChecks(s).webhook, false)
  assert.equal(guideStepStates(s).live, "done")

  s.counts = { ...s.counts, failed: 1 }
  assert.equal(guideStepStates(s).live, "later")
})

test("clocks, signatures and the licence decide the connection step", () => {
  const skewed = live()
  skewed.diagnostics = { ...skewed.diagnostics, clockSkewMs: 120_000 }
  assert.equal(guideChecks(skewed).clock, false)
  assert.equal(guideStepStates(skewed).connection, "todo")

  const rejected = live()
  rejected.diagnostics = { ...rejected.diagnostics, signature: "invalid_signature" }
  assert.equal(guideStepStates(rejected).connection, "todo")

  const refused = live()
  refused.connection = { ...refused.connection, health: { ...refused.connection.health!, subiekt: { connected: true, licence: "refused" } } }
  assert.equal(guideChecks(refused).subiekt, false)
})

test("a 1.0 bridge leaves the contract unticked; a failed products read leaves the catalog step open", () => {
  const legacy = live()
  legacy.diagnostics = { ...legacy.diagnostics, legacy: true }
  assert.equal(guideChecks(legacy).contract, false)

  const broken = live()
  broken.lastRuns = { ...broken.lastRuns, products: run("products", "error") }
  assert.equal(guideStepStates(broken).catalog, "todo")

  // A bridge without products cannot fail to read them: stock alone completes the step.
  broken.diagnostics = { ...broken.diagnostics, capabilities: ["orders", "fulfillments", "stock", "events"] }
  assert.equal(guideStepStates(broken).catalog, "done")
})

test("an allowed writer nobody decided keeps the checklist open; the documents step needs an armed writer and a document", () => {
  const s = live()
  s.writers = s.writers.map((w) => (w.key === "prices" ? { ...w, allowed: true } : w))
  assert.equal(guideChecks(s).writers, false)
  assert.equal(guideStepStates(s).prices, "todo")

  const unarmed = live()
  unarmed.writers = unarmed.writers.map((w) => (w.key === "documents" ? { ...w, armed: false, active: false } : w))
  assert.equal(guideStepStates(unarmed).documents, "todo")
})
