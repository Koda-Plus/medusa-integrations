/**
 * DATES OF A POLISH DOCUMENT. Zero imports.
 *
 * `issue_date` and `sell_date` are calendar dates in Poland, not in UTC.
 * Fakturownia treats a document dated before today as OFFLINE24 on a KSeF
 * account (KSeF.md, "Automatyczne wykrywanie trybu OFFLINE24"), so a document
 * issued at 00:30 in Warsaw must carry today's Warsaw date, while UTC still
 * says yesterday.
 */

const WARSAW = "Europe/Warsaw"

/** `YYYY-MM-DD` of the given moment in Poland. Falls back to UTC when the runtime has no time zone data. */
export function warsawDate(moment: Date): string {
  try {
    /* en-CA formats as YYYY-MM-DD. */
    const text = new Intl.DateTimeFormat("en-CA", { timeZone: WARSAW, year: "numeric", month: "2-digit", day: "2-digit" }).format(moment)
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  } catch {
    /* no ICU time zone data */
  }
  return moment.toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` plus whole days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map((p) => Number(p))
  const t = Date.UTC(y, (m || 1) - 1, d || 1) + Math.round(days) * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** Whether a `YYYY-MM-DD` value is a real calendar date. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const t = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value
}

/** Month and year of a `YYYY-MM-DD` date, as Polish document numbers write them: `10/2026`. */
export function monthYear(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(0, 4)}`
}
