import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowUpRightMini, PauseSolid, PlaySolid, Plus, XMark } from "@medusajs/icons"
import { Badge, Button, Container, Heading, IconButton, Input, Label, Select, Table, Text, clx, toast } from "@medusajs/ui"
import { announce } from "../../lib/credit-kit"
import { usePageView } from "../../lib/credit-guide"
import { GuideView } from "../../lib/credit-guide-view"
import { useCreditStatus, useCustomerSearch, useSetLimit, useUpdateLimit, type FoundCustomer } from "../../lib/credit-api"
import { CreditIcon } from "../../lib/credit-icon"
import { EmptyLine, SampleBadge, StatTile, fmtMoney } from "../../lib/credit-ui"
import type { CreditOrderDto, LimitDto } from "../../../modules/credit/lib/contract"

/* The host of the koda.integration/1 cards learns about this plugin. */
announce({ ns: "credit", name: "Credit", adminPath: "/credit", Icon: CreditIcon })

/**
 * Trade Credit by Koda Plus. One page: set the credit terms of a customer,
 * the limits with the used and remaining amounts, and the open credit
 * orders with their due dates.
 */

const NET_CHOICES = [0, 14, 30, 60]

const CreditPage = () => {
  const { t } = useTranslation("credit")
  const [view, setView] = usePageView()
  const status = useCreditStatus()
  const s = status.data
  const [editing, setEditing] = useState<string | null>(null)
  const editingLimit = (s?.limits ?? []).find((l) => l.id === editing) ?? null

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
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {t("by")} / {t("subtitle")}
              </Text>
            </div>
          </div>
          <div role="tablist" className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              role="tab"
              aria-selected={view === "panel"}
              onClick={() => setView("panel")}
              className={clx(
                "rounded-md px-2.5 py-1.5 transition-fg",
                view === "panel" ? "bg-ui-bg-base txt-compact-small-plus text-ui-fg-base shadow-elevation-card-rest" : "txt-compact-small text-ui-fg-subtle hover:bg-ui-bg-base-hover",
              )}
            >
              {t("view.panel")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "guide"}
              onClick={() => setView("guide")}
              className={clx(
                "rounded-md px-2.5 py-1.5 transition-fg",
                view === "guide" ? "bg-ui-bg-base txt-compact-small-plus text-ui-fg-base shadow-elevation-card-rest" : "txt-compact-small text-ui-fg-subtle hover:bg-ui-bg-base-hover",
              )}
            >
              {t("view.guide")}
            </button>
          </div>
        </div>
      </Container>

      {view === "guide" ? <GuideView /> : null}

      {view === "panel" && status.isError ? (
        <Container className="p-0">
          <Text size="small" className="px-6 py-4 text-ui-fg-error">
            {t("error", { message: String(status.error) })}
          </Text>
        </Container>
      ) : null}

      {view === "panel" ? (
        <>
          <Container className="p-0">
            <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-4">
              <StatTile label={t("stats.limits")} value={s?.counts.limits ?? "-"} />
              <StatTile label={t("stats.used")} value={s ? fmtMoney(s.counts.used_total, "pln") : "-"} tone="blue" />
              <StatTile label={t("stats.overdue")} value={s?.counts.overdue ?? "-"} tone={(s?.counts.overdue ?? 0) > 0 ? "red" : "default"} />
              <StatTile label={t("stats.blocked")} value={s ? s.counts.blocked + s.counts.exhausted : "-"} tone={(s && s.counts.blocked + s.counts.exhausted > 0) ? "orange" : "default"} />
            </div>
          </Container>

          <SetLimitCard />

          <Container className="divide-y p-0">
            <div className="flex flex-col gap-1 px-6 py-4">
              <Heading level="h2">{t("limits.title")}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {t("limits.subtitle")}
              </Text>
            </div>
            {!s || s.limits.length === 0 ? (
              <EmptyLine>{t("limits.empty")}</EmptyLine>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>{t("limits.customer")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("limits.limit")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("limits.used")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("limits.remaining")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("limits.terms")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("limits.state")}</Table.HeaderCell>
                      <Table.HeaderCell />
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {s.limits.map((l) => (
                      <LimitRow key={l.id} limit={l} onEdit={() => setEditing(editing === l.id ? null : l.id)} />
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
            {editingLimit ? <LimitEditor limit={editingLimit} onDone={() => setEditing(null)} /> : null}
          </Container>

          <Container className="divide-y p-0">
            <div className="flex flex-col gap-1 px-6 py-4">
              <Heading level="h2">{t("orders.title")}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {t("orders.subtitle")}
              </Text>
            </div>
            {!s || s.orders.length === 0 ? (
              <EmptyLine>{t("orders.empty")}</EmptyLine>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>{t("orders.order")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("orders.customer")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("orders.amount")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("orders.due")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("orders.stateLabel")}</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {s.orders.map((o) => (
                      <OrderRow key={o.id} order={o} />
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
          </Container>
        </>
      ) : null}
    </div>
  )
}

function SetLimitCard() {
  const { t } = useTranslation("credit")
  const setLimit = useSetLimit()
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<FoundCustomer | null>(null)
  const [amount, setAmount] = useState("")
  const [netDays, setNetDays] = useState("30")
  const search = useCustomerSearch(q, !picked)

  const submit = () => {
    const value = Number(amount.replace(",", "."))
    if (!picked || !Number.isFinite(value) || value < 0) return
    setLimit.mutate(
      { customer_id: picked.id, limit_amount: value, net_days: Number(netDays) },
      {
        onSuccess: () => {
          setPicked(null)
          setQ("")
          setAmount("")
          toast.success(t("toast.saved"))
        },
        onError: (e) => toast.error(t("toast.error", { error: e.message })),
      },
    )
  }

  return (
    <Container className="p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("set.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("set.subtitle")}
        </Text>
      </div>
      <div className="grid grid-cols-1 gap-3 px-6 pb-4 md:grid-cols-4">
        <div>
          <Label size="xsmall">{t("set.customer")}</Label>
          {picked ? (
            <div className="flex h-8 items-center justify-between gap-x-2 rounded-md border border-ui-border-base bg-ui-bg-subtle px-3">
              <span className="txt-compact-small truncate text-ui-fg-base">{picked.label}</span>
              <button type="button" onClick={() => setPicked(null)} className="text-ui-fg-muted hover:text-ui-fg-base">
                <XMark />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Input size="small" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("set.customerPlaceholder")} />
              {q && (search.data ?? []).length > 0 ? (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-ui-border-base bg-ui-bg-base shadow-elevation-card-rest">
                  {search.data!.map((c) => (
                    <button key={c.id} type="button" onClick={() => { setPicked(c); setQ("") }} className="flex w-full flex-col gap-y-0.5 px-3 py-2 text-left transition-fg hover:bg-ui-bg-base-hover">
                      <span className="txt-compact-small text-ui-fg-base">{c.label}</span>
                      {c.sub ? <span className="txt-compact-xsmall text-ui-fg-muted">{c.sub}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div>
          <Label size="xsmall">{t("set.amount")}</Label>
          <Input size="small" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" />
        </div>
        <div>
          <Label size="xsmall">{t("set.terms")}</Label>
          <Select size="small" value={netDays} onValueChange={setNetDays}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {NET_CHOICES.map((n) => (
                <Select.Item key={n} value={String(n)}>
                  {n === 0 ? t("set.immediate") : t("set.net", { days: n })}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <div className="flex items-end">
          <Button size="small" variant="primary" onClick={submit} disabled={setLimit.isPending || !picked || !amount.trim()}>
            <Plus />
            {t("set.save")}
          </Button>
        </div>
      </div>
    </Container>
  )
}

function LimitRow({ limit, onEdit }: { limit: LimitDto; onEdit: () => void }) {
  const { t } = useTranslation("credit")
  const update = useUpdateLimit()
  const toggle = (body: Record<string, unknown>) =>
    update.mutate({ id: limit.id, body }, { onSuccess: () => toast.success(t("toast.saved")), onError: (e) => toast.error(t("toast.error", { error: e.message })) })
  const net = limit.net_days
  return (
    <Table.Row className="cursor-pointer" onClick={onEdit}>
      <Table.Cell>
        <Link to={`/customers/${limit.customer_id}`} onClick={(e) => e.stopPropagation()} className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {limit.customer_name ?? limit.customer_email ?? limit.customer_id}
        </Link>
        {limit.demo ? (
          <span className="ml-2">
            <SampleBadge />
          </span>
        ) : null}
      </Table.Cell>
      <Table.Cell className="tabular-nums">{fmtMoney(limit.limit_amount, limit.currency_code)}</Table.Cell>
      <Table.Cell className="tabular-nums text-ui-fg-subtle">{fmtMoney(limit.used_amount, limit.currency_code)}</Table.Cell>
      <Table.Cell className="tabular-nums">{fmtMoney(limit.remaining_amount, limit.currency_code)}</Table.Cell>
      <Table.Cell className="text-ui-fg-subtle">{net === 0 ? t("set.immediate") : t("set.net", { days: net })}</Table.Cell>
      <Table.Cell>
        {limit.blocked ? (
          <Badge size="2xsmall" color="red">
            {t("limits.blocked")}
          </Badge>
        ) : limit.exhausted ? (
          <Badge size="2xsmall" color="orange">
            {t("limits.exhausted")}
          </Badge>
        ) : limit.status === "paused" ? (
          <Badge size="2xsmall" color="grey">
            {t("limits.paused")}
          </Badge>
        ) : (
          <Badge size="2xsmall" color="green">
            {t("limits.active")}
          </Badge>
        )}
      </Table.Cell>
      <Table.Cell className="text-right">
        <span className="flex items-center justify-end gap-x-1" onClick={(e) => e.stopPropagation()}>
          <IconButton
            variant="transparent"
            aria-label={t("limits.block")}
            onClick={() => toggle({ blocked: !limit.blocked })}
          >
            <PauseSolid className={limit.blocked ? "text-ui-fg-interactive" : ""} />
          </IconButton>
          <IconButton
            variant="transparent"
            aria-label={t("limits.pause")}
            onClick={() => toggle({ status: limit.status === "paused" ? "active" : "paused" })}
          >
            {limit.status === "paused" ? <PlaySolid /> : <XMark />}
          </IconButton>
          <IconButton variant="transparent" aria-label={t("limits.edit")} onClick={onEdit}>
            <ArrowUpRightMini />
          </IconButton>
        </span>
      </Table.Cell>
    </Table.Row>
  )
}

function LimitEditor({ limit, onDone }: { limit: LimitDto; onDone: () => void }) {
  const { t } = useTranslation("credit")
  const update = useUpdateLimit()
  const [amount, setAmount] = useState(String(limit.limit_amount))
  const [netDays, setNetDays] = useState(String(limit.net_days))
  const submit = () => {
    const value = Number(amount.replace(",", "."))
    if (!Number.isFinite(value) || value < 0) return
    update.mutate(
      { id: limit.id, body: { limit_amount: value, net_days: Number(netDays) } },
      { onSuccess: () => { toast.success(t("toast.saved")); onDone() }, onError: (e) => toast.error(t("toast.error", { error: e.message })) },
    )
  }
  return (
    <div className="grid grid-cols-1 gap-3 border-t border-ui-border-base bg-ui-bg-subtle px-6 py-4 md:grid-cols-4">
      <div className="md:col-span-1">
        <Heading level="h3" className="text-ui-fg-base">
          {limit.customer_name ?? limit.customer_email ?? limit.customer_id}
        </Heading>
      </div>
      <div>
        <Label size="xsmall">{t("set.amount")}</Label>
        <Input size="small" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div>
        <Label size="xsmall">{t("set.terms")}</Label>
        <Select size="small" value={netDays} onValueChange={setNetDays}>
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {NET_CHOICES.map((n) => (
              <Select.Item key={n} value={String(n)}>
                {n === 0 ? t("set.immediate") : t("set.net", { days: n })}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      <div className="flex items-end gap-x-2">
        <Button size="small" variant="primary" onClick={submit} disabled={update.isPending}>
          {t("limits.save")}
        </Button>
        <Button size="small" variant="secondary" onClick={onDone}>
          <XMark />
          {t("limits.cancel")}
        </Button>
      </div>
    </div>
  )
}

function OrderRow({ order }: { order: CreditOrderDto }) {
  const { t } = useTranslation("credit")
  return (
    <Table.Row>
      <Table.Cell>
        <Link to={`/orders/${order.order_id}`} className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {order.display_id ? `#${order.display_id}` : order.order_id}
        </Link>
      </Table.Cell>
      <Table.Cell className="text-ui-fg-subtle">
        <Link to={`/customers/${order.customer_id}`} className="hover:text-ui-fg-interactive">
          {order.customer_id}
        </Link>
      </Table.Cell>
      <Table.Cell className="tabular-nums">{fmtMoney(order.total_amount, order.currency_code)}</Table.Cell>
      <Table.Cell className="text-ui-fg-subtle">{new Date(order.due_at).toLocaleDateString()}</Table.Cell>
      <Table.Cell>
        <Badge size="2xsmall" color={order.state === "overdue" ? "red" : order.state === "paid" ? "green" : "blue"}>
          {t(`orders.state.${order.state}`)}
        </Badge>
      </Table.Cell>
    </Table.Row>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "credit",
  icon: CreditIcon,
})

export default CreditPage
