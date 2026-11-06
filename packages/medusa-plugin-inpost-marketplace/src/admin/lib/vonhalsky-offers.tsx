import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  Adjustments,
  ArrowDownTray,
  ArrowPath,
  ArrowUturnLeft,
  Calendar,
  CheckCircle,
  Clock,
  CurrencyDollar,
  ExclamationCircle,
  EyeSlash,
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
import type { AttributeDto, HintDto, ImportOffersResponse, OfferDto, OfferFilter, StatusResponse } from "../../modules/vonhalsky/lib/contract"
import {
  errorMessage,
  useDetachOffers,
  useEditOffer,
  useHintOffer,
  useImportOffers,
  useListOffers,
  useReopenOffers,
  useSetAttributesMany,
  useSetDaysToShip,
  useSetOfferAttributes,
  useSetOfferCategory,
  useSetPrice,
  useSetProgram,
  useSetPromotion,
  useUnlistOffers,
  useVonHalskyAttributes,
  useVonHalskyOffers,
  type OfferEditInput,
  type PromotionMode,
} from "./vonhalsky-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, ToneBadge, useDebouncedValue, type Tone } from "./vonhalsky-blocks"
import { CategoryResults } from "./vonhalsky-category-picker"
import { KitFetchingBar, KitLoading, KitSkeletonRows } from "./vonhalsky-kit"
import { Field, FormDrawer, OfferStatusBadge, RemoteStatusBadge, SELECT, fmtDateTime, fmtMoney, fmtNumber, syncLine } from "./vonhalsky-ui"

export const OFFER_FILTERS: OfferFilter[] = ["all", "draft", "listed", "pending", "blocked", "closed", "detached"]
const PAGE = 50
const COLS = 9

const FILTER_ICON: Record<OfferFilter, ReactNode> = {
  all: <ListBullet />,
  draft: <PaperPlane />,
  listed: <CheckCircle />,
  pending: <Clock />,
  blocked: <ExclamationCircle />,
  closed: <MinusCircle />,
  detached: <EyeSlash />,
}
const FILTER_GROUPS: OfferFilter[][] = [["all"], ["draft", "listed"], ["pending", "blocked"], ["closed", "detached"]]
const ATTENTION: OfferFilter[] = ["pending", "blocked"]

function filterCount(s: StatusResponse, f: OfferFilter): number {
  return f === "all" ? s.counts.offers : s.counts[f]
}

/** Which side panel is open: one per kind, for the offers it names. */
type Panel =
  | { kind: "category"; ids: string[] }
  | { kind: "attributes"; offers: OfferDto[]; ids: string[] }
  | { kind: "hint"; offer: OfferDto }
  | { kind: "promotion"; ids: string[] }
  | { kind: "edit"; offer: OfferDto }
  | { kind: "days"; ids: string[] }
  | { kind: "imported"; result: ImportOffersResponse }
  | null

