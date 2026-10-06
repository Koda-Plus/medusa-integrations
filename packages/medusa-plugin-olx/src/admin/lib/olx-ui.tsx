import { Badge, StatusBadge, Text, clx } from "@medusajs/ui"
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
import { fmtMonth, pickText } from "../../modules/olx/lib/references"
import type { Reference } from "./olx-guide"

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
export { fmtMonth, pickText }

/** References of the option in the admin language, shaped for the kit. */
export function kitReferences(refs: OlxReferenceDto[], lang: string): Reference[] {
  return refs.map((r) => ({
    name: r.name,
    url: r.url,
    icon: r.icon,
    description: pickText(r.description, lang) || undefined,
    since: r.since ?? undefined,
    metrics: r.metrics.map((m) => ({ label: pickText(m.label, lang), value: m.value })),
    links: r.links.map((l) => ({ label: pickText(l.label, lang), url: l.url })),
  }))
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

const GROUP_COLOR: Record<OlxStatusGroup, "green" | "orange" | "grey"> = {
  live: "green",
  limited: "orange",
  ended: "grey",
}

/** OLX status as a dot badge; the raw OLX status sits in the tooltip text. */
export function AdvertStatus({ advert }: { advert: Pick<OlxAdvertDto, "status" | "statusGroup"> }) {
  const { t } = useTranslation("olx")
  return (
    <span title={advert.status}>
      <StatusBadge color={GROUP_COLOR[advert.statusGroup]}>{t(`status.${advert.statusGroup}`)}</StatusBadge>
    </span>
  )
}

export const ALERT_COLOR: Record<OlxAlertKind, "red" | "orange" | "blue" | "purple"> = {
  live_sold_out: "red",
  live_unpublished: "orange",
  stock_not_live: "blue",
  stock_not_listed: "purple",
}

export function AlertBadge({ kind }: { kind: OlxAlertKind }) {
  const { t } = useTranslation("olx")
  return (
    <Badge size="2xsmall" color={ALERT_COLOR[kind]}>
      {t(`alerts.kind.${kind}`)}
    </Badge>
  )
}

const PLAN_COLOR: Record<OlxPlanState, "green" | "orange" | "red" | "grey" | "blue" | "purple"> = {
  idle: "grey",
  pending: "blue",
  held: "orange",
  applying: "blue",
  done: "green",
  failed: "orange",
  quarantined: "red",
  unknown: "purple",
}

export function PlanStateBadge({ state }: { state: OlxPlanState }) {
  const { t } = useTranslation("olx")
  return <StatusBadge color={PLAN_COLOR[state]}>{t(`plan.state.${state}`)}</StatusBadge>
}

const PUBLICATION_COLOR: Record<OlxPublicationState, "green" | "orange" | "red" | "grey" | "blue" | "purple"> = {
  planned: "blue",
  blocked: "orange",
  publishing: "blue",
  published: "green",
  failed: "orange",
  quarantined: "red",
  unknown: "purple",
}

export function PublicationStateBadge({ state }: { state: OlxPublicationState }) {
  const { t } = useTranslation("olx")
  return <StatusBadge color={PUBLICATION_COLOR[state]}>{t(`publish.state.${state}`)}</StatusBadge>
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

export function KeyCell({ advert }: { advert: OlxAdvertDto }) {
  const { t } = useTranslation("olx")
  if (!advert.matchKey) {
    return (
      <Text size="small" className="text-ui-fg-muted">
        {t("adverts.noKey")}
      </Text>
    )
  }
  return (
    <div className="flex flex-col items-start gap-y-1">
      <span className="font-mono text-ui-fg-base txt-compact-small">{advert.matchKey}</span>
      <Badge size="2xsmall" color={advert.matchSource === "external_id" ? "blue" : "purple"}>
        {advert.matchSource === "external_id" ? t("adverts.keyExternal") : t("adverts.keyDescription")}
      </Badge>
    </div>
  )
}

export function StatTile({
  label,
  value,
  tone = "default",
  active = false,
  onClick,
}: {
  label: string
  value: number | string
  tone?: "default" | "green" | "orange" | "red" | "blue" | "purple"
  active?: boolean
  onClick?: () => void
}) {
  const dot =
    tone === "green"
      ? "bg-ui-tag-green-icon"
      : tone === "orange"
        ? "bg-ui-tag-orange-icon"
        : tone === "red"
          ? "bg-ui-tag-red-icon"
          : tone === "blue"
            ? "bg-ui-tag-blue-icon"
            : tone === "purple"
              ? "bg-ui-tag-purple-icon"
              : "bg-ui-fg-muted"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={clx(
        "flex h-full flex-col items-start justify-between gap-y-1 rounded-lg border px-4 py-3 text-left transition-fg",
        "border-ui-border-base bg-ui-bg-component",
        onClick ? "hover:bg-ui-bg-component-hover cursor-pointer" : "cursor-default",
        active && "border-ui-border-interactive shadow-borders-interactive-with-active",
      )}
    >
      <span className="flex items-center gap-x-1.5">
        <span className={clx("h-1.5 w-1.5 rounded-full", dot)} />
        <Text size="xsmall" className="text-ui-fg-subtle">
          {label}
        </Text>
      </span>
      <Text size="xlarge" weight="plus" className="tabular-nums text-ui-fg-base">
        {value}
      </Text>
    </button>
  )
}

/** A filter chip with a count, the same look as the advert filters. */
export function Chip({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clx(
        "txt-compact-small-plus inline-flex items-center gap-x-1.5 rounded-full border px-3 py-1 transition-fg",
        active
          ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color"
          : "border-ui-border-base bg-ui-bg-component text-ui-fg-subtle hover:bg-ui-bg-component-hover",
      )}
    >
      {label}
      {count !== undefined ? <span className="tabular-nums opacity-80">{count}</span> : null}
    </button>
  )
}
