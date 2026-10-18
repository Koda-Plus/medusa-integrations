import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath } from "@medusajs/icons"
import { Badge, Container, InlineTip, toast } from "@medusajs/ui"
import type { OfferFilter, OrderFilter, StatusResponse } from "../../../modules/vonhalsky/lib/contract"
import { errorMessage, useImportNow, useRefreshOffers, useSimulateOrder, useVonHalskyStatus, vonHalskyKeys } from "../../lib/vonhalsky-api"
import { AddStoreButton, HelpButtons, IntegrationHeader, ModeBadge, SettingsView, communityLabels, usePageNav, type HeaderAction, type PageNav } from "../../lib/vonhalsky-guide"
import { GuideView, usePromptSpec } from "../../lib/vonhalsky-guide-view"
import { VonHalskyIcon } from "../../lib/vonhalsky-icon"
import { LogSection } from "../../lib/vonhalsky-log"
import { OFFER_FILTERS, OffersSection } from "../../lib/vonhalsky-offers"
import { ORDER_FILTERS, OrdersSection } from "../../lib/vonhalsky-orders"
import { AccountSection, OrderSettingsSection, PricingSection, ShippingSection } from "../../lib/vonhalsky-settings"
import { Chip, StatTile, fmtNumber, modeOf } from "../../lib/vonhalsky-ui"

/**
 * InPost Von Halsky by Koda Plus. Three views, switched in the header and
 * kept in the URL:
 *
 * - Panel: the counters (listed, blocked, imported, to ship, errors) and
 *   three sections: Offers, Orders, Sync log (`?section=`).
 * - Setup guide (`?view=guide`).
 * - Settings (`?view=settings&tab=`): pricing, orders, shipping, account.
 *
 * Deep links from hosts and boards: /vonhalsky?section=orders&filter=held,
 * /vonhalsky?section=offers&filter=blocked, /vonhalsky?section=orders&q=...
 */
