/**
 * "Import from InPost", the matching: an offer linked already is only read
 * again; a new one is matched by its external id (our variant id), then the
 * SKU (any case), the EAN (digits only, a leading zero of a GTIN-14 does
 * not count), the manufacturer part number; the first key that matches
 * anything decides, and only one row may match it; a row that follows
 * another offer, or was just claimed by one, is not taken twice; what
 * matches nothing is reported with its name, SKU and EAN.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { importPlan, type ImportRow } from "../src/modules/vonhalsky/lib/offer-import.ts"
import type { RemoteOffer } from "../src/modules/vonhalsky/lib/remote.ts"

const remote = (id: string, over: Partial<RemoteOffer> = {}): RemoteOffer => ({
  id,
  externalId: null,
  status: "PUBLISHED",
  name: `Offer ${id}`,
  sku: null,
  ean: null,
  mpn: null,
  categoryId: null,
  stock: 1,
  grossPriceMinor: 1000,
  promotionPriceMinor: null,
  finalPriceMinor: 1000,
  promotion: null,
  program: null,
  validationErrors: [],
  rejectionReasons: [],
  imageCount: 1,
  createdAt: null,
  updatedAt: null,
  ...over,
})

const ROWS: ImportRow[] = [
  { id: "vhoff_1", variant_id: "variant_1", sku: "KS-CLT-HOD-M", ean: "5901234123457", mpn: "HOD-M", remote_id: null },
  { id: "vhoff_2", variant_id: "variant_2", sku: "KS-CLT-HOD-L", ean: null, mpn: "HOD-L", remote_id: null },
  { id: "vhoff_3", variant_id: "variant_3", sku: "KS-OFF-MUG", ean: null, mpn: "SHARED", remote_id: "off-linked" },
  { id: "vhoff_4", variant_id: "variant_4", sku: "KS-OFF-PEN", ean: null, mpn: "SHARED", remote_id: null },
  { id: "vhoff_5", variant_id: "variant_5", sku: "KS-OFF-LAN", ean: null, mpn: "SHARED", remote_id: null },
]

test("import: linked offers are read again, new ones matched by external id, SKU, EAN, part number", () => {
  const plan = importPlan(
    [
      remote("off-linked"),
      remote("off-a", { externalId: "variant_2", sku: "KS-CLT-HOD-M" }),
      remote("off-b", { sku: " ks-off-pen " }),
      remote("off-c", { ean: "05901234123457" }),
      remote("off-d", { mpn: "hod-m" }),
    ],
    ROWS,
  )
  assert.deepEqual(plan.refresh.map((x) => [x.rowId, x.remote.id]), [["vhoff_3", "off-linked"]])
  assert.deepEqual(
    plan.link.map((x) => [x.remote.id, x.rowId, x.by]),
    [
      ["off-a", "vhoff_2", "external_id"],
      ["off-b", "vhoff_4", "sku"],
      ["off-c", "vhoff_1", "ean"],
    ],
    "the external id wins over a SKU of another variant",
  )
  assert.deepEqual(plan.unmatched.map((u) => [u.id, u.reason]), [["off-d", "taken"]], "a variant is linked once")
})

test("import: an ambiguous key is reported, not guessed; nothing matching is reported with its facts", () => {
  const plan = importPlan([remote("off-x", { mpn: "SHARED" }), remote("off-y", { name: "Termos 500 ml", sku: "ERP-1", ean: "4006381333931" })], ROWS)
  assert.deepEqual(plan.link, [])
  assert.deepEqual(plan.unmatched, [
    { id: "off-x", name: "Offer off-x", sku: null, ean: null, status: "PUBLISHED", reason: "ambiguous" },
    { id: "off-y", name: "Termos 500 ml", sku: "ERP-1", ean: "4006381333931", status: "PUBLISHED", reason: "no_match" },
  ])
})

test("import: a row that follows another offer is never taken over", () => {
  const plan = importPlan([remote("off-new", { externalId: "variant_3" })], ROWS)
  assert.deepEqual(plan.unmatched.map((u) => u.reason), ["taken"])
})
