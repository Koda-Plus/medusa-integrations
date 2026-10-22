import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowPath, CheckCircle, DocumentText, ExclamationCircle, ListBullet, LockClosedSolid, MagnifyingGlass, PaperPlane, Clock, TruckFast } from "@medusajs/icons"
import { Button, InlineTip, Table, Text, toast } from "@medusajs/ui"
import type { AllegroStatusResponse } from "../../modules/allegro/lib/contract"
import { errorMessage, useAllegroOutbox, useAllegroOutboxRetry, useAllegroOutboxRun } from "./allegro-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, Section, ToneBadge } from "./allegro-blocks"
import { KitFetchingBar, KitSkeletonRows } from "./allegro-kit"
import { OUTBOX_TONE, Pager, fmtDateTime } from "./allegro-ui"

const PAGE = 10
const WRITERS = ["shipping", "invoices"] as const
type Filter = "open" | "done" | "failed" | "all"

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
  const toggle = (f: Filter) => setFilter(filter === f && f !== "open" ? "open" : f)

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
    <Section
      icon={<PaperPlane />}
      title={t("outbox.title")}
      pointsLabel={t("outbox.subtitle")}
      points={[
        { icon: <PaperPlane />, text: t("outbox.points.once") },
        { icon: <MagnifyingGlass />, text: t("outbox.points.lookup") },
        !armed ? { icon: <LockClosedSolid />, text: t("outbox.points.notArmed"), tone: "orange", title: t("plans.notArmed") } : null,
      ]}
      actions={
        <Button size="small" variant="secondary" isLoading={status.running[writer]} disabled={!armed} onClick={() => void onSend()}>
          <PaperPlane />
          {t("actions.sendNow")}
        </Button>
      }
    >
      <FilterBar>
        <FilterButton
          icon={<TruckFast />}
          label={t("outbox.writer.shipping")}
          count={status.outbox.shipping.pending + status.outbox.shipping.failed}
          attention
          active={writer === "shipping"}
          onClick={() => setWriter("shipping")}
        />
        <FilterButton
          icon={<DocumentText />}
          label={t("outbox.writer.invoices")}
          count={status.outbox.invoices.pending + status.outbox.invoices.failed}
          attention
          active={writer === "invoices"}
          onClick={() => setWriter("invoices")}
        />
        <FilterDivider />
        <FilterButton icon={<Clock />} label={t("outbox.filter.open")} count={box.pending} active={filter === "open"} onClick={() => setFilter("open")} />
        <FilterButton icon={<CheckCircle />} label={t("outbox.filter.done")} count={box.done} active={filter === "done"} onClick={() => toggle("done")} />
        <FilterButton icon={<ExclamationCircle />} label={t("outbox.filter.failed")} count={box.failed} attention active={filter === "failed"} onClick={() => toggle("failed")} />
        <FilterButton icon={<ListBullet />} label={t("outbox.filter.all")} count={box.pending + box.done + box.failed} active={filter === "all"} onClick={() => toggle("all")} />
      </FilterBar>
      {writer === "invoices" && !status.settings.fakturownia ? (
        <div className="px-6 py-4">
          <InlineTip variant="info" label={t("outbox.writer.invoices")}>
            {t("outbox.fakturowniaMissing")}
          </InlineTip>
        </div>
      ) : null}
      <KitFetchingBar active={list.isFetching && !list.isLoading} />
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
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.isLoading ? (
              <KitSkeletonRows cols={7} rows={4} />
            ) : rows.length === 0 ? (
              <EmptyTableRow cols={7} icon={<PaperPlane />} title={t("outbox.empty")} />
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
                    <div className="flex flex-col items-start gap-y-0.5">
                      <Text size="small" weight="plus" className="text-ui-fg-base">
                        {t(`outbox.kind.${r.kind}`)}
                      </Text>
                      <span className="font-mono txt-compact-xsmall text-ui-fg-subtle">{r.summary}</span>
                      {r.demo ? <ToneBadge tone="purple">{t("offers.sample")}</ToneBadge> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <ToneBadge tone={OUTBOX_TONE[r.status] ?? "grey"}>{t(`outbox.status.${r.status}`)}</ToneBadge>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{r.attempts}</Table.Cell>
                  <Table.Cell className="max-w-[320px]">
                    {r.lastError ? (
                      <Text size="xsmall" className={r.status === "failed" ? "text-ui-tag-red-text" : "text-ui-fg-subtle"}>
                        {r.lastError}
                      </Text>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <RowActions
                      actions={[
                        {
                          key: "retry",
                          label: t("actions.retry"),
                          icon: <ArrowPath />,
                          hidden: !(r.status === "failed" || r.status === "skipped"),
                          loading: retry.isPending && retry.variables === r.id,
                          onClick: () => void onRetry(r.id),
                        },
                      ]}
                    />
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pager count={list.data?.count ?? 0} page={page} size={PAGE} onPage={setPage} />
    </Section>
  )
}
