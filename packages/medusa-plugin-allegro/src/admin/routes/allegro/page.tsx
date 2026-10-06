import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Container, Copy, Heading, InlineTip, Input, StatusBadge, Table, Text, clx, toast, usePrompt } from "@medusajs/ui"
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
import { sinceLabel } from "../../../modules/allegro/lib/references"
import {
  allegroKeys,
  errorMessage,
  pollAllegroConnect,
  useAllegroConnect,
  useAllegroDisconnect,
  useAllegroOffers,
  useAllegroOrders,
  useAllegroRuns,
  useAllegroStatus,
  useAllegroSync,
} from "../../lib/allegro-api"
import { ModeBadge, ReferencesBadge, SettingsButton, SettingsView, ViewSwitch, usePageNav, type PageNav } from "../../lib/allegro-guide"
import { GuideView, referencesFor } from "../../lib/allegro-guide-view"
import { AllegroIcon } from "../../lib/allegro-icon"
import { ImportsSection } from "../../lib/allegro-imports"
import { IssuesSection } from "../../lib/allegro-issues"
import { OutboxSection } from "../../lib/allegro-outbox"
import { PlanSection } from "../../lib/allegro-plans"
import {
  EmptyRow,
  IMPORT_TONE,
  ImportWhy,
  NoProduct,
  OfferStatus,
  OrderLink,
  OrderStatus,
  Pager,
  Pills,
  ProductLink,
  SectionHeader,
  StatTile,
  StockCell,
  StoreColumn,
  fmtDateTime,
  fmtDuration,
  fmtMoney,
  fmtRating,
  scrollToSection,
  useDebounced,
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

  const [filter, setFilter] = useState<AllegroOfferFilter>("all")
  const [orderFilter, setOrderFilter] = useState<AllegroOrderFilter>("all")
  const [importFilter, setImportFilter] = useState<AllegroImportFilter>("all")
  const [issueFilter, setIssueFilter] = useState<AllegroIssueFilter>("open")
  const poll = () => setPollUntil(Date.now() + 30_000)

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
        <Header status={s} loading={status.isLoading} lang={lang} nav={nav} onSyncStarted={poll} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label="Allegro">
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s && nav.view !== "guide" ? <Warnings status={s} /> : null}
        {s && nav.view === "panel" ? (
          /* One block with two labelled groups, like OLX: a second block would get the container's divider glued to its tiles. */
          <div className="flex flex-col gap-y-4 px-6 py-4">
            <div className="flex flex-col gap-y-2">
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("stats.groupOffers")}
              </Text>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                <StatTile label={t("stats.offers")} value={s.counts.offers} active={filter === "all"} onClick={() => setFilter("all")} />
                <StatTile label={t("stats.live")} value={s.counts.live} tone="green" />
                <StatTile label={t("stats.linkedLive")} value={s.counts.linkedLive} tone="green" active={filter === "linked"} onClick={() => setFilter("linked")} />
                <StatTile label={t("stats.stockIssues")} value={s.counts.stockIssues} tone="red" active={filter === "stock"} onClick={() => setFilter("stock")} />
                <StatTile label={t("stats.endedInStock")} value={s.counts.endedInStock} tone="orange" active={filter === "ended_in_stock"} onClick={() => setFilter("ended_in_stock")} />
                <StatTile label={t("stats.unmatched")} value={s.counts.unmatchedLive} tone="red" active={filter === "unmatched"} onClick={() => setFilter("unmatched")} />
                <StatTile label={t("stats.noKey")} value={s.counts.noKey} active={filter === "nokey"} onClick={() => setFilter("nokey")} />
              </div>
            </div>
            <div className="flex flex-col gap-y-2">
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("stats.groupOrders")}
              </Text>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <StatTile
                  label={t("stats.ordersOpen")}
                  value={s.counts.ordersOpen}
                  tone="blue"
                  active={s.ordersEnabled && orderFilter === "open"}
                  onClick={
                    s.ordersEnabled
                      ? () => {
                          setOrderFilter("open")
                          scrollToSection("allegro-orders")
                        }
                      : undefined
                  }
                />
                <StatTile label={t("stats.imported")} value={s.imports.imported} tone="green" active={importsActive("imported")} onClick={() => openImports("imported")} />
                <StatTile label={t("stats.held")} value={s.imports.held} tone="red" active={importsActive("held")} onClick={() => openImports("held")} />
                <StatTile
                  label={t("stats.outbox")}
                  value={s.outbox.shipping.pending + s.outbox.invoices.pending}
                  tone="blue"
                  onClick={() => openSettings("outbox")}
                />
                <StatTile
                  label={t("stats.issues")}
                  value={s.issues.needReply}
                  tone="orange"
                  active={issueFilter === "needs_reply"}
                  onClick={() => {
                    setIssueFilter("needs_reply")
                    scrollToSection("allegro-issues")
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} lang={lang} /> : null}

      {s && nav.view === "panel" ? (
        <>
          <OffersSection status={s} lang={lang} filter={filter} onFilter={setFilter} />
          {s.ordersEnabled ? <OrdersSection status={s} lang={lang} filter={orderFilter} onFilter={setOrderFilter} /> : null}
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
            <ImportsSection status={s} lang={lang} filter={importFilter} onFilter={setImportFilter} onOpenWriters={() => openSettings("writers")} />
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
  lang,
  nav,
  onSyncStarted,
}: {
  status: AllegroStatusResponse | undefined
  loading: boolean
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
    <div className="flex flex-col gap-4 px-6 py-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 flex-col gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <AllegroIcon width={24} height={24} className="shrink-0" />
          <Heading level="h1">{t("title")}</Heading>
          <Badge size="2xsmall" color="grey">
            {t("by")}
          </Badge>
          {!loading ? (
            <ModeBadge color={badge.color} label={t(badge.key)} title={t("demo.label")}>
              {status?.mode === "demo" ? <span>{t("demo.text")}</span> : null}
            </ModeBadge>
          ) : null}
          {status ? (
            <Badge size="2xsmall" color={armed > 0 ? "orange" : "grey"}>
              {armed > 0 ? t("mode.writersArmed", { count: armed }) : t("mode.readOnly")}
            </Badge>
          ) : null}
          {status?.environment === "sandbox" ? (
            <Badge size="2xsmall" color="orange">
              {t("connection.sandbox")}
            </Badge>
          ) : null}
        </div>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("subtitle")}
        </Text>
        {references.length > 0 ? (
          <div>
            <ReferencesBadge
              items={references}
              labels={{
                count: references.length === 1 ? t("references.badgeOne") : t("references.badgeMany", { count: references.length }),
                title: t("references.title"),
                subtitle: t("references.subtitle"),
                open: t("references.open"),
                review: t("references.review"),
                since: (since) => sinceLabel(since, lang),
                rating: (value) => fmtRating(value, lang),
              }}
            />
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <ViewSwitch value={nav.view} onChange={(v) => nav.go(v)} labels={{ panel: t("view.panel"), guide: t("view.guide") }} />
        <SettingsButton active={nav.view === "settings"} onClick={() => nav.go(nav.view === "settings" ? "panel" : "settings")} label={t("settings.title")} />
        {nav.view !== "guide" ? (
          <Button size="small" variant="primary" isLoading={sync.isPending || running} disabled={!canSync} onClick={() => void onSync()}>
            <ArrowPath />
            {running ? t("actions.syncing") : t("actions.sync")}
          </Button>
        ) : null}
      </div>
    </div>
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
    <Container className="divide-y p-0">
      <SectionHeader title={t("connection.title")} subtitle={t("connection.subtitle", { host: status.webHost })} />
      <div className="flex flex-col gap-4 px-6 py-4">
        {demo ? (
          <Text size="small" className="text-ui-fg-subtle">
            {t("connection.demoNote")}
          </Text>
        ) : (
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
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex items-start gap-x-2">
            <Fact label={t("connection.scopes")} value={status.scopes} mono />
            <Copy content={status.scopes} className="mt-4" />
          </div>
          {status.grantedScopes ? <Fact label={t("connection.granted")} value={status.grantedScopes.join(" ") || t("connection.none")} mono /> : null}
          <Fact label={t("connection.userAgent")} value={status.userAgent} mono />
        </div>

        {!demo ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="small" variant={c.connected ? "secondary" : "primary"} isLoading={connect.isPending} disabled={!status.configured} onClick={() => void onConnect()}>
              {c.connected ? t("actions.reconnect") : code ? t("actions.newCode") : t("actions.connect")}
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

const FILTERS: AllegroOfferFilter[] = ["all", "linked", "unmatched", "stock", "ended_in_stock", "ended", "drafts", "nokey"]

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
}: {
  status: AllegroStatusResponse
  lang: string
  filter: AllegroOfferFilter
  onFilter: (f: AllegroOfferFilter) => void
}) {
  const { t } = useTranslation("allegro")
  const [search, setSearch] = useState("")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])

  const offers = useAllegroOffers(filter, q, page * PAGE_SIZE, PAGE_SIZE)
  const rows = offers.data?.offers ?? []

  return (
    <Container className="divide-y p-0" id="allegro-offers">
      <SectionHeader title={t("offers.title")} subtitle={t("offers.subtitle")} />
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <Pills filters={FILTERS} value={filter} onChange={onFilter} label={(f) => t(`offers.filter.${f}`)} count={(f) => filterCount(status, f)} />
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("offers.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

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
            {rows.length === 0 ? (
              <EmptyRow span={5} loading={offers.isLoading} text={t("offers.empty")} />
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
                        {o.isPrimary ? (
                          <Badge size="2xsmall" color="green">
                            {t("offers.primary")}
                          </Badge>
                        ) : null}
                        {o.demo ? (
                          <Badge size="2xsmall" color="purple">
                            {t("offers.sample")}
                          </Badge>
                        ) : null}
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
                    <StoreProductCell offer={o} />
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pager count={offers.data?.count ?? 0} page={page} size={PAGE_SIZE} onPage={setPage} />
      <div className="px-6 py-3">
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("offers.stockNote")}
        </Text>
      </div>
    </Container>
  )
}

/** The signature as the seller typed it on Allegro, or null when the offer has none. */
function signatureOf(externalId: string | null, matchKey: string | null): string | null {
  if (!matchKey) return null
  return externalId?.trim() || matchKey
}

/** The store side of an offer: its Medusa product, one click away, or why there is none. */
function StoreProductCell({ offer: o }: { offer: AllegroOfferDto }) {
  const { t } = useTranslation("allegro")
  const signature = signatureOf(o.externalId, o.matchKey)
  if (o.productId) {
    return (
      <ProductLink
        productId={o.productId}
        title={o.productTitle ?? o.productId}
        code={o.sku ?? signature}
        codeTitle={signature ? t("offers.signatureTitle", { signature }) : undefined}
      />
    )
  }
  return <NoProduct signature={signature} />
}

/* ------------------------------------------------------------------ */

const ORDER_FILTERS: AllegroOrderFilter[] = ["all", "open", "sent", "cancelled", "unmatched", "imported", "held"]

function OrdersSection({
  status,
  lang,
  filter,
  onFilter,
}: {
  status: AllegroStatusResponse
  lang: string
  filter: AllegroOrderFilter
  onFilter: (f: AllegroOrderFilter) => void
}) {
  const { t } = useTranslation("allegro")
  const [search, setSearch] = useState("")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])

  const orders = useAllegroOrders(filter, q, page * ORDERS_PAGE_SIZE, ORDERS_PAGE_SIZE)
  const rows = orders.data?.orders ?? []
  const counts: Partial<Record<AllegroOrderFilter, number>> = {
    all: status.counts.orders,
    open: status.counts.ordersOpen,
    unmatched: status.counts.ordersUnmatched,
    imported: status.imports.imported,
    held: status.imports.held,
  }

  return (
    <Container className="divide-y p-0" id="allegro-orders">
      <SectionHeader title={t("orders.title")} subtitle={t("orders.subtitle")} />
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <Pills filters={ORDER_FILTERS} value={filter} onChange={onFilter} label={(f) => t(`orders.filter.${f}`)} count={(f) => counts[f] ?? null} />
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("orders.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

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
            {rows.length === 0 ? (
              <EmptyRow span={6} loading={orders.isLoading} text={t("orders.empty")} />
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
                        {o.demo ? (
                          <Badge size="2xsmall" color="purple">
                            {t("offers.sample")}
                          </Badge>
                        ) : null}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <OrderStatus order={o} />
                  </Table.Cell>
                  <Table.Cell className="max-w-[380px]">
                    <div className="flex flex-col gap-y-2">
                      {o.lines.map((l, i) => (
                        <OrderLineCell key={`${l.offerId}-${i}`} line={l} />
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
    </Container>
  )
}

/** One item of an Allegro order: its store product, or the Allegro offer and why it has no product. */
function OrderLineCell({ line: l }: { line: AllegroOrderLineDto }) {
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
        <Badge size="2xsmall" color="orange">
          {signature ? t("offers.noProduct") : t("offers.noKey")}
        </Badge>
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
  const state = <StatusBadge color={IMPORT_TONE[imp.status] ?? "grey"}>{t(`imports.status.${imp.status}`)}</StatusBadge>
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

const RUN_COLOR: Record<AllegroRunDto["status"], "green" | "orange" | "red" | "grey"> = {
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
    <Container className="divide-y p-0">
      <SectionHeader title={t("runs.title")} subtitle={t("runs.subtitle")} />
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
            {list.length === 0 ? (
              <EmptyRow span={8} loading={runs.isLoading} text={t("runs.empty")} />
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
                    <StatusBadge color={RUN_COLOR[r.status]}>{t(`runs.${r.status}`)}</StatusBadge>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{r.items}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{r.issues}</Table.Cell>
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
  label: "Allegro",
  icon: AllegroIcon,
})

export default AllegroPage
