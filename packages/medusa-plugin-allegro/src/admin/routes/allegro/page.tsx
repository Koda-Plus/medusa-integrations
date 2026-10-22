import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  ArchiveBox,
  ArrowPath,
  ArrowUpRightOnBox,
  Beaker,
  CheckCircle,
  Clock,
  CloudArrowDown,
  DocumentText,
  ExclamationCircle,
  History,
  Key,
  Link as LinkIcon,
  ListBullet,
  LockClosedSolid,
  MinusCircle,
  PauseSolid,
  PencilSquare,
  ShieldCheck,
  ShoppingCart,
  Tag,
  TruckFast,
  User,
  XCircle,
} from "@medusajs/icons"
import { Button, Container, Copy, InlineTip, Table, Text, clx, toast, usePrompt } from "@medusajs/ui"
import type {
  AllegroImportFilter,
  AllegroIssueFilter,
  AllegroOfferDto,
  AllegroOfferFilter,
  AllegroOrderDto,
  AllegroOrderFilter,
  AllegroOrderLineDto,
  AllegroRunDto,
  AllegroStatusResponse,
} from "../../../modules/allegro/lib/contract"
import {
  allegroKeys,
  errorMessage,
  pollAllegroConnect,
  useAllegroConnect,
  useAllegroDemoSeed,
  useAllegroDisconnect,
  useAllegroOffers,
  useAllegroOrders,
  useAllegroRuns,
  useAllegroStatus,
  useAllegroSync,
} from "../../lib/allegro-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, SearchInput, Section, StatTile, StatTiles, ToneBadge, type Tone } from "../../lib/allegro-blocks"
import { AddStoreButton, HelpButtons, IntegrationHeader, ModeBadge, ReferencesBadge, SettingsView, communityLabels, usePageNav, type PageNav } from "../../lib/allegro-guide"
import { GuideView, referencesFor, usePromptSpec } from "../../lib/allegro-guide-view"
import { AllegroIcon } from "../../lib/allegro-icon"
import { ImportsSection } from "../../lib/allegro-imports"
import { IssuesSection } from "../../lib/allegro-issues"
import { KitFetchingBar, KitSkeletonRows } from "../../lib/allegro-kit"
import { deepLinkOf } from "../../lib/allegro-links"
import { OutboxSection } from "../../lib/allegro-outbox"
import { PlanSection } from "../../lib/allegro-plans"
import {
  IMPORT_TONE,
  ImportWhy,
  NoProduct,
  OfferStatus,
  OrderLink,
  OrderStatus,
  Pager,
  ProductLink,
  StockCell,
  StoreColumn,
  fmtDateTime,
  fmtDuration,
  fmtMoney,
  fmtRating,
  scrollToSection,
  useDebounced,
  useProductThumbs,
} from "../../lib/allegro-ui"
import { WritersSection } from "../../lib/allegro-writers"

/**
 * Allegro by Koda Plus. Three views, switched in the header and kept in the URL:
 *
 * - Panel: the business side. Counters, the offers next to the store products
 *   they sell, the Allegro orders and their imports next to the store orders
 *   they became, then the returns and disputes waiting for a reply.
 * - Setup guide (`?view=guide`).
 * - Settings (`?view=settings&tab=`), behind the cog: the technical side.
 *   The Allegro account, the writers, their plans, parcels and invoices sent
 *   to Allegro and the sync history.
 *
 * The demo note and the stores running the integration sit in header badges.
 */
const PAGE_SIZE = 20
const ORDERS_PAGE_SIZE = 10

const SETTINGS_TABS = ["account", "writers", "imports", "plans", "outbox", "runs"] as const
type SettingsTabId = (typeof SETTINGS_TABS)[number]

