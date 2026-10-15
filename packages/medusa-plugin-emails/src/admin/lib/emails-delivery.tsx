import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Badge, Button, Container, Heading, InlineTip, Table, Text } from "@medusajs/ui"
import type { BouncesResponse } from "../../modules/emails/lib/contract"
import { emailsFetch } from "./emails-api"
import { KitFetchingBar, KitSkeletonRows } from "./emails-kit"
import { OrderLink, ResendLink } from "./emails-links"

/**
 * What happened after sending (option deliveryKey): the delivery badge of a
 * message, and the list of addresses Resend no longer sends to (bounced,
 * complained, removed by hand), each with its last message here and a
 * corrected address when the domain is a known typo.
 */

const TONE: Record<string, "green" | "orange" | "red" | "grey" | "blue"> = {
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
    <Badge size="2xsmall" color={TONE[event] ?? "grey"} title={t("delivery.hint")}>
      {t(`delivery.event.${event}`, { defaultValue: event })}
    </Badge>
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
    <Container className="divide-y p-0">
      <KitFetchingBar active={q.isFetching && !q.isLoading} />
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
        <div>
          <Heading level="h2">{t("delivery.title")}</Heading>
          <Text size="small" className="max-w-3xl text-ui-fg-subtle">
            {t("delivery.subtitle")}
          </Text>
          {d?.readAt ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("delivery.readAt", { at: fmt(d.readAt) })}
            </Text>
          ) : null}
        </div>
        <Button size="small" variant="secondary" onClick={onClose}>
          {t("delivery.back")}
        </Button>
      </div>
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
              <Table.HeaderCell>{t("delivery.col.since")}</Table.HeaderCell>
              <Table.HeaderCell>{t("delivery.col.last")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {q.isLoading ? <KitSkeletonRows cols={5} /> : null}
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
                  <Badge size="2xsmall" color={a.origin === "manual" ? "grey" : "red"}>
                    {t(`delivery.origin.${a.origin}`, { defaultValue: a.origin })}
                  </Badge>
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
            {d && d.configured && !q.isLoading && d.addresses.length === 0 ? (
              <Table.Row>
                <td colSpan={5} className="px-6">
                  <Text size="small" className="py-6 text-center text-ui-fg-subtle">
                    {t("delivery.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : null}
          </Table.Body>
        </Table>
      </div>
    </Container>
  )
}
