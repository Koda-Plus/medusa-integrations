import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpRightOnBox, ChartBar, CommandLine, ExclamationCircle, Eye, Key, LockClosedSolid, ServerStack } from "@medusajs/icons"
import { Container, InlineTip, toast } from "@medusajs/ui"
import type { LogKind, RailwayMode, StatusResponse } from "../../../modules/railway/lib/contract"
import { errorMessage, useRailwayOverview, useRailwayRefresh, useRailwayStatus } from "../../lib/railway-api"
import { ToneBadge, type Tone } from "../../lib/railway-blocks"
import { HelpButtons, IntegrationHeader, ModeBadge, SettingsView, communityLabels, usePageNav } from "../../lib/railway-guide"
import { GuideView, usePromptSpec } from "../../lib/railway-guide-view"
import { RailwayIcon } from "../../lib/railway-icon"
import { KitFetchingBar, KitLoading } from "../../lib/railway-kit"
import { DETAIL_TABS, Freshness, OverviewTiles, ProblemsSection, ServiceDetail, ServicesSection, useScrollTo, type DetailTab } from "../../lib/railway-panel"
import { AccessTab, OptionsTab, SETTINGS_TABS, type SettingsTabId } from "../../lib/railway-settings"

/**
 * Railway by Koda Plus. Three views, switched in the header and kept in the URL:
 *
 * - Panel: the tiles, the problems, the services as cards; a click on a
 *   service opens its deployments, logs, metrics, variable names, domains
 *   and volumes (`?svc=<id>&show=logs`).
 * - Setup guide (`?view=guide`): the project token, the variable, the entry.
 * - Settings (`?view=settings&tab=`): the options in use, the token kind and
 *   the request counters.
 *
 * The plugin only reads: the one action is Refresh. Deep links:
 * `?filter=problems` scrolls to the problems (the board counters link there).
 */

const MODE_COLOR: Record<RailwayMode, Exclude<Tone, "purple">> = { demo: "blue", live: "green", unconfigured: "orange" }

const RailwayPage = () => {
  const { t, i18n } = useTranslation("railway")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const status = useRailwayStatus()
  const s = status.data
  const configured = Boolean(s?.configured)
  const overview = useRailwayOverview(Boolean(s) && configured)
  const o = overview.data
  const [params, setParams] = useSearchParams()
  const svc = params.get("svc")
  const askedTab = params.get("show") ?? ""
  const tab: DetailTab = (DETAIL_TABS as readonly string[]).includes(askedTab) ? (askedTab as DetailTab) : "deployments"
  const [logTarget, setLogTarget] = useState<{ id: string; kind: LogKind } | null>(null)
  const [focus] = useState<string | null>(() => (params.get("filter") === "problems" ? "railway-problems" : null))

  const selected = o?.services.find((x) => x.id === svc) ?? null
  useScrollTo(focus, Boolean(o))
  useEffect(() => {
    /* A new service starts on its own active deployment's logs. */
    setLogTarget(null)
  }, [svc])

  const open = (serviceId: string, next: DetailTab = tab) => {
    const p = new URLSearchParams(params)
    p.set("svc", serviceId)
    p.set("show", next)
    p.delete("filter")
    setParams(p, { replace: true })
    requestAnimationFrame(() => document.getElementById("railway-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  const showTab = (next: DetailTab) => {
    const p = new URLSearchParams(params)
    p.set("show", next)
    setParams(p, { replace: true })
  }
  const openLogs = (id: string, kind: LogKind) => {
    setLogTarget({ id, kind })
    showTab("logs")
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} nav={nav} lang={lang} hasOverview={Boolean(o)} />
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
            <Freshness overview={o} cacheSeconds={s.options.cacheSeconds} />
            <OverviewTiles overview={o} lang={lang} onProblems={() => document.getElementById("railway-problems")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
          </div>
        ) : null}
        {s && nav.view === "panel" && configured && !o && overview.isLoading ? <KitLoading label={t("loading")} /> : null}
        {nav.view === "panel" && overview.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(overview.error) })}
            </InlineTip>
          </div>
        ) : null}
        {!s && status.isLoading ? <KitLoading label={t("loading")} /> : null}
        {nav.view === "panel" && o ? <KitFetchingBar active={overview.isFetching} /> : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} /> : null}
      {s && nav.view === "panel" && !configured ? <GuideView status={s} /> : null}

      {s && nav.view === "panel" && configured && o ? (
        <>
          {o.problems.length ? <ProblemsSection overview={o} onOpen={open} /> : null}
          <ServicesSection overview={o} problems={o.problems} selected={selected?.id ?? null} onSelect={(id) => open(id)} lang={lang} />
          {selected ? <ServiceDetail service={selected} tab={tab} onTab={showTab} lang={lang} logTarget={logTarget} onLogs={openLogs} /> : null}
          {!o.problems.length ? <ProblemsSection overview={o} onOpen={open} /> : null}
        </>
      ) : null}

      {s && nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(next: SettingsTabId) => nav.go("settings", next)}
          tabs={[
            { id: "options", label: t("settings.tab.options") },
            { id: "access", label: t("settings.tab.access") },
          ]}
        >
          {nav.tab === "options" ? <OptionsTab status={s} /> : null}
          {nav.tab === "access" ? <AccessTab status={s} /> : null}
        </SettingsView>
      ) : null}
    </div>
  )
}

