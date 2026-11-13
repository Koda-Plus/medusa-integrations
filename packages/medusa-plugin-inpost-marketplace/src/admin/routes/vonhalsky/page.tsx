import { useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowDownTray, ArrowPath, ArrowUturnLeft, ChartBar, CheckCircle, Clock, ExclamationCircle, History as HistoryIcon, ShieldCheck, ShoppingCart, Sparkles, Tag, TruckFast } from "@medusajs/icons"
import { Container, InlineTip, toast } from "@medusajs/ui"
import type { OfferFilter, OrderFilter, StatusResponse } from "../../../modules/vonhalsky/lib/contract"
import { errorMessage, useImportNow, useRefreshOffers, useSimulateOrder, useSyncNow, useVonHalskyStatus, vonHalskyKeys } from "../../lib/vonhalsky-api"
import { CasesSection } from "../../lib/vonhalsky-cases"
import { HelpButtons, IntegrationHeader, ModeBadge, SettingsView, communityLabels, usePageNav, type HeaderAction, type PageNav } from "../../lib/vonhalsky-guide"
import { GuideView, usePromptSpec } from "../../lib/vonhalsky-guide-view"
import { VonHalskyIcon } from "../../lib/vonhalsky-icon"
import { LogSection } from "../../lib/vonhalsky-log"
import { OFFER_FILTERS, OffersSection } from "../../lib/vonhalsky-offers"
import { ORDER_FILTERS, OrdersSection } from "../../lib/vonhalsky-orders"
import { AccountSection, CategoryMappingSection, OfferDefaultsSection, OrderSettingsSection, PricingSection, ShippingSection } from "../../lib/vonhalsky-settings"
import { StatsSection } from "../../lib/vonhalsky-stats"
import { FilterBar, FilterButton, StatTile, StatTiles, type Tone } from "../../lib/vonhalsky-blocks"
import { fmtDateTime, fmtNumber, modeOf } from "../../lib/vonhalsky-ui"

/**
 * InPost Von Halsky by Koda Plus. Three views, switched in the header and
 * kept in the URL:
 *
 * - Panel: the counters (listed, blocked, imported, to ship, after sale,
 *   errors) and five sections: Offers, Orders, After sale, Statistics,
 *   Sync log (`?section=`).
 * - Setup guide (`?view=guide`).
 * - Settings (`?view=settings&tab=`): pricing, offers, categories, orders,
 *   shipping, account.
 *
 * Deep links from hosts and boards: /vonhalsky?section=orders&filter=held,
 * /vonhalsky?section=offers&filter=pending, /vonhalsky?section=cases,
 * /vonhalsky?section=orders&q=...
 *
 * Its own sidebar entry next to InPost (rank 3), with or without the InPost
 * plugin of Koda Plus in the same app (since 11.11.2026; before, it was the
 * "Von Halsky" tab of the InPost page).
 */
const SETTINGS_TABS = ["pricing", "offers", "categories", "orders", "shipping", "account"] as const
type SettingsTabId = (typeof SETTINGS_TABS)[number]
const SECTIONS = ["offers", "orders", "cases", "stats", "log"] as const
type SectionId = (typeof SECTIONS)[number]
const SECTION_ICON: Record<SectionId, ReactNode> = { offers: <Tag />, orders: <ShoppingCart />, cases: <ArrowUturnLeft />, stats: <ChartBar />, log: <HistoryIcon /> }

