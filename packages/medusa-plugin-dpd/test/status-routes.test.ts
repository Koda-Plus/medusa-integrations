/**
 * The routes of stage 5 (10.3, 10.4, 10.6, 10.7, 10.9, flow): refresh-status
 * and retry-status-writer with every answer they give, the writer filter of
 * the list, the statuses of GET /admin/dpd, the write guard and the actor,
 * and the status problems of the integration. InfoServices is the fake
 * behind createInfoServicesClient; no network.
 */
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import type { ActionResponse, ErrorResponse, RetryStatusWriterResponse, ShipmentsResponse, StatusResponse } from "../src/modules/dpd/lib/contract.ts"
import type { ShipmentRow } from "../src/modules/dpd/lib/dto.ts"
import { makeContext } from "../src/modules/dpd/lib/kit-routes.ts"
import middlewares from "../src/api/middlewares.ts"
import { GET as getStatus } from "../src/api/admin/dpd/route.ts"
import { GET as getShipments } from "../src/api/admin/dpd/shipments/route.ts"
import { POST as postRefresh } from "../src/api/admin/dpd/shipments/[id]/refresh-status/route.ts"
import { POST as postRetry } from "../src/api/admin/dpd/shipments/[id]/retry-status-writer/route.ts"
import { dpdIntegration } from "../src/workflows/dpd/integration.ts"
import { exclusive } from "../src/workflows/dpd/runtime.ts"
import { WRITER_INTERRUPTED_MESSAGE } from "../src/workflows/dpd/statuses.ts"
import { eventsXml } from "./fake-infoservices.ts"
import { arm, cancelFulfillment, insertLabeled, labeledOrder, LIVE_INFO, SANDBOX, setup, type Row, type Setup } from "./helpers.ts"

