import { Text, clx } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import type {
  OlxAdvertDto,
  OlxAlertKind,
  OlxPlanState,
  OlxProblemDto,
  OlxPublicationState,
  OlxReferenceDto,
  OlxStatusGroup,
  OlxWriterKey,
} from "../../modules/olx/lib/contract"
import { pickText } from "../../modules/olx/lib/references"
import type { Reference } from "./olx-guide"
import { ToneBadge, type Tone } from "./olx-blocks"

export function fmtDateTime(value: string | null | undefined, lang: string): string {
  if (!value) return ""
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return ""
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(d)
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ")
  }
}

export function fmtDate(value: string | null | undefined, lang: string): string {
  if (!value) return ""
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return ""
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: "medium" }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

export function fmtPrice(price: OlxAdvertDto["price"], lang: string): string {
  if (!price) return ""
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: price.currency, maximumFractionDigits: 2 }).format(price.value)
  } catch {
    return `${price.value} ${price.currency}`
  }
}

export function fmtNumber(value: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang).format(value)
  } catch {
    return String(value)
  }
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 s"
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}

/* ------------------------------------------------------------------ */
/* References                                                          */
/* ------------------------------------------------------------------ */

/* Pure helpers shared with the server code and its unit tests (zero imports there). */
export { pickText }

/** References of the option in the admin language, shaped for the kit. */
export function kitReferences(refs: OlxReferenceDto[], lang: string): Reference[] {
  return refs.map((r) => ({
    name: r.name,
    url: r.url ?? undefined,
    soon: r.soon,
    icon: r.icon,
    description: pickText(r.description, lang) || undefined,
    metrics: r.metrics.map((m) => ({ label: pickText(m.label, lang), value: m.value })),
    links: r.links.map((l) => ({ label: pickText(l.label, lang), url: l.url })),
    review: r.review ? { ...r.review, quote: pickText(r.review.quote, lang) || undefined } : null,
  }))
}

/** A rating in the admin's number format: 5.0 or 5,0. */
export function fmtRating(value: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
  } catch {
    return value.toFixed(1)
  }
}

/** The Medusa mark (the hexagon of the admin's own login screen), in the text colour. */
export function MedusaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 38" fill="none" aria-hidden className={className}>
      <path
        d="M30.85 6.16832L22.2453 1.21782C19.4299 -0.405941 15.9801 -0.405941 13.1648 1.21782L4.52043 6.16832C1.74473 7.79208 0 10.802 0 14.0099V23.9505C0 27.198 1.74473 30.1683 4.52043 31.7921L13.1251 36.7822C15.9405 38.4059 19.3903 38.4059 22.2056 36.7822L30.8103 31.7921C33.6257 30.1683 35.3307 27.198 35.3307 23.9505V14.0099C35.41 10.802 33.6653 7.79208 30.85 6.16832ZM17.6852 27.8317C12.8079 27.8317 8.8426 23.8713 8.8426 19C8.8426 14.1287 12.8079 10.1683 17.6852 10.1683C22.5625 10.1683 26.5674 14.1287 26.5674 19C26.5674 23.8713 22.6022 27.8317 17.6852 27.8317Z"
        fill="currentColor"
      />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

/* The kit palette: green ok, orange a look, red an error, blue information, grey neutral. Purple never paints a state. */
const GROUP_TONE: Record<OlxStatusGroup, Tone> = {
  live: "green",
  limited: "orange",
  ended: "grey",
}

/** OLX status as a dot badge; the raw OLX status sits in the tooltip text. */
export function AdvertStatus({ advert }: { advert: Pick<OlxAdvertDto, "status" | "statusGroup"> }) {
  const { t } = useTranslation("olx")
  return (
    <ToneBadge tone={GROUP_TONE[advert.statusGroup]} dot title={advert.status}>
      {t(`status.${advert.statusGroup}`)}
    </ToneBadge>
  )
}

export const ALERT_TONE: Record<OlxAlertKind, Tone> = {
  live_sold_out: "red",
  live_unpublished: "orange",
  stock_not_live: "orange",
  stock_not_listed: "blue",
}

export function AlertBadge({ kind }: { kind: OlxAlertKind }) {
  const { t } = useTranslation("olx")
  return <ToneBadge tone={ALERT_TONE[kind]}>{t(`alerts.kind.${kind}`)}</ToneBadge>
}

const PLAN_TONE: Record<OlxPlanState, Tone> = {
  idle: "grey",
  pending: "blue",
  held: "orange",
  applying: "blue",
  done: "green",
  failed: "orange",
  quarantined: "red",
  unknown: "orange",
}

export function PlanStateBadge({ state }: { state: OlxPlanState }) {
  const { t } = useTranslation("olx")
  return <ToneBadge tone={PLAN_TONE[state]}>{t(`plan.state.${state}`)}</ToneBadge>
}

const PUBLICATION_TONE: Record<OlxPublicationState, Tone> = {
  planned: "blue",
  blocked: "orange",
  publishing: "blue",
  published: "green",
  failed: "orange",
  quarantined: "red",
  unknown: "orange",
}

export function PublicationStateBadge({ state }: { state: OlxPublicationState }) {
  const { t } = useTranslation("olx")
  return <ToneBadge tone={PUBLICATION_TONE[state]}>{t(`publish.state.${state}`)}</ToneBadge>
}

export const WRITER_OPTION: Record<OlxWriterKey, string> = {
  lifecycle: "lifecycleWriter",
  price: "priceWriter",
  publish: "publishWriter",
}

/** One problem of a publication, translated; unknown codes fall back to the code. */
export function ProblemText({ problem }: { problem: OlxProblemDto }) {
  const { t, i18n } = useTranslation("olx")
  const key = `problem.${problem.code}`
  const text = i18n.exists(key, { ns: "olx" }) ? t(key, { detail: problem.detail ?? "" }) : `${problem.code}${problem.detail ? `: ${problem.detail}` : ""}`
  return <>{text}</>
}

export function ProblemList({ problems, tone = "error" }: { problems: OlxProblemDto[]; tone?: "error" | "warning" }) {
  if (problems.length === 0) return null
  return (
    <ul className="flex flex-col gap-y-0.5">
      {problems.map((p, i) => (
        <li key={`${p.code}-${i}`} className="flex gap-x-1.5">
          <span className={clx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", tone === "error" ? "bg-ui-tag-red-icon" : "bg-ui-tag-orange-icon")} />
          <Text size="xsmall" className="text-ui-fg-subtle">
            <ProblemText problem={p} />
          </Text>
        </li>
      ))}
    </ul>
  )
}
