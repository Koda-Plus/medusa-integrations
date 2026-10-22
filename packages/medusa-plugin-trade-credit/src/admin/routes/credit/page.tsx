import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpRightMini, ArrowUpRightOnBox, Buildings, Calendar, Cash, CheckCircle, Clock, CreditCard, DocumentText, EnvelopeSolid, EyeSlash, LockClosedSolid, LockOpenSolid, MagnifyingGlass, PauseSolid, PencilSquare, PlaySolid, Plus, Receipt, Users, XMark } from "@medusajs/icons"
import { Button, Container, Drawer, IconButton, InlineTip, Input, Label, Select, Table, Text, clx, toast, usePrompt } from "@medusajs/ui"
import { KitFetchingBar, KitLoading, KitSkeletonRows, announce } from "../../lib/credit-kit"
import { KitOrderProductsCell, useKitOrderProducts } from "../../lib/credit-order-products"
import { AddStoreButton, HelpButtons, IntegrationHeader, ModeBadge, SettingsView, communityLabels, usePageNav } from "../../lib/credit-guide"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, StatTile, StatTiles, ToneBadge } from "../../lib/credit-blocks"
import { GuideView, usePromptSpec } from "../../lib/credit-guide-view"
import { OptionsTab, SETTINGS_TABS, StoreTab, type SettingsTabId } from "../../lib/credit-settings"
import { errorMessage, useCreditStatus, useCustomerSearch, useHideOrder, useReminderPreview, useSendReminder, useSetLimit, useUpdateLimit, type FoundCustomer } from "../../lib/credit-api"
import { CreditIcon } from "../../lib/credit-icon"
import { StoreRule } from "../../lib/credit-rule"
import { SampleBadge, fmtMoney } from "../../lib/credit-ui"
import type { CreditOrderDto, LimitDto, StatusResponse } from "../../../modules/credit/lib/contract"

/* The host of the koda.integration/1 cards learns about this plugin. */
announce({ ns: "credit", name: "Credit", adminPath: "/credit", Icon: CreditIcon })

/**
 * Trade Credit by Koda Plus. One page: the accounts with credit terms (limit,
 * used, left, overdue), the open orders on credit with their due dates, and
 * the form that sets a customer's terms. In store mode (option `store`) the
 * page is over the credit the store keeps: the same numbers its checkout uses.
 */

const DEFAULT_CHOICES = [0, 14, 30, 60]

type Tab = "accounts" | "orders"
type OrderFilter = "all" | "overdue" | "no_due"
type AccountFilter = "all" | "overdue" | "exhausted"

/* How much of the limit is used, as a bar. */
function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return (
    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-ui-bg-component">
      <div className={clx("h-full rounded-full", pct >= 100 ? "bg-ui-tag-red-icon" : pct >= 80 ? "bg-ui-tag-orange-icon" : "bg-ui-tag-green-icon")} style={{ width: `${pct}%` }} />
    </div>
  )
}

const ORDER_FILTERS: OrderFilter[] = ["overdue", "no_due"]
const ACCOUNT_FILTERS: AccountFilter[] = ["overdue", "exhausted"]

