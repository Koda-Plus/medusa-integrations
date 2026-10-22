// GENERATED from kit/admin/order-products.tsx (kit 1.3.0) by scripts/kit.mjs. Do not edit here: change the kit and run `npm run kit:sync`.
import { useEffect, useState, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Button, Text } from "@medusajs/ui"
import { kitFetch } from "./inpost-kit"

/**
 * "Products" column for order lists in plugin pages: a "View" link above the
 * thumbnails (one large, or a stack of overlapping cards), opening a dialog with the order's line items
 * (thumbnail, title, variant, SKU, barcode, quantity, unit price, value).
 *
 * One request per list page: GET /admin/orders with the ids in the repeat form
 * (`id=a&id=b`). sdk.admin.order.list({ id: [...] }) serializes arrays as
 * indices, which Express' qs turns into an object above 20 items - the filter
 * then silently disappears. Batches of 100.
 *
 * Items priced at 0.05 or less (bundle components, add-ons) are folded into one
 * collapsible group so a product built from many parts stays readable.
 */
export type KitOrderItem = {
  id: string
  title: string
  variant: string | null
  thumbnail: string | null
  quantity: number
  unitPrice: number
  sku: string | null
  barcode: string | null
  component: boolean
}
/** What the order total is made of: products before discount, shipping (after its discount), discount, promotion codes. */
export type KitOrderAmounts = { total: number; products: number; shipping: number; discount: number; codes: string[] }
export type KitOrderProducts = { items: KitOrderItem[]; currency: string; amounts: KitOrderAmounts | null }

const FIELDS = [
  "id",
  "currency_code",
  "items.id",
  "items.title",
  "items.product_title",
  "items.variant_title",
  "items.thumbnail",
  "items.quantity",
  "items.unit_price",
  "items.variant_sku",
  "items.variant_barcode",
  /* Totals come from the order module. Their relations in FULL (.*): with partial fields
     (e.g. adjustments.code alone) the module computes from incomplete rows. */
  "total",
  "shipping_total",
  "discount_total",
  "items.tax_lines.*",
  "items.adjustments.*",
  "shipping_methods.*",
  "shipping_methods.tax_lines.*",
  "shipping_methods.adjustments.*",
].join(",")

const TEXT = {
  en: { productsLine: "Products (before discount)", shippingLine: "Shipping (after its discount)", free: "free", discountLine: "Discount", codesLine: "Discount, codes", button: "View", show: "Show products", title: "Products", ofOrder: "of order", lines: "lines", pcs: "pcs", components: "components", close: "Close", showParts: "Show components", hideParts: "Hide components", empty: "This order has no items." },
  pl: { productsLine: "Produkty (przed rabatem)", shippingLine: "Dostawa (po rabacie na dostawę)", free: "gratis", discountLine: "Rabat", codesLine: "Rabat, kupony", button: "Zobacz", show: "Pokaż produkty", title: "Produkty", ofOrder: "zamówienia", lines: "poz.", pcs: "szt.", components: "składników", close: "Zamknij", showParts: "Pokaż składniki", hideParts: "Ukryj składniki", empty: "Zamówienie nie ma pozycji." },
}

function useText() {
  const { i18n } = useTranslation()
  return String(i18n?.language ?? "en").startsWith("pl") ? TEXT.pl : TEXT.en
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function amountsOf(o: any): KitOrderAmounts | null {
  const total = num(o.total)
  const shipping = num(o.shipping_total)
  const discount = num(o.discount_total) ?? 0
  if (total == null || shipping == null) return null
  const codes = new Set<string>()
  const adjustments = [...(o.items ?? []).flatMap((it: any) => it.adjustments ?? []), ...(o.shipping_methods ?? []).flatMap((sm: any) => sm.adjustments ?? [])]
  for (const a of adjustments) if (typeof a?.code === "string" && a.code.trim()) codes.add(a.code.trim().toUpperCase())
  const r2 = (n: number) => Math.round(n * 100) / 100
  return { total: r2(total), shipping: r2(shipping), discount: r2(discount), products: r2(total - shipping + discount), codes: [...codes] }
}

function itemOf(it: any): KitOrderItem {
  const unitPrice = Number(it.unit_price ?? 0)
  return {
    id: it.id,
    title: it.product_title || it.title || "Product",
    variant: it.variant_title && it.variant_title !== "Default variant" ? it.variant_title : null,
    thumbnail: it.thumbnail ?? null,
    quantity: Number(it.quantity ?? 0),
    unitPrice,
    sku: it.variant_sku ?? null,
    barcode: it.variant_barcode ?? null,
    component: unitPrice <= 0.05,
  }
}

async function load(ids: string[]): Promise<Record<string, KitOrderProducts>> {
  const out: Record<string, KitOrderProducts> = {}
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const qs = [`fields=${encodeURIComponent(FIELDS)}`, `limit=${batch.length}`, ...batch.map((id) => `id=${encodeURIComponent(id)}`)].join("&")
    const r = await kitFetch<{ orders?: any[] }>(`/admin/orders?${qs}`)
    for (const o of r.orders ?? []) {
      out[o.id] = {
        currency: String(o.currency_code ?? "usd"),
        amounts: amountsOf(o),
        items: (o.items ?? []).map(itemOf),
      }
    }
  }
  return out
}

