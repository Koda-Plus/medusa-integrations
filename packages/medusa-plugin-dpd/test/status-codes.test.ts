/**
 * The code map of 6.3: every row of the table, notifications, the exact code
 * over the longest prefix, and what statusMap of the options may change
 * (only the stage, E16).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { SIM_IN_POINT } from "../src/modules/dpd/lib/constants.ts"
import { BUILTIN_CODE_RULES, buildCodeMap } from "../src/modules/dpd/lib/status-codes.ts"

const map = buildCodeMap({})

type Row = { codes: string[]; stage: string; possession: boolean; repin?: "redirect" | "return"; notification?: true; source: string }

/* The table of 6.3, row by row; a prefix row is pinned by codes under it. */
const TABLE: Row[] = [
  { codes: ["030103"], stage: "preparing", possession: false, source: "lib" },
  { codes: ["040101", "040102"], stage: "in_transit", possession: true, source: "lib" },
  { codes: ["040200", "040201", "040305", "040401", "040501", "040605"], stage: "problem", possession: false, source: "lib" },
  { codes: ["050101", "120101", "160101", "160103", "160501", "330135", "330137", "230101", "320201"], stage: "in_transit", possession: true, source: "lib" },
  { codes: ["160102", "160202", "170205", "230201", "260403"], stage: "problem", possession: true, source: "lib" },
  { codes: ["170101", "170102"], stage: "in_transit", possession: true, source: "pdf" },
  { codes: ["170301", "170303", "170305", "170399"], stage: "in_transit", possession: false, notification: true, source: "lib" },
  { codes: ["170302", "110302", "150301", "250301", "320202"], stage: "in_transit", possession: true, source: "lib" },
  { codes: ["190101"], stage: "delivered", possession: true, source: "pdf" },
  { codes: ["190102", "190201"], stage: "delivered", possession: true, source: "lib" },
  { codes: ["200201", "200300", "200306", "200500", "200601", "200801"], stage: "in_transit", possession: true, source: "lib" },
  { codes: ["200301", "200401", "200700"], stage: "problem", possession: true, source: "lib" },
  { codes: ["230309", "230310"], stage: "problem", possession: true, source: "lib" },
  { codes: ["230402"], stage: "in_transit", possession: true, repin: "redirect", source: "pdf" },
  { codes: ["230403", "230408"], stage: "returned", possession: true, repin: "return", source: "pdf" },
  { codes: ["500101", "500201", "500500"], stage: "in_transit", possession: true, source: "lib" },
  { codes: ["500610"], stage: "returned", possession: true, source: "lib" },
  { codes: [SIM_IN_POINT], stage: "in_point", possession: true, source: "sim" },
]

test("every row of the 6.3 table maps to its stage and possession", () => {
  for (const row of TABLE) {
    for (const code of row.codes) {
      const hit = map.lookup(code)
      assert.ok(hit, code)
      assert.equal(hit.stage, row.stage, code)
      assert.equal(hit.possession, row.possession, code)
      assert.equal(hit.repin, row.repin, code)
      assert.equal(hit.notification, row.notification, code)
      assert.equal(hit.source, row.source, code)
      assert.equal(hit.code, code)
    }
  }
  assert.equal(BUILTIN_CODE_RULES.length, 18, "the table has 17 rows; the delivery row is two rules")
})

test("the exact code wins over a prefix, the longest prefix over a shorter one", () => {
  assert.equal(map.lookup("190101")?.match, "exact")
  assert.equal(map.lookup("190105")?.match, "prefix")
  assert.equal(map.lookup("200300")?.stage, "in_transit", "200300 exact over the problem prefix 2003")
  assert.equal(map.lookup("200301")?.stage, "problem")
  assert.equal(map.lookup(" 190101 ")?.code, "190101", "trimmed")
  assert.equal(map.lookup(""), null)
})

test("notifications never change the stage", () => {
  for (const code of ["170301", "170303", "170305"]) assert.equal(map.lookup(code)?.notification, true, code)
  assert.equal(map.lookup("170302")?.notification, undefined)
})

test("170301, 170303 and 170305 are notifications without possession; 170302 is in_transit with possession", () => {
  for (const code of ["170301", "170303", "170305"]) assert.deepEqual([map.lookup(code)?.possession, map.lookup(code)?.notification], [false, true], code)
  assert.deepEqual([map.lookup("170302")?.stage, map.lookup("170302")?.possession, map.lookup("170302")?.match], ["in_transit", true, "exact"])
})

test("040201 is problem without possession", () => {
  assert.deepEqual([map.lookup("040201")?.stage, map.lookup("040201")?.possession], ["problem", false])
})

test("an unknown code is in_transit without possession", () => {
  /* The map has no entry: the fold makes it in_transit and leaves possession (6.2 step 4). */
  assert.equal(map.lookup("999999"), null)
  assert.equal(map.lookup("030104"), null)
})

test("statusMap overrides the stage but not the built in possession", () => {
  const m = buildCodeMap({ "190101": "in_point", "030103": "in_transit", "230403": "problem" })
  assert.deepEqual([m.lookup("190101")?.stage, m.lookup("190101")?.possession, m.lookup("190101")?.match], ["in_point", true, "exact"])
  assert.deepEqual([m.lookup("030103")?.stage, m.lookup("030103")?.possession], ["in_transit", false])
  assert.deepEqual([m.lookup("230403")?.stage, m.lookup("230403")?.repin], ["problem", "return"], "repin stays")
  const own = buildCodeMap({ "990001": "in_point", "990002": "problem", "990003": "delivered", "990004": "preparing" })
  assert.deepEqual(own.lookup("990001"), { stage: "in_point", possession: true, source: "lib", code: "990001", match: "option" })
  assert.equal(own.lookup("990002")?.possession, false)
  assert.equal(own.lookup("990003")?.possession, true)
  assert.equal(own.lookup("990004")?.possession, false)
})

test("a statusMap key under a built in prefix takes only the stage", () => {
  const m = buildCodeMap({ "190105": "in_point", "040201": "in_transit", "170301": "delivered" })
  assert.deepEqual(m.lookup("190105"), { stage: "in_point", possession: true, source: "lib", code: "190105", match: "prefix" })
  assert.deepEqual(m.lookup("040201"), { stage: "in_transit", possession: false, source: "lib", code: "040201", match: "prefix" })
  assert.equal(m.lookup("170301")?.notification, true, "statusMap never removes a notification")
})

test("a statusMap stage canceled is ignored", () => {
  const m = buildCodeMap({ "190101": "canceled", "990001": "canceled", "990002": "nonsense" as never })
  assert.equal(m.lookup("190101")?.stage, "delivered")
  assert.equal(m.lookup("990001"), null)
  assert.equal(m.lookup("990002"), null)
})
