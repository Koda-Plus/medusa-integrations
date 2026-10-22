import { Fragment, useEffect, useState, type ReactNode } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  ArrowDownTray,
  ArrowLongRight,
  ArrowPath,
  ArrowUpRightOnBox,
  ArrowUturnLeft,
  Beaker,
  BuildingStorefront,
  CheckCircle,
  Clock,
  CloudArrowDown,
  DocumentText,
  ExclamationCircle,
  BellAlert,
  Eye,
  EyeSlash,
  ListBullet,
  LockClosedSolid,
  LockOpenSolid,
  PencilSquare,
  Receipt,
  Plus,
  ShieldCheck,
  ShoppingCart,
  XCircle,
} from "@medusajs/icons"
import { Button, Table, Text, toast, usePrompt } from "@medusajs/ui"
import type {
  ImportFilter,
  InvoiceRowStatus,
  PlanChange,
  PlanFilter,
  PlanKind,
  StatusResponse,
  WriterDto,
  WriterKey,
} from "../../modules/baselinker/lib/contract"
import {
  errorMessage,
  useBaseLinkerArm,
  useBaseLinkerDirections,
  useBaseLinkerImportNow,
  useBaseLinkerImports,
  useBaseLinkerInvoiceRetry,
  useBaseLinkerInvoices,
  useBaseLinkerPlans,
  useBaseLinkerRelease,
  useBaseLinkerReturns,
} from "./baselinker-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, ToneBadge, useDebouncedValue } from "./baselinker-blocks"
import { References } from "./baselinker-guide"
import { KitFetchingBar, KitSkeletonRows } from "./baselinker-kit"
import {
  ImportStatusBadge,
  InvoiceStatusBadge,
  MedusaColumn,
  OrderLink,
  PlanActionBadge,
  PlanStatusBadge,
  RunStatusBadge,
  StoreOrderCell,
  Thumb,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
  fmtRating,
  kitReferences,
  useProductThumbs,
} from "./baselinker-ui"

/*
 * Sections of the BaseLinker page added in 0.2: the source of truth with the
 * writers and their arm switches, the plans of the writers, the marketplace
 * orders imported from BaseLinker, returns and invoice numbers, plus the demo
 * note of the mode badge and the stores running the integration. Shared
 * table pieces (pagination, table body states, debounced search) live here too.
 */

export const PAGE_SIZE = 15