const realFetch = globalThis.fetch
let requests = 0
beforeEach(() => {
  requests = 0
  globalThis.fetch = (async () => {
    requests += 1
    throw new Error("no network in the tests")
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  assert.equal(requests, 0, "only the fake InfoServices is ever called")
})

const ADMIN = "user_01ADMIN"
const MIN = 60_000
const LIVE = { ...LIVE_INFO, fulfillmentStatusWriter: true }
const wb = (i: number) => `0000${String(i).padStart(4, "0")}0000U`

type Answer<T> = { status: number; body: T; headers: Record<string, string> }

async function call<T>(handler: (req: never, res: never) => Promise<void>, s: Setup, id = "", req: Row = {}): Promise<Answer<T>> {
  const out: Answer<unknown> = { status: 200, body: undefined, headers: {} }
  const res = {
    setHeader(name: string, value: string) {
      out.headers[name.toLowerCase()] = value
      return res
    },
    status(code: number) {
      out.status = code
      return res
    },
    json(body: unknown) {
      out.body = body
      return res
    },
    send(body: unknown) {
      out.body = body
      return res
    },
  }
  await handler({ scope: s.container, query: {}, params: { id }, body: {}, headers: {}, auth_context: { actor_id: ADMIN }, ...req } as never, res as never)
  return out as Answer<T>
}

/** Events per waybill, "auth" for a refused login, "unclear" for an answer nobody can read. */
function live(dpd: Map<string, string | "auth" | "unclear">, options = LIVE): Setup {
  return setup(options, [], {
    info: (req) => {
      const known = dpd.get(req.waybill ?? "")
      if (known === "auth") return { fixture: "13f-wrong-password.response.xml" }
      if (known === "unclear") return { status: 503, body: "Service Unavailable" }
      return { body: known ?? eventsXml([]) }
    },
  })
}

const pickedUp = (waybill: string) => eventsXml([{ waybill, code: "040101", eventTimeRaw: "2026-11-03 11:00:00", description: "Przesyłka odebrana przez Kuriera" }])

/** A labeled row handed over an hour ago. */
function handed(s: Setup, i: number, over: Partial<ShipmentRow> & { tracking?: unknown } = {}): Row {
  return insertLabeled(s, labeledOrder(i), { handed_over_at: new Date(Date.now() - 60 * MIN), stage: "ready", ...over } as Partial<ShipmentRow>)
}

function stored(s: Setup, id: unknown): Row {
  const row = s.shipments.rows.find((r) => r.id === id)
  assert.ok(row)
  return row
}

const actionsOf = (s: Setup, id: unknown) => s.events.rows.filter((e) => e.shipment_id === id && e.kind === "action").map((e) => String((e.data as Row | null)?.action ?? ""))

function refused(a: Answer<ErrorResponse>, status: number, code: string): void {
  assert.equal(a.status, status, JSON.stringify(a.body))
  assert.equal(a.body.code, code)
  assert.equal(a.headers["cache-control"], "private, no-store")
}

const possession = (waybill: string) => [
  {
    waybill,
    box: 0,
    role: "outbound",
    stage: "in_transit",
    code: "040101",
    at: "2026-11-03T10:00:00.000Z",
    possession: true,
    lastCode: "040101",
    lastAt: "2026-11-03T10:00:00.000Z",
    description: null,
    supersededBy: null,
    supersededAt: null,
    from: null,
    checkedAt: "2026-11-03T10:00:00.000Z",
    done: false,
  },
]

/* ------------------------------------------------------------------ */
/* POST .../refresh-status (10.3)                                      */
/* ------------------------------------------------------------------ */

test("refresh-status: 200 with the shipment, 409 not_configured for source off, 409 wrong_state, 409 busy, 429 rate_limited with Retry-After, 502 statuses_auth, 502 status_unavailable", async () => {
  const s = live(new Map([[wb(1), pickedUp(wb(1))]]))
  const row = handed(s, 1)
  const ok = await call<ActionResponse>(postRefresh, s, String(row.id))
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(ok.headers["cache-control"], "private, no-store")
  assert.equal(ok.body.shipment.id, row.id)
  assert.equal(ok.body.shipment.stage, "in_transit")
  assert.equal(ok.body.shipment.status, "040101")
  assert.ok(ok.body.shipment.lastCheckedAt)

  const off = setup({ ...SANDBOX, mode: "live" })
  refused(await call<ErrorResponse>(postRefresh, off, String(handed(off, 1).id)), 409, "not_configured")

  const pending = insertLabeled(s, labeledOrder(2), { state: "pending", waybills: null, boxes: null } as Partial<ShipmentRow>)
  refused(await call<ErrorResponse>(postRefresh, s, String(pending.id)), 409, "wrong_state")
  const canceled = handed(s, 3, { stage: "canceled" } as Partial<ShipmentRow>)
  refused(await call<ErrorResponse>(postRefresh, s, String(canceled.id)), 409, "wrong_state")
  const demo = setup({ demo: true })
  const seed = demo.shipments.insert({ mode: "demo", kind: "outbound", option_id: "dpd-courier", order_id: "order_DEMO", fulfillment_id: null, state: "labeled", waybills: ["99000000000001D"] })
  refused(await call<ErrorResponse>(postRefresh, demo, String(seed.id)), 409, "wrong_state")
  refused(await call<ErrorResponse>(postRefresh, s, "dpdshp_missing"), 404, "not_found")

  const busy = await exclusive(`status:${String(row.id)}`, () => call<ErrorResponse>(postRefresh, s, String(row.id)))
  assert.ok(busy)
  refused(busy, 409, "busy")

  const paced = live(new Map())
  const pacedRow = handed(paced, 1)
  const resolve = paced.container.resolve
  paced.container.resolve = <T,>(key: string, opts?: { allowUnregistered?: boolean }): T =>
    key === "dpdInfoServicesClient"
      ? ({ getEventsForWaybill: async () => ({ kind: "nothingSent", code: "rate_limited", message: "paced", httpStatus: 0, ms: 0 }) } as T)
      : resolve<T>(key, opts)
  const limited = await call<ErrorResponse>(postRefresh, paced, String(pacedRow.id))
  refused(limited, 429, "rate_limited")
  assert.equal(limited.headers["retry-after"], "15")
  assert.deepEqual(actionsOf(paced, pacedRow.id), [], "nothing asked: no history")

  const auth = live(new Map([[wb(1), "auth"]]))
  const authRow = handed(auth, 1)
  const refusedLogin = await call<ErrorResponse>(postRefresh, auth, String(authRow.id))
  refused(refusedLogin, 502, "statuses_auth")
  for (const secret of ["info-password-koda-0000", "koda-info-test", "https://", "dpdinfoservices"]) assert.ok(!refusedLogin.body.message.includes(secret), secret)
  assert.equal((auth.settings.rows.find((r) => r.key === "live:status:problem")?.value as Row | undefined)?.code, "statuses_auth")
  assert.equal((auth.events.rows.find((e) => (e.data as Row | null)?.action === "status_refresh")?.data as Row).outcome, "auth")

  const unclear = live(new Map([[wb(1), "unclear"]]))
  const unclearRow = handed(unclear, 1)
  refused(await call<ErrorResponse>(postRefresh, unclear, String(unclearRow.id)), 502, "status_unavailable")
  assert.equal(stored(unclear, unclearRow.id).stage, "ready", "nothing changed")
  assert.equal((unclear.events.rows.find((e) => (e.data as Row | null)?.action === "status_refresh")?.data as Row).outcome, "unavailable")
})

/* ------------------------------------------------------------------ */
/* POST .../retry-status-writer (10.4)                                 */
/* ------------------------------------------------------------------ */

test("retry-status-writer: 409 writer_off, 409 not_armed, 409 wrong_state without an error and without a stale mark, 200 clears a stale error", async () => {
  const off = setup(LIVE_INFO)
  const offRow = handed(off, 1, { status_writer_error: "Medusa refused" } as Partial<ShipmentRow>)
  refused(await call<ErrorResponse>(postRetry, off, String(offRow.id)), 409, "writer_off")

  const s = setup(LIVE)
  const failed = handed(s, 1, { status_writer_error: "Medusa refused" } as Partial<ShipmentRow>)
  refused(await call<ErrorResponse>(postRetry, s, String(failed.id)), 409, "not_armed")
  arm(s, "fulfillmentStatus")
  const clean = handed(s, 2)
  refused(await call<ErrorResponse>(postRetry, s, String(clean.id)), 409, "wrong_state")

  /* Nothing left to write (no possession, not delivered): the stale error goes (O34). */
  const cleared = await call<RetryStatusWriterResponse>(postRetry, s, String(failed.id))
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body))
  assert.equal(cleared.body.shipment.statusWriterError, null)
  assert.equal(cleared.body.result, "nothing_left", "the error is cleared, but nothing was written (E56)")
  assert.equal(stored(s, failed.id).status_writer_error, null)
  const retry = s.events.rows.find((e) => (e.data as Row | null)?.action === "writer_retry")
  assert.ok(retry)
  assert.equal(retry.actor, ADMIN)
  assert.deepEqual({ ...(retry.data as Row) }, { action: "writer_retry", error: "Medusa refused", outcome: "nothing_wanted" })
})

