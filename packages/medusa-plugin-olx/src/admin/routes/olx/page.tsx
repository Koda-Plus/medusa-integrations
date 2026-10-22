import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  ArrowPath,
  ArrowRightOnRectangle,
  ArrowUpRightMini,
  ArrowUpRightOnBox,
  BuildingStorefront,
  ChartBar,
  Clock,
  ExclamationCircle,
  Globe,
  Hashtag,
  Key,
  ListBullet,
  LockClosedSolid,
  PencilSquare,
  ShieldCheck,
  Tag,
  XCircle,
} from "@medusajs/icons"
import { Button, Container, Copy, InlineTip, Table, Text, clx, toast, usePrompt } from "@medusajs/ui"
import type { OlxAdvertDto, OlxAdvertFilter, OlxAlertKind, OlxRunDto, OlxStatusResponse } from "../../../modules/olx/lib/contract"
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
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, StatTile, StatTiles, ToneBadge, useDebouncedValue, type Tone } from "../../lib/olx-blocks"
import { AddStoreButton, HelpButtons, IntegrationHeader, KeyPoints, ModeBadge, ReferencesBadge, SettingsView, communityLabels, usePageNav, type PageNav } from "../../lib/olx-guide"
import { GuideView, usePromptSpec } from "../../lib/olx-guide-view"
import { OlxIcon } from "../../lib/olx-icon"
import { KitFetchingBar, KitLoading, KitSkeletonRows } from "../../lib/olx-kit"
import { ActivityCounters, AlertsSection, DemoDetails, MessagesSection, PAGE_SIZE, pagination } from "../../lib/olx-panel"
import { AdvertStatus, AlertBadge, MedusaMark, fmtDateTime, fmtDuration, fmtNumber, fmtPrice, fmtRating, kitReferences } from "../../lib/olx-ui"
import { PlansSection, WritersSection } from "../../lib/olx-writers"

/**
 * OLX. Three views, switched in the header and kept in the URL:
 *
 * - Panel: the business side. Counters, the adverts next to the store products
 *   they sell (with a link to each product), then the buyers' messages.
 * - Setup guide (`?view=guide`).
 * - Settings (`?view=settings&tab=`), behind the cog: the technical side.
 *   The OLX account, alerts, writers, their plans and the sync history.
 *
 * Deep links: `?filter=` picks the advert filter (`/olx?filter=unmatched`) and
 * `?q=` searches the adverts (`/olx?q=SKU-1`, from the product card).
 *
 * The demo note and the stores running the integration sit in header badges.
 */
const SETTINGS_TABS = ["account", "alerts", "writers", "plans", "runs"] as const
type SettingsTabId = (typeof SETTINGS_TABS)[number]

const FILTERS: OlxAdvertFilter[] = ["all", "linked", "unmatched", "limited", "ended", "nokey"]

