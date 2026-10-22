import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ArrowPath, ArrowUpRightOnBox, BarsArrowDown, ChartBar, CheckCircle, Clock, EnvelopeSolid, ExclamationCircle, ListBullet, ShoppingCart, Tag, Users, XCircle } from "@medusajs/icons"
import { Container, InlineTip, Table, Text, Toaster } from "@medusajs/ui"
import { broadcasts, check, forms, overview, status, subscribers, tags, type Status } from "../../lib/kit-api"
import { KitFetchingBar, KitLoading, KitSkeletonRows } from "../../lib/kit-kit"
import { HelpButtons, IntegrationHeader, ModeBadge, SettingsView, communityLabels, usePageNav } from "../../lib/kit-guide"
import { EmptyState, EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, StatTile, StatTiles, ToneBadge } from "../../lib/kit-blocks"
import { KitIcon } from "../../lib/kit-icon"
import { KitGuideView, usePromptSpec } from "../../lib/kit-guide-view"
import { ListTab, OptionsTab, RoutingTab, SETTINGS_TABS, type SettingsTabId } from "../../lib/kit-settings"

/**
 * Kit (formerly ConvertKit): the newsletter of the store on the Kit list.
 * Panel: the connection, the counters, the list in numbers, the broadcasts
 * with their results and the subscription log. Settings: the list (tags,
 * double opt-in form), the tags by source and for buyers, the options.
 * Setup guide: the steps from the key to the test sign-up.
 */

const KIT_APP = "https://app.kit.com"

type LogFilter = "all" | "ok" | "failed"

