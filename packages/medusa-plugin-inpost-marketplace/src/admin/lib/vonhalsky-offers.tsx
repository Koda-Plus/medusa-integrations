import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowUturnLeft, CheckCircle, CurrencyDollar, ExclamationCircle, FloppyDisk, ListBullet, MinusCircle, PaperPlane, Pencil, Photo, ShieldCheck, Tag, XCircle, XMark } from "@medusajs/icons"
import { Button, Checkbox, Input, Table, Text, toast } from "@medusajs/ui"
import type { OfferDto, OfferFilter, StatusResponse } from "../../modules/vonhalsky/lib/contract"
import { errorMessage, useListOffers, useReopenOffers, useSetPrice, useUnlistOffers, useVonHalskyOffers } from "./vonhalsky-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, ToneBadge, useDebouncedValue } from "./vonhalsky-blocks"
import { KitFetchingBar, KitSkeletonRows } from "./vonhalsky-kit"
import { OfferStatusBadge, fmtMoney, fmtNumber } from "./vonhalsky-ui"

export const OFFER_FILTERS: OfferFilter[] = ["all", "draft", "listed", "blocked", "closed"]
const PAGE = 50

const FILTER_ICON: Record<OfferFilter, ReactNode> = {
  all: <ListBullet />,
  draft: <PaperPlane />,
  listed: <CheckCircle />,
  blocked: <ExclamationCircle />,
  closed: <MinusCircle />,
}
const FILTER_GROUPS: OfferFilter[][] = [["all"], ["draft", "listed"], ["blocked"], ["closed"]]

function filterCount(s: StatusResponse, f: OfferFilter): number {
  return f === "all" ? s.counts.offers : s.counts[f]
}

