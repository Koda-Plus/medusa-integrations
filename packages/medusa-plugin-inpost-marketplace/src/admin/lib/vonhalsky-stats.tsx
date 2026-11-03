import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowUturnLeft, Calendar, ChartBar, CheckCircle, Clock, CurrencyDollar, ExclamationCircle, InformationCircle, ReceiptPercent, ShoppingCart, Tag, TruckFast, XCircle } from "@medusajs/icons"
import { InlineTip, Table, Text, clx } from "@medusajs/ui"
import type { StatsResponse } from "../../modules/vonhalsky/lib/contract"
import { errorMessage, useVonHalskyStats } from "./vonhalsky-api"
import { EmptyState, FilterBar, FilterButton, Section, StatTile, StatTiles, type Tone } from "./vonhalsky-blocks"
import { KitFetchingBar, KitLoading } from "./vonhalsky-kit"
import { Fact, fmtDate, fmtMoney, fmtNumber, fmtPercent } from "./vonhalsky-ui"

const WINDOWS = [7, 30, 90] as const
type Window = (typeof WINDOWS)[number]

const BAR: Record<Tone, string> = {
  green: "bg-ui-tag-green-icon",
  orange: "bg-ui-tag-orange-icon",
  red: "bg-ui-tag-red-icon",
  blue: "bg-ui-tag-blue-icon",
  grey: "bg-ui-tag-neutral-icon",
  purple: "bg-ui-tag-purple-icon",
}

type BarItem = { key: string; label: ReactNode; value: number; display: string; tone?: Tone }

/** Horizontal bars of plain divs: a name, the bar against the largest value, the number. */
function BarList({ items, empty }: { items: BarItem[]; empty: string }) {
  const max = Math.max(0, ...items.map((i) => i.value))
  if (items.length === 0 || max <= 0) {
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        {empty}
      </Text>
    )
  }
  return (
    <ul className="flex flex-col gap-y-2">
      {items.map((i) => (
        <li key={i.key} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-x-3">
          <span className="txt-compact-xsmall truncate text-ui-fg-subtle">{i.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-ui-bg-component">
            <span className={clx("block h-full rounded-full", BAR[i.tone ?? "blue"])} style={{ width: `${Math.max(2, Math.round((i.value / max) * 100))}%` }} />
          </span>
          <span className="txt-compact-xsmall whitespace-nowrap text-right tabular-nums text-ui-fg-base">{i.display}</span>
        </li>
      ))}
    </ul>
  )
}

/** A count per key as bars, the keys translated under `prefix` when known. */
function tallyItems(record: Record<string, number>, label: (key: string) => string, lang: string, tone?: Tone): BarItem[] {
  return Object.entries(record)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => ({ key, label: label(key), value: n, display: fmtNumber(n, lang), tone }))
}

/** Revenue per day as columns; the tooltip names the day, the revenue and the orders. */
function DailyBars({ daily, lang, currency }: { daily: StatsResponse["revenue"]["daily"]; lang: string; currency: string }) {
  const { t } = useTranslation("vonhalsky")
  const values = daily.map((d) => Number(d.revenue) || 0)
  const max = Math.max(0, ...values)
  if (max <= 0) return <EmptyState compact icon={<ChartBar />} title={t("statsTab.noRevenue")} />
  return (
    <div className="flex flex-col gap-y-1">
      <div className="flex h-36 items-end gap-px" role="img" aria-label={t("statsTab.daily")}>
        {daily.map((d, i) => (
          <span
            key={d.day}
            title={t("statsTab.dayTooltip", { day: fmtDate(d.day, lang), revenue: fmtMoney(d.revenue, currency, lang), orders: d.orders })}
            className="flex h-full min-w-0 flex-1 items-end"
          >
            <span className={clx("block w-full rounded-t-sm", values[i] > 0 ? "bg-ui-tag-blue-icon" : "bg-ui-bg-component")} style={{ height: `${values[i] > 0 ? Math.max(3, Math.round((values[i] / max) * 100)) : 2}%` }} />
          </span>
        ))}
      </div>
      <div className="flex justify-between">
        <Text size="xsmall" className="text-ui-fg-muted">
          {fmtDate(daily[0]?.day, lang)}
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          {fmtDate(daily[daily.length - 1]?.day, lang)}
        </Text>
      </div>
    </div>
  )
}

/** Hours as "18 h" below two days, else "3,5 d". */
function useHours(lang: string): (h: number | null) => string {
  const { t } = useTranslation("vonhalsky")
  return (h) => {
    if (h === null || !Number.isFinite(h)) return t("statsTab.none")
    if (h < 48) return t("statsTab.hours", { value: fmtNumber(Math.round(h * 10) / 10, lang) })
    return t("statsTab.days", { value: fmtNumber(Math.round((h / 24) * 10) / 10, lang) })
  }
}

