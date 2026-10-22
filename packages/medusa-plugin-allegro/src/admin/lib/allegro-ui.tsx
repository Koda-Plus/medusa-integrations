import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRightMini } from "@medusajs/icons"
import { Table, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import type {
  AllegroImportStatus,
  AllegroMoneyDto,
  AllegroOfferDto,
  AllegroOrderDto,
  AllegroStatusGroup,
  AllegroStockState,
} from "../../modules/allegro/lib/contract"
import { ToneBadge, useDebouncedValue, type Tone } from "./allegro-blocks"
import { kitFetch } from "./allegro-kit"

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

export function fmtMoney(price: AllegroMoneyDto | null | undefined, lang: string): string {
  if (!price) return ""
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: price.currency, maximumFractionDigits: 2 }).format(price.value)
  } catch {
    return `${price.value} ${price.currency}`
  }
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 s"
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}

/** The first part of a UUID, enough to tell orders apart in a table. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : ""
}

/** A rating in the admin's number format: 5.0 or 5,0. */
export function fmtRating(value: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
  } catch {
    return value.toFixed(1)
  }
}

export function scrollToSection(id: string): void {
  if (typeof document === "undefined") return
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
}

/** The search of a list after a pause in typing, trimmed (kit `useDebouncedValue`). */
export function useDebounced(value: string): string {
  return useDebouncedValue(value, 300).trim()
}

/* ------------------------------------------------------------------ */
/* Product thumbnails, read from Medusa's own product list             */
/* ------------------------------------------------------------------ */

/**
 * The thumbnails of the store products on a list page, by product id. The
 * plugin keeps no images (Allegro offers are stored without them), so the
 * picture is the Medusa product's own, read once per page from
 * GET /admin/products with only `id,thumbnail`.
 */
