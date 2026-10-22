import { useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowPath, ArrowUpRightOnBox, ArrowUturnLeft, ChatBubbleLeftRight, Clock, ExclamationCircle, EyeSlash, ListBullet, ShieldCheck, TriangleRightMini } from "@medusajs/icons"
import { Button, Table, Text, toast } from "@medusajs/ui"
import type { AllegroIssueFilter, AllegroStatusResponse } from "../../modules/allegro/lib/contract"
import { errorMessage, useAllegroIssues, useAllegroIssuesSync } from "./allegro-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, Section, StatTile, StatTiles, ToneBadge } from "./allegro-blocks"
import { KitFetchingBar, KitSkeletonRows } from "./allegro-kit"
import { OrderLink, Pager, StoreColumn, fmtDate, fmtDateTime, shortId } from "./allegro-ui"

const PAGE = 10
const FILTER_ICON: Record<AllegroIssueFilter, ReactNode> = {
  open: <ChatBubbleLeftRight />,
  needs_reply: <ExclamationCircle />,
  returns: <ArrowUturnLeft />,
  disputes: <ChatBubbleLeftRight />,
  claims: <ShieldCheck />,
  all: <ListBullet />,
}

/** Allegro's reason (returns) or subject (disputes, claims) in words; the code itself stays in the tooltip. */
function IssueReason({ code }: { code: string | null }) {
  const { t, i18n } = useTranslation("allegro")
  if (!code) return null
  const key = `issues.reason.${code}`
  if (!i18n.exists(key, { ns: "allegro" })) return <span className="font-mono txt-compact-xsmall text-ui-fg-subtle">{code}</span>
  return (
    <span className="txt-compact-small text-ui-fg-subtle" title={code}>
      {t(key)}
    </span>
  )
}

/**
 * Returns, disputes and claims of Allegro buyers, each next to the store
 * order it concerns. The filter lives on the page, so the "Waiting for you"
 * counter above can open the ones that need a reply. A second click on the
 * active filter goes back to the open ones.
 */
