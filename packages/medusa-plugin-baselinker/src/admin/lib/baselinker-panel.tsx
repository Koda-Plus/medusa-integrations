import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowLongRight, ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Container, Heading, InlineTip, Input, Table, Text, toast, usePrompt } from "@medusajs/ui"
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
import { References, type Reference } from "./baselinker-guide"
import {
  FilterPills,
  ImportStatusBadge,
  InvoiceStatusBadge,
  OrderLink,
  PlanActionBadge,
  PlanStatusBadge,
  RunStatusBadge,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
  localize,
  sinceDate,
} from "./baselinker-ui"

/*
 * Sections of the BaseLinker page added in 0.2: the source of truth with the
 * writers and their arm switches, the plans of the writers, the marketplace
 * orders imported from BaseLinker, returns and invoice numbers. Shared table
 * pieces (pagination, empty row, debounced search) live here too.
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

export function useDebounced(value: string, ms = 300): string {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value.trim()), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return out
}

export function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <Table.Row>
      <td colSpan={cols} className="px-6 py-6 text-center">
        <Text size="small" className="text-ui-fg-muted">
          {text}
        </Text>
      </td>
    </Table.Row>
  )
}

function SectionHead({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <Heading level="h2">{title}</Heading>
        {subtitle ? (
          <Text size="small" className="max-w-3xl text-ui-fg-subtle">
            {subtitle}
          </Text>
        ) : null}
      </div>
      {right ? <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Running in production                                               */
/* ------------------------------------------------------------------ */