const OlxPage = () => {
  const { t, i18n } = useTranslation("olx")
  const lang = i18n.language || "en"
  const client = useQueryClient()
  const nav = usePageNav(SETTINGS_TABS)
  const [params] = useSearchParams()
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

  const linkFilter = params.get("filter") ?? ""
  const [filter, setFilter] = useState<OlxAdvertFilter>(() => ((FILTERS as string[]).includes(linkFilter) ? (linkFilter as OlxAdvertFilter) : "all"))
  const toggle = (f: OlxAdvertFilter) => setFilter((cur) => (cur === f ? "all" : f))
  const [alertKind, setAlertKind] = useState<OlxAlertKind | "all">("all")

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} loading={status.isLoading} lang={lang} nav={nav} onSyncStarted={() => setPollUntil(Date.now() + 30_000)} />
        {status.isLoading ? <KitLoading label={t("loading")} /> : null}
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label="OLX">
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s && nav.view !== "guide" ? <Warnings status={s} lang={lang} /> : null}
        {s && nav.view === "panel" ? (
          <>
            <div className="flex flex-col">
              <Text size="xsmall" className="px-6 pt-4 text-ui-fg-muted">
                {t("stats.groupAdverts")}
              </Text>
              <StatTiles columns={7}>
                <StatTile label={t("stats.adverts")} value={fmtNumber(s.counts.adverts, lang)} active={filter === "all"} onClick={() => setFilter("all")} />
                <StatTile label={t("stats.live")} value={fmtNumber(s.counts.live, lang)} tone="green" />
                <StatTile label={t("stats.linkedLive")} value={fmtNumber(s.counts.linkedLive, lang)} tone="green" active={filter === "linked"} onClick={() => toggle("linked")} />
                <StatTile
                  label={t("stats.unmatched")}
                  value={fmtNumber(s.counts.unmatchedLive, lang)}
                  tone={s.counts.unmatchedLive > 0 ? "red" : "grey"}
                  active={filter === "unmatched"}
                  onClick={() => toggle("unmatched")}
                />
                <StatTile
                  label={t("stats.limited")}
                  value={fmtNumber(s.counts.limited, lang)}
                  tone={s.counts.limited > 0 ? "orange" : "grey"}
                  active={filter === "limited"}
                  onClick={() => toggle("limited")}
                />
                <StatTile label={t("stats.ended")} value={fmtNumber(s.counts.ended, lang)} active={filter === "ended"} onClick={() => toggle("ended")} />
                <StatTile
                  label={t("stats.noKey")}
                  value={fmtNumber(s.counts.noKey, lang)}
                  tone={s.counts.noKey > 0 ? "orange" : "grey"}
                  active={filter === "nokey"}
                  onClick={() => toggle("nokey")}
                />
              </StatTiles>
            </div>
            <ActivityCounters
              status={s}
              lang={lang}
              onAlert={(kind) => {
                setAlertKind(kind)
                nav.go("settings", "alerts")
              }}
            />
          </>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} lang={lang} /> : null}

      {s && nav.view === "panel" ? (
        <>
          <AdvertsSection status={s} lang={lang} filter={filter} onFilter={setFilter} onToggle={toggle} initialQ={params.get("q") ?? ""} />
          <MessagesSection status={s} lang={lang} />
        </>
      ) : null}

      {s && nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "account", label: t("settings.tab.account") },
            { id: "alerts", label: t("settings.tab.alerts"), badge: Object.values(s.alerts).reduce((sum, n) => sum + n, 0), tone: "orange" },
            { id: "writers", label: t("settings.tab.writers"), badge: s.writers.filter((w) => w.active).length, tone: "orange" },
            { id: "plans", label: t("settings.tab.plans") },
            { id: "runs", label: t("settings.tab.runs") },
          ]}
        >
          {nav.tab === "account" ? <ConnectionSection status={s} lang={lang} /> : null}
          {nav.tab === "alerts" ? <AlertsSection status={s} lang={lang} kind={alertKind} onKind={setAlertKind} /> : null}
          {nav.tab === "writers" ? <WritersSection status={s} lang={lang} /> : null}
          {nav.tab === "plans" ? <PlansSection status={s} lang={lang} /> : null}
          {nav.tab === "runs" ? <RunsSection lang={lang} /> : null}
        </SettingsView>
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
  lang,
  nav,
  onSyncStarted,
}: {
  status: OlxStatusResponse | undefined
  loading: boolean
  lang: string
  nav: PageNav<SettingsTabId>
  onSyncStarted: () => void
}) {
  const { t } = useTranslation("olx")
  const sync = useOlxSync()
  const badge = modeBadge(status)
  const canSync = Boolean(status && (status.mode === "demo" || status.connection.connected))
  const armed = status ? status.writers.filter((w) => w.active).length : 0
  const references = status ? kitReferences(status.references, lang) : []
  const promptSpec = usePromptSpec(status)
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)

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
    <IntegrationHeader
      icon={<OlxIcon width={28} height={28} />}
      title={t("title")}
      badges={
        <>
          {!loading ? (
            <ModeBadge color={badge.color} label={t(badge.key)} title={t("demo.label")}>
              {status?.mode === "demo" ? <DemoDetails status={status} /> : null}
            </ModeBadge>
          ) : null}
          {status ? armed > 0 ? <ToneBadge tone="orange">{t("mode.writing", { count: armed })}</ToneBadge> : <ToneBadge tone="grey">{t("mode.readOnly")}</ToneBadge> : null}
        </>
      }
      description={t("subtitle")}
      points={[
        { icon: <Tag />, text: t("points.link") },
        { icon: <ExclamationCircle />, text: t("points.alerts") },
        { icon: <ChartBar />, text: t("points.stats") },
        { icon: <PencilSquare />, text: t("points.writers"), tone: armed > 0 ? "orange" : "grey" },
        { icon: <LockClosedSolid />, text: t("points.never"), tone: "green" },
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
        nav.view !== "guide"
          ? {
              key: "sync",
              label: status?.running ? t("actions.syncing") : t("actions.sync"),
              icon: <ArrowPath />,
              loading: sync.isPending || Boolean(status?.running),
              disabled: !canSync,
              onClick: () => void onSync(),
            }
          : null
      }
    />
  )
}