const KitPage = () => {
  const { t, i18n } = useTranslation("kit")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const client = useQueryClient()
  const statusQ = useQuery({ queryKey: ["kit", "status"], queryFn: status, refetchInterval: 30_000 })
  const tagsQ = useQuery({ queryKey: ["kit", "tags"], queryFn: tags })
  const formsQ = useQuery({ queryKey: ["kit", "forms"], queryFn: forms })
  const checkQ = useQuery({ queryKey: ["kit", "check"], queryFn: check, enabled: false })
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)
  const s = statusQ.data
  const tagList = tagsQ.data?.tags ?? []
  const formList = formsQ.data?.forms ?? []
  const [logFilter, setLogFilter] = useState<LogFilter>("all")

  const refreshing = statusQ.isFetching || tagsQ.isFetching || formsQ.isFetching
  const refresh = { key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, loading: refreshing, onClick: () => void client.invalidateQueries({ queryKey: ["kit"] }) }
  const checkAction = { key: "check", label: checkQ.isFetching ? t("check.running") : t("actions.check"), icon: <CheckCircle />, loading: checkQ.isFetching, onClick: () => void checkQ.refetch() }
  const showLog = (f: LogFilter) => {
    setLogFilter((cur) => (cur === f && f !== "all" ? "all" : f))
    requestAnimationFrame(() => document.getElementById("kit-log")?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <IntegrationHeader
          icon={<KitIcon width={28} height={28} />}
          title={t("title")}
          badges={<ModeBadges status={s} />}
          description={t("subtitle")}
          points={[
            { icon: <EnvelopeSolid />, text: t("points.form") },
            { icon: <Tag />, text: t("points.tags") },
            { icon: <CheckCircle />, text: t("points.optIn") },
            { icon: <ShoppingCart />, text: t("points.buyers") },
            { icon: <ChartBar />, text: t("points.results") },
          ]}
          help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
          view={nav.view}
          onView={(v) => nav.go(v)}
          labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("view.settings"), more: t("actions.more") }}
          primary={nav.view !== "guide" ? { key: "open", label: t("actions.open"), icon: <ArrowUpRightOnBox />, onClick: () => window.open(KIT_APP, "_blank", "noopener,noreferrer") } : null}
          actions={nav.view === "panel" ? [refresh, checkAction] : nav.view === "settings" ? [refresh] : []}
        />
        <KitFetchingBar active={refreshing && !statusQ.isLoading} />
        {statusQ.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: (statusQ.error as Error)?.message })}
            </InlineTip>
          </div>
        ) : null}
        {nav.view !== "guide" && !s && statusQ.isLoading ? <KitLoading label={t("loading")} /> : null}
        {nav.view === "panel" && s && !s.configured && !s.demo ? (
          <div className="px-6 py-4">
            <InlineTip variant="warning" label={t("mode.off")}>
              {t("status.unconfigured")}
            </InlineTip>
          </div>
        ) : null}
        {nav.view === "panel" && checkQ.data ? (
          <div className="px-6 py-4">
            {checkQ.data.ok && checkQ.data.account ? (
              <InlineTip variant="success" label={t("check.title")}>
                {t("check.ok", { name: checkQ.data.account.name ?? checkQ.data.account.primary_email_address ?? "-" })}, {t("check.tags", { n: checkQ.data.tags.length })}, {t("check.forms", { n: checkQ.data.forms.length })}
              </InlineTip>
            ) : (
              <InlineTip variant="error" label={t("check.title")}>
                {t("check.failed")}
              </InlineTip>
            )}
          </div>
        ) : null}
        {nav.view === "panel" && s ? (
          <StatTiles columns={4}>
            <StatTile label={t("stats.subscribed")} value={s.counts.subscribed} hint={t("stats.subscribedHint")} icon={<Users />} tone="green" active={logFilter === "ok"} onClick={() => showLog("ok")} />
            <StatTile label={t("stats.failed")} value={s.counts.failed} hint={t("stats.failedHint")} icon={<XCircle />} tone={s.counts.failed > 0 ? "red" : "grey"} active={logFilter === "failed"} onClick={() => showLog("failed")} />
            <StatTile label={t("stats.week")} value={s.counts.last_7_days} hint={t("stats.weekHint")} icon={<Clock />} />
            <StatTile
              label={t("stats.account")}
              value={s.account ? (s.account.name ?? "Kit") : "-"}
              hint={s.account?.plan_type ? t("account.plan", { plan: s.account.plan_type }) : s.account ? undefined : t("stats.accountNone")}
              icon={<EnvelopeSolid />}
              tone={s.account ? "green" : "grey"}
            />
          </StatTiles>
        ) : null}
      </Container>

      {nav.view === "guide" ? <KitGuideView status={s} /> : null}

      {nav.view === "settings" && s ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "list", label: t("settings.tab.list"), badge: s.settings.tags.length || null },
            { id: "routing", label: t("settings.tab.routing"), badge: Object.keys(s.settings.source_tags ?? {}).length || null },
            { id: "options", label: t("settings.tab.options"), badge: s.missing.length || null, tone: "orange" },
          ]}
        >
          {nav.tab === "list" ? <ListTab status={s} tagList={tagList} formList={formList} /> : null}
          {nav.tab === "routing" ? <RoutingTab status={s} tagList={tagList} /> : null}
          {nav.tab === "options" ? <OptionsTab status={s} /> : null}
        </SettingsView>
      ) : null}

      {nav.view === "panel" && s ? (
        <>
          {s.configured ? <ListCard /> : null}
          {s.configured ? <BroadcastsCard /> : null}
          <LogCard status={s} filter={logFilter} onFilter={showLog} />
        </>
      ) : null}
      <Toaster position="bottom-right" />
    </div>
  )
}

function ModeBadges({ status: s }: { status?: Status }) {
  const { t } = useTranslation("kit")
  if (!s) return null
  if (s.demo) {
    return (
      <ModeBadge color="blue" label={t("mode.demo")} title={t("mode.demoTitle")}>
        <Text size="small">{t("mode.demoNote")}</Text>
      </ModeBadge>
    )
  }
  if (s.configured) return <ModeBadge color="green" label={t("status.configured")} />
  return (
    <ModeBadge color="orange" label={t("mode.off")} title={t("mode.offTitle")}>
      <Text size="small">{t("status.unconfigured")}</Text>
      {s.missing.length ? <Text size="small">{t("status.missing", { what: s.missing.join(", ") })}</Text> : null}
    </ModeBadge>
  )
}

const pctOf = (lang: string) => (v: number) => `${v.toLocaleString(lang, { maximumFractionDigits: 1 })}%`
const intOf = (lang: string) => (v: number) => v.toLocaleString(lang)

