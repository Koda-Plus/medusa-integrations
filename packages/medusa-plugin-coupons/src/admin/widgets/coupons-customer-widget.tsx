import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminCustomer, DetailWidgetProps } from "@medusajs/framework/types"
import { Heading, Text } from "@medusajs/ui"
import { Receipt } from "@medusajs/icons"
import { useCustomerCoupons } from "../lib/coupons-api"
import { CouponsIcon } from "../lib/coupons-icon"
import { KitLoading, WidgetFrame, hostable } from "../lib/coupons-kit"
import { EmptyState } from "../lib/coupons-blocks"
import { couponSentence } from "../lib/coupons-sentence"
import { StatusBadge, useFormat } from "../lib/coupons-ui"

/**
 * Customer page, side column: the codes this customer used (orders and the
 * discount they got) and the coupons made for them or for their groups.
 */
const CouponsCustomerCard = ({ data, embedded }: DetailWidgetProps<AdminCustomer> & { embedded?: boolean }) => {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const q = useCustomerCoupons(data?.id)
  const r = q.data
  const empty = !r || (r.used.length === 0 && r.forThem.length === 0)
  if (!embedded && empty) return null
  /* Embedded in a host: a loader first, never "none" before the data came. */
  if (embedded && q.isLoading) return <KitLoading />
  const currency = r?.currency || "PLN"
  return (
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex flex-col gap-y-1.5 px-6 py-4">
          <div className="flex items-center justify-between gap-x-2">
            <div className="flex items-center gap-x-2">
              <CouponsIcon width={18} height={18} />
              <Heading level="h2">{t("widget.customer.title")}</Heading>
              
            </div>
            <a href="/app/coupons" className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
              {t("widget.open")}
            </a>
          </div>
        </div>
      }
    >
      {empty || !r ? (
        <div className="px-6 py-4">
          <EmptyState compact icon={<Receipt />} title={t("widget.customer.none")} />
        </div>
      ) : (
        <>
          {r.used.length ? (
            <div className="flex flex-col gap-y-2 px-6 py-4">
              <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
                {t("widget.customer.used")}
              </Text>
              {r.used.map((u) => (
                <div key={u.code || "auto"} className="flex items-center justify-between gap-2">
                  <span className="flex flex-col">
                    <a href={`/app/coupons?q=${encodeURIComponent(u.code)}`} className="txt-compact-small-plus font-mono text-ui-fg-interactive hover:underline">
                      {u.code || t("list.noCode")}
                    </a>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {t("widget.customer.orders", { count: u.orders })}
                      {u.lastAt ? `, ${fmt.date(u.lastAt)}` : ""}
                    </Text>
                  </span>
                  <Text size="small" className="tabular-nums">
                    -{fmt.money(u.discount, currency)}
                  </Text>
                </div>
              ))}
            </div>
          ) : null}
          {r.forThem.length ? (
            <div className="flex flex-col gap-y-2 px-6 py-4">
              <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
                {t("widget.customer.forThem")}
              </Text>
              {r.forThem.map((c) => (
                <div key={c.id} className="flex flex-col gap-y-1">
                  <span className="flex items-center gap-1.5">
                    <span className="txt-compact-small-plus font-mono">{c.code || t("list.noCode")}</span>
                    <StatusBadge status={c.status} />
                  </span>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {couponSentence(c, r.names, t, fmt, currency)}
                  </Text>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </WidgetFrame>
  )
}

export const config = defineWidgetConfig({
  zone: "customer.details.side.after",
})

export default hostable({ id: "coupons.customer", ns: "coupons", zone: "customer.details", name: "Coupons", order: 95, Icon: CouponsIcon, hideWhenNone: true }, CouponsCustomerCard)
