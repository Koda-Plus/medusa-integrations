import { test } from "node:test"
import assert from "node:assert/strict"
import { describeWriters, isWriterKey, writerAllowed, writerSupported } from "../src/modules/subiekt/lib/writers.ts"
import { classifyDocumentFailure, decideDocumentKind, documentCapability, findSalesDocument } from "../src/modules/subiekt/lib/documents.ts"
import { capabilitiesOf, missingCapabilities, supports } from "../src/modules/subiekt/lib/capabilities.ts"
import { clockSkewMs, signatureState, skewLevel } from "../src/modules/subiekt/lib/diagnostics.ts"
import { resolveOptions } from "../src/modules/subiekt/lib/options.ts"

const ALL = ["orders", "fulfillments", "stock", "events", "products", "contractors", "contractors.create", "documents.fs", "documents.pa", "documents.ksef"]

test("every new writer is off by default, and an option set to false wins", () => {
  const o = resolveOptions({ bridgeUrl: "https://b.example.com", secret: "0123456789abcdef0123" })
  for (const key of ["prices", "products", "documents", "contractors"] as const) assert.equal(writerAllowed(key, o), false, key)

  const on = resolveOptions({ priceWriter: true, createMissingProducts: true, salesDocument: "auto", createContractors: true })
  const rows = [
    { key: "prices", armed: true, changed_by: "anna@shop.pl", changed_at: "2026-10-05T10:00:00.000Z" },
    { key: "documents", armed: false, changed_by: null, changed_at: null },
  ]
  const writers = describeWriters(on, rows, ALL)
  const prices = writers.find((w) => w.key === "prices")!
  assert.deepEqual([prices.allowed, prices.armed, prices.active, prices.changedBy], [true, true, true, "anna@shop.pl"])
  assert.equal(writers.find((w) => w.key === "documents")!.active, false)

  const off = resolveOptions({ priceWriter: false, demo: true })
  assert.equal(describeWriters(off, rows, ALL).find((w) => w.key === "prices")!.active, false)
})

test("demo mode allows every writer by default, but nothing is armed until a person arms it", () => {
  const demo = resolveOptions({ demo: true })
  for (const key of ["prices", "products", "documents", "contractors"] as const) assert.equal(writerAllowed(key, demo), true, key)
  assert.ok(describeWriters(demo, [], ALL).every((w) => !w.armed && !w.active))
  assert.equal(demo.salesDocument, "auto")
})

test("a price list target without a valid price list id keeps the price writer off", () => {
  assert.equal(writerAllowed("prices", resolveOptions({ priceWriter: true, priceTarget: "price_list" })), false)
  assert.equal(writerAllowed("prices", resolveOptions({ priceWriter: true, priceTarget: "price_list", priceListId: "plist_01J" })), true)
})

test("a writer the bridge cannot do is unsupported whatever the switches say", () => {
  assert.equal(writerSupported("prices", "none", ["orders"]), false)
  assert.equal(writerSupported("documents", "fs", ["documents.pa"]), false)
  assert.equal(writerSupported("documents", "auto", ["documents.pa"]), true)
  assert.equal(writerSupported("contractors", "none", ["contractors"]), false)
  const on = resolveOptions({ priceWriter: true })
  assert.equal(describeWriters(on, [{ key: "prices", armed: true, changed_by: null, changed_at: null }], ["orders"])[0].unsupported, true)
  assert.equal(isWriterKey("prices"), true)
  assert.equal(isWriterKey("stock"), false)
})

test("the sales document: fixed kinds, and auto by the buyer's NIP", () => {
  assert.equal(decideDocumentKind("none", "1234563218"), null)
  assert.equal(decideDocumentKind("fs", null), "fs")
  assert.equal(decideDocumentKind("pa", "1234563218"), "pa")
  assert.equal(decideDocumentKind("auto", "1234563218"), "fs")
  assert.equal(decideDocumentKind("auto", null), "pa")
  assert.equal(documentCapability("pa"), "documents.pa")
})

test("an unclear answer is unknown, never a blind retry", () => {
  for (const code of ["timeout", "bridge_unavailable", "invalid_response", "internal"]) assert.equal(classifyDocumentFailure(code, true), "unknown", code)
  for (const code of ["bridge_unreachable", "busy", "subiekt_unavailable", "order_not_found"]) assert.equal(classifyDocumentFailure(code, true), "retry", code)
  assert.equal(classifyDocumentFailure("subiekt_rejected", false), "failed")
  assert.equal(classifyDocumentFailure("not_enabled", false), "failed")
  const docs = [
    { kind: "ZK", number: "ZK 1/MAG/2026", issued_at: "2026-10-04T10:00:00Z" },
    { kind: "PA", number: "PA 9/MAG/2026", issued_at: "2026-10-04T10:00:00Z", status: "canceled" as const },
    { kind: "FS", number: "FS 2/MAG/2026", issued_at: "2026-10-04T10:00:00Z" },
  ]
  assert.equal(findSalesDocument(docs)?.number, "FS 2/MAG/2026")
  assert.equal(findSalesDocument(docs.slice(0, 2)), null)
})

test("capabilities: a 1.0 bridge does the 1.0 set, updates explain the rest", () => {
  assert.deepEqual(capabilitiesOf(null), [])
  assert.deepEqual(capabilitiesOf({}), ["orders", "fulfillments", "stock", "events"])
  assert.equal(supports({ capabilities: ["products"] }, "products"), true)
  assert.equal(supports({}, "products"), false)
  const legacy = missingCapabilities({})
  assert.deepEqual(legacy.find((m) => m.capability === "products"), { capability: "products", reason: "update_bridge" })
  const configured = missingCapabilities({ capabilities: ["orders", "products"] })
  assert.deepEqual(configured.find((m) => m.capability === "contractors"), { capability: "contractors", reason: "bridge_config" })
  assert.equal(missingCapabilities(null)[0].reason, "no_health")
})

test("clock skew from the bridge time and the round trip, with its levels", () => {
  const start = Date.parse("2026-10-04T10:00:00.000Z")
  assert.equal(clockSkewMs("2026-10-04T10:00:01.400Z", start, start + 400), 1200)
  assert.equal(clockSkewMs("2026-10-04T09:58:00.000Z", start, start), -120_000)
  assert.equal(clockSkewMs(null, start, start), null)
  assert.equal(clockSkewMs("nonsense", start, start), null)
  assert.equal(skewLevel(1200), "ok")
  assert.equal(skewLevel(-120_000), "warn")
  assert.equal(skewLevel(400_000), "error")
  assert.equal(skewLevel(null), "unknown")
  assert.equal(signatureState(null, true), "ok")
  assert.equal(signatureState("stale_timestamp", false), "stale_timestamp")
  assert.equal(signatureState("bridge_unreachable", false), "unreachable")
})
