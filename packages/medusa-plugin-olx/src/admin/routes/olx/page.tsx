import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpRightOnBox } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Copy,
  Heading,
  InlineTip,
  Input,
  StatusBadge,
  Table,
  Text,
  clx,
  toast,
  usePrompt,
} from "@medusajs/ui"
import type { OlxAdvertFilter, OlxAlertKind, OlxRunDto, OlxStatusResponse } from "../../../modules/olx/lib/contract"
import {
  errorMessage,
  olxKeys,
  useOlxAdverts,
  useOlxConnect,
  useOlxDisconnect,
  useOlxRuns,
  useOlxStatsRefresh,
  useOlxStatus,
  useOlxSync,
} from "../../lib/olx-api"
import { References, ViewSwitch, usePageView } from "../../lib/olx-guide"
import { GuideView } from "../../lib/olx-guide-view"
import { OlxIcon } from "../../lib/olx-icon"
import { ActivityCounters, AlertsSection, MessagesSection, SimulationNote } from "../../lib/olx-panel"
import {
  AdvertStatus,
  AlertBadge,
  Chip,
  KeyCell,
  StatTile,
  fmtDateTime,
  fmtDuration,
  fmtMonth,
  fmtNumber,
  fmtPrice,
  kitReferences,
} from "../../lib/olx-ui"
import { PlansSection, WritersSection } from "../../lib/olx-writers"

/**
 * OLX by Koda Plus: the Panel (counters, alerts, writers and their plans,
 * the advert snapshot, messages, the connection and the sync history) and the
 * Setup guide, switched in the header and kept in `?view=guide`.
 */
const PAGE_SIZE = 20

