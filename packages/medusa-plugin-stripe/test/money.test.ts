import { test } from "node:test"
import assert from "node:assert/strict"
import { basisPoints, currencyExponent, decimalString, formatMoney, formatMoneyList, minorToDecimal, money, MoneyBag, sumMoney, toMinor } from "../src/modules/stripe/lib/money.ts"

/** Intl puts no-break and narrow no-break spaces in Polish numbers; compare with plain ones. */
const SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, "g")
const plain = (s: string) => s.replace(SPACES, " ")

test("exponents follow Stripe: two decimals, zero-decimal and three-decimal currencies", () => {
  assert.equal(currencyExponent("pln"), 2)
  assert.equal(currencyExponent("PLN"), 2)
  assert.equal(currencyExponent("eur"), 2)
  assert.equal(currencyExponent("jpy"), 0)
  assert.equal(currencyExponent("huf"), 2)
  assert.equal(currencyExponent("kwd"), 3)
})

test("minor units become a decimal string by moving the point, never by dividing", () => {
  assert.equal(minorToDecimal(12345, "pln"), "123.45")
  assert.equal(minorToDecimal(5, "pln"), "0.05")
  assert.equal(minorToDecimal(-5, "pln"), "-0.05")
  assert.equal(minorToDecimal(0, "pln"), "0.00")
  assert.equal(minorToDecimal(500, "jpy"), "500")
  assert.equal(minorToDecimal(1234, "kwd"), "1.234")
  assert.equal(minorToDecimal(90071992547409, "pln"), "900719925474.09")
  assert.equal(minorToDecimal(1.5, "pln"), "0", "a float is not an amount")
})

test("formatting: Polish and English, the currency's own decimals", () => {
  assert.equal(plain(formatMoney(123456, "pln", "pl")), "1234,56 zł")
  assert.equal(plain(formatMoney(1234567, "pln", "pl")), "12 345,67 zł")
  assert.equal(plain(formatMoney(123456, "pln", "en")), "PLN 1,234.56")
  assert.equal(plain(formatMoney(-990, "pln", "pl")), "-9,90 zł")
  assert.equal(plain(formatMoney(1200, "eur", "pl")), "12,00 €")
  assert.equal(plain(formatMoney(500, "jpy", "en")), "¥500")
  assert.equal(plain(formatMoneyList([{ amount: 100, currency: "pln" }, { amount: 250, currency: "eur" }], "pl")), "1,00 zł, 2,50 €")
  assert.equal(formatMoneyList([], "pl", "none"), "none")
  /* An unknown currency code still prints the amount. */
  assert.match(plain(formatMoney(100, "xx1", "en")), /1\.00/)
})

test("money() accepts only integers and a three-letter currency", () => {
  assert.deepEqual(money(1999, "PLN"), { amount: 1999, currency: "pln" })
  assert.equal(money(19.99, "pln"), null)
  assert.equal(money("1999", "pln"), null)
  assert.equal(money(1999, "zł"), null)
  assert.equal(money(1999, null), null)
})

test("MoneyBag sums integers per currency and refuses anything else", () => {
  const bag = new MoneyBag()
  bag.add({ amount: 1999, currency: "pln" }).add({ amount: 1, currency: "PLN" }).add({ amount: 500, currency: "eur" })
  bag.add({ amount: 0.5, currency: "pln" })
  bag.add(null)
  bag.add({ amount: 300, currency: "pln" }, -1)
  assert.equal(bag.amountOf("pln"), 1700)
  assert.deepEqual(bag.list(), [
    { amount: 1700, currency: "pln" },
    { amount: 500, currency: "eur" },
  ])
  assert.throws(() => new MoneyBag().add({ amount: Number.MAX_SAFE_INTEGER, currency: "pln" }).add({ amount: 10, currency: "pln" }), RangeError)
  assert.deepEqual(sumMoney([{ amount: 1, currency: "eur" }, { amount: 2, currency: "eur" }, null]), [{ amount: 3, currency: "eur" }])
})

test("major units from Medusa become minor units without float errors, half away from zero", () => {
  assert.equal(toMinor("199.99", "pln"), 19999)
  assert.equal(toMinor(199.99, "pln"), 19999)
  assert.equal(toMinor("199.995", "pln"), 20000)
  assert.equal(toMinor("199.994", "pln"), 19999)
  assert.equal(toMinor(0.1 + 0.2, "pln"), 30)
  assert.equal(toMinor("12,5", "pln"), 1250)
  assert.equal(toMinor("-10.005", "pln"), -1001)
  assert.equal(toMinor("-0.004", "pln"), 0)
  assert.equal(toMinor("1500", "jpy"), 1500)
  assert.equal(toMinor("1.2345", "kwd"), 1235)
  /* Medusa's BigNumber: the exact decimal sits in raw.value. */
  assert.equal(toMinor({ raw: { value: "123.45000000000000000", precision: 20 }, numeric: 123.45 }, "pln"), 12345)
  assert.equal(toMinor({ numeric: 10.5 }, "pln"), 1050)
  assert.equal(toMinor({ toJSON: () => 7 }, "pln"), 700)
  assert.equal(toMinor("abc", "pln"), null)
  assert.equal(toMinor(null, "pln"), null)
  assert.equal(toMinor(Number.NaN, "pln"), null)
  assert.equal(decimalString(1e-7), "0")
})

test("basis points stay integers", () => {
  assert.equal(basisPoints(10_000, 150), 150)
  assert.equal(basisPoints(12_345, 160), 198)
  assert.equal(basisPoints(1.5, 150), 0)
})
