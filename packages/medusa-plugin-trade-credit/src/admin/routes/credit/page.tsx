import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowUpRightMini, ArrowUpRightOnBox, Buildings, Calendar, Cash, CheckCircle, Clock, CreditCard, EnvelopeSolid, EyeSlash, LockClosedSolid, MagnifyingGlass, PauseSolid, PlaySolid, Plus, Receipt, XMark } from "@medusajs/icons"
import { Badge, Button, Container, Drawer, Heading, IconButton, InlineTip, Input, Label, Select, Table, Text, clx, toast, usePrompt } from "@medusajs/ui"
import { KitFetchingBar, KitLoading, KitSkeletonRows, announce } from "../../lib/credit-kit"
import { KitOrderProductsCell, useKitOrderProducts } from "../../lib/credit-order-products"
import { KeyPoints, usePageView } from "../../lib/credit-guide"
import { GuideView } from "../../lib/credit-guide-view"
import { errorMessage, useCreditStatus, useCustomerSearch, useHideOrder, useReminderPreview, useSendReminder, useSetLimit, useUpdateLimit, type FoundCustomer } from "../../lib/credit-api"
import { CreditIcon } from "../../lib/credit-icon"
import { EmptyLine, SampleBadge, fmtMoney } from "../../lib/credit-ui"
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

function Tile({ label, value, hint, tone = "default", active, onClick }: { label: string; value: string; hint?: string; tone?: "default" | "red" | "orange" | "green" | "blue"; active?: boolean; onClick?: () => void }) {
  const dot = { default: "bg-ui-tag-neutral-icon", red: "bg-ui-tag-red-icon", orange: "bg-ui-tag-orange-icon", green: "bg-ui-tag-green-icon", blue: "bg-ui-tag-blue-icon" }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      className={clx(
        "flex flex-col gap-y-1 rounded-lg border px-4 py-3 text-left transition-fg",
        active ? "border-ui-border-interactive bg-ui-bg-base shadow-borders-interactive-with-active" : "border-ui-border-base bg-ui-bg-subtle hover:bg-ui-bg-base-hover",
      )}
    >
      <span className="flex items-center gap-x-2">
        <span className={clx("size-1.5 rounded-full", dot)} />
        <Text size="xsmall" className="text-ui-fg-subtle">
          {label}
        </Text>
      </span>
      <Text size="xlarge" weight="plus" className="tabular-nums">
        {value}
      </Text>
      {hint ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {hint}
        </Text>
      ) : null}
    </button>
  )
}

/* How much of the limit is used, as a bar. */
function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return (
    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-ui-bg-component">
      <div className={clx("h-full rounded-full", pct >= 100 ? "bg-ui-tag-red-icon" : pct >= 80 ? "bg-ui-tag-orange-icon" : "bg-ui-tag-green-icon")} style={{ width: `${pct}%` }} />
    </div>
  )
}

