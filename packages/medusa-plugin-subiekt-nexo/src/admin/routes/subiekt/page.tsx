import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath } from "@medusajs/icons"
import { Badge, Button, Container, Heading, InlineTip, Input, Table, Text, toast } from "@medusajs/ui"
import type { RunDto, SubiektStatusResponse, TaskDto } from "../../../modules/subiekt/lib/contract"
import {
  errorMessage,
  subiektKeys,
  useSubiektCheck,
  useSubiektDocuments,
  useSubiektRetry,
  useSubiektRuns,
  useSubiektStatus,
  useSubiektSync,
  useSubiektTasks,
} from "../../lib/subiekt-api"
import { AddStoreButton, HelpButtons, ModeBadge, ReferencesBadge, SettingsButton, SettingsView, ViewSwitch, communityLabels, usePageNav, type PageNav } from "../../lib/subiekt-guide"
import { GuideView, usePromptSpec } from "../../lib/subiekt-guide-view"
import { SubiektIcon } from "../../lib/subiekt-icon"
import { BridgeSection, ProductsSection, WritersSection } from "../../lib/subiekt-panels"
import {
  ConnectionBadge,
  DocumentStatusBadge,
  Field,
  FilterPills,
  Pager,
  RunStatusBadge,
  SampleList,
  StatTile,
  StoreColumn,
  StoreOrderCell,
  TaskStatusBadge,
  connectionState,
  fmtDateTime,
  fmtDuration,
  fmtNumber,
  fmtRating,
  monthYear,
  referencesFor,
  runSummary,
} from "../../lib/subiekt-ui"

/**
 * Subiekt nexo by Koda Plus. Three views, switched in the header and kept in the URL:
 *
 * - Panel: the business side. Counters, the queue of orders on their way to
 *   Subiekt and the documents Subiekt issued, each next to its order in the
 *   store, then the products and prices from Subiekt next to the store products.
 * - Setup guide (`?view=guide`).
 * - Settings (`?view=settings&tab=`), behind the cog: the technical side.
 *   The connection, the bridge diagnostics, the writers, the stock sync and the history.
 *
 * The demo note and the stores running the integration sit in header badges.
 */
const PAGE_SIZE = 15

const SETTINGS_TABS = ["connection", "bridge", "writers", "stock", "runs"] as const
type SettingsTabId = (typeof SETTINGS_TABS)[number]

