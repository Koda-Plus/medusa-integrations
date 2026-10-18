import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath } from "@medusajs/icons"
import { Badge, Container, InlineTip, toast } from "@medusajs/ui"
import type { BasketFilter, StatusResponse } from "../../../modules/inpostpay/lib/contract"
import { errorMessage, inpostPayKeys, useInpostPaySeed, useInpostPayStatus } from "../../lib/inpostpay-api"
import { AddStoreButton, HelpButtons, IntegrationHeader, KitTabRoute, ModeBadge, SettingsView, communityLabels, usePageNav, type HeaderAction, type PageNav } from "../../lib/inpostpay-guide"
import { GuideView, usePromptSpec } from "../../lib/inpostpay-guide-view"
import { InpostPayIcon } from "../../lib/inpostpay-icon"
import { addPageTab, hostedNavIcon } from "../../lib/inpostpay-kit"
import { BasketsSection, DemoDetails, FILTERS } from "../../lib/inpostpay-panel"
import { AccountSection, ButtonSection, DeliverySection } from "../../lib/inpostpay-settings"
import { StatTile, fmtNumber, modeOf } from "../../lib/inpostpay-ui"

/**
 * InPost Pay by Koda Plus. Three views, switched in the header and kept in
 * the URL:
 *
 * - Panel: the counters (bound baskets, linked in the app, orders,
 *   conversion, failed, without payment) and the baskets with the orders
 *   they became, their products, delivery and InPost payment status.
 * - Setup guide (`?view=guide`).
 * - Settings (`?view=settings&tab=`): delivery mapping, the places of the
 *   button, the InPost account with the Merchant API address.
 *
 * Deep links from hosts and boards: /inpostpay?filter=payment_problems, /inpostpay?q=order_...
 *
 * One menu entry for InPost: when the InPost plugin of Koda Plus is
 * installed in the same app, this page is its "InPost Pay" tab
 * (`/inpost?service=pay`), `/inpostpay` redirects there with every
 * parameter and the own sidebar entry steps aside. Without it the page
 * stands alone as before. The plugins meet only in the kit's registry.
 */
const SETTINGS_TABS = ["delivery", "button", "account"] as const
type SettingsTabId = (typeof SETTINGS_TABS)[number]

const InpostPayPage = () => {
  const { t, i18n } = useTranslation("inpostpay")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const status = useInpostPayStatus()
  const s = status.data
  const [params] = useSearchParams()
  const [filter, setFilter] = useState<BasketFilter>(() => {
    const asked = params.get("filter")
    return asked && (FILTERS as readonly string[]).includes(asked) ? (asked as BasketFilter) : "all"
  })
  const initialQuery = (params.get("q") ?? "").slice(0, 100)

  /* Demo mode: sample rows are built once, on the first visit of an empty panel (reads never write). */
  const seed = useInpostPaySeed()
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current || !s || s.mode !== "demo" || s.counts.baskets > 0) return
    asked.current = true
    seed.mutate()
  }, [s]) // eslint-disable-line react-hooks/exhaustive-deps

  const tiles: Array<{ key: string; value: string; tone: "default" | "green" | "orange" | "red" | "blue" | "purple"; filter?: BasketFilter }> = s
    ? [
        { key: "baskets", value: fmtNumber(s.counts.baskets, lang), tone: "default", filter: "all" },
        { key: "linked", value: fmtNumber(s.counts.linked, lang), tone: s.counts.linked > 0 ? "blue" : "default", filter: "linked" },
        { key: "orders", value: fmtNumber(s.counts.orders, lang), tone: s.counts.orders > 0 ? "green" : "default", filter: "ordered" },
        { key: "conversion", value: `${fmtNumber(s.counts.conversion, lang)}%`, tone: "default" },
        { key: "failed", value: fmtNumber(s.counts.failed, lang), tone: s.counts.failed > 0 ? "orange" : "default", filter: "failed" },
        { key: "payment_problems", value: fmtNumber(s.counts.payment_problems, lang), tone: s.counts.payment_problems > 0 ? "red" : "default", filter: "payment_problems" },
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
          <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-3 xl:grid-cols-6">
            {tiles.map((tile) => (
              <StatTile
                key={tile.key}
                label={t(`stats.${tile.key}`)}
                value={tile.value}
                tone={tile.tone}
                active={tile.filter !== undefined && tile.filter !== "all" && filter === tile.filter}
                onClick={tile.filter ? () => setFilter(filter === tile.filter ? "all" : tile.filter!) : undefined}
              />
            ))}
          </div>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} /> : null}
      {s && nav.view === "panel" ? <BasketsSection status={s} lang={lang} filter={filter} onFilter={setFilter} initialQuery={initialQuery} /> : null}
      {s && nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "delivery", label: t("settings.tab.delivery"), badge: Object.values(s.settings.delivery).some(Boolean) ? null : "!", tone: "orange" },
            { id: "button", label: t("settings.tab.button") },
            { id: "account", label: t("settings.tab.account") },
          ]}
        >
          {nav.tab === "delivery" ? <DeliverySection status={s} /> : null}
          {nav.tab === "button" ? <ButtonSection status={s} /> : null}
          {nav.tab === "account" ? <AccountSection status={s} /> : null}
        </SettingsView>
      ) : null}
    </div>
  )
}

