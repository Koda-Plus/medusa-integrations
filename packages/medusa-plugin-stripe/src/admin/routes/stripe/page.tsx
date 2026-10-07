import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Container, InlineTip, toast } from "@medusajs/ui"
import type { PaymentFilter, StripeMode, StripeOverviewResponse, StripeStatusResponse } from "../../../modules/stripe/lib/contract"
import { errorMessage, useStripeChecks, useStripeOverview, useStripeRefresh, useStripeStatus } from "../../lib/stripe-api"
import { AddStoreButton, HelpButtons, IntegrationHeader, ModeBadge, ReferencesBadge, SettingsView, communityLabels, usePageNav, type PageNav } from "../../lib/stripe-guide"
import { GuideView, usePromptSpec } from "../../lib/stripe-guide-view"
import { HealthSection, HealthStrip } from "../../lib/stripe-health"
import { StripeIcon } from "../../lib/stripe-icon"
import { BalanceSection, DemoDetails, DisputesSection, Freshness, MethodsSection, PAYMENT_FILTERS, PaymentsSection, PeriodSwitch, PeriodTiles, ReadErrors, RefundsSection, type PeriodDays } from "../../lib/stripe-panel"
import { AccessTab, ChecksTab, OptionsTab, SETTINGS_TABS, type SettingsTabId } from "../../lib/stripe-settings"
import { fmtRating, referencesFor } from "../../lib/stripe-ui"

/**
 * Stripe by Koda Plus. Three views, switched in the header and kept in the URL:
 *
 * - Panel: the business side. Volume, fees and net for 7 or 30 days, the
 *   health of the setup, the methods, the payments next to their orders,
 *   open disputes with their deadlines, refunds, the balance and payouts.
 * - Setup guide (`?view=guide`): a Polish store from a new Stripe account
 *   to production, each step with its state from the health checks.
 * - Settings (`?view=settings&tab=`), behind the cog: the options in use,
 *   the checks and what each one reads, the access the key needs.
 *
 * The plugin only reads: the one action is Refresh, which reads Stripe again.
 *
 * Deep links from hosts and boards: `?filter=` picks the payments list
 * (`/stripe?filter=attention`, `/stripe?filter=disputed` also scrolls to the
 * open disputes) and `?q=` searches it (`/stripe?q=1042`, an order number).
 */

function scrollToSection(id: string): void {
  if (typeof document === "undefined") return
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
}

const MODE_COLOR: Record<StripeMode, "green" | "orange" | "blue" | "grey" | "purple"> = { demo: "purple", live: "green", test: "orange", unconfigured: "orange" }

