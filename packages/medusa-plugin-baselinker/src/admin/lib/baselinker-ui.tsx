import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRightMini } from "@medusajs/icons"
import { Text, clx } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import type {
  CardConflict,
  ImportStatus,
  InvoiceRowStatus,
  LocalizedDto,
  OrderRowStatus,
  PlanAction,
  PlanStatus,
  ReferenceDto,
  RunDto,
  RunStatus,
  StatusResponse,
  StockChangeStatus,
} from "../../modules/baselinker/lib/contract"
import { ToneBadge, type Tone } from "./baselinker-blocks"
import type { Reference } from "./baselinker-guide"
import { kitFetch } from "./baselinker-kit"

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

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 s"
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
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

/** Units with their sign, so a plan reads at a glance: +3, -1. */
export function fmtDelta(value: number, lang: string): string {
  if (value > 0) return `+${fmtNumber(value, lang)}`
  if (value < 0) return `-${fmtNumber(-value, lang)}`
  return "0"
}

/** One word for the whole connection: what a person needs to know first. The page shows it in the mode badge of the header. */
export function connectionState(s: StatusResponse | undefined): { key: string; tone: Tone } {
  if (!s) return { key: "unknown", tone: "grey" }
  if (s.mode === "demo") return { key: "demo", tone: "blue" }
  if (!s.configured) return { key: "notConfigured", tone: "orange" }
  const last = s.lastRuns.catalog
  if (s.lastCheck && !s.lastCheck.ok) return { key: "error", tone: "red" }
  if (last?.status === "error") return { key: "error", tone: "red" }
  if (last || s.lastCheck?.ok) return { key: "connected", tone: "green" }
  return { key: "unknown", tone: "grey" }
}

/* ------------------------------------------------------------------ */
/* The store side of a row: its Medusa product or order                */
/* ------------------------------------------------------------------ */

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

/** The header of a column with the store side: the Medusa mark, the label, and how the rows relate to Medusa in the tooltip. */
export function MedusaColumn({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="inline-flex items-center gap-x-1.5" title={hint}>
      <MedusaMark className="h-3.5 w-3.5 text-ui-fg-muted" />
      {label}
    </span>
  )
}

/**
 * The pictures of the Medusa products of a list, read once per page from
 * GET /admin/products with only `id,thumbnail` (BaseLinker rows carry no image).
 */
export function useProductThumbs(ids: Array<string | null | undefined>): Record<string, string | null> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))].sort().slice(0, 100)
  const q = useQuery({
    queryKey: ["baselinker-product-thumbs", unique],
    queryFn: async () => {
      const qs = ["fields=id,thumbnail", `limit=${unique.length}`, ...unique.map((id) => `id=${encodeURIComponent(id)}`)].join("&")
      const r = await kitFetch<{ products?: Array<{ id: string; thumbnail?: string | null }> }>(`/admin/products?${qs}`)
      return Object.fromEntries((r.products ?? []).map((p) => [p.id, p.thumbnail ?? null])) as Record<string, string | null>
    },
    enabled: unique.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  })
  return q.data ?? {}
}

/** A product picture, or the Medusa mark on a tile when there is none. */
export function Thumb({ src, size = 32 }: { src?: string | null; size?: number }) {
  if (src) {
    return <img src={src} alt="" loading="lazy" style={{ width: size, height: size }} className="shrink-0 rounded-md bg-ui-bg-component object-cover shadow-borders-base" />
  }
  return (
    <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-md bg-ui-bg-component shadow-borders-base transition-fg group-hover:bg-ui-bg-component-hover">
      <MedusaMark className="h-4 w-4 text-ui-fg-base" />
    </span>
  )
}

/** A product or an order in Medusa, one click away: its picture (or the mark), the name, a mono key and "Open". */
export function StoreLink({ to, name, detail, detailTitle, open, thumb }: { to: string; name: string; detail?: string | null; detailTitle?: string; open: string; thumb?: string | null }) {
  return (
    <Link to={to} className="group flex items-center gap-x-2.5" title={open}>
      <Thumb src={thumb} />
      <span className="flex min-w-0 flex-col">
        <span className="txt-compact-small-plus truncate text-ui-fg-base group-hover:text-ui-fg-interactive">{name}</span>
        <span className="flex min-w-0 items-center gap-x-1.5">
          {detail ? (
            <span className="truncate font-mono text-ui-fg-muted txt-compact-xsmall" title={detailTitle}>
              {detail}
            </span>
          ) : null}
          <span className="txt-compact-xsmall-plus inline-flex shrink-0 items-center gap-x-0.5 text-ui-fg-interactive">
            {open}
            <ArrowUpRightMini />
          </span>
        </span>
      </span>
    </Link>
  )
}

