import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Container, Heading, InlineTip, Input, Table, Text, toast } from "@medusajs/ui"
import type { CardFilter, CheckResult, OrderFilter, StatusResponse } from "../../../modules/baselinker/lib/contract"
import {
  baselinkerKeys,
  errorMessage,
  useBaseLinkerCards,
  useBaseLinkerCheck,
  useBaseLinkerOrders,
  useBaseLinkerRuns,
  useBaseLinkerSend,
  useBaseLinkerStatus,
  useBaseLinkerStock,
  useBaseLinkerSync,
} from "../../lib/baselinker-api"
import { BaseLinkerIcon } from "../../lib/baselinker-icon"
import {
  ChangeStatusBadge,
  ConflictBadge,
  Fact,
  FilterPills,
  ModeBadge,
  OrderLink,
  OrderStatusBadge,
  RunStatusBadge,
  StatTile,
  fmtDateTime,
  fmtDelta,
  fmtDuration,
  fmtNumber,
  runSummary,
} from "../../lib/baselinker-ui"

/**
 * BaseLinker by Koda Plus: the connection, the stock plan, the cards linked to
 * variants, the order outbox with status and tracking, and the history of
 * background runs.
 */
const PAGE_SIZE = 15

const BaseLinkerPage = () => {
  const { t, i18n } = useTranslation("baselinker")
  const lang = i18n.language || "en"
  const client = useQueryClient()
  const [pollUntil, setPollUntil] = useState(0)
  const status = useBaseLinkerStatus(pollUntil)
  const s = status.data
  const polling = (s?.running.length ?? 0) > 0 || Date.now() < pollUntil
  const [cardFilter, setCardFilter] = useState<CardFilter>("all")

  /* A finished run refreshes the tables below. */
  const runKey = JSON.stringify(Object.values(s?.lastRuns ?? {}).map((r) => r?.id ?? ""))
  const seen = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (seen.current !== undefined && seen.current !== runKey) {
      void client.invalidateQueries({ queryKey: baselinkerKeys.all, predicate: (q) => q.queryKey[1] !== "status" })
    }
    seen.current = runKey
  }, [runKey, client])

  const poll = () => setPollUntil(Date.now() + 30_000)

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} onAction={poll} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s?.mode === "demo" ? (
          <div className="px-6 py-4">
            <InlineTip variant="info" label={t("demo.label")}>
              {t("demo.text")}
            </InlineTip>
          </div>
        ) : null}
        {s && s.mode === "live" && s.missing.length > 0 ? (
          <div className="px-6 py-4">
            <InlineTip variant="warning" label={t("missing.label")}>
              {t("missing.text", { missing: s.missing.join(", ") })}
            </InlineTip>
          </div>
        ) : null}
        {s ? (
          <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-4 xl:grid-cols-8">
            <StatTile label={t("stats.cards")} value={fmtNumber(s.counts.cards, lang)} active={cardFilter === "all"} onClick={() => setCardFilter("all")} />
            <StatTile label={t("stats.linked")} value={fmtNumber(s.counts.linked, lang)} tone="green" active={cardFilter === "linked"} onClick={() => setCardFilter("linked")} />
            <StatTile
              label={t("stats.unmatched")}
              value={fmtNumber(s.counts.unmatched, lang)}
              active={cardFilter === "unmatched"}
              onClick={() => setCardFilter("unmatched")}
            />
            <StatTile
              label={t("stats.conflicts")}
              value={fmtNumber(s.counts.conflicts, lang)}
              tone={s.counts.conflicts > 0 ? "red" : "default"}
              active={cardFilter === "conflicts"}
              onClick={() => setCardFilter("conflicts")}
            />
            <StatTile label={t("stats.onlyInMedusa")} value={fmtNumber(s.counts.onlyInMedusa, lang)} tone={s.counts.onlyInMedusa > 0 ? "orange" : "default"} />
            <StatTile label={t("stats.stockChanges")} value={fmtNumber(s.counts.stockChanges, lang)} tone={s.counts.stockChanges > 0 ? "orange" : "default"} />
            <StatTile label={t("stats.sent24h")} value={fmtNumber(s.counts.ordersSent24h, lang)} tone="green" />
            <StatTile label={t("stats.failed")} value={fmtNumber(s.counts.ordersFailed, lang)} tone={s.counts.ordersFailed > 0 ? "red" : "default"} />
          </div>
        ) : null}
      </Container>

      {s ? <ConnectionSection status={s} lang={lang} /> : null}
      {s ? <StockSection status={s} lang={lang} /> : null}
      {s ? <CardsSection status={s} lang={lang} filter={cardFilter} onFilter={setCardFilter} /> : null}
      {s ? <OrdersSection status={s} lang={lang} poll={polling} onAction={poll} /> : null}
      <RunsSection lang={lang} poll={polling} />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Header({ status, onAction }: { status: StatusResponse | undefined; onAction: () => void }) {
  const { t } = useTranslation("baselinker")
  const sync = useBaseLinkerSync()
  const running = new Set(status?.running ?? [])
  const f = status?.features

  const start = async (what: "catalog" | "statuses" | "orders") => {
    try {
      const r = await sync.mutateAsync(what)
      if (r.alreadyRunning) toast.info(t("toast.already"))
      else toast.success(t("toast.started"))
      onAction()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <BaseLinkerIcon width={24} height={24} className="shrink-0" />
          <Heading level="h1">{t("title")}</Heading>
          <Badge size="2xsmall" color="grey">
            {t("by")}
          </Badge>
          {status ? <ModeBadge status={status} /> : null}
        </div>
        <Text size="small" className="max-w-2xl text-ui-fg-subtle">
          {t("subtitle")}
        </Text>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="small" variant="secondary" disabled={!f?.statuses || running.has("statuses")} onClick={() => void start("statuses")}>
          {running.has("statuses") ? t("actions.running") : t("actions.syncStatuses")}
        </Button>
        <Button size="small" variant="secondary" disabled={!f?.orders || running.has("orders")} onClick={() => void start("orders")}>
          {running.has("orders") ? t("actions.running") : t("actions.sendQueue")}
        </Button>
        <Button
          size="small"
          variant="primary"
          isLoading={sync.isPending && sync.variables === "catalog"}
          disabled={!f?.catalog || running.has("catalog")}
          onClick={() => void start("catalog")}
        >
          <ArrowPath />
          {running.has("catalog") ? t("actions.running") : t("actions.syncCatalog")}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CheckLines({ result, configured }: { result: CheckResult; configured: StatusResponse["options"] }) {
  const { t } = useTranslation("baselinker")
  if (!result.ok) {
    return (
      <InlineTip variant="error" label={t("actions.check")}>
        {t("connection.checkFailed", { error: result.error ?? "?" })}
      </InlineTip>
    )
  }
  const inventoryId = result.mode === "demo" ? result.inventories[0]?.id ?? null : configured.inventoryId
  const warehouseId = result.mode === "demo" ? result.inventories[0]?.warehouses[0] ?? null : configured.warehouseId
  const lines: Array<{ ok: boolean; text: string }> = [{ ok: true, text: t("connection.checkOk") }]
  if (inventoryId !== null && result.inventoryFound !== null) {
    lines.push(
      result.inventoryFound
        ? { ok: true, text: t("connection.inventoryFound", { id: inventoryId, name: result.inventoryName ?? "" }) }
        : { ok: false, text: t("connection.inventoryMissing", { id: inventoryId, list: result.inventories.map((i) => `${i.id} ${i.name}`).join(", ") || "-" }) },
    )
  }
  if (warehouseId && result.warehouseFound !== null) {
    lines.push(
      result.warehouseFound
        ? { ok: true, text: t("connection.warehouseFound", { id: warehouseId }) }
        : { ok: false, text: t("connection.warehouseMissing", { id: warehouseId, list: result.warehouses.join(", ") || "-" }) },
    )
  }
  const allOk = lines.every((l) => l.ok)
  return (
    <InlineTip variant={allOk ? "success" : "warning"} label={t("actions.check")}>
      <span className="flex flex-col gap-y-1">
        {lines.map((l) => (
          <span key={l.text}>{l.text}</span>
        ))}
      </span>
    </InlineTip>
  )
}

function ids(list: number[], none: string): string {
  return list.length > 0 ? list.join(", ") : none
}

function ConnectionSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("baselinker")
  const check = useBaseLinkerCheck()
  const o = status.options
  const demo = status.mode === "demo"
  const result = check.data?.result ?? status.lastCheck

  const onCheck = async () => {
    try {
      const r = await check.mutateAsync()
      if (r.result.ok) toast.success(t("toast.checkOk"))
      else toast.error(t("toast.checkFailed", { error: r.result.error ?? "?" }))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const stockTone = o.stockSync === "write" ? "green" : o.stockSync === "plan" ? "blue" : "grey"
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <Heading level="h2">{t("connection.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {demo ? t("connection.demoNote") : t("connection.subtitle")}
          </Text>
        </div>
        <Button size="small" variant="secondary" isLoading={check.isPending} disabled={!demo && !status.tokenSet} onClick={() => void onCheck()}>
          {t("actions.check")}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
        {!demo ? (
          <Fact label={t("connection.token")}>
            {status.tokenSet ? t("connection.tokenSet") : <span className="text-ui-tag-red-text">{t("connection.tokenMissing")}</span>}
          </Fact>
        ) : null}
        <Fact label={t("connection.inventory")} mono>
          {o.inventoryId ?? (demo ? "1001" : t("connection.notSet"))}
          {result?.ok && result.inventoryName ? <span className="font-sans text-ui-fg-subtle"> ({result.inventoryName})</span> : null}
        </Fact>
        <Fact label={t("connection.warehouse")} mono>
          {o.warehouseId ?? (demo ? "bl_1001" : t("connection.notSet"))}
        </Fact>
        <Fact label={t("connection.orderStatus")} mono>
          {o.orderStatusId ?? (demo ? "100001" : t("connection.notSet"))}
        </Fact>
        <Fact label={t("connection.source")} mono>
          {o.customSourceId ?? t("connection.none")}
        </Fact>
        <Fact label={t("connection.location")} mono>
          {o.stockLocationId ?? <span className="font-sans">{t("connection.locationAuto")}</span>}
        </Fact>
        <Fact label={t("connection.stockMode")}>
          <Badge size="2xsmall" color={stockTone}>
            {t(`connection.stockModes.${o.stockSync}`)}
          </Badge>
        </Fact>
        <Fact label={t("connection.ordersMode")}>
          <Badge size="2xsmall" color={o.exportOrders ? "green" : "grey"}>
            {o.exportOrders ? t("connection.ordersOn") : t("connection.ordersOff")}
          </Badge>
        </Fact>
        <Fact label={t("connection.fulfillOn")} mono>
          {ids(o.fulfillOnStatusIds, t("connection.none"))}
        </Fact>
        <Fact label={t("connection.closedOn")} mono>
          {ids(o.closedStatusIds, t("connection.none"))}
        </Fact>
      </div>
      {result ? (
        <div className="flex flex-col gap-y-1 px-6 py-4">
          <CheckLines result={result} configured={o} />
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("connection.checkedAt", { time: fmtDateTime(result.checkedAt, lang) })}
          </Text>
        </div>
      ) : null}
      <div className="px-6 py-3">
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("connection.schedule")}
        </Text>
      </div>
    </Container>
  )
}

/* ------------------------------------------------------------------ */

function Pagination({ count, page, onPage }: { count: number; page: number; onPage: (p: number) => void }) {
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

function useDebounced(value: string, ms = 300): string {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value.trim()), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return out
}

function EmptyRow({ cols, text }: { cols: number; text: string }) {
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

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

function StockSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("baselinker")
  const [search, setSearch] = useState("")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [q])
  const stock = useBaseLinkerStock(q, page * PAGE_SIZE, PAGE_SIZE)
  const data = stock.data
  const rows = data?.changes ?? []
  const run = data?.run ?? status.lastRuns.stock ?? null
  const counts = (run?.counts ?? {}) as Record<string, unknown>
  const demo = status.mode === "demo"
  const o = status.options

  const modeText = demo
    ? t("stock.modeDemo")
    : o.stockSync === "off"
      ? t("stock.modeOff")
      : o.stockSync === "write"
        ? t("stock.modeWrite", { max: fmtNumber(o.maxStockChangesPerRun, lang) })
        : t("stock.modePlan")

  const summary: Array<[string, string]> = data
    ? [
        [t("stock.summary.changes"), fmtNumber(data.summary.changes, lang)],
        [t("stock.summary.added"), fmtDelta(data.summary.unitsAdded, lang)],
        [t("stock.summary.removed"), fmtDelta(-data.summary.unitsRemoved, lang)],
        [t("stock.summary.applied"), fmtNumber(data.summary.applied, lang)],
        [t("stock.summary.overCap"), fmtNumber(data.summary.overCap, lang)],
        [t("stock.summary.unchanged"), fmtNumber(num(counts.unchanged), lang)],
        [t("stock.summary.kits"), fmtNumber(num(counts.kitsSkipped), lang)],
        [t("stock.summary.negative"), fmtNumber(num(counts.negativeClamped), lang)],
      ]
    : []

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <Heading level="h2">{t("stock.title")}</Heading>
          <Text size="small" className="max-w-3xl text-ui-fg-subtle">
            {t("stock.subtitle")}
          </Text>
        </div>
        <div className="flex shrink-0 items-center gap-x-2">
          {run ? <RunStatusBadge status={run.status} /> : null}
        </div>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <InlineTip variant={o.stockSync === "write" && !demo ? "warning" : "info"} label={t(`connection.stockModes.${demo ? "plan" : o.stockSync}`)}>
          {modeText}
        </InlineTip>
        <Text size="xsmall" className="text-ui-fg-muted">
          {run ? `${t("stock.plannedAt", { time: fmtDateTime(run.startedAt, lang) })}. ${runSummary(run, t)}` : t("stock.never")}
        </Text>
      </div>
      {summary.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-6 py-4 sm:grid-cols-4 xl:grid-cols-8">
          {summary.map(([label, value]) => (
            <div key={label} className="flex flex-col">
              <Text size="xsmall" className="text-ui-fg-subtle">
                {label}
              </Text>
              <Text size="small" weight="plus" className="tabular-nums">
                {value}
              </Text>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex justify-end px-6 py-3">
        <div className="w-full md:w-72">
          <Input size="small" type="search" placeholder={t("stock.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("stock.col.variant")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("stock.col.medusa")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("stock.col.bl")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("stock.col.target")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("stock.col.units")}</Table.HeaderCell>
              <Table.HeaderCell>{t("stock.col.status")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow cols={6} text={stock.isLoading ? "" : run ? t("stock.empty") : t("stock.never")} />
            ) : (
              rows.map((c) => (
                <Table.Row key={c.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-[320px]">
                    {c.productId ? (
                      <Link to={`/products/${c.productId}`} className="flex flex-col gap-y-0.5 hover:text-ui-fg-interactive">
                        <span className="txt-compact-small-plus truncate text-ui-fg-base">{c.productTitle ?? c.productId}</span>
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{c.sku}</span>
                      </Link>
                    ) : (
                      <span className="font-mono txt-compact-small">{c.sku ?? c.variantId}</span>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <div className="flex flex-col items-end">
                      <span className="tabular-nums">{c.medusaStocked === null ? t("stock.noLevel") : fmtNumber(c.medusaStocked, lang)}</span>
                      {c.medusaReserved > 0 ? (
                        <span className="text-ui-fg-muted txt-compact-xsmall">{t("stock.reserved", { count: c.medusaReserved })}</span>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className={c.blStock < 0 ? "text-right tabular-nums text-ui-tag-red-text" : "text-right tabular-nums"}>
                    {fmtNumber(c.blStock, lang)}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {fmtNumber(c.target, lang)}
                    {c.afterStocked !== null && c.afterStocked !== c.target ? <span className="text-ui-tag-orange-text"> ({fmtNumber(c.afterStocked, lang)})</span> : null}
                  </Table.Cell>
                  <Table.Cell className={c.delta < 0 ? "text-right tabular-nums text-ui-tag-red-text" : "text-right tabular-nums text-ui-tag-green-text"}>
                    {fmtDelta(c.delta, lang)}
                  </Table.Cell>
                  <Table.Cell>
                    <ChangeStatusBadge status={c.status} />
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

const CARD_FILTERS: CardFilter[] = ["all", "linked", "unmatched", "conflicts", "nosku"]

function cardCount(status: StatusResponse, f: CardFilter): number {
  const c = status.counts
  switch (f) {
    case "all":
      return c.cards
    case "linked":
      return c.linked
    case "unmatched":
      return c.unmatched
    case "conflicts":
      return c.conflicts
    case "nosku":
      return c.noSku
  }
}

function CardsSection({
  status,
  lang,
  filter,
  onFilter,
}: {
  status: StatusResponse
  lang: string
  filter: CardFilter
  onFilter: (f: CardFilter) => void
}) {
  const { t } = useTranslation("baselinker")
  const [search, setSearch] = useState("")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])
  const cards = useBaseLinkerCards(filter, q, page * PAGE_SIZE, PAGE_SIZE)
  const rows = cards.data?.cards ?? []
  const onlyInMedusa = (status.lastRuns.catalog?.counts?.onlyInMedusaSkus ?? []) as string[]

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("cards.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("cards.subtitle")}
        </Text>
      </div>
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <FilterPills<CardFilter>
          value={filter}
          onChange={onFilter}
          options={CARD_FILTERS.map((f) => ({ value: f, label: t(`cards.filter.${f}`), count: cardCount(status, f) }))}
        />
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("cards.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("cards.col.card")}</Table.HeaderCell>
              <Table.HeaderCell>{t("cards.col.key")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("cards.col.stock")}</Table.HeaderCell>
              <Table.HeaderCell>{t("cards.col.product")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow cols={4} text={cards.isLoading ? "" : t("cards.empty")} />
            ) : (
              rows.map((c) => (
                <Table.Row key={c.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-[340px]">
                    <div className="flex flex-col gap-y-1">
                      <span className="txt-compact-small-plus truncate text-ui-fg-base">{c.name || "-"}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">#{c.blProductId}</span>
                        {c.parentId ? <span className="text-ui-fg-muted txt-compact-xsmall">{t("cards.variantOf", { id: c.parentId })}</span> : null}
                        {c.demo ? (
                          <Badge size="2xsmall" color="purple">
                            {t("cards.sample")}
                          </Badge>
                        ) : null}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    {c.sku || c.ean ? (
                      <div className="flex flex-col items-start gap-y-1">
                        {c.sku ? <span className="font-mono text-ui-fg-base txt-compact-small">{c.sku}</span> : null}
                        {c.ean ? <span className="font-mono text-ui-fg-subtle txt-compact-xsmall">{c.ean}</span> : null}
                        <span className="flex flex-wrap gap-1">
                          {c.variantId && c.matchSource ? (
                            <Badge size="2xsmall" color={c.matchSource === "sku" ? "blue" : "purple"}>
                              {t(`cards.source.${c.matchSource}`)}
                            </Badge>
                          ) : null}
                          {c.conflict ? <ConflictBadge conflict={c.conflict} /> : null}
                        </span>
                      </div>
                    ) : (
                      <Text size="small" className="text-ui-fg-muted">
                        {t("cards.noKey")}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell className={c.stock !== null && c.stock < 0 ? "text-right tabular-nums text-ui-tag-red-text" : "text-right tabular-nums"}>
                    {c.stock === null ? "" : fmtNumber(c.stock, lang)}
                  </Table.Cell>
                  <Table.Cell className="max-w-[280px]">
                    {c.productId ? (
                      <Link to={`/products/${c.productId}`} className="flex flex-col gap-y-0.5 hover:text-ui-fg-interactive">
                        <span className="txt-compact-small-plus truncate text-ui-fg-base">{c.productTitle ?? c.productId}</span>
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{c.variantSku}</span>
                      </Link>
                    ) : (
                      <Text size="small" className="text-ui-fg-muted">
                        {c.conflict ? "" : c.matchKey ? t("cards.noVariant") : ""}
                      </Text>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pagination count={cards.data?.count ?? 0} page={page} onPage={setPage} />
      {onlyInMedusa.length > 0 ? (
        <div className="px-6 py-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("cards.onlyInMedusa", { list: onlyInMedusa.slice(0, 20).join(", ") })}
            {status.counts.onlyInMedusa > 20 ? ` (+${status.counts.onlyInMedusa - 20})` : ""}
          </Text>
        </div>
      ) : null}
    </Container>
  )
}

/* ------------------------------------------------------------------ */

const ORDER_FILTERS: OrderFilter[] = ["all", "pending", "sent", "failed", "skipped"]

function orderCount(status: StatusResponse, f: OrderFilter): number {
  const c = status.counts
  switch (f) {
    case "all":
      return c.ordersPending + c.ordersSent + c.ordersFailed + c.ordersSkipped
    case "pending":
      return c.ordersPending
    case "sent":
      return c.ordersSent
    case "failed":
      return c.ordersFailed
    case "skipped":
      return c.ordersSkipped
  }
}

function OrdersSection({ status, lang, poll, onAction }: { status: StatusResponse; lang: string; poll: boolean; onAction: () => void }) {
  const { t } = useTranslation("baselinker")
  const [filter, setFilter] = useState<OrderFilter>(status.counts.ordersFailed > 0 ? "failed" : "all")
  const [search, setSearch] = useState("")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])
  const orders = useBaseLinkerOrders(filter, q, page * PAGE_SIZE, PAGE_SIZE, poll)
  const send = useBaseLinkerSend()
  const rows = orders.data?.orders ?? []

  const onSend = async (orderId: string) => {
    try {
      await send.mutateAsync(orderId)
      toast.success(t("toast.sent"))
      onAction()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("orders.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("orders.subtitle")}
        </Text>
      </div>
      {!status.options.exportOrders ? (
        <div className="px-6 py-4">
          <InlineTip variant="info" label={t("connection.ordersMode")}>
            {t("orders.exportOff")}
          </InlineTip>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <FilterPills<OrderFilter>
          value={filter}
          onChange={setFilter}
          options={ORDER_FILTERS.map((f) => ({ value: f, label: t(`orders.filter.${f}`), count: orderCount(status, f) }))}
        />
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("orders.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("orders.col.order")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.col.bl")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.col.blStatus")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.col.tracking")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("orders.col.attempts")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.col.details")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow cols={8} text={orders.isLoading ? "" : t("orders.empty")} />
            ) : (
              rows.map((o) => (
                <Table.Row key={o.id} className="[&_td]:py-2.5">
                  <Table.Cell>
                    <OrderLink orderId={o.orderId} displayId={o.displayId} />
                  </Table.Cell>
                  <Table.Cell>
                    <OrderStatusBadge status={o.status} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap font-mono txt-compact-small">{o.blOrderId ?? ""}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{o.blStatusName ?? (o.blStatusId !== null ? `#${o.blStatusId}` : "")}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {o.trackingNumber ? (
                      o.trackingUrl ? (
                        <a
                          href={o.trackingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                          title={t("actions.track")}
                        >
                          <span>
                            {o.carrier ? `${o.carrier} ` : ""}
                            <span className="font-mono">{o.trackingNumber}</span>
                          </span>
                          <ArrowUpRightOnBox className="shrink-0" />
                        </a>
                      ) : (
                        <span>
                          {o.carrier ? `${o.carrier} ` : ""}
                          <span className="font-mono">{o.trackingNumber}</span>
                        </span>
                      )
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{o.attempts}</Table.Cell>
                  <Table.Cell className="max-w-md">
                    {o.lastError ? (
                      <Text size="small" className={o.status === "failed" ? "text-ui-tag-red-text" : "text-ui-fg-subtle"}>
                        {o.lastErrorCode && o.lastErrorCode !== "skipped" ? <span className="font-mono">[{o.lastErrorCode}] </span> : null}
                        {o.lastError}
                      </Text>
                    ) : null}
                    {o.status === "pending" && o.nextAttemptAt && o.attempts > 0 ? (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {t("orders.nextAttempt", { time: fmtDateTime(o.nextAttemptAt, lang) })}
                      </Text>
                    ) : null}
                    {o.fulfilledAt && o.lastErrorCode !== "fulfillment_skipped" ? (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {t("orders.fulfilled", { time: fmtDateTime(o.fulfilledAt, lang) })}
                      </Text>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    {status.features.orders && (o.status === "failed" || (o.status === "pending" && o.attempts > 0)) ? (
                      <Button size="small" variant="secondary" isLoading={send.isPending && send.variables === o.orderId} onClick={() => void onSend(o.orderId)}>
                        {t("actions.sendAgain")}
                      </Button>
                    ) : null}
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pagination count={orders.data?.count ?? 0} page={page} onPage={setPage} />
    </Container>
  )
}

/* ------------------------------------------------------------------ */

function RunsSection({ lang, poll }: { lang: string; poll: boolean }) {
  const { t } = useTranslation("baselinker")
  const runs = useBaseLinkerRuns(poll)
  const rows = runs.data?.runs ?? []
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("runs.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("runs.subtitle")}
        </Text>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("runs.col.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.kind")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.result")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.summary")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("runs.col.duration")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow cols={5} text={runs.isLoading ? "" : t("runs.empty")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5" title={r.message ?? undefined}>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.startedAt, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {t(`runs.kinds.${r.kind}`)}
                    <span className="text-ui-fg-muted"> / {t(`runs.triggers.${r.trigger}`)}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <RunStatusBadge status={r.status} />
                  </Table.Cell>
                  <Table.Cell className="max-w-xl">
                    <Text size="small">{runSummary(r, t)}</Text>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{fmtDuration(r.durationMs)}</Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "BaseLinker",
  icon: BaseLinkerIcon,
})

export default BaseLinkerPage
