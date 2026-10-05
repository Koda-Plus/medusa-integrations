import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Button, Container, Heading, InlineTip, Switch, Table, Text, toast } from "@medusajs/ui"
import type { DocumentKind, StatusResponse, SummaryMonthDto, WriterDto, WriterKey } from "../../modules/fakturownia/lib/contract"
import { errorMessage, useFakturowniaEmail, useFakturowniaEmails, useFakturowniaReminders, useFakturowniaSummary, useFakturowniaWriter } from "./fakturownia-api"
import { EmailHistory } from "./fakturownia-document"
import { KindBadge, OrderLink, WriterBadge, fmtDate, fmtDateTime, fmtMoney, fmtMoneyList, fmtNumber } from "./fakturownia-ui"

const WRITER_KEYS: WriterKey[] = ["corrections", "emails", "ksef"]

/**
 * WRITES TO FAKTUROWNIA: the writers added in 0.2.0, each off until a person
 * turns it on here, and each can be forbidden for good by the options.
 */
export function WritersSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("fakturownia")
  const toggle = useFakturowniaWriter()
  const flip = async (writer: WriterKey, on: boolean) => {
    try {
      await toggle.mutateAsync({ writer, on })
      toast.success(t(on ? "writers.turnedOn" : "writers.turnedOff", { name: t(`writers.names.${writer}`) }))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("writers.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("writers.subtitle")}
        </Text>
      </div>
      {status.mode === "demo" ? (
        <div className="px-6 py-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("writers.demo")}
          </Text>
        </div>
      ) : null}
      {WRITER_KEYS.map((key) => (
        <WriterRow key={key} writer={status.writers[key]} lang={lang} busy={toggle.isPending && toggle.variables?.writer === key} onFlip={(on) => void flip(key, on)} />
      ))}
    </Container>
  )
}

function WriterRow({ writer, lang, busy, onFlip }: { writer: WriterDto; lang: string; busy: boolean; onFlip: (on: boolean) => void }) {
  const { t } = useTranslation("fakturownia")
  return (
    <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
      <div className="flex max-w-3xl flex-col gap-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {t(`writers.names.${writer.key}`)}
          </Text>
          <WriterBadge writer={writer} />
        </span>
        <Text size="small" className="text-ui-fg-subtle">
          {t(`writers.descriptions.${writer.key}`)}
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          {!writer.allowed
            ? t("writers.blockedHint", { option: `writers.${writer.key}: false` })
            : writer.updatedAt
              ? t(writer.on ? "writers.onBy" : "writers.offBy", { who: writer.updatedBy ?? "-", time: fmtDateTime(writer.updatedAt, lang) })
              : t("writers.never")}
        </Text>
      </div>
      <Switch checked={writer.on && writer.allowed} disabled={!writer.allowed || busy} onCheckedChange={(v) => onFlip(v === true)} aria-label={t(`writers.names.${writer.key}`)} />
    </div>
  )
}

/** Unpaid proformas and VAT invoices older than the option, with "Send a reminder". */
export function UnpaidSection({ status, lang, onOpenDocument }: { status: StatusResponse; lang: string; onOpenDocument: (id: string) => void }) {
  const { t } = useTranslation("fakturownia")
  const q = useFakturowniaReminders()
  const send = useFakturowniaEmail()
  const writer = status.writers.emails
  const rows = q.data?.documents ?? []
  const remind = async (id: string) => {
    try {
      await send.mutateAsync({ id, kind: "reminder" })
      toast.success(t("email.reminded"))
      void q.refetch()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-3xl flex-col gap-1">
          <Heading level="h2">{t("unpaid.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("unpaid.subtitle", { days: status.options.reminderAfterDays })}
          </Text>
        </div>
        <span className="flex items-center gap-x-2">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("writers.names.emails")}
          </Text>
          <WriterBadge writer={writer} />
        </span>
      </div>
      <div className="px-6 py-3">
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("unpaid.noApi")}
        </Text>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("documents.col.order")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.col.number")}</Table.HeaderCell>
              <Table.HeaderCell>{t("drawer.issueDate")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("documents.col.total")}</Table.HeaderCell>
              <Table.HeaderCell>{t("unpaid.reminders")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <Table.Row>
                <td colSpan={6} className="px-6 py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {q.isLoading ? "" : t("unpaid.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : (
              rows.map((r) => (
                <Table.Row key={r.document.id} className="[&_td]:py-2.5">
                  <Table.Cell>
                    <OrderLink orderId={r.document.orderId} displayId={r.document.displayId} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    <span className="flex items-center gap-x-2">
                      <KindBadge kind={r.document.kind} />
                      <button type="button" className="txt-compact-small font-mono text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={() => onOpenDocument(r.document.id)}>
                        {r.document.number ?? ""}
                      </button>
                    </span>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {fmtDate(r.document.issueDate, lang)}
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {t("unpaid.age", { count: r.ageDays })}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtMoney(r.document.totalGross, r.document.currency, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    <Text size="small">{r.reminders > 0 ? t("unpaid.sentCount", { count: r.reminders }) : t("unpaid.noneYet")}</Text>
                    {r.lastReminderAt ? (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {t("unpaid.last", { time: fmtDateTime(r.lastReminderAt, lang) })}
                      </Text>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={!writer.armed || !r.canRemind}
                      isLoading={send.isPending && send.variables?.id === r.document.id}
                      onClick={() => void remind(r.document.id)}
                      title={!r.canRemind ? t("unpaid.tooSoon") : undefined}
                    >
                      {t("email.remind")}
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      {(q.data?.count ?? 0) > rows.length ? (
        <div className="px-6 py-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("unpaid.more", { shown: rows.length, count: q.data?.count ?? 0 })}
          </Text>
        </div>
      ) : null}
    </Container>
  )
}

/** The e-mails the plugin asked for; in demo mode the simulated mailbox. */
export function MailboxSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("fakturownia")
  const [page, setPage] = useState(0)
  const q = useFakturowniaEmails(page * 10, 10)
  const count = q.data?.count ?? 0
  const demo = status.mode === "demo"
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <span className="flex flex-wrap items-center gap-2">
          <Heading level="h2">{demo ? t("mailbox.demoTitle") : t("mailbox.title")}</Heading>
          {demo ? (
            <Badge size="2xsmall" color="purple">
              {t("mailbox.simulated")}
            </Badge>
          ) : null}
        </span>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {demo ? t("mailbox.demoSubtitle") : t("mailbox.subtitle")}
        </Text>
      </div>
      <div className="px-6 py-2">
        <EmailHistory emails={q.data?.emails ?? []} lang={lang} showDocument />
      </div>
      {count > 10 ? (
        <div className="flex items-center justify-end gap-2 px-6 py-3">
          <Button size="small" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t("pagination.prev")}
          </Button>
          <Button size="small" variant="secondary" disabled={(page + 1) * 10 >= count} onClick={() => setPage(page + 1)}>
            {t("pagination.next")}
          </Button>
        </div>
      ) : null}
    </Container>
  )
}

const SUMMARY_KINDS: DocumentKind[] = ["vat", "proforma", "receipt", "correction"]

function monthLabel(month: string, lang: string): string {
  const [y, m] = month.split("-").map((x) => Number(x))
  try {
    return new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)))
  } catch {
    return month
  }
}

function isEmptyMonth(m: SummaryMonthDto): boolean {
  return SUMMARY_KINDS.every((k) => m.kinds[k].count === 0)
}

/** Twelve months: documents and their value per kind, the unpaid amount, the share KSeF accepted. */
export function SummarySection({ lang }: { lang: string }) {
  const { t } = useTranslation("fakturownia")
  const q = useFakturowniaSummary()
  const [all, setAll] = useState(false)
  const months = q.data?.months ?? []
  const shown = all ? months : months.filter((m, i) => i === 0 || !isEmptyMonth(m))
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-3xl flex-col gap-1">
          <Heading level="h2">{t("summary.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("summary.subtitle")}
          </Text>
        </div>
        <Button size="small" variant="transparent" onClick={() => setAll(!all)}>
          {all ? t("summary.onlyActive") : t("summary.allMonths")}
        </Button>
      </div>
      {q.data?.capped ? (
        <div className="px-6 py-3">
          <InlineTip variant="warning" label={t("summary.title")}>
            {t("summary.capped")}
          </InlineTip>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("summary.month")}</Table.HeaderCell>
              {SUMMARY_KINDS.map((k) => (
                <Table.HeaderCell key={k} className="text-right">
                  {t(`summary.kinds.${k}`)}
                </Table.HeaderCell>
              ))}
              <Table.HeaderCell className="text-right">{t("summary.unpaid")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("summary.ksef")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {shown.map((m) => (
              <Table.Row key={m.month} className="[&_td]:py-2.5 align-top">
                <Table.Cell className="whitespace-nowrap capitalize">{monthLabel(m.month, lang)}</Table.Cell>
                {SUMMARY_KINDS.map((k) => (
                  <Table.Cell key={k} className="whitespace-nowrap text-right tabular-nums">
                    {m.kinds[k].count > 0 ? (
                      <div className="flex flex-col items-end">
                        <span>{fmtNumber(m.kinds[k].count, lang)}</span>
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {fmtMoneyList(m.kinds[k].gross, lang)}
                        </Text>
                      </div>
                    ) : (
                      <span className="text-ui-fg-muted">0</span>
                    )}
                  </Table.Cell>
                ))}
                <Table.Cell className="whitespace-nowrap text-right tabular-nums">
                  {m.unpaidCount > 0 ? (
                    <div className="flex flex-col items-end">
                      <span className="text-ui-tag-orange-text">{fmtMoneyList(m.unpaid, lang)}</span>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {t("summary.unpaidCount", { count: m.unpaidCount })}
                      </Text>
                    </div>
                  ) : (
                    <span className="text-ui-fg-muted">{fmtMoney(0, "PLN", lang)}</span>
                  )}
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap text-right tabular-nums">
                  {m.ksef.share === null ? (
                    <span className="text-ui-fg-muted">-</span>
                  ) : (
                    <div className="flex flex-col items-end">
                      <span>{fmtNumber(Math.round(m.ksef.share * 1000) / 10, lang)}%</span>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {t("summary.ksefOf", { accepted: m.ksef.accepted, total: m.ksef.total })}
                      </Text>
                    </div>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Container>
  )
}
