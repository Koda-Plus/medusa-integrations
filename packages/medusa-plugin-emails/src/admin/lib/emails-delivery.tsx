import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ArrowUturnLeft, CheckCircle, Clock, ExclamationCircle, PencilSquare, XCircle } from "@medusajs/icons"
import { Button, InlineTip, Table, Text } from "@medusajs/ui"
import type { BouncesResponse } from "../../modules/emails/lib/contract"
import { EmptyTableRow, Section, ToneBadge, type Tone } from "./emails-blocks"
import { emailsFetch } from "./emails-api"
import { KitFetchingBar, KitSkeletonRows } from "./emails-kit"
import { OrderLink, ResendLink } from "./emails-links"

/**
 * What happened after sending (option deliveryKey): the delivery badge of a
 * message, and the list of addresses Resend no longer sends to (bounced,
 * complained, removed by hand), each with its last message here and a
 * corrected address when the domain is a known typo.
 */

const TONE: Record<string, Tone> = {
  delivered: "green",
  opened: "green",
  clicked: "green",
  sent: "blue",
  queued: "blue",
  scheduled: "blue",
  delivery_delayed: "orange",
  bounced: "red",
  complained: "red",
  suppressed: "red",
  failed: "red",
  canceled: "grey",
}

export function DeliveryBadge({ event }: { event: string | null | undefined }) {
  const { t } = useTranslation("emails")
  if (!event) return null
  return (
    <ToneBadge tone={TONE[event] ?? "grey"} title={t("delivery.hint")}>
      {t(`delivery.event.${event}`, { defaultValue: event })}
    </ToneBadge>
  )
}

/** A message of a mailing outside the shop (option campaigns): the mailing's label. */
export function CampaignBadge({ message, campaigns }: { message: { kind: string; template: string }; campaigns?: Array<{ key: string; label: string }> }) {
  const { t } = useTranslation("emails")
  if (message.kind !== "campaign") return null
  const key = message.template.replace(/^campaign:/, "")
  const label = campaigns?.find((c) => c.key === key)?.label ?? key
  /* Purple: a mailing outside the shop is a highlight, not a state. */
  return (
    <ToneBadge tone="purple" title={t("delivery.campaignHint")}>
      {label}
    </ToneBadge>
  )
}

export function useEmailsDelivery(enabled: boolean) {
  return useQuery<BouncesResponse>({
    queryKey: ["emails", "delivery"],
    queryFn: () => emailsFetch<BouncesResponse>("/admin/emails/delivery"),
    enabled,
    staleTime: 60_000,
  })
}

export function BouncesSection({ lang, onClose }: { lang: string; onClose: () => void }) {
  const { t } = useTranslation("emails")
  const q = useEmailsDelivery(true)
  const d = q.data
  const fmt = (s: string | null) => (s ? new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(s)) : "")
  return (
    <Section
      icon={<XCircle />}
      title={t("delivery.title")}
      pointsLabel={t("delivery.subtitle")}
      points={[
        { icon: <ExclamationCircle />, text: t("delivery.points.blocked"), tone: "orange" },
        { icon: <PencilSquare />, text: t("delivery.points.fix") },
        d?.readAt ? { icon: <Clock />, text: t("delivery.readAt", { at: fmt(d.readAt) }) } : null,
      ]}
      actions={
        <Button size="small" variant="secondary" onClick={onClose}>
          <ArrowUturnLeft />
          {t("delivery.back")}
        </Button>
      }
    >
      <KitFetchingBar active={q.isFetching && !q.isLoading} />
      {d && !d.configured ? (
        <div className="px-6 py-4">
          <InlineTip variant="info" label={t("delivery.title")}>
            {t("delivery.notConfigured")}
          </InlineTip>
        </div>
      ) : d?.error ? (
        <div className="px-6 py-4">
          <InlineTip variant="error" label={t("delivery.title")}>
            {d.error}
          </InlineTip>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("delivery.col.address")}</Table.HeaderCell>
              <Table.HeaderCell>{t("delivery.col.reason")}</Table.HeaderCell>
              <Table.HeaderCell>{t("delivery.col.subject")}</Table.HeaderCell>
              <Table.HeaderCell>{t("delivery.col.since")}</Table.HeaderCell>
              <Table.HeaderCell>{t("delivery.col.last")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {q.isLoading ? <KitSkeletonRows cols={6} /> : null}
            {(d?.addresses ?? []).map((a) => (
              <Table.Row key={a.email} className="align-top [&_td]:h-auto [&_td]:py-2.5">
                <Table.Cell>
                  <div className="flex flex-col gap-y-0.5">
                    <Text size="small" className="font-mono">
                      {a.email}
                    </Text>
                    {a.typo ? (
                      <Text size="xsmall" className="text-ui-tag-orange-text">
                        {t("delivery.typo", { fixed: a.typo })}
                      </Text>
                    ) : null}
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <ToneBadge tone={a.origin === "manual" ? "grey" : "red"}>{t(`delivery.origin.${a.origin}`, { defaultValue: a.origin })}</ToneBadge>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex max-w-xs flex-col items-start gap-y-1">
                    {a.campaign ? (
                      <ToneBadge tone="purple" title={t("delivery.campaignHint")}>
                        {a.campaign.label}
                      </ToneBadge>
                    ) : null}
                    <Text size="small">{a.subject ?? "-"}</Text>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle">
                    {fmt(a.since)}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  {a.lastMessage ? (
                    <div className="flex flex-col gap-y-0.5">
                      <Text size="small">{a.lastMessage.subject ?? a.lastMessage.template}</Text>
                      <span className="flex items-center gap-x-2">
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {fmt(a.lastMessage.createdAt)}
                        </Text>
                        {a.lastMessage.orderId ? <OrderLink id={a.lastMessage.orderId} open={t("log.openOrder")} /> : null}
                      </span>
                    </div>
                  ) : (
                    <Text size="small" className="text-ui-fg-muted">
                      {t("delivery.noLast")}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell className="text-right">{a.resendUrl ? <ResendLink href={a.resendUrl}>{t("log.openResend")}</ResendLink> : null}</Table.Cell>
              </Table.Row>
            ))}
            {d && d.configured && !q.isLoading && d.addresses.length === 0 ? <EmptyTableRow cols={6} icon={<CheckCircle />} title={t("delivery.empty")} /> : null}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}