test("retry-status-writer: 200 for a stale mark without an error releases it as writer_interrupted and writes; 409 wrong_state for a mark younger than 15 minutes and for a mark with shipped_at in Medusa", async () => {
  const s = setup(LIVE)
  arm(s, "fulfillmentStatus")
  const stale = handed(s, 1, { stage: "in_transit", tracking: possession(wb(1)), shipped_marked_at: new Date(Date.now() - 16 * MIN) } as Partial<ShipmentRow>)
  const out = await call<RetryStatusWriterResponse>(postRetry, s, String(stale.id))
  assert.equal(out.status, 200, JSON.stringify(out.body))
  assert.equal(out.body.result, "written")
  assert.deepEqual(actionsOf(s, stale.id), ["writer_interrupted", "writer_shipped", "writer_retry"])
  assert.ok(out.body.shipment.shippedMarkedAt)
  assert.equal(out.body.shipment.statusWriterError, null)
  assert.deepEqual(s.coreFlows.calls.map((c) => c.flow), ["createOrderShipmentWorkflow"])

  const young = handed(s, 2, { stage: "in_transit", tracking: possession(wb(2)), shipped_marked_at: new Date(Date.now() - 5 * MIN) } as Partial<ShipmentRow>)
  refused(await call<ErrorResponse>(postRetry, s, String(young.id)), 409, "wrong_state")
  const done = handed(s, 3, { stage: "in_transit", tracking: possession(wb(3)), shipped_marked_at: new Date(Date.now() - 16 * MIN) } as Partial<ShipmentRow>)
  const f = s.fulfillments.get(String(done.fulfillment_id))
  assert.ok(f)
  f.shipped_at = new Date(Date.now() - 16 * MIN)
  refused(await call<ErrorResponse>(postRetry, s, String(done.id)), 409, "wrong_state")
  assert.equal(s.coreFlows.calls.length, 1)
})