const SubiektPage = () => {
  const { t, i18n } = useTranslation("subiekt")
  const lang = i18n.language || "en"
  const client = useQueryClient()
  const nav = usePageNav(SETTINGS_TABS)
  const [pollUntil, setPollUntil] = useState(0)
  const status = useSubiektStatus(pollUntil)
  const s = status.data
  const polling = (s?.running.length ?? 0) > 0 || Date.now() < pollUntil

  /* A finished run refreshes the tables below. */
  const runKey = JSON.stringify(Object.values(s?.lastRuns ?? {}).map((r) => r?.id ?? ""))
  const seen = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (seen.current !== undefined && seen.current !== runKey) {
      void client.invalidateQueries({ queryKey: subiektKeys.all, predicate: (q) => q.queryKey[1] !== "status" })
    }
    seen.current = runKey
  }, [runKey, client])

  const poll = () => setPollUntil(Date.now() + 30_000)

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} loading={status.isLoading} lang={lang} nav={nav} onAction={poll} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {errorMessage(status.error)}
            </InlineTip>
          </div>
        ) : null}
        {s ? <Warnings status={s} /> : null}
        {s && nav.view === "panel" ? (
          <div className="grid grid-cols-2 divide-x divide-y md:grid-cols-4 xl:grid-cols-7 xl:divide-y-0">
            <StatTile label={t("stats.sent24h")} value={fmtNumber(s.counts.succeeded24h, lang)} />
            <StatTile label={t("stats.waiting")} value={fmtNumber(s.counts.waiting, lang)} tone={s.counts.waiting ? undefined : "muted"} />
            <StatTile
              label={t("stats.queue")}
              value={fmtNumber(s.counts.pending + s.counts.running + s.counts.unknown, lang)}
              tone={s.counts.pending + s.counts.running + s.counts.unknown ? undefined : "muted"}
            />
            <StatTile label={t("stats.attention")} value={fmtNumber(s.counts.failed, lang)} tone={s.counts.failed ? "attention" : "muted"} />
            <StatTile label={t("stats.zk")} value={fmtNumber(s.counts.zk, lang)} />
            <StatTile label={t("stats.wz")} value={fmtNumber(s.counts.wz, lang)} />
            <StatTile label={t("stats.sales")} value={fmtNumber(s.counts.fs + s.counts.pa, lang)} tone={s.counts.fs + s.counts.pa ? undefined : "muted"} />
          </div>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} lang={lang} /> : null}

      {/* The documents table reads its own endpoint, so it shows even when the status failed, as it always did. */}
      {nav.view === "panel" ? (
        <>
          {s ? <TasksSection status={s} lang={lang} poll={polling} onAction={poll} /> : null}
          <DocumentsSection lang={lang} poll={polling} />
          {s ? <ProductsSection status={s} lang={lang} poll={polling} onAction={poll} /> : null}
        </>
      ) : null}

      {nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "connection", label: t("settings.tab.connection") },
            { id: "bridge", label: t("settings.tab.bridge") },
            { id: "writers", label: t("settings.tab.writers"), badge: s?.writers.filter((w) => w.active).length, tone: "orange" },
            { id: "stock", label: t("settings.tab.stock"), badge: s?.options.stockDryRun ? t("stock.dryRun") : null, tone: "purple" },
            { id: "runs", label: t("settings.tab.runs") },
          ]}
        >
          {s && nav.tab === "connection" ? <ConnectionSection status={s} lang={lang} /> : null}
          {s && nav.tab === "bridge" ? <BridgeSection status={s} lang={lang} /> : null}
          {s && nav.tab === "writers" ? <WritersSection status={s} lang={lang} /> : null}
          {s && nav.tab === "stock" ? <StockSection run={s.lastRuns.stock ?? null} lang={lang} /> : null}
          {nav.tab === "runs" ? <RunsSection lang={lang} poll={polling} /> : null}
        </SettingsView>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Header({
  status,
  loading,
  lang,
  nav,
  onAction,
}: {
  status: SubiektStatusResponse | undefined
  loading: boolean
  lang: string
  nav: PageNav<SettingsTabId>
  onAction: () => void
}) {
  const { t } = useTranslation("subiekt")
  const sync = useSubiektSync()
  const check = useSubiektCheck()
  const ready = Boolean(status && (status.mode === "demo" || status.configured))
  const running = new Set(status?.running ?? [])
  const state = connectionState(status)
  const references = status ? referencesFor(status.references, lang) : []
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)

  const start = async (what: "stock" | "events") => {
    try {
      const r = await sync.mutateAsync(what)
      if (r.alreadyRunning) toast.info(t("toast.already"))
      else toast.success(t("toast.started"))
      onAction()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const onCheck = async () => {
    try {
      const r = await check.mutateAsync()
      if (r.result?.ok) toast.success(t("toast.checkedOk"))
      else toast.error(t("toast.checkedFail", { error: r.result?.error ?? "?" }))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 flex-col gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <SubiektIcon width={24} height={24} className="shrink-0" />
          <Heading level="h1">{t("title")}</Heading>
          <Badge size="2xsmall" color="grey">
            {t("by")}
          </Badge>
          {!loading ? (
            <ModeBadge color={state.tone} label={t(`mode.${state.key}`)} title={t("demo.label")}>
              {status?.mode === "demo" ? <span>{t("demo.text")}</span> : null}
            </ModeBadge>
          ) : null}
        </div>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("subtitle")}
        </Text>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <ReferencesBadge
            items={references}
            labels={{
              count: references.length === 1 ? t("references.badgeOne") : t("references.badgeMany", { count: references.length }),
              title: t("references.title"),
              subtitle: t("references.subtitle"),
              open: t("references.open"),
              review: t("references.review"),
              since: (since) => t("references.since", { date: monthYear(since, lang) }),
              rating: (value) => fmtRating(value, lang),
            }}
          />
          <AddStoreButton labels={community.addStore} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
        <div className="flex flex-wrap items-center gap-2">
          <ViewSwitch value={nav.view} onChange={(v) => nav.go(v)} labels={{ panel: t("view.panel"), guide: t("view.guide") }} />
          <SettingsButton active={nav.view === "settings"} onClick={() => nav.go(nav.view === "settings" ? "panel" : "settings")} label={t("settings.title")} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="small" variant="secondary" disabled={!ready} isLoading={check.isPending} onClick={onCheck}>
            {t("actions.check")}
          </Button>
          {nav.view !== "guide" ? (
            <>
              <Button size="small" variant="secondary" disabled={!ready || running.has("events")} onClick={() => start("events")}>
                {running.has("events") ? t("actions.running") : t("actions.events")}
              </Button>
              <Button size="small" variant="primary" disabled={!ready || running.has("stock")} onClick={() => start("stock")}>
                <ArrowPath />
                {running.has("stock") ? t("actions.running") : t("actions.stock")}
              </Button>
            </>
          ) : null}
        </div>
        <HelpButtons spec={promptSpec} lang={lang} labels={community} />
      </div>
    </div>
  )
}

/** Only what needs a person now, in every view as before; the demo note lives in the mode badge. */
function Warnings({ status }: { status: SubiektStatusResponse }) {
  const { t } = useTranslation("subiekt")
  return (
    <>
      {status.mode === "live" && status.missing.length > 0 ? (
        <div className="px-6 py-4">
          <InlineTip variant="warning" label={t("missing.label")}>
            {t("missing.text", { missing: status.missing.join(", ") })}
          </InlineTip>
        </div>
      ) : null}
      {status.optionWarnings.map((w) => (
        <div key={w} className="px-6 py-4">
          <InlineTip variant="warning" label={t("optionWarnings.label")}>
            {t(`optionWarnings.${w}`, { defaultValue: w })}
          </InlineTip>
        </div>
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ */

function ConnectionSection({ status, lang }: { status: SubiektStatusResponse; lang: string }) {
  const { t } = useTranslation("subiekt")
  const c = status.connection
  const h = c.health
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("connection.title")}</Heading>
        <ConnectionBadge status={status} />
      </div>
      <div className="py-2">
        <Field label={t("connection.bridge")}>
          {h ? (
            <span>
              {h.bridge?.name} {h.bridge?.version}{" "}
              <span className="text-ui-fg-muted">({t("connection.contract", { version: h.bridge?.contract })})</span>
            </span>
          ) : (
            <span className="text-ui-fg-muted">{status.bridgeHost ?? t("connection.none")}</span>
          )}
          {status.bridgeHost && h ? <div className="text-ui-fg-muted">{status.bridgeHost}</div> : null}
        </Field>
        <Field label={t("connection.subiekt")}>
          {h?.subiekt ? [h.subiekt.product, h.subiekt.version].filter(Boolean).join(" ") || t("connection.none") : t("connection.none")}
        </Field>
        <Field label={t("connection.database")}>{h?.subiekt?.database ?? t("connection.none")}</Field>
        <Field label={t("connection.company")}>{h?.subiekt?.company ?? t("connection.none")}</Field>
        <Field label={t("connection.warehouse")}>{h?.subiekt?.warehouse ?? t("connection.none")}</Field>
        <Field label={t("connection.checkedAt")}>{fmtDateTime(c.checkedAt, lang) || t("connection.never")}</Field>
        <Field label={t("connection.eventsReadAt")}>{fmtDateTime(c.eventsReadAt, lang) || t("connection.never")}</Field>
      </div>
      {c.lastError && (!c.reachable || (h && !h.subiekt?.connected)) ? (
        <div className="px-6 py-4">
          <InlineTip variant="error" label={t("connection.lastError")}>
            {c.lastError}
            {c.consecutiveFailures > 1 ? ` (${t("connection.failures", { count: c.consecutiveFailures })})` : ""}
          </InlineTip>
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

interface StockStats {
  subiektProducts?: number
  matchedItems?: number
  toUpdate?: number
  toCreate?: number
  unchanged?: number
  unmatchedSubiekt?: number
  unmatchedVariants?: number
  conflicts?: number
  samples?: {
    changes?: Array<{ sku: string | null; from: number | null; to: number }>
    unmatchedVariants?: string[]
    unmatchedSubiekt?: string[]
    conflicts?: string[]
  }
}

function StockSection({ run, lang }: { run: RunDto | null; lang: string }) {
  const { t } = useTranslation("subiekt")
  const stats = (run?.stats ?? null) as StockStats | null
  const counters: Array<[string, number | undefined, boolean]> = stats
    ? [
        ["subiektProducts", stats.subiektProducts, false],
        ["matchedItems", stats.matchedItems, false],
        ["toUpdate", stats.toUpdate, false],
        ["toCreate", stats.toCreate, false],
        ["unchanged", stats.unchanged, false],
        ["unmatchedVariants", stats.unmatchedVariants, true],
        ["unmatchedSubiekt", stats.unmatchedSubiekt, false],
        ["conflicts", stats.conflicts, true],
      ]
    : []
  const samples = stats?.samples
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between gap-x-2 px-6 py-4">
        <div>
          <Heading level="h2">{t("stock.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("stock.subtitle")}
          </Text>
        </div>
        <div className="flex shrink-0 items-center gap-x-2 whitespace-nowrap">
          {run?.dryRun ? (
            <Badge size="2xsmall" color="purple">
              {t("stock.dryRun")}
            </Badge>
          ) : null}
          {run ? <RunStatusBadge status={run.status} /> : null}
        </div>
      </div>
      {!run ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-muted">
            {t("stock.never")}
          </Text>
        </div>
      ) : (
        <>
          <div className="px-6 py-3">
            <Text size="small">{runSummary(run, t)}</Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              {fmtDateTime(run.startedAt, lang)}, {fmtDuration(run.durationMs)}
            </Text>
          </div>
          {counters.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-6 py-4 sm:grid-cols-4">
              {counters.map(([key, value, warn]) => (
                <div key={key} className="flex flex-col">
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {t(`stock.counters.${key}`)}
                  </Text>
                  <Text size="small" weight="plus" className={warn && value ? "text-ui-tag-orange-text tabular-nums" : "tabular-nums"}>
                    {fmtNumber(value ?? 0, lang)}
                  </Text>
                </div>
              ))}
            </div>
          ) : null}
          {samples ? (
            <div className="flex flex-col gap-y-3 px-6 py-4">
              {samples.changes && samples.changes.length > 0 ? (
                <SampleList
                  label={t("stock.samples.changes")}
                  items={samples.changes.map((c) => `${c.sku ?? "?"}: ${c.from === null ? "-" : fmtNumber(c.from, lang)} → ${fmtNumber(c.to, lang)}`)}
                />
              ) : null}
              {samples.unmatchedVariants && samples.unmatchedVariants.length > 0 ? (
                <SampleList label={t("stock.samples.unmatchedVariants")} items={samples.unmatchedVariants} />
              ) : null}
              {samples.unmatchedSubiekt && samples.unmatchedSubiekt.length > 0 ? (
                <SampleList label={t("stock.samples.unmatchedSubiekt")} items={samples.unmatchedSubiekt} />
              ) : null}
              {samples.conflicts && samples.conflicts.length > 0 ? <SampleList label={t("stock.samples.conflicts")} items={samples.conflicts} /> : null}
            </div>
          ) : null}
        </>
      )}
    </Container>
  )
}

/* ------------------------------------------------------------------ */

type TaskFilter = "attention" | "open" | "done" | "all"

function TaskDetails({ task, lang }: { task: TaskDto; lang: string }) {
  const { t } = useTranslation("subiekt")
  const buyer = task.buyer
  return (
    <div className="flex flex-col gap-y-0.5">
      {task.lastError ? (
        <Text size="small" className={task.status === "failed" ? "text-ui-tag-red-text" : "text-ui-fg-subtle"}>
          {task.lastErrorCode ? <span className="font-mono">[{task.lastErrorCode}] </span> : null}
          {task.lastError}
        </Text>
      ) : null}
      {task.status === "unknown" ? (
        <Text size="xsmall" className="text-ui-tag-orange-text">
          {t("tasks.unknownHint")}
        </Text>
      ) : null}
      {task.manualAction ? (
        <Text size="small" className="text-ui-tag-orange-text">
          {t("tasks.manual")}
        </Text>
      ) : null}
      {buyer ? (
        <Text size="xsmall" className="text-ui-fg-subtle">
          {buyer.source === "retail"
            ? t("tasks.buyer.retail")
            : t(`tasks.buyer.${buyer.source}`, { name: buyer.name ?? buyer.symbol ?? "?", nip: buyer.nip ?? "?" })}
        </Text>
      ) : null}
      {task.warnings.map((w) => (
        <Text key={w} size="xsmall" className="text-ui-tag-orange-text">
          {w}
        </Text>
      ))}
      {(task.status === "pending" || task.status === "unknown") && task.nextAttemptAt && task.attempts > 0 ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("tasks.nextAttempt", { time: fmtDateTime(task.nextAttemptAt, lang) })}
        </Text>
      ) : null}
    </div>
  )
}

function TasksSection({ status, lang, poll, onAction }: { status: SubiektStatusResponse; lang: string; poll: boolean; onAction: () => void }) {
  const { t } = useTranslation("subiekt")
  const [filter, setFilter] = useState<TaskFilter>(status.counts.failed > 0 ? "attention" : "all")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const q = search.trim()
  const open = status.counts.waiting + status.counts.pending + status.counts.running + status.counts.unknown
  const tasks = useSubiektTasks(filter, q, offset, PAGE_SIZE, poll || status.counts.pending + status.counts.running + status.counts.unknown > 0)
  const retry = useSubiektRetry()
  const rows = tasks.data?.tasks ?? []

  useEffect(() => setOffset(0), [filter, q])

  const onRetry = async (task: TaskDto) => {
    try {
      await retry.mutateAsync(task.id)
      toast.success(t("toast.retried"))
      onAction()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Heading level="h2">{t("tasks.title")}</Heading>
          <Text size="small" className="max-w-3xl text-ui-fg-subtle" title={t("tasks.technical")}>
            {t("tasks.subtitle")}
          </Text>
        </div>
        <div className="w-full md:w-56">
          <Input size="small" type="search" placeholder={t("tasks.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="px-6 py-3">
        <FilterPills<TaskFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "attention", label: t("tasks.filters.attention"), count: status.counts.failed },
            { value: "open", label: t("tasks.filters.open"), count: open },
            { value: "done", label: t("tasks.filters.done") },
            { value: "all", label: t("tasks.filters.all") },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>
                <StoreColumn label={t("tasks.columns.order")} hint={t("store.orderMatching")} />
              </Table.HeaderCell>
              <Table.HeaderCell>{t("tasks.columns.operation")}</Table.HeaderCell>
              <Table.HeaderCell>{t("tasks.columns.document")}</Table.HeaderCell>
              <Table.HeaderCell>{t("tasks.columns.status")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("tasks.columns.attempts")}</Table.HeaderCell>
              <Table.HeaderCell>{t("tasks.columns.details")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <Table.Row>
                <td colSpan={7} className="px-6 py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {tasks.isLoading ? "" : t("tasks.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : (
              rows.map((task) => (
                <Table.Row key={task.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-[260px]">
                    <StoreOrderCell orderId={task.orderId} displayId={task.displayId} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {task.kind === "order.document" && (task.documentKind === "fs" || task.documentKind === "pa")
                      ? t(`tasks.documentKinds.${task.documentKind}`)
                      : t(`tasks.kinds.${task.kind}`)}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap font-mono text-xs">{task.documentNumber ?? ""}</Table.Cell>
                  <Table.Cell>
                    <TaskStatusBadge status={task.status} />
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{task.attempts}</Table.Cell>
                  <Table.Cell className="max-w-md">
                    <TaskDetails task={task} lang={lang} />
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    {task.status === "failed" || task.status === "unknown" || (task.status === "pending" && task.attempts > 0) || task.status === "waiting" ? (
                      <Button size="small" variant="secondary" isLoading={retry.isPending && retry.variables === task.id} onClick={() => onRetry(task)}>
                        {task.status === "waiting" ? t("actions.send") : t("actions.retry")}
                      </Button>
                    ) : null}
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pager offset={offset} limit={PAGE_SIZE} count={tasks.data?.count ?? 0} onChange={setOffset} />
    </Container>
  )
}

/* ------------------------------------------------------------------ */

type DocFilter = "all" | "ZK" | "WZ" | "FS" | "PA"

function DocumentsSection({ lang, poll }: { lang: string; poll: boolean }) {
  const { t } = useTranslation("subiekt")
  const [kind, setKind] = useState<DocFilter>("all")
  const [offset, setOffset] = useState(0)
  const docs = useSubiektDocuments(kind, "", offset, PAGE_SIZE, poll)
  const rows = docs.data?.documents ?? []
  useEffect(() => setOffset(0), [kind])

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Heading level="h2">{t("documents.title")}</Heading>
          <Text size="small" className="max-w-3xl text-ui-fg-subtle">
            {t("documents.subtitle")}
          </Text>
        </div>
        <FilterPills<DocFilter>
          value={kind}
          onChange={setKind}
          options={(["all", "ZK", "WZ", "FS", "PA"] as const).map((k) => ({ value: k, label: t(`documents.filters.${k}`) }))}
        />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("documents.columns.number")}</Table.HeaderCell>
              <Table.HeaderCell>
                <StoreColumn label={t("documents.columns.order")} hint={t("store.orderMatching")} />
              </Table.HeaderCell>
              <Table.HeaderCell>{t("documents.columns.issued")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.columns.source")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.columns.ksef")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.columns.status")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <Table.Row>
                <td colSpan={6} className="px-6 py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {docs.isLoading ? "" : t("documents.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : (
              rows.map((d) => (
                <Table.Row key={d.id} className="[&_td]:py-2.5">
                  <Table.Cell className="whitespace-nowrap font-mono text-xs">
                    {d.number}
                    {d.related.length > 0 ? <span className="text-ui-fg-muted"> ← {d.related.map((r) => r.number).join(", ")}</span> : null}
                  </Table.Cell>
                  <Table.Cell className="max-w-[260px]">
                    <StoreOrderCell orderId={d.orderId} displayId={d.displayId} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(d.issuedAt, lang)}</Table.Cell>
                  <Table.Cell>{t(`documents.sources.${d.source}`, { defaultValue: d.source })}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap font-mono text-xs">
                    {d.ksefNumber ? d.ksefNumber : d.kind === "FS" && d.status !== "canceled" ? <span className="font-sans text-ui-fg-muted">{t("documents.ksefWaiting")}</span> : ""}
                  </Table.Cell>
                  <Table.Cell>
                    <DocumentStatusBadge status={d.status} />
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pager offset={offset} limit={PAGE_SIZE} count={docs.data?.count ?? 0} onChange={setOffset} />
    </Container>
  )
}

/* ------------------------------------------------------------------ */

function RunsSection({ lang, poll }: { lang: string; poll: boolean }) {
  const { t } = useTranslation("subiekt")
  const runs = useSubiektRuns(poll)
  const rows = runs.data?.runs ?? []
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("runs.title")}</Heading>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("runs.columns.kind")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.columns.trigger")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.columns.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.columns.message")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.columns.started")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("runs.columns.duration")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <Table.Row>
                <td colSpan={6} className="px-6 py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {runs.isLoading ? "" : t("runs.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5">
                  <Table.Cell className="whitespace-nowrap">{t(`runs.kinds.${r.kind}`)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-ui-fg-subtle">{t(`runs.triggers.${r.trigger}`, { defaultValue: r.trigger })}</Table.Cell>
                  <Table.Cell>
                    <RunStatusBadge status={r.status} />
                  </Table.Cell>
                  <Table.Cell className="max-w-lg">
                    <Text size="small">{runSummary(r, t)}</Text>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.startedAt, lang)}</Table.Cell>
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
  label: "Subiekt nexo",
  icon: SubiektIcon,
})

export default SubiektPage
