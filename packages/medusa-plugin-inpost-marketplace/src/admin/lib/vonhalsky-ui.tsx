import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button, Drawer, Text, clx } from "@medusajs/ui"
import type { CaseDto, EventDto, MarketplaceOrderDto, OfferDto, StatusResponse } from "../../modules/vonhalsky/lib/contract"
import { ToneBadge, toneOfStatus, type Tone } from "./vonhalsky-blocks"

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

/** A day without the time: "2 lis 2026". */
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

export function fmtNumber(value: unknown, lang: string): string {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return "0"
  try {
    return new Intl.NumberFormat(lang).format(n)
  } catch {
    return String(n)
  }
}

/** A percent the server computed (12.5 is 12.5%); empty when unknown. */
export function fmtPercent(value: number | null | undefined, lang: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ""
  try {
    return new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 1 }).format(value / 100)
  } catch {
    return `${value}%`
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

/** An amount a person typed ("49,99" or "49.99") as "49.99", or null when it is not a positive number. */
export function parseAmount(value: string): string | null {
  const s = value.trim().replace(/\s/g, "").replace(",", ".")
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const n = Number(s)
  return n > 0 ? n.toFixed(2) : null
}

/** The mode of the plugin in one word, for the header badge. */
export function modeOf(s: StatusResponse | undefined): { key: string; tone: Tone } {
  if (!s) return { key: "unknown", tone: "grey" }
  if (s.mode === "demo") return { key: "demo", tone: "blue" }
  if (s.mode === "off") return { key: "notConfigured", tone: "orange" }
  if (s.mode === "sandbox") return { key: "sandbox", tone: "orange" }
  return { key: "live", tone: "green" }
}

const OFFER_TONE: Record<OfferDto["status"], Tone> = { draft: "blue", listed: "green", blocked: "orange", closed: "grey", detached: "purple" }

export function OfferStatusBadge({ status }: { status: OfferDto["status"] }) {
  const { t } = useTranslation("vonhalsky")
  return <ToneBadge tone={OFFER_TONE[status] ?? "grey"}>{t(`offerStatus.${status}`)}</ToneBadge>
}

const REMOTE_TONE: Record<string, Tone> = { PUBLISHED: "green", PENDING: "orange", REJECTED: "red", SOLDOUT: "grey", CLOSED: "grey" }

/** What the marketplace itself says about the offer (PUBLISHED, PENDING, REJECTED, SOLDOUT, CLOSED). */
export function RemoteStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("vonhalsky")
  return <ToneBadge tone={REMOTE_TONE[status] ?? "grey"}>{t(`remoteStatus.${status}`, { defaultValue: status })}</ToneBadge>
}

const IMPORT_TONE: Record<MarketplaceOrderDto["status"], Tone> = { importing: "blue", imported: "green", held: "red" }

export function ImportBadge({ status }: { status: MarketplaceOrderDto["status"] }) {
  const { t } = useTranslation("vonhalsky")
  return <ToneBadge tone={IMPORT_TONE[status] ?? "grey"}>{t(`importStatus.${status}`)}</ToneBadge>
}

const TRACKING_TONE: Record<MarketplaceOrderDto["tracking_status"], Tone> = { none: "grey", waiting: "orange", linked: "green" }

/** Medusa's tracking numbers against the marketplace's parcels: none yet, waiting for InPost to show them, linked. */
export function TrackingBadge({ order }: { order: Pick<MarketplaceOrderDto, "tracking_status" | "demo"> }) {
  const { t } = useTranslation("vonhalsky")
  const label = order.tracking_status === "linked" && order.demo ? t("trackingStatus.linkedDemo") : t(`trackingStatus.${order.tracking_status}`)
  return (
    <ToneBadge tone={TRACKING_TONE[order.tracking_status] ?? "grey"} title={t(`trackingHint.${order.tracking_status}`)}>
      {label}
    </ToneBadge>
  )
}

const KIND_TONE: Record<CaseDto["kind"], Tone> = { return: "blue", claim: "orange", refund: "grey" }

export function CaseKindBadge({ kind }: { kind: CaseDto["kind"] }) {
  const { t } = useTranslation("vonhalsky")
  return <ToneBadge tone={KIND_TONE[kind] ?? "grey"}>{t(`caseKind.${kind}`)}</ToneBadge>
}

/** The marketplace's own status of a case, translated when known; open cases are orange (the seller acts). */
export function CaseStatusBadge({ item }: { item: Pick<CaseDto, "status" | "sub_status" | "open"> }) {
  const { t } = useTranslation("vonhalsky")
  if (!item.status) return null
  const tone: Tone = item.open ? "orange" : toneOfStatus(item.sub_status ?? item.status)
  return (
    <span className="flex flex-wrap items-center gap-1">
      <ToneBadge tone={tone}>{t(`caseStatus.${item.status}`, { defaultValue: item.status })}</ToneBadge>
      {item.sub_status ? <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{t(`caseStatus.${item.sub_status}`, { defaultValue: item.sub_status })}</span> : null}
    </span>
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

/** The history of one order or case, newest first. */
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
          {e.demo ? <ToneBadge tone="purple">{t("demo.badge")}</ToneBadge> : null}
        </li>
      ))}
    </ol>
  )
}

/**
 * A side panel with a small form and one decision: the title, a line on what
 * happens, the fields, and Cancel next to the action. The action asks the
 * page's own confirm step (the page decides what is irreversible).
 */
export function FormDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  onConfirm,
  loading,
  disabled,
  danger,
  extra,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  children?: ReactNode
  confirmLabel?: string
  onConfirm?: () => void
  loading?: boolean
  disabled?: boolean
  danger?: boolean
  /** A second action left of Cancel (e.g. "End the promotion"). */
  extra?: ReactNode
}) {
  const { t } = useTranslation("vonhalsky")
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{title}</Drawer.Title>
          {description ? <Drawer.Description className="txt-small text-ui-fg-subtle">{description}</Drawer.Description> : null}
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">{children}</Drawer.Body>
        <Drawer.Footer>
          {extra}
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {onConfirm ? t("actions.cancel") : t("actions.close")}
            </Button>
          </Drawer.Close>
          {onConfirm && confirmLabel ? (
            <Button size="small" variant={danger ? "danger" : "primary"} isLoading={loading} disabled={disabled} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          ) : null}
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/** A labelled field of a FormDrawer. */
export function Field({ label, hint, children, required }: { label: string; hint?: ReactNode; children: ReactNode; required?: boolean }) {
  return (
    <label className="flex flex-col gap-y-1">
      <Text size="small" weight="plus">
        {label}
        {required ? <span className="text-ui-tag-red-text"> *</span> : null}
      </Text>
      {children}
      {hint ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {hint}
        </Text>
      ) : null}
    </label>
  )
}

/**
 * "Price and stock sync every 5 minutes, last run ...": InPost asks
 * integrators to tell sellers how often price and stock reach the
 * marketplace (it recommends at most every 15 minutes).
 */
export function syncLine(s: StatusResponse, lang: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const minutes = s.sync.everyMinutes
  if (!s.sync.priceStock) return t("sync.off", { minutes })
  return s.sync.lastPushAt ? t("sync.every", { minutes, date: fmtDateTime(s.sync.lastPushAt, lang) }) : t("sync.everyNever", { minutes })
}

/** The native select of these pages, styled like Medusa's fields. */
export const SELECT = "w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm text-ui-fg-base"