test("retry-status-writer says what the writer did: failed, then nothing_left for a fulfillment canceled meanwhile, never written without a write (E56)", async () => {
  const s = setup(LIVE)
  arm(s, "fulfillmentStatus")
  const row = handed(s, 1, { stage: "in_transit", tracking: possession(wb(1)), status_writer_error: "Medusa refused" } as Partial<ShipmentRow>)
  s.coreFlows.fail.createOrderShipmentWorkflow = new Error("Medusa refused again")
  const failed = await call<RetryStatusWriterResponse>(postRetry, s, String(row.id))
  assert.equal(failed.status, 200, JSON.stringify(failed.body))
  assert.equal(failed.body.result, "failed")
  assert.ok(failed.body.shipment.statusWriterError)
  /* The store owner cancels the fulfillment in Medusa: the retry writes nothing and clears the error (O34). */
  s.coreFlows.fail.createOrderShipmentWorkflow = null
  cancelFulfillment(s, String(row.fulfillment_id))
  const calls = s.coreFlows.calls.length
  const canceled = await call<RetryStatusWriterResponse>(postRetry, s, String(row.id))
  assert.equal(canceled.status, 200, JSON.stringify(canceled.body))
  assert.equal(canceled.body.shipment.statusWriterError, null)
  assert.equal(canceled.body.result, "nothing_left")
  assert.equal(s.coreFlows.calls.length, calls, "nothing reached Medusa")
  assert.equal(stored(s, row.id).shipped_marked_at ?? null, null)
  const outcomes = s.events.rows.filter((e) => (e.data as Row | null)?.action === "writer_retry").map((e) => (e.data as Row).outcome)
  assert.deepEqual(outcomes, ["failed", "fulfillment_canceled"])
})

test("retry-status-writer says failed, never in_progress, when a store error stops the writer (E62)", async () => {
  /* claimMark throws (a timeout), or the workflow fails and releaseMark throws before the step is set. */
  for (const fault of ["claim", "release"] as const) {
    const s = setup(LIVE)
    arm(s, "fulfillmentStatus")
    const row = handed(s, 1, { stage: "in_transit", tracking: possession(wb(1)), status_writer_error: "Medusa refused" } as Partial<ShipmentRow>)
    if (fault === "claim") {
      s.store.claimMark = async () => {
        throw new Error("statement timeout")
      }
    } else {
      s.coreFlows.fail.createOrderShipmentWorkflow = new Error("Medusa refused again")
      s.store.releaseMark = async () => {
        throw new Error("connection dropped")
      }
    }
    const out = await call<RetryStatusWriterResponse>(postRetry, s, String(row.id))
    assert.equal(out.status, 200, JSON.stringify(out.body))
    assert.equal(out.body.result, "failed", fault)
    const outcomes = s.events.rows.filter((e) => (e.data as Row | null)?.action === "writer_retry").map((e) => (e.data as Row).outcome)
    assert.deepEqual(outcomes, ["failed"], fault)
    assert.ok(s.logs.some((l) => l.startsWith("warn") && l.includes("the write to Medusa stopped")), fault)
  }
})

test("retry-status-writer releases a stale shipped mark next to a pending note", async () => {
  const s = setup(LIVE)
  arm(s, "fulfillmentStatus")
  const row = handed(s, 1, {
    stage: "in_transit",
    tracking: possession(wb(1)),
    shipped_marked_at: new Date(Date.now() - 20 * MIN),
    status_writer_error: "Not written to Medusa yet: the fulfillment could not be read. Write it again.",
  } as Partial<ShipmentRow>)
  const out = await call<ActionResponse>(postRetry, s, String(row.id))
  assert.equal(out.status, 200, JSON.stringify(out.body))
  assert.deepEqual(actionsOf(s, row.id), ["writer_interrupted", "writer_shipped", "writer_retry"])
  assert.equal(out.body.shipment.statusWriterError, null)
  assert.notEqual(stored(s, row.id).status_writer_error, WRITER_INTERRUPTED_MESSAGE)
})

