import { Fragment, useEffect, useRef, useState, type ReactNode } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  ArrowDownTray,
  ArrowPath,
  ArrowUpRightOnBox,
  ArrowUturnLeft,
  Beaker,
  CheckCircle,
  Clock,
  CloudArrowDown,
  CubeSolid,
  DocumentText,
  ExclamationCircle,
  EyeSlash,
  Key,
  Link as LinkIcon,
  ListBullet,
  LockClosedSolid,
  PaperPlane,
  ShieldCheck,
  ShoppingCart,
  Tag,
  XCircle,
} from "@medusajs/icons"
import { Button, Container, InlineTip, Table, Text, toast } from "@medusajs/ui"
import type { CardDto, CardFilter, CheckResult, OrderFilter, StatusResponse, SyncWhat } from "../../../modules/baselinker/lib/contract"
import {
  baselinkerKeys,
  errorMessage,
  useBaseLinkerCards,
  useBaseLinkerCheck,
  useBaseLinkerDemoPrepare,
  useBaseLinkerOrders,
  useBaseLinkerRunning,
  useBaseLinkerRuns,
  useBaseLinkerSend,
  useBaseLinkerStatus,
  useBaseLinkerStock,
  useBaseLinkerSync,
} from "../../lib/baselinker-api"
import { FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, StatTile, StatTiles, ToneBadge } from "../../lib/baselinker-blocks"
import { AddStoreButton, HelpButtons, IntegrationHeader, KeyPoints, ModeBadge, ReferencesBadge, SettingsView, communityLabels, usePageNav, type HeaderAction, type PageNav } from "../../lib/baselinker-guide"
import { GuideView, usePromptSpec } from "../../lib/baselinker-guide-view"
import { BaseLinkerIcon } from "../../lib/baselinker-icon"
import { KitFetchingBar, KitLoading } from "../../lib/baselinker-kit"
import {
  DemoDetails,
  DirectionsSection,
  ImportsSection,
  InvoicesSection,
  PAGE_SIZE,
  Pagination,
  PlanSection,
  ReturnsSection,
  TableBodyState,
  pick,
  toggleFilter,
  useDebounced,
  useDeepLink,
} from "../../lib/baselinker-panel"
import {
  ChangeStatusBadge,
  ConflictBadge,
  Fact,
  MedusaColumn,
  OrderStatusBadge,
  RunStatusBadge,
  StoreLink,
  StoreOrderCell,
  Thumb,
  connectionState,
  fmtDateTime,
  fmtDelta,
  fmtDuration,
  fmtNumber,
  fmtRating,
  kitReferences,
  runSummary,
  useProductThumbs,
} from "../../lib/baselinker-ui"

/**
 * BaseLinker by Koda Plus. Three views, switched in the header and kept in the URL:
 *
 * - Panel: the business side. Counters, the BaseLinker cards next to the
 *   store products they are linked to, the store orders sent to BaseLinker,
 *   the marketplace orders imported into the store and the returns, each row
 *   with its Medusa product or order one click away.
 * - Setup guide (`?view=guide`).
 * - Settings (`?view=settings&tab=`), behind the cog: the technical side.
 *   Directions and writers, the BaseLinker account, the plans, invoice
 *   numbers and the sync history.
 *
 * The demo note and the stores running the integration sit in header badges.
 */
const SETTINGS_TABS = ["directions", "account", "plans", "invoices", "runs"] as const
type SettingsTabId = (typeof SETTINGS_TABS)[number]

