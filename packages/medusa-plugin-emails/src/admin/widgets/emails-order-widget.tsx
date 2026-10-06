import { useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Container, Heading, Text } from "@medusajs/ui"
import { useEmailsMessages, useEmailsStatus } from "../lib/emails-api"
import { EmailsIcon } from "../lib/emails-icon"
import { MessageDrawer } from "../lib/emails-panels"
import { KindBadge, MessageStatusBadge, fmtDateTime, templateLabel } from "../lib/emails-ui"

/**
 * Order page, side column: the e-mails of this order (the confirmation, each
 * shipment, the cancellation) with their status and the masked address, one
 * click to the message. In demo mode the simulated ones.
 */
const EmailsOrderWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const { t, i18n } = useTranslation("emails")
  const lang = i18n.language || "en"
  const status = useEmailsStatus()
  const q = useEmailsMessages({ filter: "all", orderId: data.id, limit: 10 })
  const [open, setOpen] = useState<string | null>(null)
  const rows = q.data?.messages ?? []
  const s = status.data
  const byKey = new Map((s?.templates ?? []).map((x) => [x.key, x]))

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <EmailsIcon width={18} height={18} className="shrink-0" />
          <Heading level="h2">{t("widget.title")}</Heading>
        </div>
        <Link to="/emails" className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {t("widget.all")}
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-muted">
            {q.isLoading ? "" : t("widget.empty")}
          </Text>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-ui-border-base">
          {rows.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => setOpen(m.id)} className="flex w-full flex-col gap-y-1 px-6 py-3 text-left transition-fg hover:bg-ui-bg-base-hover">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <Text size="small" weight="plus" leading="compact">
                    {templateLabel(byKey.get(m.template), lang, m.template)}
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
      {open && s ? <MessageDrawer id={open} status={s} lang={lang} onClose={() => setOpen(null)} /> : null}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default EmailsOrderWidget
