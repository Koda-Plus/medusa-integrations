import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { ArrowUpRightOnBox, BellAlert, ChatBubbleLeftRight } from "@medusajs/icons"
import { Button, Heading, Table, Text } from "@medusajs/ui"
import { useWaitingNegotiations } from "../lib/negotiations-api"
import { ToneBadge } from "../lib/negotiations-blocks"
import { KeyPoints } from "../lib/negotiations-guide"
import { NegotiationsIcon } from "../lib/negotiations-icon"
import { WidgetFrame } from "../lib/negotiations-kit"
import { WaitingDot, customerLine, fmtMoney, fmtNumber, fmtRelative, subjectLine } from "../lib/negotiations-ui"

/**
 * Above the order list: the price requests waiting for the team, so they do
 * not wait for someone to open the Negotiations page. Hidden when nothing
 * waits. Links are plain anchors: a react-router Link inside a widget breaks
 * in some admins.
 */
const NegotiationsOrdersWidget = () => {
  const { t, i18n } = useTranslation("negotiations")
  const lang = i18n.language || "en"
  const q = useWaitingNegotiations()
  const threads = q.data?.threads ?? []
  if (threads.length === 0) return null

  return (
    <WidgetFrame
      header={
        <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-col gap-y-1.5">
            <div className="flex items-center gap-x-2">
              <NegotiationsIcon width={20} height={20} />
              <Heading level="h2">{t("widget.orders.title")}</Heading>
              <ToneBadge tone="orange">{t("waitingBadge", { count: q.data?.count ?? threads.length })}</ToneBadge>
            </div>
            <KeyPoints
              label={t("widget.orders.subtitle")}
              items={[
                { icon: <BellAlert />, text: t("widget.orders.points.last") },
                { icon: <ChatBubbleLeftRight />, text: t("widget.orders.points.answer") },
              ]}
            />
          </div>
          <Button size="small" variant="secondary" asChild>
            <a href="/app/negotiations?status=waiting">
              <ArrowUpRightOnBox />
              {t("widget.all")}
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
              <Table.HeaderCell>{t("queue.col.customer")}</Table.HeaderCell>
              <Table.HeaderCell>{t("queue.col.subject")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("queue.col.qty")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("queue.col.price")}</Table.HeaderCell>
              <Table.HeaderCell>{t("queue.col.activity")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {threads.map((n) => (
              <Table.Row key={n.id}>
                <Table.Cell>
                  <div className="flex items-center gap-x-2">
                    <WaitingDot waiting />
                    <a href={`/app/negotiations?thread=${encodeURIComponent(n.id)}`} className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                      {n.ref}
                    </a>
                  </div>
                </Table.Cell>
                <Table.Cell className="max-w-[14rem] truncate">{customerLine(n, t, lang).main}</Table.Cell>
                <Table.Cell className="max-w-[16rem] truncate">{subjectLine(n, t).main}</Table.Cell>
                <Table.Cell className="text-right tabular-nums">{n.subject === "cart" ? "-" : fmtNumber(n.qty, lang)}</Table.Cell>
                <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtMoney(n.price, n.currencyCode, lang) || "-"}</Table.Cell>
                <Table.Cell className="whitespace-nowrap">
                  <Text size="small" className="text-ui-fg-subtle">
                    {fmtRelative(n.lastActivityAt, lang)}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </WidgetFrame>
  )
}

export const config = defineWidgetConfig({
  zone: "order.list.before",
})

export default NegotiationsOrdersWidget