/** Line items of the orders on a list page; ids that are not order ids are skipped. */
/**
 * Line items of carts that never became an order (abandoned or failed payments),
 * in the same shape as orders so KitOrderProductsCell shows them. Medusa has no
 * admin cart list: `path` is the plugin's own read-only route answering
 * `{ carts: { [id]: { currency_code, items } } }` for `?ids=a,b` (at most 100).
 */
export function useKitCartProducts(ids: Array<string | null | undefined>, path: string) {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.startsWith("cart_")))].sort().slice(0, 100)
  return useQuery({
    queryKey: ["koda-kit-cart-products", path, unique],
    queryFn: async () => {
      const r = await kitFetch<{ carts?: Record<string, { currency_code?: string; items?: any[] }> }>(`${path}?ids=${encodeURIComponent(unique.join(","))}`)
      const out: Record<string, KitOrderProducts> = {}
      for (const [id, c] of Object.entries(r.carts ?? {})) out[id] = { currency: String(c.currency_code ?? "usd"), items: (c.items ?? []).map(itemOf), amounts: null }
      return out
    },
    enabled: unique.length > 0,
    staleTime: 60_000,
  })
}

export function useKitOrderProducts(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.startsWith("order_")))].sort()
  return useQuery({
    queryKey: ["koda-kit-order-products", unique],
    queryFn: () => load(unique),
    enabled: unique.length > 0,
    staleTime: 60_000,
  })
}

function money(n: number, currency: string, lang: string) {
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: currency.toUpperCase() }).format(n)
  } catch {
    return `${n.toFixed(2)} ${currency.toUpperCase()}`
  }
}

function Thumb({ src, size, title }: { src: string | null; size: number; title: string }) {
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size }
  if (!src || broken)
    return (
      <span style={style} className="flex shrink-0 items-center justify-center rounded-lg border border-ui-border-base bg-ui-bg-component text-ui-fg-muted" aria-hidden="true">
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      </span>
    )
  return <img src={src} alt={title} title={title} style={style} loading="lazy" onError={() => setBroken(true)} className="shrink-0 rounded-lg border border-ui-border-base bg-ui-bg-base object-cover" />
}