const VonHalskyPage = () => {
  const { t, i18n } = useTranslation("vonhalsky")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const status = useVonHalskyStatus()
  const s = status.data
  const [params] = useSearchParams()
  const askedSection = params.get("section")
  const [section, setSection] = useState<SectionId>(() => ((SECTIONS as readonly string[]).includes(askedSection ?? "") ? (askedSection as SectionId) : "offers"))
  const askedFilter = params.get("filter") ?? ""
  const [offerFilter, setOfferFilter] = useState<OfferFilter>(() => (section === "offers" && (OFFER_FILTERS as string[]).includes(askedFilter) ? (askedFilter as OfferFilter) : "all"))
  const [orderFilter, setOrderFilter] = useState<OrderFilter>(() => (section === "orders" && (ORDER_FILTERS as string[]).includes(askedFilter) ? (askedFilter as OrderFilter) : "all"))
  const initialQuery = (params.get("q") ?? "").slice(0, 100)

  /* Demo mode: the offers are read from the catalog once, on the first visit of an empty panel (the status read never writes). */
  const seed = useRefreshOffers()
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current || !s || s.mode !== "demo" || s.counts.offers > 0) return
    asked.current = true
    seed.mutate()
  }, [s]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Each counter opens its list; orange and red only while there is something to do. */
  const tiles: Array<{ key: string; value: string; tone: Tone; icon: ReactNode; go?: () => void; active?: boolean }> = s
    ? [
        { key: "listed", value: fmtNumber(s.counts.listed, lang), tone: s.counts.listed > 0 ? "green" : "grey", icon: <CheckCircle />, go: () => (setSection("offers"), setOfferFilter("listed")), active: section === "offers" && offerFilter === "listed" },
        { key: "blocked", value: fmtNumber(s.counts.blocked + s.counts.pending, lang), tone: s.counts.blocked + s.counts.pending > 0 ? "orange" : "grey", icon: <ExclamationCircle />, go: () => (setSection("offers"), setOfferFilter(s.counts.blocked > 0 || s.counts.pending === 0 ? "blocked" : "pending")), active: section === "offers" && (offerFilter === "blocked" || offerFilter === "pending") },
        { key: "orders", value: fmtNumber(s.counts.orders, lang), tone: s.counts.orders > 0 ? "green" : "grey", icon: <ShoppingCart />, go: () => (setSection("orders"), setOrderFilter("all")), active: section === "orders" && orderFilter === "all" },
        { key: "awaiting_shipment", value: fmtNumber(s.counts.awaiting_shipment, lang), tone: s.counts.awaiting_shipment > 0 ? "blue" : "grey", icon: <Clock />, go: () => (setSection("orders"), setOrderFilter("awaiting_shipment")), active: section === "orders" && orderFilter === "awaiting_shipment" },
        { key: "cases_open", value: fmtNumber(s.counts.cases_open, lang), tone: s.counts.cases_open > 0 ? "orange" : "grey", icon: <ArrowUturnLeft />, go: () => setSection("cases"), active: section === "cases" },
        { key: "errors", value: fmtNumber(s.counts.errors, lang), tone: s.counts.errors > 0 ? "red" : "grey", icon: <ExclamationCircle />, go: () => (setSection("orders"), setOrderFilter("errors")), active: section === "orders" && orderFilter === "errors" },
      ]
    : []
  const sectionCount: Record<SectionId, number | undefined> = {
    offers: s?.counts.offers,
    orders: s?.counts.orders,
    cases: s?.counts.cases_open,
    stats: undefined,
    log: undefined,
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} nav={nav} lang={lang} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s ? <Warnings status={s} lang={lang} /> : null}
        {s && nav.view === "panel" ? (
          <>
            <StatTiles columns={6}>
              {tiles.map((tile) => (
                <StatTile key={tile.key} icon={tile.icon} label={t(`stats.${tile.key}`)} value={tile.value} tone={tile.tone} active={tile.active} onClick={tile.go} />
              ))}
            </StatTiles>
            <FilterBar>
              {SECTIONS.map((id) => (
                <FilterButton key={id} icon={SECTION_ICON[id]} label={t(`section.${id}`)} count={sectionCount[id]} attention={id === "cases"} active={section === id} onClick={() => setSection(id)} />
              ))}
            </FilterBar>
          </>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} /> : null}
      {s && nav.view === "panel" && section === "offers" ? <OffersSection status={s} lang={lang} filter={offerFilter} onFilter={setOfferFilter} initialQuery={askedSection === "offers" ? initialQuery : ""} /> : null}
      {s && nav.view === "panel" && section === "orders" ? <OrdersSection status={s} lang={lang} filter={orderFilter} onFilter={setOrderFilter} initialQuery={askedSection === "orders" ? initialQuery : ""} /> : null}
      {s && nav.view === "panel" && section === "cases" ? <CasesSection status={s} lang={lang} initialQuery={askedSection === "cases" ? initialQuery : ""} /> : null}
      {s && nav.view === "panel" && section === "stats" ? <StatsSection lang={lang} /> : null}
      {s && nav.view === "panel" && section === "log" ? <LogSection lang={lang} /> : null}
      {s && nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "pricing", label: t("settings.tab.pricing") },
            { id: "offers", label: t("settings.tab.offers") },
            { id: "categories", label: t("settings.tab.categories"), badge: s.mode !== "off" && s.categories.count === 0 ? "!" : null, tone: "orange" },
            { id: "orders", label: t("settings.tab.orders") },
            { id: "shipping", label: t("settings.tab.shipping"), badge: s.settings.shipping.APM && s.settings.shipping.COURIER ? null : "!", tone: "orange" },
            { id: "account", label: t("settings.tab.account"), badge: s.mode === "off" ? "!" : null, tone: "orange" },
          ]}
        >
          {nav.tab === "pricing" ? <PricingSection status={s} lang={lang} /> : null}
          {nav.tab === "offers" ? <OfferDefaultsSection status={s} lang={lang} /> : null}
          {nav.tab === "categories" ? <CategoryMappingSection status={s} lang={lang} /> : null}
          {nav.tab === "orders" ? <OrderSettingsSection status={s} /> : null}
          {nav.tab === "shipping" ? <ShippingSection status={s} /> : null}
          {nav.tab === "account" ? <AccountSection status={s} lang={lang} /> : null}
        </SettingsView>
      ) : null}
    </div>
  )
}