const BaseLinkerPage = () => {
  const { t, i18n } = useTranslation("baselinker")
  const lang = i18n.language || "en"
  const client = useQueryClient()
  const nav = usePageNav(SETTINGS_TABS)
  const [pollUntil, setPollUntil] = useState(0)
  const status = useBaseLinkerStatus()
  const s = status.data
  /* While something runs (or right after an action) only the light /running read is polled;
     the full status is read again when what runs changes. */
  const running = useBaseLinkerRunning((s?.running.length ?? 0) > 0, pollUntil)
  const runningKey = JSON.stringify([running.data?.running ?? null, running.data?.demoPrepared ?? null])
  const seenRunning = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!running.data) return
    if (seenRunning.current !== undefined && seenRunning.current !== runningKey) void client.invalidateQueries({ queryKey: baselinkerKeys.status })
    seenRunning.current = runningKey
  }, [runningKey, running.data, client])
  const polling = (running.data?.running.length ?? s?.running.length ?? 0) > 0 || Date.now() < pollUntil
  const cardLink = useDeepLink("cards")
  const [cardFilter, setCardFilter] = useState<CardFilter>(() => pick(cardLink.filter, CARD_FILTERS, "all"))
  useEffect(() => {
    if (cardLink.filter) setCardFilter(pick(cardLink.filter, CARD_FILTERS, "all"))
  }, [cardLink.filter])

  /* A deep link (a board counter, a summary, a widget) opens one list: its section scrolls into view,
     and the sections start over with the filter and search of the address when it changes. */
  const [params, setParams] = useSearchParams()
  const deepKey = ["section", "filter", "q", "tab"].map((k) => params.get(k) ?? "").join("|")
  /* A tile is a filter of the cards below; a second click on the active one clears it. */
  const tileFilter = (next: CardFilter) => {
    setCardFilter((cur) => toggleFilter(cur, next, "all"))
    document.getElementById("baselinker-cards")?.scrollIntoView({ block: "start", behavior: "smooth" })
  }
  /* The failed orders tile opens the orders list on that filter, like a deep link. */
  const openOrders = (filter: OrderFilter) => {
    const p = new URLSearchParams(params)
    p.set("section", "orders")
    p.set("filter", filter)
    p.delete("q")
    setParams(p, { replace: true })
  }
  const section = params.get("section")
  useEffect(() => {
    if (!section || !s) return
    document.getElementById(`baselinker-${section}`)?.scrollIntoView({ block: "start", behavior: "smooth" })
  }, [section, Boolean(s)])

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
        <Header status={s} lang={lang} nav={nav} onAction={poll} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s ? <Warnings status={s} /> : null}
        {s?.demo && !s.demo.prepared ? <DemoPreparing onDone={() => setPollUntil(Date.now() + 30_000)} /> : null}
        {!s && status.isLoading ? <KitLoading label={t("loading")} /> : null}
        {s && nav.view === "panel" ? (
          <StatTiles columns={4}>
            <StatTile label={t("stats.cards")} value={fmtNumber(s.counts.cards, lang)} active={cardFilter === "all"} onClick={() => tileFilter("all")} />
            <StatTile label={t("stats.linked")} value={fmtNumber(s.counts.linked, lang)} tone="green" active={cardFilter === "linked"} onClick={() => tileFilter("linked")} />
            <StatTile label={t("stats.unmatched")} value={fmtNumber(s.counts.unmatched, lang)} tone="blue" active={cardFilter === "unmatched"} onClick={() => tileFilter("unmatched")} />
            <StatTile
              label={t("stats.conflicts")}
              value={fmtNumber(s.counts.conflicts, lang)}
              tone={s.counts.conflicts > 0 ? "red" : "grey"}
              active={cardFilter === "conflicts"}
              onClick={() => tileFilter("conflicts")}
            />
            <StatTile label={t("stats.onlyInMedusa")} value={fmtNumber(s.counts.onlyInMedusa, lang)} tone={s.counts.onlyInMedusa > 0 ? "orange" : "grey"} />
            <StatTile
              label={t("stats.stockChanges")}
              value={fmtNumber(s.counts.stockChanges, lang)}
              tone={s.counts.stockChanges > 0 ? "orange" : "grey"}
              onClick={s.options.stockSync !== "off" ? () => nav.go("settings", "plans") : undefined}
            />
            <StatTile label={t("stats.sent24h")} value={fmtNumber(s.counts.ordersSent24h, lang)} tone="green" />
            <StatTile label={t("stats.failed")} value={fmtNumber(s.counts.ordersFailed, lang)} tone={s.counts.ordersFailed > 0 ? "red" : "grey"} onClick={() => openOrders("failed")} />
          </StatTiles>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} lang={lang} /> : null}

      {s && nav.view === "panel" ? (
        <>
          <div id="baselinker-cards">
            <CardsSection key={deepKey} status={s} lang={lang} filter={cardFilter} onFilter={setCardFilter} />
          </div>
          <div id="baselinker-orders">
            <OrdersSection key={deepKey} status={s} lang={lang} poll={polling} onAction={poll} />
          </div>
          <div id="baselinker-imports">
            <ImportsSection key={deepKey} status={s} lang={lang} poll={polling} />
          </div>
          {s.more.returnsSync || s.counts2.returns > 0 ? (
            <div id="baselinker-returns">
              <ReturnsSection status={s} lang={lang} />
            </div>
          ) : null}
        </>
      ) : null}

      {s && nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "directions", label: t("settings.tab.directions"), badge: s.writers.filter((w) => w.live).length, tone: "orange" },
            { id: "account", label: t("settings.tab.account") },
            { id: "plans", label: t("settings.tab.plans"), badge: s.counts2.quarantined, tone: "red" },
            { id: "invoices", label: t("settings.tab.invoices"), badge: s.counts2.invoices.conflict + s.counts2.invoices.failed, tone: "red" },
            { id: "runs", label: t("settings.tab.runs") },
          ]}
        >
          {nav.tab === "directions" ? <DirectionsSection status={s} lang={lang} /> : null}
          {nav.tab === "account" ? <ConnectionSection status={s} lang={lang} /> : null}
          {nav.tab === "plans" ? (
            <>
              {s.directions.catalog === "baselinker" ? (
                <PlanSection key={`catalog_import|${deepKey}`} kind="catalog_import" status={s} lang={lang} />
              ) : (
                <PlanSection key={`cards|${deepKey}`} kind="cards" status={s} lang={lang} />
              )}
              {s.options.stockSync !== "off" ? (
                s.directions.stock === "medusa" ? (
                  <PlanSection key={`stock_push|${deepKey}`} kind="stock_push" status={s} lang={lang} />
                ) : (
                  <StockSection key={`stock|${deepKey}`} status={s} lang={lang} />
                )
              ) : null}
              {s.directions.catalog === "medusa" && s.more.priceGroupId !== null ? <PlanSection key={`prices|${deepKey}`} kind="prices" status={s} lang={lang} /> : null}
            </>
          ) : null}
          {nav.tab === "invoices" ? <InvoicesSection status={s} lang={lang} /> : null}
          {nav.tab === "runs" ? <RunsSection lang={lang} poll={polling} /> : null}
        </SettingsView>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Header({
  status,
  lang,
  nav,
  onAction,
}: {
  status: StatusResponse | undefined
  lang: string
  nav: PageNav<SettingsTabId>
  onAction: () => void
}) {
  const { t } = useTranslation("baselinker")
  const sync = useBaseLinkerSync()
  const client = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const running = new Set(status?.running ?? [])
  const f = status?.features
  const f2 = status?.features2
  const state = connectionState(status)
  const references = status ? kitReferences(status.references ?? [], lang) : []
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)

  const start = async (what: SyncWhat) => {
    try {
      const r = await sync.mutateAsync(what)
      if (r.alreadyRunning) toast.info(t("toast.already"))
      else toast.success(t("toast.started"))
      onAction()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      await client.invalidateQueries({ queryKey: baselinkerKeys.all })
    } finally {
      setRefreshing(false)
    }
  }

  const panel = nav.view !== "guide"
  /* One main action (the card sync); Refresh first, then the order runs, statuses and returns, each its own button. */
  const step = (what: SyncWhat, label: string, icon: ReactNode, enabled = true): HeaderAction => ({
    key: what,
    label: running.has(what) ? t("actions.running") : label,
    icon,
    loading: sync.isPending && sync.variables === what,
    disabled: !enabled || running.has(what),
    onClick: () => void start(what),
  })
  const more: HeaderAction[] = [
    { key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, loading: refreshing, onClick: () => void refresh() },
    ...(panel
      ? [
          step("orders", t("actions.sendQueue"), <PaperPlane />, Boolean(f?.orders)),
          ...(f2?.orderImport ? [step("imports", t("actions.importOrders"), <ArrowDownTray />)] : []),
          step("statuses", t("actions.syncStatuses"), <Clock />, Boolean(f?.statuses)),
          ...(f2?.returns ? [step("returns", t("actions.readReturns"), <ArrowUturnLeft />)] : []),
        ]
      : []),
  ]
  const live = status?.writers.filter((w) => w.live).length ?? 0

  return (
    <IntegrationHeader
      icon={<BaseLinkerIcon width={28} height={28} />}
      title={t("title")}
      badges={
        status ? (
          <ModeBadge color={state.tone} label={t(`mode.${state.key}`)} title={t("demo.label")}>
            {status.mode === "demo" ? <DemoDetails status={status} /> : null}
          </ModeBadge>
        ) : null
      }
      description={t("subtitle")}
      points={[
        { icon: <LinkIcon />, text: t("points.cards") },
        { icon: <CubeSolid />, text: t("points.stock") },
        { icon: <PaperPlane />, text: t("points.ordersOut") },
        { icon: <ShoppingCart />, text: t("points.ordersIn") },
        { icon: <LockClosedSolid />, text: t("points.plans"), tone: live > 0 ? "orange" : "green" },
        status?.mode === "demo" && { icon: <Beaker />, text: t("points.demo"), tone: "blue" },
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
              key: "catalog",
              label: running.has("catalog") ? t("actions.running") : t("actions.syncCatalog"),
              icon: <CloudArrowDown />,
              loading: sync.isPending && sync.variables === "catalog",
              disabled: !f?.catalog || running.has("catalog"),
              onClick: () => void start("catalog"),
            }
          : null
      }
      actions={more}
    />
  )
}