const CreditPage = () => {
  const { t, i18n } = useTranslation("credit")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const view = nav.view
  const status = useCreditStatus()
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)
  const onRefresh = async () => {
    const r = await status.refetch()
    if (r.isError) toast.error(t("toast.error", { error: errorMessage(r.error) }))
    else toast.success(t("toast.refreshed"))
  }
  const s = status.data
  const store = s?.mode === "store"
  const choices = s?.netDayChoices?.length ? s.netDayChoices : DEFAULT_CHOICES
  /*
   * Deep links: ?order_id= opens the order on credit, ?customer_id= the account
   * (the E-mails log, a customer card); ?filter= (overdue, no_due, exhausted)
   * and ?q= as on every Koda Plus list.
   */
  const [params] = useSearchParams()
  const askedOrder = (params.get("order_id") ?? "").slice(0, 80)
  const askedCustomer = (params.get("customer_id") ?? "").slice(0, 80)
  const askedFilter = params.get("filter") ?? ""
  const [tab, setTab] = useState<Tab>(askedOrder || (ORDER_FILTERS as string[]).includes(askedFilter) ? "orders" : "accounts")
  const [accountFilter, setAccountFilter] = useState<AccountFilter>(askedFilter === "exhausted" ? "exhausted" : "all")
  const [orderFilter, setOrderFilter] = useState<OrderFilter>((ORDER_FILTERS as string[]).includes(askedFilter) ? (askedFilter as OrderFilter) : "all")
  const [q, setQ] = useState((params.get("q") ?? "").slice(0, 80) || askedOrder || askedCustomer)
  const [editing, setEditing] = useState<string | null>(null)
  const money = (n: number | null | undefined) => fmtMoney(n ?? 0, "pln", lang)
  const names = useMemo(() => new Map((s?.limits ?? []).map((l) => [l.customer_id, l.company || l.customer_name || l.customer_email || l.customer_id])), [s?.limits])

  const needle = q.trim().toLowerCase()
  const allLimits = s?.limits ?? []
  const allOrders = s?.orders ?? []
  const accountMatches = (l: LimitDto, f: AccountFilter) => (f === "overdue" ? (l.overdue_amount ?? 0) > 0 : f === "exhausted" ? Boolean(l.exhausted) : true)
  const orderMatches = (o: CreditOrderDto, f: OrderFilter) => (f === "overdue" ? o.state === "overdue" : f === "no_due" ? Boolean(o.no_due_date) : true)
  const accounts = allLimits.filter((l) => {
    if (!accountMatches(l, accountFilter)) return false
    if (!needle) return true
    return [l.customer_id, l.customer_name, l.customer_email, l.company].some((x) => (x ?? "").toLowerCase().includes(needle))
  })
  const orders = allOrders.filter((o) => {
    if (!orderMatches(o, orderFilter)) return false
    if (!needle) return true
    return [o.order_id, o.customer_id, String(o.display_id ?? ""), o.document ?? "", names.get(o.customer_id) ?? ""].some((x) => x.toLowerCase().includes(needle))
  })
  const overdueOrders = allOrders.filter((o) => o.state === "overdue").length
  const showAccounts = (f: AccountFilter) => {
    setTab("accounts")
    setAccountFilter((cur) => (cur === f && f !== "all" ? "all" : f))
  }
  const showOrders = (f: OrderFilter) => {
    setTab("orders")
    setOrderFilter((cur) => (cur === f && f !== "all" ? "all" : f))
  }
  const filtered = Boolean(needle) || (tab === "accounts" ? accountFilter !== "all" : orderFilter !== "all")

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <IntegrationHeader
          icon={<CreditIcon width={28} height={28} />}
          title={t("title")}
          badges={
            s?.demo || store ? (
              <>
                {s?.demo ? <SampleBadge /> : null}
                {store ? (
                  <ModeBadge color="blue" label={t("ui.storeMode")} title={t("ui.storeMode")}>
                    <Text size="small">{t("ui.storeModeHint")}</Text>
                  </ModeBadge>
                ) : null}
              </>
            ) : null
          }
          description={store ? t("ui.subtitleStore") : t("subtitle")}
          points={
            store
              ? [
                  { icon: <Buildings />, text: t("ui.pointsStore.store"), tone: "blue" },
                  { icon: <CreditCard />, text: t("ui.pointsStore.limit") },
                  { icon: <Clock />, text: t("ui.pointsStore.overdue"), tone: "orange" },
                  { icon: <Calendar />, text: t("ui.pointsStore.orders") },
                ]
              : [
                  { icon: <CreditCard />, text: t("points.limits") },
                  { icon: <Calendar />, text: t("points.terms") },
                  { icon: <Receipt />, text: t("points.used") },
                  { icon: <Clock />, text: t("points.overdue"), tone: "orange" },
                  { icon: <LockClosedSolid />, text: t("points.block") },
                ]
          }
          social={<AddStoreButton labels={community.addStore} />}
          help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
          view={view}
          onView={(v) => nav.go(v)}
          labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("settings.title"), more: t("actions.moreActions") }}
          primary={
            view === "panel" && s
              ? { key: "set", label: t("actions.setTerms"), icon: <Plus />, onClick: () => document.getElementById("credit-set")?.scrollIntoView({ behavior: "smooth", block: "start" }) }
              : view === "settings"
                ? { key: "refresh", label: status.isFetching ? t("actions.refreshing") : t("actions.refresh"), icon: <ArrowPath />, loading: status.isFetching, onClick: () => void onRefresh() }
                : null
          }
          actions={
            view === "panel"
              ? [
                  { key: "refresh", label: status.isFetching ? t("actions.refreshing") : t("actions.refresh"), icon: <ArrowPath />, loading: status.isFetching, onClick: () => void onRefresh() },
                  { key: "customers", label: t("actions.customers"), icon: <ArrowUpRightOnBox />, onClick: () => window.location.assign("/app/customers") },
                ]
              : []
          }
        />
        <KitFetchingBar active={status.isFetching && !status.isLoading} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: (status.error as Error)?.message })}
            </InlineTip>
          </div>
        ) : null}
        {view === "panel" && !s && status.isLoading ? <KitLoading label={t("ui.loading")} /> : null}
        {view === "panel" && s ? (
          <StatTiles columns={4}>
            <StatTile icon={<Users />} label={t("ui.tiles.accounts")} value={String(s.counts.limits)} hint={t("ui.tiles.accountsHint")} active={tab === "accounts" && accountFilter === "all"} onClick={() => showAccounts("all")} />
            <StatTile icon={<Receipt />} label={t("stats.used")} value={money(s.counts.used_total)} hint={t("ui.tiles.usedHint", { count: allOrders.length })} active={tab === "orders" && orderFilter === "all"} onClick={() => showOrders("all")} />
            <StatTile
              icon={<Clock />}
              label={t("ui.tiles.overdue")}
              value={store ? money(s.counts.overdue_total ?? 0) : String(s.counts.overdue)}
              hint={t("ui.tiles.overdueHint", { count: overdueOrders })}
              tone={overdueOrders > 0 ? "red" : "grey"}
              active={tab === "orders" && orderFilter === "overdue"}
              onClick={() => showOrders("overdue")}
            />
            <StatTile
              icon={<LockClosedSolid />}
              label={t("ui.tiles.exhausted")}
              value={String(s.counts.exhausted)}
              hint={t("ui.tiles.exhaustedHint")}
              tone={s.counts.exhausted > 0 ? "orange" : "grey"}
              active={tab === "accounts" && accountFilter === "exhausted"}
              onClick={() => showAccounts("exhausted")}
            />
          </StatTiles>
        ) : null}
        {view === "panel" && (s?.ruleText || s?.rulePoints?.length) ? (
          <div className="px-6 py-3">
            <StoreRule status={s} />
          </div>
        ) : null}
      </Container>

      {view === "guide" ? <GuideView status={s} /> : null}

      {view === "settings" && s ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "options", label: t("settings.tab.options") },
            { id: "store", label: t("settings.tab.store") },
          ]}
        >
          {nav.tab === "options" ? <OptionsTab status={s} /> : null}
          {nav.tab === "store" ? <StoreTab status={s} /> : null}
        </SettingsView>
      ) : null}
      {view === "settings" && !s && status.isLoading ? <KitLoading label={t("ui.loading")} /> : null}

      {view === "panel" && s ? (
        <>
          <SetTermsCard status={s} choices={choices} />
          <Section
            id="credit-list"
            icon={tab === "accounts" ? <Users /> : <Receipt />}
            title={tab === "accounts" ? t("ui.list.accountsTitle") : t("ui.list.ordersTitle")}
            pointsLabel={tab === "accounts" ? t("limits.subtitle") : t("orders.subtitle")}
            points={
              tab === "accounts"
                ? [
                    { icon: <CreditCard />, text: t("ui.list.accountsPoints.usage") },
                    { icon: <Clock />, text: t("ui.list.accountsPoints.overdue") },
                    { icon: <PencilSquare />, text: t("ui.list.accountsPoints.edit") },
                  ]
                : [
                    { icon: <Calendar />, text: t("ui.list.ordersPoints.due") },
                    { icon: <Clock />, text: t("ui.list.ordersPoints.daily") },
                    s.reminders?.send ? { icon: <EnvelopeSolid />, text: t("ui.list.ordersPoints.reminders") } : null,
                  ]
            }
            actions={<SearchInput value={q} onChange={setQ} placeholder={tab === "accounts" ? t("ui.searchAccounts") : t("ui.searchOrders")} />}
          >
            <FilterBar>
              <FilterButton icon={<Users />} label={t("ui.tabs.accounts")} count={allLimits.length} active={tab === "accounts"} onClick={() => setTab("accounts")} />
              <FilterButton icon={<Receipt />} label={t("ui.tabs.orders")} count={allOrders.length} active={tab === "orders"} onClick={() => setTab("orders")} />
              <FilterDivider />
              {tab === "accounts"
                ? ACCOUNT_FILTERS.map((f) => (
                    <FilterButton
                      key={f}
                      icon={f === "overdue" ? <Clock /> : <LockClosedSolid />}
                      label={t(`ui.accountFilter.${f}`)}
                      count={allLimits.filter((l) => accountMatches(l, f)).length}
                      attention
                      active={accountFilter === f}
                      onClick={() => showAccounts(f)}
                    />
                  ))
                : ORDER_FILTERS.map((f) => (
                    <FilterButton
                      key={f}
                      icon={f === "overdue" ? <Clock /> : <DocumentText />}
                      label={t(`ui.orderFilter.${f}`)}
                      count={allOrders.filter((o) => orderMatches(o, f)).length}
                      attention={f === "overdue"}
                      active={orderFilter === f}
                      onClick={() => showOrders(f)}
                    />
                  ))}
            </FilterBar>
            {tab === "accounts" ? (
              <AccountsTable rows={accounts} status={s} choices={choices} editing={editing} setEditing={setEditing} money={money} loading={status.isLoading} filtered={filtered} />
            ) : (
              <OrdersTable rows={orders} names={names} status={s} money={money} lang={lang} filtered={filtered} />
            )}
          </Section>
        </>
      ) : null}
    </div>
  )
}

