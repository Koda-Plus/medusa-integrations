import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Container, StatusBadge, Table, Text, toast } from "@medusajs/ui"
import type { AllegroIssueFilter, AllegroStatusResponse } from "../../modules/allegro/lib/contract"
import { errorMessage, useAllegroIssues, useAllegroIssuesSync } from "./allegro-api"
import { EmptyRow, Pager, Pills, SectionHeader, StatTile, fmtDate, fmtDateTime } from "./allegro-ui"

const PAGE = 10
const FILTERS: AllegroIssueFilter[] = ["open", "needs_reply", "returns", "disputes", "claims", "all"]

export function IssuesSection({ status, lang }: { status: AllegroStatusResponse; lang: string }) {
  const { t } = useTranslation("allegro")
  const [filter, setFilter] = useState<AllegroIssueFilter>("open")
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter])
  const list = useAllegroIssues(filter, page * PAGE, PAGE)
  const sync = useAllegroIssuesSync()
  const i = status.issues
  const s = status.settings.issues
  const canRead = status.mode === "demo" || status.connection.connected

  const onRefresh = async () => {
    try {
      await sync.mutateAsync()
      toast.success(t("toast.refreshStarted"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const rows = list.data?.issues ?? []
  const panelLinks: Array<[string, string]> = [
    [t("issues.panel.orders"), status.panel.orders],
    [t("issues.panel.returns"), status.panel.returns],
    [t("issues.panel.discussions"), status.panel.discussions],
    [t("issues.panel.messages"), status.panel.messages],
  ]

  return (
    <Container className="divide-y p-0">
      <SectionHeader
        title={t("issues.title")}
        subtitle={t("issues.subtitle")}
        actions={
          <Button size="small" variant="secondary" isLoading={status.running.issues || sync.isPending} disabled={!canRead} onClick={() => void onRefresh()}>
            {t("actions.refresh")}
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label={t("issues.tiles.returnsOpen")} value={i.returnsOpen} tone="orange" onClick={() => setFilter("returns")} active={filter === "returns"} />
        <StatTile label={t("issues.tiles.disputesOpen")} value={i.disputesOpen} tone="orange" onClick={() => setFilter("disputes")} active={filter === "disputes"} />
        <StatTile label={t("issues.tiles.claimsOpen")} value={i.claimsOpen} tone="orange" onClick={() => setFilter("claims")} active={filter === "claims"} />
        <StatTile label={t("issues.tiles.needReply")} value={i.needReply} tone="red" onClick={() => setFilter("needs_reply")} active={filter === "needs_reply"} />
        <StatTile label={t("issues.tiles.dueSoon")} value={i.dueSoon} tone="red" />
        <StatTile
          label={t("issues.tiles.unread")}
          value={i.unreadThreads ?? "?"}
          tone="blue"
          hint={i.threadsScanned > 0 ? t("issues.unreadOf", { count: i.threadsScanned }) : undefined}
        />
      </div>
      <div className="flex flex-col gap-2 px-6 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {panelLinks.map(([label, href]) => (
            <a key={label} href={href} target="_blank" rel="noreferrer" className="txt-compact-small inline-flex items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
              {label}
              <ArrowUpRightOnBox />
            </a>
          ))}
        </div>
        {i.checkedAt ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("issues.checked", { when: fmtDateTime(i.checkedAt, lang) })}
          </Text>
        ) : null}
        {!s.disputes ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("issues.off.disputes")}
          </Text>
        ) : null}
        {!s.messages ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("issues.off.messages")}
          </Text>
        ) : null}
      </div>
      <div className="px-6 py-4">
        <Pills filters={FILTERS} value={filter} onChange={setFilter} label={(f) => t(`issues.filter.${f}`)} />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("issues.col.kind")}</Table.HeaderCell>
              <Table.HeaderCell>{t("issues.col.opened")}</Table.HeaderCell>
              <Table.HeaderCell>{t("issues.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("issues.col.reason")}</Table.HeaderCell>
              <Table.HeaderCell>{t("issues.col.due")}</Table.HeaderCell>
              <Table.HeaderCell>{t("issues.col.order")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow span={6} loading={list.isLoading} text={t("issues.empty")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5 align-top">
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <a href={r.link} target="_blank" rel="noreferrer" className="txt-compact-small-plus inline-flex items-center gap-x-1 text-ui-fg-base hover:text-ui-fg-interactive">
                        {t(`issues.kind.${r.kind}`)}
                        <ArrowUpRightOnBox className="text-ui-fg-muted" />
                      </a>
                      {r.referenceNumber ? <span className="font-mono txt-compact-xsmall text-ui-fg-muted">{r.referenceNumber}</span> : null}
                      {r.demo ? (
                        <Badge size="2xsmall" color="purple">
                          {t("offers.sample")}
                        </Badge>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.openedAt, lang)}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <StatusBadge color={r.open ? (r.needsReply ? "red" : "orange") : "grey"}>
                        {t(`issues.statusLabel.${r.status}`, { defaultValue: r.status })}
                      </StatusBadge>
                      {r.needsReply ? (
                        <Text size="xsmall" className="text-ui-tag-red-text">
                          {t("issues.needsReply")}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="font-mono txt-compact-xsmall text-ui-fg-subtle">{r.reasonCode ?? ""}</span>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{fmtDate(r.dueAt, lang)}</Table.Cell>
                  <Table.Cell>
                    {r.orderId ? (
                      <Link to={`/orders/${r.orderId}`} className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                        {r.displayId ? `#${r.displayId}` : t("actions.openOrder")}
                      </Link>
                    ) : null}
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