/** Only what needs a person now; the demo note lives in the mode badge. */
function Warnings({ status, lang }: { status: OlxStatusResponse; lang: string }) {
  const { t } = useTranslation("olx")
  if (status.mode === "demo") return null
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
    <Section
      icon={<Key />}
      title={t("connection.title")}
      badges={demo ? <ToneBadge tone="purple">{t("mode.demo")}</ToneBadge> : null}
      pointsLabel={t("connection.subtitle", { host: status.marketHost, scope: status.scope.requested })}
      points={[
        { icon: <Globe />, text: status.marketHost },
        { icon: <ShieldCheck />, text: t("connection.points.oauth") },
        { icon: <Key />, text: t("connection.points.scope", { scope: status.scope.requested }) },
        demo && { icon: <XCircle />, text: t("connection.points.demo"), tone: "blue", title: t("connection.demoNote") },
      ]}
      actions={
        !demo ? (
          <>
            <Button size="small" variant="secondary" isLoading={disconnect.isPending} disabled={!c.connected} onClick={() => void onDisconnect()}>
              <XCircle />
              {t("actions.disconnect")}
            </Button>
            <Button size="small" variant={c.connected ? "secondary" : "primary"} isLoading={connect.isPending} disabled={!status.configured} onClick={() => void onConnect()}>
              <ArrowRightOnRectangle />
              {c.connected ? t("actions.reconnect") : status.connecting ? t("actions.openConsent") : t("actions.connect")}
            </Button>
          </>
        ) : null
      }
    >
      <div className="flex flex-col gap-4 px-6 py-4">
        {!demo ? (
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
        ) : null}

        {status.redirectUri ? (
          <div className="flex items-center gap-x-2">
            <Fact label={t("connection.redirectUri")} value={status.redirectUri} mono />
            <Copy content={status.redirectUri} className="mt-4" />
          </div>
        ) : null}
      </div>
      <div className="px-6 py-3">
        <KeyPoints
          label={t("connection.tokensNote")}
          items={[
            { icon: <Clock />, text: t("connection.points.access") },
            { icon: <ArrowPath />, text: t("connection.points.refresh") },
            { icon: <LockClosedSolid />, text: t("connection.points.encrypted"), tone: "green" },
          ]}
        />
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */

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

const FILTER_ICON: Record<OlxAdvertFilter, ReactNode> = {
  all: <ListBullet />,
  linked: <BuildingStorefront />,
  unmatched: <ExclamationCircle />,
  limited: <Clock />,
  ended: <XCircle />,
  nokey: <Hashtag />,
}

/** Filters with something to do get the orange count. */
const FILTER_ATTENTION: Partial<Record<OlxAdvertFilter, true>> = { unmatched: true, limited: true, nokey: true }

function AdvertsSection({
  status,
  lang,
  filter,
  onFilter,
  onToggle,
  initialQ,
}: {
  status: OlxStatusResponse
  lang: string
  filter: OlxAdvertFilter
  onFilter: (f: OlxAdvertFilter) => void
  onToggle: (f: OlxAdvertFilter) => void
  initialQ: string
}) {
  const { t } = useTranslation("olx")
  const [search, setSearch] = useState(initialQ)
  const q = useDebouncedValue(search.trim())
  const [page, setPage] = useState(0)
  const refresh = useOlxStatsRefresh()

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
    <Section
      id="olx-adverts"
      icon={<Tag />}
      title={t("adverts.title")}
      pointsLabel={t("adverts.subtitle")}
      points={[
        { icon: <Clock />, text: t("adverts.points.hourly") },
        { icon: <BuildingStorefront />, text: t("adverts.points.product") },
        status.stats.withStats > 0
          ? { icon: <ChartBar />, text: t("adverts.points.stats", { count: status.stats.withStats, when: fmtDateTime(status.stats.oldestAt, lang) }), title: t("adverts.statsLine", { count: status.stats.withStats, when: fmtDateTime(status.stats.oldestAt, lang) }) }
          : { icon: <ChartBar />, text: t("adverts.statsNone") },
      ]}
      actions={
        <>
          <SearchInput value={search} onChange={setSearch} placeholder={t("adverts.search")} />
          <Button size="small" variant="secondary" className="shrink-0" disabled={!canRefresh} isLoading={refresh.isPending || status.stats.running} onClick={() => void onRefresh()}>
            <ArrowPath />
            {t("actions.refreshStats")}
          </Button>
        </>
      }
    >
      <FilterBar>
        {FILTERS.map((f, i) => (
          <span key={f} className="contents">
            {i === 1 ? <FilterDivider /> : null}
            <FilterButton
              icon={FILTER_ICON[f]}
              label={t(`adverts.filter.${f}`)}
              count={filterCount(status, f)}
              attention={FILTER_ATTENTION[f]}
              active={filter === f}
              onClick={() => (f === "all" ? onFilter("all") : onToggle(f))}
            />
          </span>
        ))}
      </FilterBar>
      <KitFetchingBar active={adverts.isFetching && !adverts.isLoading} />

      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("adverts.col.advert")}</Table.HeaderCell>
              <Table.HeaderCell>{t("adverts.col.status")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("adverts.col.price")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("adverts.col.stats")}</Table.HeaderCell>
              <Table.HeaderCell>
                <span className="inline-flex items-center gap-x-1.5" title={t("adverts.matching")}>
                  <MedusaMark className="h-3.5 w-3.5 text-ui-fg-muted" />
                  {t("adverts.col.product")}
                </span>
              </Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {adverts.isLoading ? (
              <KitSkeletonRows cols={6} rows={5} />
            ) : rows.length === 0 ? (
              <EmptyTableRow cols={6} icon={<Tag />} title={t("adverts.empty")} />
            ) : (
              rows.map((a) => (
                <Table.Row key={a.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-[340px]">
                    <div className="flex flex-col gap-y-1">
                      <span className="txt-compact-small-plus truncate text-ui-fg-base" title={a.title}>
                        {a.title}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">#{a.olxId}</span>
                        {a.isPrimary ? <ToneBadge tone="green">{t("adverts.primary")}</ToneBadge> : null}
                        {a.alert ? <AlertBadge kind={a.alert} /> : null}
                        {a.unread > 0 ? <ToneBadge tone="blue">{t("adverts.unread", { count: a.unread })}</ToneBadge> : null}
                        {a.demo ? <ToneBadge tone="purple">{t("adverts.sample")}</ToneBadge> : null}
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
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="max-w-[300px]">
                    <StoreProductCell advert={a} />
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <RowActions
                      actions={[
                        { key: "product", label: t("adverts.openProduct"), icon: <BuildingStorefront />, href: `/app/products/${a.productId}`, hidden: !a.productId },
                        { key: "olx", label: t("actions.openOlx"), icon: <ArrowUpRightOnBox />, href: a.url, external: true },
                      ]}
                    />
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
        translations={pagination(t)}
      />
    </Section>
  )
}

/** The store side of an advert: its Medusa product, one click away, or why there is none. */
function StoreProductCell({ advert: a }: { advert: OlxAdvertDto }) {
  const { t } = useTranslation("olx")
  const keyTitle = a.matchKey ? `${a.matchKey} (${a.matchSource === "external_id" ? t("adverts.keyExternal") : t("adverts.keyDescription")})` : undefined
  if (a.productId) {
    return (
      <Link to={`/products/${a.productId}`} className="group flex items-center gap-x-2.5" title={t("adverts.openProduct")}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ui-bg-component shadow-borders-base transition-fg group-hover:bg-ui-bg-component-hover">
          <MedusaMark className="h-4 w-4 text-ui-fg-base" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="txt-compact-small-plus truncate text-ui-fg-base group-hover:text-ui-fg-interactive">{a.productTitle ?? a.productId}</span>
          <span className="flex min-w-0 items-center gap-x-1.5">
            <span className="truncate font-mono text-ui-fg-muted txt-compact-xsmall" title={keyTitle}>
              {a.sku ?? a.matchKey}
            </span>
            <ArrowUpRightMini className="shrink-0 text-ui-fg-interactive" />
          </span>
        </span>
      </Link>
    )
  }
  if (a.matchKey) {
    return (
      <div className="flex flex-col items-start gap-y-1">
        <ToneBadge tone="orange">{t("adverts.noProduct")}</ToneBadge>
        <span className="font-mono text-ui-fg-muted txt-compact-xsmall" title={keyTitle}>
          {a.matchKey}
        </span>
      </div>
    )
  }
  return <ToneBadge tone="grey">{t("adverts.noKey")}</ToneBadge>
}

/* ------------------------------------------------------------------ */

const RUN_TONE: Record<OlxRunDto["status"], Tone> = {
  ok: "green",
  partial: "orange",
  error: "red",
}

function RunsSection({ lang }: { lang: string }) {
  const { t } = useTranslation("olx")
  const runs = useOlxRuns()
  const list = useMemo(() => runs.data?.runs ?? [], [runs.data])

  return (
    <Section
      icon={<ArrowPath />}
      title={t("runs.title")}
      pointsLabel={t("runs.subtitle")}
      points={[
        { icon: <Clock />, text: t("runs.points.hourly") },
        { icon: <ArrowPath />, text: t("runs.points.manual") },
      ]}
    >
      <KitFetchingBar active={runs.isFetching && !runs.isLoading} />
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
            {runs.isLoading ? (
              <KitSkeletonRows cols={7} rows={4} />
            ) : list.length === 0 ? (
              <EmptyTableRow cols={7} icon={<ArrowPath />} title={t("runs.empty")} />
            ) : (
              list.map((r) => (
                <Table.Row key={r.id} title={r.message ?? undefined}>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.startedAt, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {t(`runs.source.${r.source}`)}
                    <span className="text-ui-fg-muted"> / {t(`runs.trigger.${r.trigger}`)}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <ToneBadge tone={RUN_TONE[r.status]}>{t(`runs.${r.status}`)}</ToneBadge>
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
    </Section>
  )
}

export const config = defineRouteConfig({
  label: "OLX",
  icon: OlxIcon,
})

export default OlxPage