export function Pagination({ count, page, onPage }: { count: number; page: number; onPage: (p: number) => void }) {
  const { t } = useTranslation("baselinker")
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  return (
    <Table.Pagination
      count={count}
      pageSize={PAGE_SIZE}
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

/** The search of a list after a pause in typing, trimmed (the kit's debounce). */
export function useDebounced(value: string, ms = 300): string {
  return useDebouncedValue(value, ms).trim()
}

/** A filter button that clears itself on a second click: back to `all`. */
export function toggleFilter<T extends string>(current: T, next: T, all: T): T {
  return current === next && next !== all ? all : next
}

/**
 * What a table body shows when it has no rows: skeleton rows on the first
 * read, then the empty state with its icon and phrase. Never "nothing" before
 * the data came.
 */
export function TableBodyState({ cols, loading, icon, title }: { cols: number; loading: boolean; icon: ReactNode; title: string }) {
  return loading ? <KitSkeletonRows cols={cols} rows={5} /> : <EmptyTableRow cols={cols} icon={icon} title={title} />
}

/** Sections of the page a link can open: the Panel lists and the plans of Settings. */
export type DeepSection = "cards" | "orders" | "imports" | "returns" | "plans"

/**
 * DEEP LINKS. The board counters, the summaries and the widgets open the page
 * on one list: `/baselinker?section=orders&filter=failed`,
 * `/baselinker?section=cards&q=prod_...`,
 * `/baselinker?view=settings&tab=plans&filter=quarantined&q=OP-1`. A section
 * reads its first filter and search from the address when the link names it.
 */
export function useDeepLink(section: DeepSection): { filter: string | null; q: string } {
  const [params] = useSearchParams()
  const asked = params.get("section") ?? (params.get("view") === "settings" && params.get("tab") === "plans" ? "plans" : null)
  if (asked !== section) return { filter: null, q: "" }
  return { filter: params.get("filter"), q: (params.get("q") ?? "").trim().slice(0, 80) }
}

/** One of the allowed values, or the fallback. */
export function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/* ------------------------------------------------------------------ */
/* Demo note, shown in the popover of the mode badge                   */
/* ------------------------------------------------------------------ */

export function DemoDetails({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("baselinker")
  if (status.mode !== "demo") return null
  return <span>{t("demo.text")}</span>
}

/* ------------------------------------------------------------------ */
/* Running in production, as cards at the end of the guide             */
/* (the page header shows the same stores in its badge)                */
/* ------------------------------------------------------------------ */

export function ReferencesBlock({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("baselinker")
  return (
    <References
      items={kitReferences(status.references ?? [], lang)}
      title={t("references.title")}
      subtitle={t("references.subtitle")}
      openLabel={t("references.open")}
      soonLabel={t("references.soon")}
      reviewLabel={t("references.review")}
      ratingLabel={(value) => fmtRating(value, lang)}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Source of truth and writers                                         */
/* ------------------------------------------------------------------ */

function Flow({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <ToneBadge tone="grey">{from}</ToneBadge>
      <ArrowLongRight className="text-ui-fg-muted" />
      <ToneBadge tone="blue">{to}</ToneBadge>
    </span>
  )
}

const WRITER_TARGET: Record<WriterKey, "medusa" | "baselinker"> = {
  catalogImport: "medusa",
  cards: "baselinker",
  stockToMedusa: "medusa",
  stockToBaseLinker: "baselinker",
  prices: "baselinker",
  orderImport: "medusa",
  invoiceNumbers: "baselinker",
}

/** One writer: its state, who armed it and when, and the switch. */
export function WriterControl({ writer, lang, max }: { writer: WriterDto; lang: string; max?: number }) {
  const { t } = useTranslation("baselinker")
  const arm = useBaseLinkerArm()
  const prompt = usePrompt()
  const name = t(`directions.writers.${writer.key}`)
  const toggle = async () => {
    const armed = !writer.armed
    if (armed) {
      const ok = await prompt({
        title: t("directions.confirmTitle", { writer: name }),
        description: t("directions.confirmText", {
          target: WRITER_TARGET[writer.key] === "medusa" ? t("directions.inMedusa") : t("directions.inBaseLinker"),
          max: max ?? "",
        }),
        confirmText: t("directions.confirmButton"),
        cancelText: t("directions.cancel"),
        variant: "confirmation",
      })
      if (!ok) return
    }
    try {
      await arm.mutateAsync({ key: writer.key, armed })
      toast.success(t(armed ? "toast.armed" : "toast.disarmed", { writer: name }))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  const tone = writer.live ? "green" : writer.blocked === "hard_off" || writer.blocked === "stock_not_write" ? "red" : writer.armed ? "orange" : "grey"
  const label = writer.live ? t("directions.writes") : t(`directions.blocked.${writer.blocked ?? "not_armed"}`)
  return (
    <div className="flex min-w-[220px] flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Text size="small" weight="plus">
          {name}
        </Text>
        <ToneBadge tone={tone}>{label}</ToneBadge>
      </div>
      {writer.armedBy === "options" ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("directions.byOptions")}
        </Text>
      ) : writer.changedAt ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {`${writer.armed ? t("directions.armed") : t("directions.notArmed")}: ${t("directions.by", {
            who: writer.changedByLabel ?? writer.changedBy ?? "?",
            time: fmtDateTime(writer.changedAt, lang),
          })}`}
        </Text>
      ) : null}
      <div>
        <Button
          size="small"
          variant={writer.armed ? "secondary" : "primary"}
          isLoading={arm.isPending}
          disabled={!writer.armed && writer.hardSwitch !== null}
          onClick={() => void toggle()}
        >
          {writer.armed ? t("directions.disarm") : t("directions.arm")}
        </Button>
      </div>
    </div>
  )
}

export function DirectionsSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("baselinker")
  const switchDirections = useBaseLinkerDirections()
  const d = status.directions
  const m = status.more
  const w = (key: WriterKey) => status.writers.find((x) => x.key === key) as WriterDto
  const M = t("directions.medusa")
  const B = t("directions.baselinker")
  const journal = t(`connection.journalStates.${status.journal.state === "active" ? "events" : status.journal.state === "empty" ? "empty" : "error"}`)
  const journalWord = status.journal.state === "demo" ? t("mode.demo") : status.journal.state === "off" ? t("connection.stockModes.off") : journal
  const group = m.priceGroupId !== null ? String(m.priceGroupId) : "?"

  const pick = async (body: { catalog?: "medusa" | "baselinker"; stock?: "baselinker" | "medusa" }) => {
    try {
      await switchDirections.mutateAsync(body)
      toast.success(t("toast.directions"))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const readOnly = <ToneBadge tone="grey">{t("directions.readOnly")}</ToneBadge>
  const rows: Array<{ key: string; label: string; flow: ReactNode; how: string; writer: ReactNode }> = [
    {
      key: "catalog",
      label: t("directions.rows.catalog"),
      flow: d.catalog === "medusa" ? <Flow from={M} to={B} /> : <Flow from={B} to={M} />,
      how: d.catalog === "medusa" ? t("directions.how.catalogMedusa") : t("directions.how.catalogBaseLinker"),
      writer: <WriterControl writer={w(d.catalog === "medusa" ? "cards" : "catalogImport")} lang={lang} max={m.maxCatalogChangesPerRun} />,
    },
    {
      key: "stock",
      label: t("directions.rows.stock"),
      flow: d.stock === "baselinker" ? <Flow from={B} to={M} /> : <Flow from={M} to={B} />,
      how:
        status.options.stockSync === "off"
          ? t("directions.how.stockOff")
          : d.stock === "baselinker"
            ? t("directions.how.stockBaseLinker")
            : t("directions.how.stockMedusa"),
      writer: <WriterControl writer={w(d.stock === "baselinker" ? "stockToMedusa" : "stockToBaseLinker")} lang={lang} max={status.options.maxStockChangesPerRun} />,
    },
    {
      key: "prices",
      label: t("directions.rows.prices"),
      flow: d.catalog === "medusa" ? <Flow from={M} to={B} /> : <Flow from={B} to={M} />,
      how:
        d.catalog === "baselinker"
          ? t("directions.how.pricesWithCatalog", { group })
          : m.priceGroupId === null
            ? t("directions.how.pricesNoGroup")
            : t("directions.how.pricesPush", { currency: m.priceCurrency.toUpperCase(), group }),
      writer: d.catalog === "medusa" ? <WriterControl writer={w("prices")} lang={lang} max={m.maxPriceChangesPerRun} /> : <Text size="xsmall" className="text-ui-fg-muted">{t("directions.writers.catalogImport")}</Text>,
    },
    {
      key: "ordersOut",
      label: t("directions.rows.ordersOut"),
      flow: <Flow from={M} to={B} />,
      how: status.options.exportOrders ? t("directions.how.ordersOutOn") : t("directions.how.ordersOutOff"),
      writer: <ToneBadge tone={status.options.exportOrders ? "green" : "grey"}>{status.options.exportOrders ? t("directions.fixed") : t("connection.ordersOff")}</ToneBadge>,
    },
    {
      key: "ordersIn",
      label: t("directions.rows.ordersIn"),
      flow: <Flow from={B} to={M} />,
      how: m.orderImportSources.length > 0 ? t("directions.how.ordersInOn", { sources: m.orderImportSources.join(", ") }) : t("directions.how.ordersInOff"),
      writer: <WriterControl writer={w("orderImport")} lang={lang} />,
    },
    {
      key: "statuses",
      label: t("directions.rows.statuses"),
      flow: <Flow from={B} to={M} />,
      how: t("directions.how.statuses", { journal: journalWord }),
      writer: readOnly,
    },
    {
      key: "returns",
      label: t("directions.rows.returns"),
      flow: <Flow from={B} to={M} />,
      how: m.returnsSync ? t("directions.how.returns") : t("directions.how.returnsOff"),
      writer: readOnly,
    },
    {
      key: "invoices",
      label: t("directions.rows.invoices"),
      flow: <Flow from={M} to={B} />,
      how: t("directions.how.invoices", { field: m.invoiceNumberField }),
      writer: <WriterControl writer={w("invoiceNumbers")} lang={lang} />,
    },
  ]

  return (
    <Section
      icon={<ArrowLongRight />}
      title={t("directions.title")}
      pointsLabel={t("directions.subtitle")}
      points={[
        { icon: <ShieldCheck />, text: t("directions.points.owner") },
        { icon: <LockClosedSolid />, text: t("directions.points.armed"), tone: "green" },
        { icon: <DocumentText />, text: t("directions.points.plan") },
        d.switchable && { icon: <Beaker />, text: t("directions.points.demo"), tone: "blue", title: t("directions.demoNote") },
      ]}
    >
      {d.switchable ? (
        <FilterBar>
          <Text size="small" className="text-ui-fg-subtle">
            {t("directions.pickCatalog")}
          </Text>
          <FilterButton icon={<BuildingStorefront />} label={M} active={d.catalog === "medusa"} disabled={switchDirections.isPending} onClick={() => void pick({ catalog: "medusa" })} />
          <FilterButton icon={<CloudArrowDown />} label={B} active={d.catalog === "baselinker"} disabled={switchDirections.isPending} onClick={() => void pick({ catalog: "baselinker" })} />
          <FilterDivider />
          <Text size="small" className="text-ui-fg-subtle">
            {t("directions.pickStock")}
          </Text>
          <FilterButton icon={<CloudArrowDown />} label={B} active={d.stock === "baselinker"} disabled={switchDirections.isPending} onClick={() => void pick({ stock: "baselinker" })} />
          <FilterButton icon={<BuildingStorefront />} label={M} active={d.stock === "medusa"} disabled={switchDirections.isPending} onClick={() => void pick({ stock: "medusa" })} />
        </FilterBar>
      ) : null}
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("directions.col.data")}</Table.HeaderCell>
              <Table.HeaderCell>{t("directions.col.flow")}</Table.HeaderCell>
              <Table.HeaderCell>{t("directions.col.how")}</Table.HeaderCell>
              <Table.HeaderCell>{t("directions.col.writer")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((r) => (
              <Table.Row key={r.key} className="[&_td]:py-3 [&_td]:align-top">
                <Table.Cell className="whitespace-nowrap">
                  <Text size="small" weight="plus">
                    {r.label}
                  </Text>
                </Table.Cell>
                <Table.Cell>{r.flow}</Table.Cell>
                <Table.Cell className="max-w-md">
                  <Text size="small" className="text-ui-fg-subtle">
                    {r.how}
                  </Text>
                </Table.Cell>
                <Table.Cell>{r.writer}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

const PLAN_FILTERS: PlanFilter[] = ["all", "changes", "create", "update", "draft", "conflict", "skip", "failed", "quarantined"]

const PLAN_FILTER_ICON: Record<PlanFilter, ReactNode> = {
  all: <ListBullet />,
  changes: <PencilSquare />,
  create: <Plus />,
  update: <ArrowPath />,
  draft: <EyeSlash />,
  conflict: <ExclamationCircle />,
  skip: <XCircle />,
  failed: <XCircle />,
  quarantined: <LockClosedSolid />,
}

/** Things a person has to look at: their count turns orange. */
const PLAN_ATTENTION: ReadonlySet<PlanFilter> = new Set(["conflict", "failed", "quarantined"])

function PlanFilterButton({ f, divider, count, active, onClick }: { f: PlanFilter; divider: boolean; count: number | undefined; active: boolean; onClick: () => void }) {
  const { t } = useTranslation("baselinker")
  return (
    <>
      {divider ? <FilterDivider /> : null}
      <FilterButton icon={PLAN_FILTER_ICON[f]} label={t(`plans.filter.${f}`)} count={count} attention={PLAN_ATTENTION.has(f)} active={active} onClick={onClick} />
    </>
  )
}

function ChangeLine({ change, lang }: { change: PlanChange; lang: string }) {
  const { t } = useTranslation("baselinker")
  const [field, detail] = change.field.split(/:(.*)/s)
  const label = `${t(`plans.fields.${field}`, { defaultValue: field })}${detail ? ` ${detail}` : ""}`
  const show = (v: string | number | null) => (v === null ? t("connection.none") : typeof v === "number" ? fmtNumber(v, lang) : v)
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 txt-compact-xsmall">
      <span className="text-ui-fg-subtle">{label}</span>
      {change.from !== null ? (
        <>
          <span className="max-w-[220px] truncate font-mono text-ui-fg-muted line-through">{show(change.from)}</span>
          <ArrowLongRight className="shrink-0 text-ui-fg-muted" />
        </>
      ) : null}
      <span className="max-w-[260px] truncate font-mono text-ui-fg-base">{show(change.to)}</span>
    </span>
  )
}

const PLAN_FILTER_VALUES: readonly PlanFilter[] = ["all", "changes", "create", "update", "draft", "conflict", "skip", "failed", "quarantined"]

export function PlanSection({ kind, status, lang }: { kind: PlanKind; status: StatusResponse; lang: string }) {
  const { t } = useTranslation("baselinker")
  const link = useDeepLink("plans")
  const [filter, setFilter] = useState<PlanFilter>(() => pick(link.filter, PLAN_FILTER_VALUES, "changes"))
  const [search, setSearch] = useState(link.q)
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])
  const plans = useBaseLinkerPlans(kind, filter, q, page * PAGE_SIZE, PAGE_SIZE)
  const release = useBaseLinkerRelease()
  const data = plans.data
  const rows = data?.items ?? []
  const writer = data?.writer ?? null
  const summary = data?.summary ?? status.counts2.plans[kind]
  const run = data?.run ?? status.lastRuns[kind] ?? null
  const demo = status.mode === "demo"
  const max =
    kind === "prices" ? status.more.maxPriceChangesPerRun : kind === "stock_push" ? status.options.maxStockChangesPerRun : status.more.maxCatalogChangesPerRun
  const modeKey = writer && !writer.active ? "off" : writer?.live ? (demo ? "demo" : "write") : "plan"
  const modeText = modeKey === "write" ? t("plans.mode.write", { max }) : t(`plans.mode.${modeKey}`)
  const thumbs = useProductThumbs(rows.map((r) => r.productId))

  const onRelease = async (id: string) => {
    try {
      await release.mutateAsync(id)
      toast.success(t("toast.released"))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const count = (f: PlanFilter): number | undefined => {
    switch (f) {
      case "all":
        return summary.total
      case "changes":
        return summary.create + summary.update + summary.draft
      case "create":
        return summary.create
      case "update":
        return summary.update
      case "draft":
        return summary.draft
      case "conflict":
        return summary.conflict
      case "skip":
        return summary.skip
      case "failed":
        return summary.failed
      case "quarantined":
        return summary.quarantined
    }
  }

  const shown = PLAN_FILTERS.filter((f) => f === "all" || f === "changes" || f === filter || (count(f) ?? 0) > 0)
  return (
    <Section
      icon={<DocumentText />}
      title={t(`plans.kinds.${kind}.title`)}
      badges={run ? <RunStatusBadge status={run.status} /> : null}
      pointsLabel={t(`plans.kinds.${kind}.subtitle`)}
      points={[
        {
          icon: modeKey === "write" ? <LockOpenSolid /> : <LockClosedSolid />,
          text: modeKey === "write" ? t("plans.modeShort.write", { max }) : t(`plans.modeShort.${modeKey}`),
          tone: modeKey === "write" ? "orange" : modeKey === "demo" ? "blue" : "grey",
          title: modeText,
        },
        run ? { icon: <Clock />, text: t("plans.plannedAt", { time: fmtDateTime(run.startedAt, lang) }) } : { icon: <Clock />, text: t("plans.never") },
        run && { icon: <PencilSquare />, text: t("plans.summaryShort", { create: summary.create, update: summary.update }) },
        run && summary.conflict > 0 && { icon: <ExclamationCircle />, text: t("plans.conflictsShort", { count: summary.conflict }), tone: "red" },
        kind === "catalog_import" && { icon: <ShieldCheck />, text: t("plans.noDelete"), tone: "green" },
      ]}
      description={
        run?.status === "error" || run?.counts?.skipped ? (
          <Text size="xsmall" className="text-ui-tag-orange-text">
            {run.message}
          </Text>
        ) : undefined
      }
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("plans.search")} />}
    >
      <FilterBar>
        {shown.map((f, i) => (
          <PlanFilterButton key={f} f={f} divider={i === 2} count={count(f)} active={filter === f} onClick={() => setFilter(toggleFilter(filter, f, "changes"))} />
        ))}
      </FilterBar>
      <KitFetchingBar active={plans.isFetching && !plans.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("plans.col.item")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plans.col.action")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plans.col.changes")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plans.col.status")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <TableBodyState cols={5} loading={plans.isLoading} icon={<DocumentText />} title={run ? t("plans.empty") : t("plans.never")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5 [&_td]:align-top">
                  <Table.Cell className="max-w-[320px]">
                    <div className="flex items-start gap-x-2.5">
                      {r.productId ? <Thumb src={thumbs[r.productId]} /> : null}
                      <div className="flex min-w-0 flex-col gap-y-0.5">
                        {r.productId ? (
                          <Link to={`/products/${r.productId}`} className="txt-compact-small-plus truncate text-ui-fg-base hover:text-ui-fg-interactive">
                            {r.label ?? r.itemKey}
                          </Link>
                        ) : (
                          <span className="txt-compact-small-plus truncate text-ui-fg-base">{r.label ?? r.itemKey}</span>
                        )}
                        <span className="flex flex-wrap gap-x-2 font-mono text-ui-fg-muted txt-compact-xsmall">
                          {r.sku ? <span>{r.sku}</span> : null}
                          {r.blProductId ? <span>#{r.blProductId}</span> : null}
                        </span>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <PlanActionBadge action={r.action} />
                      {r.reason ? (
                        <Text size="xsmall" className="max-w-[220px] text-ui-fg-subtle">
                          {t(`plans.reasons.${r.reason}`, { defaultValue: r.reason })}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-[440px]">
                    <div className="flex flex-col gap-y-1">
                      {r.changes.slice(0, 8).map((c, i) => (
                        <ChangeLine key={`${c.field}-${i}`} change={c} lang={lang} />
                      ))}
                      {r.changes.length > 8 ? <Text size="xsmall" className="text-ui-fg-muted">{`+${r.changes.length - 8}`}</Text> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <PlanStatusBadge status={r.status} />
                      {r.appliedAt ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {fmtDateTime(r.appliedAt, lang)}
                        </Text>
                      ) : null}
                      {r.error ? (
                        <Text size="xsmall" className="max-w-[260px] text-ui-tag-red-text">
                          {r.error}
                        </Text>
                      ) : null}
                      {r.quarantine && r.quarantine.failures > 0 ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("plans.failures", { count: r.quarantine.failures })}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <RowActions
                      actions={[
                        {
                          key: "release",
                          label: t("plans.release"),
                          icon: <LockOpenSolid />,
                          hidden: !r.quarantine?.quarantinedAt,
                          loading: release.isPending && release.variables === r.quarantine?.id,
                          onClick: () => r.quarantine && void onRelease(r.quarantine.id),
                        },
                      ]}
                    />
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pagination count={data?.count ?? 0} page={page} onPage={setPage} />
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Marketplace orders from BaseLinker                                  */
/* ------------------------------------------------------------------ */

const IMPORT_FILTERS: ImportFilter[] = ["all", "pending", "imported", "skipped", "failed", "flagged"]

const IMPORT_FILTER_ICON: Record<ImportFilter, ReactNode> = {
  all: <ListBullet />,
  pending: <Clock />,
  imported: <CheckCircle />,
  skipped: <XCircle />,
  failed: <ExclamationCircle />,
  flagged: <BellAlert />,
}

export function ImportsSection({ status, lang, poll }: { status: StatusResponse; lang: string; poll: boolean }) {
  const { t } = useTranslation("baselinker")
  const c = status.counts2.imports
  const link = useDeepLink("imports")
  const [filter, setFilter] = useState<ImportFilter>(() => pick(link.filter, IMPORT_FILTERS, link.q ? "all" : c.failed > 0 ? "failed" : "all"))
  const [search, setSearch] = useState(link.q)
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])
  const imports = useBaseLinkerImports(filter, q, page * PAGE_SIZE, PAGE_SIZE, poll)
  const importNow = useBaseLinkerImportNow()
  const rows = imports.data?.imports ?? []
  const writer = status.writers.find((w) => w.key === "orderImport")
  const counts: Record<ImportFilter, number> = {
    all: c.pending + c.imported + c.skipped + c.failed,
    pending: c.pending,
    imported: c.imported,
    skipped: c.skipped,
    failed: c.failed,
    flagged: c.flagged,
  }

  const onImport = async (id: string) => {
    try {
      const res = await importNow.mutateAsync(id)
      toast.success(t("toast.imported", { status: t(`imports.statuses.${res.import.status}`) }))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const off = !status.features2.orderImport
  const waiting = !off && !writer?.live && c.pending > 0

  return (
    <Section
      icon={<ShoppingCart />}
      title={t("imports.title")}
      pointsLabel={`${t("imports.subtitle")} ${t("imports.how")}`}
      points={[
        { icon: <CloudArrowDown />, text: t("imports.points.sources") },
        { icon: <ShieldCheck />, text: t("imports.points.once"), tone: "green" },
        off && { icon: <XCircle />, text: t("imports.points.off"), title: t("imports.off") },
        waiting && { icon: <Clock />, text: t("imports.points.waiting", { count: c.pending }), tone: "orange", title: t("imports.waiting", { count: c.pending }) },
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("imports.search")} />}
    >
      <FilterBar>
        {IMPORT_FILTERS.map((f, i) => (
          <Fragment key={f}>
            {i === 1 || i === 5 ? <FilterDivider /> : null}
            <FilterButton
              icon={IMPORT_FILTER_ICON[f]}
              label={t(`imports.filter.${f}`)}
              count={counts[f]}
              attention={f === "failed" || f === "flagged"}
              active={filter === f}
              onClick={() => setFilter(toggleFilter(filter, f, "all"))}
            />
          </Fragment>
        ))}
      </FilterBar>
      <KitFetchingBar active={imports.isFetching && !imports.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("imports.col.source")}</Table.HeaderCell>
              <Table.HeaderCell>{t("imports.col.order")}</Table.HeaderCell>
              <Table.HeaderCell>
                <MedusaColumn label={t("imports.col.medusa")} hint={`${t("imports.how")} ${t("imports.emailNote")}`} />
              </Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("imports.col.total")}</Table.HeaderCell>
              <Table.HeaderCell>{t("imports.col.payment")}</Table.HeaderCell>
              <Table.HeaderCell>{t("imports.col.blStatus")}</Table.HeaderCell>
              <Table.HeaderCell>{t("imports.col.details")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <TableBodyState cols={8} loading={imports.isLoading} icon={<ShoppingCart />} title={t("imports.empty")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5 [&_td]:align-top">
                  <Table.Cell className="whitespace-nowrap capitalize">{r.source}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col gap-y-0.5">
                      <span className="font-mono txt-compact-small-plus">{r.blOrderId}</span>
                      {r.marketplaceRef ? <span className="max-w-[220px] truncate font-mono text-ui-fg-muted txt-compact-xsmall">{r.marketplaceRef}</span> : null}
                      {r.confirmedAt ? <span className="text-ui-fg-muted txt-compact-xsmall">{fmtDateTime(r.confirmedAt, lang)}</span> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-[260px]">
                    {r.orderId ? (
                      <StoreOrderCell orderId={r.orderId} displayId={r.displayId} />
                    ) : (
                      <ToneBadge tone={r.status === "failed" ? "red" : r.status === "skipped" ? "grey" : "orange"}>
                        {t(`imports.noOrder.${r.status === "skipped" || r.status === "failed" ? r.status : "pending"}`)}
                      </ToneBadge>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{fmtMoney(r.total, r.currency, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{r.paymentState ? t(`imports.payment.${r.paymentState}`, { defaultValue: r.paymentState }) : ""}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    <div className="flex flex-col">
                      <span>{r.blStatusName ?? (r.blStatusId !== null ? `#${r.blStatusId}` : "")}</span>
                      {r.trackingNumber ? (
                        r.trackingUrl ? (
                          <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-x-1 text-ui-fg-interactive txt-compact-xsmall">
                            {r.carrier ? `${r.carrier} ` : ""}
                            <span className="font-mono">{r.trackingNumber}</span>
                            <ArrowUpRightOnBox />
                          </a>
                        ) : (
                          <span className="font-mono txt-compact-xsmall">{r.trackingNumber}</span>
                        )
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-sm">
                    <div className="flex flex-col items-start gap-y-1">
                      <ImportStatusBadge status={r.status} />
                      {r.flag ? (
                        <Text size="xsmall" className="text-ui-tag-orange-text">
                          {t(`imports.flags.${r.flag}`, { defaultValue: r.flag })}
                        </Text>
                      ) : null}
                      {r.lines > 0 ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("imports.lines", { count: r.lines })}
                          {r.unlinkedLines > 0 ? `, ${t("imports.unlinked", { count: r.unlinkedLines })}` : ""}
                        </Text>
                      ) : null}
                      {r.lastError ? (
                        <Text size="xsmall" className={r.status === "failed" ? "text-ui-tag-red-text" : "text-ui-fg-subtle"}>
                          {r.lastErrorCode && r.lastErrorCode !== "adopted" ? <span className="font-mono">[{r.lastErrorCode}] </span> : null}
                          {r.lastError}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <RowActions
                      actions={[
                        {
                          key: "import",
                          label: t("imports.importNow"),
                          icon: <ArrowDownTray />,
                          hidden: !writer?.live || r.status === "imported",
                          loading: importNow.isPending && importNow.variables === r.id,
                          onClick: () => void onImport(r.id),
                        },
                      ]}
                    />
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pagination count={imports.data?.count ?? 0} page={page} onPage={setPage} />
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Returns                                                             */
/* ------------------------------------------------------------------ */

export function ReturnsSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("baselinker")
  const [search, setSearch] = useState("")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [q])
  const returns = useBaseLinkerReturns(q, page * PAGE_SIZE, PAGE_SIZE)
  const rows = returns.data?.returns ?? []
  return (
    <Section
      icon={<ArrowUturnLeft />}
      title={t("returns.title")}
      badges={status.lastRuns.returns ? <RunStatusBadge status={status.lastRuns.returns.status} /> : null}
      pointsLabel={`${t("returns.subtitle")} ${t("returns.how")}`}
      points={[
        { icon: <Eye />, text: t("returns.points.readOnly"), tone: "blue" },
        { icon: <ShoppingCart />, text: t("returns.points.linked") },
        { icon: <ShieldCheck />, text: t("returns.points.noBuyer"), tone: "green" },
        !status.more.returnsSync && { icon: <XCircle />, text: t("returns.points.off"), title: t("returns.off") },
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("returns.search")} />}
    >
      <KitFetchingBar active={returns.isFetching && !returns.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("returns.col.return")}</Table.HeaderCell>
              <Table.HeaderCell>
                <MedusaColumn label={t("returns.col.order")} hint={t("returns.how")} />
              </Table.HeaderCell>
              <Table.HeaderCell>{t("returns.col.source")}</Table.HeaderCell>
              <Table.HeaderCell>{t("returns.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("returns.col.items")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("returns.col.refunded")}</Table.HeaderCell>
              <Table.HeaderCell>{t("returns.col.created")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <TableBodyState cols={7} loading={returns.isLoading} icon={<ArrowUturnLeft />} title={t("returns.empty", { days: status.more.returnsWindowDays })} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5 [&_td]:align-top">
                  <Table.Cell>
                    <div className="flex flex-col">
                      <span className="font-mono txt-compact-small-plus">{r.blReturnId}</span>
                      {r.externalReturnId ? <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{r.externalReturnId}</span> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-[260px]">
                    <div className="flex flex-col items-start gap-y-1">
                      {r.orderId ? (
                        <StoreOrderCell orderId={r.orderId} displayId={r.displayId} />
                      ) : (
                        <ToneBadge tone="grey">{t("returns.noOrder")}</ToneBadge>
                      )}
                      {r.blOrderId ? <span className="font-mono text-ui-fg-muted txt-compact-xsmall">BL {r.blOrderId}</span> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="capitalize">{r.source ?? ""}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{r.statusName ?? (r.statusId !== null ? `#${r.statusId}` : "")}</Table.Cell>
                  <Table.Cell className="max-w-sm">
                    <div className="flex flex-col gap-y-0.5">
                      {r.products.map((p, i) => (
                        <Text key={`${r.id}-${i}`} size="xsmall">
                          {`${p.quantity} x ${p.name}`}
                          {p.reason ? <span className="text-ui-fg-muted">{` (${p.reason})`}</span> : null}
                        </Text>
                      ))}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{fmtMoney(r.refunded, r.currency, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.createdInBlAt, lang)}</Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pagination count={returns.data?.count ?? 0} page={page} onPage={setPage} />
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Invoice numbers                                                     */
/* ------------------------------------------------------------------ */

const INVOICE_FILTERS: Array<InvoiceRowStatus | "all"> = ["all", "pending", "written", "conflict", "skipped", "failed"]

const INVOICE_FILTER_ICON: Record<InvoiceRowStatus | "all", ReactNode> = {
  all: <ListBullet />,
  pending: <Clock />,
  written: <CheckCircle />,
  conflict: <ExclamationCircle />,
  skipped: <XCircle />,
  failed: <XCircle />,
}

export function InvoicesSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("baselinker")
  const c = status.counts2.invoices
  const [filter, setFilter] = useState<InvoiceRowStatus | "all">(c.conflict > 0 ? "conflict" : "all")
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter])
  const invoices = useBaseLinkerInvoices(filter, page * PAGE_SIZE, PAGE_SIZE)
  const retry = useBaseLinkerInvoiceRetry()
  const rows = invoices.data?.invoices ?? []
  const counts: Record<InvoiceRowStatus | "all", number> = {
    all: c.pending + c.written + c.conflict + c.skipped + c.failed,
    pending: c.pending,
    written: c.written,
    conflict: c.conflict,
    skipped: c.skipped,
    failed: c.failed,
  }
  const onRetry = async (id: string) => {
    try {
      await retry.mutateAsync(id)
      toast.success(t("toast.retried"))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  return (
    <Section
      icon={<Receipt />}
      title={t("invoices.title")}
      pointsLabel={t("invoices.subtitle", { field: status.more.invoiceNumberField })}
      points={[
        { icon: <DocumentText />, text: t("invoices.points.source") },
        { icon: <PencilSquare />, text: t("invoices.points.field", { field: status.more.invoiceNumberField }) },
        { icon: <ShieldCheck />, text: t("invoices.points.never"), tone: "green" },
      ]}
    >
      <FilterBar>
        {INVOICE_FILTERS.map((f, i) => (
          <Fragment key={f}>
            {i === 1 ? <FilterDivider /> : null}
            <FilterButton
              icon={INVOICE_FILTER_ICON[f]}
              label={t(`invoices.filter.${f}`)}
              count={counts[f]}
              attention={f === "conflict" || f === "failed"}
              active={filter === f}
              onClick={() => setFilter(toggleFilter(filter, f, "all"))}
            />
          </Fragment>
        ))}
      </FilterBar>
      <KitFetchingBar active={invoices.isFetching && !invoices.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("invoices.col.order")}</Table.HeaderCell>
              <Table.HeaderCell>{t("invoices.col.number")}</Table.HeaderCell>
              <Table.HeaderCell>{t("invoices.col.kind")}</Table.HeaderCell>
              <Table.HeaderCell>{t("invoices.col.bl")}</Table.HeaderCell>
              <Table.HeaderCell>{t("invoices.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("invoices.col.details")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <TableBodyState cols={7} loading={invoices.isLoading} icon={<Receipt />} title={t("invoices.empty")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5 [&_td]:align-top">
                  <Table.Cell>
                    <OrderLink orderId={r.orderId} displayId={r.displayId} />
                  </Table.Cell>
                  <Table.Cell className="font-mono txt-compact-small">{r.number ?? ""}</Table.Cell>
                  <Table.Cell className="uppercase">{r.kind}</Table.Cell>
                  <Table.Cell className="font-mono txt-compact-small">{r.blOrderId ?? ""}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <InvoiceStatusBadge status={r.status} />
                      {r.writtenAt ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {fmtDateTime(r.writtenAt, lang)}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-md">
                    {r.lastError ? (
                      <Text size="xsmall" className={r.status === "conflict" || r.status === "failed" ? "text-ui-tag-red-text" : "text-ui-fg-subtle"}>
                        {r.lastError}
                      </Text>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <RowActions
                      actions={[
                        {
                          key: "retry",
                          label: t("invoices.retry"),
                          icon: <ArrowPath />,
                          hidden: !(r.status === "conflict" || r.status === "failed" || r.status === "skipped"),
                          loading: retry.isPending && retry.variables === r.id,
                          onClick: () => void onRetry(r.id),
                        },
                      ]}
                    />
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pagination count={invoices.data?.count ?? 0} page={page} onPage={setPage} />
    </Section>
  )
}
