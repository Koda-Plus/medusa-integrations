import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Heading, Text } from "@medusajs/ui"
import { useEmailsMessages } from "../lib/emails-api"
import { EmailsIcon } from "../lib/emails-icon"
import { WidgetFrame, hostable } from "../lib/emails-kit"
import { MessageDrawer } from "../lib/emails-panels"
import { KindBadge, MessageStatusBadge, fmtDateTime, templateLabel } from "../lib/emails-ui"

/**
 * Order page, side column: the e-mails of this order (the confirmation, each
 * shipment, the cancellation) with their status and the masked address, one
 * click to the message. In demo mode the simulated ones. The list is read
 * once a minute, every 5 seconds only while a message is being sent; the
 * card reads no status of the plugin (each message carries its template's
 * name).
 *
 * A host (an app that shows every integration as tabs of one card) embeds it
 * with `embedded`: no frame and header of its own, a line while loading and
 * the link to the order's e-mails at the bottom.
 */
const EmailsOrderCard = ({ data, embedded }: DetailWidgetProps<AdminOrder> & { embedded?: boolean }) => {
  const { t, i18n } = useTranslation("emails")
  const lang = i18n.language || "en"
  const q = useEmailsMessages({ filter: "all", orderId: data.id, limit: 10 })
  const [open, setOpen] = useState<string | null>(null)
  const rows = q.data?.messages ?? []
  const all = `/emails?order_id=${encodeURIComponent(data.id)}`

  if (embedded && (q.isLoading || q.isError) && rows.length === 0) return <Quiet>{q.isError ? t("widget.failed") : t("widget.loading")}</Quiet>

  return (
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-2">
            <EmailsIcon width={18} height={18} className="shrink-0" />
            <Heading level="h2">{t("widget.title")}</Heading>
          </div>
          <Link to={all} className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("widget.all")}
          </Link>
        </div>
      }
    >
      {rows.length === 0 ? (
        <Quiet>{q.isLoading ? "" : q.isError ? t("widget.failed") : t("widget.empty")}</Quiet>
      ) : (
        <ul className="flex flex-col divide-y divide-ui-border-base">
          {rows.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => setOpen(m.id)} className="flex w-full flex-col gap-y-1 px-6 py-3 text-left transition-fg hover:bg-ui-bg-base-hover">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <Text size="small" weight="plus" leading="compact">
                    {templateLabel({ key: m.template, label: m.label }, lang, m.template)}
                  </Text>
                  <MessageStatusBadge message={m} demo={m.demo} />
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {fmtDateTime(m.sentAt ?? m.createdAt, lang)}
                  </Text>
                  <Text size="xsmall" className="font-mono text-ui-fg-muted">
                    {m.recipient ?? ""}
                  </Text>
                  <KindBadge kind={m.kind} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {embedded ? (
        <div className="px-6 py-3">
          <Link to={all} className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("widget.all")}
          </Link>
        </div>
      ) : null}
      {open ? <MessageDrawer id={open} lang={lang} onClose={() => setOpen(null)} /> : null}
    </WidgetFrame>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return (
    <div className="px-6 py-4">
      <Text size="small" className="text-ui-fg-muted">
        {children}
      </Text>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default hostable({ id: "emails.order", ns: "emails", zone: "order.details", name: "E-mails", order: 80, Icon: EmailsIcon }, EmailsOrderCard)
