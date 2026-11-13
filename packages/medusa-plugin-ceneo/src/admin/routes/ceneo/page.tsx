import { useTranslation } from "react-i18next"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpRightOnBox, Clock, DocumentText, ExclamationCircle, Link as LinkIcon, ListBullet, ShoppingCart, SquaresPlus, Star, Tag, CheckCircle, CurrencyDollar } from "@medusajs/icons"
import { Button, InlineTip, Text, toast, Container } from "@medusajs/ui"
import { KitFetchingBar, KitLoading, announce } from "../../lib/ceneo-kit"
import { HelpButtons, IntegrationHeader, ModeBadge, SettingsView, communityLabels, usePageNav } from "../../lib/ceneo-guide"
import { Section, StatTile, StatTiles, ToneBadge } from "../../lib/ceneo-blocks"
import { GuideView, usePromptSpec } from "../../lib/ceneo-guide-view"
import { errorMessage, feedUrl, useBuildFeed, useCeneoStatus } from "../../lib/ceneo-api"
import { CeneoIcon } from "../../lib/ceneo-icon"
import { ConnectionsTab, FeedTab, SETTINGS_TABS, type SettingsTabId } from "../../lib/ceneo-ui"
import { OffersSection } from "../../lib/ceneo-offers"
import { CategoriesSection } from "../../lib/ceneo-categories"
import { OrdersSection } from "../../lib/ceneo-orders"
import { WritersSection } from "../../lib/ceneo-kup-teraz"
import { CpcSection } from "../../lib/ceneo-cpc"
import type { StatusResponse } from "../../../modules/ceneo/lib/contract"

/* The host of the koda.integration/1 cards learns about this plugin. */
announce({ ns: "ceneo", name: "Ceneo", adminPath: "/ceneo", Icon: CeneoIcon })

/**
 * Ceneo by Koda Plus. Panel: the offer counters and the feed (its address,
 * what it still needs, the last build). Setup guide and the options in use
 * behind the tabs.
 */

