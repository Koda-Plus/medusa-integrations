import { useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  ArchiveBox,
  ArrowDownTray,
  ArrowLongRight,
  ArrowPath,
  BarsArrowDown,
  Bolt,
  CheckCircle,
  Clock,
  CubeSolid,
  DocumentText,
  ExclamationCircle,
  Link,
  ListBullet,
  LockClosedSolid,
  MagnifyingGlass,
  PaperPlane,
  QueueList,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Tag,
} from "@medusajs/icons"
import { Container, InlineTip, Table, Text, toast } from "@medusajs/ui"
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
import {
  EmptyState,
  EmptyTableRow,
  FilterBar,
  FilterButton,
  FilterDivider,
  RowActions,
  SearchInput,
  Section,
  StatTile,
  StatTiles,
  ToneBadge,
  useDebouncedValue,
} from "../../lib/subiekt-blocks"
import { AddStoreButton, HelpButtons, IntegrationHeader, ModeBadge, ReferencesBadge, SettingsView, communityLabels, usePageNav, type HeaderAction, type PageNav } from "../../lib/subiekt-guide"
import { GuideView, usePromptSpec } from "../../lib/subiekt-guide-view"
import { SubiektIcon } from "../../lib/subiekt-icon"
import { KitSkeletonRows } from "../../lib/subiekt-kit"
import { BridgeSection, ProductsSection, WritersSection } from "../../lib/subiekt-panels"
import {
  ConnectionBadge,
  DocumentStatusBadge,
  Field,
  Pager,
  RunStatusBadge,
  SampleList,
  StoreColumn,
  StoreOrderCell,
  TaskStatusBadge,
  connectionState,
  fmtDateTime,
  fmtDuration,
  fmtNumber,
  fmtRating,
  referencesFor,
  runSummary,
} from "../../lib/subiekt-ui"

/**
 * Subiekt nexo. Three views, switched in the header and kept in the URL:
 *
 * - Panel: the business side. Counters (each a filter of the list below),
 *   the queue of orders on their way to Subiekt and the documents Subiekt
 *   issued, each next to its order in the store, then the products and
 *   prices from Subiekt next to the store products.
 * - Setup guide (`?view=guide`).
 * - Settings (`?view=settings&tab=`): the technical side. The connection,
 *   the bridge diagnostics, the writers, the stock sync and the history.
 *
 * Deep links: `?filter=attention|open|done|all` (the queue) and `?q=1042`
 * (the queue and the documents, by order number), as the order card links.
 */
const PAGE_SIZE = 15

const SETTINGS_TABS = ["connection", "bridge", "writers", "stock", "runs"] as const
type SettingsTabId = (typeof SETTINGS_TABS)[number]

const TASK_FILTERS = ["attention", "open", "done", "all"] as const
type TaskFilter = (typeof TASK_FILTERS)[number]
type DocFilter = "all" | "ZK" | "WZ" | "FS" | "PA"

function scrollToSection(id: string): void {
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }))
}