const StripePage = () => {
  const { t, i18n } = useTranslation("stripe")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const status = useStripeStatus()
  const s = status.data
  const configured = Boolean(s?.configured)
  const overview = useStripeOverview(Boolean(s) && configured)
  const checks = useStripeChecks(Boolean(s))
  const [days, setDays] = useState<PeriodDays>(30)
  const o = overview.data
  const [params] = useSearchParams()
  const [initialFilter] = useState<PaymentFilter>(() => {
    const asked = params.get("filter")
    return asked && (PAYMENT_FILTERS as readonly string[]).includes(asked) ? (asked as PaymentFilter) : "all"
  })
  const [initialQuery] = useState(() => (params.get("q") ?? "").slice(0, 100))
  /* A link to the open disputes lands on them once the panel has its data. */
  const scrolled = useRef(false)
  useEffect(() => {
    if (scrolled.current || !o || initialFilter !== "disputed") return
    scrolled.current = true
    scrollToSection("stripe-disputes")
  }, [o, initialFilter])
  const summary = checks.data?.summary
  const healthFirst = Boolean(summary && (summary.fail > 0 || summary.warn > 0 || !configured))

  const health = <HealthSection checks={checks.data} loading={checks.isLoading} lang={lang} />

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} overview={o} lang={lang} nav={nav} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s && nav.view !== "guide" ? <Warnings status={s} /> : null}
        {s && nav.view === "panel" && configured && o ? (
          <div className="flex flex-col gap-y-3 px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PeriodSwitch value={days} onChange={setDays} />
              <Freshness overview={o} lang={lang} />
            </div>
            <PeriodTiles overview={o} days={days} lang={lang} onDisputes={() => scrollToSection("stripe-disputes")} />
            <HealthStrip checks={checks.data} onOpen={() => scrollToSection("stripe-health")} />
          </div>
        ) : null}
        {nav.view === "panel" && overview.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(overview.error) })}
            </InlineTip>
          </div>
        ) : null}
        {nav.view === "panel" ? <ReadErrors overview={o} /> : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} checks={checks.data} lang={lang} /> : null}

      {s && nav.view === "panel" ? (
        <>
          {healthFirst ? health : null}
          {configured && o ? (
            <>
              <MethodsSection overview={o} days={days} lang={lang} />
              <PaymentsSection overview={o} lang={lang} initialFilter={initialFilter} initialQuery={initialQuery} />
              <DisputesSection overview={o} lang={lang} />
              <RefundsSection overview={o} lang={lang} />
              <BalanceSection overview={o} lang={lang} />
            </>
          ) : null}
          {healthFirst ? null : health}
        </>
      ) : null}

      {s && nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "options", label: t("settings.tab.options") },
            { id: "checks", label: t("settings.tab.checks"), badge: summary ? summary.fail + summary.warn : null, tone: summary && summary.fail > 0 ? "red" : "orange" },
            { id: "access", label: t("settings.tab.access") },
          ]}
        >
          {nav.tab === "options" ? <OptionsTab status={s} /> : null}
          {nav.tab === "checks" ? <ChecksTab status={s} checks={checks.data} /> : null}
          {nav.tab === "access" ? <AccessTab status={s} /> : null}
        </SettingsView>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Header({ status, overview, lang, nav }: { status: StripeStatusResponse | undefined; overview: StripeOverviewResponse | undefined; lang: string; nav: PageNav<SettingsTabId> }) {
  const { t } = useTranslation("stripe")
  const refresh = useStripeRefresh()
  const references = status ? referencesFor(status.references, lang) : []
  const promptSpec = usePromptSpec(status)
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)
  const dashboard = status?.dashboardUrl ?? "https://dashboard.stripe.com"
  const open = (url: string) => window.open(url, "_blank", "noopener")

  const onRefresh = async () => {
    try {
      const r = await refresh.mutateAsync()
      if (r.overview.fresh || r.checks.fresh) toast.success(t("toast.refreshed"))
      else toast.info(t("toast.cached"))
    } catch (err) {
      toast.error(t("toast.failed", { message: errorMessage(err) }))
    }
  }

  return (
    <IntegrationHeader
      icon={<StripeIcon width={28} height={28} />}
      title={t("title")}
      by={t("by")}
      badges={
        status ? (
          <>
            <ModeBadge color={MODE_COLOR[status.mode]} label={t(`mode.${status.mode}`)} title={t("demo.label")}>
              {status.mode === "demo" ? <DemoDetails /> : null}
            </ModeBadge>
            <Badge size="2xsmall" color="grey">
              {t("mode.readOnly")}
            </Badge>
          </>
        ) : null
      }
      description={t("subtitle")}
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
        nav.view !== "guide" && status
          ? {
              key: "refresh",
              label: refresh.isPending ? t("actions.refreshing") : t("actions.refresh"),
              icon: <ArrowPath />,
              loading: refresh.isPending,
              disabled: !overview && status.configured,
              onClick: () => void onRefresh(),
            }
          : null
      }
      actions={
        status
          ? [
              { key: "dashboard", label: t("actions.dashboard"), icon: <ArrowUpRightOnBox />, onClick: () => open(dashboard) },
              { key: "webhooks", label: t("actions.webhooks"), icon: <ArrowUpRightOnBox />, onClick: () => open(`${dashboard}/webhooks`) },
            ]
          : []
      }
    />
  )
}

/** Only what needs a person now: no key, or a key that cannot read. The demo note lives in the mode badge. */
function Warnings({ status }: { status: StripeStatusResponse }) {
  const { t } = useTranslation("stripe")
  if (status.mode === "demo") return null
  if (status.key.kind === "publishable") {
    return (
      <div className="px-6 py-4">
        <InlineTip variant="error" label={t("missing.label")}>
          {t("missing.publishable")}
        </InlineTip>
      </div>
    )
  }
  if (!status.configured) {
    return (
      <div className="px-6 py-4">
        <InlineTip variant="warning" label={t("missing.label")}>
          {t("missing.text")}
        </InlineTip>
      </div>
    )
  }
  return null
}

export const config = defineRouteConfig({
  label: "Stripe",
  icon: StripeIcon,
})

export default StripePage
