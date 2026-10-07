/**
 * The small pure pieces: money in grosze, the receiver's phone, post code and
 * street, locker codes and the locker of the shipping method data, the
 * guards against a second parcel, masking.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { isEmail, normalizePhone, normalizePostCode, splitStreet } from "../src/modules/inpost/lib/address.ts"
import { externalShipmentId, shippedOutsideKey } from "../src/modules/inpost/lib/guards.ts"
import { isLockerCode, lockerAddressLine, lockerFromData, lockerMapUrl, normalizeLockerCode } from "../src/modules/inpost/lib/lockers.ts"
import { decimalString, firstMinor, formatMinor, minorToAmount, toMinor } from "../src/modules/inpost/lib/money.ts"
import { hint, maskSecrets, tokenState } from "../src/modules/inpost/lib/security.ts"
import { TOKEN } from "./helpers.ts"

test("money: every shape Medusa uses becomes exact grosze, rounded half up at the second decimal", () => {
  assert.equal(toMinor(199.99), 19999)
  assert.equal(toMinor(1.005), 101, "the float 1.005 is read as written, not as 1.00499...")
  assert.equal(toMinor(0.1 + 0.2), 30)
  assert.equal(toMinor(1565.0043), 156500)
  assert.equal(toMinor("249.90"), 24990)
  assert.equal(toMinor("12,5"), 1250)
  assert.equal(toMinor(7), 700)
  assert.equal(toMinor({ value: "199.99", precision: 20 }), 19999)
  assert.equal(toMinor({ numeric: 49.5 }), 4950)
  assert.equal(toMinor(-12.5), -1250)
  assert.equal(toMinor("abc"), null)
  assert.equal(toMinor(Number.NaN), null)
  assert.equal(toMinor(null), null)
  assert.equal(decimalString(BigInt(5)), "5")
  assert.equal(formatMinor(19999), "199.99")
  assert.equal(formatMinor(5), "0.05")
  assert.equal(formatMinor(-1250), "-12.50")
  assert.equal(minorToAmount(24990), 249.9)
  assert.equal(firstMinor(undefined, "x", 10), 1000)
  assert.equal(firstMinor(undefined, null), null)
  assert.equal(firstMinor(0, 5), 0, "zero is a value")
})

test("phone: Polish numbers as nine digits, anything else refused", () => {
  assert.equal(normalizePhone("+48 000 000 001"), "000000001")
  assert.equal(normalizePhone("0048000000001"), "000000001")
  assert.equal(normalizePhone("000-000-001"), "000000001")
  assert.equal(normalizePhone("48000000001"), "000000001")
  assert.equal(normalizePhone("12345"), null)
  assert.equal(normalizePhone("+49 30 000000"), null)
  assert.equal(normalizePhone(null), null)
})

test("post code and e-mail", () => {
  assert.equal(normalizePostCode("00950"), "00-950")
  assert.equal(normalizePostCode(" 00-950 "), "00-950")
  assert.equal(normalizePostCode("123"), "123")
  assert.equal(normalizePostCode("SW1A 1AA", "GB"), "SW1A 1AA")
  assert.equal(isEmail("anna.nowak@example.com"), true)
  assert.equal(isEmail("anna@example"), false)
  assert.equal(isEmail("a b@example.com"), false)
})

test("street, building and flat from Medusa's two address lines", () => {
  assert.deepEqual(splitStreet("ul. Kwiatowa 5/2"), { street: "ul. Kwiatowa", building_number: "5", flat_number: "2" })
  assert.deepEqual(splitStreet("Aleje Jerozolimskie 123A m. 4"), { street: "Aleje Jerozolimskie", building_number: "123A", flat_number: "4" })
  assert.deepEqual(splitStreet("Długa 5, m. 3"), { street: "Długa", building_number: "5", flat_number: "3" })
  assert.deepEqual(splitStreet("ul. Kwiatowa 5 m 3"), { street: "ul. Kwiatowa", building_number: "5", flat_number: "3" })
  assert.deepEqual(splitStreet("ul. Kwiatowa 5 a"), { street: "ul. Kwiatowa", building_number: "5a" })
  assert.deepEqual(splitStreet("ul. 3 Maja 12"), { street: "ul. 3 Maja", building_number: "12" })
  assert.deepEqual(splitStreet("Rynek", "7"), { street: "Rynek", building_number: "7" })
  assert.deepEqual(splitStreet("Kwiatowa", "5/2"), { street: "Kwiatowa", building_number: "5", flat_number: "2" })
  assert.deepEqual(splitStreet("Polna 1", "lok. 3"), { street: "Polna", building_number: "1", flat_number: "3" })
  assert.equal(splitStreet("ul. 11 Listopada"), null, "a street name with a number is not a building number")
  assert.equal(splitStreet("Bez numeru"), null, "no guessing: a person fixes the address")
  assert.equal(splitStreet(""), null)
})

test("locker codes: the shapes of the points API, normalized, never anything else", () => {
  for (const code of ["KRA01M", "WAW198M", "GDA05APP", "POP-WAW722", "KSP01M", "WAW01N", "KRA17HP"]) assert.equal(isLockerCode(code), true, code)
  for (const code of ["", "KRA", "01M", "KRA 01M", "KRA01M; DROP", "kra01m", "A1"]) assert.equal(isLockerCode(code), false, code)
  assert.equal(normalizeLockerCode(" kra 01m "), "KRA01M")
})

test("the locker of the shipping method data: machine_* first, the shapes of other storefronts too", () => {
  const address = { line1: "ul. Narzędziowa 12", line2: "00-950 Warszawa", city: "Warszawa", post_code: "00-950" }
  assert.deepEqual(lockerFromData({ machine_id: "ksp01m", machine_name: "KSP01M", machine_address: address }), { code: "KSP01M", name: "KSP01M", address })
  assert.deepEqual(lockerFromData({ target_point: "KSP02A" }), { code: "KSP02A", name: null, address: null })
  assert.deepEqual(lockerFromData({ locker: { code: "KSP03K", address: { line1: "x" } } })?.code, "KSP03K")
  assert.equal(lockerFromData({}), null)
  assert.equal(lockerFromData(null), null)
  assert.equal(lockerAddressLine(address), "ul. Narzędziowa 12, 00-950 Warszawa")
  assert.match(lockerMapUrl({ code: "KSP01M", address }) ?? "", /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Paczkomat%20KSP01M/)
  assert.equal(lockerMapUrl(null), null)
})

test("guards: a configured metadata key stops the creation; only an object names a shipment to track", () => {
  const keys = ["inpost_shipment", "wz_numer"]
  assert.equal(shippedOutsideKey({ inpost_shipment: { shipment_id: 123 } }, keys), "inpost_shipment")
  assert.equal(shippedOutsideKey({ wz_numer: "WZ 1/10/2026" }, keys), "wz_numer")
  assert.equal(shippedOutsideKey({ wz_numer: "" }, keys), null)
  assert.equal(shippedOutsideKey({ inpost_shipment: {} }, keys), null)
  assert.equal(shippedOutsideKey({ inpost_shipment: false }, keys), null)
  assert.equal(shippedOutsideKey({ other: 1 }, keys), null)
  assert.equal(shippedOutsideKey({ inpost_shipment: { shipment_id: 1 } }, []), null, "no keys configured, no guard (the default)")
  assert.equal(externalShipmentId({ shipment_id: 123 }), "123")
  assert.equal(externalShipmentId({ shipment_ids: ["456", "457"] }), "456")
  assert.equal(externalShipmentId("123"), null, "a bare number may be an ERP document")
  assert.equal(externalShipmentId({ shipment_id: "abc" }), null)
})

test("masking: the token, Bearer values and long token-like runs; tracking numbers stay readable", () => {
  const text = `failed with ${TOKEN} and Authorization: Bearer ${TOKEN}; tracking 600000000000000000001042`
  const masked = maskSecrets(text, [TOKEN])
  assert.equal(masked.includes(TOKEN), false)
  assert.equal(masked.includes("eyJ"), false)
  assert.ok(masked.includes("600000000000000000001042"))
  assert.equal(maskSecrets("a".repeat(45), []), "***")
  assert.equal(tokenState(""), "missing")
  assert.equal(tokenState("x"), "set")
  assert.equal(hint("a1b2c3d4e5f6a7b8c9d0e1f2"), "a1b2...e1f2")
  assert.equal(hint(""), null)
})
