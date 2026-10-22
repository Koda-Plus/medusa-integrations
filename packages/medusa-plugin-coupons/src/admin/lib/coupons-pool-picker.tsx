import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDownMini, ChevronRightMini, MagnifyingGlass, Photo, SquaresPlus } from "@medusajs/icons"
import { Button, Checkbox, Text, clx } from "@medusajs/ui"
import type { PoolProductDto, PoolProductsResponse } from "../../modules/coupons/lib/contract"
import { EmptyState, SearchInput, ToneBadge } from "./coupons-blocks"
import { KitLoading } from "./coupons-kit"

/**
 * THE STORE'S POOLS with their products: a pool ticked opens the list of
 * its products under it (thumbnail, name, variant, SKU), all ticked. A
 * product unticked is left out of the discount (the coupon gets a target
 * rule "variant is not one of"), the pool's header counts what is left
 * ("12 of 13"). Without `products` it is a plain list of pools (buy X get
 * Y counted by the store, where products are not left out).
 */

export interface PoolProductsState {
  byPool: Record<string, PoolProductsResponse>
  excluded: string[]
  onExcluded: (ids: string[]) => void
}

/** A product as one line of words: the product, the variant ("Cream 200 ml"). */
export function productLabel(p: Pick<PoolProductDto, "title" | "variantTitle">): string {
  if (!p.variantTitle) return p.title
  return p.variantTitle.toLowerCase().startsWith(p.title.toLowerCase()) ? p.variantTitle : `${p.title} ${p.variantTitle}`
}

/** Names of the variants the loaded pools hold, for the sentence and the preview. */
export function variantNames(byPool: Record<string, PoolProductsResponse>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of Object.values(byPool)) for (const p of r.products) out[p.variantId] = productLabel(p)
  return out
}

