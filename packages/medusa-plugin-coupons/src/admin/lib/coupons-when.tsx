import { useTranslation } from "react-i18next"
import { Clock, XMark } from "@medusajs/icons"
import { IconButton, Input, Label } from "@medusajs/ui"
import { edgeIso, edgeParts, type Edge } from "../../modules/coupons/lib/when"
import type { SentenceFormat } from "./coupons-sentence"
import { storeTimeZone } from "./coupons-zone"

/** A start or end of the form: a day and an optional time ("" = none). */
export type DayTime = { day: string; time: string }

export const EMPTY_DAY_TIME: DayTime = { day: "", time: "" }

/** The form's day and time of an ISO moment, in the store's zone. */
export function dayTimeOf(iso: string | null | undefined, edge: Edge): DayTime {
  const p = edgeParts(iso, edge, storeTimeZone())
  return p ? { day: p.day, time: p.time ?? "" } : EMPTY_DAY_TIME
}

/** The exact moment of the form's day and time (no time: the day's first or last millisecond), null without a day. */
export function isoOf(v: DayTime, edge: Edge): string | null {
  return edgeIso(v.day, v.time || null, edge, storeTimeZone())
}

/** "4 Nov 2026" or "4 Nov 2026 10:00" (a time only when set by hand). */
export function stampOf(fmt: SentenceFormat, iso: string, edge: Edge): string {
  const x = fmt.edge ? fmt.edge(iso, edge) : { date: fmt.date(iso), time: null }
  return x.time ? `${x.date} ${x.time}` : x.date
}

/**
 * From and to: a day each, and an optional time next to it. Without a time
 * the day counts whole (from its start, to its end), as before.
 */
export function DayTimeRange({ start, end, onChange, fromLabel, toLabel, endClear }: {
  start: DayTime
  end: DayTime
  onChange: (next: { start: DayTime; end: DayTime }) => void
  fromLabel: string
  toLabel: string
  /** A button that clears the end (no end date), when given. */
  endClear?: string
}) {
  const { t } = useTranslation("coupons")
  const one = (v: DayTime, edge: Edge, set: (v: DayTime) => void) => (
    <span className="flex items-center gap-1.5">
      <Input size="small" type="date" className="w-40" value={v.day} onChange={(e) => set({ day: e.target.value, time: e.target.value ? v.time : "" })} />
      <span className="flex items-center gap-1">
        <Clock className="text-ui-fg-muted" />
        <Input
          size="small"
          type="time"
          step={60}
          className="w-28"
          aria-label={edge === "start" ? t("when.startTime") : t("when.endTime")}
          title={t("when.timeHint")}
          disabled={!v.day}
          value={v.time}
          onChange={(e) => set({ ...v, time: e.target.value.slice(0, 5) })}
        />
        {v.time ? (
          <IconButton size="small" variant="transparent" aria-label={t("when.clearTime")} title={t("when.clearTime")} onClick={() => set({ ...v, time: "" })}>
            <XMark />
          </IconButton>
        ) : null}
      </span>
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label size="xsmall">{fromLabel}</Label>
      {one(start, "start", (v) => onChange({ start: v, end }))}
      <Label size="xsmall">{toLabel}</Label>
      {one(end, "end", (v) => onChange({ start, end: v }))}
      {endClear && end.day ? (
        <button type="button" className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={() => onChange({ start, end: EMPTY_DAY_TIME })}>
          {endClear}
        </button>
      ) : null}
    </div>
  )
}
