import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminCustomer, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Button, Heading, Table, Text } from "@medusajs/ui"
import { useCustomerNegotiations } from "../lib/negotiations-api"
import { ToneBadge } from "../lib/negotiations-blocks"
import { NegotiationsIcon } from "../lib/negotiations-icon"
import { WidgetFrame } from "../lib/negotiations-kit"
import { DemoBadge, NegotiationStatusBadge, WaitingDot, fmtMoney, fmtNumber, fmtRelative, subjectLine } from "../lib/negotiations-ui"

/**
 * Customer page: this customer's negotiations, latest activity first, what
 * they are about, the price on the table and the status. A row opens its
 * thread; "All of this customer" opens the queue narrowed to them. Hidden
 * when the customer never negotiated. Links are plain anchors: a
 * react-router Link inside a widget breaks in some admins.
 */
const NegotiationsCustomerWidget = ({ data }: DetailWidgetProps<AdminCustomer>) => {
  const { t, i18n } = useTranslation("negotiations")
  const lang = i18n.language || "en"
  const q = useCustomerNegotiations(data.id)
  const threads = q.data?.threads ?? []
  if (!q.isLoading && threads.length === 0) return null
  const waiting = threads.filter((n) => n.waitingFor === "team").length

  return (
    <WidgetFrame
      header={
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
          <div className="flex items-center gap-x-2">
            <NegotiationsIcon width={18} height={18} className="shrink-0" />
            <Heading level="h2">{t("widget.customer.title")}</Heading>
            <ToneBadge>
              <span className="tabular-nums">{fmtNumber(q.data?.count ?? 0, lang)}</span>
            </ToneBadge>
            {waiting > 0 ? <ToneBadge tone="orange">{t("waitingBadge", { count: waiting })}</ToneBadge> : null}
            {q.data?.mode === "demo" ? <DemoBadge /> : null}
          </div>
          <Button size="small" variant="secondary" asChild>
            <a href={`/app/negotiations?customer=${encodeURIComponent(data.id)}`}>
              <ArrowUpRightOnBox />
              {t("widget.customer.all")}
            </a>
          </Button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("queue.col.thread")}</Table.HeaderCell>
              <Table.HeaderCell>{t("queue.col.subject")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("queue.col.price")}</Table.HeaderCell>
              <Table.HeaderCell>{t("queue.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("queue.col.activity")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {threads.map((n) => {
              const s = subjectLine(n, t)
              return (
                <Table.Row key={n.id}>
                  <Table.Cell>
                    <span className="flex items-center gap-x-2">
                      <WaitingDot waiting={n.waitingFor === "team"} />
                      <a href={`/app/negotiations?thread=${encodeURIComponent(n.id)}`} className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                        {n.ref}
                      </a>
                    </span>
                  </Table.Cell>
                  <Table.Cell className="max-w-[16rem]">
                    <Text size="small" leading="compact" className="truncate">
                      {s.main}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtMoney(n.price, n.currencyCode, lang) || "-"}</Table.Cell>
                  <Table.Cell>
                    <NegotiationStatusBadge status={n.status} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{fmtRelative(n.lastActivityAt, lang)}</Table.Cell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table>
      </div>
    </WidgetFrame>
  )
}

export const config = defineWidgetConfig({
  zone: "customer.details.after",
})

export default NegotiationsCustomerWidget
