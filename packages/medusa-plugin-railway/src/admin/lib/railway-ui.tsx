import { useId } from "react"
import { clx } from "@medusajs/ui"
import type { PointDto } from "../../modules/railway/lib/contract"

/* Small formatters and the one chart of the page. Colours only from ui- classes, so light and dark both work. */

type T = (key: string, options?: Record<string, unknown>) => string

/** "3 min ago", "2 h ago", "4 d ago". */
export function ago(iso: string | null | undefined, t: T, now = Date.now()): string {
  if (!iso) return ""
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (!Number.isFinite(s)) return ""
  if (s < 10) return t("time.now")
  if (s < 60) return t("time.seconds", { count: s })
  if (s < 3600) return t("time.minutes", { count: Math.floor(s / 60) })
  if (s < 86_400) return t("time.hours", { count: Math.floor(s / 3600) })
  return t("time.days", { count: Math.floor(s / 86_400) })
}

/** "45 s", "12 min", "3 h 5 min", "2 d 4 h". */
export function duration(ms: number | null | undefined, t: T): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return ""
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return t("time.dSec", { count: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t("time.dMin", { count: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t("time.dHours", { h, m: m % 60 })
  return t("time.dDays", { d: Math.floor(h / 24), h: h % 24 })
}

export function since(iso: string | null | undefined, t: T, now = Date.now()): string {
  return iso ? duration(now - Date.parse(iso), t) : ""
}

export function dateTime(iso: string | null | undefined, lang: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString(lang === "pl" ? "pl-PL" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export function clock(iso: string, lang: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(lang === "pl" ? "pl-PL" : "en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

/** GB as "512 MB" or "1.2 GB". */
export function gb(value: number | null | undefined, lang: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ""
  const f = (n: number, d: number) => n.toLocaleString(lang === "pl" ? "pl-PL" : "en-GB", { maximumFractionDigits: d })
  if (value < 0.001) return `${f(value * 1024 * 1024, 0)} KB`
  if (value < 1) return `${f(value * 1024, 0)} MB`
  return `${f(value, 2)} GB`
}

export function mb(value: number | null | undefined, lang: string): string {
  return value === null || value === undefined ? "" : gb(value / 1024, lang)
}

export function num(value: number | null | undefined, lang: string, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ""
  return value.toLocaleString(lang === "pl" ? "pl-PL" : "en-GB", { maximumFractionDigits: digits })
}

/** A thin bar for a share of a limit: green, orange from 85 %, red from 95 %. */
export function UsageBar({ pct, className }: { pct: number | null | undefined; className?: string }) {
  if (pct === null || pct === undefined) return null
  const p = Math.max(0, Math.min(100, pct))
  return (
    <span className={clx("block h-1.5 w-full overflow-hidden rounded-full bg-ui-bg-component", className)}>
      <span className={clx("block h-full rounded-full", p >= 95 ? "bg-ui-tag-red-icon" : p >= 85 ? "bg-ui-tag-orange-icon" : "bg-ui-tag-green-icon")} style={{ width: `${p}%` }} />
    </span>
  )
}

/**
 * A small line chart in SVG: one or two series, an optional limit line, the
 * area under the first series. Scales to its box (viewBox with
 * preserveAspectRatio none), no axes: the numbers sit in the tile above it.
 */
export function Sparkline({ series, limit, height = 72, label }: { series: Array<{ points: PointDto[]; tone: "blue" | "green" | "purple" }>; limit?: number | null; height?: number; label: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "")
  const all = series.flatMap((s) => s.points)
  if (all.length < 2) return <div style={{ height }} className="w-full rounded-md bg-ui-bg-subtle" aria-label={label} />
  const t0 = Math.min(...all.map((p) => p.t))
  const t1 = Math.max(...all.map((p) => p.t))
  const top = Math.max(...all.map((p) => p.v), limit ?? 0) * 1.08 || 1
  const W = 300
  const H = 100
  const x = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W)
  const y = (v: number) => H - (v / top) * H
  const path = (pts: PointDto[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")
  const STROKE: Record<string, string> = { blue: "text-ui-tag-blue-icon", green: "text-ui-tag-green-icon", purple: "text-ui-tag-purple-icon" }
  const first = series[0]
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full overflow-visible" style={{ height }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {limit ? <line x1="0" x2={W} y1={y(limit)} y2={y(limit)} className="text-ui-tag-red-icon" stroke="currentColor" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
      {first.points.length > 1 ? (
        <path d={`${path(first.points)} L${x(first.points[first.points.length - 1].t).toFixed(1)},${H} L${x(first.points[0].t).toFixed(1)},${H} Z`} fill={`url(#g${id})`} className={STROKE[first.tone]} />
      ) : null}
      {series.map((s, i) =>
        s.points.length > 1 ? <path key={i} d={path(s.points)} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className={STROKE[s.tone]} /> : null,
      )}
    </svg>
  )
}
