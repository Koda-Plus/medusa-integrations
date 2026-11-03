import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  Adjustments,
  ArrowPath,
  ArrowUturnLeft,
  CheckCircle,
  Clock,
  CurrencyDollar,
  ExclamationCircle,
  FloppyDisk,
  FolderOpen,
  ListBullet,
  MagnifyingGlass,
  MinusCircle,
  PaperPlane,
  Pencil,
  Photo,
  ReceiptPercent,
  ShieldCheck,
  Tag,
  XCircle,
  XMark,
} from "@medusajs/icons"
import { Button, Checkbox, InlineTip, Input, Table, Text, Textarea, toast, usePrompt } from "@medusajs/ui"
import type { AttributeDto, HintDto, OfferDto, OfferFilter, StatusResponse } from "../../modules/vonhalsky/lib/contract"
import {
  errorMessage,
  useHintOffer,
  useListOffers,
  useReopenOffers,
  useSetOfferAttributes,
  useSetOfferCategory,
  useSetPrice,
  useSetProgram,
  useSetPromotion,
  useUnlistOffers,
  useVonHalskyAttributes,
  useVonHalskyOffers,
  type PromotionMode,
} from "./vonhalsky-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, ToneBadge, useDebouncedValue, type Tone } from "./vonhalsky-blocks"
import { CategoryResults } from "./vonhalsky-category-picker"
import { KitFetchingBar, KitLoading, KitSkeletonRows } from "./vonhalsky-kit"
import { Field, FormDrawer, OfferStatusBadge, RemoteStatusBadge, SELECT, fmtDateTime, fmtMoney, fmtNumber } from "./vonhalsky-ui"

export const OFFER_FILTERS: OfferFilter[] = ["all", "draft", "listed", "pending", "blocked", "closed"]
const PAGE = 50
const COLS = 9

const FILTER_ICON: Record<OfferFilter, ReactNode> = {
  all: <ListBullet />,
  draft: <PaperPlane />,
  listed: <CheckCircle />,
  pending: <Clock />,
  blocked: <ExclamationCircle />,
  closed: <MinusCircle />,
}
const FILTER_GROUPS: OfferFilter[][] = [["all"], ["draft", "listed"], ["pending", "blocked"], ["closed"]]
const ATTENTION: OfferFilter[] = ["pending", "blocked"]

function filterCount(s: StatusResponse, f: OfferFilter): number {
  return f === "all" ? s.counts.offers : s.counts[f]
}

/** Which side panel is open: one per kind, for the offers it names. */
type Panel = { kind: "category"; ids: string[] } | { kind: "attributes"; offer: OfferDto } | { kind: "hint"; offer: OfferDto } | { kind: "promotion"; ids: string[] } | null

/**
 * The offers with their photo, our status and the marketplace's, reasons and
 * validation, the category, matching keys, GPSR, channel and marketplace
 * price, stock; bulk list, take off, back to draft, category, promotion and
 * the price program; per offer the catalog hint and the category parameters.
 */
