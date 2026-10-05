import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Container, Copy, Heading, InlineTip, Input, StatusBadge, Table, Text, clx, toast, usePrompt } from "@medusajs/ui"
import type { AllegroOfferFilter, AllegroOrderFilter, AllegroRunDto, AllegroStatusResponse } from "../../../modules/allegro/lib/contract"
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
import { ViewSwitch, usePageView } from "../../lib/allegro-guide"
import { GuideView, ReferencesBlock } from "../../lib/allegro-guide-view"
import { AllegroIcon } from "../../lib/allegro-icon"
import { ImportsSection } from "../../lib/allegro-imports"
import { IssuesSection } from "../../lib/allegro-issues"
import { OutboxSection } from "../../lib/allegro-outbox"
import { PlanSection } from "../../lib/allegro-plans"
import {
  EmptyRow,
  IMPORT_TONE,
  KeyCell,
  OfferStatus,
  OrderStatus,
  Pager,
  Pills,
  SectionHeader,
  StatTile,
  StockCell,
  fmtDateTime,
  fmtDuration,
  fmtMoney,
  useDebounced,
} from "../../lib/allegro-ui"
import { WritersSection } from "../../lib/allegro-writers"

/**
 * Allegro by Koda Plus: device login to the seller account, the offer
 * snapshot linked to products by signature with the stock check, the
 * writers (each allowed in the options and armed here), their plans, the
 * imported orders, parcels and invoices, customer issues and the history.
 * A second view is the setup guide.
 */
const PAGE_SIZE = 20
const ORDERS_PAGE_SIZE = 10