const AllegroPage = () => {
  const { t, i18n } = useTranslation("allegro")
  const lang = i18n.language || "en"
  const client = useQueryClient()
  const nav = usePageNav(SETTINGS_TABS)
  const [pollUntil, setPollUntil] = useState(0)
  const status = useAllegroStatus(pollUntil)
  const s = status.data

  /* A finished run refreshes the tables. */
  const runKey = s ? Object.values(s.lastRuns).map((r) => r?.id ?? "").join("|") : ""
  const seenRuns = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (seenRuns.current && seenRuns.current !== runKey) void client.invalidateQueries({ queryKey: allegroKeys.all })
    seenRuns.current = runKey
  }, [runKey, client])

  const [filter, setFilterState] = useState<AllegroOfferFilter>("all")
  const [orderFilter, setOrderFilterState] = useState<AllegroOrderFilter>("all")
  const [importFilter, setImportFilterState] = useState<AllegroImportFilter>("all")
  const [issueFilter, setIssueFilterState] = useState<AllegroIssueFilter>("open")
  const poll = () => setPollUntil(Date.now() + 30_000)

  /* Deep links (?filter=, ?q=, ?list=) from counters, summaries and cards: the list, its filter and its search. */
  const [params, setParams] = useSearchParams()
  const link = deepLinkOf(params)
  const linkKey = link ? `${link.list}|${link.filter}|${link.q}` : ""
  const [queries, setQueries] = useState<{ offers: string; orders: string; imports: string }>({ offers: "", orders: "", imports: "" })
  const [scrollTo, setScrollTo] = useState<string | null>(null)
  useEffect(() => {
    if (!link) return
    if (link.list === "imports") {
      setImportFilterState(link.filter)
      setQueries((q) => ({ ...q, imports: link.q }))
      if (nav.view !== "settings" || nav.tab !== "imports") nav.go("settings", "imports")
      setScrollTo("allegro-imports")
      return
    }
    if (nav.view !== "panel") nav.go("panel")
    if (link.list === "offers") {
      setFilterState(link.filter)
      setQueries((q) => ({ ...q, offers: link.q }))
      setScrollTo("allegro-offers")
    } else if (link.list === "orders") {
      setOrderFilterState(link.filter)
      setQueries((q) => ({ ...q, orders: link.q }))
      setScrollTo("allegro-orders")
    } else {
      setIssueFilterState(link.filter)
      setScrollTo("allegro-issues")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey])
  useEffect(() => {
    if (!scrollTo || !s) return
    const id = scrollTo
    setScrollTo(null)
    /* After the list rendered with its filter. */
    window.setTimeout(() => scrollToSection(id), 100)
  }, [scrollTo, s])

  /* A filter picked by hand drops the deep link, so the address never says something else than the page. */
  const dropLink = () => {
    if (!params.has("filter") && !params.has("q") && !params.has("list")) return
    const p = new URLSearchParams(params)
    p.delete("filter")
    p.delete("q")
    p.delete("list")
    setParams(p, { replace: true })
  }
  const setFilter = (f: AllegroOfferFilter) => {
    dropLink()
    setFilterState(f)
  }
  /* A second click on the active offer filter goes back to all offers. */
  const toggleOffers = (f: AllegroOfferFilter) => setFilter(filter === f ? "all" : f)
  const setOrderFilter = (f: AllegroOrderFilter) => {
    dropLink()
    setOrderFilterState(f)
  }
  const setImportFilter = (f: AllegroImportFilter) => {
    dropLink()
    setImportFilterState(f)
  }
  const setIssueFilter = (f: AllegroIssueFilter) => {
    dropLink()
    setIssueFilterState(f)
  }

  /* A jump from the panel into Settings also brings the tabs into view, wherever the panel was scrolled. */
  const openSettings = (tab: SettingsTabId) => {
    nav.go("settings", tab)
    scrollToSection("allegro-top")
  }

  /* Imported and held orders open the order list; without the order journal, the import log in Settings. */
  const openImports = (f: "imported" | "held") => {
    if (s?.ordersEnabled) {
      setOrderFilter(f)
      scrollToSection("allegro-orders")
    } else {
      setImportFilter(f)
      openSettings("imports")
    }
  }
  const importsActive = (f: "imported" | "held") => (s?.ordersEnabled ? orderFilter === f : importFilter === f)

  const outboxOpen = s ? s.outbox.shipping.pending + s.outbox.shipping.failed + s.outbox.invoices.pending + s.outbox.invoices.failed : 0
  const outboxFailed = s ? s.outbox.shipping.failed + s.outbox.invoices.failed : 0

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0" id="allegro-top">
        <Header status={s} loading={status.isLoading} fetching={status.isFetching && !status.isLoading} onReload={() => void client.invalidateQueries({ queryKey: allegroKeys.all })} lang={lang} nav={nav} onSyncStarted={poll} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label="Allegro">
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s && nav.view !== "guide" ? <Warnings status={s} /> : null}
        {s && nav.view !== "guide" ? <DemoSeedNotice status={s} onStarted={poll} /> : null}
        {s && nav.view === "panel" ? (
          /* One block with two labelled groups: a second block would get the container's divider glued to its tiles. */
          <div className="flex flex-col">
            <Text size="xsmall" className="px-6 pt-4 text-ui-fg-muted">
              {t("stats.groupOffers")}
            </Text>
            <StatTiles columns={7} className="pt-2">
              <StatTile label={t("stats.offers")} value={s.counts.offers} icon={<Tag />} active={filter === "all"} onClick={() => setFilter("all")} />
              <StatTile label={t("stats.live")} value={s.counts.live} tone="green" />
              <StatTile label={t("stats.linkedLive")} value={s.counts.linkedLive} tone="green" active={filter === "linked"} onClick={() => toggleOffers("linked")} />
              <StatTile label={t("stats.stockIssues")} value={s.counts.stockIssues} tone={s.counts.stockIssues > 0 ? "red" : "grey"} active={filter === "stock"} onClick={() => toggleOffers("stock")} />
              <StatTile
                label={t("stats.endedInStock")}
                value={s.counts.endedInStock}
                tone={s.counts.endedInStock > 0 ? "orange" : "grey"}
                active={filter === "ended_in_stock"}
                onClick={() => toggleOffers("ended_in_stock")}
              />
              <StatTile label={t("stats.unmatched")} value={s.counts.unmatchedLive} tone={s.counts.unmatchedLive > 0 ? "orange" : "grey"} active={filter === "unmatched"} onClick={() => toggleOffers("unmatched")} />
              <StatTile label={t("stats.noKey")} value={s.counts.noKey} active={filter === "nokey"} onClick={() => toggleOffers("nokey")} />
            </StatTiles>
            <Text size="xsmall" className="px-6 pt-2 text-ui-fg-muted">
              {t("stats.groupOrders")}
            </Text>
            <StatTiles columns={5} className="pt-2">
              <StatTile
                label={t("stats.ordersOpen")}
                value={s.counts.ordersOpen}
                icon={<ShoppingCart />}
                tone={s.counts.ordersOpen > 0 ? "blue" : "grey"}
                active={s.ordersEnabled && orderFilter === "open"}
                onClick={
                  s.ordersEnabled
                    ? () => {
                        setOrderFilter(orderFilter === "open" ? "all" : "open")
                        scrollToSection("allegro-orders")
                      }
                    : undefined
                }
              />
              <StatTile label={t("stats.imported")} value={s.imports.imported} tone="green" active={importsActive("imported")} onClick={() => openImports("imported")} />
              <StatTile label={t("stats.held")} value={s.imports.held} tone={s.imports.held > 0 ? "orange" : "grey"} active={importsActive("held")} onClick={() => openImports("held")} />
              <StatTile
                label={t("stats.outbox")}
                value={s.outbox.shipping.pending + s.outbox.invoices.pending}
                tone={outboxFailed > 0 ? "red" : outboxOpen > 0 ? "blue" : "grey"}
                onClick={() => openSettings("outbox")}
              />
              <StatTile
                label={t("stats.issues")}
                value={s.issues.needReply}
                tone={s.issues.needReply > 0 ? "orange" : "grey"}
                active={issueFilter === "needs_reply"}
                onClick={() => {
                  setIssueFilter(issueFilter === "needs_reply" ? "open" : "needs_reply")
                  scrollToSection("allegro-issues")
                }}
              />
            </StatTiles>
          </div>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} lang={lang} /> : null}

      {s && nav.view === "panel" ? (
        <>
          <OffersSection key={`offers:${queries.offers}`} initialQuery={queries.offers} status={s} lang={lang} filter={filter} onFilter={setFilter} />
          {s.ordersEnabled ? (
            <OrdersSection key={`orders:${queries.orders}`} initialQuery={queries.orders} status={s} lang={lang} filter={orderFilter} onFilter={setOrderFilter} />
          ) : null}
          <IssuesSection status={s} lang={lang} filter={issueFilter} onFilter={setIssueFilter} />
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
            { id: "writers", label: t("settings.tab.writers"), badge: s.writers.filter((w) => w.effective).length, tone: "orange" },
            { id: "imports", label: t("settings.tab.imports"), badge: s.imports.held, tone: "red" },
            { id: "plans", label: t("settings.tab.plans") },
            { id: "outbox", label: t("settings.tab.outbox"), badge: outboxOpen, tone: outboxFailed > 0 ? "red" : "blue" },
            { id: "runs", label: t("settings.tab.runs") },
          ]}
        >
          {nav.tab === "account" ? <ConnectionSection status={s} lang={lang} /> : null}
          {nav.tab === "writers" ? <WritersSection status={s} lang={lang} /> : null}
          {nav.tab === "imports" ? (
            <ImportsSection
              key={`imports:${queries.imports}`}
              initialQuery={queries.imports}
              status={s}
              lang={lang}
              filter={importFilter}
              onFilter={setImportFilter}
              onOpenWriters={() => openSettings("writers")}
            />
          ) : null}
          {nav.tab === "plans" ? (
            <>
              <PlanSection kind="stock" status={s} lang={lang} />
              <PlanSection kind="prices" status={s} lang={lang} />
              <PlanSection kind="publish" status={s} lang={lang} />
            </>
          ) : null}
          {nav.tab === "outbox" ? <OutboxSection status={s} lang={lang} /> : null}
          {nav.tab === "runs" ? <RunsSection lang={lang} /> : null}
        </SettingsView>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function modeBadge(s: AllegroStatusResponse | undefined): { color: "green" | "orange" | "blue" | "grey" | "purple"; key: string } {
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
  fetching,
  onReload,
  lang,
  nav,
  onSyncStarted,
}: {
  status: AllegroStatusResponse | undefined
  loading: boolean
  fetching: boolean
  onReload: () => void
  lang: string
  nav: PageNav<SettingsTabId>
  onSyncStarted: () => void
}) {
  const { t } = useTranslation("allegro")
  const sync = useAllegroSync()
  const badge = modeBadge(status)
  const canSync = Boolean(status && (status.mode === "demo" || status.connection.connected))
  const running = Boolean(status?.running.offers || status?.running.orders)
  const armed = status?.writers.filter((w) => w.effective).length ?? 0
  const references = status ? referencesFor(status, lang) : []
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)

  const onSync = async () => {
    try {
      const r = await sync.mutateAsync("all")
      if (r.alreadyRunning) toast.info(t("toast.syncRunning"))
      else toast.success(t("toast.syncStarted"))
      onSyncStarted()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <IntegrationHeader
      icon={<AllegroIcon width={28} height={28} />}
      title={t("title")}
      badges={
        <>
          {!loading ? (
            <ModeBadge color={badge.color} label={t(badge.key)} title={t("demo.label")}>
              {status?.mode === "demo" ? <span>{t("demo.text")}</span> : null}
            </ModeBadge>
          ) : null}
          {status ? (
            <ToneBadge tone={armed > 0 ? "orange" : "grey"} icon={armed > 0 ? <PencilSquare /> : <LockClosedSolid />}>
              {armed > 0 ? t("mode.writersArmed", { count: armed }) : t("mode.readOnly")}
            </ToneBadge>
          ) : null}
          {status?.environment === "sandbox" ? <ToneBadge tone="orange">{t("connection.sandbox")}</ToneBadge> : null}
        </>
      }
      description={t("subtitle")}
      points={[
        { icon: <LinkIcon />, text: t("points.offers") },
        { icon: <ExclamationCircle />, text: t("points.stock") },
        { icon: <ShoppingCart />, text: t("points.orders") },
        { icon: <TruckFast />, text: t("points.back") },
        { icon: <User />, text: t("points.armed"), tone: "green" },
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
      actions={[
        { key: "reload", label: t("actions.reload"), icon: <ArrowPath />, loading: fetching, onClick: onReload },
        ...(status && status.mode !== "demo"
          ? [{ key: "panel", label: t("actions.sellerPanel"), icon: <ArrowUpRightOnBox />, onClick: () => void window.open(status.panel.orders, "_blank", "noopener") }]
          : []),
      ]}
      primary={
        nav.view !== "guide"
          ? {
              key: "sync",
              label: running ? t("actions.syncing") : t("actions.sync"),
              icon: <CloudArrowDown />,
              loading: sync.isPending || running,
              disabled: !canSync,
              onClick: () => void onSync(),
            }
          : null
      }
    />
  )
}

/** Only what needs a person now; the demo note lives in the mode badge. */
function Warnings({ status }: { status: AllegroStatusResponse }) {
  const { t } = useTranslation("allegro")
  if (status.mode === "demo" || status.configured) return null
  return (
    <div className="px-6 py-4">
      <InlineTip variant="warning" label={t("missing.label")}>
        {t("missing.text", { missing: status.missing.join(", "), host: status.webHost })}
      </InlineTip>
    </div>
  )
}

/** Demo mode while the sample data is not there yet: the job prepares it within a minute, or now on a click. */
function DemoSeedNotice({ status, onStarted }: { status: AllegroStatusResponse; onStarted: () => void }) {
  const { t } = useTranslation("allegro")
  const seed = useAllegroDemoSeed()
  if (!status.demoSeed || status.demoSeed.missing.length === 0) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
      <InlineTip variant="info" label={t("demoSeed.label")}>
        {t("demoSeed.text")}
      </InlineTip>
      <Button
        size="small"
        variant="secondary"
        isLoading={seed.isPending}
        onClick={() =>
          seed.mutate(undefined, {
            onSuccess: () => onStarted(),
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      >
        {t("demoSeed.action")}
      </Button>
    </div>
  )
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

function ConnectionSection({ status, lang }: { status: AllegroStatusResponse; lang: string }) {
  const { t } = useTranslation("allegro")
  const client = useQueryClient()
  const prompt = usePrompt()
  const connect = useAllegroConnect()
  const disconnect = useAllegroDisconnect()
  const c = status.connection
  const demo = status.mode === "demo"
  const code = status.connecting

  /* While a code is on screen, ask Allegro every `intervalS` seconds whether the seller approved. */
  useEffect(() => {
    if (!code) return
    let stopped = false
    let timer = 0
    const tick = async (delayS: number) => {
      timer = window.setTimeout(async () => {
        if (stopped) return
        try {
          const step = await pollAllegroConnect()
          if (stopped) return
          if (step.state === "pending") return void tick(step.intervalS ?? delayS)
          if (step.state === "connected") toast.success(t("toast.connected"))
          else if (step.state === "denied") toast.error(t("toast.denied"))
          else if (step.state === "expired") toast.warning(t("toast.expired"))
          void client.invalidateQueries({ queryKey: allegroKeys.all })
        } catch (err) {
          if (!stopped) {
            toast.error(errorMessage(err))
            void tick(delayS * 2)
          }
        }
      }, delayS * 1000)
    }
    void tick(code.intervalS)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [code?.userCode, code?.intervalS, client, t])

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
      icon={<User />}
      title={t("connection.title")}
      badges={!demo ? <ToneBadge tone={c.connected ? "green" : code ? "blue" : "grey"}>{t(c.connected ? "mode.connected" : code ? "mode.waiting" : "mode.notConnected")}</ToneBadge> : null}
      pointsLabel={t("connection.subtitle", { host: status.webHost })}
      points={[
        demo ? { icon: <Beaker />, text: t("connection.points.demo"), tone: "blue", title: t("connection.demoNote") } : null,
        { icon: <Key />, text: t("connection.points.device") },
        { icon: <ShieldCheck />, text: t("connection.points.scopes") },
        { icon: <LockClosedSolid />, text: t("connection.points.encrypted"), title: t("connection.tokensNote") },
        { icon: <ArrowPath />, text: t("connection.points.refresh"), title: t("connection.tokensNote") },
      ]}
      actions={
        !demo ? (
          <>
            <Button size="small" variant="secondary" isLoading={disconnect.isPending} disabled={!c.connected} onClick={() => void onDisconnect()}>
              <XCircle />
              {t("actions.disconnect")}
            </Button>
            <Button size="small" variant={c.connected ? "secondary" : "primary"} isLoading={connect.isPending} disabled={!status.configured} onClick={() => void onConnect()}>
              <LinkIcon />
              {c.connected ? t("actions.reconnect") : code ? t("actions.newCode") : t("actions.connect")}
            </Button>
          </>
        ) : null
      }
    >
      <div className="flex flex-col gap-4 px-6 py-4">
        {!demo ? (
          <>
            {code ? (
              <InlineTip variant="info" label={t("connection.waitingLabel")}>
                <span className="flex flex-col gap-y-2">
                  <span>{t("connection.waitingText", { host: status.webHost })}</span>
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-1 font-mono text-lg tracking-widest text-ui-fg-base">{code.userCode}</span>
                    <a href={code.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-x-1 underline">
                      {t("actions.openAllegro")}
                      <ArrowUpRightOnBox />
                    </a>
                  </span>
                  <span className="text-ui-fg-muted">{t("connection.waitingUntil", { time: fmtDateTime(code.expiresAt, lang) })}</span>
                </span>
              </InlineTip>
            ) : null}
            {c.lastError ? (
              <InlineTip variant="error" label={t("connection.lastError")}>
                {c.lastError}
                {c.lastErrorAt ? ` (${fmtDateTime(c.lastErrorAt, lang)})` : ""}
              </InlineTip>
            ) : null}
            {c.connected && status.missingScopes.length > 0 ? (
              <InlineTip variant="warning" label={t("connection.reconnectLabel")}>
                {t("connection.reconnectText", { scopes: status.missingScopes.join(", ") })}
              </InlineTip>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Fact label={t("connection.connectedAt")} value={fmtDateTime(c.connectedAt, lang) || t("connection.never")} />
              <Fact label={t("connection.refreshedAt")} value={fmtDateTime(c.refreshedAt, lang) || t("connection.never")} />
              <Fact label={t("connection.expiresAt")} value={fmtDateTime(c.accessExpiresAt, lang) || t("connection.none")} />
            </div>
          </>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex items-start gap-x-2">
            <Fact label={t("connection.scopes")} value={status.scopes} mono />
            <Copy content={status.scopes} className="mt-4" />
          </div>
          {status.grantedScopes ? <Fact label={t("connection.granted")} value={status.grantedScopes.join(" ") || t("connection.none")} mono /> : null}
          <Fact label={t("connection.userAgent")} value={status.userAgent} mono />
        </div>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */

const OFFER_FILTER_ICON: Record<AllegroOfferFilter, ReactNode> = {
  all: <ListBullet />,
  linked: <LinkIcon />,
  unmatched: <ExclamationCircle />,
  stock: <ArchiveBox />,
  ended_in_stock: <PauseSolid />,
  ended: <MinusCircle />,
  drafts: <PencilSquare />,
  nokey: <XCircle />,
}

function filterCount(status: AllegroStatusResponse, f: AllegroOfferFilter): number {
  const c = status.counts
  switch (f) {
    case "all":
      return c.offers
    case "linked":
      return c.linked
    case "unmatched":
      return c.unmatchedLive
    case "stock":
      return c.stockIssues
    case "ended_in_stock":
      return c.endedInStock
    case "ended":
      return c.ended
    case "drafts":
      return c.drafts
    case "nokey":
      return c.noKey
  }
}

function OffersSection({
  status,
  lang,
  filter,
  onFilter,
  initialQuery,
}: {
  status: AllegroStatusResponse
  lang: string
  filter: AllegroOfferFilter
  onFilter: (f: AllegroOfferFilter) => void
  /** The search a deep link (?q=) opens the list with. */
  initialQuery?: string
}) {
  const { t } = useTranslation("allegro")
  const [search, setSearch] = useState(initialQuery ?? "")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])

  const offers = useAllegroOffers(filter, q, page * PAGE_SIZE, PAGE_SIZE)
  const rows = offers.data?.offers ?? []
  const thumbs = useProductThumbs(rows.map((o) => o.productId))
  const toggle = (f: AllegroOfferFilter) => onFilter(filter === f ? "all" : f)
  const button = (f: AllegroOfferFilter, attention = false) => (
    <FilterButton key={f} icon={OFFER_FILTER_ICON[f]} label={t(`offers.filter.${f}`)} count={filterCount(status, f)} attention={attention} active={filter === f} onClick={() => toggle(f)} />
  )

  return (
    <Section
      id="allegro-offers"
      icon={<Tag />}
      title={t("offers.title")}
      pointsLabel={t("offers.subtitle")}
      points={[
        { icon: <LinkIcon />, text: t("offers.points.signature"), title: t("offers.matching") },
        { icon: <ArchiveBox />, text: t("offers.points.qty") },
        { icon: <ShieldCheck />, text: t("offers.points.check"), title: t("offers.stockNote") },
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("offers.search")} />}
    >
      <FilterBar>
        <FilterButton icon={OFFER_FILTER_ICON.all} label={t("offers.filter.all")} count={filterCount(status, "all")} active={filter === "all"} onClick={() => onFilter("all")} />
        {button("linked")}
        <FilterDivider />
        {button("stock", true)}
        {button("unmatched", true)}
        {button("ended_in_stock", true)}
        <FilterDivider />
        {button("ended")}
        {button("drafts")}
        {button("nokey")}
      </FilterBar>
      <KitFetchingBar active={offers.isFetching && !offers.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("offers.col.offer")}</Table.HeaderCell>
              <Table.HeaderCell>{t("offers.col.status")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("offers.col.price")}</Table.HeaderCell>
              <Table.HeaderCell>{t("offers.col.stock")}</Table.HeaderCell>
              <Table.HeaderCell>
                <StoreColumn label={t("offers.col.product")} hint={t("offers.matching")} />
              </Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {offers.isLoading ? (
              <KitSkeletonRows cols={5} />
            ) : rows.length === 0 ? (
              <EmptyTableRow cols={5} icon={<Tag />} title={t("offers.empty")} />
            ) : (
              rows.map((o) => (
                <Table.Row key={o.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-[340px]">
                    <div className="flex flex-col gap-y-1">
                      <a
                        href={o.url}
                        target="_blank"
                        rel="noreferrer"
                        className="txt-compact-small-plus inline-flex items-center gap-x-1 text-ui-fg-base hover:text-ui-fg-interactive"
                        title={t("actions.openOffer")}
                      >
                        <span className="truncate">{o.name}</span>
                        <ArrowUpRightOnBox className="shrink-0 text-ui-fg-muted" />
                      </a>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">#{o.allegroId}</span>
                        {o.isPrimary ? <ToneBadge tone="green">{t("offers.primary")}</ToneBadge> : null}
                        {o.demo ? <ToneBadge tone="purple">{t("offers.sample")}</ToneBadge> : null}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <OfferStatus offer={o} />
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{fmtMoney(o.price, lang)}</Table.Cell>
                  <Table.Cell>
                    <StockCell offer={o} />
                  </Table.Cell>
                  <Table.Cell className="max-w-[300px]">
                    <StoreProductCell offer={o} thumbnail={o.productId ? thumbs[o.productId] : null} />
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pager count={offers.data?.count ?? 0} page={page} size={PAGE_SIZE} onPage={setPage} />
    </Section>
  )
}

/** The signature as the seller typed it on Allegro, or null when the offer has none. */
function signatureOf(externalId: string | null, matchKey: string | null): string | null {
  if (!matchKey) return null
  return externalId?.trim() || matchKey
}

/** The store side of an offer: its Medusa product with its picture, one click away, or why there is none. */
function StoreProductCell({ offer: o, thumbnail }: { offer: AllegroOfferDto; thumbnail?: string | null }) {
  const { t } = useTranslation("allegro")
  const signature = signatureOf(o.externalId, o.matchKey)
  if (o.productId) {
    return (
      <ProductLink
        productId={o.productId}
        title={o.productTitle ?? o.productId}
        code={o.sku ?? signature}
        codeTitle={signature ? t("offers.signatureTitle", { signature }) : undefined}
        thumbnail={thumbnail}
      />
    )
  }
  return <NoProduct signature={signature} />
}

/* ------------------------------------------------------------------ */

const ORDER_FILTER_ICON: Record<AllegroOrderFilter, ReactNode> = {
  all: <ListBullet />,
  open: <TruckFast />,
  sent: <CheckCircle />,
  cancelled: <XCircle />,
  unmatched: <ExclamationCircle />,
  imported: <ShoppingCart />,
  held: <PauseSolid />,
}

function OrdersSection({
  status,
  lang,
  filter,
  onFilter,
  initialQuery,
}: {
  status: AllegroStatusResponse
  lang: string
  filter: AllegroOrderFilter
  onFilter: (f: AllegroOrderFilter) => void
  /** The search a deep link (?q=) opens the list with. */
  initialQuery?: string
}) {
  const { t } = useTranslation("allegro")
  const [search, setSearch] = useState(initialQuery ?? "")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])

  const orders = useAllegroOrders(filter, q, page * ORDERS_PAGE_SIZE, ORDERS_PAGE_SIZE)
  const rows = orders.data?.orders ?? []
  const thumbs = useProductThumbs(rows.flatMap((o) => o.lines.map((l) => l.productId)))
  const counts: Partial<Record<AllegroOrderFilter, number>> = {
    all: status.counts.orders,
    open: status.counts.ordersOpen,
    unmatched: status.counts.ordersUnmatched,
    imported: status.imports.imported,
    held: status.imports.held,
  }
  const toggle = (f: AllegroOrderFilter) => onFilter(filter === f ? "all" : f)
  const button = (f: AllegroOrderFilter, attention = false) => (
    <FilterButton key={f} icon={ORDER_FILTER_ICON[f]} label={t(`orders.filter.${f}`)} count={counts[f]} attention={attention} active={filter === f} onClick={() => toggle(f)} />
  )

  return (
    <Section
      id="allegro-orders"
      icon={<ShoppingCart />}
      title={t("orders.title")}
      pointsLabel={t("orders.subtitle")}
      points={[
        { icon: <Clock />, text: t("orders.points.journal"), title: t("orders.journal") },
        { icon: <Tag />, text: t("orders.points.lines") },
        { icon: <LinkIcon />, text: t("orders.points.store") },
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("orders.search")} />}
    >
      <FilterBar>
        <FilterButton icon={ORDER_FILTER_ICON.all} label={t("orders.filter.all")} count={counts.all} active={filter === "all"} onClick={() => onFilter("all")} />
        <FilterDivider />
        {button("open")}
        {button("sent")}
        {button("cancelled")}
        <FilterDivider />
        {button("unmatched", true)}
        {button("held", true)}
        {button("imported")}
      </FilterBar>
      <KitFetchingBar active={orders.isFetching && !orders.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("orders.col.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.col.order")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.col.lines")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("orders.col.total")}</Table.HeaderCell>
              <Table.HeaderCell>
                <StoreColumn label={t("orders.col.import")} hint={t("orders.journal")} />
              </Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {orders.isLoading ? (
              <KitSkeletonRows cols={6} rows={4} />
            ) : rows.length === 0 ? (
              <EmptyTableRow cols={6} icon={<ShoppingCart />} title={t("orders.empty")} />
            ) : (
              rows.map((o) => (
                <Table.Row key={o.id} className="[&_td]:py-2.5 align-top">
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(o.boughtAt, lang)}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col gap-y-1">
                      <span className="font-mono text-ui-fg-base txt-compact-small" title={o.allegroId}>
                        {o.allegroId.slice(0, 8)}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {o.deliveryMethod ? (
                          <Text size="xsmall" className="text-ui-fg-muted">
                            {o.deliveryMethod}
                          </Text>
                        ) : null}
                        {o.demo ? <ToneBadge tone="purple">{t("offers.sample")}</ToneBadge> : null}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <OrderStatus order={o} />
                  </Table.Cell>
                  <Table.Cell className="max-w-[380px]">
                    <div className="flex flex-col gap-y-2">
                      {o.lines.map((l, i) => (
                        <OrderLineCell key={`${l.offerId}-${i}`} line={l} thumbnail={l.productId ? thumbs[l.productId] : null} />
                      ))}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{fmtMoney(o.total, lang)}</Table.Cell>
                  <Table.Cell className="max-w-[240px]">
                    <OrderInStoreCell order={o} />
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pager count={orders.data?.count ?? 0} page={page} size={ORDERS_PAGE_SIZE} onPage={setPage} />
    </Section>
  )
}

/** One item of an Allegro order: its store product, or the Allegro offer and why it has no product. */
function OrderLineCell({ line: l, thumbnail }: { line: AllegroOrderLineDto; thumbnail?: string | null }) {
  const { t } = useTranslation("allegro")
  const signature = l.externalId?.trim() || null
  const quantity = <span className="tabular-nums text-ui-fg-muted">{l.quantity} x </span>
  if (l.productId) {
    return (
      <ProductLink
        productId={l.productId}
        title={
          <>
            {quantity}
            {l.productTitle ?? l.offerName}
          </>
        }
        code={l.sku ?? signature}
        codeTitle={signature ? t("offers.signatureTitle", { signature }) : undefined}
        thumbnail={thumbnail}
      />
    )
  }
  return (
    <div className="flex min-w-0 flex-col items-start gap-y-1">
      <a
        href={l.offerUrl}
        target="_blank"
        rel="noreferrer"
        className="txt-compact-small inline-flex max-w-full items-center gap-x-1 text-ui-fg-base hover:text-ui-fg-interactive"
        title={t("actions.openOffer")}
      >
        <span className="truncate">
          {quantity}
          {l.offerName}
        </span>
        <ArrowUpRightOnBox className="shrink-0 text-ui-fg-muted" />
      </a>
      <span className="flex flex-wrap items-center gap-1.5">
        <ToneBadge tone="orange">{signature ? t("offers.noProduct") : t("offers.noKey")}</ToneBadge>
        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{signature ?? `#${l.offerId}`}</span>
      </span>
    </div>
  )
}

/** The store side of an Allegro order: the order it became, or why there is none yet. */
function OrderInStoreCell({ order: o }: { order: AllegroOrderDto }) {
  const { t } = useTranslation("allegro")
  const imp = o.import
  if (!imp) {
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        {t("orders.notImported")}
      </Text>
    )
  }
  const state = <ToneBadge tone={IMPORT_TONE[imp.status] ?? "grey"}>{t(`imports.status.${imp.status}`)}</ToneBadge>
  if (imp.orderId) {
    return (
      <div className="flex flex-col items-start gap-y-1.5" title={imp.status === "imported" ? undefined : (imp.reason ?? undefined)}>
        <OrderLink orderId={imp.orderId} displayId={imp.displayId} />
        {imp.status !== "imported" ? state : null}
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-y-1" title={imp.reason ?? undefined}>
      {state}
      <ImportWhy status={imp.status} reasonCode={imp.reasonCode} reason={imp.reason} fallback={false} />
    </div>
  )
}

/* ------------------------------------------------------------------ */

const RUN_TONE: Record<AllegroRunDto["status"], Tone> = {
  ok: "green",
  partial: "orange",
  error: "red",
  skipped: "grey",
}

function RunsSection({ lang }: { lang: string }) {
  const { t } = useTranslation("allegro")
  const runs = useAllegroRuns()
  const list = useMemo(() => runs.data?.runs ?? [], [runs.data])

  return (
    <Section
      icon={<History />}
      title={t("runs.title")}
      pointsLabel={t("runs.subtitle")}
      points={[
        { icon: <DocumentText />, text: t("runs.points.what") },
        { icon: <Clock />, text: t("runs.points.when") },
      ]}
    >
      <KitFetchingBar active={runs.isFetching && !runs.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("runs.col.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.kind")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.source")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.result")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("runs.col.items")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("runs.col.issues")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.changes")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("runs.col.duration")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {runs.isLoading ? (
              <KitSkeletonRows cols={8} />
            ) : list.length === 0 ? (
              <EmptyTableRow cols={8} icon={<History />} title={t("runs.empty")} />
            ) : (
              list.map((r) => (
                <Table.Row key={r.id} title={r.message ?? undefined}>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.startedAt, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {t(`runs.kind.${r.kind}`)}
                    {r.dryRun ? <span className="text-ui-fg-muted"> ({t("runs.dryRun")})</span> : null}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {t(`runs.source.${r.source}`)}
                    <span className="text-ui-fg-muted"> / {t(`runs.trigger.${r.trigger}`)}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <ToneBadge tone={RUN_TONE[r.status]}>{t(`runs.${r.status}`)}</ToneBadge>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{r.items}</Table.Cell>
                  <Table.Cell className={clx("text-right tabular-nums", r.issues > 0 && "text-ui-tag-orange-text")}>{r.issues}</Table.Cell>
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
  label: "Allegro",
  icon: AllegroIcon,
})

export default AllegroPage