/** The Statistics tab: what the sync saved about sales, offers, fulfilment and after sale, in a window of 7, 30 or 90 days. */
export function StatsSection({ lang }: { lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const [days, setDays] = useState<Window>(30)
  const stats = useVonHalskyStats(days)
  const d = stats.data
  return (
    <div className="flex flex-col gap-y-3">
      <Section
        id="vonhalsky-stats"
        icon={<ChartBar />}
        title={t("statsTab.title")}
        pointsLabel={t("statsTab.subtitle")}
        points={[
          { icon: <CurrencyDollar />, text: t("statsTab.points.sales") },
          { icon: <Tag />, text: t("statsTab.points.offers") },
          { icon: <ArrowUturnLeft />, text: t("statsTab.points.afterSale") },
          d && { icon: <Calendar />, text: t("statsTab.points.from", { date: fmtDate(d.from, lang) }) },
        ]}
      >
        <FilterBar>
          {WINDOWS.map((w) => (
            <FilterButton key={w} icon={<Calendar />} label={t("statsTab.window", { count: w })} active={days === w} onClick={() => setDays(w)} />
          ))}
        </FilterBar>
        <KitFetchingBar active={stats.isFetching && !stats.isLoading} />
        {stats.isLoading ? <KitLoading label={t("statsTab.loading")} className="py-10" /> : null}
        {stats.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("statsTab.title")}>
              {errorMessage(stats.error)}
            </InlineTip>
          </div>
        ) : null}
        {d ? <Kpis stats={d} lang={lang} /> : null}
        {d && d.notAvailable.length > 0 ? (
          <div className="px-6 py-3">
            <Text size="xsmall" className="flex items-start gap-x-1.5 text-ui-fg-muted">
              <InformationCircle className="mt-px shrink-0" />
              {t("statsTab.notAvailable", { list: d.notAvailable.map((k) => t(`notAvailable.${k}`, { defaultValue: k })).join(", ") })}
            </Text>
          </div>
        ) : null}
      </Section>
      {d ? <StatsBody stats={d} lang={lang} /> : null}
    </div>
  )
}

function Kpis({ stats: d, lang }: { stats: StatsResponse; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const cur = d.currency
  const tiles: Array<{ key: string; value: string; tone: Tone; icon: ReactNode; hint?: string }> = [
    { key: "revenue", value: fmtMoney(d.revenue.vonhalsky, cur, lang), tone: Number(d.revenue.vonhalsky) > 0 ? "green" : "grey", icon: <CurrencyDollar /> },
    { key: "orders", value: fmtNumber(d.revenue.orders, lang), tone: d.revenue.orders > 0 ? "green" : "grey", icon: <ShoppingCart /> },
    { key: "aov", value: d.revenue.aov ? fmtMoney(d.revenue.aov, cur, lang) : t("statsTab.none"), tone: "grey", icon: <ReceiptPercent /> },
    { key: "sellThrough", value: d.offers.sellThrough === null ? t("statsTab.none") : fmtPercent(d.offers.sellThrough, lang), tone: "grey", icon: <ChartBar />, hint: t("statsTab.sellThroughHint") },
    { key: "listed", value: fmtNumber(d.offers.listed, lang), tone: d.offers.listed > 0 ? "green" : "grey", icon: <CheckCircle /> },
    { key: "noSales", value: fmtNumber(d.offers.noSales, lang), tone: d.offers.noSales > 0 ? "orange" : "grey", icon: <ExclamationCircle />, hint: t("statsTab.noSalesHint") },
    { key: "returnRate", value: d.afterSale.returnRate === null ? t("statsTab.none") : fmtPercent(d.afterSale.returnRate, lang), tone: (d.afterSale.returnRate ?? 0) > 0 ? "orange" : "grey", icon: <ArrowUturnLeft /> },
    { key: "claimRate", value: d.afterSale.claimRate === null ? t("statsTab.none") : fmtPercent(d.afterSale.claimRate, lang), tone: (d.afterSale.claimRate ?? 0) > 0 ? "red" : "grey", icon: <XCircle /> },
  ]
  return (
    <StatTiles columns={4}>
      {tiles.map((tile) => (
        <StatTile key={tile.key} icon={tile.icon} label={t(`statsTab.kpi.${tile.key}`)} value={tile.value} tone={tile.tone} hint={tile.hint} />
      ))}
    </StatTiles>
  )
}

/** A block of the tab: a small card with a heading and its content. */
function Block({ icon, title, children, className }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <Section icon={icon} title={title} className={className}>
      <div className="flex flex-col gap-y-3 px-6 py-4">{children}</div>
    </Section>
  )
}