const AllegroPage = () => {
  const { t, i18n } = useTranslation("allegro")
  const lang = i18n.language || "en"
  const client = useQueryClient()
  const [view, setView] = usePageView()
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
  const poll = () => setPollUntil(Date.now() + 30_000)

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} loading={status.isLoading} view={view} onView={setView} onSyncStarted={poll} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label="Allegro">
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s ? <Tips status={s} /> : null}
        {s && view === "panel" ? (
          <>
            <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-4 xl:grid-cols-8">
              <StatTile label={t("stats.offers")} value={s.counts.offers} active={filter === "all"} onClick={() => setFilter("all")} />
              <StatTile label={t("stats.live")} value={s.counts.live} tone="green" />
              <StatTile label={t("stats.linkedLive")} value={s.counts.linkedLive} tone="green" active={filter === "linked"} onClick={() => setFilter("linked")} />
              <StatTile label={t("stats.stockIssues")} value={s.counts.stockIssues} tone="red" active={filter === "stock"} onClick={() => setFilter("stock")} />
              <StatTile label={t("stats.endedInStock")} value={s.counts.endedInStock} tone="orange" active={filter === "ended_in_stock"} onClick={() => setFilter("ended_in_stock")} />
              <StatTile label={t("stats.unmatched")} value={s.counts.unmatchedLive} tone="red" active={filter === "unmatched"} onClick={() => setFilter("unmatched")} />
              <StatTile label={t("stats.ordersOpen")} value={s.counts.ordersOpen} tone="blue" active={orderFilter === "open"} onClick={() => setOrderFilter("open")} />
              <StatTile label={t("stats.noKey")} value={s.counts.noKey} active={filter === "nokey"} onClick={() => setFilter("nokey")} />
            </div>
            <div className="grid grid-cols-2 gap-3 px-6 pb-4 md:grid-cols-4">
              <StatTile label={t("stats.imported")} value={s.imports.imported} tone="green" active={orderFilter === "imported"} onClick={() => setOrderFilter("imported")} />
              <StatTile label={t("stats.held")} value={s.imports.held} tone="red" active={orderFilter === "held"} onClick={() => setOrderFilter("held")} />
              <StatTile label={t("stats.outbox")} value={s.outbox.shipping.pending + s.outbox.invoices.pending} tone="blue" />
              <StatTile label={t("stats.issues")} value={s.issues.needReply} tone="orange" />
            </div>
          </>
        ) : null}
      </Container>

      {s && view === "guide" ? <GuideView status={s} lang={lang} /> : null}

      {s && view === "panel" ? (
        <>
          <ReferencesBlock status={s} lang={lang} />
          <ConnectionSection status={s} lang={lang} />
          <WritersSection status={s} lang={lang} />
          <ImportsSection status={s} lang={lang} />
          <PlanSection kind="stock" status={s} lang={lang} />
          <OffersSection status={s} lang={lang} filter={filter} onFilter={setFilter} />
          {s.ordersEnabled ? <OrdersSection status={s} lang={lang} filter={orderFilter} onFilter={setOrderFilter} /> : null}
          <OutboxSection status={s} lang={lang} />
          <IssuesSection status={s} lang={lang} />
          <PlanSection kind="prices" status={s} lang={lang} />
          <PlanSection kind="publish" status={s} lang={lang} />
          <RunsSection lang={lang} />
        </>
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
  view,
  onView,
  onSyncStarted,
}: {
  status: AllegroStatusResponse | undefined
  loading: boolean
  view: "panel" | "guide"
  onView: (v: "panel" | "guide") => void
  onSyncStarted: () => void
}) {
  const { t } = useTranslation("allegro")
  const sync = useAllegroSync()
  const badge = modeBadge(status)
  const canSync = Boolean(status && (status.mode === "demo" || status.connection.connected))
  const running = Boolean(status?.running.offers || status?.running.orders)
  const armed = status?.writers.filter((w) => w.effective).length ?? 0

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
    <div className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <AllegroIcon width={24} height={24} className="shrink-0" />
          <Heading level="h1">{t("title")}</Heading>
          <Badge size="2xsmall" color="grey">
            {t("by")}
          </Badge>
          {!loading ? <StatusBadge color={badge.color}>{t(badge.key)}</StatusBadge> : null}
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
        <Text size="small" className="mt-1 max-w-3xl text-ui-fg-subtle">
          {t("subtitle")}
        </Text>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <ViewSwitch value={view} onChange={onView} labels={{ panel: t("view.panel"), guide: t("view.guide") }} />
        {view === "panel" ? (
          <Button size="small" variant="primary" isLoading={sync.isPending || running} disabled={!canSync} onClick={() => void onSync()}>
            <ArrowPath />
            {running ? t("actions.syncing") : t("actions.sync")}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function Tips({ status }: { status: AllegroStatusResponse }) {
  const { t } = useTranslation("allegro")
  if (status.mode === "demo") {
    return (
      <div className="px-6 py-4">
        <InlineTip variant="info" label={t("demo.label")}>
          {t("demo.text")}
        </InlineTip>
      </div>
    )
  }
  if (!status.configured) {
    return (
      <div className="px-6 py-4">
        <InlineTip variant="warning" label={t("missing.label")}>
          {t("missing.text", { missing: status.missing.join(", "), host: status.webHost })}
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
    <Container className="divide-y p-0">
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
              <Table.HeaderCell>{t("offers.col.key")}</Table.HeaderCell>
              <Table.HeaderCell>{t("offers.col.product")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow span={6} loading={offers.isLoading} text={t("offers.empty")} />
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
                  <Table.Cell>
                    <KeyCell offer={o} />
                  </Table.Cell>
                  <Table.Cell className="max-w-[260px]">
                    {o.productId ? (
                      <Link to={`/products/${o.productId}`} className="flex flex-col gap-y-0.5 hover:text-ui-fg-interactive">
                        <span className="txt-compact-small-plus truncate text-ui-fg-base">{o.productTitle ?? o.productId}</span>
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{o.sku}</span>
                      </Link>
                    ) : (
                      <Text size="small" className="text-ui-fg-muted">
                        {o.matchKey ? t("offers.noProduct") : ""}
                      </Text>
                    )}
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
    <Container className="divide-y p-0">
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
              <Table.HeaderCell>{t("orders.col.import")}</Table.HeaderCell>
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
                  <Table.Cell className="max-w-[420px]">
                    <div className="flex flex-col gap-y-1.5">
                      {o.lines.map((l, i) => (
                        <div key={`${l.offerId}-${i}`} className="flex flex-col">
                          <span className="txt-compact-small text-ui-fg-base">
                            <span className="tabular-nums text-ui-fg-muted">{l.quantity} x </span>
                            {l.productId ? (
                              <Link to={`/products/${l.productId}`} className="hover:text-ui-fg-interactive">
                                {l.productTitle ?? l.offerName}
                              </Link>
                            ) : (
                              <a href={l.offerUrl} target="_blank" rel="noreferrer" className="hover:text-ui-fg-interactive">
                                {l.offerName}
                              </a>
                            )}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{l.sku ?? l.externalId ?? `#${l.offerId}`}</span>
                            {l.productId ? null : (
                              <Badge size="2xsmall" color="red">
                                {t("orders.noProduct")}
                              </Badge>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{fmtMoney(o.total, lang)}</Table.Cell>
                  <Table.Cell>
                    {o.import ? (
                      <div className="flex flex-col items-start gap-y-1" title={o.import.reason ?? undefined}>
                        <StatusBadge color={IMPORT_TONE[o.import.status] ?? "grey"}>{t(`imports.status.${o.import.status}`)}</StatusBadge>
                        {o.import.orderId ? (
                          <Link to={`/orders/${o.import.orderId}`} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                            {o.import.displayId ? `#${o.import.displayId}` : t("actions.openOrder")}
                          </Link>
                        ) : null}
                      </div>
                    ) : (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {t("orders.notImported")}
                      </Text>
                    )}
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