function ListCard() {
  const { t, i18n } = useTranslation("kit")
  const lang = i18n.language || "en"
  const pct = pctOf(lang)
  const int = intOf(lang)
  const [fresh, setFresh] = useState(false)
  const q = useQuery({ queryKey: ["kit", "overview", fresh], queryFn: () => overview(fresh) })
  const ov = q.data?.overview
  return (
    <Section
      icon={<Users />}
      title={t("list.title")}
      points={[
        { icon: <EnvelopeSolid />, text: t("list.points.account") },
        { icon: <Clock />, text: t("list.points.cache") },
      ]}
      actions={
        <RowActions actions={[{ key: "refresh", label: t("list.refresh"), icon: <ArrowPath />, loading: q.isFetching, onClick: () => (fresh ? void q.refetch() : setFresh(true)) }]} />
      }
    >
      {q.isLoading ? (
        <KitLoading />
      ) : !ov ? (
        <EmptyState compact icon={<ExclamationCircle />} title={t("list.unavailable")} />
      ) : (
        <StatTiles columns={6}>
          <StatTile label={t("list.subscribers")} value={int(ov.subscribers)} />
          <StatTile label={t("list.new30")} value={ov.growth_30 ? int(ov.growth_30.new_subscribers) : "-"} />
          <StatTile label={t("list.lost30")} value={ov.growth_30 ? int(ov.growth_30.cancellations) : "-"} />
          <StatTile label={t("list.net90")} value={ov.growth_90 ? `${ov.growth_90.net_new_subscribers > 0 ? "+" : ""}${int(ov.growth_90.net_new_subscribers)}` : "-"} />
          <StatTile label={t("list.openRate")} value={ov.email_stats ? pct(ov.email_stats.open_rate) : "-"} />
          <StatTile label={t("list.clickRate")} value={ov.email_stats ? pct(ov.email_stats.click_rate) : "-"} />
        </StatTiles>
      )}
    </Section>
  )
}