function SetTermsCard({ status, choices }: { status: StatusResponse; choices: number[] }) {
  const { t } = useTranslation("credit")
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<FoundCustomer | null>(null)
  const [amount, setAmount] = useState("")
  const [net, setNet] = useState(String(choices.includes(14) ? 14 : choices[0] ?? 0))
  const search = useCustomerSearch(query.trim(), !picked && query.trim().length >= 2)
  const save = useSetLimit()
  const submit = async () => {
    if (!picked) return
    try {
      await save.mutateAsync({ customer_id: picked.id, limit_amount: Number(amount), net_days: Number(net) })
      toast.success(t("toast.saved"))
      setPicked(null)
      setQuery("")
      setAmount("")
    } catch (err) {
      toast.error(t("toast.error", { error: (err as Error).message }))
    }
  }
  return (
    <Section
      id="credit-set"
      icon={<Plus />}
      title={t("set.title")}
      pointsLabel={status.mode === "store" ? t("ui.setSubtitleStore") : t("set.subtitle")}
      points={
        status.mode === "store"
          ? [
              { icon: <MagnifyingGlass />, text: t("ui.setPointsStore.pick") },
              { icon: <CreditCard />, text: t("ui.setPointsStore.terms") },
              { icon: <CheckCircle />, text: t("ui.setPointsStore.checkout"), tone: "green" },
            ]
          : [
              { icon: <MagnifyingGlass />, text: t("set.points.pick") },
              { icon: <CreditCard />, text: t("set.points.terms") },
              { icon: <Cash />, text: t("set.points.none") },
            ]
      }
    >
      <div className="grid grid-cols-1 gap-3 px-6 py-4 md:grid-cols-[minmax(0,1.4fr)_10rem_10rem_auto] md:items-end">
        <div className="flex flex-col gap-y-1">
          <Label size="small">{t("set.customer")}</Label>
          {picked ? (
            <div className="flex items-center gap-x-2 rounded-md border border-ui-border-interactive px-2.5 py-1.5">
              <Text size="small" weight="plus" className="truncate">
                {picked.label}
              </Text>
              {picked.sub ? (
                <Text size="xsmall" className="truncate text-ui-fg-muted">
                  {picked.sub}
                </Text>
              ) : null}
              <IconButton size="2xsmall" variant="transparent" className="ml-auto" title={t("set.clear")} aria-label={t("set.clear")} onClick={() => setPicked(null)}>
                <XMark />
              </IconButton>
            </div>
          ) : (
            <div className="relative">
              <SearchInput value={query} onChange={setQuery} placeholder={t("set.customerPlaceholder")} className="sm:w-full" />
              {(search.data ?? []).length ? (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-ui-border-base bg-ui-bg-base shadow-elevation-flyout">
                  {(search.data ?? []).map((c) => (
                    <button key={c.id} type="button" onClick={() => setPicked(c)} className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-ui-bg-base-hover">
                      <Text size="small">{c.label}</Text>
                      {c.sub ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {c.sub}
                        </Text>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-y-1">
          <Label size="small">{t("set.amount")}</Label>
          <Input size="small" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="flex flex-col gap-y-1">
          <Label size="small">{t("set.terms")}</Label>
          <Select size="small" value={net} onValueChange={setNet}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {choices.map((d) => (
                <Select.Item key={d} value={String(d)}>
                  {d === 0 ? t("set.immediate") : t("ui.days", { days: d })}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <Button size="small" onClick={() => void submit()} disabled={!picked || amount === ""} isLoading={save.isPending}>
          <Plus />
          {t("set.save")}
        </Button>
      </div>
    </Section>
  )
}

function AccountsTable({ rows, status, choices, editing, setEditing, money, loading, filtered }: { rows: LimitDto[]; status: StatusResponse; choices: number[]; editing: string | null; setEditing: (id: string | null) => void; money: (n: number | null | undefined) => string; loading: boolean; filtered: boolean }) {
  const { t } = useTranslation("credit")
  const update = useUpdateLimit()
  const [draft, setDraft] = useState<{ amount: string; net: string }>({ amount: "", net: "0" })
  const caps = status.capabilities ?? { block: true, pause: true }
  const busy = (l: LimitDto) => update.isPending && update.variables?.id === l.id
  const save = async (l: LimitDto) => {
    try {
      await update.mutateAsync({ id: l.id, body: { limit_amount: Number(draft.amount), net_days: Number(draft.net) } })
      toast.success(t("toast.saved"))
      setEditing(null)
    } catch (err) {
      toast.error(t("toast.error", { error: (err as Error).message }))
    }
  }
  const toggle = async (l: LimitDto, body: Record<string, unknown>) => {
    try {
      await update.mutateAsync({ id: l.id, body })
      toast.success(t("toast.saved"))
    } catch (err) {
      toast.error(t("toast.error", { error: (err as Error).message }))
    }
  }
  return (
    <Table>
      <Table.Header>
        <Table.Row>
          <Table.HeaderCell>{t("limits.customer")}</Table.HeaderCell>
          <Table.HeaderCell>{t("ui.usage")}</Table.HeaderCell>
          <Table.HeaderCell className="text-right">{t("ui.overdueCol")}</Table.HeaderCell>
          <Table.HeaderCell>{t("limits.terms")}</Table.HeaderCell>
          <Table.HeaderCell>{t("limits.state")}</Table.HeaderCell>
          <Table.HeaderCell />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {loading ? <KitSkeletonRows cols={6} /> : null}
        {rows.map((l) => (
          <Table.Row key={l.id} className="align-top [&_td]:h-auto [&_td]:py-3">
            <Table.Cell>
              <Link to={`/customers/${l.customer_id}`} className="group flex flex-col">
                <span className="txt-compact-small-plus group-hover:text-ui-fg-interactive">{l.company || l.customer_name || l.customer_email || l.customer_id}</span>
                {l.company && (l.customer_name || l.customer_email) ? <span className="txt-compact-xsmall text-ui-fg-muted">{l.customer_name || l.customer_email}</span> : null}
                {l.note ? <span className="txt-compact-xsmall text-ui-fg-muted">{l.note}</span> : null}
              </Link>
            </Table.Cell>
            <Table.Cell>
              {editing === l.id ? (
                <Input size="small" type="number" min={0} className="w-32" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} />
              ) : (
                <div className="flex flex-col gap-y-1">
                  <Text size="small" className="tabular-nums">
                    {money(l.used_amount)} <span className="text-ui-fg-muted">/ {l.no_limit ? t("ui.noLimit") : money(l.limit_amount)}</span>
                  </Text>
                  {!l.no_limit ? <UsageBar used={l.used_amount} limit={l.limit_amount} /> : null}
                  {!l.no_limit ? (
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {t("ui.left", { amount: money(l.remaining_amount) })}
                      {l.open_orders ? `, ${t("ui.openOrders", { count: l.open_orders })}` : ""}
                    </Text>
                  ) : null}
                </div>
              )}
            </Table.Cell>
            <Table.Cell className="text-right">
              {(l.overdue_amount ?? 0) > 0 ? (
                <div className="flex flex-col items-end">
                  <Text size="small" weight="plus" className="tabular-nums text-ui-tag-red-text">
                    {money(l.overdue_amount)}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {t("ui.oldest", { days: l.oldest_overdue_days ?? 0 })}
                  </Text>
                </div>
              ) : (
                <Text size="small" className="text-ui-fg-muted">
                  -
                </Text>
              )}
            </Table.Cell>
            <Table.Cell>
              {editing === l.id ? (
                <Select size="small" value={draft.net} onValueChange={(v) => setDraft((d) => ({ ...d, net: v }))}>
                  <Select.Trigger className="w-32">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {[...new Set([...choices, l.net_days])].sort((a, b) => a - b).map((d) => (
                      <Select.Item key={d} value={String(d)}>
                        {d === 0 ? t("set.immediate") : t("ui.days", { days: d })}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              ) : (
                <Text size="small">{l.net_days ? t("ui.days", { days: l.net_days }) : t("set.immediate")}</Text>
              )}
            </Table.Cell>
            <Table.Cell>
              <div className="flex flex-wrap gap-1">
                {l.blocked ? <ToneBadge tone="red">{t("limits.blocked")}</ToneBadge> : null}
                {l.status === "paused" ? <ToneBadge tone="grey">{t("limits.paused")}</ToneBadge> : null}
                {(l.overdue_amount ?? 0) > 0 ? <ToneBadge tone="red">{t("ui.badgeOverdue")}</ToneBadge> : null}
                {l.exhausted ? <ToneBadge tone="orange">{t("limits.exhausted")}</ToneBadge> : null}
                {!l.blocked && l.status !== "paused" && !l.exhausted && !(l.overdue_amount ?? 0) ? <ToneBadge tone="green">{t("limits.active")}</ToneBadge> : null}
                {l.no_limit && l.net_days > 0 ? (
                  <ToneBadge tone="blue" title={t("ui.noLimitHint")}>
                    {t("ui.noLimit")}
                  </ToneBadge>
                ) : null}
              </div>
            </Table.Cell>
            <Table.Cell className="text-right">
              {editing === l.id ? (
                <div className="flex justify-end gap-1">
                  <Button size="small" variant="secondary" onClick={() => setEditing(null)}>
                    {t("limits.cancel")}
                  </Button>
                  <Button size="small" isLoading={update.isPending} onClick={() => void save(l)}>
                    {t("limits.save")}
                  </Button>
                </div>
              ) : (
                <RowActions
                  actions={[
                    {
                      key: "edit",
                      label: t("limits.edit"),
                      icon: <PencilSquare />,
                      onClick: () => {
                        setDraft({ amount: String(l.no_limit ? "" : l.limit_amount), net: String(l.net_days) })
                        setEditing(l.id)
                      },
                    },
                    {
                      key: "pause",
                      label: l.status === "paused" ? t("limits.resume") : t("limits.pauseOne"),
                      icon: l.status === "paused" ? <PlaySolid /> : <PauseSolid />,
                      hidden: !caps.pause,
                      disabled: busy(l),
                      onClick: () => void toggle(l, { status: l.status === "paused" ? "active" : "paused" }),
                    },
                    {
                      key: "block",
                      label: l.blocked ? t("limits.unblock") : t("limits.blockOne"),
                      icon: l.blocked ? <LockOpenSolid /> : <LockClosedSolid />,
                      danger: !l.blocked,
                      hidden: !caps.block,
                      disabled: busy(l),
                      onClick: () => void toggle(l, { blocked: !l.blocked }),
                    },
                  ]}
                />
              )}
            </Table.Cell>
          </Table.Row>
        ))}
        {!loading && rows.length === 0 ? <EmptyTableRow cols={6} icon={<Users />} title={filtered ? t("ui.emptyFiltered") : t("limits.empty")} /> : null}
      </Table.Body>
    </Table>
  )
}

function OrdersTable({ rows, names, status, money, lang, filtered }: { rows: CreditOrderDto[]; names: Map<string, string>; status: StatusResponse; money: (n: number | null | undefined) => string; lang: string; filtered: boolean }) {
  const { t } = useTranslation("credit")
  const navigate = useNavigate()
  const date = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat(lang.startsWith("pl") ? "pl-PL" : "en-GB", { dateStyle: "medium" }).format(new Date(iso)) : "")
  const withReminders = rows.some((o) => o.reminders !== undefined)
  const [reminding, setReminding] = useState<CreditOrderDto | null>(null)
  const cols = withReminders ? 8 : 7
  const products = useKitOrderProducts(rows.map((o) => o.order_id))
  const hide = useHideOrderAction()
  return (
    <>
    <Table>
      <Table.Header>
        <Table.Row>
          <Table.HeaderCell>{t("orders.order")}</Table.HeaderCell>
          <Table.HeaderCell>{t("orders.products")}</Table.HeaderCell>
          <Table.HeaderCell>{t("orders.customer")}</Table.HeaderCell>
          <Table.HeaderCell className="text-right">{t("ui.unpaid")}</Table.HeaderCell>
          <Table.HeaderCell>{t("orders.due")}</Table.HeaderCell>
          <Table.HeaderCell>{t("orders.stateLabel")}</Table.HeaderCell>
          {withReminders ? <Table.HeaderCell>{t("ui.reminders")}</Table.HeaderCell> : null}
          <Table.HeaderCell />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((o) => (
          <Table.Row key={o.id} className="align-top [&_td]:h-auto [&_td]:py-3">
            <Table.Cell>
              <OrderCell order={o} status={status} />
            </Table.Cell>
            <Table.Cell>
              <KitOrderProductsCell data={products.data?.[o.order_id]} loading={products.isLoading} displayId={o.display_id} />
            </Table.Cell>
            <Table.Cell>
              <Link to={`/customers/${o.customer_id}`} className="txt-compact-small hover:text-ui-fg-interactive">
                {names.get(o.customer_id) ?? o.customer_id}
              </Link>
              {o.placed_by ? (
                <Text size="xsmall" className="text-ui-fg-muted">
                  {o.placed_by}
                </Text>
              ) : null}
            </Table.Cell>
            <Table.Cell className="text-right">
              <Text size="small" weight="plus" className="tabular-nums">
                {money(o.unpaid_amount ?? o.total_amount)}
              </Text>
              {o.unpaid_amount != null && o.unpaid_amount + 0.01 < o.total_amount ? (
                <Text size="xsmall" className="text-ui-fg-muted">
                  {t("ui.of", { total: money(o.total_amount) })}
                </Text>
              ) : null}
            </Table.Cell>
            <Table.Cell>
              {o.no_due_date ? (
                <ToneBadge tone="grey" title={t("ui.noDueHint")}>
                  {t("ui.noDue")}
                </ToneBadge>
              ) : (
                <Text size="small">{date(o.due_at)}</Text>
              )}
              {o.reminded_at ? (
                <Text size="xsmall" className="text-ui-fg-muted">
                  {t("ui.reminded", { date: date(o.reminded_at) })}
                </Text>
              ) : null}
            </Table.Cell>
            <Table.Cell>
              {o.state === "overdue" ? (
                <ToneBadge tone="red">{o.overdue_days ? t("ui.daysLate", { days: o.overdue_days }) : t("orders.state.overdue")}</ToneBadge>
              ) : (
                <ToneBadge tone={o.no_due_date ? "grey" : "blue"}>{t("orders.state.open")}</ToneBadge>
              )}
            </Table.Cell>
            {withReminders ? (
              <Table.Cell>
                <RemindersCell order={o} status={status} date={date} />
              </Table.Cell>
            ) : null}
            <Table.Cell className="text-right">
              <RowActions
                actions={[
                  {
                    key: "remind",
                    label: t("ui.remind"),
                    icon: <EnvelopeSolid />,
                    hidden: !(status.reminders?.send && !o.no_due_date && !o.reminders_note),
                    onClick: () => setReminding(o),
                  },
                  {
                    key: "settle",
                    label: t("ui.markPaidHint"),
                    icon: <Cash />,
                    hidden: !status.markPaidPath,
                    onClick: () => navigate((status.markPaidPath ?? "").replace(":id", o.order_id)),
                  },
                  {
                    key: "hide",
                    label: t("ui.hide.hint"),
                    icon: <EyeSlash />,
                    hidden: !status.canHideOrder,
                    loading: hide.pendingFor === o.order_id,
                    onClick: () => void hide.run(o),
                  },
                ]}
              />
            </Table.Cell>
          </Table.Row>
        ))}
        {rows.length === 0 ? <EmptyTableRow cols={cols} icon={<Receipt />} title={filtered ? t("ui.emptyFiltered") : t("orders.empty")} /> : null}
      </Table.Body>
    </Table>
    {reminding ? <ReminderDrawer order={reminding} onClose={() => setReminding(null)} /> : null}
    </>
  )
}

/** The Medusa mark, in the text colour (the same as on the other Koda Plus pages). */
function MedusaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 38" fill="none" aria-hidden className={className}>
      <path d="M30.85 6.16832L22.2453 1.21782C19.4299 -0.405941 15.9801 -0.405941 13.1648 1.21782L4.52043 6.16832C1.74473 7.79208 0 10.802 0 14.0099V23.9505C0 27.198 1.74473 30.1683 4.52043 31.7921L13.1251 36.7822C15.9405 38.4059 19.3903 38.4059 22.2056 36.7822L30.8103 31.7921C33.6257 30.1683 35.3307 27.198 35.3307 23.9505V14.0099C35.41 10.802 33.6653 7.79208 30.85 6.16832ZM17.6852 27.8317C12.8079 27.8317 8.8426 23.8713 8.8426 19C8.8426 14.1287 12.8079 10.1683 17.6852 10.1683C22.5625 10.1683 26.5674 14.1287 26.5674 19C26.5674 23.8713 22.6022 27.8317 17.6852 27.8317Z" fill="currentColor" />
    </svg>
  )
}

/* The order: Medusa (the mark and the number) and, under it, its document in the invoicing service. */
function OrderCell({ order, status }: { order: CreditOrderDto; status: StatusResponse }) {
  const { t } = useTranslation("credit")
  const source = status.documentSource
  return (
    <div className="flex min-w-[150px] flex-col items-start gap-y-1.5">
      <Link to={`/orders/${order.order_id}`} className="group flex items-center gap-x-2" title={t("ui.openOrder")}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ui-bg-component shadow-borders-base transition-fg group-hover:bg-ui-bg-component-hover">
          <MedusaMark className="h-3 w-3 text-ui-fg-base" />
        </span>
        <span className="txt-compact-small-plus tabular-nums text-ui-fg-interactive group-hover:underline">#{order.display_id ?? "?"}</span>
      </Link>
      {order.document ? (
        order.document_url ? (
          <a href={order.document_url} target="_blank" rel="noreferrer" className="group flex items-center gap-x-2" title={source ? t("ui.openIn", { name: source.name }) : undefined}>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-ui-bg-component shadow-borders-base">
              {source?.icon ? <img src={source.icon} alt="" className="h-6 w-6" /> : <ArrowUpRightOnBox className="text-ui-fg-muted" />}
            </span>
            <span className="txt-compact-xsmall font-mono text-ui-fg-interactive group-hover:underline">{order.document}</span>
            <ArrowUpRightOnBox className="text-ui-fg-muted" />
          </a>
        ) : (
          <Text size="xsmall" className="font-mono text-ui-fg-subtle">
            {order.document}
          </Text>
        )
      ) : null}
      {order.payment_label ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {order.payment_label}
        </Text>
      ) : null}
    </div>
  )
}

/* A test order off the page for good: the store marks it (nothing is deleted), after a confirmation. */
function useHideOrderAction(): { run: (order: CreditOrderDto) => Promise<void>; pendingFor: string | null } {
  const { t } = useTranslation("credit")
  const prompt = usePrompt()
  const hide = useHideOrder()
  const run = async (order: CreditOrderDto) => {
    const ok = await prompt({ title: t("ui.hide.title", { id: order.display_id ?? "?" }), description: t("ui.hide.text"), confirmText: t("ui.hide.confirm"), cancelText: t("ui.preview.cancel") })
    if (!ok) return
    try {
      await hide.mutateAsync(order.order_id)
      toast.success(t("ui.hide.done", { id: order.display_id ?? "?" }))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  return { run, pendingFor: hide.isPending ? (hide.variables ?? null) : null }
}

/* The reminders of an order: what went (stage, date, by hand or not), the next one, a link to the e-mail log and the send button. */
function RemindersCell({ order, status, date }: { order: CreditOrderDto; status: StatusResponse; date: (iso: string | null | undefined) => string }) {
  const { t } = useTranslation("credit")
  const [open, setOpen] = useState(false)
  const list = order.reminders ?? []
  const sent = list.filter((r) => r.ok)
  const failed = list.length - sent.length
  const before = sent.filter((r) => !r.overdue).length
  const after = sent.length - before
  const last = sent[sent.length - 1] ?? null
  const log = status.reminders?.emailsLogPath ? status.reminders.emailsLogPath.split(":order_id").join(encodeURIComponent(order.order_id)) : null
  return (
    <div className="flex min-w-[190px] flex-col items-start gap-y-0.5">
      {sent.length === 0 ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("ui.remindersNone")}
        </Text>
      ) : (
        <>
          <Text size="small" weight="plus">
            {t("ui.remindersSent", { count: sent.length })}
          </Text>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {[before ? t("ui.remindersBefore", { count: before }) : null, after ? t("ui.remindersAfter", { count: after }) : null].filter(Boolean).join(", ")}
          </Text>
          {last ? (
            <Text size="xsmall" className="text-ui-fg-subtle">
              {t("ui.remindersLast", { date: date(last.at) })}
              {last.manual ? `, ${t("ui.remindersManual")}` : ""}
            </Text>
          ) : null}
        </>
      )}
      {failed > 0 ? (
        <Text size="xsmall" className="text-ui-tag-red-text">
          {t("ui.remindersFailedCount", { count: failed })}
        </Text>
      ) : null}
      {order.next_reminder ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {order.next_reminder.at ? t("ui.remindersNextAt", { date: date(order.next_reminder.at) }) : t("ui.remindersNextNoDate", { stage: order.next_reminder.stage })}
        </Text>
      ) : null}
      {order.reminders_note ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {order.reminders_note}
        </Text>
      ) : null}
      {open && list.length ? (
        <ol className="mt-1 flex flex-col gap-y-0.5 border-l-2 border-ui-border-base pl-2">
          {list.map((r, i) => (
            <li key={`${r.at}-${i}`} className={clx("txt-compact-xsmall", r.ok ? "text-ui-fg-subtle" : "text-ui-tag-red-text")}>
              {date(r.at)}, {r.overdue ? t("ui.stageAfter") : t("ui.stageBefore")}
              {r.manual ? `, ${t("ui.remindersManual")}` : ""}
              {!r.ok ? `, ${t("ui.remindersFailed")}` : ""}
            </li>
          ))}
        </ol>
      ) : null}
      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {list.length > 1 ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className="txt-compact-xsmall-plus text-ui-fg-interactive hover:underline">
            {open ? t("ui.remindersHide") : t("ui.remindersShow")}
          </button>
        ) : null}
        {log && list.length > 0 ? (
          <Link to={log} className="txt-compact-xsmall-plus inline-flex items-center gap-x-0.5 text-ui-fg-interactive hover:underline">
            {t("ui.remindersLog")}
            <ArrowUpRightMini />
          </Link>
        ) : null}
      </span>
    </div>
  )
}

/* Preview first: who gets it, the subject and the rendered e-mail; it goes only on Send. */
function ReminderDrawer({ order, onClose }: { order: CreditOrderDto; onClose: () => void }) {
  const { t } = useTranslation("credit")
  const preview = useReminderPreview(order.order_id)
  const send = useSendReminder()
  const p = preview.data
  const submit = async () => {
    try {
      const r = await send.mutateAsync(order.order_id)
      toast.success(t("ui.preview.sent", { stage: r.stage }))
      onClose()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content className="max-w-3xl">
        <Drawer.Header>
          <Drawer.Title>
            {t("ui.preview.title")} #{order.display_id ?? "?"}
          </Drawer.Title>
          <Drawer.Description>{t("ui.preview.subtitle")}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-3 overflow-y-auto">
          {preview.isLoading ? <KitLoading label={t("ui.preview.loading")} /> : null}
          {preview.isError ? (
            <InlineTip variant="error" label={t("ui.preview.title")}>
              {errorMessage(preview.error)}
            </InlineTip>
          ) : null}
          {p ? (
            <>
              {p.warning ? (
                <InlineTip variant="warning" label={t("ui.preview.title")}>
                  {p.warning}
                </InlineTip>
              ) : null}
              <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <Text size="small" className="text-ui-fg-muted">
                  {t("ui.preview.to")}
                </Text>
                <Text size="small" className="font-mono">
                  {p.to}
                </Text>
                <Text size="small" className="text-ui-fg-muted">
                  {t("ui.preview.subject")}
                </Text>
                <Text size="small" weight="plus">
                  {p.subject}
                </Text>
                <Text size="small" className="text-ui-fg-muted">
                  {t("ui.preview.stage")}
                </Text>
                <span>
                  <ToneBadge tone="orange">{p.stage}</ToneBadge>
                </span>
              </div>
              <iframe title={p.subject} sandbox="" srcDoc={p.html} className="h-[60vh] w-full rounded-md border border-ui-border-base bg-white" />
            </>
          ) : null}
        </Drawer.Body>
        <Drawer.Footer>
          <Button size="small" variant="secondary" onClick={onClose}>
            {t("ui.preview.cancel")}
          </Button>
          <Button size="small" disabled={!p} isLoading={send.isPending} onClick={() => void submit()}>
            <EnvelopeSolid />
            {t("ui.preview.send")}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

export const config = defineRouteConfig({
  label: "Credit",
  translationNs: "credit",
  icon: CreditIcon,
  rank: 7,
})

export default CreditPage
