import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowPath, BoltSolid, ExclamationCircle, ShoppingCart, SquaresPlus } from "@medusajs/icons"
import { Button, Drawer, InlineTip, Table, Text, toast } from "@medusajs/ui"
import type { CeneoOrderDto, StatusResponse } from "../../modules/ceneo/lib/contract"
import { ORDERS_PAGE, errorMessage, useApiCheck, useCeneoOrder, useCeneoOrders, useSyncOrders } from "./ceneo-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, SearchInput, Section, ToneBadge, useDebouncedValue } from "./ceneo-blocks"
import { KitLoading, KitSkeletonRows } from "./ceneo-kit"

function money(v: number | null, lang: string): string {
  return v === null ? "-" : new Intl.NumberFormat(lang, { style: "currency", currency: "PLN" }).format(v)
}

function when(v: string | null, lang: string): string {
  return v ? new Date(v).toLocaleString(lang, { dateStyle: "short", timeStyle: "short" }) : "-"
}

function OrderState({ o }: { o: CeneoOrderDto }) {
  const { t } = useTranslation("ceneo")
  return <ToneBadge title={o.stateId !== null ? `#${o.stateId}` : undefined}>{o.state ?? (o.stateId !== null ? t("orders.stateId", { id: o.stateId }) : "-")}</ToneBadge>
}

function Problems({ o }: { o: CeneoOrderDto }) {
  const { t } = useTranslation("ceneo")
  if (o.problems.length === 0) return null
  return (
    <ul className="flex flex-col gap-y-0.5">
      {o.problems.map((p, i) => (
        <li key={`${p.code}-${i}`} className="flex gap-x-1.5">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ui-tag-orange-icon" />
          <Text size="xsmall" className="text-ui-fg-subtle">
            {t(`orders.problems.${p.code}`, { detail: p.detail ?? "" })}
          </Text>
        </li>
      ))}
    </ul>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex flex-col gap-y-0.5">
      <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text size="small">{value}</Text>
    </div>
  )
}

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

