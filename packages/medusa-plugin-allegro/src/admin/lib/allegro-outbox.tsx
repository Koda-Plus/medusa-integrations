import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Badge, Button, Container, InlineTip, StatusBadge, Table, Text, toast } from "@medusajs/ui"
import type { AllegroStatusResponse } from "../../modules/allegro/lib/contract"
import { errorMessage, useAllegroOutbox, useAllegroOutboxRetry, useAllegroOutboxRun } from "./allegro-api"
import { EmptyRow, OUTBOX_TONE, Pager, Pills, SectionHeader, fmtDateTime } from "./allegro-ui"

const PAGE = 10
const WRITERS = ["shipping", "invoices"] as const
const FILTERS = ["open", "done", "failed", "all"] as const
type Filter = (typeof FILTERS)[number]

export function OutboxSection({ status, lang }: { status: AllegroStatusResponse; lang: string }) {
  const { t } = useTranslation("allegro")
  const [writer, setWriter] = useState<(typeof WRITERS)[number]>("shipping")
  const [filter, setFilter] = useState<Filter>("open")
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [writer, filter])
  const list = useAllegroOutbox(writer, filter === "all" ? "" : filter, page * PAGE, PAGE)
  const run = useAllegroOutboxRun()
  const retry = useAllegroOutboxRetry()
  const armed = Boolean(status.writers.find((w) => w.key === writer)?.effective)
  const box = status.outbox[writer]

  const onSend = async () => {
    try {
      await run.mutateAsync(writer)
      toast.success(t("toast.sendStarted"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onRetry = async (id: string) => {
    try {
      await retry.mutateAsync(id)
      toast.success(t("toast.retried"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const rows = list.data?.items ?? []
  return (
    <Container className="divide-y p-0">
      <SectionHeader
        title={t("outbox.title")}
        subtitle={t("outbox.subtitle")}
        actions={
          <Button size="small" variant="secondary" isLoading={status.running[writer]} disabled={!armed} onClick={() => void onSend()}>
            {t("actions.sendNow")}
          </Button>
        }
      />
      <div className="flex flex-col gap-3 px-6 py-4">
        <Pills
          filters={WRITERS}
          value={writer}
          onChange={setWriter}
          label={(w) => t(`outbox.writer.${w}`)}
          count={(w) => status.outbox[w].pending + status.outbox[w].failed}
        />
        <Pills
          filters={FILTERS}
          value={filter}
          onChange={setFilter}
          label={(f) => t(`outbox.filter.${f}`)}
          count={(f) => (f === "open" ? box.pending : f === "done" ? box.done : f === "failed" ? box.failed : box.pending + box.done + box.failed)}
        />
        {!armed ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("plans.notArmed")}
          </Text>
        ) : null}
        {writer === "invoices" && !status.settings.fakturownia ? (
          <InlineTip variant="info" label={t("outbox.writer.invoices")}>
            {t("outbox.fakturowniaMissing")}
          </InlineTip>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("outbox.col.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("outbox.col.order")}</Table.HeaderCell>
              <Table.HeaderCell>{t("outbox.col.what")}</Table.HeaderCell>
              <Table.HeaderCell>{t("outbox.col.status")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("outbox.col.attempts")}</Table.HeaderCell>
              <Table.HeaderCell>{t("outbox.col.error")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow span={6} loading={list.isLoading} text={t("outbox.empty")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5 align-top">
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.createdAt, lang)}</Table.Cell>
                  <Table.Cell>
                    {r.orderId ? (
                      <Link to={`/orders/${r.orderId}`} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                        {t("actions.openOrder")}
                      </Link>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col gap-y-0.5">
                      <Text size="small" weight="plus" className="text-ui-fg-base">
                        {t(`outbox.kind.${r.kind}`)}
                      </Text>
                      <span className="font-mono txt-compact-xsmall text-ui-fg-subtle">{r.summary}</span>
                      {r.demo ? (
                        <Badge size="2xsmall" color="purple">
                          {t("offers.sample")}
                        </Badge>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge color={OUTBOX_TONE[r.status] ?? "grey"}>{t(`outbox.status.${r.status}`)}</StatusBadge>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{r.attempts}</Table.Cell>
                  <Table.Cell className="max-w-[320px]">
                    <div className="flex flex-col items-start gap-y-1">
                      {r.lastError ? (
                        <Text size="xsmall" className={r.status === "failed" ? "text-ui-tag-red-text" : "text-ui-fg-subtle"}>
                          {r.lastError}
                        </Text>
                      ) : null}
                      {r.status === "failed" || r.status === "skipped" ? (
                        <Button size="small" variant="transparent" onClick={() => void onRetry(r.id)} isLoading={retry.isPending && retry.variables === r.id}>
                          {t("actions.retry")}
                        </Button>
                      ) : null}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pager count={list.data?.count ?? 0} page={page} size={PAGE} onPage={setPage} />
    </Container>
  )
}