export function OffersSection({ status: s, lang, filter, onFilter, initialQuery }: { status: StatusResponse; lang: string; filter: OfferFilter; onFilter: (f: OfferFilter) => void; initialQuery: string }) {
  const { t } = useTranslation("vonhalsky")
  const prompt = usePrompt()
  const [input, setInput] = useState(initialQuery)
  const q = useDebouncedValue(input.trim())
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [panel, setPanel] = useState<Panel>(null)
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
  const program = useSetProgram()
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
  const real = s.mode !== "off"

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
    const ok = await prompt({ title: t("confirm.unlistTitle"), description: t("confirm.unlistText", { count: ids.length }), confirmText: t("actions.unlistSelected"), cancelText: t("actions.cancel") })
    if (!ok) return
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
  const onProgram = async (mode: "IN" | "OUT") => {
    const ok = await prompt({
      title: mode === "IN" ? t("confirm.programInTitle") : t("confirm.programOutTitle"),
      description: mode === "IN" ? t("confirm.programInText", { count: ids.length }) : t("confirm.programOutText", { count: ids.length }),
      confirmText: mode === "IN" ? t("actions.programIn") : t("actions.programOut"),
      cancelText: t("actions.cancel"),
    })
    if (!ok) return
    try {
      const r = await program.mutateAsync({ ids, mode })
      if (r.sent > 0) toast.success(t("toast.programSent", { count: r.sent }))
      else toast.warning(t("toast.onlyListed"))
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
        { icon: <FolderOpen />, text: t("offers.points.category") },
        { icon: <CurrencyDollar />, text: t("offers.points.price") },
        s.counts.commands_pending > 0 && { icon: <Clock />, text: t("offers.points.commands", { count: s.counts.commands_pending }), tone: "orange" },
      ]}
      actions={<SearchInput value={input} onChange={setInput} placeholder={t("offers.search")} className="sm:w-72" />}
    >
      <FilterBar>
        {FILTER_GROUPS.map((group, i) => (
          <span key={group.join()} className="contents">
            {i > 0 ? <FilterDivider /> : null}
            {group.map((f) => (
              <FilterButton key={f} icon={FILTER_ICON[f]} label={t(`offerFilter.${f}`)} count={filterCount(s, f)} attention={ATTENTION.includes(f)} active={filter === f} onClick={() => pick(f)} />
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
          <Button size="small" variant="secondary" onClick={() => setPanel({ kind: "category", ids })}>
            <FolderOpen />
            {t("actions.setCategory")}
          </Button>
          <Button size="small" variant="secondary" disabled={!real} onClick={() => setPanel({ kind: "promotion", ids })}>
            <ReceiptPercent />
            {t("actions.promotion")}
          </Button>
          <Button size="small" variant="secondary" isLoading={program.isPending && program.variables?.mode === "IN"} disabled={!real} onClick={() => void onProgram("IN")}>
            <CurrencyDollar />
            {t("actions.programIn")}
          </Button>
          <Button size="small" variant="secondary" isLoading={program.isPending && program.variables?.mode === "OUT"} disabled={!real} onClick={() => void onProgram("OUT")}>
            <MinusCircle />
            {t("actions.programOut")}
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
              <Table.HeaderCell>{t("offers.category")}</Table.HeaderCell>
              <Table.HeaderCell>{t("offers.keys")}</Table.HeaderCell>
              <Table.HeaderCell>{t("offers.gpsr")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("offers.price")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("offers.stock")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.isLoading ? <KitSkeletonRows cols={COLS} rows={5} /> : null}
            {!list.isLoading && rows.length === 0 ? (
              <EmptyTableRow cols={COLS} icon={FILTER_ICON[filter]} title={fresh ? t("offers.empty") : t("offers.emptyFiltered")} points={fresh ? [{ icon: <Tag />, text: t("offers.emptyHint") }] : undefined} />
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
                  <StatusCell offer={o} status={s} lang={lang} />
                </Table.Cell>
                <Table.Cell>
                  <CategoryCell offer={o} />
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
                <Table.Cell className="whitespace-nowrap text-right tabular-nums">
                  <span className="flex flex-col items-end">
                    <span>{fmtNumber(o.stock, lang)}</span>
                    {o.remote_stock !== null && o.remote_stock !== o.stock ? <span className="txt-compact-xsmall text-ui-fg-muted">{t("offers.remoteStock", { count: o.remote_stock })}</span> : null}
                  </span>
                </Table.Cell>
                <Table.Cell className="text-right">
                  <RowActions
                    actions={[
                      { key: "hint", label: t("actions.hint"), icon: <MagnifyingGlass />, disabled: !real, onClick: () => setPanel({ kind: "hint", offer: o }) },
                      { key: "category", label: t("actions.setCategory"), icon: <FolderOpen />, onClick: () => setPanel({ kind: "category", ids: [o.id] }) },
                      { key: "attributes", label: o.category_id ? t("actions.attributes") : t("offers.attributesNeedCategory"), icon: <Adjustments />, disabled: !o.category_id, onClick: () => setPanel({ kind: "attributes", offer: o }) },
                    ]}
                  />
                </Table.Cell>
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
      {panel?.kind === "category" ? <CategoryDrawer ids={panel.ids} onDone={() => setPanel(null)} onSaved={() => setSelected(new Set())} /> : null}
      {panel?.kind === "attributes" ? <AttributesDrawer offer={panel.offer} onDone={() => setPanel(null)} /> : null}
      {panel?.kind === "hint" ? <HintDrawer offer={panel.offer} onDone={() => setPanel(null)} /> : null}
      {panel?.kind === "promotion" ? <PromotionDrawer ids={panel.ids} lang={lang} onDone={() => setPanel(null)} /> : null}
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
        {o.image_count !== null ? <span className="txt-compact-xsmall text-ui-fg-muted">{t("offers.images", { count: o.image_count })}</span> : null}
        {o.demo ? <ToneBadge tone="purple">{t("demo.badge")}</ToneBadge> : null}
      </div>
    </div>
  )
}

const COMMAND_TONE: Record<NonNullable<OfferDto["command"]>["status"], Tone> = { PENDING: "orange", SUCCESS: "green", FAILURE: "red" }

function StatusCell({ offer: o, status: s, lang }: { offer: OfferDto; status: StatusResponse; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const keys = { brandKey: s.options.brandKey, mpnKey: s.options.mpnKey }
  const cmd = o.command
  return (
    <div className="flex min-w-[200px] flex-col gap-y-1">
      <span className="flex flex-wrap items-center gap-1">
        <OfferStatusBadge status={o.status} />
        {o.remote_status ? <RemoteStatusBadge status={o.remote_status} /> : null}
      </span>
      {cmd && cmd.status !== "SUCCESS" ? (
        <span title={cmd.at ? fmtDateTime(cmd.at, lang) : undefined}>
          <ToneBadge tone={COMMAND_TONE[cmd.status]} icon={cmd.status === "PENDING" ? <Clock /> : <ExclamationCircle />}>
            {t(`command.${cmd.status}`, { kind: t(`commandKind.${cmd.kind}`, { defaultValue: cmd.kind }) })}
          </ToneBadge>
        </span>
      ) : null}
      {o.reasons.length > 0 ? (
        <ul className="flex flex-col gap-y-0.5">
          {o.reasons.map((r) => (
            <li key={r} className="txt-compact-xsmall text-ui-tag-orange-text">
              {t(`reason.${r}`, keys)}
            </li>
          ))}
        </ul>
      ) : null}
      {o.validation.length > 0 ? (
        <ul className="flex flex-col gap-y-0.5" aria-label={t("offers.validation")}>
          {o.validation.map((v, i) => (
            <li key={`${v.code}-${i}`} className="txt-compact-xsmall max-w-xs text-ui-tag-red-text">
              {v.message ? `${v.message} (${v.code})` : v.code}
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

const SOURCE_TONE: Record<NonNullable<OfferDto["category_source"]>, Tone> = { manual: "blue", map: "grey", hint: "orange" }

function CategoryCell({ offer: o }: { offer: OfferDto }) {
  const { t } = useTranslation("vonhalsky")
  return (
    <div className="flex min-w-[180px] max-w-[260px] flex-col items-start gap-y-1">
      {o.category_id ? (
        <span className="txt-compact-xsmall text-ui-fg-base">{o.category_path ?? o.category_id}</span>
      ) : (
        <ToneBadge tone="orange">{t("offers.noCategory")}</ToneBadge>
      )}
      {o.category_source ? <ToneBadge tone={SOURCE_TONE[o.category_source]}>{t(`categorySource.${o.category_source}`)}</ToneBadge> : null}
      {o.hint?.name ? <span className="txt-compact-xsmall text-ui-fg-muted">{t("offers.hintName", { name: o.hint.name })}</span> : null}
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

/** "-10%", "-5,00 zł" or "39,99 zł": the promotion as a buyer sees it. */
function promotionLabel(p: NonNullable<OfferDto["promotion"]>, currency: string, lang: string): string {
  if (p.value === null) return ""
  if (p.mode === "PERCENTAGE") return `-${p.value}%`
  if (p.mode === "AMOUNT") return `-${fmtMoney(p.value, currency, lang)}`
  return fmtMoney(p.value, currency, lang)
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
  const remoteDiffers = o.remote_price !== null && o.remote_price !== o.price
  const discounted = o.remote_final_price !== null && o.remote_final_price !== o.remote_price
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
      {remoteDiffers && o.remote_price ? (
        <span className="txt-compact-xsmall whitespace-nowrap text-ui-tag-orange-text" title={t("offers.remotePriceHint")}>
          {t("offers.remotePrice", { price: fmtMoney(o.remote_price, o.currency_code, lang) })}
        </span>
      ) : null}
      {discounted && o.remote_final_price ? <span className="txt-compact-xsmall whitespace-nowrap text-ui-fg-subtle">{t("offers.finalPrice", { price: fmtMoney(o.remote_final_price, o.currency_code, lang) })}</span> : null}
      {o.promotion ? (
        <span title={[fmtDateTime(o.promotion.start, lang), fmtDateTime(o.promotion.end, lang)].filter(Boolean).join(" > ")}>
          <ToneBadge tone="green" icon={<ReceiptPercent />}>
            {t("offers.promotionBadge", { value: promotionLabel(o.promotion, o.currency_code, lang) })}
          </ToneBadge>
        </span>
      ) : null}
      {o.program === "IN" ? <ToneBadge tone="blue">{t("offers.programBadge")}</ToneBadge> : null}
    </div>
  )
}

/** Picks a marketplace leaf for one offer or many; "Back to the mapping" clears the manual choice. */
function CategoryDrawer({ ids, onDone, onSaved }: { ids: string[]; onDone: () => void; onSaved: () => void }) {
  const { t } = useTranslation("vonhalsky")
  const save = useSetOfferCategory()
  const write = async (categoryId: string | null) => {
    try {
      const r = await save.mutateAsync({ ids, categoryId })
      toast.success(categoryId ? t("toast.categorySet", { count: r.updated }) : t("toast.categoryCleared", { count: r.updated }))
      onSaved()
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <FormDrawer
      open
      onOpenChange={(open) => (open ? undefined : onDone())}
      title={t("categoryDrawer.title", { count: ids.length })}
      description={t("categoryDrawer.text")}
      extra={
        <Button size="small" variant="transparent" isLoading={save.isPending && save.variables?.categoryId === null} onClick={() => void write(null)}>
          <ArrowUturnLeft />
          {t("actions.categoryFromMap")}
        </Button>
      }
    >
      {save.isPending ? <KitLoading label={t("categoryDrawer.saving")} /> : <CategoryResults onPick={(c) => void write(c.id)} />}
    </FormDrawer>
  )
}

/** The catalog match of one offer (by EAN, then MPN, then the name): asked when the panel opens. */
function HintDrawer({ offer, onDone }: { offer: OfferDto; onDone: () => void }) {
  const { t } = useTranslation("vonhalsky")
  const hint = useHintOffer()
  const [hints, setHints] = useState<HintDto[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const ask = () => {
    setFailed(null)
    hint
      .mutateAsync(offer.id)
      .then((r) => setHints(r.hints))
      .catch((e) => setFailed(errorMessage(e)))
  }
  useEffect(ask, [offer.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <FormDrawer
      open
      onOpenChange={(open) => (open ? undefined : onDone())}
      title={t("hintDrawer.title")}
      description={t("hintDrawer.text", { name: offer.title ?? offer.sku ?? offer.variant_id })}
      extra={
        <Button size="small" variant="transparent" isLoading={hint.isPending} onClick={ask}>
          <ArrowPath />
          {t("actions.askAgain")}
        </Button>
      }
    >
      {hint.isPending ? <KitLoading label={t("hintDrawer.asking")} /> : null}
      {failed ? (
        <InlineTip variant="error" label={t("hintDrawer.failed")}>
          {failed}
        </InlineTip>
      ) : null}
      {hints && hints.length === 0 ? (
        <InlineTip variant="info" label={t("hintDrawer.noneLabel")}>
          {t("hintDrawer.none")}
        </InlineTip>
      ) : null}
      {hints && hints.length > 0 ? (
        <>
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("hintDrawer.used")}
          </Text>
          <ul className="flex flex-col gap-y-2">
            {hints.map((h, i) => (
              <li key={`${h.productId ?? "hint"}-${i}`} className="flex flex-col gap-y-0.5 rounded-md border border-ui-border-base px-3 py-2">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="txt-compact-small-plus text-ui-fg-base">{h.name ?? t("offers.noValue")}</span>
                  {i === 0 ? <ToneBadge tone="green">{t("hintDrawer.best")}</ToneBadge> : null}
                </span>
                <span className="txt-compact-xsmall text-ui-fg-subtle">{h.categoryPath ?? h.categoryId ?? t("offers.noCategory")}</span>
                <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{[h.brand, h.ean && `EAN ${h.ean}`, h.mpn && `MPN ${h.mpn}`].filter(Boolean).join(", ")}</span>
                {h.attributes > 0 ? <span className="txt-compact-xsmall text-ui-fg-muted">{t("hintDrawer.attributes", { count: h.attributes })}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </FormDrawer>
  )
}

const NUMERIC = new Set(["NUMERIC", "NUMERIC_FLOAT"])

/** One attribute as a field: a dictionary as a select (or checkboxes when many values are allowed), numbers, dates, text. */
function AttributeField({ a, values, onChange }: { a: AttributeDto; values: string[]; onChange: (values: string[]) => void }) {
  const { t } = useTranslation("vonhalsky")
  const one = values[0] ?? ""
  const label = a.unit ? `${a.name} (${a.unit})` : a.name
  if (a.type === "DICTIONARY" && a.options.length > 0) {
    if (a.multiple) {
      return (
        <Field label={label} required={a.required} hint={t("attributes.many")}>
          <span className="flex flex-wrap gap-x-4 gap-y-1.5">
            {a.options.map((o) => (
              <span key={o.id} className="inline-flex items-center gap-x-1.5">
                <Checkbox checked={values.includes(o.value)} onCheckedChange={(on) => onChange(on === true ? [...values, o.value] : values.filter((v) => v !== o.value))} />
                <Text size="small">{o.value}</Text>
              </span>
            ))}
          </span>
        </Field>
      )
    }
    return (
      <Field label={label} required={a.required}>
        <select className={SELECT} value={one} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}>
          <option value="">{t("attributes.choose")}</option>
          {a.options.map((o) => (
            <option key={o.id} value={o.value}>
              {o.value}
            </option>
          ))}
        </select>
      </Field>
    )
  }
  if (a.multiple) {
    return (
      <Field label={label} required={a.required} hint={t("attributes.perLine")}>
        <Textarea rows={3} value={values.join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} />
      </Field>
    )
  }
  if (a.type === "LONG_TEXT_VALUE") {
    return (
      <Field label={label} required={a.required}>
        <Textarea rows={3} value={one} onChange={(e) => onChange([e.target.value])} />
      </Field>
    )
  }
  const type = a.type && NUMERIC.has(a.type) ? "number" : a.type === "DATE" ? "date" : a.type === "URL" ? "url" : "text"
  return (
    <Field label={label} required={a.required}>
      <Input size="small" type={type} step={a.type === "NUMERIC" ? 1 : "any"} value={one} onChange={(e) => onChange([e.target.value])} />
    </Field>
  )
}

/** The parameters of the offer's category; required ones first. The values are sent with the next listing. */
function AttributesDrawer({ offer, onDone }: { offer: OfferDto; onDone: () => void }) {
  const { t } = useTranslation("vonhalsky")
  const [fresh, setFresh] = useState(false)
  const defs = useVonHalskyAttributes(offer.category_id, fresh)
  const save = useSetOfferAttributes()
  const [values, setValues] = useState<Record<string, string[]>>(() => Object.fromEntries(offer.attributes.map((a) => [a.id, a.values])))
  const attributes = [...(defs.data?.attributes ?? [])].sort((a, b) => Number(b.required) - Number(a.required))
  const missing = attributes.filter((a) => a.required && !(values[a.id] ?? []).some((v) => v.trim()))
  const onSave = async () => {
    const list = Object.entries(values)
      .map(([id, vs]) => ({ id, values: vs.map((v) => v.trim()).filter(Boolean) }))
      .filter((a) => a.values.length > 0)
    try {
      await save.mutateAsync({ id: offer.id, attributes: list })
      toast.success(t("toast.attributesSaved"))
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <FormDrawer
      open
      onOpenChange={(open) => (open ? undefined : onDone())}
      title={t("attributes.title")}
      description={offer.category_path ?? offer.category_id ?? undefined}
      confirmLabel={t("actions.save")}
      onConfirm={() => void onSave()}
      loading={save.isPending}
      disabled={defs.isLoading || attributes.length === 0}
      extra={
        <Button size="small" variant="transparent" isLoading={defs.isFetching && fresh} onClick={() => setFresh(true)}>
          <ArrowPath />
          {t("actions.readAgain")}
        </Button>
      }
    >
      <InlineTip variant="info" label={t("attributes.noteLabel")}>
        {t("attributes.note")}
      </InlineTip>
      {defs.isLoading ? <KitLoading label={t("attributes.loading")} /> : null}
      {defs.isError ? (
        <InlineTip variant="error" label={t("attributes.title")}>
          {errorMessage(defs.error)}
        </InlineTip>
      ) : null}
      {!defs.isLoading && !defs.isError && attributes.length === 0 ? (
        <Text size="small" className="text-ui-fg-muted">
          {t("attributes.none")}
        </Text>
      ) : null}
      {attributes.map((a) => (
        <AttributeField key={a.id} a={a} values={values[a.id] ?? []} onChange={(vs) => setValues({ ...values, [a.id]: vs })} />
      ))}
      {missing.length > 0 && attributes.length > 0 ? (
        <Text size="xsmall" className="text-ui-tag-orange-text">
          {t("attributes.missing", { count: missing.length })}
        </Text>
      ) : null}
    </FormDrawer>
  )
}

const MODES: PromotionMode[] = ["PERCENTAGE", "AMOUNT", "FIXED_PRICE"]

/** "2026-11-02T14:30" in local time for a datetime-local field. */
function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A promotion on the selected listed offers, or the end of it. Both ask before anything is sent. */
function PromotionDrawer({ ids, lang, onDone }: { ids: string[]; lang: string; onDone: () => void }) {
  const { t } = useTranslation("vonhalsky")
  const prompt = usePrompt()
  const save = useSetPromotion()
  const [mode, setMode] = useState<PromotionMode>("PERCENTAGE")
  const [value, setValue] = useState("")
  const [start, setStart] = useState(() => localInput(new Date()))
  const [end, setEnd] = useState(() => localInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)))
  const n = Number(value.replace(",", "."))
  const startAt = new Date(start)
  const endAt = new Date(end)
  const valid = Number.isFinite(n) && n > 0 && (mode !== "PERCENTAGE" || n < 100) && Number.isFinite(startAt.getTime()) && Number.isFinite(endAt.getTime()) && endAt > startAt

  const send = async (promotion: { mode: PromotionMode; value: number; start: string; end: string } | null) => {
    const ok = await prompt({
      title: promotion ? t("confirm.promotionTitle") : t("confirm.promotionEndTitle"),
      description: promotion
        ? t("confirm.promotionText", { count: ids.length, value: mode === "PERCENTAGE" ? `${n}%` : fmtMoney(n, "pln", lang), from: fmtDateTime(promotion.start, lang), to: fmtDateTime(promotion.end, lang) })
        : t("confirm.promotionEndText", { count: ids.length }),
      confirmText: promotion ? t("actions.sendPromotion") : t("actions.endPromotion"),
      cancelText: t("actions.cancel"),
      variant: promotion ? "confirmation" : "danger",
    })
    if (!ok) return
    try {
      const r = await save.mutateAsync({ ids, promotion })
      if (r.sent === 0 && r.failed === 0) toast.warning(t("toast.onlyListed"))
      else if (r.failed > 0) toast.warning(t("toast.promotionPartly", { sent: r.sent, failed: r.failed }))
      else toast.success(t("toast.promotionSent", { count: r.sent }))
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <FormDrawer
      open
      onOpenChange={(open) => (open ? undefined : onDone())}
      title={t("promotion.title", { count: ids.length })}
      description={t("promotion.text")}
      confirmLabel={t("actions.sendPromotion")}
      onConfirm={() => void send({ mode, value: Math.round(n * 100) / 100, start: startAt.toISOString(), end: endAt.toISOString() })}
      loading={save.isPending && save.variables?.promotion !== null}
      disabled={!valid}
      extra={
        <Button size="small" variant="transparent" isLoading={save.isPending && save.variables?.promotion === null} onClick={() => void send(null)}>
          <XCircle />
          {t("actions.endPromotion")}
        </Button>
      }
    >
      <Field label={t("promotion.mode")}>
        <select className={SELECT} value={mode} onChange={(e) => setMode(e.target.value as PromotionMode)}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {t(`promotion.modes.${m}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("promotion.value")} hint={t(`promotion.valueHint.${mode}`)} required>
        <Input size="small" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === "PERCENTAGE" ? "10" : "19.99"} />
      </Field>
      <Field label={t("promotion.start")} required>
        <Input size="small" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
      </Field>
      <Field label={t("promotion.end")} required hint={endAt <= startAt ? t("promotion.endAfterStart") : undefined}>
        <Input size="small" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
      </Field>
    </FormDrawer>
  )
}
