import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminCustomer, DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Container, Heading, Table, Text } from "@medusajs/ui"
import { useCustomerNegotiations } from "../lib/negotiations-api"
import { NegotiationsIcon } from "../lib/negotiations-icon"
import { NegotiationStatusBadge, WaitingDot, fmtMoney, fmtNumber, fmtRelative, subjectLine } from "../lib/negotiations-ui"

/**
 * Customer page: this customer's negotiations, latest activity first, what
 * they are about, the price on the table and the status. A row opens its
 * thread; "All of this customer" opens the queue narrowed to them.
 */
const NegotiationsCustomerWidget = ({ data }: DetailWidgetProps<AdminCustomer>) => {
  const { t, i18n } = useTranslation("negotiations")
  const lang = i18n.language || "en"
  const q = useCustomerNegotiations(data.id)
  const threads = q.data?.threads ?? []
  if (!q.isLoading && threads.length === 0) return null

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <NegotiationsIcon width={18} height={18} className="shrink-0" />
          <Heading level="h2">{t("widget.customer.title")}</Heading>
          <Badge size="2xsmall" color="grey">
            {fmtNumber(q.data?.count ?? 0, lang)}
          </Badge>
          {q.data?.mode === "demo" ? (
            <Badge size="2xsmall" color="purple">
              {t("drawer.demo")}
            </Badge>
          ) : null}
        </div>
        <Link to={`/negotiations?customer=${encodeURIComponent(data.id)}`} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {t("widget.customer.all")}
        </Link>
      </div>
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
                      <Link to={`/negotiations?thread=${encodeURIComponent(n.id)}`} className="txt-compact-small-plus text-ui-fg-base hover:text-ui-fg-interactive">
                        {n.ref}
                      </Link>
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
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "customer.details.after",
})

export default NegotiationsCustomerWidget
