/**
 * METRICS FOR THE CHARTS. No runtime imports beyond the pure helpers.
 *
 * Railway answers one series per measurement: CPU in vCPU, memory in GB,
 * network in GB per sample. The panel gets points in time order (thinned to
 * a few hundred), the limits as single numbers (the last one), and a summary
 * for the tiles above the charts.
 */
import { METRIC_RANGES } from "./constants"
import type { MetricRange, MetricsResponse } from "./contract"
import { avgValue, lastValue, maxValue, seriesOf, shapePoints, sumValue } from "./normalize"
import type { RawMetric } from "./railway-types"

export const RANGE_KEYS = Object.keys(METRIC_RANGES) as MetricRange[]

export function metricRange(value: unknown): MetricRange {
  return typeof value === "string" && (RANGE_KEYS as string[]).includes(value) ? (value as MetricRange) : "1h"
}

/** Start, end and sample rate of a range, for the query variables. */
export function rangeWindow(range: MetricRange, now: number = Date.now()): { startDate: string; endDate: string; sampleRateSeconds: number } {
  const r = METRIC_RANGES[range]
  return { startDate: new Date(now - r.minutes * 60_000).toISOString(), endDate: new Date(now).toISOString(), sampleRateSeconds: r.sampleSeconds }
}

export function shapeMetrics(results: RawMetric[] | null | undefined, serviceId: string, range: MetricRange, at: { readAt: string; fresh: boolean }): MetricsResponse {
  const cpu = shapePoints(seriesOf(results, "CPU_USAGE"))
  const memory = shapePoints(seriesOf(results, "MEMORY_USAGE_GB"))
  const rx = shapePoints(seriesOf(results, "NETWORK_RX_GB"), undefined, 6)
  const tx = shapePoints(seriesOf(results, "NETWORK_TX_GB"), undefined, 6)
  const cpuLimit = lastValue(shapePoints(seriesOf(results, "CPU_LIMIT")))
  const memoryLimit = lastValue(shapePoints(seriesOf(results, "MEMORY_LIMIT_GB")))
  const memoryLast = lastValue(memory)
  return {
    serviceId,
    range,
    sampleSeconds: METRIC_RANGES[range].sampleSeconds,
    cpu,
    cpuLimit,
    memory,
    memoryLimit,
    rx,
    tx,
    summary: {
      cpuAvg: avgValue(cpu),
      cpuMax: maxValue(cpu),
      memoryMax: maxValue(memory),
      memoryLast,
      memoryPct: memoryLast !== null && memoryLimit ? Math.min(100, Math.round((memoryLast / memoryLimit) * 1000) / 10) : null,
      rxTotal: sumValue(rx),
      txTotal: sumValue(tx),
    },
    readAt: at.readAt,
    fresh: at.fresh,
  }
}
