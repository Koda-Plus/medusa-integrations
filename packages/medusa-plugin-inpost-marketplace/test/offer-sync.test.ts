/**
 * Keeping a listed offer in step, the pure parts: what the marketplace's
 * answer about an offer changes on our row (an offer closed on the
 * marketplace's side becomes closed here, unless our own close did it; the
 * first publication is dated), what a finished command changes (a failed
 * create goes back to draft, a failed price or stock update is sent again),
 * what the sync sends (one command per offer per run: a moved price first,
 * a moved stock on the next run; a close at zero stock instead of a zero, a
 * reopen when stock comes back after our own close, nothing while a command
 * is pending), and how
 * Medusa's tracking numbers compare with the marketplace's parcels.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { afterEditStep, commandPatch, editStart, pushPlan, remotePatch, trackingStatus } from "../src/modules/vonhalsky/lib/offer-sync.ts"
import type { CommandState, RemoteOffer } from "../src/modules/vonhalsky/lib/remote.ts"

const NOW = new Date("2026-10-18T10:00:00Z")

const remote = (over: Partial<RemoteOffer> = {}): RemoteOffer => ({
  id: "off-1",
  externalId: "variant_1",
  status: "PUBLISHED",
  name: "Ceramic mug",
  sku: "SKU-1",
  ean: "5901234123457",
  categoryId: "leaf-1",
  stock: 3,
  grossPriceMinor: 4999,
  promotionPriceMinor: null,
  finalPriceMinor: 4999,
  promotion: null,
  program: null,
  validationErrors: [],
  rejectionReasons: [],
  imageCount: 2,
  createdAt: "2026-10-17T10:00:00.000Z",
  updatedAt: "2026-10-18T09:00:00.000Z",
  ...over,
})

const command = (status: CommandState["status"], errors: CommandState["errors"] = []): CommandState => ({ commandId: "cmd-1", offerId: "off-1", status, errors })

type Row = Record<string, unknown>
const row = (over: Row = {}): Row => ({
  id: "vhoff_1",
  status: "listed",
  remote_id: "off-1",
  remote_status: "PUBLISHED",
  command_kind: "create",
  command_status: "SUCCESS",
  price_minor: 4999,
  stock: 3,
  pushed_price_minor: 4999,
  pushed_stock: 3,
  ...over,
})

test("remote: the marketplace's status, prices, stock, promotion and program land on the row", () => {
  const p = remotePatch(
    row({ published_at: new Date("2026-10-17T11:00:00Z") }),
    remote({
      grossPriceMinor: 4999,
      promotionPriceMinor: 3999,
      finalPriceMinor: 3799,
      promotion: { start: "2026-10-18T00:00:00.000Z", end: "2026-10-25T00:00:00.000Z", status: "ACTIVE", mode: "PERCENTAGE", value: 20, isVisible: true },
      program: "IN",
    }),
    NOW,
  )
  assert.deepEqual(p, {
    remote_id: "off-1",
    remote_status: "PUBLISHED",
    remote_price_minor: 4999,
    remote_final_price_minor: 3799,
    remote_stock: 3,
    promotion: { start: "2026-10-18T00:00:00.000Z", end: "2026-10-25T00:00:00.000Z", status: "ACTIVE", mode: "PERCENTAGE", value: 20 },
    program: "IN",
    validation: [],
    image_count: 2,
    synced_at: NOW,
  })
})

test("remote: validation errors and rejection reasons become the row's validation list", () => {
  const p = remotePatch(row(), remote({ status: "REJECTED", validationErrors: [{ code: "IMAGES_REQUIRED", message: "Add an image." }], rejectionReasons: ["Prohibited product"] }), NOW)
  assert.deepEqual(p.validation, [
    { code: "IMAGES_REQUIRED", message: "Add an image." },
    { code: "REJECTED", message: "Prohibited product" },
  ])
  assert.equal(p.remote_status, "REJECTED")
})

test("remote: the first publication is dated once", () => {
  assert.deepEqual(remotePatch(row(), remote(), NOW).published_at, NOW)
  assert.equal("published_at" in remotePatch(row({ published_at: new Date("2026-10-01T00:00:00Z") }), remote(), NOW), false, "never moved later")
  assert.equal("published_at" in remotePatch(row(), remote({ status: "PENDING" }), NOW), false)
})

test("remote: an offer closed on the marketplace's side becomes closed here, so the sync never reopens it", () => {
  const p = remotePatch(row({ command_kind: "price" }), remote({ status: "CLOSED" }), NOW)
  assert.equal(p.status, "closed")
  assert.equal(p.remote_status, "CLOSED")
})

test("remote: an offer our own close took off stays listed, so it opens again when stock comes back", () => {
  const p = remotePatch(row({ command_kind: "close" }), remote({ status: "CLOSED" }), NOW)
  assert.equal("status" in p, false)
  assert.equal(p.remote_status, "CLOSED")
  assert.equal("status" in remotePatch(row({ status: "draft", command_kind: "price" }), remote({ status: "CLOSED" }), NOW), false, "only a listed row is closed")
})

test("command: success and pending only record the command's state", () => {
  assert.deepEqual(commandPatch(row(), command("SUCCESS"), NOW), { command_status: "SUCCESS", command_at: NOW })
  assert.deepEqual(commandPatch(row(), command("PENDING"), NOW), { command_status: "PENDING", command_at: NOW })
})

test("command: a failed create goes back to draft without a marketplace id", () => {
  const p = commandPatch(row({ command_kind: "create" }), command("FAILURE", [{ field: "product.description", message: "must not be blank" }, { field: null, message: "Category is not a leaf" }]), NOW)
  assert.deepEqual(p, {
    command_status: "FAILURE",
    command_at: NOW,
    status: "draft",
    remote_id: null,
    remote_status: null,
    pushed_price_minor: null,
    pushed_stock: null,
    error: "product.description: must not be blank; Category is not a leaf",
  })
})

test("command: a failed price or stock update is sent again on the next sync", () => {
  const price = commandPatch(row({ command_kind: "price" }), command("FAILURE", [{ field: null, message: "Price too low" }]), NOW)
  assert.deepEqual(price, { command_status: "FAILURE", command_at: NOW, pushed_price_minor: null, error: "Price too low" })
  const stock = commandPatch(row({ command_kind: "stock" }), command("FAILURE", [{ field: null, message: "Stock refused" }]), NOW)
  assert.deepEqual(stock, { command_status: "FAILURE", command_at: NOW, pushed_stock: null, error: "Stock refused" })
})

test("command: any other failure keeps the row and says why, a refusal without reasons too", () => {
  assert.deepEqual(commandPatch(row({ command_kind: "close" }), command("FAILURE", [{ field: null, message: "Already closed" }]), NOW), { command_status: "FAILURE", command_at: NOW, error: "Already closed" })
  assert.equal(commandPatch(row({ command_kind: "promotion" }), command("FAILURE"), NOW).error, "The marketplace refused the change.")
  const long = commandPatch(row({ command_kind: "patch" }), command("FAILURE", Array.from({ length: 20 }, (_, i) => ({ field: `f${i}`, message: "x".repeat(40) }))), NOW)
  assert.equal(String(long.error).length, 500)
})

test("push: a moved price is sent and the moved stock of the same offer waits for the next run", () => {
  const plan = pushPlan([row({ price_minor: 5499, stock: 7 })])
  assert.deepEqual(plan, {
    prices: [{ rowId: "vhoff_1", offerId: "off-1", grossPriceMinor: 5499 }],
    stocks: [],
    close: [],
    reopen: [],
  })
})

test("push: a moved stock is sent once the price is in step", () => {
  const plan = pushPlan([row({ price_minor: 5499, pushed_price_minor: 5499, stock: 7 })])
  assert.deepEqual(plan, { prices: [], stocks: [{ rowId: "vhoff_1", offerId: "off-1", quantity: 7 }], close: [], reopen: [] })
  assert.deepEqual(pushPlan([row({ price_minor: 0, stock: 7 })]).stocks, [{ rowId: "vhoff_1", offerId: "off-1", quantity: 7 }], "without a price the stock still goes")
})

test("push: one command per offer, offers apart from each other", () => {
  const plan = pushPlan([row({ id: "a", remote_id: "off-a", price_minor: 5499 }), row({ id: "b", remote_id: "off-b", stock: 9 })])
  assert.deepEqual(plan.prices, [{ rowId: "a", offerId: "off-a", grossPriceMinor: 5499 }])
  assert.deepEqual(plan.stocks, [{ rowId: "b", offerId: "off-b", quantity: 9 }])
})

test("push: nothing moved, nothing is sent", () => {
  assert.deepEqual(pushPlan([row()]), { prices: [], stocks: [], close: [], reopen: [] })
})

test("push: never a price of zero", () => {
  assert.deepEqual(pushPlan([row({ price_minor: 0 })]).prices, [])
  assert.deepEqual(pushPlan([row({ price_minor: null })]).prices, [])
})

test("push: zero stock closes a published offer instead of sending a zero", () => {
  const plan = pushPlan([row({ stock: 0 })])
  assert.deepEqual(plan.close, [{ rowId: "vhoff_1", offerId: "off-1" }])
  assert.deepEqual(plan.stocks, [])
  assert.deepEqual(plan.prices, [])
  assert.deepEqual(pushPlan([row({ stock: 0, remote_status: "SOLDOUT" })]), { prices: [], stocks: [], close: [], reopen: [] }, "sold out is already off sale")
  assert.deepEqual(pushPlan([row({ stock: -2, remote_status: "PENDING" })]), { prices: [], stocks: [], close: [], reopen: [] })
})

test("push: an offer our own close took off opens again when stock comes back", () => {
  assert.deepEqual(pushPlan([row({ remote_status: "CLOSED", command_kind: "close", stock: 4 })]).reopen, [{ rowId: "vhoff_1", offerId: "off-1" }])
  assert.deepEqual(pushPlan([row({ remote_status: "CLOSED", command_kind: "close", stock: 0 })]).reopen, [])
  assert.deepEqual(pushPlan([row({ remote_status: "CLOSED", command_kind: "price", stock: 4 })]), { prices: [], stocks: [], close: [], reopen: [] }, "closed by someone else stays closed")
})

test("push: a sold out offer gets its stock back, a pending one its new price", () => {
  assert.deepEqual(pushPlan([row({ remote_status: "SOLDOUT", stock: 5, pushed_stock: 0 })]).stocks, [{ rowId: "vhoff_1", offerId: "off-1", quantity: 5 }])
  assert.deepEqual(pushPlan([row({ remote_status: "PENDING", price_minor: 3999 })]).prices, [{ rowId: "vhoff_1", offerId: "off-1", grossPriceMinor: 3999 }])
})

test("push: rows that are not listed, not on the marketplace, rejected or waiting for a command are left alone", () => {
  const moved = { price_minor: 5499, stock: 0 }
  const plan = pushPlan([
    row({ ...moved, id: "a", status: "draft" }),
    row({ ...moved, id: "b", status: "closed" }),
    row({ ...moved, id: "c", remote_id: null }),
    row({ ...moved, id: "d", command_status: "PENDING" }),
    row({ ...moved, id: "e", remote_status: "REJECTED" }),
    row({ ...moved, id: "f", remote_status: null }),
  ])
  assert.deepEqual(plan, { prices: [], stocks: [], close: [], reopen: [] })
})

test("push: stock is a whole number", () => {
  assert.deepEqual(pushPlan([row({ stock: 4.6, pushed_stock: 3 })]).stocks, [{ rowId: "vhoff_1", offerId: "off-1", quantity: 5 }])
  assert.deepEqual(pushPlan([row({ stock: "6", pushed_stock: 3 })]).stocks, [{ rowId: "vhoff_1", offerId: "off-1", quantity: 6 }])
})

test("tracking: no number and no parcel is none", () => {
  assert.equal(trackingStatus([], []), "none")
})

test("tracking: a number the marketplace does not show yet is waiting", () => {
  assert.equal(trackingStatus(["111"], []), "waiting")
  assert.equal(trackingStatus(["111", "222"], [{ trackingNumber: "111" }]), "waiting", "every number has to be shown")
})

test("tracking: every number shown by the marketplace is linked, spaces do not matter", () => {
  assert.equal(trackingStatus(["111", "222"], [{ trackingNumber: "222" }, { trackingNumber: "111" }]), "linked")
  assert.equal(trackingStatus(["6800 0000 1234"], [{ trackingNumber: "680000001234" }]), "linked")
  assert.equal(trackingStatus([], [{ trackingNumber: "111" }]), "linked", "a parcel InPost linked without a Medusa number is linked too")
})

test("edit: how an edit reaches the marketplace", () => {
  assert.equal(editStart(row({ status: "draft", remote_id: null })), "local", "not on the marketplace")
  assert.equal(editStart(row({ status: "detached", remote_id: null })), "local")
  assert.equal(editStart(row({ command_status: "PENDING" })), "busy", "one command at a time")
  assert.equal(editStart(row({ remote_status: "PUBLISHED" })), "close", "a live offer is closed first")
  assert.equal(editStart(row({ remote_status: "SOLDOUT" })), "close")
  assert.equal(editStart(row({ remote_status: "PENDING" })), "patch", "in review: patched")
  assert.equal(editStart(row({ remote_status: "REJECTED" })), "patch")
  assert.equal(editStart(row({ remote_status: "CLOSED", command_kind: "close" })), "edit_patch", "closed by the sync at zero stock: patched, then back")
  assert.equal(editStart(row({ status: "closed", remote_status: "CLOSED", command_kind: "close" })), "patch", "closed by a person: stays closed")
})

test("edit: what follows each step", () => {
  assert.equal(afterEditStep(row({ command_kind: "edit_close" }), { status: "SUCCESS" }), "send_patch")
  assert.equal(afterEditStep(row({ command_kind: "edit_close" }), { status: "FAILURE" }), "none", "a refused close keeps the offer live")
  assert.equal(afterEditStep(row({ command_kind: "edit_patch", stock: 3 }), { status: "SUCCESS" }), "reopen")
  assert.equal(afterEditStep(row({ command_kind: "edit_patch", stock: 3 }), { status: "FAILURE" }), "reopen", "a refused patch never leaves the offer closed")
  assert.equal(afterEditStep(row({ command_kind: "edit_patch", stock: 0 }), { status: "SUCCESS" }), "park", "at zero stock it waits closed")
  assert.equal(afterEditStep(row({ command_kind: "edit_patch" }), { status: "PENDING" }), "none")
  assert.equal(afterEditStep(row({ command_kind: "price" }), { status: "SUCCESS" }), "none")
})

test("edit: an offer closed for an edit is ours: never taken off, reopened when an edit stopped half way", () => {
  for (const kind of ["edit_close", "edit_patch"]) {
    assert.equal(remotePatch(row({ command_kind: kind }), remote({ status: "CLOSED" }), NOW).status, undefined, `${kind} keeps the row listed`)
    assert.deepEqual(pushPlan([row({ command_kind: kind, remote_status: "CLOSED", stock: 2 })]).reopen.map((x) => x.rowId), ["vhoff_1"])
  }
  assert.equal(remotePatch(row({ command_kind: "patch" }), remote({ status: "CLOSED" }), NOW).status, "closed", "closed by someone else")
})
