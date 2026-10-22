import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowDown, ArrowPath, ArrowUpRightOnBox, BarsArrowDown, Cash, Clock, Gift, ListBullet, PencilSquare, Plus, ShoppingCart, Star, Trophy, Users, XMark } from "@medusajs/icons"
import { Button, Container, IconButton, InlineTip, Input, Label, Table, Text, toast } from "@medusajs/ui"
import { KitFetchingBar, KitLoading, KitSkeletonRows, announce } from "../../lib/loyalty-kit"
import { HelpButtons, IntegrationHeader, ModeBadge, SettingsView, communityLabels, usePageNav } from "../../lib/loyalty-guide"
import { EmptyState, EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, StatTile, StatTiles, ToneBadge, type Tone } from "../../lib/loyalty-blocks"
import { GuideView, usePromptSpec } from "../../lib/loyalty-guide-view"
import { errorMessage, useAdjust, useCustomerSearch, useLoyaltyStatus, type FoundCustomer } from "../../lib/loyalty-api"
import { LoyaltyIcon } from "../../lib/loyalty-icon"
import { OptionsTab, SETTINGS_TABS, fmtNumber, type SettingsTabId } from "../../lib/loyalty-ui"
import type { StatusResponse } from "../../../modules/loyalty/lib/contract"
import type { TxKind } from "../../../modules/loyalty/lib/constants"

/* The host of the koda.integration/1 cards learns about this plugin. */
announce({ ns: "loyalty", name: "Loyalty", adminPath: "/loyalty", Icon: LoyaltyIcon })

/**
 * Loyalty by Koda Plus. Panel: the counters, the manual adjustment, the
 * reward ladder, the points accounts and the latest transactions. Setup
 * guide and the options in use behind the tabs.
 *
 * Deep links: `?filter=ready` (accounts ready for a reward) and `?q=`.
 */

type AccountFilter = "all" | "ready"
type TxFilter = "all" | "plus" | "minus"

const KIND_TONE: Record<TxKind, Tone> = {
  earn_order: "green",
  bonus: "green",
  redeem: "blue",
  adjust: "grey",
  expire: "grey",
}

const scrollTo = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }))

const LoyaltyPage = () => {
  const { t, i18n } = useTranslation("loyalty")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const status = useLoyaltyStatus()
  const s = status.data
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)
  const num = (n: number | undefined) => (n === undefined ? "-" : fmtNumber(n, lang))

  const [params, setParams] = useSearchParams()
  const filter: AccountFilter = params.get("filter") === "ready" ? "ready" : "all"
  const [q, setQ] = useState(params.get("q") ?? "")
  useEffect(() => {
    const p = new URLSearchParams(params)
    if (q) p.set("q", q)
    else p.delete("q")
    if (p.toString() !== params.toString()) setParams(p, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])
  const setFilter = (f: AccountFilter) => {
    const p = new URLSearchParams(params)
    if (f === "all" || f === filter) p.delete("filter")
    else p.set("filter", f)
    setParams(p, { replace: true })
    scrollTo("loyalty-accounts")
  }

  const onRefresh = async () => {
    const r = await status.refetch()
    if (r.isError) toast.error(t("toast.error", { error: errorMessage(r.error) }))
    else toast.success(t("toast.refreshed"))
  }

  const refresh = { key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, loading: status.isFetching, onClick: () => void onRefresh() }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <IntegrationHeader
          icon={<LoyaltyIcon width={28} height={28} />}
          title={t("title")}
          badges={
            s?.demo ? (
              <ModeBadge color="blue" label={t("mode.demo")} title={t("mode.demoTitle")}>
                <Text size="small">{t("mode.demoText")}</Text>
              </ModeBadge>
            ) : null
          }
          description={t("subtitle", { pointsPerPln: s?.pointsPerPln ?? 1, redeemRate: s?.redeemRate ?? 0.05 })}
          points={[
            { icon: <Star />, text: t("points.earn", { count: s?.pointsPerPln ?? 1 }) },
            { icon: <Cash />, text: t("points.worth", { value: fmtNumber(s?.redeemRate ?? 0.05, lang, 2) }) },
            { icon: <Gift />, text: t("points.ladder") },
            { icon: <PencilSquare />, text: t("points.manual") },
            { icon: <Clock />, text: t("points.ledger") },
          ]}
          help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
          view={nav.view}
          onView={(v) => nav.go(v)}
          labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("view.settings"), more: t("actions.more") }}
          primary={nav.view === "panel" && s ? { key: "adjust", label: t("actions.adjust"), icon: <Plus />, onClick: () => scrollTo("loyalty-adjust") } : null}
          actions={
            nav.view === "panel"
              ? [refresh, { key: "customers", label: t("actions.customers"), icon: <ArrowUpRightOnBox />, onClick: () => window.location.assign("/app/customers") }]
              : nav.view === "settings"
                ? [refresh]
                : []
          }
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
            <StatTile label={t("stats.accounts")} value={num(s.counts.accounts)} hint={t("stats.accountsHint")} icon={<Users />} active={filter === "all" && !q} onClick={() => setFilter("all")} />
            <StatTile label={t("stats.points")} value={num(s.counts.points_total)} hint={t("stats.pointsHint")} icon={<Star />} tone="blue" />
            <StatTile label={t("stats.redeemed")} value={num(s.counts.redeemed_total)} hint={t("stats.redeemedHint")} icon={<Gift />} />
            <StatTile label={t("stats.ready")} value={num(s.counts.ready)} hint={t("stats.readyHint")} icon={<Trophy />} tone={s.counts.ready > 0 ? "green" : "grey"} active={filter === "ready"} onClick={() => setFilter("ready")} />
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
          tabs={[{ id: "options", label: t("settings.tab.options") }]}
        >
          <OptionsTab status={s} />
        </SettingsView>
      ) : null}

      {nav.view === "panel" && s ? (
        <>
          <AdjustCard />
          {s.rewards.length > 0 ? <RewardsCard status={s} /> : null}
          <AccountsCard status={s} filter={filter} onFilter={setFilter} q={q} onQ={setQ} loading={status.isLoading} />
          <TransactionsCard status={s} />
        </>
      ) : null}
    </div>
  )
}