function Header({ status, nav, lang }: { status: StatusResponse | undefined; nav: PageNav<SettingsTabId>; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const client = useQueryClient()
  const refresh = useRefreshOffers()
  const simulate = useSimulateOrder()
  const importNow = useImportNow()
  const sync = useSyncNow()
  const mode = modeOf(status)
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)

  /* Refresh first, then what the mode can do. */
  const actions: HeaderAction[] = [{ key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, onClick: () => void client.invalidateQueries({ queryKey: vonHalskyKeys.all }) }]
  if (status && status.mode !== "off") {
    actions.push({
      key: "refreshOffers",
      label: t("actions.refreshOffers"),
      icon: <Tag />,
      loading: refresh.isPending,
      onClick: () =>
        void refresh
          .mutateAsync()
          .then((r) => toast.success(t("toast.refreshed", { read: r.read, created: r.created, blocked: r.blocked })))
          .catch((e) => toast.error(errorMessage(e))),
    })
    actions.push({
      key: "sync",
      label: t("actions.syncNow"),
      icon: <ArrowPath />,
      loading: sync.isPending,
      onClick: () =>
        void sync
          .mutateAsync()
          .then((r) => {
            const failed = Object.values(r.report).filter((p) => p && !p.ok).length
            if (failed > 0) toast.warning(t("toast.syncPartly", { count: failed }))
            else toast.success(t("toast.synced"))
          })
          .catch((e) => toast.error(errorMessage(e))),
    })
  }
  if (status?.mode === "demo") {
    actions.push({
      key: "simulate",
      label: t("actions.simulate"),
      icon: <Sparkles />,
      loading: simulate.isPending,
      onClick: () =>
        void simulate
          .mutateAsync()
          .then((r) => (r.kind === "held" ? toast.warning(t("toast.held", { reason: r.order.error ?? "" })) : toast.success(t("toast.simulated", { number: r.order.display_id ?? r.order.order_id ?? "" }))))
          .catch((e) => toast.error(errorMessage(e))),
    })
  } else if (status && status.mode !== "off") {
    actions.push({
      key: "import",
      label: t("actions.importNow"),
      icon: <ArrowDownTray />,
      loading: importNow.isPending,
      onClick: () =>
        void importNow
          .mutateAsync()
          .then((r) => toast.success(t("toast.imported", { imported: r.imported, held: r.held })))
          .catch((e) => toast.error(errorMessage(e))),
    })
  }

  return (
    <IntegrationHeader
      icon={<VonHalskyIcon width={28} height={28} />}
      title={t("title")}
      badges={
        status ? (
          <>
            <ModeBadge color={mode.tone} label={t(`mode.${mode.key}`)} title={t("demo.label")}>
              {status.mode === "demo" ? <DemoDetails /> : null}
            </ModeBadge>
            {status.counts.commands_pending > 0 ? <ModeBadge color="orange" label={t("mode.commands", { count: status.counts.commands_pending })} /> : null}
          </>
        ) : null
      }
      description={t("subtitle")}
      points={[
        { icon: <Tag />, text: t("points.offers") },
        { icon: <ShieldCheck />, text: t("points.keys") },
        { icon: <ShoppingCart />, text: t("points.orders") },
        { icon: <TruckFast />, text: t("points.tracking") },
        { icon: <ArrowUturnLeft />, text: t("points.afterSale") },
      ]}
      help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
      view={nav.view}
      onView={(v) => nav.go(v)}
      labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("settings.title"), more: t("actions.moreActions") }}
      actions={nav.view !== "guide" ? actions : []}
    />
  )
}