function formatBytes(n: number, lang: string): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toLocaleString(lang, { maximumFractionDigits: 1 })} KB`
  return `${(n / 1024 / 1024).toLocaleString(lang, { maximumFractionDigits: 1 })} MB`
}

const CeneoPage = () => {
  const { t, i18n } = useTranslation("ceneo")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const status = useCeneoStatus()
  const s = status.data
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)

  const onRefresh = async () => {
    const r = await status.refetch()
    if (r.isError) toast.error(t("toast.error", { error: errorMessage(r.error) }))
    else toast.success(t("toast.refreshed"))
  }
  const refresh = { key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, loading: status.isFetching, onClick: () => void onRefresh() }
  const feedHref = s?.feed.path && s.feed.last ? feedUrl(s.feed.path) : null

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <IntegrationHeader
          icon={<CeneoIcon width={28} height={28} />}
          title={t("title")}
          badges={
            s?.demo ? (
              <ModeBadge color="blue" label={t("mode.demo")} title={t("mode.demoTitle")}>
                <Text size="small">{t("mode.demoText")}</Text>
              </ModeBadge>
            ) : null
          }
          description={t("subtitle")}
          points={[
            { icon: <DocumentText />, text: t("points.feed") },
            { icon: <ExclamationCircle />, text: t("points.problems") },
            { icon: <Star />, text: t("points.reviews") },
            { icon: <ShoppingCart />, text: t("points.orders") },
            { icon: <CurrencyDollar />, text: t("points.bids") },
          ]}
          help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
          view={nav.view}
          onView={(v) => nav.go(v)}
          labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("view.settings"), more: t("actions.more") }}
          primary={nav.view === "panel" && feedHref ? { key: "feed", label: t("actions.openFeed"), icon: <ArrowUpRightOnBox />, onClick: () => window.open(feedHref, "_blank", "noopener") } : null}
          actions={nav.view === "guide" ? [] : [refresh]}
        />
        <KitFetchingBar active={status.isFetching && !status.isLoading} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {nav.view !== "guide" && !s && status.isLoading ? <KitLoading label={t("loading")} /> : null}
        {nav.view === "panel" && s ? (
          <StatTiles columns={4}>
            <StatTile label={t("stats.offers")} value={s.counts.offers} hint={t("stats.offersHint")} icon={<SquaresPlus />} />
            <StatTile label={t("stats.ok")} value={s.counts.ok + s.counts.warning} hint={t("stats.okHint")} icon={<CheckCircle />} tone="green" />
            <StatTile label={t("stats.problems")} value={s.counts.error} hint={t("stats.problemsHint")} icon={<ExclamationCircle />} tone={s.counts.error > 0 ? "red" : "grey"} />
            <StatTile
              label={t("stats.build")}
              value={s.feed.last ? new Date(s.feed.last.built_at).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }) : "-"}
              hint={s.feed.last ? t("stats.buildHint", { count: s.feed.last.offers }) : t("stats.never")}
              icon={<Clock />}
              tone={s.feed.failed ? "orange" : "grey"}
            />
          </StatTiles>
        ) : null}
      </Container>

      {nav.view === "guide" ? <GuideView status={s} /> : null}

      {nav.view === "settings" && s ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "feed", label: t("settings.tab.feed") },
            { id: "connections", label: t("settings.tab.connections") },
          ]}
        >
          {nav.tab === "connections" ? <ConnectionsTab status={s} /> : <FeedTab status={s} />}
        </SettingsView>
      ) : null}

      {nav.view === "panel" && s ? <FeedCard status={s} lang={lang} /> : null}
      {nav.view === "panel" && s ? <OffersSection status={s} lang={lang} /> : null}
      {nav.view === "panel" && s ? <CategoriesSection lang={lang} /> : null}
      {nav.view === "panel" && s ? <OrdersSection status={s} lang={lang} /> : null}
      {nav.view === "panel" && s ? <CpcSection status={s} lang={lang} /> : null}
      {nav.view === "panel" && s ? <WritersSection status={s} lang={lang} /> : null}
    </div>
  )
}

function FeedCard({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("ceneo")
  const f = status.feed
  const url = f.path ? feedUrl(f.path) : null
  const build = useBuildFeed()
  const onBuild = () =>
    build.mutate(undefined, {
      onSuccess: (r) => {
        if (r.status === "built") toast.success(t(r.changed ? "toast.built" : "toast.builtSame", { offers: r.offers }))
        else if (r.status === "failed") toast.error(t("toast.buildFailed", { error: r.error }))
        else if (r.status === "started") toast.info(t("toast.buildStarted"))
        else toast.info(t(r.reason === "running" ? "toast.buildRunning" : "toast.buildGaps"))
      },
      onError: (e) => toast.error(t("toast.error", { error: errorMessage(e) })),
    })
  const copy = () => {
    if (!url) return
    void navigator.clipboard.writeText(url).then(
      () => toast.success(t("toast.copied")),
      (e: unknown) => toast.error(t("toast.error", { error: errorMessage(e) })),
    )
  }
  return (
    <Section
      id="ceneo-feed"
      icon={<DocumentText />}
      title={t("feed.title")}
      badges={f.gaps.length > 0 ? <ToneBadge tone="orange" dot>{t("feed.notReady")}</ToneBadge> : null}
      points={[
        { icon: <LinkIcon />, text: t("feed.points.address") },
        { icon: <Clock />, text: t("feed.points.schedule", { minutes: f.intervalMinutes }) },
        { icon: <ListBullet />, text: t("feed.points.same") },
      ]}
      actions={
        <Button size="small" variant="secondary" onClick={onBuild} isLoading={build.isPending} disabled={f.gaps.length > 0}>
          <ArrowPath />
          {t("actions.build")}
        </Button>
      }
    >
      {f.gaps.length > 0 ? (
        <div className="flex flex-col gap-y-2 px-6 py-4">
          {f.gaps.map((g) => (
            <InlineTip key={g} variant="warning" label={t("feed.notReady")}>
              {t(`feed.gaps.${g}`)}
            </InlineTip>
          ))}
        </div>
      ) : null}
      {url ? (
        <div className="flex flex-wrap items-end gap-3 px-6 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-y-1">
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("feed.address")}
            </Text>
            <span className="break-all font-mono txt-compact-xsmall text-ui-fg-base">{url}</span>
          </div>
          <Button size="small" variant="secondary" onClick={copy}>
            <Tag />
            {t("feed.copy")}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("feed.last")}
        </Text>
        {f.last ? (
          <Text size="small" className="tabular-nums text-ui-fg-base">
            {t("feed.built", { date: new Date(f.last.built_at).toLocaleString(lang), offers: f.last.offers, size: formatBytes(f.last.bytes, lang), ms: f.last.duration_ms })}
          </Text>
        ) : (
          <Text size="small" className="text-ui-fg-subtle">
            {t("feed.none")}
          </Text>
        )}
        {f.failed ? (
          <InlineTip variant="error" label={t("stats.build")}>
            {t("feed.failed", { error: f.failed.error ?? "-" })}
          </InlineTip>
        ) : null}
      </div>
    </Section>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "ceneo",
  icon: CeneoIcon,
})

export default CeneoPage