/** The next read of the row throws once, after releaseMark wrote WRITER_INTERRUPTED_MESSAGE (a transient read failure). */
function failReadAfterRelease(s: Setup, id: unknown): { failed: number } {
  const svc = s.container.resolve<Record<string, unknown>>("dpd")
  const list = svc.listDpdShipments as (f?: Row, c?: Row) => Promise<unknown>
  const out = { failed: 0 }
  svc.listDpdShipments = async (f?: Row, c?: Row) => {
    if (out.failed === 0 && stored(s, id).status_writer_error === WRITER_INTERRUPTED_MESSAGE) {
      out.failed += 1
      throw new Error("database down")
    }
    return list(f, c)
  }
  return out
}

test("retry-status-writer writes a released mark when reading the row again fails, and keeps no false success", async () => {
  const s = setup(LIVE)
  arm(s, "fulfillmentStatus")
  const row = handed(s, 1, { stage: "in_transit", tracking: possession(wb(1)), shipped_marked_at: new Date(Date.now() - 16 * MIN) } as Partial<ShipmentRow>)
  const fault = failReadAfterRelease(s, row.id)
  const out = await call<ActionResponse>(postRetry, s, String(row.id))
  assert.equal(out.status, 200, JSON.stringify(out.body))
  assert.equal(fault.failed, 1, "the reread after the release failed")
  assert.deepEqual(actionsOf(s, row.id), ["writer_interrupted", "writer_shipped", "writer_retry"])
  assert.equal((s.events.rows.find((e) => (e.data as Row | null)?.action === "writer_retry")?.data as Row).outcome, "marked")
  assert.deepEqual(s.coreFlows.calls.map((c) => c.flow), ["createOrderShipmentWorkflow"])
  assert.ok(stored(s, row.id).shipped_marked_at)
  assert.equal(stored(s, row.id).status_writer_error, null)
  assert.ok(s.logs.some((l) => l.startsWith("warn") && l.includes("reading the shipment failed")))
})

/* ------------------------------------------------------------------ */
/* Lists, status, guard, integration                                   */
/* ------------------------------------------------------------------ */

test("GET /admin/dpd/shipments?writer=failed filters and 400 for another value", async () => {
  const s = setup(LIVE)
  const failed = handed(s, 1, { status_writer_error: "Medusa refused" } as Partial<ShipmentRow>)
  handed(s, 2)
  const list = await call<ShipmentsResponse>(getShipments, s, "", { query: { writer: "failed" } })
  assert.equal(list.status, 200)
  assert.deepEqual(list.body.shipments.map((x) => x.id), [failed.id])
  assert.equal(list.body.counts.statusesAttention, 1)
  const all = await call<ShipmentsResponse>(getShipments, s, "", { query: {} })
  assert.equal(all.body.shipments.length, 2)
  const wrong = await call<ErrorResponse>(getShipments, s, "", { query: { writer: "ok" } })
  assert.equal(wrong.status, 400)
  assert.equal(wrong.body.code, "invalid")
})

test("GET /admin/dpd carries statuses and options.statusSource", async () => {
  const s = live(new Map([[wb(1), "auth"]]))
  handed(s, 1)
  const before = await call<StatusResponse>(getStatus, s)
  assert.equal(before.status, 200)
  assert.equal(before.body.options.statusSource, "dpd")
  assert.deepEqual(before.body.statuses, { source: "dpd", problems: [], lastSyncAt: null, problemAt: null })
  s.settings.insert({ key: "live:status:problem", value: { code: "statuses_auth", at: "2026-11-03T10:00:00.000Z" }, updated_by: null })
  s.settings.insert({ key: "live:status:lastSyncAt", value: { at: "2026-11-03T10:05:00.000Z", source: "dpd", asked: 1, newEvents: 0 }, updated_by: null })
  const after = await call<StatusResponse>(getStatus, s)
  assert.deepEqual(after.body.statuses, { source: "dpd", problems: ["statuses_auth"], lastSyncAt: "2026-11-03T10:05:00.000Z", problemAt: "2026-11-03T10:00:00.000Z" })

  const sandbox = await call<StatusResponse>(getStatus, setup(SANDBOX))
  assert.equal(sandbox.body.options.statusSource, "simulated")
  assert.equal(sandbox.body.statuses.source, "simulated")
  const off = await call<StatusResponse>(getStatus, setup({ ...SANDBOX, mode: "live" }))
  assert.equal(off.body.statuses.source, "off")
  assert.ok(off.body.statuses.problems.length > 0, "source off names what is missing")
})

