import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArchiveBox, ArrowPath } from "@medusajs/icons"
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
import {
  DocumentStatusBadge,
  Field,
  FilterPills,
  ModeBadge,
  OrderLink,
  Pager,
  RunStatusBadge,
  StatTile,
  TaskStatusBadge,
  fmtDateTime,
  fmtDuration,
  fmtNumber,
} from "../../lib/subiekt-ui"

/**
 * Subiekt nexo by Koda Plus: the connection to the bridge, the queue of
 * calls towards Subiekt, the documents it issued and the stock sync.
 */
const PAGE_SIZE = 15

const SubiektPage = () => {
  const { t, i18n } = useTranslation("subiekt")
  const lang = i18n.language || "en"
  const client = useQueryClient()
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
        <Header status={s} onAction={poll} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {errorMessage(status.error)}
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
          <div className="grid grid-cols-2 divide-x divide-y md:grid-cols-3 md:divide-y-0 xl:grid-cols-6">
            <StatTile label={t("stats.sent24h")} value={fmtNumber(s.counts.succeeded24h, lang)} />
            <StatTile label={t("stats.waiting")} value={fmtNumber(s.counts.waiting, lang)} tone={s.counts.waiting ? undefined : "muted"} />
            <StatTile label={t("stats.queue")} value={fmtNumber(s.counts.pending + s.counts.running, lang)} tone={s.counts.pending + s.counts.running ? undefined : "muted"} />
            <StatTile label={t("stats.attention")} value={fmtNumber(s.counts.failed, lang)} tone={s.counts.failed ? "attention" : "muted"} />
            <StatTile label={t("stats.zk")} value={fmtNumber(s.counts.zk, lang)} />
            <StatTile label={t("stats.wz")} value={fmtNumber(s.counts.wz, lang)} />
          </div>
        ) : null}
      </Container>

      {s ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ConnectionSection status={s} lang={lang} />
          <StockSection run={s.lastRuns.stock ?? null} lang={lang} />
        </div>
      ) : null}
      {s ? <TasksSection status={s} lang={lang} poll={polling} onAction={poll} /> : null}
      <DocumentsSection lang={lang} poll={polling} />
      <RunsSection lang={lang} poll={polling} />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Header({ status, onAction }: { status: SubiektStatusResponse | undefined; onAction: () => void }) {
  const { t } = useTranslation("subiekt")
  const sync = useSubiektSync()
  const check = useSubiektCheck()
  const ready = Boolean(status && (status.mode === "demo" || status.configured))
  const running = new Set(status?.running ?? [])

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
    <div className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-start md:justify-between">
      <div className="flex flex-col gap-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <ArchiveBox className="text-ui-fg-subtle" />
          <Heading level="h1">{t("title")}</Heading>
          <Text size="small" className="text-ui-fg-muted">
            {t("by")}
          </Text>
          <ModeBadge status={status} />
        </div>
        <Text size="small" className="text-ui-fg-subtle max-w-2xl">
          {t("subtitle")}
        </Text>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="small" variant="secondary" disabled={!ready} isLoading={check.isPending} onClick={onCheck}>
          {t("actions.check")}
        </Button>
        <Button size="small" variant="secondary" disabled={!ready || running.has("events")} onClick={() => start("events")}>
          {running.has("events") ? t("actions.running") : t("actions.events")}
        </Button>
        <Button size="small" variant="primary" disabled={!ready || running.has("stock")} onClick={() => start("stock")}>
          <ArrowPath />
          {running.has("stock") ? t("actions.running") : t("actions.stock")}
        </Button>
      </div>
    </div>
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
        <ModeBadge status={status} />
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
            <Text size="small">{run.message}</Text>
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

function SampleList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-y-1">
      <Text size="xsmall" className="text-ui-fg-subtle">
        {label}
      </Text>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Badge key={item} size="2xsmall" className="font-mono">
            {item}
          </Badge>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

type TaskFilter = "attention" | "open" | "done" | "all"

function TasksSection({ status, lang, poll, onAction }: { status: SubiektStatusResponse; lang: string; poll: boolean; onAction: () => void }) {
  const { t } = useTranslation("subiekt")
  const [filter, setFilter] = useState<TaskFilter>(status.counts.failed > 0 ? "attention" : "all")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const q = search.trim()
  const tasks = useSubiektTasks(filter, q, offset, PAGE_SIZE, poll || status.counts.pending + status.counts.running > 0)
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
          <Text size="small" className="text-ui-fg-subtle">
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
            { value: "open", label: t("tasks.filters.open"), count: status.counts.waiting + status.counts.pending + status.counts.running },
            { value: "done", label: t("tasks.filters.done") },
            { value: "all", label: t("tasks.filters.all") },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("tasks.columns.order")}</Table.HeaderCell>
              <Table.HeaderCell>{t("tasks.columns.operation")}</Table.HeaderCell>
              <Table.HeaderCell>{t("tasks.columns.status")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("tasks.columns.attempts")}</Table.HeaderCell>
              <Table.HeaderCell>{t("tasks.columns.document")}</Table.HeaderCell>
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
              rows.map((task) => {
                return (
                  <Table.Row key={task.id} className="[&_td]:py-2.5">
                    <Table.Cell>
                      <OrderLink orderId={task.orderId} displayId={task.displayId} />
                    </Table.Cell>
                    <Table.Cell className="whitespace-nowrap">{t(`tasks.kinds.${task.kind}`)}</Table.Cell>
                    <Table.Cell>
                      <TaskStatusBadge status={task.status} />
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">{task.attempts}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap font-mono text-xs">{task.documentNumber ?? ""}</Table.Cell>
                    <Table.Cell className="max-w-md">
                      {task.lastError ? (
                        <Text size="small" className={task.status === "failed" ? "text-ui-tag-red-text" : "text-ui-fg-subtle"}>
                          {task.lastErrorCode ? <span className="font-mono">[{task.lastErrorCode}] </span> : null}
                          {task.lastError}
                        </Text>
                      ) : null}
                      {task.manualAction ? (
                        <Text size="small" className="text-ui-tag-orange-text">
                          {t("tasks.manual")}
                        </Text>
                      ) : null}
                      {task.status === "pending" && task.nextAttemptAt && task.attempts > 0 ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("tasks.nextAttempt", { time: fmtDateTime(task.nextAttemptAt, lang) })}
                        </Text>
                      ) : null}
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      {task.status === "failed" || (task.status === "pending" && task.attempts > 0) || task.status === "waiting" ? (
                        <Button size="small" variant="secondary" isLoading={retry.isPending && retry.variables === task.id} onClick={() => onRetry(task)}>
                          {task.status === "waiting" ? t("actions.send") : t("actions.retry")}
                        </Button>
                      ) : null}
                    </Table.Cell>
                  </Table.Row>
                )
              })
            )}
          </Table.Body>
        </Table>
      </div>
      <Pager offset={offset} limit={PAGE_SIZE} count={tasks.data?.count ?? 0} onChange={setOffset} />
    </Container>
  )
}

/* ------------------------------------------------------------------ */

type DocFilter = "all" | "ZK" | "WZ"

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
          <Text size="small" className="text-ui-fg-subtle">
            {t("documents.subtitle")}
          </Text>
        </div>
        <FilterPills<DocFilter>
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: t("documents.filters.all") },
            { value: "ZK", label: t("documents.filters.ZK") },
            { value: "WZ", label: t("documents.filters.WZ") },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("documents.columns.number")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.columns.order")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.columns.issued")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.columns.source")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.columns.status")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <Table.Row>
                <td colSpan={5} className="px-6 py-6 text-center">
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
                  <Table.Cell>
                    <OrderLink orderId={d.orderId} displayId={d.displayId} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(d.issuedAt, lang)}</Table.Cell>
                  <Table.Cell>{t(`documents.sources.${d.source}`, { defaultValue: d.source })}</Table.Cell>
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
                    <Text size="small">{r.message}</Text>
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
  icon: ArchiveBox,
})

export default SubiektPage
