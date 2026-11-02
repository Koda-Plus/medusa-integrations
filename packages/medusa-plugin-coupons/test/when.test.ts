/**
 * Coupon dates with an optional time in the store's zone: a day without a
 * time is the whole day there (so "until 4 Nov" ends at the end of 4 Nov in
 * Warsaw, summer and winter), a typed time is exact, and reading back says a
 * time only when it was typed. Older coupons kept as UTC days read as those
 * days. The short sentence says the hours only when there are any.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { cleanZone, edgeIso, edgeParts, edgeTime } from "../src/modules/coupons/lib/when.ts"
import { couponSentence } from "../src/admin/lib/coupons-sentence.ts"
import { toCouponDto } from "../src/modules/coupons/lib/describe.ts"
import pl from "../src/admin/i18n/pl.ts"

const WAW = "Europe/Warsaw"

test("a day without a time is the whole day in the store's zone", () => {
  /* Winter: UTC+1. */
  assert.equal(edgeIso("2026-11-04", null, "start", WAW), "2026-11-03T23:00:00.000Z")
  assert.equal(edgeIso("2026-11-04", "", "end", WAW), "2026-11-04T22:59:59.999Z")
  /* Summer: UTC+2. */
  assert.equal(edgeIso("2026-07-01", null, "start", WAW), "2026-06-30T22:00:00.000Z")
  assert.equal(edgeIso("2026-07-01", null, "end", WAW), "2026-07-01T21:59:59.999Z")
  /* The DST change days. */
  assert.equal(edgeIso("2026-03-29", null, "end", WAW), "2026-03-29T21:59:59.999Z")
  assert.equal(edgeIso("2026-10-25", null, "start", WAW), "2026-10-24T22:00:00.000Z")
})

test("a typed time is exact, broken input gives nothing", () => {
  assert.equal(edgeIso("2026-11-04", "10:00", "start", WAW), "2026-11-04T09:00:00.000Z")
  assert.equal(edgeIso("2026-11-04", "14:30", "end", WAW), "2026-11-04T13:30:00.000Z")
  assert.equal(edgeIso("2026-11-04", "25:00", "end", WAW), "2026-11-04T22:59:59.999Z", "a broken time counts as none")
  assert.equal(edgeIso("", "10:00", "start", WAW), null)
  assert.equal(edgeIso("4.11.2026", null, "start", WAW), null)
  assert.equal(edgeIso("2026-11-04", null, "start", "UTC"), "2026-11-04T00:00:00.000Z")
  assert.equal(cleanZone("Mars/Olympus"), undefined)
  assert.equal(cleanZone(" Europe/Warsaw "), WAW)
})

test("reading back: the day, and a time only when typed", () => {
  assert.deepEqual(edgeParts("2026-11-03T23:00:00.000Z", "start", WAW), { day: "2026-11-04", time: null })
  assert.deepEqual(edgeParts("2026-11-04T22:59:59.999Z", "end", WAW), { day: "2026-11-04", time: null })
  assert.deepEqual(edgeParts("2026-11-04T09:00:00.000Z", "start", WAW), { day: "2026-11-04", time: "10:00" })
  assert.deepEqual(edgeParts("2026-11-04T13:00:00.000Z", "end", WAW), { day: "2026-11-04", time: "14:00" })
  /* A preset that started "now" (seconds, milliseconds) says no time. */
  assert.equal(edgeTime("2026-11-04T09:13:27.512Z", "start", WAW), null)
  /* Older creators: a UTC day (00:00:00Z to 23:59:59Z) reads as that day, not the next. */
  assert.deepEqual(edgeParts("2026-11-04T00:00:00.000Z", "start", WAW), { day: "2026-11-04", time: null })
  assert.deepEqual(edgeParts("2026-11-04T23:59:59.000Z", "end", WAW), { day: "2026-11-04", time: null })
  assert.equal(edgeParts(null, "start", WAW), null)
  assert.equal(edgeParts("nonsense", "end", WAW), null)
})

function translator(dict: Record<string, unknown>) {
  return (key: string, o: Record<string, unknown> = {}) => {
    const v = key.split(".").reduce<unknown>((n, p) => (n && typeof n === "object" ? (n as Record<string, unknown>)[p] : undefined), dict)
    return String(v ?? o.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(o[k] ?? ""))
  }
}
const t = translator(pl as unknown as Record<string, unknown>)
const dayLabel = (day: string) => {
  const [y, m, d] = day.split("-").map(Number)
  return new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)))
}
const fmt = {
  lang: "pl-PL",
  money: (n: number) => `${n} zł`,
  date: (iso: string) => new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", year: "numeric", timeZone: WAW }).format(new Date(iso)),
  edge: (iso: string, edge: "start" | "end") => {
    const p = edgeParts(iso, edge, WAW)
    return p ? { date: dayLabel(p.day), time: p.time } : { date: iso, time: null }
  },
}
const plain = (s: string) => s.replace(/[  ]/g, " ")
const sentenceOf = (starts: string | null, ends: string | null) =>
  plain(
    couponSentence(
      toCouponDto({ id: "p_h", code: "GODZINY10", status: "active", campaign: { starts_at: starts, ends_at: ends }, application_method: { type: "percentage", target_type: "order", value: 10 } }, undefined, new Date("2026-10-01T00:00:00Z")),
      { groups: {}, categories: {}, products: {}, customers: {} },
      t,
      fmt,
      "pln",
    ),
  )

test("the sentence: hours only when there are any", () => {
  const day = (time: string | null, edge: "start" | "end") => edgeIso("2026-11-04", time, edge, WAW)
  assert.match(sentenceOf(day(null, "start"), day(null, "end")), /tylko 4 lis 2026(?![,\d ]*\d:)/)
  assert.match(sentenceOf(day("10:00", "start"), day("14:00", "end")), /tylko 4 lis 2026, 10:00–14:00/)
  assert.match(sentenceOf(day("10:00", "start"), day(null, "end")), /tylko 4 lis 2026 od 10:00/)
  assert.match(sentenceOf(day(null, "start"), day("14:00", "end")), /tylko 4 lis 2026 do 14:00/)
  assert.match(sentenceOf(day("10:00", "start"), edgeIso("2026-11-06", null, "end", WAW)), /od 4 lis 2026 10:00 do 6 lis 2026/)
  assert.doesNotMatch(sentenceOf(day("10:00", "start"), edgeIso("2026-11-06", null, "end", WAW)), /6 lis 2026 \d/)
  assert.match(sentenceOf(null, edgeIso("2026-11-06", "18:00", "end", WAW)), /do 6 lis 2026 18:00/)
  /* Without the store's zone helper the sentence says days, as before. */
  const { edge: _e, ...days } = fmt
  void _e
  const old = plain(couponSentence(toCouponDto({ id: "p_o", code: "STARE", status: "active", campaign: { starts_at: day("10:00", "start"), ends_at: day("14:00", "end") }, application_method: { type: "percentage", target_type: "order", value: 10 } }, undefined, new Date("2026-10-01T00:00:00Z")), { groups: {}, categories: {}, products: {}, customers: {} }, t, days, "pln"))
  assert.match(old, /tylko 4 lis 2026/)
  assert.doesNotMatch(old, /10:00/)
})