test("both routes go through writeGuard and record the actor", async () => {
  const routes = (middlewares as unknown as { routes: Array<{ matcher: string; middlewares: Array<(req: never, res: never, next: () => void) => void> }> }).routes
  const admin = routes.find((r) => r.matcher === "/admin/dpd*")
  assert.ok(admin)
  for (const path of ["shipments/dpdshp_1/refresh-status", "shipments/dpdshp_1/retry-status-writer"]) {
    const out = { status: 0 }
    const res = { status: (c: number) => ((out.status = c), res), json: () => res }
    admin.middlewares[0]({ method: "POST", url: `/admin/dpd/${path}`, headers: { "content-type": "text/plain" } } as never, res as never, () => {})
    assert.equal(out.status, 415, path)
  }

  const s = live(new Map([[wb(1), pickedUp(wb(1))]]))
  const row = handed(s, 1, { status_writer_error: "Medusa refused" } as Partial<ShipmentRow>)
  assert.equal((await call<ActionResponse>(postRefresh, s, String(row.id))).status, 200)
  arm(s, "fulfillmentStatus")
  assert.equal((await call<ActionResponse>(postRetry, s, String(row.id))).status, 200)
  const history = s.events.rows.filter((e) => ["status_refresh", "writer_retry"].includes(String((e.data as Row | null)?.action)))
  assert.equal(history.length, 2)
  assert.ok(history.every((e) => e.actor === ADMIN && e.source === "admin"))
})

test("statuses_not_configured and statuses_auth reach the integration status", async () => {
  const off = setup({ ...SANDBOX, mode: "live" })
  const mo = await dpdIntegration.build.manifest(makeContext({ scope: off.container }))
  assert.ok(mo.problems.some((p) => p.key === "integration.problem.statuses_not_configured"))

  const s = live(new Map())
  const clean = await dpdIntegration.build.manifest(makeContext({ scope: s.container }))
  assert.ok(!clean.problems.some((p) => p.key.startsWith("integration.problem.statuses")))
  s.settings.insert({ key: "live:status:problem", value: { code: "statuses_auth", at: "2026-11-03T10:00:00.000Z" }, updated_by: null })
  const m = await dpdIntegration.build.manifest(makeContext({ scope: s.container }))
  assert.ok(m.problems.some((p) => p.key === "integration.problem.statuses_auth"))
  assert.ok(!m.problems.some((p) => p.key === "integration.problem.statuses_not_configured"))

  const sandbox = await dpdIntegration.build.manifest(makeContext({ scope: setup(SANDBOX).container }))
  assert.ok(!sandbox.problems.some((p) => p.key.startsWith("integration.problem.statuses")), "the simulator needs no credentials")
})

test("lastSyncAt is read leniently", async () => {
  const s = live(new Map())
  const read = async () => (await dpdIntegration.build.manifest(makeContext({ scope: s.container }))).lastSyncAt ?? null
  assert.equal(await read(), null)
  const row = s.settings.insert({ key: "live:status:lastSyncAt", value: { at: "2026-11-03T10:05:00.000Z", source: "dpd", asked: 1, newEvents: 0 }, updated_by: null })
  assert.equal(new Date(String(await read())).toISOString(), "2026-11-03T10:05:00.000Z")
  for (const value of [{ at: "not a time" }, { at: 42 }, null, "2026-11-03", []]) {
    Object.assign(s.settings.rows.find((r) => r.id === row.id) ?? {}, { value })
    assert.equal(await read(), null, JSON.stringify(value))
  }
})