function OrderDrawer({ id, lang, onClose }: { id: string; lang: string; onClose: () => void }) {
  const { t } = useTranslation("ceneo")
  const q = useCeneoOrder(id)
  const d = q.data
  const ship = d?.shipping ?? null
  const inv = d?.invoice ?? null
  const pick = d?.pickup ?? null
  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content className="max-w-xl">
        <Drawer.Header>
          <Drawer.Title>{t("orders.detailTitle", { number: d?.order.number ?? "" })}</Drawer.Title>
          <Drawer.Description>{t("orders.detailSubtitle")}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          {q.isLoading || !d ? (
            <KitLoading className="min-h-0 py-6" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <OrderState o={d.order} />
                {d.order.demo ? <ToneBadge tone="purple">{t("orders.demo")}</ToneBadge> : null}
                <Text size="xsmall" className="text-ui-fg-muted">
                  {when(d.order.orderedAt, lang)}
                </Text>
              </div>
              {d.detailError ? (
                <InlineTip variant="warning" label={t("orders.detailErrorLabel")}>
                  {d.detailError}
                </InlineTip>
              ) : null}
              <ul className="flex flex-col divide-y rounded-md border">
                {d.order.items.map((i, k) => (
                  <li key={`${i.shopProductId ?? "x"}-${k}`} className="flex items-start justify-between gap-x-3 px-3 py-2">
                    <div className="flex min-w-0 flex-col gap-y-0.5">
                      <Text size="small" weight="plus" className="truncate">
                        {i.name ?? i.shopProductId ?? "-"}
                      </Text>
                      <span className="font-mono text-ui-fg-muted txt-compact-xsmall">
                        {i.shopProductId ?? t("orders.noId")} {i.variantId ? `> ${i.variantId}` : ""}
                      </span>
                      {!i.variantId ? <ToneBadge tone="orange">{t("orders.unmatchedItem")}</ToneBadge> : null}
                    </div>
                    <Text size="small" className="shrink-0 tabular-nums">
                      {i.quantity} x {money(i.price, lang)}
                    </Text>
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("orders.products")} value={money(d.order.amounts.products, lang)} />
                <Field label={t("orders.delivery")} value={`${money(d.order.amounts.delivery, lang)}${d.order.deliveryForm ? `, ${d.order.deliveryForm}` : ""}`} />
                <Field label={t("orders.total")} value={money(d.order.amounts.order, lang)} />
                <Field label={t("orders.remark")} value={d.remark} />
              </div>
              {ship ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("orders.buyer")} value={[s(ship.ShippingFirstName), s(ship.ShippingLastName)].filter(Boolean).join(" ") || null} />
                  <Field label={t("orders.company")} value={s(ship.ShippingCompanyName)} />
                  <Field label={t("orders.address")} value={[s(ship.ShippingAddress), [s(ship.ShippingPostCode), s(ship.ShippingCity)].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null} />
                  <Field label={t("orders.contact")} value={[s(ship.Email), s(ship.PhoneNumber)].filter(Boolean).join(", ") || null} />
                </div>
              ) : null}
              {pick ? <Field label={t("orders.pickup")} value={[s(pick.Name), s(pick.StreetAddress), s(pick.City)].filter(Boolean).join(", ")} /> : null}
              {inv && s(inv.InvoiceNIP) ? <Field label={t("orders.invoice")} value={[s(inv.InvoiceCompanyName), `NIP ${s(inv.InvoiceNIP)}`].filter(Boolean).join(", ")} /> : null}
              <Problems o={d.order} />
            </>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("orders.close")}
            </Button>
          </Drawer.Close>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/** Kup Teraz orders as Ceneo reports them, read only; the import comes later. */
export function OrdersSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("ceneo")
  const [unmatched, setUnmatched] = useState(false)
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const q = useDebouncedValue(search.trim(), 300)
  const orders = useCeneoOrders(q, unmatched, offset)
  const sync = useSyncOrders()
  const check = useApiCheck()
  const rows = orders.data?.orders ?? []
  const count = orders.data?.count ?? 0
  const mode = status.api.mode

  const onSync = () =>
    sync.mutate(undefined, {
      onSuccess: (r) => {
        if (r.status === "synced") toast.success(t("orders.synced", { read: r.read, created: r.created, updated: r.updated }))
        else if (r.status === "failed") toast.error(t("orders.syncFailed", { error: r.error }))
        else if (r.status === "off") toast.info(t("orders.off"))
        else toast.info(t("orders.syncRunning"))
      },
      onError: (e) => toast.error(t("toast.error", { error: errorMessage(e) })),
    })
  const onCheck = () =>
    check.mutate(undefined, {
      onSuccess: (r) => {
        if (r.ok) toast.success(r.mode === "demo" ? t("orders.checkDemo") : t("orders.checkOk", { count: r.limits.length }))
        else toast.error(t("orders.checkFailed", { error: r.error }))
      },
      onError: (e) => toast.error(t("toast.error", { error: errorMessage(e) })),
    })

  return (
    <Section
      id="ceneo-orders"
      icon={<ShoppingCart />}
      title={t("orders.title")}
      badges={mode === "demo" ? <ToneBadge tone="purple">{t("orders.demo")}</ToneBadge> : null}
      points={[
        { icon: <BoltSolid />, text: t("orders.points.read") },
        { icon: <ExclamationCircle />, text: t("orders.points.import") },
      ]}
      actions={
        <div className="flex gap-x-2">
          <Button size="small" variant="transparent" onClick={onCheck} isLoading={check.isPending} disabled={mode === "missing_key"}>
            {t("orders.check")}
          </Button>
          <Button size="small" variant="secondary" onClick={onSync} isLoading={sync.isPending} disabled={mode === "missing_key"}>
            <ArrowPath />
            {t("orders.sync")}
          </Button>
        </div>
      }
    >
      {mode === "missing_key" ? (
        <div className="px-6 py-4">
          <InlineTip variant="info" label={t("orders.title")}>
            {t("orders.needKey")}
          </InlineTip>
        </div>
      ) : null}
      <FilterBar>
        <FilterButton icon={<SquaresPlus />} label={t("orders.all")} count={status.orders.total} active={!unmatched} onClick={() => (setUnmatched(false), setOffset(0))} />
        <FilterButton icon={<ExclamationCircle />} label={t("orders.unmatched")} count={status.orders.unmatched} attention active={unmatched} onClick={() => (setUnmatched(!unmatched), setOffset(0))} />
        <FilterDivider />
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v)
            setOffset(0)
          }}
          placeholder={t("orders.search")}
        />
      </FilterBar>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{t("orders.col.order")}</Table.HeaderCell>
            <Table.HeaderCell>{t("orders.col.state")}</Table.HeaderCell>
            <Table.HeaderCell className="text-right">{t("orders.col.total")}</Table.HeaderCell>
            <Table.HeaderCell>{t("orders.col.items")}</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {orders.isLoading ? (
            <KitSkeletonRows cols={4} rows={4} />
          ) : rows.length === 0 ? (
            <EmptyTableRow cols={4} compact icon={<ShoppingCart />} title={t(status.orders.lastSyncedAt ? "orders.empty" : "orders.emptyNever")} />
          ) : (
            rows.map((o) => (
              <Table.Row key={o.id} className="cursor-pointer [&_td]:py-2.5 [&_td]:align-top" onClick={() => setOpen(o.id)}>
                <Table.Cell>
                  <div className="flex flex-col gap-y-0.5">
                    <span className="txt-compact-small-plus font-mono text-ui-fg-base">{o.number ?? o.ceneoOrderId.slice(0, 8)}</span>
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {when(o.orderedAt, lang)}
                    </Text>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <OrderState o={o} />
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">{money(o.amounts.order, lang)}</Table.Cell>
                <Table.Cell className="max-w-[360px]">
                  <div className="flex flex-col gap-y-1">
                    <Text size="xsmall" className="truncate text-ui-fg-subtle">
                      {o.items.map((i) => `${i.quantity} x ${i.name ?? i.shopProductId ?? "-"}`).join(", ")}
                    </Text>
                    <Problems o={o} />
                  </div>
                </Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table>
      {count > ORDERS_PAGE ? (
        <div className="flex items-center justify-between gap-x-3 px-6 py-3">
          <Text size="xsmall" className="tabular-nums text-ui-fg-subtle">
            {t("offers.page", { from: offset + 1, to: Math.min(offset + ORDERS_PAGE, count), count })}
          </Text>
          <div className="flex gap-x-2">
            <Button size="small" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - ORDERS_PAGE))}>
              {t("offers.prev")}
            </Button>
            <Button size="small" variant="secondary" disabled={offset + ORDERS_PAGE >= count} onClick={() => setOffset(offset + ORDERS_PAGE)}>
              {t("offers.next")}
            </Button>
          </div>
        </div>
      ) : null}
      {open ? <OrderDrawer id={open} lang={lang} onClose={() => setOpen(null)} /> : null}
    </Section>
  )
}
