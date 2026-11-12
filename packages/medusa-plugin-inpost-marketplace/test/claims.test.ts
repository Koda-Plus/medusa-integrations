/**
 * Claims as the stage seller API really sends them (12.11.2026, CL-7ZK9D4D-1):
 * the list (`ClaimSummaryResponse`) has the number but no products, value or
 * description; the full claim (`ClaimResponse`) has them all. The stored row
 * keeps the number, the products and the value claimed.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseClaim } from "../src/modules/vonhalsky/lib/remote.ts"
import { claimRow } from "../src/workflows/vonhalsky/cases.ts"

const summary = {
  claimId: "4ddbda52-8c64-46b2-ae74-ce93ad1892c6",
  displayId: "CL-7ZK9D4D-1",
  createdAt: "2026-11-12T13:39:17.010257Z",
  expiresAt: "2026-11-26T13:39:17.010257Z",
  relatedOrder: { orderId: "7ZK9D4D" },
  resolution: null,
  specification: { claimTypeDescription: "Wada ujawniona po odbiorze", requestedResolution: "REFUND" },
  state: "NEW",
  status: "NEW",
  updatedAt: "2026-11-12T13:39:17.010257Z",
  source: "ADMIN",
}

const full = {
  claimId: summary.claimId,
  displayId: summary.displayId,
  createdAt: summary.createdAt,
  expiresAt: summary.expiresAt,
  orderLines: [{ offer: { offerId: "19000144", product: { productId: "b1c48a86", name: "Kubek 380 ml", ean: null, quantity: 1, returnReason: null }, price: { amount: 47.97, currency: "PLN" } } }],
  relatedOrder: { orderId: "7ZK9D4D" },
  resolution: null,
  specification: {
    claimType: { id: "51b19f4d", description: "Wada ujawniona po odbiorze", claimCategory: { code: "DAMAGED_PRODUCT" } },
    issueDescription: "Kubek jest wyszczerbiony, posiada ubytek na krawędzi.",
    requestedResolution: "REFUND",
    partialRefundPercent: null,
  },
  state: "NEW",
  updatedAt: summary.updatedAt,
  claimDescription: "Kubek jest wyszczerbiony, posiada ubytek na krawędzi.",
  financialClaim: { claimValue: 47.97, currency: "PLN" },
  claimValue: 47.97,
  order: { orderId: "19000144-a52e", merchantOrderId: "7ZK9D4D" },
}

test("the list entry keeps the claim number, without products or value", () => {
  const c = parseClaim(summary)!
  assert.equal(c.displayId, "CL-7ZK9D4D-1")
  assert.equal(c.orderId, "7ZK9D4D")
  assert.equal(c.type, "Wada ujawniona po odbiorze")
  assert.equal(c.requested, "REFUND")
  assert.deepEqual(c.lines, [])
  assert.equal(c.valueMinor, null)
  const row = claimRow(c)
  assert.equal(row.display_id, "CL-7ZK9D4D-1")
  assert.equal(row.amount_minor, null)
})

test("the full claim gives the products, the value and the buyer's description", () => {
  const c = parseClaim(full)!
  assert.equal(c.displayId, "CL-7ZK9D4D-1")
  assert.equal(c.lines.length, 1)
  assert.equal(c.lines[0].name, "Kubek 380 ml")
  assert.equal(c.lines[0].priceMinor, 4797)
  assert.equal(c.valueMinor, 4797)
  assert.equal(c.description, "Kubek jest wyszczerbiony, posiada ubytek na krawędzi.")
  const row = claimRow(c)
  assert.equal(row.amount_minor, 4797)
  assert.equal((row.lines as unknown[]).length, 1)
  assert.equal("description" in row, false, "the buyer's words are read live, never stored")
})

test("the order id falls back to the merchant order id", () => {
  const c = parseClaim({ ...full, relatedOrder: undefined })!
  assert.equal(c.orderId, "7ZK9D4D")
})