const OlxPage = () => {
  const { t, i18n } = useTranslation("olx")
  const lang = i18n.language || "en"
  const client = useQueryClient()
  const [view, setView] = usePageView()
  const [pollUntil, setPollUntil] = useState(0)
  const status = useOlxStatus(pollUntil)
  const s = status.data

  /* A finished run refreshes the tables. */
  const lastRunId = s?.lastRun?.id
  const planned = s?.plan.plannedAt
  const writerRuns = s?.writers.map((w) => `${w.lastRun?.id ?? ""}${w.lastDryRun?.id ?? ""}`).join("|")
  const seen = useRef<string | undefined>(undefined)
  useEffect(() => {
    const marker = `${lastRunId ?? ""}|${planned ?? ""}|${writerRuns ?? ""}|${s?.messages.lastReadAt ?? ""}|${s?.stats.lastRunAt ?? ""}`
    if (seen.current && seen.current !== marker) void client.invalidateQueries({ queryKey: olxKeys.all })
    seen.current = marker
  }, [lastRunId, planned, writerRuns, s?.messages.lastReadAt, s?.stats.lastRunAt, client])

  /* A connection that completes while we wait gets one toast. */
  const wasConnecting = useRef(false)
  useEffect(() => {
    if (s?.connecting) wasConnecting.current = true
    else if (wasConnecting.current && s?.connection.connected) {
      wasConnecting.current = false
      toast.success(t("toast.connected"))
    }
  }, [s?.connecting, s?.connection.connected, t])

  const [filter, setFilter] = useState<OlxAdvertFilter>("all")
  const [alertKind, setAlertKind] = useState<OlxAlertKind | "all">("all")

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} loading={status.isLoading} view={view} onView={setView} onSyncStarted={() => setPollUntil(Date.now() + 30_000)} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label="OLX">
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s && view === "panel" ? <Tips status={s} lang={lang} /> : null}
        {s && view === "panel" ? (
          <>
            <div className="flex flex-col gap-y-2 px-6 py-4">
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("stats.groupAdverts")}
              </Text>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                <StatTile label={t("stats.adverts")} value={s.counts.adverts} active={filter === "all"} onClick={() => setFilter("all")} />
                <StatTile label={t("stats.live")} value={s.counts.live} tone="green" />
                <StatTile label={t("stats.linkedLive")} value={s.counts.linkedLive} tone="green" active={filter === "linked"} onClick={() => setFilter("linked")} />
                <StatTile label={t("stats.unmatched")} value={s.counts.unmatchedLive} tone="red" active={filter === "unmatched"} onClick={() => setFilter("unmatched")} />
                <StatTile label={t("stats.limited")} value={s.counts.limited} tone="orange" active={filter === "limited"} onClick={() => setFilter("limited")} />
                <StatTile label={t("stats.ended")} value={s.counts.ended} active={filter === "ended"} onClick={() => setFilter("ended")} />
                <StatTile label={t("stats.noKey")} value={s.counts.noKey} active={filter === "nokey"} onClick={() => setFilter("nokey")} />
              </div>
            </div>
            <ActivityCounters status={s} lang={lang} onAlert={setAlertKind} />
          </>
        ) : null}
      </Container>

      {s && view === "guide" ? <GuideView status={s} lang={lang} /> : null}

      {s && view === "panel" ? (
        <>
          <References
            items={kitReferences(s.references, lang)}
            title={t("references.title")}
            subtitle={t("references.subtitle")}
            openLabel={t("references.open")}
            sinceLabel={(since) => t("references.since", { date: fmtMonth(since, lang) })}
          />
          <ConnectionSection status={s} lang={lang} />
          <AlertsSection status={s} lang={lang} kind={alertKind} onKind={setAlertKind} />
          <WritersSection status={s} lang={lang} />
          <PlansSection status={s} lang={lang} />
          <AdvertsSection status={s} lang={lang} filter={filter} onFilter={setFilter} />
          <MessagesSection status={s} lang={lang} />
          <RunsSection lang={lang} />
        </>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function modeBadge(s: OlxStatusResponse | undefined): { color: "green" | "orange" | "blue" | "grey" | "purple"; key: string } {
  if (!s) return { color: "grey", key: "mode.notConnected" }
  if (s.mode === "demo") return { color: "purple", key: "mode.demo" }
  if (!s.configured) return { color: "orange", key: "mode.notConfigured" }
  if (s.connection.connected) return { color: "green", key: "mode.connected" }
  if (s.connecting) return { color: "blue", key: "mode.waiting" }
  return { color: "grey", key: "mode.notConnected" }
}

function Header({
  status,
  loading,
  view,
  onView,
  onSyncStarted,
}: {
  status: OlxStatusResponse | undefined
  loading: boolean
  view: "panel" | "guide"
  onView: (v: "panel" | "guide") => void
  onSyncStarted: () => void
}) {
  const { t } = useTranslation("olx")
  const sync = useOlxSync()
  const badge = modeBadge(status)
  const canSync = Boolean(status && (status.mode === "demo" || status.connection.connected))
  const armed = status ? status.writers.filter((w) => w.active).length : 0

  const onSync = async () => {
    try {
      const r = await sync.mutateAsync()
      if (r.alreadyRunning) toast.info(t("toast.syncRunning"))
      else toast.success(t("toast.syncStarted"))
      onSyncStarted()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <OlxIcon width={24} height={24} className="shrink-0" />
          <Heading level="h1">{t("title")}</Heading>
          <Badge size="2xsmall" color="grey">
            {t("by")}
          </Badge>
          {!loading ? <StatusBadge color={badge.color}>{t(badge.key)}</StatusBadge> : null}
          {status ? (
            armed > 0 ? (
              <Badge size="2xsmall" color="orange">
                {t("mode.writing", { count: armed })}
              </Badge>
            ) : (
              <Badge size="2xsmall" color="grey">
                {t("mode.readOnly")}
              </Badge>
            )
          ) : null}
        </div>
        <Text size="small" className="mt-1 max-w-3xl text-ui-fg-subtle">
          {t("subtitle")}
        </Text>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <ViewSwitch value={view} onChange={onView} labels={{ panel: t("view.panel"), guide: t("view.guide") }} />
        {view === "panel" ? (
          <Button size="small" variant="primary" isLoading={sync.isPending || Boolean(status?.running)} disabled={!canSync} onClick={() => void onSync()}>
            <ArrowPath />
            {status?.running ? t("actions.syncing") : t("actions.sync")}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function Tips({ status, lang }: { status: OlxStatusResponse; lang: string }) {
  const { t } = useTranslation("olx")
  if (status.mode === "demo") return <SimulationNote status={status} />
  if (!status.configured) {
    return (
      <div className="px-6 py-4">
        <InlineTip variant="warning" label={t("missing.label")}>
          {t("missing.text", {
            missing: status.missing.join(", "),
            host: status.marketHost,
            redirect: status.redirectUri ?? t("missing.redirectFallback"),
          })}
        </InlineTip>
      </div>
    )
  }
  if (status.ipBlockedUntil) {
    return (
      <div className="px-6 py-4">
        <InlineTip variant="warning" label="OLX">
          {t("connection.ipBlocked", { time: fmtDateTime(status.ipBlockedUntil, lang) })}
        </InlineTip>
      </div>
    )
  }
  return null
}

/* ------------------------------------------------------------------ */

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-y-0.5">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <Text size="small" className={clx("text-ui-fg-base", mono && "font-mono break-all")}>
        {value}
      </Text>
    </div>
  )
}

function ConnectionSection({ status, lang }: { status: OlxStatusResponse; lang: string }) {
  const { t } = useTranslation("olx")
  const prompt = usePrompt()
  const connect = useOlxConnect()
  const disconnect = useOlxDisconnect()
  const c = status.connection
  const demo = status.mode === "demo"
  const anyAllowed = Object.values(status.settings.writersAllowed).some(Boolean)

  const onConnect = async () => {
    try {
      const r = await connect.mutateAsync()
      if (r.connecting?.url) window.open(r.connecting.url, "_blank", "noopener")
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onDisconnect = async () => {
    const ok = await prompt({
      title: t("disconnect.title"),
      description: t("disconnect.description"),
      confirmText: t("disconnect.confirm"),
      cancelText: t("disconnect.cancel"),
    })
    if (!ok) return
    try {
      await disconnect.mutateAsync()
      toast.success(t("toast.disconnected"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("connection.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("connection.subtitle", { host: status.marketHost, scope: status.scope.requested })}
        </Text>
      </div>

      <div className="flex flex-col gap-4 px-6 py-4">
        {demo ? (
          <Text size="small" className="text-ui-fg-subtle">
            {t("connection.demoNote")}
          </Text>
        ) : (
          <>
            {status.connecting ? (
              <InlineTip variant="info" label={t("connection.waitingLabel")}>
                <span className="flex flex-col gap-y-2">
                  <span>{t("connection.waitingText")}</span>
                  <a href={status.connecting.url} target="_blank" rel="noreferrer" className="break-all font-mono text-xs underline">
                    {status.connecting.url}
                  </a>
                  <span className="text-ui-fg-muted">{t("connection.waitingUntil", { time: fmtDateTime(status.connecting.expiresAt, lang) })}</span>
                </span>
              </InlineTip>
            ) : null}
            {c.lastError ? (
              <InlineTip variant="error" label={t("connection.lastError")}>
                {c.lastError}
                {c.lastErrorAt ? ` (${fmtDateTime(c.lastErrorAt, lang)})` : ""}
              </InlineTip>
            ) : null}
            {c.connected && anyAllowed && !status.scope.writeGranted ? (
              <InlineTip variant="warning" label={t("connection.scope")}>
                {t("connection.scopeHint")}
              </InlineTip>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <Fact label={t("connection.connectedAt")} value={fmtDateTime(c.connectedAt, lang) || t("connection.never")} />
              <Fact label={t("connection.refreshedAt")} value={fmtDateTime(c.refreshedAt, lang) || t("connection.never")} />
              <Fact label={t("connection.expiresAt")} value={fmtDateTime(c.accessExpiresAt, lang) || t("connection.none")} />
              <Fact
                label={t("connection.scope")}
                value={c.scope ? `${c.scope} (${status.scope.writeGranted ? t("connection.scopeWrite") : t("connection.scopeRead")})` : t("connection.none")}
              />
            </div>
          </>
        )}

        {status.redirectUri ? (
          <div className="flex items-center gap-x-2">
            <Fact label={t("connection.redirectUri")} value={status.redirectUri} mono />
            <Copy content={status.redirectUri} className="mt-4" />
          </div>
        ) : null}

        {!demo ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="small" variant={c.connected ? "secondary" : "primary"} isLoading={connect.isPending} disabled={!status.configured} onClick={() => void onConnect()}>
              {c.connected ? t("actions.reconnect") : status.connecting ? t("actions.openConsent") : t("actions.connect")}
            </Button>
            <Button size="small" variant="secondary" isLoading={disconnect.isPending} disabled={!c.connected} onClick={() => void onDisconnect()}>
              {t("actions.disconnect")}
            </Button>
          </div>
        ) : null}

        <Text size="xsmall" className="text-ui-fg-muted">
          {t("connection.tokensNote")}
        </Text>
      </div>
    </Container>
  )
}

/* ------------------------------------------------------------------ */

const FILTERS: OlxAdvertFilter[] = ["all", "linked", "unmatched", "limited", "ended", "nokey"]

function filterCount(status: OlxStatusResponse, f: OlxAdvertFilter): number {
  const c = status.counts
  switch (f) {
    case "all":
      return c.adverts
    case "linked":
      return c.linked
    case "unmatched":
      return c.unmatchedLive
    case "limited":
      return c.limited
    case "ended":
      return c.ended
    case "nokey":
      return c.noKey
  }
}

function AdvertsSection({
  status,
  lang,
  filter,
  onFilter,
}: {
  status: OlxStatusResponse
  lang: string
  filter: OlxAdvertFilter
  onFilter: (f: OlxAdvertFilter) => void
}) {
  const { t } = useTranslation("olx")
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(0)
  const refresh = useOlxStatsRefresh()

  useEffect(() => {
    const id = window.setTimeout(() => setQ(search.trim()), 300)
    return () => window.clearTimeout(id)
  }, [search])
  useEffect(() => setPage(0), [filter, q])

  const adverts = useOlxAdverts(filter, q, page * PAGE_SIZE, PAGE_SIZE)
  const rows = adverts.data?.adverts ?? []
  const count = adverts.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const canRefresh = status.stats.enabled && (status.mode === "demo" || status.connection.connected)

  const onRefresh = async () => {
    try {
      const r = await refresh.mutateAsync()
      toast.info(r.alreadyRunning ? t("toast.alreadyRunning") : t("toast.statsStarted"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Container className="divide-y p-0" id="olx-adverts">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <Heading level="h2">{t("adverts.title")}</Heading>
          <Text size="small" className="max-w-3xl text-ui-fg-subtle">
            {t("adverts.subtitle")}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {status.stats.withStats > 0
              ? t("adverts.statsLine", { count: status.stats.withStats, when: fmtDateTime(status.stats.oldestAt, lang) })
              : t("adverts.statsNone")}
          </Text>
        </div>
        <Button size="small" variant="secondary" className="shrink-0" disabled={!canRefresh} isLoading={refresh.isPending || status.stats.running} onClick={() => void onRefresh()}>
          <ArrowPath />
          {t("actions.refreshStats")}
        </Button>
      </div>

      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Chip key={f} active={filter === f} label={t(`adverts.filter.${f}`)} count={filterCount(status, f)} onClick={() => onFilter(f)} />
          ))}
        </div>
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("adverts.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("adverts.col.advert")}</Table.HeaderCell>
              <Table.HeaderCell>{t("adverts.col.status")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("adverts.col.price")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("adverts.col.stats")}</Table.HeaderCell>
              <Table.HeaderCell>{t("adverts.col.key")}</Table.HeaderCell>
              <Table.HeaderCell>{t("adverts.col.product")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <Table.Row>
                <td colSpan={6} className="py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {adverts.isLoading ? "" : t("adverts.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : (
              rows.map((a) => (
                <Table.Row key={a.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-[340px]">
                    <div className="flex flex-col gap-y-1">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="txt-compact-small-plus inline-flex items-center gap-x-1 text-ui-fg-base hover:text-ui-fg-interactive"
                        title={t("actions.openOlx")}
                      >
                        <span className="truncate">{a.title}</span>
                        <ArrowUpRightOnBox className="shrink-0 text-ui-fg-muted" />
                      </a>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">#{a.olxId}</span>
                        {a.isPrimary ? (
                          <Badge size="2xsmall" color="green">
                            {t("adverts.primary")}
                          </Badge>
                        ) : null}
                        {a.alert ? <AlertBadge kind={a.alert} /> : null}
                        {a.unread > 0 ? (
                          <Badge size="2xsmall" color="blue">
                            {t("adverts.unread", { count: a.unread })}
                          </Badge>
                        ) : null}
                        {a.demo ? (
                          <Badge size="2xsmall" color="purple">
                            {t("adverts.sample")}
                          </Badge>
                        ) : null}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <AdvertStatus advert={a} />
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{fmtPrice(a.price, lang)}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {a.stats ? (
                      <span
                        title={t("adverts.statsTitle", {
                          views: a.stats.views ?? 0,
                          phone: a.stats.phoneViews ?? 0,
                          observers: a.stats.observers ?? 0,
                          when: fmtDateTime(a.stats.at, lang),
                        })}
                        className="txt-compact-small whitespace-nowrap"
                      >
                        {fmtNumber(a.stats.views ?? 0, lang)}
                        <span className="text-ui-fg-muted"> / {a.stats.phoneViews ?? 0} / {a.stats.observers ?? 0}</span>
                      </span>
                    ) : (
                      <span className="text-ui-fg-muted">&nbsp;</span>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <KeyCell advert={a} />
                  </Table.Cell>
                  <Table.Cell className="max-w-[260px]">
                    {a.productId ? (
                      <Link to={`/products/${a.productId}`} className="flex flex-col gap-y-0.5 hover:text-ui-fg-interactive">
                        <span className="txt-compact-small-plus truncate text-ui-fg-base">{a.productTitle ?? a.productId}</span>
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{a.sku}</span>
                      </Link>
                    ) : (
                      <Text size="small" className="text-ui-fg-muted">
                        {a.matchKey ? t("adverts.noProduct") : ""}
                      </Text>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Table.Pagination
        count={count}
        pageSize={PAGE_SIZE}
        pageIndex={page}
        pageCount={pageCount}
        canPreviousPage={page > 0}
        canNextPage={page + 1 < pageCount}
        previousPage={() => setPage((p) => Math.max(0, p - 1))}
        nextPage={() => setPage((p) => p + 1)}
        translations={{
          of: t("pagination.of"),
          results: t("pagination.results"),
          pages: t("pagination.pages"),
          prev: t("pagination.prev"),
          next: t("pagination.next"),
        }}
      />
    </Container>
  )
}

/* ------------------------------------------------------------------ */

const RUN_COLOR: Record<OlxRunDto["status"], "green" | "orange" | "red"> = {
  ok: "green",
  partial: "orange",
  error: "red",
}

function RunsSection({ lang }: { lang: string }) {
  const { t } = useTranslation("olx")
  const runs = useOlxRuns()
  const list = useMemo(() => runs.data?.runs ?? [], [runs.data])

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
              <Table.HeaderCell>{t("runs.col.source")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.result")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("runs.col.adverts")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("runs.col.linked")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.changes")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("runs.col.duration")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.length === 0 ? (
              <Table.Row>
                <td colSpan={7} className="py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {runs.isLoading ? "" : t("runs.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : (
              list.map((r) => (
                <Table.Row key={r.id} title={r.message ?? undefined}>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.startedAt, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {t(`runs.source.${r.source}`)}
                    <span className="text-ui-fg-muted"> / {t(`runs.trigger.${r.trigger}`)}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge color={RUN_COLOR[r.status]}>{t(`runs.${r.status}`)}</StatusBadge>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{r.adverts}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{r.linkedLive}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{t("runs.changes", { created: r.created, updated: r.updated, removed: r.removed })}</Table.Cell>
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
  label: "OLX",
  icon: OlxIcon,
})

export default OlxPage
