/**
 * The "connection lost" alert: a refused token, a 401, and a 403 with
 * InPost's problem details count; the bare 403 of the gateway (already
 * asked again by the wire) and other errors do not. One refused run is not
 * an alert, two in a row are, and it says since when and why; a run that
 * reached the marketplace (or a check that worked) clears it, a run that
 * asked nothing leaves it as it is.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { CONNECTION_OK, connectionFailure, connectionStateOf, connectionView, nextConnectionState } from "../src/modules/vonhalsky/lib/connection.ts"
import { MarketplaceApiError } from "../src/modules/vonhalsky/lib/http.ts"
import { CONNECTION_ALERT_RUNS } from "../src/modules/vonhalsky/lib/constants.ts"

test("connection: what counts as the marketplace refusing the credentials", () => {
  assert.equal(connectionFailure(new MarketplaceApiError(401, "TOKEN", "refused")), true)
  assert.equal(connectionFailure(new MarketplaceApiError(400, "TOKEN", "invalid_client")), true, "the token endpoint's own answer")
  assert.equal(connectionFailure(new MarketplaceApiError(503, "TOKEN", "down")), false, "the token endpoint being down is not a refusal")
  assert.equal(connectionFailure(new MarketplaceApiError(401, "HTTP_401", "no body")), true, "a 401 after the fresh token")
  assert.equal(connectionFailure(new MarketplaceApiError(403, "ACCESS_DENIED", "problem details")), true)
  assert.equal(connectionFailure(new MarketplaceApiError(403, "HTTP_403", "x", [{ field: "scope", detail: "missing" }])), true)
  assert.equal(connectionFailure(new MarketplaceApiError(403, "HTTP_403", "bare gateway 403")), false, "the gateway's random refusal")
  assert.equal(connectionFailure(new MarketplaceApiError(500, "HTTP_500", "x")), false)
  assert.equal(connectionFailure(new MarketplaceApiError(0, "TIMEOUT", "x")), false)
  assert.equal(connectionFailure(new Error("x")), false)
})

test("connection: two refused runs in a row raise the alert, a reached run clears it", () => {
  assert.equal(CONNECTION_ALERT_RUNS, 2)
  const t1 = new Date("2026-11-06T10:00:00Z")
  const t2 = new Date("2026-11-06T10:05:00Z")
  const one = nextConnectionState(CONNECTION_OK, { refused: "TOKEN refused" }, t1)
  assert.deepEqual(connectionView(one), { ok: true, since: null, message: null }, "one refusal can be a hiccup")
  const two = nextConnectionState(one, { refused: "TOKEN refused again" }, t2)
  assert.deepEqual(connectionView(two), { ok: false, since: t1.toISOString(), message: "TOKEN refused again" })
  assert.deepEqual(nextConnectionState(two, null, t2), two, "a run that asked nothing changes nothing")
  const back = nextConnectionState(two, { reached: true }, t2)
  assert.deepEqual(connectionView(back), { ok: true, since: null, message: null })
  assert.equal(back.okAt, t2.toISOString())
})

test("connection: a stored state is read leniently", () => {
  assert.deepEqual(connectionStateOf(null), CONNECTION_OK)
  assert.deepEqual(connectionStateOf({ failures: -3, since: 5 }), CONNECTION_OK)
  assert.equal(connectionStateOf({ failures: 2.7 }).failures, 2)
})