function Header({ status, nav, lang }: { status: StatusResponse | undefined; nav: PageNav<SettingsTabId>; lang: string }) {
  const { t } = useTranslation("inpostpay")
  const client = useQueryClient()
  const seed = useInpostPaySeed()
  const mode = modeOf(status)
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)

  const actions: HeaderAction[] = []
  if (status?.mode === "demo") {
    actions.push({
      key: "seed",
      label: t("actions.seed"),
      loading: seed.isPending,
      onClick: () =>
        void seed
          .mutateAsync()
          .then((r) => toast.success(t("toast.seeded", { count: r.created })))
          .catch((e) => toast.error(errorMessage(e))),
    })
  }

  return (
    <IntegrationHeader
      icon={<InpostPayIcon width={28} height={28} />}
      title={t("title")}
      by={t("by")}
      badges={
        status ? (
          <>
            <ModeBadge color={mode.tone} label={t(`mode.${mode.key}`)} title={t("demo.label")}>
              {status.mode === "demo" ? <DemoDetails /> : null}
            </ModeBadge>
            <Badge size="2xsmall" color={status.options.sendOrderEvents ? "orange" : "grey"}>
              {status.options.sendOrderEvents ? t("mode.events") : t("mode.noEvents")}
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
      primary={
        nav.view !== "guide"
          ? { key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, onClick: () => void client.invalidateQueries({ queryKey: inpostPayKeys.all }) }
          : null
      }
      actions={nav.view !== "guide" ? actions : []}
    />
  )
}

/** Only what needs a person now; the demo note lives in the mode badge. */
function Warnings({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("inpostpay")
  const notes: Array<{ key: string; variant: "warning" | "error"; label: string; text: string }> = []
  if (status.mode === "off" && status.missing.length > 0) notes.push({ key: "missing", variant: "warning", label: t("missing.label"), text: t("missing.text", { missing: status.missing.join(", ") }) })
  if (status.problems.length > 0) notes.push({ key: "problems", variant: "warning", label: t("missing.problemsLabel"), text: t("missing.problems", { list: status.problems.join("; ") }) })
  if (status.mode !== "off" && !status.provider.registered) notes.push({ key: "provider", variant: "error", label: t("missing.providerLabel"), text: t("missing.provider", { id: status.provider.id }) })
  if ((status.mode === "live" || status.mode === "sandbox") && !Object.values(status.settings.delivery).some(Boolean)) notes.push({ key: "delivery", variant: "warning", label: t("missing.deliveryLabel"), text: t("missing.delivery") })
  const attention = status.counts.failed + status.counts.payment_problems
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

/* The tab on the InPost page (when that plugin is installed), drawn by this plugin's own page. */
addPageTab({ host: "inpost", id: "pay", ns: "inpostpay", name: "InPost Pay", order: 10, Icon: InpostPayIcon, Component: InpostPayPage })

const InpostPayRoute = () => (
  <KitTabRoute host="inpost" tab="pay">
    <InpostPayPage />
  </KitTabRoute>
)

export const config = defineRouteConfig({
  label: "InPost Pay",
  icon: hostedNavIcon(InpostPayIcon, { host: "inpost", tab: "pay" }),
})

export default InpostPayRoute
