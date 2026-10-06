import { test } from "node:test"
import assert from "node:assert/strict"
import {
  amountFromMedusa,
  currencyDigits,
  formatAmount,
  multiply,
  normalizeCurrency,
  parseAmount,
  percentBelow,
  roundPrice,
  sumByCurrency,
  toMajorNumber,
} from "../src/modules/negotiations/lib/money.ts"
import { MAX_AMOUNT } from "../src/modules/negotiations/lib/constants.ts"

test("decimals come from the currency: 2 for PLN and EUR, 0 for JPY, 3 for KWD, 2 for an unknown code", () => {
  assert.equal(currencyDigits("pln"), 2)
  assert.equal(currencyDigits("EUR"), 2)
  assert.equal(currencyDigits("jpy"), 0)
  assert.equal(currencyDigits("kwd"), 3)
  assert.equal(currencyDigits("zzz"), 2)
  assert.equal(currencyDigits(null), 2)
  assert.equal(normalizeCurrency(" PLN "), "pln")
  assert.equal(normalizeCurrency("zł"), null)
})

test("prices typed by people become exact minor units", () => {
  const ok = (input: unknown, digits = 2) => {
    const r = parseAmount(input, digits)
    assert.ok(r.ok, `${String(input)} should parse`)
    return r.ok ? r.amount : NaN
  }
  assert.equal(ok("469"), 46900)
  assert.equal(ok("469.00"), 46900)
  assert.equal(ok("469,5"), 46950, "a comma is the decimal separator when there is no dot")
  assert.equal(ok(" 0.05 "), 5)
  assert.equal(ok(38.5), 3850)
  assert.equal(ok("12.500"), 1250, "zeros beyond the currency's decimals are fine")
  assert.equal(ok("1200", 0), 1200)
  assert.equal(ok("1.250", 3), 1250)
  assert.equal(ok("007.10"), 710)
})

test("anything ambiguous or wrong is refused, never rounded", () => {
  const err = (input: unknown, digits = 2) => {
    const r = parseAmount(input, digits)
    assert.equal(r.ok, false, `${String(input)} should be refused`)
    return r.ok ? "" : r.error
  }
  assert.equal(err(undefined), "required")
  assert.equal(err("  "), "required")
  assert.equal(err("1 234,50"), "invalid")
  assert.equal(err("1,234.50"), "invalid")
  assert.equal(err("12.345"), "too_many_decimals")
  assert.equal(err(0.1 + 0.2), "too_many_decimals", "a float that is not what it looks like")
  assert.equal(err("12.5", 0), "too_many_decimals")
  assert.equal(err("-5"), "not_positive")
  assert.equal(err(-5), "not_positive")
  assert.equal(err("0"), "not_positive")
  assert.equal(err("0.00"), "not_positive")
  assert.equal(err("abc"), "invalid")
  assert.equal(err({ value: 5 }), "invalid")
  assert.equal(err(Number.NaN), "invalid")
  assert.equal(err(1e21), "too_large")
  assert.equal(err("999999999999999"), "too_large")
  assert.equal(err(String(MAX_AMOUNT / 100 + 1)), "too_large", "the integer column has a ceiling")
})

test("minor units back to decimal text, exactly", () => {
  assert.equal(formatAmount(46900, 2), "469.00")
  assert.equal(formatAmount(5, 2), "0.05")
  assert.equal(formatAmount(1200, 0), "1200")
  assert.equal(formatAmount(1250, 3), "1.250")
  assert.equal(formatAmount(-5, 2), "-0.05")
  assert.equal(toMajorNumber(3850, 2), 38.5)
  for (const n of [1, 29, 99, 101, 3850, 46900, 123456789]) {
    const r = parseAmount(formatAmount(n, 2), 2)
    assert.ok(r.ok && r.amount === n, `round trip of ${n}`)
  }
})

test("Medusa amounts (numbers, strings, BigNumber shapes) round half up to the currency", () => {
  assert.equal(amountFromMedusa(549, 2), 54900)
  assert.equal(amountFromMedusa("42.90", 2), 4290)
  assert.equal(amountFromMedusa(12.345, 2), 1235)
  assert.equal(amountFromMedusa(12.344, 2), 1234)
  assert.equal(amountFromMedusa({ value: "12.5" }, 2), 1250)
  assert.equal(amountFromMedusa({ numeric: 3 }, 0), 3)
  assert.equal(amountFromMedusa("38.5", 2), 3850, "the app module's numeric target_price")
  assert.equal(amountFromMedusa(-1, 2), null)
  assert.equal(amountFromMedusa("n/a", 2), null)
  assert.equal(amountFromMedusa(null, 2), null)
})

test("values: integer products, a discount with one decimal, sums only within a currency", () => {
  assert.equal(multiply(46900, 24), 1125600)
  assert.equal(multiply(null, 3), null)
  assert.equal(multiply(Number.MAX_SAFE_INTEGER, 2), null, "never an inexact value")
  assert.equal(percentBelow(54900, 46900), 14.6)
  assert.equal(percentBelow(0, 100), null)
  assert.equal(percentBelow(null, 100), null)
  assert.deepEqual(sumByCurrency([
    { currency: "pln", amount: 100 },
    { currency: "eur", amount: 50 },
    { currency: "pln", amount: 25 },
    { currency: null, amount: 7 },
    { currency: "eur", amount: null },
  ]), [
    { currency: "pln", amount: 125 },
    { currency: "eur", amount: 50 },
  ])
})

test("round prices for the demo story: whole units from 100, halves from 10, tenths below", () => {
  assert.equal(roundPrice(54900, 0.85, 2), 46700)
  assert.equal(roundPrice(2200, 0.85, 2), 1850)
  assert.equal(roundPrice(450, 0.85, 2), 380)
  assert.equal(roundPrice(1200, 0.85, 0), 1020)
  assert.ok(roundPrice(1, 0.5, 2) >= 1, "never zero")
})