/** The offers with their photo, status and reasons, matching keys, GPSR, channel price and stock; bulk list, take off, back to draft. */
export function OffersSection({ status: s, lang, filter, onFilter, initialQuery }: { status: StatusResponse; lang: string; filter: OfferFilter; onFilter: (f: OfferFilter) => void; initialQuery: string }) {
  const { t } = useTranslation("vonhalsky")
  const [input, setInput] = useState(initialQuery)
  const q = useDebouncedValue(input.trim())
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  useEffect(() => {
    setOffset(0)
    setSelected(new Set())
  }, [filter, q])

  const list = useVonHalskyOffers(filter, q, offset, PAGE)
  const rows = list.data?.offers ?? []
  const count = list.data?.count ?? 0
  const listOffers = useListOffers()
  const unlist = useUnlistOffers()
  const reopen = useReopenOffers()
  const ids = [...selected]
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  /* A second click on the active filter clears it. */
  const pick = (f: OfferFilter) => onFilter(filter === f ? "all" : f)
  const fresh = filter === "all" && !q

  const onList = async () => {
    try {
      const r = await listOffers.mutateAsync(ids)
      if (r.listed > 0) toast.success(t("toast.listed", { count: r.listed }))
      else toast.warning(t("toast.listedNone"))
      if (r.skipped.length > 0 && r.listed > 0) toast.info(t("toast.skipped", { count: r.skipped.length }))
      setSelected(new Set())
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const onUnlist = async () => {
    try {
      const r = await unlist.mutateAsync(ids)
      toast.success(t("toast.unlisted", { count: r.closed }))
      setSelected(new Set())
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const onReopen = async () => {
    try {
      const r = await reopen.mutateAsync(ids)
      toast.success(t("toast.reopened", { count: r.reopened }))
      setSelected(new Set())
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Section
      id="vonhalsky-offers"
      icon={<Tag />}
      title={t("offers.title")}
      pointsLabel={t("offers.subtitle")}
      points={[
        { icon: <Tag />, text: t("offers.points.variant") },
        { icon: <ShieldCheck />, text: t("offers.points.keys") },
        { icon: <CurrencyDollar />, text: t("offers.points.price") },
      ]}
      actions={<SearchInput value={input} onChange={setInput} placeholder={t("offers.search")} className="sm:w-72" />}
    >
      <FilterBar>
        {FILTER_GROUPS.map((group, i) => (
          <span key={group.join()} className="contents">
            {i > 0 ? <FilterDivider /> : null}
            {group.map((f) => (
              <FilterButton key={f} icon={FILTER_ICON[f]} label={t(`offerFilter.${f}`)} count={filterCount(s, f)} attention={f === "blocked"} active={filter === f} onClick={() => pick(f)} />
            ))}
          </span>
        ))}
      </FilterBar>
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-6 py-2.5">
          <Text size="small" weight="plus" className="text-ui-fg-subtle">
            {t("offers.selected", { count: selected.size })}
          </Text>
          <Button size="small" variant="primary" isLoading={listOffers.isPending} disabled={!s.configured} onClick={() => void onList()}>
            <PaperPlane />
            {t("actions.listSelected")}
          </Button>
          <Button size="small" variant="secondary" isLoading={unlist.isPending} onClick={() => void onUnlist()}>
            <XCircle />
            {t("actions.unlistSelected")}
          </Button>
          <Button size="small" variant="secondary" isLoading={reopen.isPending} onClick={() => void onReopen()}>
            <ArrowUturnLeft />
            {t("actions.reopenSelected")}
          </Button>
          <Button size="small" variant="transparent" onClick={() => setSelected(new Set())}>
            <XMark />
            {t("actions.clearSelection")}
          </Button>
        </div>
      ) : null}
      <KitFetchingBar active={list.isFetching && !list.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell className="w-8">
                <Checkbox
                  aria-label={t("offers.selectAll")}
                  checked={allOnPage}
                  disabled={rows.length === 0}
                  onCheckedChange={() => {
                    const next = new Set(selected)
                    for (const r of rows) {
                      if (allOnPage) next.delete(r.id)
                      else next.add(r.id)
                    }
                    setSelected(next)
                  }}
                />
              </Table.HeaderCell>
              <Table.HeaderCell>{t("offers.product")}</Table.HeaderCell>
              <Table.HeaderCell>{t("offers.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("offers.keys")}</Table.HeaderCell>
              <Table.HeaderCell>{t("offers.gpsr")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("offers.price")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("offers.stock")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.isLoading ? <KitSkeletonRows cols={7} rows={5} /> : null}
            {!list.isLoading && rows.length === 0 ? (
              <EmptyTableRow cols={7} icon={FILTER_ICON[filter]} title={fresh ? t("offers.empty") : t("offers.emptyFiltered")} points={fresh ? [{ icon: <Tag />, text: t("offers.emptyHint") }] : undefined} />
            ) : null}
            {rows.map((o) => (
              <Table.Row key={o.id} className="[&_td]:py-2.5 align-top">
                <Table.Cell>
                  <Checkbox aria-label={o.sku ?? o.id} checked={selected.has(o.id)} onCheckedChange={() => toggle(o.id)} />
                </Table.Cell>
                <Table.Cell>
                  <ProductCell offer={o} />
                </Table.Cell>
                <Table.Cell>
                  <StatusCell offer={o} status={s} />
                </Table.Cell>
                <Table.Cell>
                  <KeysCell offer={o} />
                </Table.Cell>
                <Table.Cell>
                  {o.manufacturer ? (
                    <span className="flex flex-col">
                      <span className="txt-compact-small text-ui-fg-base">{o.manufacturer}</span>
                      <span className="txt-compact-xsmall text-ui-fg-muted">{o.gpsr_source === "compliance" ? t("offers.fromCompliance") : t("offers.fromMetadata")}</span>
                    </span>
                  ) : (
                    <ToneBadge tone="orange">{t("offers.noValue")}</ToneBadge>
                  )}
                </Table.Cell>
                <Table.Cell className="text-right">
                  <PriceCell offer={o} lang={lang} />
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtNumber(o.stock, lang)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
      {count > PAGE ? (
        <Table.Pagination
          count={count}
          pageSize={PAGE}
          pageIndex={Math.floor(offset / PAGE)}
          pageCount={Math.max(1, Math.ceil(count / PAGE))}
          canPreviousPage={offset > 0}
          canNextPage={offset + PAGE < count}
          previousPage={() => setOffset(Math.max(0, offset - PAGE))}
          nextPage={() => setOffset(offset + PAGE)}
          translations={{ of: t("pagination.of"), results: t("pagination.results"), pages: t("pagination.pages"), prev: t("pagination.prev"), next: t("pagination.next") }}
        />
      ) : null}
    </Section>
  )
}

function ProductCell({ offer: o }: { offer: OfferDto }) {
  const { t } = useTranslation("vonhalsky")
  return (
    <div className="flex min-w-[220px] items-start gap-x-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-ui-border-base bg-ui-bg-subtle">
        {o.thumbnail ? <img src={o.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Photo className="text-ui-fg-muted" />}
      </div>
      <div className="flex min-w-0 flex-col items-start">
        <Link to={`/products/${o.product_id}`} className="txt-compact-small-plus text-ui-fg-base hover:text-ui-fg-interactive">
          {o.title ?? o.sku ?? o.variant_id}
        </Link>
        <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{o.sku ?? o.variant_id}</span>
        {o.remote_id ? <span className="txt-compact-xsmall text-ui-fg-muted">{t("offers.remote", { id: o.remote_id })}</span> : null}
        {o.demo ? <ToneBadge tone="purple">{t("demo.badge")}</ToneBadge> : null}
      </div>
    </div>
  )
}

function StatusCell({ offer: o, status: s }: { offer: OfferDto; status: StatusResponse }) {
  const { t } = useTranslation("vonhalsky")
  const keys = { brandKey: s.options.brandKey, mpnKey: s.options.mpnKey }
  return (
    <div className="flex min-w-[180px] flex-col gap-y-1">
      <span className="flex flex-wrap items-center gap-1">
        <OfferStatusBadge status={o.status} />
        {o.remote_status ? <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{o.remote_status}</span> : null}
      </span>
      {o.reasons.length > 0 ? (
        <ul className="flex flex-col gap-y-0.5">
          {o.reasons.map((r) => (
            <li key={r} className="txt-compact-xsmall text-ui-tag-orange-text">
              {t(`reason.${r}`, keys)}
            </li>
          ))}
        </ul>
      ) : null}
      {o.warnings.length > 0 ? (
        <ul className="flex flex-col gap-y-0.5">
          {o.warnings.map((w) => (
            <li key={w} className="txt-compact-xsmall text-ui-fg-muted">
              {t(`warning.${w}`, keys)}
            </li>
          ))}
        </ul>
      ) : null}
      {o.error ? (
        <Text size="xsmall" className="max-w-xs text-ui-tag-red-text">
          {t("offers.error")}: {o.error}
        </Text>
      ) : null}
    </div>
  )
}

function KeysCell({ offer: o }: { offer: OfferDto }) {
  const { t } = useTranslation("vonhalsky")
  const v = (x: string | null) => (x ? <span className="font-mono">{x}</span> : <span className="text-ui-tag-orange-text">{t("offers.noValue")}</span>)
  return (
    <div className="txt-compact-xsmall flex flex-col gap-y-0.5 text-ui-fg-subtle">
      <span>EAN {v(o.ean)}</span>
      <span>{v(o.brand)}</span>
      <span>MPN {v(o.mpn)}</span>
    </div>
  )
}

function PriceCell({ offer: o, lang }: { offer: OfferDto; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const save = useSetPrice()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(o.price_override ?? "")
  const submit = async (v: string | null) => {
    try {
      await save.mutateAsync({ id: o.id, value: v })
      toast.success(t("toast.priceSaved"))
      setEditing(false)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  if (editing) {
    return (
      <div className="flex min-w-[160px] flex-col items-end gap-1">
        <Input size="small" className="w-28 text-right" aria-label={t("actions.setOverride")} value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("offers.overridePlaceholder")} />
        <div className="flex gap-1">
          <Button size="small" variant="primary" isLoading={save.isPending} onClick={() => void submit(value.trim() || null)}>
            <FloppyDisk />
            {t("actions.save")}
          </Button>
          <Button size="small" variant="transparent" onClick={() => setEditing(false)}>
            {t("actions.cancel")}
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-end gap-y-0.5">
      <span className="flex items-center gap-x-1">
        <span className="txt-compact-small-plus whitespace-nowrap tabular-nums text-ui-fg-base">{o.price ? fmtMoney(o.price, o.currency_code, lang) : t("offers.noValue")}</span>
        <RowActions
          actions={[
            { key: "set", label: t("actions.setOverride"), icon: <Pencil />, onClick: () => setEditing(true) },
            { key: "clear", label: t("actions.clearOverride"), icon: <ArrowUturnLeft />, hidden: !o.price_override, loading: save.isPending, onClick: () => void submit(null) },
          ]}
        />
      </span>
      {o.price_override ? <ToneBadge tone="blue">{t("offers.override")}</ToneBadge> : null}
      {o.base_price ? <span className="txt-compact-xsmall whitespace-nowrap text-ui-fg-muted">{t("offers.base", { price: fmtMoney(o.base_price, o.currency_code, lang) })}</span> : null}
    </div>
  )
}