export function ReferencesBlock({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("baselinker")
  const items: Reference[] = (status.references ?? []).map((r) => ({
    name: r.name,
    url: r.url,
    icon: r.icon,
    description: localize(r.description, lang) || undefined,
    since: r.since ?? undefined,
    metrics: r.metrics.map((m) => ({ label: localize(m.label, lang), value: m.value })),
    links: r.links.map((l) => ({ label: localize(l.label, lang), url: l.url })),
  }))
  return (
    <References
      items={items}
      title={t("references.title")}
      subtitle={t("references.subtitle")}
      openLabel={t("references.open")}
      sinceLabel={(since) => t("references.since", { date: sinceDate(since, lang) })}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Source of truth and writers                                         */
/* ------------------------------------------------------------------ */

function Flow({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Badge size="2xsmall" color="grey">
        {from}
      </Badge>
      <ArrowLongRight className="text-ui-fg-muted" />
      <Badge size="2xsmall" color="blue">
        {to}
      </Badge>
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
        <Badge size="2xsmall" color={tone}>
          {label}
        </Badge>
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

  const readOnly = (
    <Badge size="2xsmall" color="grey">
      {t("directions.readOnly")}
    </Badge>
  )
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
      writer: (
        <Badge size="2xsmall" color={status.options.exportOrders ? "green" : "grey"}>
          {status.options.exportOrders ? t("directions.fixed") : t("connection.ordersOff")}
        </Badge>
      ),
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
    <Container className="divide-y p-0">
      <SectionHead title={t("directions.title")} subtitle={t("directions.subtitle")} />
      {d.switchable ? (
        <div className="flex flex-col gap-3 px-6 py-4">
          <InlineTip variant="info" label={t("demo.label")}>
            {t("directions.demoNote")}
          </InlineTip>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <Text size="small" className="text-ui-fg-subtle">
                {t("directions.pickCatalog")}
              </Text>
              <FilterPills<"medusa" | "baselinker">
                value={d.catalog}
                onChange={(v) => void pick({ catalog: v })}
                options={[
                  { value: "medusa", label: M },
                  { value: "baselinker", label: B },
                ]}
              />
            </div>
            <div className="flex items-center gap-2">
              <Text size="small" className="text-ui-fg-subtle">
                {t("directions.pickStock")}
              </Text>
              <FilterPills<"medusa" | "baselinker">
                value={d.stock}
                onChange={(v) => void pick({ stock: v })}
                options={[
                  { value: "baselinker", label: B },
                  { value: "medusa", label: M },
                ]}
              />
            </div>
          </div>
        </div>
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
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

const PLAN_FILTERS: PlanFilter[] = ["all", "changes", "create", "update", "draft", "conflict", "skip", "failed", "quarantined"]

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

export function PlanSection({ kind, status, lang }: { kind: PlanKind; status: StatusResponse; lang: string }) {
  const { t } = useTranslation("baselinker")
  const [filter, setFilter] = useState<PlanFilter>("changes")
  const [search, setSearch] = useState("")
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
  const modeText = writer && !writer.active ? t("plans.mode.off") : writer?.live ? (demo ? t("plans.mode.demo") : t("plans.mode.write", { max })) : t("plans.mode.plan")

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

  return (
    <Container className="divide-y p-0">
      <SectionHead
        title={t(`plans.kinds.${kind}.title`)}
        subtitle={t(`plans.kinds.${kind}.subtitle`)}
        right={run ? <RunStatusBadge status={run.status} /> : null}
      />
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <InlineTip variant={writer?.live && !demo ? "warning" : "info"} label={writer ? t(`directions.writers.${writer.key}`) : t(`plans.kinds.${kind}.title`)}>
          {modeText}
        </InlineTip>
        <Text size="xsmall" className="text-ui-fg-muted">
          {run
            ? `${t("plans.plannedAt", { time: fmtDateTime(run.startedAt, lang) })}. ${t("plans.summary", {
                create: summary.create,
                update: summary.update,
                conflict: summary.conflict,
                skip: summary.skip,
              })}`
            : t("plans.never")}
        </Text>
        {run?.status === "error" || run?.counts?.skipped ? (
          <Text size="xsmall" className="text-ui-tag-orange-text">
            {run.message}
          </Text>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <FilterPills<PlanFilter>
          value={filter}
          onChange={setFilter}
          options={PLAN_FILTERS.filter((f) => f === "all" || f === "changes" || (count(f) ?? 0) > 0).map((f) => ({ value: f, label: t(`plans.filter.${f}`), count: count(f) }))}
        />
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("plans.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("plans.col.item")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plans.col.action")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plans.col.changes")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plans.col.status")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow cols={4} text={plans.isLoading ? "" : run ? t("plans.empty") : t("plans.never")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5 [&_td]:align-top">
                  <Table.Cell className="max-w-[300px]">
                    <div className="flex flex-col gap-y-0.5">
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
                      {r.quarantine?.quarantinedAt ? (
                        <Button size="small" variant="secondary" isLoading={release.isPending && release.variables === r.quarantine.id} onClick={() => void onRelease(r.quarantine!.id)}>
                          {t("plans.release")}
                        </Button>
                      ) : null}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pagination count={data?.count ?? 0} page={page} onPage={setPage} />
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Marketplace orders from BaseLinker                                  */
/* ------------------------------------------------------------------ */

const IMPORT_FILTERS: ImportFilter[] = ["all", "pending", "imported", "skipped", "failed", "flagged"]

export function ImportsSection({ status, lang, poll }: { status: StatusResponse; lang: string; poll: boolean }) {
  const { t } = useTranslation("baselinker")
  const c = status.counts2.imports
  const [filter, setFilter] = useState<ImportFilter>(c.failed > 0 ? "failed" : "all")
  const [search, setSearch] = useState("")
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

  return (
    <Container className="divide-y p-0">
      <SectionHead title={t("imports.title")} subtitle={t("imports.subtitle")} />
      <div className="flex flex-col gap-2 px-6 py-4">
        {!status.features2.orderImport ? (
          <InlineTip variant="info" label={t("directions.writers.orderImport")}>
            {t("imports.off")}
          </InlineTip>
        ) : null}
        {status.features2.orderImport && !writer?.live && c.pending > 0 ? (
          <InlineTip variant="warning" label={t("directions.writers.orderImport")}>
            {t("imports.waiting", { count: c.pending })}
          </InlineTip>
        ) : null}
        {status.features2.orderImport ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("imports.emailNote")}
          </Text>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <FilterPills<ImportFilter>
          value={filter}
          onChange={setFilter}
          options={IMPORT_FILTERS.map((f) => ({ value: f, label: t(`imports.filter.${f}`), count: counts[f] }))}
        />
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("imports.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("imports.col.order")}</Table.HeaderCell>
              <Table.HeaderCell>{t("imports.col.source")}</Table.HeaderCell>
              <Table.HeaderCell>{t("imports.col.medusa")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("imports.col.total")}</Table.HeaderCell>
              <Table.HeaderCell>{t("imports.col.payment")}</Table.HeaderCell>
              <Table.HeaderCell>{t("imports.col.blStatus")}</Table.HeaderCell>
              <Table.HeaderCell>{t("imports.col.details")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow cols={8} text={imports.isLoading ? "" : t("imports.empty")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5 [&_td]:align-top">
                  <Table.Cell>
                    <div className="flex flex-col gap-y-0.5">
                      <span className="font-mono txt-compact-small-plus">{r.blOrderId}</span>
                      {r.marketplaceRef ? <span className="max-w-[220px] truncate font-mono text-ui-fg-muted txt-compact-xsmall">{r.marketplaceRef}</span> : null}
                      {r.confirmedAt ? <span className="text-ui-fg-muted txt-compact-xsmall">{fmtDateTime(r.confirmedAt, lang)}</span> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap capitalize">{r.source}</Table.Cell>
                  <Table.Cell>{r.orderId ? <OrderLink orderId={r.orderId} displayId={r.displayId} /> : null}</Table.Cell>
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
                    {writer?.live && r.status !== "imported" ? (
                      <Button size="small" variant="secondary" isLoading={importNow.isPending && importNow.variables === r.id} onClick={() => void onImport(r.id)}>
                        {t("imports.importNow")}
                      </Button>
                    ) : null}
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pagination count={imports.data?.count ?? 0} page={page} onPage={setPage} />
    </Container>
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
    <Container className="divide-y p-0">
      <SectionHead title={t("returns.title")} subtitle={t("returns.subtitle")} right={status.lastRuns.returns ? <RunStatusBadge status={status.lastRuns.returns.status} /> : null} />
      {!status.more.returnsSync ? (
        <div className="px-6 py-4">
          <InlineTip variant="info" label={t("returns.title")}>
            {t("returns.off")}
          </InlineTip>
        </div>
      ) : null}
      <div className="flex justify-end px-6 py-3">
        <div className="w-full md:w-72">
          <Input size="small" type="search" placeholder={t("returns.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("returns.col.return")}</Table.HeaderCell>
              <Table.HeaderCell>{t("returns.col.order")}</Table.HeaderCell>
              <Table.HeaderCell>{t("returns.col.source")}</Table.HeaderCell>
              <Table.HeaderCell>{t("returns.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("returns.col.items")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("returns.col.refunded")}</Table.HeaderCell>
              <Table.HeaderCell>{t("returns.col.created")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow cols={7} text={returns.isLoading ? "" : t("returns.empty", { days: status.more.returnsWindowDays })} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5 [&_td]:align-top">
                  <Table.Cell>
                    <div className="flex flex-col">
                      <span className="font-mono txt-compact-small-plus">{r.blReturnId}</span>
                      {r.externalReturnId ? <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{r.externalReturnId}</span> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col">
                      {r.orderId ? <OrderLink orderId={r.orderId} displayId={r.displayId} /> : <span className="text-ui-fg-muted txt-compact-small">{t("returns.noOrder")}</span>}
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
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Invoice numbers                                                     */
/* ------------------------------------------------------------------ */

const INVOICE_FILTERS: Array<InvoiceRowStatus | "all"> = ["all", "pending", "written", "conflict", "skipped", "failed"]

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
    <Container className="divide-y p-0">
      <SectionHead title={t("invoices.title")} subtitle={t("invoices.subtitle", { field: status.more.invoiceNumberField })} />
      <div className="px-6 py-4">
        <FilterPills<InvoiceRowStatus | "all">
          value={filter}
          onChange={setFilter}
          options={INVOICE_FILTERS.map((f) => ({ value: f, label: t(`invoices.filter.${f}`), count: counts[f] }))}
        />
      </div>
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
              <EmptyRow cols={7} text={invoices.isLoading ? "" : t("invoices.empty")} />
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
                    {r.status === "conflict" || r.status === "failed" || r.status === "skipped" ? (
                      <Button size="small" variant="secondary" isLoading={retry.isPending && retry.variables === r.id} onClick={() => void onRetry(r.id)}>
                        {t("invoices.retry")}
                      </Button>
                    ) : null}
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pagination count={invoices.data?.count ?? 0} page={page} onPage={setPage} />
    </Container>
  )
}