function RewardsCard({ status }: { status: StatusResponse }) {
  const { t, i18n } = useTranslation("loyalty")
  const pl = (i18n.language || "en").startsWith("pl")
  return (
    <Section
      icon={<Gift />}
      title={t("rewards.title")}
      points={[
        { icon: <Star />, text: t("rewards.points.balance") },
        { icon: <Users />, text: t("rewards.points.account") },
      ]}
    >
      <div className="flex flex-wrap gap-2 px-6 py-4">
        {[...status.rewards]
          .sort((a, b) => a.at - b.at)
          .map((r, i) => (
            <ToneBadge key={i} tone="purple" size="small" icon={<Gift />}>
              {t("rewards.at", { count: r.at })} {pl ? r.name.pl : r.name.en}
            </ToneBadge>
          ))}
      </div>
    </Section>
  )
}

function AccountsCard({ status, filter, onFilter, q, onQ, loading }: { status: StatusResponse; filter: AccountFilter; onFilter: (f: AccountFilter) => void; q: string; onQ: (v: string) => void; loading: boolean }) {
  const { t, i18n } = useTranslation("loyalty")
  const lang = i18n.language || "en"
  const firstReward = status.rewards.length ? Math.min(...status.rewards.map((r) => r.at)) : null
  const ready = (balance: number) => firstReward !== null && balance >= firstReward
  const needle = q.trim().toLowerCase()
  const readyCount = status.accounts.filter((a) => ready(a.balance)).length
  const rows = useMemo(
    () =>
      status.accounts.filter((a) => {
        if (filter === "ready" && !ready(a.balance)) return false
        if (!needle) return true
        return [a.customer_name, a.customer_email, a.customer_id].some((x) => (x ?? "").toLowerCase().includes(needle))
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status.accounts, filter, needle, firstReward],
  )
  return (
    <Section
      id="loyalty-accounts"
      icon={<Users />}
      title={t("accounts.title")}
      points={[
        { icon: <Star />, text: t("accounts.points.balance") },
        { icon: <Trophy />, text: t("accounts.points.tier") },
        { icon: <ArrowUpRightOnBox />, text: t("accounts.points.row") },
      ]}
      actions={<SearchInput value={q} onChange={onQ} placeholder={t("accounts.search")} />}
    >
      <FilterBar>
        <FilterButton icon={<ListBullet />} label={t("accounts.filter.all")} count={status.accounts.length} active={filter === "all"} onClick={() => onFilter("all")} />
        <FilterDivider />
        <FilterButton icon={<Trophy />} label={t("accounts.filter.ready")} count={readyCount} active={filter === "ready"} onClick={() => onFilter("ready")} disabled={firstReward === null} />
      </FilterBar>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("accounts.customer")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("accounts.balance")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("accounts.earned")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("accounts.redeemed")}</Table.HeaderCell>
              <Table.HeaderCell>{t("accounts.tier")}</Table.HeaderCell>
              <Table.HeaderCell className="w-px" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading && rows.length === 0 ? <KitSkeletonRows cols={6} /> : null}
            {!loading && rows.length === 0 ? (
              <EmptyTableRow
                cols={6}
                icon={<Users />}
                title={status.accounts.length === 0 ? t("accounts.empty") : t("accounts.emptySearch")}
                points={status.accounts.length === 0 ? [{ icon: <ShoppingCart />, text: t("accounts.emptyHint") }] : undefined}
              />
            ) : null}
            {rows.map((a) => (
              <Table.Row key={a.id}>
                <Table.Cell>
                  <span className="flex items-center gap-x-2">
                    <Link to={`/customers/${a.customer_id}`} className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                      {a.customer_name ?? a.customer_email ?? a.customer_id}
                    </Link>
                    {ready(a.balance) ? (
                      <ToneBadge tone="green" icon={<Trophy />}>
                        {t("accounts.filter.ready")}
                      </ToneBadge>
                    ) : null}
                    {a.demo ? <ToneBadge tone="blue">{t("mode.demo")}</ToneBadge> : null}
                  </span>
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">{fmtNumber(a.balance, lang)}</Table.Cell>
                <Table.Cell className="text-right tabular-nums text-ui-fg-subtle">{fmtNumber(a.total_earned, lang)}</Table.Cell>
                <Table.Cell className="text-right tabular-nums text-ui-fg-subtle">{fmtNumber(a.total_redeemed, lang)}</Table.Cell>
                <Table.Cell className="tabular-nums text-ui-fg-subtle">x{a.tier_multiplier}</Table.Cell>
                <Table.Cell className="text-right">
                  <RowActions actions={[{ key: "open", label: t("accounts.open"), icon: <ArrowUpRightOnBox />, href: `/app/customers/${a.customer_id}` }]} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

function TransactionsCard({ status }: { status: StatusResponse }) {
  const { t, i18n } = useTranslation("loyalty")
  const lang = i18n.language || "en"
  const [filter, setFilter] = useState<TxFilter>("all")
  const toggle = (f: TxFilter) => setFilter((cur) => (cur === f ? "all" : f))
  const plus = status.transactions.filter((x) => x.delta >= 0).length
  const minus = status.transactions.length - plus
  const rows = status.transactions.filter((x) => (filter === "plus" ? x.delta >= 0 : filter === "minus" ? x.delta < 0 : true))
  return (
    <Section
      icon={<Clock />}
      title={t("transactions.title")}
      points={[
        { icon: <BarsArrowDown />, text: t("transactions.points.newest") },
        { icon: <ShoppingCart />, text: t("transactions.points.orders") },
        { icon: <PencilSquare />, text: t("transactions.points.manual") },
      ]}
    >
      <FilterBar>
        <FilterButton icon={<ListBullet />} label={t("transactions.filter.all")} count={status.transactions.length} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterDivider />
        <FilterButton icon={<Plus />} label={t("transactions.filter.plus")} count={plus} active={filter === "plus"} onClick={() => toggle("plus")} />
        <FilterButton icon={<ArrowDown />} label={t("transactions.filter.minus")} count={minus} active={filter === "minus"} onClick={() => toggle("minus")} />
      </FilterBar>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("transactions.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("transactions.kind")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("transactions.delta")}</Table.HeaderCell>
              <Table.HeaderCell>{t("transactions.reason")}</Table.HeaderCell>
              <Table.HeaderCell className="w-px" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? <EmptyTableRow cols={5} icon={<Clock />} title={t("transactions.empty")} /> : null}
            {rows.map((x) => (
              <Table.Row key={x.id}>
                <Table.Cell className="tabular-nums text-ui-fg-subtle">{new Date(x.created_at).toLocaleString(lang)}</Table.Cell>
                <Table.Cell>
                  <ToneBadge tone={KIND_TONE[x.kind] ?? "grey"}>{t(`kind.${x.kind}`)}</ToneBadge>
                </Table.Cell>
                <Table.Cell className={x.delta >= 0 ? "text-right tabular-nums text-ui-tag-green-text" : "text-right tabular-nums text-ui-fg-subtle"}>
                  {x.delta >= 0 ? `+${fmtNumber(x.delta, lang)}` : fmtNumber(x.delta, lang)}
                </Table.Cell>
                <Table.Cell className="text-ui-fg-subtle">{x.reason ?? "-"}</Table.Cell>
                <Table.Cell className="text-right">
                  <RowActions actions={[{ key: "order", label: t("transactions.openOrder"), icon: <ShoppingCart />, href: `/app/orders/${x.order_id}`, hidden: !x.order_id }]} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

function AdjustCard() {
  const { t } = useTranslation("loyalty")
  const adjust = useAdjust()
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<FoundCustomer | null>(null)
  const [delta, setDelta] = useState("")
  const [reason, setReason] = useState("")
  const search = useCustomerSearch(q, !picked)

  const submit = () => {
    const value = Math.trunc(Number(delta.replace(",", ".")))
    if (!picked || !Number.isFinite(value) || value === 0 || !reason.trim()) return
    adjust.mutate(
      { customer_id: picked.id, delta: value, reason: reason.trim() },
      {
        onSuccess: () => {
          setPicked(null)
          setQ("")
          setDelta("")
          setReason("")
          toast.success(t("toast.saved"))
        },
        onError: (e) => toast.error(t("toast.error", { error: e.message })),
      },
    )
  }

  return (
    <Section
      id="loyalty-adjust"
      icon={<PencilSquare />}
      title={t("adjust.title")}
      points={[
        { icon: <Plus />, text: t("adjust.points.plus"), tone: "green" },
        { icon: <ArrowDown />, text: t("adjust.points.minus") },
        { icon: <PencilSquare />, text: t("adjust.points.reason") },
      ]}
    >
      <div className="grid grid-cols-1 gap-3 px-6 py-4 md:grid-cols-4">
        <div className="flex flex-col gap-y-1">
          <Label size="xsmall">{t("adjust.customer")}</Label>
          {picked ? (
            <div className="flex h-8 items-center justify-between gap-x-2 rounded-md border border-ui-border-base bg-ui-bg-subtle pl-3 pr-1">
              <span className="txt-compact-small truncate text-ui-fg-base">{picked.label}</span>
              <IconButton size="small" variant="transparent" title={t("adjust.clear")} aria-label={t("adjust.clear")} onClick={() => setPicked(null)}>
                <XMark />
              </IconButton>
            </div>
          ) : (
            <div className="relative">
              <SearchInput value={q} onChange={setQ} placeholder={t("adjust.customerPlaceholder")} className="sm:w-full" />
              {q && (search.data ?? []).length > 0 ? (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-ui-border-base bg-ui-bg-base shadow-elevation-card-rest">
                  {search.data!.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setPicked(c)
                        setQ("")
                      }}
                      className="flex w-full flex-col gap-y-0.5 px-3 py-2 text-left transition-fg hover:bg-ui-bg-base-hover"
                    >
                      <span className="txt-compact-small text-ui-fg-base">{c.label}</span>
                      {c.sub ? <span className="txt-compact-xsmall text-ui-fg-muted">{c.sub}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              {q && search.data && search.data.length === 0 && !search.isFetching ? <EmptyState compact icon={<Users />} title={t("accounts.emptySearch")} className="px-0 py-2" /> : null}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-y-1">
          <Label size="xsmall">{t("adjust.delta")}</Label>
          <Input size="small" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder={t("adjust.deltaPlaceholder")} />
        </div>
        <div className="flex flex-col gap-y-1">
          <Label size="xsmall">{t("adjust.reason")}</Label>
          <Input size="small" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("adjust.reasonPlaceholder")} />
        </div>
        <div className="flex items-end">
          <Button size="small" variant="primary" isLoading={adjust.isPending} onClick={submit} disabled={!picked || !delta.trim() || !reason.trim()}>
            <Plus />
            {t("adjust.save")}
          </Button>
        </div>
      </div>
    </Section>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "loyalty",
  icon: LoyaltyIcon,
})

export default LoyaltyPage