function StatsBody({ stats: d, lang }: { stats: StatsResponse; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const cur = d.currency
  const hours = useHours(lang)
  const noOrders = d.revenue.orders === 0
  const money = (v: string) => fmtMoney(v, cur, lang)
  const channels: BarItem[] = [
    { key: "vonhalsky", label: t("title"), value: Number(d.revenue.vonhalsky) || 0, display: `${money(d.revenue.vonhalsky)} (${fmtNumber(d.revenue.orders, lang)})`, tone: "green" },
    ...d.revenue.otherChannels.map((c) => ({ key: c.id, label: c.id === "none" ? t("statsTab.noChannel") : c.name, value: Number(c.revenue) || 0, display: `${money(c.revenue)} (${fmtNumber(c.orders, lang)})`, tone: "grey" as Tone })),
  ]
  const label = (prefix: string) => (key: string) => t(`${prefix}.${key}`, { defaultValue: key })
  return (
    <>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Block icon={<CurrencyDollar />} title={t("statsTab.channels")}>
          <BarList items={channels} empty={t("statsTab.noRevenue")} />
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("statsTab.channelsHint")}
          </Text>
        </Block>
        <Block icon={<ChartBar />} title={t("statsTab.daily")}>
          <DailyBars daily={d.revenue.daily} lang={lang} currency={cur} />
        </Block>
        <Block icon={<Tag />} title={t("statsTab.offersByStatus")}>
          <BarList items={tallyItems(d.offers.byStatus, label("statsStatus"), lang)} empty={t("statsTab.noOffers")} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Fact label={t("statsTab.pending")}>{fmtNumber(d.offers.pending, lang)}</Fact>
            <Fact label={t("statsTab.rejected")}>{fmtNumber(d.offers.rejected, lang)}</Fact>
            <Fact label={t("statsTab.withPromotion")}>{fmtNumber(d.offers.withPromotion, lang)}</Fact>
            <Fact label={t("statsTab.inProgram")}>{fmtNumber(d.offers.inProgram, lang)}</Fact>
          </div>
          {d.offers.topValidation.length > 0 ? (
            <div className="flex flex-col gap-y-1.5">
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                {t("statsTab.topValidation")}
              </Text>
              <BarList items={d.offers.topValidation.map((v) => ({ key: v.code, label: v.message ? `${v.message} (${v.code})` : v.code, value: v.count, display: fmtNumber(v.count, lang), tone: "red" as Tone }))} empty="" />
            </div>
          ) : null}
          {d.offers.noSalesSample.length > 0 ? (
            <div className="flex flex-col gap-y-1">
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                {t("statsTab.noSalesSample")}
              </Text>
              <ul className="flex flex-col gap-y-0.5">
                {d.offers.noSalesSample.map((o) => (
                  <li key={o.id} className="txt-compact-xsmall flex justify-between gap-x-3 text-ui-fg-subtle">
                    <span className="truncate">{o.title ?? o.sku ?? o.id}</span>
                    <span className="shrink-0 tabular-nums text-ui-fg-muted">{t("statsTab.inStock", { count: o.stock })}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Block>
        <Block icon={<TruckFast />} title={t("statsTab.fulfilment")}>
          {d.fulfilment.toShipHours.count === 0 && d.fulfilment.toDeliveryHours.count === 0 && d.fulfilment.late === 0 ? (
            <EmptyState compact icon={<TruckFast />} title={t("statsTab.noFulfilment")} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Fact label={t("statsTab.toShipMedian")}>{hours(d.fulfilment.toShipHours.median)}</Fact>
              <Fact label={t("statsTab.toShipP90")}>{hours(d.fulfilment.toShipHours.p90)}</Fact>
              <Fact label={t("statsTab.toDeliveryMedian")}>{hours(d.fulfilment.toDeliveryHours.median)}</Fact>
              <Fact label={t("statsTab.late")}>
                <span className={d.fulfilment.late > 0 ? "text-ui-tag-red-text" : undefined}>{fmtNumber(d.fulfilment.late, lang)}</span>
              </Fact>
              <Fact label={t("statsTab.measured")}>{t("statsTab.measuredValue", { ship: d.fulfilment.toShipHours.count, delivery: d.fulfilment.toDeliveryHours.count })}</Fact>
            </div>
          )}
        </Block>
        <Block icon={<ShoppingCart />} title={t("statsTab.mix")}>
          {noOrders ? (
            <EmptyState compact icon={<ShoppingCart />} title={t("statsTab.noOrders")} />
          ) : (
            <>
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                {t("statsTab.mixDelivery")}
              </Text>
              <BarList items={tallyItems(d.mix.delivery, label("delivery"), lang, "blue")} empty={t("statsTab.none")} />
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                {t("statsTab.mixPayment")}
              </Text>
              <BarList items={tallyItems(d.mix.payment, label("paymentType"), lang, "blue")} empty={t("statsTab.none")} />
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                {t("statsTab.mixBuyer")}
              </Text>
              <BarList items={tallyItems(d.mix.buyer, label("buyerKind"), lang, "blue")} empty={t("statsTab.none")} />
            </>
          )}
        </Block>
        <Block icon={<ReceiptPercent />} title={t("statsTab.discounts")}>
          <div className="grid grid-cols-2 gap-3">
            <Fact label={t("statsTab.promotionSaved")}>{money(d.discounts.promotion)}</Fact>
            <Fact label={t("statsTab.programSaved")}>{money(d.discounts.program)}</Fact>
            <Fact label={t("statsTab.discountedRevenue")}>{money(d.discounts.discountedRevenue)}</Fact>
            <Fact label={t("statsTab.discountedUnits")}>{fmtNumber(d.discounts.discountedUnits, lang)}</Fact>
          </div>
        </Block>
        <Block icon={<ArrowUturnLeft />} title={t("statsTab.afterSale")}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Fact label={t("statsTab.returns")}>{fmtNumber(d.afterSale.returns, lang)}</Fact>
            <Fact label={t("statsTab.claims")}>{fmtNumber(d.afterSale.claims, lang)}</Fact>
            <Fact label={t("statsTab.refunds")}>{fmtNumber(d.afterSale.refunds, lang)}</Fact>
            <Fact label={t("statsTab.refunded")}>{money(d.afterSale.refunded)}</Fact>
          </div>
          {d.afterSale.topReasons.length > 0 ? (
            <div className="flex flex-col gap-y-1.5">
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                {t("statsTab.topReasons")}
              </Text>
              <BarList items={d.afterSale.topReasons.map((r) => ({ key: r.reason, label: r.reason === "unknown" ? t("statsTab.unknownReason") : r.reason, value: r.count, display: fmtNumber(r.count, lang), tone: "orange" as Tone }))} empty="" />
            </div>
          ) : null}
        </Block>
        <Block icon={<Clock />} title={t("statsTab.history")}>
          {d.offers.history.length === 0 ? (
            <EmptyState compact icon={<Clock />} title={t("statsTab.noHistory")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>{t("statsTab.day")}</Table.HeaderCell>
                    <Table.HeaderCell className="text-right">{t("statsStatus.PUBLISHED")}</Table.HeaderCell>
                    <Table.HeaderCell className="text-right">{t("statsStatus.PENDING")}</Table.HeaderCell>
                    <Table.HeaderCell className="text-right">{t("statsStatus.SOLDOUT")}</Table.HeaderCell>
                    <Table.HeaderCell className="text-right">{t("statsStatus.CLOSED")}</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {[...d.offers.history].reverse().map((h) => (
                    <Table.Row key={h.day}>
                      <Table.Cell className="whitespace-nowrap tabular-nums">{fmtDate(h.day, lang)}</Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{fmtNumber(h.published, lang)}</Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{fmtNumber(h.pending, lang)}</Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{fmtNumber(h.soldout, lang)}</Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{fmtNumber(h.closed, lang)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
          )}
        </Block>
      </div>
      <Section icon={<ShoppingCart />} title={t("statsTab.products")}>
        {d.products.length === 0 ? (
          <EmptyState compact icon={<ShoppingCart />} title={t("statsTab.noProducts")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{t("offers.product")}</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">{t("statsTab.units")}</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">{t("statsTab.revenue")}</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">{t("statsTab.returns")}</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">{t("statsTab.claims")}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {d.products.map((p) => (
                  <Table.Row key={p.offer_id}>
                    <Table.Cell>
                      <span className="flex flex-col">
                        <span className="txt-compact-small text-ui-fg-base">{p.title ?? p.offer_id}</span>
                        {p.sku ? <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{p.sku}</span> : null}
                      </span>
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">{fmtNumber(p.units, lang)}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap text-right tabular-nums">{money(p.revenue)}</Table.Cell>
                    <Table.Cell className="text-right tabular-nums">{fmtNumber(p.returns, lang)}</Table.Cell>
                    <Table.Cell className="text-right tabular-nums">{fmtNumber(p.claims, lang)}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </Section>
    </>
  )
}
