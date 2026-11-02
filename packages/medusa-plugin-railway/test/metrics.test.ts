/**
 * Metrics for the charts: points in time order without duplicates or
 * garbage, thinned to a few hundred, the limits as one number, the summary
 * for the tiles, memory per service from one grouped read.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { metricRange, rangeWindow, shapeMetrics } from "../src/modules/railway/lib/metrics.ts"
import { memoryByService, shapePoints } from "../src/modules/railway/lib/normalize.ts"
import { SVC_API, SVC_PG, memoryAnswer } from "./fixtures.ts"

test("points: sorted, duplicates by time keep the last value, NaN and missing values dropped", () => {
  const pts = shapePoints([{ ts: 30, value: 3 }, { ts: 10, value: 1 }, { ts: 20, value: Number.NaN }, { ts: 10, value: 1.5 }, null, { ts: null, value: 2 }, { ts: 40, value: 4.123456789 }])
  assert.deepEqual(pts, [
    { t: 10, v: 1.5 },
    { t: 30, v: 3 },
    { t: 40, v: 4.1235 },
  ])
  assert.deepEqual(shapePoints(null), [])
})

test("points: a long series is thinned by averaging neighbours, the last time kept", () => {
  const values = Array.from({ length: 1000 }, (_, i) => ({ ts: i, value: i % 2 }))
  const pts = shapePoints(values, 100)
  assert.equal(pts.length, 100)
  assert.equal(pts[0].v, 0.5)
  assert.equal(pts[pts.length - 1].t, 999)
})

test("ranges: 1h, 6h, 24h with their sample rates; anything else is 1h", () => {
  assert.equal(metricRange("6h"), "6h")
  assert.equal(metricRange("7d"), "1h")
  assert.equal(metricRange(undefined), "1h")
  const now = Date.parse("2026-10-01T12:00:00Z")
  assert.deepEqual(rangeWindow("24h", now), { startDate: "2026-09-30T12:00:00.000Z", endDate: "2026-10-01T12:00:00.000Z", sampleRateSeconds: 900 })
  assert.equal(rangeWindow("1h", now).sampleRateSeconds, 60)
})

test("metrics: series per measurement, limits as numbers, the summary", () => {
  const results = [
    { measurement: "CPU_USAGE", values: [{ ts: 1, value: 0.1 }, { ts: 2, value: 0.3 }] },
    { measurement: "CPU_LIMIT", values: [{ ts: 1, value: 8 }, { ts: 2, value: 8 }] },
    { measurement: "MEMORY_USAGE_GB", values: [{ ts: 1, value: 0.4 }, { ts: 2, value: 0.75 }] },
    { measurement: "MEMORY_LIMIT_GB", values: [{ ts: 2, value: 1 }] },
    { measurement: "NETWORK_RX_GB", values: [{ ts: 1, value: 0.001 }, { ts: 2, value: 0.002 }] },
    { measurement: "NETWORK_TX_GB", values: [{ ts: 1, value: 0.003 }] },
  ]
  const m = shapeMetrics(results, SVC_API, "1h", { readAt: "2026-10-01T12:00:00.000Z", fresh: true })
  assert.equal(m.cpu.length, 2)
  assert.equal(m.cpuLimit, 8)
  assert.equal(m.memoryLimit, 1)
  assert.equal(m.summary.cpuMax, 0.3)
  assert.equal(m.summary.cpuAvg, 0.2)
  assert.equal(m.summary.memoryLast, 0.75)
  assert.equal(m.summary.memoryMax, 0.75)
  assert.equal(m.summary.memoryPct, 75)
  assert.equal(m.summary.rxTotal, 0.003)
  assert.equal(m.summary.txTotal, 0.003)
  assert.equal(m.sampleSeconds, 60)
  const empty = shapeMetrics([], SVC_API, "6h", { readAt: "x", fresh: false })
  assert.deepEqual([empty.cpu, empty.memory, empty.cpuLimit, empty.summary.memoryPct], [[], [], null, null])
})

test("memory per service from one grouped read", () => {
  const mem = memoryByService(memoryAnswer(Date.parse("2026-10-01T12:00:00Z")).metrics)
  assert.deepEqual(mem.get(SVC_API), { usedGb: 0.92, limitGb: 1, pct: 92 })
  assert.equal(mem.get(SVC_PG)!.pct, 3.8)
  assert.equal(memoryByService(null).size, 0)
})