function Dialog({ data, displayId, onClose }: { data: KitOrderProducts; displayId: number | string | null; onClose: () => void }) {
  const t = useText()
  const lang = t === TEXT.pl ? "pl-PL" : "en-GB"
  const [partsOpen, setPartsOpen] = useState(false)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", k)
    return () => window.removeEventListener("keydown", k)
  }, [onClose])
  const main = data.items.filter((p) => !p.component)
  const parts = data.items.filter((p) => p.component)
  const pcs = main.reduce((s, p) => s + p.quantity, 0)
  const value = data.items.reduce((s, p) => s + p.unitPrice * p.quantity, 0)
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={`${t.title} ${displayId ? `#${displayId}` : ""}`} className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base shadow-elevation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-ui-border-base px-5 py-4">
          <div>
            <Text weight="plus">
              {t.title}
              {displayId ? ` ${t.ofOrder} #${displayId}` : ""}
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              {main.length} {t.lines}, {pcs} {t.pcs}
              {parts.length ? `, ${parts.length} ${t.components}` : ""}, {money(value, data.currency, lang)}
            </Text>
          </div>
          <Button size="small" variant="secondary" onClick={onClose}>
            {t.close}
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-2">
          {main.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-b border-ui-border-base py-3 last:border-0">
              <Thumb src={p.thumbnail} size={48} title={p.title} />
              <div className="min-w-0 flex-1">
                <Text size="small" weight="plus" className="truncate">
                  {p.title}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {[p.variant, p.sku ? `SKU ${p.sku}` : null, p.barcode ? `EAN ${p.barcode}` : null].filter(Boolean).join(", ") || "-"}
                </Text>
              </div>
              <div className="text-right">
                <Text size="small" weight="plus" className="tabular-nums">
                  {p.quantity} × {money(p.unitPrice, data.currency, lang)}
                </Text>
                <Text size="xsmall" className="tabular-nums text-ui-fg-subtle">
                  {money(p.unitPrice * p.quantity, data.currency, lang)}
                </Text>
              </div>
            </div>
          ))}
          {parts.length ? (
            <div className="py-3">
              <button type="button" className="txt-small-plus text-ui-fg-interactive" onClick={() => setPartsOpen((v) => !v)}>
                {partsOpen ? t.hideParts : t.showParts} ({parts.length})
              </button>
              {partsOpen ? (
                <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                  {parts.map((p) => (
                    <Text key={p.id} size="xsmall" className="text-ui-fg-subtle">
                      {p.quantity} × {p.title}
                      {p.variant ? ` (${p.variant})` : ""}
                    </Text>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {!data.items.length ? (
            <Text size="small" className="py-6 text-center text-ui-fg-subtle">
              {t.empty}
            </Text>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** "Open in a dialog" icon: a frame with expanding corners. */
export function KitOpenDialogIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M14 7h3v3" />
      <path d="M17 7l-4 4" />
      <path d="M10 17H7v-3" />
      <path d="M7 17l4-4" />
    </svg>
  )
}

/* Thumbnails as cards: one large, several overlapping (each next card covers the right part of the previous one). */
const SINGLE = 88
const CARD = 72
const OVERLAP = 40
const MAX_CARDS = 4

/** Table cell: a "View" link above the thumbnails, one large or a stack of cards; a click opens the dialog. */
export function KitOrderProductsCell({ data, loading, displayId }: { data: KitOrderProducts | undefined; loading?: boolean; displayId?: number | string | null }) {
  const t = useText()
  const [open, setOpen] = useState(false)
  if (!data)
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        {loading ? "…" : "-"}
      </Text>
    )
  const main = data.items.filter((p) => !p.component)
  const pool = main.length ? main : data.items
  if (!pool.length)
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        -
      </Text>
    )
  const shown = pool.slice(0, pool.length > MAX_CARDS ? MAX_CARDS - 1 : MAX_CARDS)
  const rest = pool.length - shown.length
  const size = pool.length === 1 ? SINGLE : CARD
  const show = (e: MouseEvent) => {
    /* Plugin rows are often clickable - the dialog must not trigger the row. */
    e.stopPropagation()
    e.preventDefault()
    setOpen(true)
  }
  return (
    <div className="flex flex-col items-start gap-y-2" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={show}
        className="inline-flex items-center gap-x-1 txt-compact-small-plus text-ui-fg-interactive underline-offset-2 transition-fg hover:text-ui-fg-interactive-hover hover:underline"
        title={t.show}
      >
        {t.button}
        <KitOpenDialogIcon />
      </button>
      <button type="button" onClick={show} className="isolate flex items-center py-1" aria-label={`${t.title}${displayId ? ` #${displayId}` : ""}: ${pool.length}`}>
        {shown.map((p, i) => (
          <span
            key={p.id}
            style={{ marginLeft: i ? -OVERLAP : 0, zIndex: i + 1 }}
            className="relative rounded-lg bg-ui-bg-base shadow-elevation-card-rest ring-2 ring-ui-bg-base transition-transform duration-200 ease-out hover:!z-30 hover:scale-[1.15]"
          >
            <Thumb src={p.thumbnail} size={size} title={`${p.quantity} × ${p.title}${p.variant ? ` (${p.variant})` : ""}`} />
          </span>
        ))}
        {rest > 0 ? (
          <span
            style={{ marginLeft: -OVERLAP, zIndex: shown.length + 1, width: CARD, height: CARD }}
            className="relative flex items-center justify-end rounded-lg bg-ui-bg-component pr-3 shadow-elevation-card-rest ring-2 ring-ui-bg-base txt-compact-small-plus text-ui-fg-subtle"
          >
            +{rest}
          </span>
        ) : null}
      </button>
      {open ? <Dialog data={data} displayId={displayId ?? null} onClose={() => setOpen(false)} /> : null}
    </div>
  )
}

const PackageIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.3 7L12 12l8.7-5M12 22V12" />
  </svg>
)
const TruckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 4h14v12H1zM15 9h4l3 3v4h-7" />
    <circle cx="5.5" cy="18.5" r="2" />
    <circle cx="18.5" cy="18.5" r="2" />
  </svg>
)
const TagIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" />
    <circle cx="7" cy="7" r="1.5" />
  </svg>
)

/** Under an amount: what the order total is made of (products, shipping, discount with codes), each with an icon. */
export function KitOrderAmountLines({ data }: { data: KitOrderProducts | undefined }) {
  const t = useText()
  const lang = t === TEXT.pl ? "pl-PL" : "en-GB"
  const a = data?.amounts
  if (!data || !a || a.products < -0.01) return null
  const row = "flex items-center justify-end gap-x-1 whitespace-nowrap txt-compact-xsmall tabular-nums"
  return (
    <span className="flex flex-col items-end gap-y-0.5">
      <span className={`${row} text-ui-fg-subtle`} title={t.productsLine}>
        <PackageIcon />
        {money(a.products, data.currency, lang)}
      </span>
      <span className={`${row} ${a.shipping > 0.004 ? "text-ui-fg-subtle" : "text-ui-tag-green-text"}`} title={t.shippingLine}>
        <TruckIcon />
        {a.shipping > 0.004 ? money(a.shipping, data.currency, lang) : t.free}
      </span>
      {a.discount > 0.004 || a.codes.length ? (
        <span className={`${row} flex-wrap text-ui-tag-orange-text`} title={a.codes.length ? `${t.codesLine}: ${a.codes.join(", ")}` : t.discountLine}>
          <TagIcon />
          {a.discount > 0.004 ? `-${money(a.discount, data.currency, lang)}` : null}
          {a.codes.length ? <span className="max-w-[9rem] truncate font-medium">{a.codes.join(", ")}</span> : null}
        </span>
      ) : null}
    </span>
  )
}
