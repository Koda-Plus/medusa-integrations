import { test } from "node:test"
import assert from "node:assert/strict"
import { BaseLinkerApiError, BaseLinkerUnknownResultError } from "../src/modules/baselinker/lib/errors.ts"
import { createOrderOnce, findOrderByMarker, type ScannedOrder } from "../src/modules/baselinker/lib/exactly-once.ts"

const MARKER = "[medusa:order_42]"

function page(fromId: number, size: number, markerAt?: number): ScannedOrder[] {
  return Array.from({ length: size }, (_, i) => ({
    order_id: fromId + i,
    admin_comments: fromId + i === markerAt ? `${MARKER} Medusa #42` : `Allegro ${fromId + i}`,
  }))
}

test("the scan pages by id_from, inclusive, so the next page starts at the highest id plus one", async () => {
  const seen: Array<Record<string, unknown>> = []
  const id = await findOrderByMarker(
    async (params) => {
      seen.push(params)
      return params.id_from === undefined ? page(1000, 100) : page(Number(params.id_from), 100, 1150)
    },
    MARKER,
    1_790_000_000,
  )
  assert.equal(id, "1150")
  assert.equal(seen.length, 2)
  assert.deepEqual(seen[0], { date_from: 1_790_000_000 - 3600, get_unconfirmed_orders: true })
  assert.equal(seen[1].id_from, 1100)
})

test("the scan ends on a short page, and its ceiling is an error, not a silent miss", async () => {
  assert.equal(await findOrderByMarker(async () => page(1, 7), MARKER, 1_790_000_000), null)
  await assert.rejects(
    findOrderByMarker(async (params) => page(Number(params.id_from ?? 1), 100), MARKER, 1_790_000_000, 3),
    (err: unknown) => err instanceof BaseLinkerApiError && err.code === "SCAN_CEILING" && !err.transient,
  )
})

test("an order already in BaseLinker is adopted and addOrder is never called", async () => {
  let added = 0
  const res = await createOrderOnce({
    findExisting: async () => "9100007",
    addOrder: async () => {
      added += 1
      return "1"
    },
  })
  assert.deepEqual(res, { blOrderId: "9100007", adopted: true })
  assert.equal(added, 0)
})

test("after an unknown result the scan runs again and adopts what BaseLinker created", async () => {
  let scans = 0
  const res = await createOrderOnce({
    findExisting: async () => (++scans === 1 ? null : "9100008"),
    addOrder: async () => {
      throw new BaseLinkerUnknownResultError("addOrder", new Error("timeout"))
    },
    sleep: async () => undefined,
  })
  assert.deepEqual(res, { blOrderId: "9100008", adopted: true })
  assert.equal(scans, 2)
})

test("an unknown result that the second scan cannot settle stays unknown (retried later, scan first)", async () => {
  let added = 0
  await assert.rejects(
    createOrderOnce({
      findExisting: async () => null,
      addOrder: async () => {
        added += 1
        throw new BaseLinkerUnknownResultError("addOrder", new Error("HTTP_502"))
      },
      sleep: async () => undefined,
    }),
    BaseLinkerUnknownResultError,
  )
  assert.equal(added, 1, "never a blind second addOrder")
})

test("a permanent refusal is not followed by a scan, and a success without an id counts as unknown", async () => {
  let scans = 0
  await assert.rejects(
    createOrderOnce({
      findExisting: async () => {
        scans += 1
        return null
      },
      addOrder: async () => {
        throw new BaseLinkerApiError({ code: "ERROR_BAD_PARAMETERS", method: "addOrder", message: "", transient: false })
      },
    }),
    (err: unknown) => err instanceof BaseLinkerApiError && err.code === "ERROR_BAD_PARAMETERS",
  )
  assert.equal(scans, 1)

  let rescans = 0
  const adopted = await createOrderOnce({
    findExisting: async () => (++rescans === 1 ? null : "9100009"),
    addOrder: async () => "",
    sleep: async () => undefined,
  })
  assert.deepEqual(adopted, { blOrderId: "9100009", adopted: true })
})