/** The demo note inside the mode badge. */
function DemoDetails() {
  const { t } = useTranslation("vonhalsky")
  return (
    <>
      <p>{t("demo.text")}</p>
      <p>{t("demo.how")}</p>
      <p>{t("demo.orders")}</p>
    </>
  )
}

/**
 * Only what needs a person now; the demo note lives in the mode badge. A lost
 * connection comes first and in red: InPost deactivates the offers of an
 * integration that came apart (the credentials refused on consecutive runs).
 */
function Warnings({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const real = status.mode === "live" || status.mode === "sandbox"
  const notes: Array<{ key: string; variant: "warning" | "error" | "info"; label: string; text: string }> = []
  if (real && !status.connection.ok) {
    notes.push({ key: "connection", variant: "error", label: t("connection.label"), text: t("connection.text", { date: fmtDateTime(status.connection.since, lang), message: status.connection.message ?? "" }) })
  }
  if (status.mode === "off" && status.missing.length > 0) notes.push({ key: "missing", variant: "warning", label: t("missing.label"), text: t("missing.text", { missing: status.missing.join(", ") }) })
  if (status.problems.length > 0) notes.push({ key: "problems", variant: "warning", label: t("missing.problemsLabel"), text: t("missing.problems", { list: status.problems.join("; ") }) })
  if (real && status.categories.count === 0) notes.push({ key: "categories", variant: "info", label: t("missing.categoriesLabel"), text: t("missing.categories") })
  if (real && !status.settings.shipping.APM && !status.settings.shipping.COURIER) notes.push({ key: "shipping", variant: "warning", label: t("missing.shippingLabel"), text: t("missing.shipping") })
  if (status.counts.cases_open > 0) notes.push({ key: "cases", variant: "warning", label: t("missing.casesLabel"), text: t("missing.cases", { count: status.counts.cases_open }) })
  if (status.counts.errors > 0) notes.push({ key: "attention", variant: "error", label: t("missing.attentionLabel"), text: t("missing.attention", { count: status.counts.errors }) })
  if (notes.length === 0) return null
  return (
    <div className="flex flex-col gap-y-2 px-6 py-4">
      {notes.map((n) => (
        <InlineTip key={n.key} variant={n.variant} label={n.label}>
          {n.text}
        </InlineTip>
      ))}
    </div>
  )
}

/* Its own sidebar entry, right under InPost (rank 3, as the InPost plugin), since 11.11.2026:
   before, with the InPost plugin in the same app, the page was the "Von Halsky" tab of the
   InPost page. A marketplace is its own sales channel, not a way to ship, so it stands alone. */
export const config = defineRouteConfig({
  label: "Von Halsky",
  rank: 3,
  icon: VonHalskyIcon,
})

export default VonHalskyPage
