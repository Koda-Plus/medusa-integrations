import { test } from "node:test"
import assert from "node:assert/strict"
import { isCallAllowed, isCreatingMethod, isReadMethod, maskSecrets } from "../src/modules/baselinker/lib/security.ts"

test("barrier: every get* method passes, with or without order export", () => {
  for (const method of ["getInventories", "getInventoryProductsList", "getOrders", "getOrderStatusList", "getInventoryWarehouses"]) {
    assert.equal(isCallAllowed({ method, exportOrders: true }).ok, true, method)
    assert.equal(isCallAllowed({ method, exportOrders: false }).ok, true, method)
  }
})

test("barrier: addOrder is the only write, and only while exportOrders is on", () => {
  assert.equal(isCallAllowed({ method: "addOrder", exportOrders: true }).ok, true)
  const off = isCallAllowed({ method: "addOrder", exportOrders: false })
  assert.equal(off.ok, false)
  assert.match(off.ok ? "" : off.reason, /exportOrders/)
})

test("barrier: stock, price, card and order changes are blocked by name", () => {
  for (const method of [
    "updateInventoryProductsStock",
    "updateInventoryProductsPrices",
    "addInventoryProduct",
    "deleteInventoryProduct",
    "deleteOrder",
    "setOrderStatus",
    "setOrderFields",
    "setOrderPayment",
    "createPackage",
    "addInvoice",
    "runOrderMacroTrigger",
    "getorders",
    "",
  ]) {
    const verdict = isCallAllowed({ method, exportOrders: true })
    assert.equal(verdict.ok, false, `${method} must be blocked`)
  }
})

test("method kinds: reads by the get prefix, creating methods by add/create", () => {
  assert.equal(isReadMethod("getOrders"), true)
  assert.equal(isReadMethod("getorders"), false)
  assert.equal(isCreatingMethod("addOrder"), true)
  assert.equal(isCreatingMethod("createPackage"), true)
  assert.equal(isCreatingMethod("updateInventoryProductsStock"), false)
  assert.equal(isCreatingMethod("address"), false)
})

test("masking: the token literally, long base64-like runs, readable ids survive", () => {
  const token = "5012345-5067890-QWERTYUIOPASDFGHJKLZXCVBNM1234567890ABCDEFGHIJKLMNOP"
  const other = "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4"
  const out = maskSecrets(
    `token ${token} echoed, other ${other}, order order_01JDEMO0000000000000000001, EAN 5901234123457, parcel 520113014230722029585646`,
    [token, null, undefined],
  )
  assert.ok(!out.includes(token))
  assert.ok(!out.includes("QWERTYUIOPASDFGHJKLZXCVBNM"))
  assert.ok(!out.includes(other))
  assert.ok(out.includes("order_01JDEMO0000000000000000001"))
  assert.ok(out.includes("5901234123457"))
  assert.ok(out.includes("520113014230722029585646"))
})

test("masking: short configured values are not used as needles", () => {
  assert.equal(maskSecrets("price 100 PLN", ["100"]), "price 100 PLN")
})