/** Only what needs a person now: the options a live store still misses. The demo note lives in the mode badge. */
function Warnings({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("baselinker")
  if (status.mode !== "live" || status.missing.length === 0) return null
  return (
    <div className="px-6 py-4">
      <InlineTip variant="warning" label={t("missing.label")}>
        {t("missing.text", { missing: status.missing.join(", ") })}
      </InlineTip>
    </div>
  )
}

/** Demo mode before the first snapshot: the demo job builds it within a minute, or a person does it now. A read never builds it. */
function DemoPreparing({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation("baselinker")
  const prepare = useBaseLinkerDemoPrepare()
  const run = async () => {
    try {
      await prepare.mutateAsync()
      toast.success(t("demo.preparing.done"))
      onDone()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
      <InlineTip variant="info" label={t("demo.preparing.label")} className="min-w-0 flex-1">
        {t("demo.preparing.text")}
      </InlineTip>
      <Button size="small" variant="secondary" isLoading={prepare.isPending} onClick={() => void run()}>
        {t("demo.preparing.action")}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CheckLines({ result, configured, more }: { result: CheckResult; configured: StatusResponse["options"]; more: StatusResponse["more"] }) {
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
  /* The price group the import reads and the price push writes: it must exist, be a standard group, and be in the Medusa currency. */
  const groups = result.priceGroups ?? []
  if (more.priceGroupId !== null && groups.length > 0) {
    const group = groups.find((g) => g.id === more.priceGroupId)
    if (!group) lines.push({ ok: false, text: t("connection.priceGroupMissing", { id: more.priceGroupId, list: groups.map((g) => `${g.id} ${g.name}`).join(", ") }) })
    else if (group.derived) lines.push({ ok: false, text: t("connection.priceGroupDerived", { id: group.id, name: group.name }) })
    else if (group.currency && group.currency.toLowerCase() !== more.priceCurrency.toLowerCase())
      lines.push({ ok: false, text: t("connection.priceGroupCurrency", { id: group.id, currency: group.currency, medusa: more.priceCurrency.toUpperCase() }) })
    else lines.push({ ok: true, text: t("connection.priceGroupFound", { id: group.id, name: group.name, currency: group.currency }) })
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

/** What the account has (from the last check), to pick the ids of the options from. */
function CheckLists({ result }: { result: CheckResult }) {
  const { t } = useTranslation("baselinker")
  if (!result.ok) return null
  const blocks: Array<{ label: string; items: string[] }> = [
    { label: t("connection.priceGroups"), items: (result.priceGroups ?? []).map((g) => `${g.id} ${g.name} (${g.currency}${g.derived ? `, ${t("connection.derived")}` : ""})`) },
    {
      label: t("connection.warehouseList"),
      items: (result.warehouseDetails ?? []).map((w) => `${w.key} ${w.name} (${w.editable && w.type === "bl" ? t("connection.takesStock") : t("connection.externalStock")})`),
    },
    { label: t("connection.sources"), items: (result.orderSources ?? []).map((s) => `${s.type}:${s.id} ${s.name}`) },
    { label: t("connection.statusList"), items: (result.statuses ?? []).map((s) => `${s.id} ${s.name}`) },
    { label: t("connection.extraFields"), items: (result.extraFields ?? []).map((f) => `custom:${f.id} ${f.name}`) },
  ].filter((b) => b.items.length > 0)
  if (blocks.length === 0 && !result.journal) return null
  return (
    <div className="flex flex-col gap-y-3 px-6 py-4">
      <Text size="xsmall" className="text-ui-fg-muted">
        {t("connection.lists")}
      </Text>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {blocks.map((b) => (
          <Fact key={b.label} label={b.label} mono>
            <span className="flex flex-col gap-y-0.5">
              {b.items.slice(0, 12).map((item) => (
                <span key={item}>{item}</span>
              ))}
            </span>
          </Fact>
        ))}
        {result.journal ? <Fact label={t("connection.journal")}>{t(`connection.journalStates.${result.journal}`)}</Fact> : null}
      </div>
    </div>
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
    <Section
      icon={<Key />}
      title={t("connection.title")}
      pointsLabel={demo ? t("connection.demoNote") : t("connection.subtitle")}
      points={[
        demo ? { icon: <Beaker />, text: t("connection.points.demo"), tone: "blue" } : { icon: <EyeSlash />, text: t("connection.points.token"), tone: "green" },
        { icon: <CloudArrowDown />, text: t("connection.points.reads") },
        { icon: <LockClosedSolid />, text: t("connection.points.writes") },
      ]}
      actions={
        <Button size="small" variant="secondary" isLoading={check.isPending} disabled={!demo && !status.tokenSet} onClick={() => void onCheck()}>
          <ShieldCheck />
          {t("actions.check")}
        </Button>
      }
    >
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
        <Fact label={t("connection.priceGroup")} mono>
          {status.more.priceGroupId ?? t("connection.notSet")}
        </Fact>
        <Fact label={t("connection.source")} mono>
          {o.customSourceId ?? t("connection.none")}
        </Fact>
        <Fact label={t("connection.location")} mono>
          {o.stockLocationId ?? <span className="font-sans">{t("connection.locationAuto")}</span>}
        </Fact>
        <Fact label={t("connection.stockMode")}>
          <ToneBadge tone={stockTone}>{t(`connection.stockModes.${o.stockSync}`)}</ToneBadge>
        </Fact>
        <Fact label={t("connection.ordersMode")}>
          <ToneBadge tone={o.exportOrders ? "green" : "grey"}>{o.exportOrders ? t("connection.ordersOn") : t("connection.ordersOff")}</ToneBadge>
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
          <CheckLines result={result} configured={o} more={status.more} />
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("connection.checkedAt", { time: fmtDateTime(result.checkedAt, lang) })}
          </Text>
        </div>
      ) : null}
      {result ? <CheckLists result={result} /> : null}
      <div className="px-6 py-3">
        <KeyPoints
          label={t("connection.schedule")}
          items={[
            { icon: <Clock />, text: t("connection.schedulePoints.cards") },
            { icon: <Clock />, text: t("connection.schedulePoints.queue") },
            { icon: <Clock />, text: t("connection.schedulePoints.imports") },
            { icon: <Clock />, text: t("connection.schedulePoints.statuses") },
            { icon: <Clock />, text: t("connection.schedulePoints.returns") },
          ]}
        />
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

function StockSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("baselinker")
  const link = useDeepLink("plans")
  const [search, setSearch] = useState(link.q)
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
  const writer = status.writers.find((w) => w.key === "stockToMedusa")

  const modeKey = demo ? "demo" : o.stockSync === "off" ? "off" : writer?.live ? "write" : "plan"
  const max = fmtNumber(o.maxStockChangesPerRun, lang)
  const modeText = modeKey === "demo" ? t("stock.modeDemo") : modeKey === "off" ? t("stock.modeOff") : modeKey === "write" ? t("stock.modeWrite", { max }) : t("stock.modePlan")
  const thumbs = useProductThumbs(rows.map((c) => c.productId))

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
    <Section
      icon={<CubeSolid />}
      title={t("stock.title")}
      badges={run ? <RunStatusBadge status={run.status} /> : null}
      pointsLabel={t("stock.subtitle")}
      points={[
        {
          icon: <LockClosedSolid />,
          text: modeKey === "write" ? t("stock.modeShort.write", { max }) : t(`stock.modeShort.${modeKey}`),
          tone: modeKey === "write" ? "orange" : modeKey === "demo" ? "blue" : "grey",
          title: modeText,
        },
        run ? { icon: <Clock />, text: t("stock.plannedAt", { time: fmtDateTime(run.startedAt, lang) }), title: runSummary(run, t) } : { icon: <Clock />, text: t("stock.never") },
        { icon: <CloudArrowDown />, text: t("stock.points.formula") },
        { icon: <ShieldCheck />, text: t("stock.points.noZero"), tone: "green" },
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("stock.search")} />}
    >
      {summary.length > 0 ? (
        <StatTiles columns={4}>
          {summary.map(([label, value]) => (
            <StatTile key={label} label={label} value={value} />
          ))}
        </StatTiles>
      ) : null}
      <KitFetchingBar active={stock.isFetching && !stock.isLoading} />
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
              <TableBodyState cols={6} loading={stock.isLoading} icon={<CubeSolid />} title={run ? t("stock.empty") : t("stock.never")} />
            ) : (
              rows.map((c) => (
                <Table.Row key={c.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-[340px]">
                    {c.productId ? (
                      <Link to={`/products/${c.productId}`} className="group flex items-center gap-x-2.5 hover:text-ui-fg-interactive">
                        <Thumb src={thumbs[c.productId]} />
                        <span className="flex min-w-0 flex-col gap-y-0.5">
                          <span className="txt-compact-small-plus truncate text-ui-fg-base">{c.productTitle ?? c.productId}</span>
                          <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{c.sku}</span>
                        </span>
                      </Link>
                    ) : (
                      <span className="font-mono txt-compact-small">{c.sku ?? c.variantId}</span>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <div className="flex flex-col items-end">
                      <span className="tabular-nums">{c.medusaStocked === null ? t("stock.noLevel") : fmtNumber(c.medusaStocked, lang)}</span>
                      {c.medusaReserved > 0 ? <span className="text-ui-fg-muted txt-compact-xsmall">{t("stock.reserved", { count: c.medusaReserved })}</span> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className={c.blStock < 0 ? "text-right tabular-nums text-ui-tag-red-text" : "text-right tabular-nums"}>{fmtNumber(c.blStock, lang)}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {fmtNumber(c.target, lang)}
                    {c.afterStocked !== null && c.afterStocked !== c.target ? <span className="text-ui-tag-orange-text"> ({fmtNumber(c.afterStocked, lang)})</span> : null}
                  </Table.Cell>
                  <Table.Cell className={c.delta < 0 ? "text-right tabular-nums text-ui-tag-red-text" : "text-right tabular-nums text-ui-tag-green-text"}>{fmtDelta(c.delta, lang)}</Table.Cell>
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
    </Section>
  )
}

/* ------------------------------------------------------------------ */

const CARD_FILTERS: CardFilter[] = ["all", "linked", "unmatched", "conflicts", "nosku"]

const CARD_FILTER_ICON: Record<CardFilter, ReactNode> = {
  all: <ListBullet />,
  linked: <LinkIcon />,
  unmatched: <CloudArrowDown />,
  conflicts: <ExclamationCircle />,
  nosku: <XCircle />,
}

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

function CardsSection({ status, lang, filter, onFilter }: { status: StatusResponse; lang: string; filter: CardFilter; onFilter: (f: CardFilter) => void }) {
  const { t } = useTranslation("baselinker")
  const link = useDeepLink("cards")
  const [search, setSearch] = useState(link.q)
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])
  const cards = useBaseLinkerCards(filter, q, page * PAGE_SIZE, PAGE_SIZE)
  const rows = cards.data?.cards ?? []
  const thumbs = useProductThumbs(rows.map((c) => c.productId))
  const onlyInMedusa = (status.lastRuns.catalog?.counts?.onlyInMedusaSkus ?? []) as string[]

  return (
    <Section
      icon={<Tag />}
      title={t("cards.title")}
      pointsLabel={`${t("cards.subtitle")} ${t("cards.matching")}`}
      points={[
        { icon: <LinkIcon />, text: t("cards.points.key") },
        { icon: <ExclamationCircle />, text: t("cards.points.duplicates") },
        { icon: <EyeSlash />, text: t("cards.points.nothing") },
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("cards.search")} />}
    >
      <FilterBar>
        {CARD_FILTERS.map((f, i) => (
          <Fragment key={f}>
            {i === 1 ? <FilterDivider /> : null}
            <FilterButton
              icon={CARD_FILTER_ICON[f]}
              label={t(`cards.filter.${f}`)}
              count={cardCount(status, f)}
              attention={f === "conflicts"}
              active={filter === f}
              onClick={() => onFilter(toggleFilter(filter, f, "all"))}
            />
          </Fragment>
        ))}
      </FilterBar>
      <KitFetchingBar active={cards.isFetching && !cards.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("cards.col.card")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("cards.col.stock")}</Table.HeaderCell>
              <Table.HeaderCell>
                <MedusaColumn label={t("cards.col.product")} hint={t("cards.matching")} />
              </Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <TableBodyState cols={3} loading={cards.isLoading} icon={<Tag />} title={t("cards.empty")} />
            ) : (
              rows.map((c) => (
                <Table.Row key={c.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-[380px]">
                    <div className="flex flex-col gap-y-1">
                      <span className="txt-compact-small-plus truncate text-ui-fg-base">{c.name || "-"}</span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">#{c.blProductId}</span>
                        {c.sku ? (
                          <span className="text-ui-fg-muted txt-compact-xsmall">
                            {t("cards.source.sku")} <span className="font-mono text-ui-fg-subtle">{c.sku}</span>
                          </span>
                        ) : null}
                        {c.ean ? (
                          <span className="text-ui-fg-muted txt-compact-xsmall">
                            {t("cards.source.ean")} <span className="font-mono text-ui-fg-subtle">{c.ean}</span>
                          </span>
                        ) : null}
                        {c.parentId ? <span className="text-ui-fg-muted txt-compact-xsmall">{t("cards.variantOf", { id: c.parentId })}</span> : null}
                        {c.isContainer ? <ToneBadge tone="blue">{t("productWidget.container")}</ToneBadge> : null}
                        {c.demo ? <ToneBadge tone="purple">{t("cards.sample")}</ToneBadge> : null}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className={c.stock !== null && c.stock < 0 ? "text-right tabular-nums text-ui-tag-red-text" : "text-right tabular-nums"}>
                    {c.stock === null ? "" : fmtNumber(c.stock, lang)}
                  </Table.Cell>
                  <Table.Cell className="max-w-[300px]">
                    <StoreProductCell card={c} thumb={c.productId ? thumbs[c.productId] : null} />
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
    </Section>
  )
}

/** The store side of a card: the Medusa product of its variant (with its picture), one click away, or why there is none. */
function StoreProductCell({ card: c, thumb }: { card: CardDto; thumb?: string | null }) {
  const { t } = useTranslation("baselinker")
  const keyTitle = c.matchKey ? `${c.matchKey}${c.matchSource ? ` (${t(`cards.source.${c.matchSource}`)})` : ""}` : undefined
  if (c.productId) {
    return (
      <StoreLink
        to={`/products/${c.productId}`}
        name={c.productTitle ?? c.productId}
        detail={c.variantSku ?? c.matchKey}
        detailTitle={keyTitle}
        open={t("actions.openProduct")}
        thumb={thumb}
      />
    )
  }
  if (c.isContainer) {
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        {t("productWidget.containerNote")}
      </Text>
    )
  }
  if (c.conflict || c.matchKey) {
    return (
      <div className="flex flex-col items-start gap-y-1">
        {c.conflict ? <ConflictBadge conflict={c.conflict} /> : <ToneBadge tone="orange">{t("cards.noVariant")}</ToneBadge>}
        {c.matchKey ? (
          <span className="font-mono text-ui-fg-muted txt-compact-xsmall" title={keyTitle}>
            {c.matchKey}
          </span>
        ) : null}
      </div>
    )
  }
  return (
    <Text size="small" className="text-ui-fg-muted">
      {t("cards.noKey")}
    </Text>
  )
}

/* ------------------------------------------------------------------ */

const ORDER_FILTERS: OrderFilter[] = ["all", "pending", "sent", "failed", "skipped"]

const ORDER_FILTER_ICON: Record<OrderFilter, ReactNode> = {
  all: <ListBullet />,
  pending: <Clock />,
  sent: <CheckCircle />,
  failed: <ExclamationCircle />,
  skipped: <XCircle />,
}

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
  const link = useDeepLink("orders")
  const [filter, setFilter] = useState<OrderFilter>(() => pick(link.filter, ORDER_FILTERS, link.q ? "all" : status.counts.ordersFailed > 0 ? "failed" : "all"))
  const [search, setSearch] = useState(link.q)
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
    <Section
      icon={<PaperPlane />}
      title={t("orders.title")}
      pointsLabel={`${t("orders.subtitle")} ${t("orders.how")}`}
      points={[
        { icon: <ShieldCheck />, text: t("orders.points.once"), tone: "green" },
        { icon: <ArrowPath />, text: t("orders.points.retry") },
        !status.options.exportOrders && { icon: <XCircle />, text: t("orders.points.exportOff"), tone: "orange", title: t("orders.exportOff") },
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("orders.search")} />}
    >
      <FilterBar>
        {ORDER_FILTERS.map((f, i) => (
          <Fragment key={f}>
            {i === 1 ? <FilterDivider /> : null}
            <FilterButton
              icon={ORDER_FILTER_ICON[f]}
              label={t(`orders.filter.${f}`)}
              count={orderCount(status, f)}
              attention={f === "failed"}
              active={filter === f}
              onClick={() => setFilter(toggleFilter(filter, f, "all"))}
            />
          </Fragment>
        ))}
      </FilterBar>
      <KitFetchingBar active={orders.isFetching && !orders.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>
                <MedusaColumn label={t("orders.col.order")} hint={t("orders.how")} />
              </Table.HeaderCell>
              <Table.HeaderCell>{t("orders.col.bl")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.col.blStatus")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.col.tracking")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("orders.col.attempts")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.col.details")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <TableBodyState cols={8} loading={orders.isLoading} icon={<PaperPlane />} title={t("orders.empty")} />
            ) : (
              rows.map((o) => (
                <Table.Row key={o.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-[260px]">
                    <StoreOrderCell orderId={o.orderId} displayId={o.displayId} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap font-mono txt-compact-small">{o.blOrderId ?? ""}</Table.Cell>
                  <Table.Cell>
                    <OrderStatusBadge status={o.status} />
                  </Table.Cell>
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
                    <RowActions
                      actions={[
                        {
                          key: "send",
                          label: t("actions.sendAgain"),
                          icon: <PaperPlane />,
                          hidden: !(status.features.orders && (o.status === "failed" || (o.status === "pending" && o.attempts > 0))),
                          loading: send.isPending && send.variables === o.orderId,
                          onClick: () => void onSend(o.orderId),
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
      <Pagination count={orders.data?.count ?? 0} page={page} onPage={setPage} />
    </Section>
  )
}

/* ------------------------------------------------------------------ */

function RunsSection({ lang, poll }: { lang: string; poll: boolean }) {
  const { t } = useTranslation("baselinker")
  const runs = useBaseLinkerRuns(poll)
  const rows = runs.data?.runs ?? []
  return (
    <Section
      icon={<Clock />}
      title={t("runs.title")}
      pointsLabel={t("runs.subtitle")}
      points={[
        { icon: <ArrowPath />, text: t("runs.points.background") },
        { icon: <DocumentText />, text: t("runs.points.newest") },
      ]}
    >
      <KitFetchingBar active={runs.isFetching && !runs.isLoading} />
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
              <TableBodyState cols={5} loading={runs.isLoading} icon={<Clock />} title={t("runs.empty")} />
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
    </Section>
  )
}

export const config = defineRouteConfig({
  label: "BaseLinker",
  rank: 2,
  icon: BaseLinkerIcon,
})

export default BaseLinkerPage