function Header({ status, nav, lang, hasOverview }: { status: StatusResponse | undefined; nav: ReturnType<typeof usePageNav<SettingsTabId>>; lang: string; hasOverview: boolean }) {
  const { t } = useTranslation("railway")
  const refresh = useRailwayRefresh()
  const promptSpec = usePromptSpec(status)
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)
  const dashboard = status?.dashboardUrl ?? "https://railway.com/dashboard"
  const onRefresh = async () => {
    try {
      const r = await refresh.mutateAsync()
      if (r.fresh) toast.success(t("toast.refreshed"))
      else toast.info(t("toast.cached"))
    } catch (err) {
      toast.error(t("toast.failed", { message: errorMessage(err) }))
    }
  }
  return (
    <IntegrationHeader
      icon={<RailwayIcon width={28} height={28} />}
      title={t("title")}
      badges={
        status ? (
          <>
            <ModeBadge color={MODE_COLOR[status.mode]} label={t(`mode.${status.mode}`)} title={t("demo.label")}>
              {status.mode === "demo" ? <DemoDetails /> : null}
            </ModeBadge>
            <ToneBadge tone="blue" icon={<Eye />}>
              {t("mode.readOnly")}
            </ToneBadge>
          </>
        ) : null
      }
      description={t("subtitle")}
      points={[
        { icon: <ServerStack />, text: t("points.services") },
        { icon: <CommandLine />, text: t("points.logs") },
        { icon: <ChartBar />, text: t("points.metrics") },
        { icon: <Key />, text: t("points.variables") },
        { icon: <ExclamationCircle />, text: t("points.problems") },
        { icon: <LockClosedSolid />, text: t("points.readOnly"), tone: "green" },
      ]}
      help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
      view={nav.view}
      onView={(v) => nav.go(v)}
      labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("settings.title"), more: t("actions.more") }}
      primary={status ? { key: "dashboard", label: t("actions.dashboard"), icon: <ArrowUpRightOnBox />, onClick: () => window.open(dashboard, "_blank", "noopener") } : null}
      actions={
        status && status.configured && nav.view !== "guide"
          ? [
              {
                key: "refresh",
                label: refresh.isPending ? t("actions.refreshing") : t("actions.refresh"),
                icon: <ArrowPath />,
                loading: refresh.isPending,
                disabled: !hasOverview,
                onClick: () => void onRefresh(),
              },
            ]
          : []
      }
    />
  )
}

function DemoDetails() {
  const { t } = useTranslation("railway")
  return (
    <div className="flex flex-col gap-2">
      <p className="txt-small text-ui-fg-subtle">{t("demo.text")}</p>
      <p className="txt-small text-ui-fg-muted">{t("demo.off")}</p>
    </div>
  )
}

/** Only what needs a person now: no token, or an account token without projectId. */
function Warnings({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("railway")
  if (status.mode === "demo" || status.configured) return null
  return (
    <div className="px-6 py-4">
      <InlineTip variant="warning" label={t("missing.label")}>
        {status.missing.includes("projectId") ? t("missing.projectId") : t("missing.token", { env: status.tokenEnv })}
      </InlineTip>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Railway",
  rank: 99,
  icon: RailwayIcon,
})

export default RailwayPage