const SubiektPage = () => {
  const { t, i18n } = useTranslation("subiekt")
  const lang = i18n.language || "en"
  const client = useQueryClient()
  const nav = usePageNav(SETTINGS_TABS)
  const [params] = useSearchParams()
  const [pollUntil, setPollUntil] = useState(0)
  const status = useSubiektStatus(pollUntil)
  const s = status.data
  const polling = (s?.running.length ?? 0) > 0 || Date.now() < pollUntil

  const asked = params.get("filter") ?? ""
  const [taskFilter, setTaskFilter] = useState<TaskFilter | null>((TASK_FILTERS as readonly string[]).includes(asked) ? (asked as TaskFilter) : null)
  const [docKind, setDocKind] = useState<DocFilter>("all")
  const initialQuery = (params.get("q") ?? "").slice(0, 80)
  /* Without a filter in the address: what needs a person first, everything otherwise. */
  const filter: TaskFilter = taskFilter ?? (s && s.counts.failed > 0 ? "attention" : "all")

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
  /* A tile filters the list below it; a second click on the active one clears the filter. */
  const toggleTasks = (f: TaskFilter) => {
    setTaskFilter(filter === f ? "all" : f)
    scrollToSection("subiekt-tasks")
  }
  const toggleDocs = (k: DocFilter) => {
    setDocKind(docKind === k ? "all" : k)
    scrollToSection("subiekt-documents")
  }

  const c = s?.counts
  const queued = c ? c.pending + c.running + c.unknown : 0

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} loading={status.isLoading} fetching={status.isFetching} lang={lang} nav={nav} onAction={poll} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {errorMessage(status.error)}
            </InlineTip>
          </div>
        ) : null}
        {s ? <Warnings status={s} /> : null}
        {c && nav.view === "panel" ? (
          <StatTiles columns={7}>
            <StatTile label={t("stats.sent24h")} value={fmtNumber(c.succeeded24h, lang)} tone={c.succeeded24h ? "green" : "grey"} active={filter === "done"} onClick={() => toggleTasks("done")} />
            <StatTile label={t("stats.waiting")} value={fmtNumber(c.waiting, lang)} hint={c.waiting ? t("stats.hintWaiting") : undefined} />
            <StatTile label={t("stats.queue")} value={fmtNumber(queued, lang)} tone={queued ? "blue" : "grey"} active={filter === "open"} onClick={() => toggleTasks("open")} />
            <StatTile
              label={t("stats.attention")}
              value={fmtNumber(c.failed, lang)}
              tone={c.failed ? "red" : "grey"}
              hint={c.failed ? t("stats.hintAttention") : undefined}
              active={filter === "attention"}
              onClick={() => toggleTasks("attention")}
            />
            <StatTile label={t("stats.zk")} value={fmtNumber(c.zk, lang)} active={docKind === "ZK"} onClick={() => toggleDocs("ZK")} />
            <StatTile label={t("stats.wz")} value={fmtNumber(c.wz, lang)} active={docKind === "WZ"} onClick={() => toggleDocs("WZ")} />
            <StatTile label={t("stats.sales")} value={fmtNumber(c.fs + c.pa, lang)} />
          </StatTiles>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} lang={lang} /> : null}

      {/* The documents table reads its own endpoint, so it shows even when the status failed, as it always did. */}
      {nav.view === "panel" ? (
        <>
          {s ? <TasksSection status={s} lang={lang} poll={polling} onAction={poll} filter={filter} onFilter={setTaskFilter} initialQuery={initialQuery} /> : null}
          <DocumentsSection lang={lang} poll={polling} kind={docKind} onKind={setDocKind} counts={c} initialQuery={initialQuery} />
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
            { id: "stock", label: t("settings.tab.stock"), badge: s?.options.stockDryRun ? t("stock.dryRun") : null, tone: "blue" },
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
  fetching,
  lang,
  nav,
  onAction,
}: {
  status: SubiektStatusResponse | undefined
  loading: boolean
  fetching: boolean
  lang: string
  nav: PageNav<SettingsTabId>
  onAction: () => void
}) {
  const { t } = useTranslation("subiekt")
  const client = useQueryClient()
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

  const panel = nav.view !== "guide"
  const refreshAction: HeaderAction = {
    key: "refresh",
    label: t("actions.refresh"),
    icon: <ArrowPath />,
    loading: fetching && !loading,
    onClick: () => void client.invalidateQueries({ queryKey: subiektKeys.all }),
  }
  /* Checking the bridge stays reachable from the guide too: its steps ask for it. */
  const checkAction: HeaderAction = { key: "check", label: t("actions.check"), icon: <ShieldCheck />, loading: check.isPending, disabled: !ready, onClick: () => void onCheck() }

  return (
    <IntegrationHeader
      icon={<SubiektIcon width={28} height={28} />}
      title={t("title")}
      badges={
        !loading ? (
          <ModeBadge color={state.tone} label={t(`mode.${state.key}`)} title={t("demo.label")}>
            {status?.mode === "demo" ? <span>{t("demo.text")}</span> : null}
          </ModeBadge>
        ) : null
      }
      description={t("subtitle")}
      points={[
        { icon: <ShoppingCart />, text: t("points.orders") },
        { icon: <ArchiveBox />, text: t("points.wz") },
        { icon: <Receipt />, text: t("points.sales") },
        { icon: <CubeSolid />, text: t("points.stock") },
        { icon: <Tag />, text: t("points.prices") },
        { icon: <LockClosedSolid />, text: t("points.safe"), tone: "green" },
      ]}
      social={
        <>
          <ReferencesBadge
            items={references}
            labels={{
              count: (live, soon) =>
                live > 0
                  ? live === 1
                    ? t("references.badgeOne")
                    : t("references.badgeMany", { count: live })
                  : soon === 1
                    ? t("references.badgeSoonOne")
                    : t("references.badgeSoonMany", { count: soon }),
              soonMore: (soon) => t("references.soonMore", { count: soon }),
              soon: t("references.soon"),
              title: t("references.title"),
              subtitle: t("references.subtitle"),
              open: t("references.open"),
              review: t("references.review"),
              rating: (value) => fmtRating(value, lang),
            }}
          />
          <AddStoreButton labels={community.addStore} />
        </>
      }
      help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
      view={nav.view}
      onView={(v) => nav.go(v)}
      labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("settings.title"), more: t("actions.moreActions") }}
      primary={
        panel
          ? {
              key: "stock",
              label: running.has("stock") ? t("actions.running") : t("actions.stock"),
              icon: <CubeSolid />,
              disabled: !ready || running.has("stock"),
              onClick: () => void start("stock"),
            }
          : null
      }
      actions={
        panel
          ? [
              refreshAction,
              {
                key: "events",
                label: running.has("events") ? t("actions.running") : t("actions.events"),
                icon: <ArrowDownTray />,
                disabled: !ready || running.has("events"),
                onClick: () => void start("events"),
              },
              checkAction,
            ]
          : [refreshAction, checkAction]
      }
    />
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
    <Section
      icon={<Link />}
      title={t("connection.title")}
      badges={<ConnectionBadge status={status} />}
      points={[
        { icon: <Clock />, text: t("connection.points.queue") },
        { icon: <Clock />, text: t("connection.points.documents") },
        { icon: <Clock />, text: t("connection.points.stock") },
        { icon: <Clock />, text: t("connection.points.products") },
      ]}
    >
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
    </Section>
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
    <Section
      icon={<CubeSolid />}
      title={t("stock.title")}
      badges={
        <>
          {run?.dryRun ? <ToneBadge tone="blue">{t("stock.dryRun")}</ToneBadge> : null}
          {run ? <RunStatusBadge status={run.status} /> : null}
        </>
      }
      points={[
        { icon: <ArrowLongRight />, text: t("stock.points.direction") },
        { icon: <MagnifyingGlass />, text: t("stock.points.match") },
      ]}
      pointsLabel={t("stock.subtitle")}
    >
      {!run ? (
        <EmptyState icon={<CubeSolid />} title={t("stock.never")} compact />
      ) : (
        <>
          <div className="px-6 py-3">
            <Text size="small">{runSummary(run, t)}</Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              {fmtDateTime(run.startedAt, lang)}, {fmtDuration(run.durationMs)}
            </Text>
          </div>
          {counters.length > 0 ? (
            <StatTiles columns={4}>
              {counters.map(([key, value, warn]) => (
                <StatTile key={key} label={t(`stock.counters.${key}`)} value={fmtNumber(value ?? 0, lang)} tone={warn && value ? "orange" : "grey"} />
              ))}
            </StatTiles>
          ) : null}
          {samples ? (
            <div className="flex flex-col gap-y-3 px-6 py-4">
              {samples.changes && samples.changes.length > 0 ? (
                <SampleList
                  label={t("stock.samples.changes")}
                  items={samples.changes.map((ch) => `${ch.sku ?? "?"}: ${ch.from === null ? "-" : fmtNumber(ch.from, lang)} → ${fmtNumber(ch.to, lang)}`)}
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
    </Section>
  )
}

/* ------------------------------------------------------------------ */

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

function TasksSection({
  status,
  lang,
  poll,
  onAction,
  filter,
  onFilter,
  initialQuery,
}: {
  status: SubiektStatusResponse
  lang: string
  poll: boolean
  onAction: () => void
  filter: TaskFilter
  onFilter: (f: TaskFilter) => void
  initialQuery: string
}) {
  const { t } = useTranslation("subiekt")
  const [search, setSearch] = useState(initialQuery)
  const [offset, setOffset] = useState(0)
  const q = useDebouncedValue(search).trim()
  const c = status.counts
  const open = c.waiting + c.pending + c.running + c.unknown
  const tasks = useSubiektTasks(filter, q, offset, PAGE_SIZE, poll || c.pending + c.running + c.unknown > 0)
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
  const pick = (f: TaskFilter) => onFilter(filter === f && f !== "all" ? "all" : f)

  return (
    <Section
      id="subiekt-tasks"
      icon={<QueueList />}
      title={t("tasks.title")}
      points={[
        { icon: <ListBullet />, text: t("tasks.points.order") },
        { icon: <ArrowPath />, text: t("tasks.points.retries") },
        { icon: <ExclamationCircle />, text: t("tasks.points.failed"), tone: c.failed ? "orange" : "grey" },
      ]}
      pointsLabel={t("tasks.subtitle")}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("tasks.search")} />}
    >
      <FilterBar>
        <FilterButton icon={<ListBullet />} label={t("tasks.filters.all")} active={filter === "all"} onClick={() => pick("all")} />
        <FilterDivider />
        <FilterButton icon={<ExclamationCircle />} label={t("tasks.filters.attention")} count={c.failed} attention active={filter === "attention"} onClick={() => pick("attention")} />
        <FilterButton icon={<Clock />} label={t("tasks.filters.open")} count={open} active={filter === "open"} onClick={() => pick("open")} />
        <FilterButton icon={<CheckCircle />} label={t("tasks.filters.done")} active={filter === "done"} onClick={() => pick("done")} />
      </FilterBar>
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
            {tasks.isLoading ? (
              <KitSkeletonRows cols={7} rows={4} />
            ) : rows.length === 0 ? (
              <EmptyTableRow cols={7} icon={filter === "attention" ? <CheckCircle /> : <QueueList />} title={t(`tasks.emptyBy.${filter}`)} />
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
                  <Table.Cell className="whitespace-nowrap font-mono txt-compact-xsmall">{task.documentNumber ?? ""}</Table.Cell>
                  <Table.Cell>
                    <TaskStatusBadge status={task.status} dot />
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{task.attempts}</Table.Cell>
                  <Table.Cell className="max-w-md">
                    <TaskDetails task={task} lang={lang} />
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <RowActions
                      actions={[
                        {
                          key: "send",
                          label: task.status === "waiting" ? t("actions.send") : t("actions.retry"),
                          icon: task.status === "waiting" ? <PaperPlane /> : <ArrowPath />,
                          loading: retry.isPending && retry.variables === task.id,
                          hidden: !(task.status === "failed" || task.status === "unknown" || (task.status === "pending" && task.attempts > 0) || task.status === "waiting"),
                          onClick: () => void onRetry(task),
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
      <Pager offset={offset} limit={PAGE_SIZE} count={tasks.data?.count ?? 0} onChange={setOffset} />
    </Section>
  )
}

/* ------------------------------------------------------------------ */

const DOC_KINDS: Array<{ kind: Exclude<DocFilter, "all">; icon: ReactNode; count: (c: SubiektStatusResponse["counts"]) => number }> = [
  { kind: "ZK", icon: <ShoppingCart />, count: (c) => c.zk },
  { kind: "WZ", icon: <ArchiveBox />, count: (c) => c.wz },
  { kind: "FS", icon: <DocumentText />, count: (c) => c.fs },
  { kind: "PA", icon: <Receipt />, count: (c) => c.pa },
]

function DocumentsSection({
  lang,
  poll,
  kind,
  onKind,
  counts,
  initialQuery,
}: {
  lang: string
  poll: boolean
  kind: DocFilter
  onKind: (k: DocFilter) => void
  counts: SubiektStatusResponse["counts"] | undefined
  initialQuery: string
}) {
  const { t } = useTranslation("subiekt")
  const [search, setSearch] = useState(initialQuery)
  const q = useDebouncedValue(search).trim()
  const [offset, setOffset] = useState(0)
  const docs = useSubiektDocuments(kind, q, offset, PAGE_SIZE, poll)
  const rows = docs.data?.documents ?? []
  useEffect(() => setOffset(0), [kind, q])

  return (
    <Section
      id="subiekt-documents"
      icon={<DocumentText />}
      title={t("documents.title")}
      points={[
        { icon: <Link />, text: t("documents.points.tag") },
        { icon: <ArchiveBox />, text: t("documents.points.warehouse") },
        { icon: <Receipt />, text: t("documents.points.ksef") },
      ]}
      pointsLabel={t("documents.subtitle")}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("documents.search")} />}
    >
      <FilterBar>
        <FilterButton icon={<ListBullet />} label={t("documents.filters.all")} count={counts?.documents} active={kind === "all"} onClick={() => onKind("all")} />
        <FilterDivider />
        {DOC_KINDS.map((d) => (
          <FilterButton
            key={d.kind}
            icon={d.icon}
            label={t(`documents.filters.${d.kind}`)}
            count={counts ? d.count(counts) : undefined}
            active={kind === d.kind}
            onClick={() => onKind(kind === d.kind ? "all" : d.kind)}
          />
        ))}
      </FilterBar>
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
            {docs.isLoading ? (
              <KitSkeletonRows cols={6} rows={4} />
            ) : rows.length === 0 ? (
              <EmptyTableRow cols={6} icon={<DocumentText />} title={t("documents.empty")} />
            ) : (
              rows.map((d) => (
                <Table.Row key={d.id} className="[&_td]:py-2.5">
                  <Table.Cell className="whitespace-nowrap font-mono txt-compact-xsmall">
                    {d.number}
                    {d.related.length > 0 ? <span className="text-ui-fg-muted"> ← {d.related.map((r) => r.number).join(", ")}</span> : null}
                  </Table.Cell>
                  <Table.Cell className="max-w-[260px]">
                    <StoreOrderCell orderId={d.orderId} displayId={d.displayId} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(d.issuedAt, lang)}</Table.Cell>
                  <Table.Cell>{t(`documents.sources.${d.source}`, { defaultValue: d.source })}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap font-mono txt-compact-xsmall">
                    {d.ksefNumber ? d.ksefNumber : d.kind === "FS" && d.status !== "canceled" ? <span className="font-sans text-ui-fg-muted">{t("documents.ksefWaiting")}</span> : ""}
                  </Table.Cell>
                  <Table.Cell>
                    <DocumentStatusBadge status={d.status} dot />
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pager offset={offset} limit={PAGE_SIZE} count={docs.data?.count ?? 0} onChange={setOffset} />
    </Section>
  )
}

/* ------------------------------------------------------------------ */

function RunsSection({ lang, poll }: { lang: string; poll: boolean }) {
  const { t } = useTranslation("subiekt")
  const runs = useSubiektRuns(poll)
  const rows = runs.data?.runs ?? []
  return (
    <Section
      icon={<Clock />}
      title={t("runs.title")}
      points={[
        { icon: <BarsArrowDown />, text: t("runs.points.newest") },
        { icon: <Bolt />, text: t("runs.points.jobs") },
      ]}
    >
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
            {runs.isLoading ? (
              <KitSkeletonRows cols={6} rows={4} />
            ) : rows.length === 0 ? (
              <EmptyTableRow cols={6} icon={<Clock />} title={t("runs.empty")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5">
                  <Table.Cell className="whitespace-nowrap">{t(`runs.kinds.${r.kind}`)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-ui-fg-subtle">{t(`runs.triggers.${r.trigger}`, { defaultValue: r.trigger })}</Table.Cell>
                  <Table.Cell>
                    <RunStatusBadge status={r.status} dot />
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
    </Section>
  )
}

export const config = defineRouteConfig({
  label: "Subiekt nexo",
  icon: SubiektIcon,
})

export default SubiektPage
