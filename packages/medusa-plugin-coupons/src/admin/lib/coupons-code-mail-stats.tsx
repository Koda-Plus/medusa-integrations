import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Cash, ChartBar, CheckCircle, Envelope, Eye, ShoppingCart, Users, XCircle } from "@medusajs/icons"
import { Heading, Text } from "@medusajs/ui"
import type { CodeMailCampaignDto, CodeMailDeliveryCounts } from "../../modules/coupons/lib/contract"
import { useCodeMailStats } from "./coupons-api"
import { ToneBadge } from "./coupons-blocks"
import { KitLoading } from "./coupons-kit"
import { useFormat } from "./coupons-ui"

/**
 * The results of the code's e-mails in the coupon's drawer: one row per send
 * (when, who, people, delivered, opened, ordered, orders, revenue,
 * conversion) and a line with all orders with the code next to them.
 * Compact: numbers with icons, the meaning in each badge's tooltip.
 */
export function CodeMailStats({ id }: { id: string }) {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const stats = useCodeMailStats(id)
  const d = stats.data
  if (!d && stats.isLoading) return <KitLoading label={t("codeStats.loading")} />
  if (!d || d.campaigns.length === 0) return null
  const money = (n: number) => fmt.money(n, d.currency)
  const basis = t(`codeStats.basis.${d.revenueBasis}`)
  const pct = (n: number | null) => (n === null ? "" : `${fmt.number(n)}%`)

  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading level="h3" className="flex items-center gap-x-2">
          <ChartBar className="text-ui-fg-subtle" />
          {t("codeStats.title")}
        </Heading>
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("codeStats.revenueIs", { basis })}
        </Text>
      </div>
      <div className="flex flex-col divide-y rounded-md border border-ui-border-base">
        {d.campaigns.map((c) => (
          <Row key={`${c.at}-${c.by ?? ""}`} c={c} money={money} pct={pct} basis={basis} date={c.at ? fmt.date(c.at) : "?"} />
        ))}
        {d.campaigns.length > 1 ? (
          <Row
            total
            c={{ at: "", by: null, recipients: d.totals.recipients, delivery: d.totals.delivery, buyers: d.totals.buyers, orders: d.totals.orders, revenue: d.totals.revenue, conversion: d.totals.conversion }}
            money={money}
            pct={pct}
            basis={basis}
            date={t("codeStats.total")}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Text size="xsmall" className="text-ui-fg-subtle">
          {t("codeStats.allLabel")}
        </Text>
        <ToneBadge icon={<ShoppingCart />} title={t("codeStats.allHint")}>
          {t("codeStats.all", { orders: d.totals.allOrders, revenue: money(d.totals.allRevenue) })}
        </ToneBadge>
        <ToneBadge tone="grey" icon={<Users />} title={t("codeStats.othersHint")}>
          {t("codeStats.others", { orders: d.totals.otherOrders, revenue: money(d.totals.otherRevenue) })}
        </ToneBadge>
      </div>
      {!d.deliveryKnown ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("codeStats.noDelivery")}
        </Text>
      ) : null}
    </div>
  )
}

function Row({ c, date, money, pct, basis, total = false }: { c: CodeMailCampaignDto; date: string; money: (n: number) => string; pct: (n: number | null) => string; basis: string; total?: boolean }) {
  const { t } = useTranslation("coupons")
  return (
    <div className={total ? "flex flex-wrap items-center justify-between gap-2 bg-ui-bg-subtle px-3 py-2" : "flex flex-wrap items-center justify-between gap-2 px-3 py-2"}>
      <span className="flex min-w-0 flex-col">
        <Text size="small" weight="plus">
          {date}
        </Text>
        {!total ? (
          <Text size="xsmall" className="truncate text-ui-fg-subtle">
            {c.by ? t("codeStats.by", { who: c.by }) : t("codeStats.byUnknown")}
          </Text>
        ) : null}
        {!total && c.withCodes?.length ? (
          <Text size="xsmall" className="truncate text-ui-fg-subtle">
            {t("codeStats.withCodes", { codes: c.withCodes.join(", ") })}
          </Text>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge icon={<Envelope />} title={t("codeStats.recipientsHint")}>
          {t("codeStats.recipients", { n: c.recipients })}
        </Badge>
        <Delivery d={c.delivery} />
        <Badge icon={<ShoppingCart />} tone={c.buyers ? "green" : "grey"} title={t("codeStats.buyersHint", { buyers: c.buyers, orders: c.orders })}>
          {c.orders !== c.buyers ? t("codeStats.buyersOrders", { n: c.buyers, orders: c.orders }) : t("codeStats.buyers", { n: c.buyers })}
        </Badge>
        <Badge icon={<Cash />} tone={c.revenue ? "green" : "grey"} title={t("codeStats.revenueHint", { basis })}>
          {t("codeStats.revenue", { amount: money(c.revenue), basis })}
        </Badge>
        <Badge icon={<ChartBar />} tone={c.conversion ? "blue" : "grey"} title={t("codeStats.conversionHint")}>
          {t("codeStats.conversion", { pct: c.conversion === null ? "-" : pct(c.conversion) })}
        </Badge>
      </span>
    </div>
  )
}

function Delivery({ d }: { d: CodeMailDeliveryCounts | null }) {
  const { t } = useTranslation("coupons")
  if (!d) return null
  return (
    <>
      <Badge icon={<CheckCircle />} tone={d.delivered ? "green" : "grey"} title={t("codeStats.deliveredHint")}>
        {t("codeStats.delivered", { n: d.delivered })}
      </Badge>
      <Badge icon={<Eye />} tone={d.opened ? "blue" : "grey"} title={t("codeStats.openedHint")}>
        {t("codeStats.opened", { n: d.opened })}
      </Badge>
      {d.failed ? (
        <Badge icon={<XCircle />} tone="red" title={t("codeStats.failedHint")}>
          {t("codeStats.failed", { n: d.failed })}
        </Badge>
      ) : null}
    </>
  )
}

function Badge({ icon, tone = "grey", title, children }: { icon: ReactNode; tone?: "grey" | "green" | "blue" | "red"; title: string; children: ReactNode }) {
  return (
    <ToneBadge tone={tone} icon={icon} title={title} size="xsmall">
      <span className="tabular-nums">{children}</span>
    </ToneBadge>
  )
}