export function IssuesSection({
  status,
  lang,
  filter,
  onFilter,
}: {
  status: AllegroStatusResponse
  lang: string
  filter: AllegroIssueFilter
  onFilter: (f: AllegroIssueFilter) => void
}) {
  const { t } = useTranslation("allegro")
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter])
  const list = useAllegroIssues(filter, page * PAGE, PAGE)
  const sync = useAllegroIssuesSync()
  const i = status.issues
  const s = status.settings.issues
  const canRead = status.mode === "demo" || status.connection.connected
  const toggle = (f: AllegroIssueFilter) => onFilter(filter === f && f !== "open" ? "open" : f)

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
  const counts: Partial<Record<AllegroIssueFilter, number>> = {
    open: i.returnsOpen + i.disputesOpen + i.claimsOpen,
    needs_reply: i.needReply,
  }

  return (
    <Section
      id="allegro-issues"
      icon={<ChatBubbleLeftRight />}
      title={t("issues.title")}
      pointsLabel={t("issues.subtitle")}
      points={[
        { icon: <ArrowUturnLeft />, text: t("issues.points.kinds") },
        { icon: <ArrowUpRightOnBox />, text: t("issues.points.reply") },
        i.checkedAt ? { icon: <Clock />, text: t("issues.points.checked", { when: fmtDateTime(i.checkedAt, lang) }) } : null,
        !s.disputes ? { icon: <EyeSlash />, text: t("issues.points.offDisputes"), title: t("issues.off.disputes") } : null,
        !s.messages ? { icon: <EyeSlash />, text: t("issues.points.offMessages"), title: t("issues.off.messages") } : null,
      ]}
      actions={
        <Button size="small" variant="secondary" isLoading={status.running.issues || sync.isPending} disabled={!canRead} onClick={() => void onRefresh()}>
          <ArrowPath />
          {t("actions.refresh")}
        </Button>
      }
    >
      <StatTiles columns={6}>
        <StatTile label={t("issues.tiles.returnsOpen")} value={i.returnsOpen} tone={i.returnsOpen > 0 ? "orange" : "grey"} onClick={() => toggle("returns")} active={filter === "returns"} />
        <StatTile label={t("issues.tiles.disputesOpen")} value={i.disputesOpen} tone={i.disputesOpen > 0 ? "orange" : "grey"} onClick={() => toggle("disputes")} active={filter === "disputes"} />
        <StatTile label={t("issues.tiles.claimsOpen")} value={i.claimsOpen} tone={i.claimsOpen > 0 ? "orange" : "grey"} onClick={() => toggle("claims")} active={filter === "claims"} />
        <StatTile label={t("issues.tiles.needReply")} value={i.needReply} tone={i.needReply > 0 ? "red" : "grey"} onClick={() => toggle("needs_reply")} active={filter === "needs_reply"} />
        <StatTile label={t("issues.tiles.dueSoon")} value={i.dueSoon} tone={i.dueSoon > 0 ? "red" : "grey"} />
        <StatTile
          label={t("issues.tiles.unread")}
          value={i.unreadThreads ?? "?"}
          tone={i.unreadThreads ? "blue" : "grey"}
          hint={i.threadsScanned > 0 ? t("issues.unreadOf", { count: i.threadsScanned }) : undefined}
        />
      </StatTiles>
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        {panelLinks.map(([label, href]) => (
          <Button key={label} size="small" variant="secondary" asChild>
            <a href={href} target="_blank" rel="noreferrer">
              <ArrowUpRightOnBox />
              {label}
            </a>
          </Button>
        ))}
      </div>
      <FilterBar>
        <FilterButton icon={FILTER_ICON.open} label={t("issues.filter.open")} count={counts.open} active={filter === "open"} onClick={() => onFilter("open")} />
        <FilterButton icon={FILTER_ICON.needs_reply} label={t("issues.filter.needs_reply")} count={counts.needs_reply} attention active={filter === "needs_reply"} onClick={() => toggle("needs_reply")} />
        <FilterDivider />
        {(["returns", "disputes", "claims"] as const).map((f) => (
          <FilterButton key={f} icon={FILTER_ICON[f]} label={t(`issues.filter.${f}`)} active={filter === f} onClick={() => toggle(f)} />
        ))}
        <FilterDivider />
        <FilterButton icon={FILTER_ICON.all} label={t("issues.filter.all")} active={filter === "all"} onClick={() => toggle("all")} />
      </FilterBar>
      <KitFetchingBar active={list.isFetching && !list.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("issues.col.kind")}</Table.HeaderCell>
              <Table.HeaderCell>{t("issues.col.opened")}</Table.HeaderCell>
              <Table.HeaderCell>{t("issues.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("issues.col.reason")}</Table.HeaderCell>
              <Table.HeaderCell>{t("issues.col.due")}</Table.HeaderCell>
              <Table.HeaderCell>
                <StoreColumn label={t("issues.col.order")} />
              </Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.isLoading ? (
              <KitSkeletonRows cols={6} rows={4} />
            ) : rows.length === 0 ? (
              <EmptyTableRow cols={6} icon={<ChatBubbleLeftRight />} title={t("issues.empty")} />
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
                      {r.demo ? <ToneBadge tone="purple">{t("offers.sample")}</ToneBadge> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.openedAt, lang)}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <ToneBadge tone={r.open ? (r.needsReply ? "red" : "orange") : "grey"}>{t(`issues.statusLabel.${r.status}`, { defaultValue: r.status })}</ToneBadge>
                      {r.needsReply ? (
                        <span className="txt-compact-xsmall inline-flex items-center gap-x-0.5 text-ui-tag-red-text">
                          <TriangleRightMini />
                          {t("issues.needsReply")}
                        </span>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <IssueReason code={r.reasonCode} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{fmtDate(r.dueAt, lang)}</Table.Cell>
                  <Table.Cell className="max-w-[240px]">
                    {r.orderId ? (
                      <OrderLink
                        orderId={r.orderId}
                        displayId={r.displayId}
                        code={r.checkoutFormId ? shortId(r.checkoutFormId) : null}
                        codeTitle={r.checkoutFormId ? `${t("imports.col.form")} ${r.checkoutFormId}` : undefined}
                      />
                    ) : r.checkoutFormId ? (
                      <div className="flex flex-col items-start gap-y-0.5">
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("orders.notImported")}
                        </Text>
                        <span className="font-mono txt-compact-xsmall text-ui-fg-muted" title={`${t("imports.col.form")} ${r.checkoutFormId}`}>
                          {shortId(r.checkoutFormId)}
                        </span>
                      </div>
                    ) : null}
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