const SETTINGS_TABS = ["pricing", "orders", "shipping", "account"] as const
type SettingsTabId = (typeof SETTINGS_TABS)[number]
const SECTIONS = ["offers", "orders", "log"] as const
type SectionId = (typeof SECTIONS)[number]

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

  const tiles: Array<{ key: string; value: string; tone: "default" | "green" | "orange" | "red" | "blue"; go?: () => void; active?: boolean }> = s
    ? [
        { key: "listed", value: fmtNumber(s.counts.listed, lang), tone: s.counts.listed > 0 ? "green" : "default", go: () => (setSection("offers"), setOfferFilter("listed")), active: section === "offers" && offerFilter === "listed" },
        { key: "blocked", value: fmtNumber(s.counts.blocked, lang), tone: s.counts.blocked > 0 ? "orange" : "default", go: () => (setSection("offers"), setOfferFilter("blocked")), active: section === "offers" && offerFilter === "blocked" },
        { key: "orders", value: fmtNumber(s.counts.orders, lang), tone: s.counts.orders > 0 ? "green" : "default", go: () => (setSection("orders"), setOrderFilter("all")), active: section === "orders" && orderFilter === "all" },
        { key: "awaiting_shipment", value: fmtNumber(s.counts.awaiting_shipment, lang), tone: s.counts.awaiting_shipment > 0 ? "blue" : "default", go: () => (setSection("orders"), setOrderFilter("awaiting_shipment")), active: section === "orders" && orderFilter === "awaiting_shipment" },
        { key: "errors", value: fmtNumber(s.counts.errors, lang), tone: s.counts.errors > 0 ? "red" : "default", go: () => (setSection("orders"), setOrderFilter("errors")), active: section === "orders" && orderFilter === "errors" },
      ]
    : []

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
        {s ? <Warnings status={s} /> : null}
        {s && nav.view === "panel" ? (
          <>
            <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-3 xl:grid-cols-5">
              {tiles.map((tile) => (
                <StatTile key={tile.key} label={t(`stats.${tile.key}`)} value={tile.value} tone={tile.tone} active={tile.active} onClick={tile.go} />
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 px-6 py-3">
              {SECTIONS.map((id) => (
                <Chip key={id} active={section === id} label={t(`section.${id}`)} onClick={() => setSection(id)} />
              ))}
            </div>
          </>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} /> : null}
      {s && nav.view === "panel" && section === "offers" ? <OffersSection status={s} lang={lang} filter={offerFilter} onFilter={setOfferFilter} initialQuery={askedSection === "offers" ? initialQuery : ""} /> : null}
      {s && nav.view === "panel" && section === "orders" ? <OrdersSection status={s} lang={lang} filter={orderFilter} onFilter={setOrderFilter} initialQuery={askedSection === "orders" ? initialQuery : ""} /> : null}
      {s && nav.view === "panel" && section === "log" ? <LogSection lang={lang} /> : null}
      {s && nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "pricing", label: t("settings.tab.pricing") },
            { id: "orders", label: t("settings.tab.orders") },
            { id: "shipping", label: t("settings.tab.shipping"), badge: s.settings.shipping.APM && s.settings.shipping.COURIER ? null : "!", tone: "orange" },
            { id: "account", label: t("settings.tab.account"), badge: s.apiPending ? "!" : null, tone: "orange" },
          ]}
        >
          {nav.tab === "pricing" ? <PricingSection status={s} lang={lang} /> : null}
          {nav.tab === "orders" ? <OrderSettingsSection status={s} /> : null}
          {nav.tab === "shipping" ? <ShippingSection status={s} /> : null}
          {nav.tab === "account" ? <AccountSection status={s} /> : null}
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
  const mode = modeOf(status)
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)

  const actions: HeaderAction[] = []
  if (status && status.mode !== "off") {
    actions.push({
      key: "refreshOffers",
      label: t("actions.refreshOffers"),
      loading: refresh.isPending,
      onClick: () =>
        void refresh
          .mutateAsync()
          .then((r) => toast.success(t("toast.refreshed", { read: r.read, created: r.created, blocked: r.blocked })))
          .catch((e) => toast.error(errorMessage(e))),
    })
  }
  if (status?.mode === "demo") {
    actions.push({
      key: "simulate",
      label: t("actions.simulate"),
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
      by={t("by")}
      badges={
        status ? (
          <>
            <ModeBadge color={mode.tone} label={t(`mode.${mode.key}`)} title={t("demo.label")}>
              {status.mode === "demo" ? <DemoDetails /> : null}
            </ModeBadge>
            {status.apiPending ? (
              <Badge size="2xsmall" color="orange">
                {t("mode.pending")}
              </Badge>
            ) : null}
            <Badge size="2xsmall" color={status.options.sendTracking ? "orange" : "grey"}>
              {status.options.sendTracking ? t("mode.tracking") : t("mode.noTracking")}
            </Badge>
          </>
        ) : null
      }
      description={t("subtitle")}
      social={<AddStoreButton labels={community.addStore} />}
      help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
      view={nav.view}
      onView={(v) => nav.go(v)}
      labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("settings.title"), more: t("actions.moreActions") }}
      primary={nav.view !== "guide" ? { key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, onClick: () => void client.invalidateQueries({ queryKey: vonHalskyKeys.all }) } : null}
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

/** Only what needs a person now; the demo note lives in the mode badge. */
function Warnings({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("vonhalsky")
  const notes: Array<{ key: string; variant: "warning" | "error" | "info"; label: string; text: string }> = []
  if (status.mode === "off" && status.missing.length > 0) notes.push({ key: "missing", variant: "warning", label: t("missing.label"), text: t("missing.text", { missing: status.missing.join(", ") }) })
  if (status.problems.length > 0) notes.push({ key: "problems", variant: "warning", label: t("missing.problemsLabel"), text: t("missing.problems", { list: status.problems.join("; ") }) })
  if (status.apiPending) notes.push({ key: "pending", variant: "info", label: t("missing.pendingLabel"), text: t("missing.pending") })
  if (status.mode !== "off" && status.mode !== "demo" && !status.settings.shipping.APM && !status.settings.shipping.COURIER) notes.push({ key: "shipping", variant: "warning", label: t("missing.shippingLabel"), text: t("missing.shipping") })
  const attention = status.counts.held + status.counts.tracking_failed
  if (attention > 0) notes.push({ key: "attention", variant: "error", label: t("missing.attentionLabel"), text: t("missing.attention", { count: attention }) })
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

export const config = defineRouteConfig({
  label: "InPost Von Halsky",
  icon: VonHalskyIcon,
})

export default VonHalskyPage
