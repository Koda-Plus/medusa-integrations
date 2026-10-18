import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Container, Heading, StatusBadge, Text, clx } from "@medusajs/ui"
import type { EventDto, MarketplaceOrderDto, OfferDto, StatusResponse } from "../../modules/vonhalsky/lib/contract"

type Tone = "green" | "orange" | "red" | "grey" | "blue" | "purple"

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

export function fmtNumber(value: unknown, lang: string): string {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return "0"
  try {
    return new Intl.NumberFormat(lang).format(n)
  } catch {
    return String(n)
  }
}

/** "199.99" and "pln" in the admin's format: "199,99 zł" or "PLN 199.99". */
export function fmtMoney(amount: string | number | null | undefined, currency: string | null | undefined, lang: string): string {
  if (amount === null || amount === undefined || amount === "") return ""
  const n = Number(amount)
  if (!Number.isFinite(n)) return String(amount)
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: (currency || "PLN").toUpperCase() }).format(n)
  } catch {
    return `${amount} ${currency ?? ""}`.trim()
  }
}

/** The mode of the plugin in one word, for the header badge. */
export function modeOf(s: StatusResponse | undefined): { key: string; tone: Tone } {
  if (!s) return { key: "unknown", tone: "grey" }
  if (s.mode === "demo") return { key: "demo", tone: "purple" }
  if (s.mode === "off") return { key: "notConfigured", tone: "orange" }
  if (s.mode === "sandbox") return { key: "sandbox", tone: "blue" }
  return { key: "live", tone: "green" }
}

const OFFER_TONE: Record<OfferDto["status"], Tone> = { draft: "blue", listed: "green", blocked: "orange", closed: "grey" }

export function OfferStatusBadge({ status }: { status: OfferDto["status"] }) {
  const { t } = useTranslation("vonhalsky")
  return <StatusBadge color={OFFER_TONE[status] ?? "grey"}>{t(`offerStatus.${status}`)}</StatusBadge>
}

const IMPORT_TONE: Record<MarketplaceOrderDto["status"], Tone> = { importing: "blue", imported: "green", held: "red" }

export function ImportBadge({ status }: { status: MarketplaceOrderDto["status"] }) {
  const { t } = useTranslation("vonhalsky")
  return <StatusBadge color={IMPORT_TONE[status] ?? "grey"}>{t(`importStatus.${status}`)}</StatusBadge>
}

const TRACKING_TONE: Record<MarketplaceOrderDto["tracking_status"], Tone> = { none: "grey", sent: "green", failed: "red", pending_api: "orange" }

export function TrackingBadge({ order }: { order: Pick<MarketplaceOrderDto, "tracking_status" | "demo"> }) {
  const { t } = useTranslation("vonhalsky")
  const label = order.tracking_status === "sent" && order.demo ? t("trackingStatus.sentDemo") : t(`trackingStatus.${order.tracking_status}`)
  return <StatusBadge color={TRACKING_TONE[order.tracking_status] ?? "grey"}>{label}</StatusBadge>
}

export function StatTile({
  label,
  value,
  tone = "default",
  active = false,
  onClick,
}: {
  label: string
  value: ReactNode
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
        onClick ? "cursor-pointer hover:bg-ui-bg-component-hover" : "cursor-default",
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

/** A filter chip. */
export function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clx(
        "txt-compact-small-plus inline-flex items-center gap-x-1.5 rounded-full border px-3 py-1 transition-fg",
        active ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color" : "border-ui-border-base bg-ui-bg-component text-ui-fg-subtle hover:bg-ui-bg-component-hover",
      )}
    >
      {label}
    </button>
  )
}

/** A label over a value. */
export function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-y-0.5">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className={clx("txt-small text-ui-fg-base", mono && "break-all font-mono")}>{children}</div>
    </div>
  )
}

/** A card with a title and a subtitle. */
export function Section({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-y-1">
          <Heading level="h2">{title}</Heading>
          {subtitle ? (
            <Text size="small" className="max-w-3xl text-ui-fg-subtle">
              {subtitle}
            </Text>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </Container>
  )
}

/** The history of one order, newest first. */
export function EventList({ events, lang }: { events: EventDto[]; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  return (
    <ol className="flex flex-col gap-y-1.5">
      {[...events].reverse().map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
          <Text size="xsmall" className="shrink-0 tabular-nums text-ui-fg-muted">
            {fmtDateTime(e.at, lang)}
          </Text>
          <Text size="xsmall" className={clx(e.kind === "failed" || e.kind === "held" ? "text-ui-tag-red-text" : "text-ui-fg-subtle")}>
            {e.message}
          </Text>
          {e.demo ? (
            <StatusBadge color="purple" className="scale-90">
              {t("demo.badge")}
            </StatusBadge>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

/** Simple previous / next paging. */
export function Pager({ offset, page, count, onChange }: { offset: number; page: number; count: number; onChange: (offset: number) => void }) {
  if (count <= page) return null
  return (
    <div className="flex items-center justify-between px-6 py-3">
      <Text size="small" className="tabular-nums text-ui-fg-subtle">
        {offset + 1}-{Math.min(offset + page, count)} / {count}
      </Text>
      <div className="flex gap-2">
        <button type="button" className="txt-compact-small rounded-md border border-ui-border-base px-3 py-1 disabled:opacity-50" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - page))}>
          &lt;
        </button>
        <button type="button" className="txt-compact-small rounded-md border border-ui-border-base px-3 py-1 disabled:opacity-50" disabled={offset + page >= count} onClick={() => onChange(offset + page)}>
          &gt;
        </button>
      </div>
    </div>
  )
}
