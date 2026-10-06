import { test } from "node:test"
import assert from "node:assert/strict"
import { STATUSES, type NegotiationStatus } from "../src/modules/negotiations/lib/constants.ts"
import { applyMove, inferWaitingFor, isActive, MOVES, type ThreadAction } from "../src/modules/negotiations/lib/status.ts"

const ACTIONS = Object.keys(MOVES) as ThreadAction[]

test("the five statuses of the app module, two of them active", () => {
  assert.deepEqual([...STATUSES], ["open", "counter_offered", "accepted", "rejected", "expired"])
  assert.deepEqual(STATUSES.filter(isActive), ["open", "counter_offered"])
})

test("every move from every status: the full table", () => {
  const table: Record<ThreadAction, Partial<Record<NegotiationStatus, string>>> = {
    customer_message: { open: "open/team", counter_offered: "counter_offered/team" },
    customer_proposal: { open: "open/team", counter_offered: "open/team" },
    customer_accept: { counter_offered: "accepted/-" },
    customer_decline: { open: "rejected/-", counter_offered: "rejected/-" },
    admin_message: { open: "open/customer", counter_offered: "counter_offered/customer" },
    admin_counter: { open: "counter_offered/customer", counter_offered: "counter_offered/customer" },
    admin_accept: { open: "accepted/-", counter_offered: "accepted/-" },
    admin_reject: { open: "rejected/-", counter_offered: "rejected/-" },
    note: { open: "open/team", counter_offered: "counter_offered/team", accepted: "accepted/-", rejected: "rejected/-", expired: "expired/-" },
    expire: { open: "expired/-", counter_offered: "expired/-" },
  }
  for (const action of ACTIONS) {
    for (const status of STATUSES) {
      const r = applyMove(status, isActive(status) ? "team" : null, action)
      const expected = table[action][status]
      if (expected === undefined) {
        assert.equal(r.ok, false, `${action} from ${status} must be refused`)
      } else {
        assert.ok(r.ok, `${action} from ${status} must be allowed`)
        if (r.ok) assert.equal(`${r.status}/${r.waitingFor ?? "-"}`, expected, `${action} from ${status}`)
      }
    }
  }
})

test("refusals say why: accepting without an offer, anything on a closed thread", () => {
  const noOffer = applyMove("open", "team", "customer_accept")
  assert.deepEqual(noOffer, { ok: false, reason: "no_offer" })
  for (const closed of ["accepted", "rejected", "expired"] as const) {
    assert.deepEqual(applyMove(closed, null, "customer_message"), { ok: false, reason: "closed" })
    assert.deepEqual(applyMove(closed, null, "admin_counter"), { ok: false, reason: "closed" })
    assert.deepEqual(applyMove(closed, null, "expire"), { ok: false, reason: "closed" })
  }
})

test("who closed: the customer, the team or the plugin; notes and messages close nothing", () => {
  const closedBy = (s: NegotiationStatus, a: ThreadAction) => {
    const r = applyMove(s, "team", a)
    return r.ok ? r.closedBy : "refused"
  }
  assert.equal(closedBy("counter_offered", "customer_accept"), "customer")
  assert.equal(closedBy("open", "customer_decline"), "customer")
  assert.equal(closedBy("open", "admin_accept"), "admin")
  assert.equal(closedBy("counter_offered", "admin_reject"), "admin")
  assert.equal(closedBy("open", "expire"), "system")
  assert.equal(closedBy("open", "note"), null)
  assert.equal(closedBy("open", "customer_message"), null)
})

test("only real moves restart the expiry clock: notes and the expiry itself do not", () => {
  for (const action of ACTIONS) {
    assert.equal(MOVES[action].activity, action !== "note" && action !== "expire", action)
  }
})

test("whose move it is, for rows of the app module that never stored it", () => {
  assert.equal(inferWaitingFor("open", "customer"), "team")
  assert.equal(inferWaitingFor("open", "admin"), "customer")
  assert.equal(inferWaitingFor("counter_offered", "system"), "customer", "the old counter note was a system message")
  assert.equal(inferWaitingFor("open", null), "team")
  assert.equal(inferWaitingFor("counter_offered", null), "customer")
  assert.equal(inferWaitingFor("accepted", "customer"), null)
})