function BroadcastsCard() {
  const { t, i18n } = useTranslation("kit")
  const lang = i18n.language || "en"
  const pct = pctOf(lang)
  const int = intOf(lang)
  const q = useQuery({ queryKey: ["kit", "broadcasts"], queryFn: () => broadcasts() })
  const list = q.data?.broadcasts ?? []
  return (
    <Section
      icon={<EnvelopeSolid />}
      title={t("broadcasts.title")}
      points={[
        { icon: <BarsArrowDown />, text: t("broadcasts.points.newest") },
        { icon: <ChartBar />, text: t("broadcasts.points.results") },
      ]}
    >
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("broadcasts.subject")}</Table.HeaderCell>
              <Table.HeaderCell>{t("broadcasts.sent")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("broadcasts.recipients")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("broadcasts.opens")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("broadcasts.clicks")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("broadcasts.unsubscribes")}</Table.HeaderCell>
              <Table.HeaderCell className="w-px" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {q.isLoading ? <KitSkeletonRows cols={7} rows={3} /> : null}
            {!q.isLoading && list.length === 0 ? <EmptyTableRow cols={7} icon={<EnvelopeSolid />} title={t("broadcasts.empty")} /> : null}
            {list.map((b) => {
              const sent = b.published_at ?? b.send_at
              const draft = !b.published_at && !b.send_at
              const done = b.stats?.status === "completed"
              return (
                <Table.Row key={b.id}>
                  <Table.Cell className="max-w-[320px] truncate">{b.subject ?? "-"}</Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {draft ? (
                      <ToneBadge>{t("broadcasts.draft")}</ToneBadge>
                    ) : !done && b.send_at && !b.published_at ? (
                      <ToneBadge tone="blue">{t("broadcasts.scheduled")}</ToneBadge>
                    ) : sent ? (
                      new Date(sent).toLocaleDateString(lang)
                    ) : (
                      "-"
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{done && b.stats ? int(b.stats.recipients) : "-"}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{done && b.stats ? pct(b.stats.open_rate) : "-"}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{done && b.stats ? pct(b.stats.click_rate) : "-"}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{done && b.stats ? int(b.stats.unsubscribes) : "-"}</Table.Cell>
                  <Table.Cell className="text-right">
                    <RowActions actions={[{ key: "open", label: t("broadcasts.open"), icon: <ArrowUpRightOnBox />, href: b.public_url ?? undefined, external: true, hidden: !b.public_url }]} />
                  </Table.Cell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

function LogCard({ status: s, filter, onFilter }: { status: Status; filter: LogFilter; onFilter: (f: LogFilter) => void }) {
  const { t, i18n } = useTranslation("kit")
  const lang = i18n.language || "en"
  const [q, setQ] = useState("")
  const tagsQ = useQuery({ queryKey: ["kit", "tags"], queryFn: tags })
  const subsQ = useQuery({ queryKey: ["kit", "subscribers", filter], queryFn: () => subscribers({ take: 25, status: filter === "all" ? undefined : filter }) })
  const tagName = (id: number) => (tagsQ.data?.tags ?? []).find((tg) => tg.id === id)?.name ?? `#${id}`
  const needle = q.trim().toLowerCase()
  const all = subsQ.data?.subscribers ?? []
  const rows = useMemo(() => all.filter((r) => !needle || [r.email, r.source].some((x) => (x ?? "").toLowerCase().includes(needle))), [all, needle])
  const stateLabel = (state: string | null) => (state === "active" ? t("subscribers.stateActive") : state === "inactive" ? t("subscribers.stateInactive") : state ?? t("subscribers.stateNone"))

  return (
    <Section
      id="kit-log"
      icon={<ListBullet />}
      title={t("subscribers.title")}
      points={[
        { icon: <EnvelopeSolid />, text: t("subscribers.points.every") },
        { icon: <BarsArrowDown />, text: t("subscribers.points.newest") },
      ]}
      actions={<SearchInput value={q} onChange={setQ} placeholder={t("subscribers.search")} />}
    >
      <FilterBar>
        <FilterButton icon={<ListBullet />} label={t("subscribers.filter.all")} count={s.counts.subscribed + s.counts.failed} active={filter === "all"} onClick={() => onFilter("all")} />
        <FilterDivider />
        <FilterButton icon={<CheckCircle />} label={t("subscribers.filter.ok")} count={s.counts.subscribed} active={filter === "ok"} onClick={() => onFilter("ok")} />
        <FilterButton icon={<XCircle />} label={t("subscribers.filter.failed")} count={s.counts.failed} attention active={filter === "failed"} onClick={() => onFilter("failed")} />
      </FilterBar>
      <KitFetchingBar active={subsQ.isFetching && !subsQ.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("subscribers.email")}</Table.HeaderCell>
              <Table.HeaderCell>{t("subscribers.state")}</Table.HeaderCell>
              <Table.HeaderCell>{t("subscribers.tags")}</Table.HeaderCell>
              <Table.HeaderCell>{t("subscribers.source")}</Table.HeaderCell>
              <Table.HeaderCell>{t("subscribers.when")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {subsQ.isLoading ? <KitSkeletonRows cols={6} /> : null}
            {!subsQ.isLoading && rows.length === 0 ? <EmptyTableRow cols={6} icon={<Users />} title={all.length === 0 ? t("subscribers.empty") : t("subscribers.emptySearch")} /> : null}
            {rows.map((r) => (
              <Table.Row key={r.id}>
                <Table.Cell>{r.email}</Table.Cell>
                <Table.Cell>
                  <ToneBadge tone={r.state === "active" ? "green" : r.state === "inactive" ? "orange" : "grey"} dot>
                    {stateLabel(r.state)}
                  </ToneBadge>
                </Table.Cell>
                <Table.Cell className="text-ui-fg-subtle">{(r.tags ?? []).map(tagName).join(", ") || "-"}</Table.Cell>
                <Table.Cell className="text-ui-fg-subtle">{r.source ?? "-"}</Table.Cell>
                <Table.Cell className="tabular-nums text-ui-fg-subtle">{new Date(r.created_at).toLocaleString(lang)}</Table.Cell>
                <Table.Cell>
                  <ToneBadge tone={r.status === "ok" ? "green" : "red"} title={r.error ?? undefined}>
                    {r.status === "ok" ? t("subscribers.statusOk") : t("subscribers.statusFailed")}
                  </ToneBadge>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "kit",
  rank: 4,
  icon: KitIcon,
})

export default KitPage