export function useProductThumbs(ids: Array<string | null | undefined>): Record<string, string | null> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))].sort().slice(0, 100)
  const q = useQuery({
    queryKey: ["allegro-product-thumbs", unique],
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

/* ------------------------------------------------------------------ */
/* The store side of a row: a Medusa product or order, one click away  */
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

/** The header of a column of store records: the Medusa mark and the label; how rows are linked sits in the tooltip. */
export function StoreColumn({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="inline-flex items-center gap-x-1.5" title={hint}>
      <MedusaMark className="h-3.5 w-3.5 text-ui-fg-muted" />
      {label}
    </span>
  )
}

/** A product picture, or the Medusa mark on a tile when the product has none. */
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

/** A Medusa record one click away: the thumbnail (or the mark), the title, a code in mono and the open link. */
function StoreLink({ to, title, code, codeTitle, open, thumbnail }: { to: string; title: ReactNode; code?: string | null; codeTitle?: string; open: string; thumbnail?: string | null }) {
  return (
    <Link to={to} className="group flex items-center gap-x-2.5" title={open}>
      <Thumb src={thumbnail} />
      <span className="flex min-w-0 flex-col">
        <span className="txt-compact-small-plus truncate text-ui-fg-base group-hover:text-ui-fg-interactive">{title}</span>
        <span className="flex min-w-0 items-center gap-x-1.5">
          {code ? (
            <span className="truncate font-mono text-ui-fg-muted txt-compact-xsmall" title={codeTitle}>
              {code}
            </span>
          ) : null}
          {/* Never wraps, so a table column is never sized narrower than the link it shows. */}
          <span className="txt-compact-xsmall-plus inline-flex shrink-0 items-center gap-x-0.5 whitespace-nowrap text-ui-fg-interactive">
            {open}
            <ArrowUpRightMini />
          </span>
        </span>
      </span>
    </Link>
  )
}

/** A product of the store: its picture, its title, the SKU (or the signature) in mono and "Open product". */
export function ProductLink({ productId, title, code, codeTitle, thumbnail }: { productId: string; title: ReactNode; code?: string | null; codeTitle?: string; thumbnail?: string | null }) {
  const { t } = useTranslation("allegro")
  return <StoreLink to={`/products/${productId}`} title={title} code={code} codeTitle={codeTitle} open={t("actions.openProduct")} thumbnail={thumbnail} />
}

/** An order of the store: its number, an optional code in mono and "Open order". */
export function OrderLink({ orderId, displayId, code, codeTitle }: { orderId: string; displayId: number | null; code?: string | null; codeTitle?: string }) {
  const { t } = useTranslation("allegro")
  return <StoreLink to={`/orders/${orderId}`} title={displayId ? `#${displayId}` : t("orders.inStore")} code={code} codeTitle={codeTitle} open={t("actions.openOrder")} />
}

/** Why an offer has no store product: none has its signature, or it has no signature at all. */
export function NoProduct({ signature }: { signature: string | null }) {
  const { t } = useTranslation("allegro")
  if (!signature) {
    return (
      <Text size="small" className="text-ui-fg-muted">
        {t("offers.noKey")}
      </Text>
    )
  }
  return (
    <div className="flex flex-col items-start gap-y-1">
      <ToneBadge tone="orange">{t("offers.noProduct")}</ToneBadge>
      <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{signature}</span>
    </div>
  )
}

/**
 * Why an Allegro order is not in the store, in a few words, with the full
 * reason on hover. Held orders need a person, so they are orange. Without a
 * known reason it says the import status, or nothing when `fallback` is off.
 */
export function ImportWhy({
  status,
  reasonCode,
  reason,
  fallback = true,
}: {
  status: AllegroImportStatus
  reasonCode: string | null
  reason: string | null
  fallback?: boolean
}) {
  const { t, i18n } = useTranslation("allegro")
  const key = reasonCode ? `imports.why.${reasonCode}` : ""
  const known = key !== "" && i18n.exists(key, { ns: "allegro" })
  if (!known && !fallback) return null
  return (
    <ToneBadge tone={status === "held" ? "orange" : "grey"} title={reason ?? undefined}>
      {known ? t(key) : t(`imports.status.${status}`)}
    </ToneBadge>
  )
}

const GROUP_TONE: Record<AllegroStatusGroup, Tone> = {
  live: "green",
  activating: "blue",
  draft: "grey",
  ended: "grey",
}

/** Allegro status as a badge; the raw Allegro status sits in the tooltip. */
export function OfferStatus({ offer }: { offer: Pick<AllegroOfferDto, "status" | "statusGroup"> }) {
  const { t } = useTranslation("allegro")
  return (
    <ToneBadge tone={GROUP_TONE[offer.statusGroup]} title={offer.status}>
      {t(`status.${offer.statusGroup}`)}
    </ToneBadge>
  )
}

const STOCK_TONE: Record<AllegroStockState, Tone> = {
  oversell: "red",
  sold_out: "red",
  under_listed: "blue",
  ended_in_stock: "orange",
  ok: "green",
  untracked: "grey",
  unknown: "grey",
}

/** Allegro quantity against the Medusa quantity, with the stock check label. */
export function StockCell({ offer }: { offer: AllegroOfferDto }) {
  const { t } = useTranslation("allegro")
  const allegro = offer.available ?? "?"
  return (
    <div className="flex flex-col items-start gap-y-1">
      <span className="tabular-nums txt-compact-small text-ui-fg-base">
        {allegro}
        {offer.variantId && offer.isPrimary ? <span className="text-ui-fg-muted"> / {offer.medusaAvailable ?? "∞"}</span> : null}
      </span>
      {offer.stockState ? <ToneBadge tone={STOCK_TONE[offer.stockState]}>{t(`stock.${offer.stockState}`)}</ToneBadge> : null}
    </div>
  )
}

const ORDER_TONE: Record<AllegroOrderDto["group"], Tone> = {
  open: "orange",
  sent: "green",
  cancelled: "grey",
}

export function OrderStatus({ order }: { order: AllegroOrderDto }) {
  const { t } = useTranslation("allegro")
  const raw = [order.status, order.fulfillmentStatus].filter(Boolean).join(" / ")
  return (
    <div className="flex flex-col items-start gap-y-1" title={raw}>
      <ToneBadge tone={ORDER_TONE[order.group]}>{t(`orders.group.${order.group}`)}</ToneBadge>
      {order.fulfillmentStatus ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t(`orders.fulfillment.${order.fulfillmentStatus}`, { defaultValue: order.fulfillmentStatus })}
        </Text>
      ) : null}
    </div>
  )
}

export function Pager({ count, page, size, onPage }: { count: number; page: number; size: number; onPage: (p: number) => void }) {
  const { t } = useTranslation("allegro")
  const pageCount = Math.max(1, Math.ceil(count / size))
  return (
    <Table.Pagination
      count={count}
      pageSize={size}
      pageIndex={page}
      pageCount={pageCount}
      canPreviousPage={page > 0}
      canNextPage={page + 1 < pageCount}
      previousPage={() => onPage(Math.max(0, page - 1))}
      nextPage={() => onPage(page + 1)}
      translations={{
        of: t("pagination.of"),
        results: t("pagination.results"),
        pages: t("pagination.pages"),
        prev: t("pagination.prev"),
        next: t("pagination.next"),
      }}
    />
  )
}

export const PLAN_TONE: Record<string, Tone> = {
  planned: "blue",
  deferred: "grey",
  quarantined: "red",
  skipped: "grey",
  in_sync: "green",
  applied: "green",
  failed: "red",
  unknown: "orange",
}

export const IMPORT_TONE: Record<string, Tone> = {
  pending: "blue",
  importing: "blue",
  imported: "green",
  held: "orange",
  skipped: "grey",
  cancelled: "grey",
  unknown: "orange",
}

export const OUTBOX_TONE: Record<string, Tone> = {
  pending: "blue",
  sending: "blue",
  done: "green",
  failed: "red",
  unknown: "orange",
  skipped: "grey",
}