/**
 * The offers with their photo, our status and the marketplace's, reasons and
 * validation, the category, matching keys, GPSR, channel and marketplace
 * price, stock; bulk list, close on InPost, remove from the panel only, back
 * to draft, category, category parameters, days to ship, promotion and the
 * price program; per offer the edit (name, description, photos, package,
 * days to ship), the catalog hint and the category parameters; the import
 * of offers already on the marketplace and how often price and stock go out.
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
  const detach = useDetachOffers()
  const importer = useImportOffers()
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
    const ok = await prompt({ title: t("confirm.unlistTitle"), description: t("confirm.unlistText", { count: ids.length }), confirmText: t("actions.unlistSelected"), cancelText: t("actions.cancel"), variant: "danger" })
    if (!ok) return
    try {
      const r = await unlist.mutateAsync(ids)
      toast.success(t("toast.unlisted", { count: r.closed }))
      setSelected(new Set())
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  /* Two different removals, worded apart: this one never asks InPost anything. */
  const onDetach = async () => {
    const ok = await prompt({ title: t("confirm.detachTitle"), description: t("confirm.detachText", { count: ids.length }), confirmText: t("actions.detachSelected"), cancelText: t("actions.cancel"), variant: "danger" })
    if (!ok) return
    try {
      const r = await detach.mutateAsync(ids)
      if (r.detached > 0) toast.success(t("toast.detached", { count: r.detached }))
      if (r.skipped.length > 0) toast.info(t("toast.detachSkipped", { count: r.skipped.length }))
      setSelected(new Set())
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const onImport = async () => {
    try {
      const r = await importer.mutateAsync()
      setPanel({ kind: "imported", result: r })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  /* The same parameters on many offers: only offers of one category (the parameters are the category's). */
  const onBulkAttributes = () => {
    const chosen = rows.filter((r) => selected.has(r.id))
    const cats = new Set(chosen.map((r) => r.category_id))
    if (chosen.length !== ids.length || cats.size !== 1 || cats.has(null)) {
      toast.warning(t("toast.oneCategory"))
      return
    }
    setPanel({ kind: "attributes", offers: chosen, ids })
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
        real && { icon: <ArrowPath />, text: syncLine(s, lang, (k, o) => t(k, o)), tone: s.sync.priceStock ? "green" : "grey" },
      ]}
      actions={
        <>
          {real ? (
            <Button size="small" variant="secondary" isLoading={importer.isPending} onClick={() => void onImport()}>
              <ArrowDownTray />
              {t("actions.importOffers")}
            </Button>
          ) : null}
          <SearchInput value={input} onChange={setInput} placeholder={t("offers.search")} className="sm:w-72" />
        </>
      }
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
          <Button size="small" variant="secondary" isLoading={detach.isPending} onClick={() => void onDetach()}>
            <EyeSlash />
            {t("actions.detachSelected")}
          </Button>
          <Button size="small" variant="secondary" isLoading={reopen.isPending} onClick={() => void onReopen()}>
            <ArrowUturnLeft />
            {t("actions.reopenSelected")}
          </Button>
          <Button size="small" variant="secondary" onClick={() => setPanel({ kind: "category", ids })}>
            <FolderOpen />
            {t("actions.setCategory")}
          </Button>
          <Button size="small" variant="secondary" onClick={onBulkAttributes}>
            <Adjustments />
            {t("actions.attributes")}
          </Button>
          <Button size="small" variant="secondary" onClick={() => setPanel({ kind: "days", ids })}>
            <Calendar />
            {t("actions.daysToShip")}
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
                      { key: "edit", label: o.command?.status === "PENDING" ? t("edit.busy") : t("actions.editOffer"), icon: <Pencil />, disabled: o.command?.status === "PENDING", onClick: () => setPanel({ kind: "edit", offer: o }) },
                      { key: "hint", label: t("actions.hint"), icon: <MagnifyingGlass />, disabled: !real, onClick: () => setPanel({ kind: "hint", offer: o }) },
                      { key: "category", label: t("actions.setCategory"), icon: <FolderOpen />, onClick: () => setPanel({ kind: "category", ids: [o.id] }) },
                      { key: "attributes", label: o.category_id ? t("actions.attributes") : t("offers.attributesNeedCategory"), icon: <Adjustments />, disabled: !o.category_id, onClick: () => setPanel({ kind: "attributes", offers: [o], ids: [o.id] }) },
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
      {panel?.kind === "attributes" ? <AttributesDrawer offers={panel.offers} ids={panel.ids} onDone={() => setPanel(null)} onSaved={() => setSelected(new Set())} /> : null}
      {panel?.kind === "edit" ? <EditDrawer offer={panel.offer} onDone={() => setPanel(null)} /> : null}
      {panel?.kind === "days" ? <DaysDrawer ids={panel.ids} status={s} onDone={() => setPanel(null)} onSaved={() => setSelected(new Set())} /> : null}
      {panel?.kind === "imported" ? <ImportedDrawer result={panel.result} onDone={() => setPanel(null)} /> : null}
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
        {o.overridden.length > 0 ? (
          <span title={o.overridden.map((f) => t(`edit.field.${f}`)).join(", ")}>
            <ToneBadge tone="blue" icon={<Pencil />}>
              {t("offers.edited", { count: o.overridden.length })}
            </ToneBadge>
          </span>
        ) : null}
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

/**
 * The parameters of a category; required ones first. One offer: its saved
 * values, replaced on save. Many offers of one category (bulk): empty, and
 * only the parameters filled in are set on every offer. An offer on the
 * marketplace gets them at once, a draft with its listing.
 */
function AttributesDrawer({ offers, ids, onDone, onSaved }: { offers: OfferDto[]; ids: string[]; onDone: () => void; onSaved: () => void }) {
  const { t } = useTranslation("vonhalsky")
  const first = offers[0]
  const bulk = ids.length > 1
  const [fresh, setFresh] = useState(false)
  const defs = useVonHalskyAttributes(first?.category_id ?? null, fresh)
  const saveOne = useSetOfferAttributes()
  const saveMany = useSetAttributesMany()
  const [values, setValues] = useState<Record<string, string[]>>(() => (bulk || !first ? {} : Object.fromEntries(first.attributes.map((a) => [a.id, a.values]))))
  const attributes = [...(defs.data?.attributes ?? [])].sort((a, b) => Number(b.required) - Number(a.required))
  const missing = attributes.filter((a) => a.required && !(values[a.id] ?? []).some((v) => v.trim()))
  const list = Object.entries(values)
    .map(([id, vs]) => ({ id, values: vs.map((v) => v.trim()).filter(Boolean) }))
    .filter((a) => a.values.length > 0)
  const onSave = async () => {
    try {
      if (bulk) {
        const r = await saveMany.mutateAsync({ ids, attributes: list })
        toast.success(t("toast.attributesSavedMany", { count: r.updated, sent: r.sent }))
        if (r.skipped.length > 0) toast.info(t("toast.editSkipped", { count: r.skipped.length }))
        onSaved()
      } else {
        await saveOne.mutateAsync({ id: first.id, attributes: list })
        toast.success(t("toast.attributesSaved"))
      }
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <FormDrawer
      open
      onOpenChange={(open) => (open ? undefined : onDone())}
      title={bulk ? t("attributes.titleMany", { count: ids.length }) : t("attributes.title")}
      description={first?.category_path ?? first?.category_id ?? undefined}
      confirmLabel={t("actions.save")}
      onConfirm={() => void onSave()}
      loading={saveOne.isPending || saveMany.isPending}
      disabled={defs.isLoading || attributes.length === 0 || (bulk && list.length === 0)}
      extra={
        <Button size="small" variant="transparent" isLoading={defs.isFetching && fresh} onClick={() => setFresh(true)}>
          <ArrowPath />
          {t("actions.readAgain")}
        </Button>
      }
    >
      <InlineTip variant="info" label={t("attributes.noteLabel")}>
        {bulk ? t("attributes.noteMany") : t("attributes.note")}
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
      {!bulk && missing.length > 0 && attributes.length > 0 ? (
        <Text size="xsmall" className="text-ui-tag-orange-text">
          {t("attributes.missing", { count: missing.length })}
        </Text>
      ) : null}
    </FormDrawer>
  )
}

/* The rules of the marketplace as the server checks them (lib/overrides.ts): here only to say so before saving. */
const TITLE_MIN = 7
const TITLE_MAX = 150
const DESCRIPTION_MIN = 100
const REFUSED_IMAGE = /\.(avif|heic|heif|svg|tiff?|bmp|ico|jxl)(?:[?#].*)?$/i
const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ").trim()
const titleOk = (v: string) => [...v].length >= TITLE_MIN && [...v].length <= TITLE_MAX && v.split(/\s+/).filter(Boolean).length >= 2
const imageOk = (v: string) => /^https:\/\/\S+$/i.test(v) && !REFUSED_IMAGE.test(v)
const SIDES = ["length", "width", "height", "weight"] as const
type Side = (typeof SIDES)[number]
type Dimension = OfferDto["overrides"]["dimension"]

/** One field of "Edit offer": the field, Medusa's value under it, and "Back to Medusa" while the field holds an edit. */
function EditField({ label, hint, error, medusa, edited, onReset, children }: { label: string; hint?: string; error?: string | null; medusa: string | null; edited: boolean; onReset: () => void; children: ReactNode }) {
  const { t } = useTranslation("vonhalsky")
  return (
    <div className="flex flex-col gap-y-1">
      <span className="flex items-center justify-between gap-x-2">
        <Text size="small" weight="plus">
          {label}
        </Text>
        {edited ? (
          <Button size="small" variant="transparent" onClick={onReset}>
            <ArrowUturnLeft />
            {t("edit.reset")}
          </Button>
        ) : null}
      </span>
      {children}
      {error ? (
        <Text size="xsmall" className="text-ui-tag-red-text">
          {error}
        </Text>
      ) : hint ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {hint}
        </Text>
      ) : null}
      <Text size="xsmall" className="line-clamp-2 text-ui-fg-muted">
        {t("edit.fromMedusa", { value: medusa ?? t("offers.noValue") })}
      </Text>
    </div>
  )
}

/**
 * "Edit offer": the name, the description, the photos, the package and the
 * days to ship of one offer, each over Medusa's value (the placeholder, and
 * the line under the field). An empty field follows Medusa; "Back to
 * Medusa" empties it. Only what changed is sent; the server checks the
 * marketplace's rules again.
 */
function EditDrawer({ offer, onDone }: { offer: OfferDto; onDone: () => void }) {
  const { t } = useTranslation("vonhalsky")
  const save = useEditOffer()
  const m = offer.medusa
  const set = offer.overrides
  const [title, setTitle] = useState(set.title ?? "")
  const [description, setDescription] = useState(set.description ?? "")
  const [images, setImages] = useState((set.images ?? []).join("\n"))
  const [dim, setDim] = useState<Record<Side, string>>(() => ({
    length: set.dimension ? String(set.dimension.length) : "",
    width: set.dimension ? String(set.dimension.width) : "",
    height: set.dimension ? String(set.dimension.height) : "",
    weight: set.dimension ? String(set.dimension.weight) : "",
  }))
  const [days, setDays] = useState(set.daysToShip === null ? "" : String(set.daysToShip))

  const lines = images
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  const filled = SIDES.filter((k) => dim[k].trim() !== "")
  const sides = { length: Number(dim.length), width: Number(dim.width), height: Number(dim.height), weight: Number(dim.weight) }
  const dimNumbersOk = filled.length === 4 && SIDES.every((k) => Number.isInteger(sides[k]) && sides[k] > 0)
  const dimFits = dimNumbersOk && sides.length <= 1200 && sides.width <= 1200 && sides.height <= 1200 && sides.length + sides.width + sides.height <= 2200
  const daysN = Number(days)

  const errors = {
    title: title.trim() && !titleOk(title.trim()) ? t("edit.error.title") : null,
    description: description.trim() && [...textOf(description)].length < DESCRIPTION_MIN ? t("edit.error.description") : null,
    images: lines.length > 20 ? t("edit.error.imagesMany") : lines.some((l) => !imageOk(l)) ? t("edit.error.image") : null,
    dimension:
      filled.length > 0 && filled.length < 4 ? t("edit.error.dimensionAll") : filled.length === 4 && !dimNumbersOk ? t("edit.error.dimensionNumbers") : filled.length === 4 && !dimFits ? t("edit.error.dimensionLarge") : null,
    daysToShip: days.trim() && !(Number.isInteger(daysN) && daysN >= 0 && daysN <= 60) ? t("edit.error.days") : null,
  }

  /* What goes to the server: only the fields that changed; an emptied field that held an edit goes back to Medusa. */
  const changes: OfferEditInput = {}
  const text = (key: "title" | "description", value: string, current: string | null) => {
    const v = value.trim()
    if (!v) {
      if (current !== null) changes[key] = null
    } else if (v !== current) changes[key] = v
  }
  text("title", title, set.title)
  text("description", description, set.description)
  if (lines.length === 0) {
    if (set.images) changes.images = null
  } else if (JSON.stringify(lines) !== JSON.stringify(set.images ?? [])) changes.images = lines
  if (filled.length === 0) {
    if (set.dimension) changes.dimension = null
  } else if (dimNumbersOk && SIDES.some((k) => sides[k] !== set.dimension?.[k])) changes.dimension = { ...sides }
  if (!days.trim()) {
    if (set.daysToShip !== null) changes.daysToShip = null
  } else if (daysN !== set.daysToShip) changes.daysToShip = daysN
  const invalid = Object.values(errors).some(Boolean)
  const nothing = Object.keys(changes).length === 0

  const live = Boolean(offer.remote_id) && offer.status === "listed" && (offer.remote_status === "PUBLISHED" || offer.remote_status === "SOLDOUT")
  const note = live ? t("edit.noteLive") : offer.remote_id ? t("edit.noteRemote") : t("edit.noteLocal")
  const preview = lines.length ? lines : m?.images ?? []
  const fmtDim = (d: Dimension) => (d ? t("edit.dimensionValue", { length: d.length, width: d.width, height: d.height, weight: d.weight }) : null)
  const medusaDays = m && m.daysToShip !== null ? m.daysToShip : null

  const onSave = async () => {
    try {
      const r = await save.mutateAsync({ id: offer.id, overrides: changes })
      toast.success(r.sent === "close" ? t("toast.editClose") : r.sent === "patch" ? t("toast.editPatch") : t("toast.editSaved"))
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <FormDrawer
      open
      onOpenChange={(open) => (open ? undefined : onDone())}
      title={t("edit.title")}
      description={offer.effective?.title ?? offer.title ?? offer.sku ?? offer.variant_id}
      confirmLabel={t("actions.save")}
      onConfirm={() => void onSave()}
      loading={save.isPending}
      disabled={nothing || invalid}
    >
      <InlineTip variant={live ? "warning" : "info"} label={t("edit.noteLabel")}>
        {note}
      </InlineTip>
      <EditField label={t("edit.field.title")} hint={t("edit.hint.title")} error={errors.title} medusa={m?.title ?? null} edited={Boolean(title.trim())} onReset={() => setTitle("")}>
        <Input size="small" value={title} maxLength={TITLE_MAX} placeholder={m?.title ?? ""} onChange={(e) => setTitle(e.target.value)} />
      </EditField>
      <EditField label={t("edit.field.description")} hint={t("edit.hint.description")} error={errors.description} medusa={m?.description ? m.description.slice(0, 200) : null} edited={Boolean(description.trim())} onReset={() => setDescription("")}>
        <Textarea rows={6} value={description} placeholder={m?.description ?? ""} onChange={(e) => setDescription(e.target.value)} />
      </EditField>
      <EditField label={t("edit.field.images")} hint={t("edit.hint.images")} error={errors.images} medusa={m ? t("edit.photos", { count: m.images?.length ?? 0 }) : null} edited={Boolean(images.trim())} onReset={() => setImages("")}>
        <Textarea rows={4} className="font-mono" value={images} placeholder={(m?.images ?? []).join("\n")} onChange={(e) => setImages(e.target.value)} />
        {preview.length > 0 ? (
          <ol className="flex flex-wrap gap-2 pt-1" aria-label={t("edit.preview")}>
            {preview.slice(0, 20).map((url, i) => (
              <li key={`${url}-${i}`} className="relative h-12 w-12 overflow-hidden rounded-md border border-ui-border-base bg-ui-bg-subtle">
                <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                <span className="txt-compact-xsmall absolute left-0.5 top-0.5 rounded bg-ui-bg-base px-1 tabular-nums text-ui-fg-subtle">{i + 1}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </EditField>
      <EditField label={t("edit.field.dimension")} hint={t("edit.hint.dimension")} error={errors.dimension} medusa={fmtDim(m?.dimension ?? null)} edited={filled.length > 0} onReset={() => setDim({ length: "", width: "", height: "", weight: "" })}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SIDES.map((k) => (
            <label key={k} className="flex flex-col gap-y-0.5">
              <Text size="xsmall" className="text-ui-fg-subtle">
                {t(`edit.side.${k}`)}
              </Text>
              <Input size="small" type="number" min={1} step={1} inputMode="numeric" value={dim[k]} placeholder={m?.dimension ? String(m.dimension[k]) : ""} onChange={(e) => setDim({ ...dim, [k]: e.target.value })} />
            </label>
          ))}
        </div>
      </EditField>
      <EditField label={t("edit.field.daysToShip")} hint={t("edit.hint.daysToShip")} error={errors.daysToShip} medusa={medusaDays !== null ? t("edit.days", { count: medusaDays }) : null} edited={Boolean(days.trim())} onReset={() => setDays("")}>
        <Input size="small" className="max-w-[8rem]" type="number" min={0} max={60} step={1} value={days} placeholder={medusaDays !== null ? String(medusaDays) : ""} onChange={(e) => setDays(e.target.value)} />
      </EditField>
      {offer.overridden.length > 0 ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("edit.overridden", { list: offer.overridden.map((f) => t(`edit.field.${f}`)).join(", ") })}
        </Text>
      ) : null}
    </FormDrawer>
  )
}

/** The days to ship of many offers at once, or back to the offer defaults. */
function DaysDrawer({ ids, status: s, onDone, onSaved }: { ids: string[]; status: StatusResponse; onDone: () => void; onSaved: () => void }) {
  const { t } = useTranslation("vonhalsky")
  const save = useSetDaysToShip()
  const [value, setValue] = useState("")
  const n = Number(value)
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 60
  const send = async (daysToShip: number | null) => {
    try {
      const r = await save.mutateAsync({ ids, daysToShip })
      toast.success(t("toast.daysSaved", { count: r.updated, sent: r.sent }))
      if (r.skipped.length > 0) toast.info(t("toast.editSkipped", { count: r.skipped.length }))
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
      title={t("daysDrawer.title", { count: ids.length })}
      description={t("daysDrawer.text")}
      confirmLabel={t("actions.save")}
      onConfirm={() => void send(n)}
      loading={save.isPending && save.variables?.daysToShip !== null}
      disabled={!valid}
      extra={
        <Button size="small" variant="transparent" isLoading={save.isPending && save.variables?.daysToShip === null} onClick={() => void send(null)}>
          <ArrowUturnLeft />
          {t("actions.daysFromDefaults")}
        </Button>
      }
    >
      <Field label={t("edit.field.daysToShip")} hint={t("daysDrawer.hint", { days: s.settings.offerDefaults.daysToShip })} required>
        <Input size="small" className="max-w-[8rem]" type="number" min={0} max={60} step={1} value={value} placeholder={String(s.settings.offerDefaults.daysToShip)} onChange={(e) => setValue(e.target.value)} />
      </Field>
    </FormDrawer>
  )
}

/** What "Import from InPost" did: offers linked, offers read again, and the ones that match no variant (never created). */
function ImportedDrawer({ result: r, onDone }: { result: ImportOffersResponse; onDone: () => void }) {
  const { t } = useTranslation("vonhalsky")
  return (
    <FormDrawer open onOpenChange={(open) => (open ? undefined : onDone())} title={t("imported.title")} description={t("imported.text")}>
      <InlineTip variant={r.unmatched.length ? "warning" : "success"} label={t("imported.summaryLabel")}>
        {t("imported.summary", { read: r.read, linked: r.linked, updated: r.updated })}
      </InlineTip>
      {!r.complete ? (
        <InlineTip variant="warning" label={t("imported.partialLabel")}>
          {t("imported.partial")}
        </InlineTip>
      ) : null}
      {r.unmatched.length === 0 ? (
        <Text size="small" className="text-ui-fg-subtle">
          {t("imported.allLinked")}
        </Text>
      ) : (
        <>
          <Text size="small" weight="plus">
            {t("imported.unmatched", { count: r.unmatched.length })}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("imported.unmatchedHint")}
          </Text>
          <ul className="flex flex-col gap-y-2">
            {r.unmatched.map((u) => (
              <li key={u.id} className="flex flex-col gap-y-0.5 rounded-md border border-ui-border-base px-3 py-2">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="txt-compact-small-plus text-ui-fg-base">{u.name ?? u.id}</span>
                  {u.status ? <RemoteStatusBadge status={u.status} /> : null}
                  <ToneBadge tone={u.reason === "no_match" ? "grey" : "orange"}>{t(`imported.reason.${u.reason}`)}</ToneBadge>
                </span>
                <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{[t("offers.remote", { id: u.id }), u.sku && `SKU ${u.sku}`, u.ean && `EAN ${u.ean}`].filter(Boolean).join(", ")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
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