export function PoolPicker({ pools, selected, onChange, search, products }: { pools: Array<{ id: string; name: string }>; selected: string[]; onChange: (ids: string[]) => void; search: string; products?: PoolProductsState }) {
  const [q, setQ] = useState("")
  const [closed, setClosed] = useState<string[]>([])
  const shown = pools.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || selected.includes(p.id)).slice(0, 120)
  const toggle = (id: string) => {
    if (!selected.includes(id)) return onChange([...selected, id])
    onChange(selected.filter((x) => x !== id))
    /* A pool unticked takes its products' exclusions with it. */
    const gone = new Set((products?.byPool[id]?.products ?? []).map((p) => p.variantId))
    if (products && gone.size && products.excluded.some((v) => gone.has(v))) products.onExcluded(products.excluded.filter((v) => !gone.has(v)))
  }
  return (
    <div className="flex flex-col gap-y-2">
      {pools.length > 8 ? <SearchInput className="sm:w-full" placeholder={search} value={q} onChange={setQ} /> : null}
      <div className="flex flex-col gap-y-1">
        {shown.map((pool) => {
          const on = selected.includes(pool.id)
          const data = products?.byPool[pool.id]
          const open = on && Boolean(products) && !closed.includes(pool.id)
          return (
            <div key={pool.id} className={clx("rounded-lg border", on ? "border-ui-border-interactive bg-ui-bg-highlight" : "border-transparent hover:bg-ui-bg-base-hover")}>
              <div className="flex items-center gap-x-2 px-2.5 py-1.5">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-x-2">
                  <Checkbox checked={on} onCheckedChange={() => toggle(pool.id)} />
                  <Text size="small" weight={on ? "plus" : "regular"} className="truncate">
                    {pool.name}
                  </Text>
                </label>
                {on && products ? <PoolCount data={data} excluded={products.excluded} /> : null}
                {on && products ? <OpenButton open={open} onClick={() => setClosed((c) => (open ? [...c, pool.id] : c.filter((x) => x !== pool.id)))} /> : null}
              </div>
              {open && products ? <PoolProducts data={data} state={products} /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PoolCount({ data, excluded }: { data: PoolProductsResponse | undefined; excluded: string[] }) {
  const { t } = useTranslation("coupons")
  if (!data?.supported || !data.products.length) return null
  const all = data.products.length
  const off = data.products.filter((p) => excluded.includes(p.variantId)).length
  return <ToneBadge tone={off ? "blue" : "grey"}>{t("fields.poolProducts.count", { on: all - off, all })}</ToneBadge>
}

function OpenButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const { t } = useTranslation("coupons")
  const label = open ? t("fields.poolProducts.hide") : t("fields.poolProducts.show")
  return (
    <button type="button" title={label} aria-label={label} aria-expanded={open} onClick={onClick} className="rounded-md p-1 text-ui-fg-muted transition-fg hover:bg-ui-bg-base-hover hover:text-ui-fg-base">
      {open ? <ChevronDownMini /> : <ChevronRightMini />}
    </button>
  )
}

function PoolProducts({ data, state }: { data: PoolProductsResponse | undefined; state: PoolProductsState }) {
  const { t } = useTranslation("coupons")
  const [q, setQ] = useState("")
  if (!data) return <KitLoading className="min-h-0 py-4" label={t("fields.poolProducts.loading")} />
  if (!data.supported) return <EmptyState compact icon={<SquaresPlus />} title={t("fields.poolProducts.unsupported")} />
  if (!data.products.length) return <EmptyState compact icon={<SquaresPlus />} title={t("fields.poolProducts.empty")} />
  const term = q.trim().toLowerCase()
  const shown = data.products.filter((p) => !term || productLabel(p).toLowerCase().includes(term) || (p.sku ?? "").toLowerCase().includes(term))
  const ids = data.products.map((p) => p.variantId)
  const excluded = new Set(state.excluded)
  const set = (variantId: string, on: boolean) => state.onExcluded(on ? state.excluded.filter((v) => v !== variantId) : [...state.excluded, variantId])
  const allOn = ids.every((v) => !excluded.has(v))
  const allOff = ids.every((v) => excluded.has(v))
  return (
    <div className="flex flex-col gap-y-2 border-t border-ui-border-base px-2.5 pb-2.5 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text size="xsmall" className="text-ui-fg-subtle">
          {t("fields.poolProducts.hint")}
        </Text>
        <div className="flex items-center gap-1">
          <Button size="small" variant="transparent" disabled={allOn} onClick={() => state.onExcluded(state.excluded.filter((v) => !ids.includes(v)))}>
            {t("fields.poolProducts.all")}
          </Button>
          <Button size="small" variant="transparent" disabled={allOff} onClick={() => state.onExcluded([...new Set([...state.excluded, ...ids])])}>
            {t("fields.poolProducts.none")}
          </Button>
        </div>
      </div>
      {data.products.length > 8 ? <SearchInput className="sm:w-full" placeholder={t("fields.poolProducts.search")} value={q} onChange={setQ} /> : null}
      <div className="flex max-h-72 flex-col gap-y-0.5 overflow-y-auto rounded-md bg-ui-bg-base p-1 shadow-borders-base">
        {shown.map((p) => {
          const on = !excluded.has(p.variantId)
          return (
            <label key={p.variantId} className={clx("flex cursor-pointer items-center gap-x-2.5 rounded-md px-2 py-1.5 hover:bg-ui-bg-base-hover", !on && "opacity-60")}>
              <Checkbox checked={on} onCheckedChange={(v) => set(p.variantId, v === true)} />
              {p.thumbnail ? (
                <img src={p.thumbnail} alt="" loading="lazy" className="size-8 shrink-0 rounded-md border border-ui-border-base object-cover" />
              ) : (
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-ui-border-base bg-ui-bg-component text-ui-fg-muted">
                  <Photo />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <Text size="small" weight="plus" className={clx("truncate", !on && "line-through")}>
                  {p.title}
                </Text>
                {p.variantTitle ? (
                  <Text size="xsmall" className="truncate text-ui-fg-subtle">
                    {p.variantTitle}
                  </Text>
                ) : null}
              </span>
              <Text size="xsmall" className="shrink-0 font-mono text-ui-fg-muted">
                {p.sku ?? t("fields.poolProducts.noSku")}
              </Text>
            </label>
          )
        })}
        {shown.length === 0 ? <EmptyState compact icon={<MagnifyingGlass />} title={t("fields.poolProducts.noMatch")} /> : null}
      </div>
    </div>
  )
}