/** The Medusa order of a row: its number, the order id and "Open order". */
export function StoreOrderCell({ orderId, displayId }: { orderId: string; displayId: number | null }) {
  const { t } = useTranslation("baselinker")
  return (
    <StoreLink
      to={`/orders/${orderId}`}
      name={displayId ? `#${displayId}` : orderId}
      detail={displayId ? orderId : null}
      detailTitle={orderId}
      open={t("actions.openOrder")}
    />
  )
}

const ORDER_TONE: Record<OrderRowStatus, Tone> = { pending: "blue", sent: "green", failed: "red", skipped: "grey" }

export function OrderStatusBadge({ status }: { status: OrderRowStatus }) {
  const { t } = useTranslation("baselinker")
  return <ToneBadge tone={ORDER_TONE[status] ?? "grey"}>{t(`orders.statuses.${status}`)}</ToneBadge>
}

const RUN_TONE: Record<RunStatus, Tone> = { ok: "green", partial: "orange", error: "red" }

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { t } = useTranslation("baselinker")
  return <ToneBadge tone={RUN_TONE[status] ?? "grey"}>{t(`runs.statuses.${status}`)}</ToneBadge>
}

const CHANGE_TONE: Record<StockChangeStatus, Tone> = { planned: "blue", applied: "green", over_cap: "orange", failed: "red" }

export function ChangeStatusBadge({ status }: { status: StockChangeStatus }) {
  const { t } = useTranslation("baselinker")
  return <ToneBadge tone={CHANGE_TONE[status] ?? "grey"}>{t(`stock.statuses.${status}`)}</ToneBadge>
}

const PLAN_ACTION_TONE: Record<PlanAction, Tone> = { create: "green", update: "blue", draft: "grey", skip: "grey", conflict: "red" }

export function PlanActionBadge({ action }: { action: PlanAction }) {
  const { t } = useTranslation("baselinker")
  return <ToneBadge tone={PLAN_ACTION_TONE[action] ?? "grey"}>{t(`plans.actions.${action}`)}</ToneBadge>
}

const PLAN_STATUS_TONE: Record<PlanStatus, Tone> = { planned: "blue", applied: "green", failed: "red", over_cap: "orange", quarantined: "red", info: "grey" }

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  const { t } = useTranslation("baselinker")
  return <ToneBadge tone={PLAN_STATUS_TONE[status] ?? "grey"}>{t(`plans.statuses.${status}`)}</ToneBadge>
}

const IMPORT_TONE: Record<ImportStatus, Tone> = { pending: "blue", imported: "green", skipped: "grey", failed: "red" }

export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  const { t } = useTranslation("baselinker")
  return <ToneBadge tone={IMPORT_TONE[status] ?? "grey"}>{t(`imports.statuses.${status}`)}</ToneBadge>
}

const INVOICE_TONE: Record<InvoiceRowStatus, Tone> = { pending: "blue", written: "green", conflict: "red", skipped: "grey", failed: "red" }

export function InvoiceStatusBadge({ status }: { status: InvoiceRowStatus }) {
  const { t } = useTranslation("baselinker")
  return <ToneBadge tone={INVOICE_TONE[status] ?? "grey"}>{t(`invoices.statuses.${status}`)}</ToneBadge>
}

export function fmtMoney(value: number | null | undefined, currency: string | null | undefined, lang: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ""
  const cur = (currency ?? "").toUpperCase()
  try {
    return cur ? new Intl.NumberFormat(lang, { style: "currency", currency: cur }).format(value) : new Intl.NumberFormat(lang, { minimumFractionDigits: 2 }).format(value)
  } catch {
    return `${value.toFixed(2)} ${cur}`.trim()
  }
}