const CreditPage = () => {
  const { t, i18n } = useTranslation("credit")
  const lang = i18n.language || "en"
  const [view, setView] = usePageView()
  const status = useCreditStatus()
  const s = status.data
  const store = s?.mode === "store"
  const choices = s?.netDayChoices?.length ? s.netDayChoices : DEFAULT_CHOICES
  /* Deep links (the E-mails log, a customer card): ?order_id= opens the order on credit, ?customer_id= the account. */
  const [params] = useSearchParams()
  const askedOrder = (params.get("order_id") ?? "").slice(0, 80)
  const askedCustomer = (params.get("customer_id") ?? "").slice(0, 80)
  const [tab, setTab] = useState<Tab>(askedOrder ? "orders" : "accounts")
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("all")
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("all")
  const [q, setQ] = useState(askedOrder || askedCustomer)
  const [editing, setEditing] = useState<string | null>(null)
  const money = (n: number | null | undefined) => fmtMoney(n ?? 0, "pln", lang)
  const names = useMemo(() => new Map((s?.limits ?? []).map((l) => [l.customer_id, l.company || l.customer_name || l.customer_email || l.customer_id])), [s?.limits])

  const needle = q.trim().toLowerCase()
  const accounts = (s?.limits ?? []).filter((l) => {
    if (accountFilter === "overdue" && !(l.overdue_amount ?? 0)) return false
    if (accountFilter === "exhausted" && !l.exhausted) return false
    if (!needle) return true
    return [l.customer_id, l.customer_name, l.customer_email, l.company].some((x) => (x ?? "").toLowerCase().includes(needle))
  })
  const orders = (s?.orders ?? []).filter((o) => {
    if (orderFilter === "overdue" && o.state !== "overdue") return false
    if (orderFilter === "no_due" && !o.no_due_date) return false
    if (!needle) return true
    return [o.order_id, o.customer_id, String(o.display_id ?? ""), o.document ?? "", names.get(o.customer_id) ?? ""].some((x) => x.toLowerCase().includes(needle))
  })
  const overdueOrders = (s?.orders ?? []).filter((o) => o.state === "overdue").length
  const showAccounts = (f: AccountFilter) => {
    setTab("accounts")
    setAccountFilter((cur) => (cur === f && f !== "all" ? "all" : f))
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-x-3">
            <span className="flex items-center">
              <CreditIcon width={28} height={28} />
            </span>
            <div>
              <div className="flex items-center gap-x-2">
                <Heading>{t("title")}</Heading>
                {s?.demo ? <SampleBadge /> : null}
                {store ? (
                  <Badge size="2xsmall" className="whitespace-nowrap" color="blue" title={t("ui.storeModeHint")}>
                    {t("ui.storeMode")}
                  </Badge>
                ) : null}
              </div>
              <Text size="small" className="text-ui-fg-muted">
                {t("by")}
              </Text>
              <KeyPoints
                className="mt-1.5"
                label={store ? t("ui.subtitleStore") : t("subtitle")}
                items={
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
              />
            </div>
          </div>
          <div role="tablist" className="flex flex-wrap items-center gap-1">
            {(["panel", "guide"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={clx(
                  "rounded-md px-2.5 py-1.5 transition-fg",
                  view === v ? "bg-ui-bg-base txt-compact-small-plus text-ui-fg-base shadow-elevation-card-rest" : "txt-compact-small text-ui-fg-subtle hover:bg-ui-bg-base-hover",
                )}
              >
                {t(`view.${v}`)}
              </button>
            ))}
          </div>
        </div>
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
          <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-4">
            <Tile label={t("ui.tiles.accounts")} value={String(s.counts.limits)} hint={t("ui.tiles.accountsHint")} tone="blue" active={tab === "accounts" && accountFilter === "all"} onClick={() => showAccounts("all")} />
            <Tile label={t("stats.used")} value={money(s.counts.used_total)} hint={t("ui.tiles.usedHint", { count: (s.orders ?? []).length })} onClick={() => { setTab("orders"); setOrderFilter("all") }} active={tab === "orders" && orderFilter === "all"} />
            <Tile
              label={t("ui.tiles.overdue")}
              value={store ? money(s.counts.overdue_total ?? 0) : String(s.counts.overdue)}
              hint={t("ui.tiles.overdueHint", { count: overdueOrders })}
              tone={overdueOrders > 0 ? "red" : "default"}
              active={tab === "orders" && orderFilter === "overdue"}
              onClick={() => { setTab("orders"); setOrderFilter((cur) => (cur === "overdue" ? "all" : "overdue")) }}
            />
            <Tile label={t("ui.tiles.exhausted")} value={String(s.counts.exhausted)} hint={t("ui.tiles.exhaustedHint")} tone={s.counts.exhausted > 0 ? "orange" : "default"} active={tab === "accounts" && accountFilter === "exhausted"} onClick={() => showAccounts("exhausted")} />
          </div>
        ) : null}
        {view === "panel" && s?.ruleText ? (
          <div className="px-6 py-3">
            <InlineTip variant="info" label={t("ui.rule")}>
              {s.ruleText}
            </InlineTip>
          </div>
        ) : null}
      </Container>

      {view === "guide" ? <GuideView /> : null}

      {view === "panel" && s ? (
        <>
          <SetTermsCard status={s} choices={choices} />
          <Container className="divide-y p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
              <div className="flex items-center gap-1 rounded-md bg-ui-bg-subtle p-0.5">
                {(["accounts", "orders"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTab(k)}
                    className={clx("rounded-md px-2.5 py-1 transition-fg", tab === k ? "bg-ui-bg-base txt-compact-small-plus text-ui-fg-base shadow-elevation-card-rest" : "txt-compact-small text-ui-fg-subtle hover:bg-ui-bg-base-hover")}
                  >
                    {k === "accounts" ? t("ui.tabs.accounts", { count: s.limits.length }) : t("ui.tabs.orders", { count: s.orders.length })}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {tab === "orders" ? (
                  <div className="flex items-center gap-1">
                    {(["all", "overdue", "no_due"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setOrderFilter(f)}
                        className={clx("txt-compact-small rounded-full border px-2.5 py-0.5", orderFilter === f ? "border-ui-border-interactive text-ui-fg-interactive" : "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-base-hover")}
                      >
                        {t(`ui.orderFilter.${f}`)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    {(["all", "overdue", "exhausted"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setAccountFilter(f)}
                        className={clx("txt-compact-small rounded-full border px-2.5 py-0.5", accountFilter === f ? "border-ui-border-interactive text-ui-fg-interactive" : "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-base-hover")}
                      >
                        {t(`ui.accountFilter.${f}`)}
                      </button>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <MagnifyingGlass className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ui-fg-muted" />
                  <Input size="small" className="w-60 pl-8" placeholder={t("ui.search")} value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
              </div>
            </div>
            {tab === "accounts" ? (
              <AccountsTable rows={accounts} status={s} choices={choices} editing={editing} setEditing={setEditing} money={money} loading={status.isLoading} />
            ) : (
              <OrdersTable rows={orders} names={names} status={s} money={money} lang={lang} />
            )}
          </Container>
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
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("set.title")}</Heading>
        <KeyPoints
          className="mt-1"
          label={status.mode === "store" ? t("ui.setSubtitleStore") : t("set.subtitle")}
          items={
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
        />
      </div>
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
              <IconButton size="2xsmall" variant="transparent" onClick={() => setPicked(null)}>
                <XMark />
              </IconButton>
            </div>
          ) : (
            <div className="relative">
              <Input size="small" placeholder={t("set.customerPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
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
    </Container>
  )
}

function AccountsTable({ rows, status, choices, editing, setEditing, money, loading }: { rows: LimitDto[]; status: StatusResponse; choices: number[]; editing: string | null; setEditing: (id: string | null) => void; money: (n: number | null | undefined) => string; loading: boolean }) {
  const { t } = useTranslation("credit")
  const update = useUpdateLimit()
  const [draft, setDraft] = useState<{ amount: string; net: string }>({ amount: "", net: "0" })
  const caps = status.capabilities ?? { block: true, pause: true }
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
                {l.blocked ? <Badge size="2xsmall" className="whitespace-nowrap" color="red">{t("limits.blocked")}</Badge> : null}
                {l.status === "paused" ? <Badge size="2xsmall" className="whitespace-nowrap" color="grey">{t("limits.paused")}</Badge> : null}
                {(l.overdue_amount ?? 0) > 0 ? <Badge size="2xsmall" className="whitespace-nowrap" color="red">{t("ui.badgeOverdue")}</Badge> : null}
                {l.exhausted ? <Badge size="2xsmall" className="whitespace-nowrap" color="orange">{t("limits.exhausted")}</Badge> : null}
                {!l.blocked && l.status !== "paused" && !l.exhausted && !(l.overdue_amount ?? 0) ? <Badge size="2xsmall" className="whitespace-nowrap" color="green">{t("limits.active")}</Badge> : null}
                {l.no_limit && l.net_days > 0 ? <Badge size="2xsmall" className="whitespace-nowrap" color="orange" title={t("ui.noLimitHint")}>{t("ui.noLimit")}</Badge> : null}
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
                <div className="flex justify-end gap-1">
                  {caps.pause ? (
                    <IconButton size="small" variant="transparent" title={t("limits.pause")} onClick={() => void toggle(l, { status: l.status === "paused" ? "active" : "paused" })}>
                      {l.status === "paused" ? <PlaySolid /> : <PauseSolid />}
                    </IconButton>
                  ) : null}
                  {caps.block ? (
                    <Button size="small" variant="transparent" onClick={() => void toggle(l, { blocked: !l.blocked })}>
                      {t("limits.block")}
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      setDraft({ amount: String(l.no_limit ? "" : l.limit_amount), net: String(l.net_days) })
                      setEditing(l.id)
                    }}
                  >
                    {t("limits.edit")}
                  </Button>
                </div>
              )}
            </Table.Cell>
          </Table.Row>
        ))}
        {!loading && rows.length === 0 ? (
          <Table.Row>
            <td colSpan={6}>
              <EmptyLine>{t("limits.empty")}</EmptyLine>
            </td>
          </Table.Row>
        ) : null}
      </Table.Body>
    </Table>
  )
}

function OrdersTable({ rows, names, status, money, lang }: { rows: CreditOrderDto[]; names: Map<string, string>; status: StatusResponse; money: (n: number | null | undefined) => string; lang: string }) {
  const { t } = useTranslation("credit")
  const date = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat(lang.startsWith("pl") ? "pl-PL" : "en-GB", { dateStyle: "medium" }).format(new Date(iso)) : "")
  const withReminders = rows.some((o) => o.reminders !== undefined)
  const [reminding, setReminding] = useState<CreditOrderDto | null>(null)
  const cols = withReminders ? 8 : 7
  const products = useKitOrderProducts(rows.map((o) => o.order_id))
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
                <span title={t("ui.noDueHint")}>
                  <Badge size="2xsmall" className="whitespace-nowrap" color="grey">
                    {t("ui.noDue")}
                  </Badge>
                </span>
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
                <Badge size="2xsmall" className="whitespace-nowrap" color="red">
                  {o.overdue_days ? t("ui.daysLate", { days: o.overdue_days }) : t("orders.state.overdue")}
                </Badge>
              ) : (
                <Badge size="2xsmall" className="whitespace-nowrap" color={o.no_due_date ? "grey" : "blue"}>
                  {t("orders.state.open")}
                </Badge>
              )}
            </Table.Cell>
            {withReminders ? (
              <Table.Cell>
                <RemindersCell order={o} status={status} date={date} onRemind={() => setReminding(o)} />
              </Table.Cell>
            ) : null}
            <Table.Cell className="text-right">
              <div className="flex flex-col items-end gap-y-1">
                {status.markPaidPath ? (
                  <Link to={status.markPaidPath.replace(":id", o.order_id)} className="txt-compact-small text-ui-fg-interactive hover:underline" title={t("ui.markPaidHint")}>
                    {t("ui.markPaid")}
                  </Link>
                ) : null}
                {status.canHideOrder ? <HideOrderButton order={o} /> : null}
              </div>
            </Table.Cell>
          </Table.Row>
        ))}
        {rows.length === 0 ? (
          <Table.Row>
            <td colSpan={cols}>
              <EmptyLine>{t("orders.empty")}</EmptyLine>
            </td>
          </Table.Row>
        ) : null}
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
function HideOrderButton({ order }: { order: CreditOrderDto }) {
  const { t } = useTranslation("credit")
  const prompt = usePrompt()
  const hide = useHideOrder()
  const run = async () => {
    const ok = await prompt({ title: t("ui.hide.title", { id: order.display_id ?? "?" }), description: t("ui.hide.text"), confirmText: t("ui.hide.confirm"), cancelText: t("ui.preview.cancel") })
    if (!ok) return
    try {
      await hide.mutateAsync(order.order_id)
      toast.success(t("ui.hide.done", { id: order.display_id ?? "?" }))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  return (
    <Button size="small" variant="transparent" className="px-1 text-ui-fg-muted" isLoading={hide.isPending} onClick={() => void run()} title={t("ui.hide.hint")}>
      <EyeSlash />
      {t("ui.hide.button")}
    </Button>
  )
}

/* The reminders of an order: what went (stage, date, by hand or not), the next one, a link to the e-mail log and the send button. */
function RemindersCell({ order, status, date, onRemind }: { order: CreditOrderDto; status: StatusResponse; date: (iso: string | null | undefined) => string; onRemind: () => void }) {
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
        {status.reminders?.send && !order.no_due_date && !order.reminders_note ? (
          <Button size="small" variant="transparent" className="px-1" onClick={onRemind}>
            <EnvelopeSolid />
            {t("ui.remind")}
          </Button>
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
                  <Badge size="2xsmall" className="whitespace-nowrap" color="orange">
                    {p.stage}
                  </Badge>
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