/** A `{ en, pl }` text in the admin language, falling back to the other one. */
export function localize(text: LocalizedDto | null | undefined, lang: string): string {
  if (!text) return ""
  const pl = lang.toLowerCase().startsWith("pl")
  return (pl ? text.pl ?? text.en : text.en ?? text.pl) ?? ""
}

/** A rating in the admin's number format: 5.0 or 5,0. */
export function fmtRating(value: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
  } catch {
    return value.toFixed(1)
  }
}

/** References of the option in the admin language, shaped for the kit (the header badge and the cards at the end of the guide). */
export function kitReferences(refs: ReferenceDto[], lang: string): Reference[] {
  return refs.map((r) => ({
    name: r.name,
    url: r.url ?? undefined,
    soon: r.soon,
    icon: r.icon,
    description: localize(r.description, lang) || undefined,
    metrics: r.metrics.map((m) => ({ label: localize(m.label, lang), value: m.value })),
    links: r.links.map((l) => ({ label: localize(l.label, lang), url: l.url })),
    review: r.review ? { ...r.review, quote: localize(r.review.quote, lang) || undefined } : null,
  }))
}

export function ConflictBadge({ conflict }: { conflict: CardConflict }) {
  const { t } = useTranslation("baselinker")
  return <ToneBadge tone="red">{t(`cards.conflict.${conflict}`)}</ToneBadge>
}

export function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-y-0.5">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className={clx("txt-compact-small text-ui-fg-base min-w-0 break-words", mono && "font-mono")}>{children}</div>
    </div>
  )
}

export function OrderLink({ orderId, displayId }: { orderId: string; displayId: number | null }) {
  return (
    <Link to={`/orders/${orderId}`} className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover tabular-nums">
      {displayId ? `#${displayId}` : orderId.slice(0, 14)}
    </Link>
  )
}

type Translate = (key: string, options?: Record<string, unknown>) => string

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/**
 * The summary of a run in the admin language, built from its counters. Errors
 * and incomplete reads keep the stored message: it is the BaseLinker or
 * network text a person needs.
 */
export function runSummary(run: RunDto, t: Translate): string {
  const c = run.counts ?? {}
  if (run.status === "error") return run.message ?? ""
  if (run.kind === "catalog") {
    if (!run.complete) return run.message ?? ""
    return t("runs.summary.catalog", {
      cards: num(c.cards),
      linked: num(c.linked),
      conflicts: num(c.conflicts),
      onlyInMedusa: num(c.onlyInMedusa),
    })
  }
  if (run.kind === "stock") {
    if (c.skipped) return run.message ?? ""
    if (c.mode === "write") return t("runs.summary.stockWrite", { applied: num(c.applied), overCap: num(c.overCap) })
    return t("runs.summary.stockPlan", { changes: num(c.toChange), added: num(c.unitsAdded), removed: num(c.unitsRemoved) })
  }
  if (run.kind === "orders") return t("runs.summary.orders", { sent: num(c.sent), retry: num(c.retry), failed: num(c.failed) })
  if (run.kind === "statuses") {
    if (run.status === "partial" && run.message && num(c.read) === 0) return run.message
    return t("runs.summary.statuses", { read: num(c.read), changed: num(c.changed), fulfilled: num(c.fulfilled) })
  }
  if (run.kind === "catalog_import" || run.kind === "cards" || run.kind === "stock_push" || run.kind === "prices") {
    if (c.skipped) return run.message ?? ""
    if (c.mode === "write") return t("runs.summary.planApplied", { applied: num(c.applied), failed: num(c.failed), overCap: num(c.overCap) })
    const changes = run.kind === "catalog_import" ? num(c.create) + num(c.update) + num(c.draft) : run.kind === "cards" ? num(c.create) + num(c.update) : num(c.toChange)
    return t("runs.summary.planOnly", { changes })
  }
  if (run.kind === "imports") {
    if (c.statuses) return run.message ?? ""
    return t("runs.summary.imports", { created: num(c.created), imported: num(c.imported) + num(c.adopted), skipped: num(c.skipped), failed: num(c.failed) })
  }
  if (run.kind === "returns") return t("runs.summary.returns", { read: num(c.read), created: num(c.created), updated: num(c.updated) })
  if (run.kind === "invoices") return t("runs.summary.invoices", { written: num(c.written), adopted: num(c.adopted), conflict: num(c.conflict) })
  return run.message ?? ""
}
