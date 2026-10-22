import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowPath, ArrowUpRightOnBox, BellAlert, BuildingStorefront, ChatBubbleLeftRight, Clock, EyeSlash, ExclamationCircle, ListBullet, LockClosedSolid, Tag, XCircle } from "@medusajs/icons"
import { Button, InlineTip, Table, Text, toast, usePrompt } from "@medusajs/ui"
import type { OlxAlertKind, OlxStatusResponse } from "../../modules/olx/lib/contract"
import { errorMessage, useOlxAlerts, useOlxDemoReset, useOlxThreads, useOlxThreadsSync } from "./olx-api"
import { EmptyState, EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, StatTile, StatTiles, ToneBadge, useDebouncedValue } from "./olx-blocks"
import { KitFetchingBar, KitSkeletonRows } from "./olx-kit"
import { ALERT_TONE, AlertBadge, fmtDate, fmtDateTime, fmtNumber } from "./olx-ui"

/*
 * Sections of the Panel view that only read: the activity counters, the
 * alerts, the messages and the demo note. The writers live in olx-writers.tsx.
 */

export const PAGE_SIZE = 20

export const ALERT_KINDS: OlxAlertKind[] = ["live_sold_out", "live_unpublished", "stock_not_live", "stock_not_listed"]

const ALERT_ICON: Record<OlxAlertKind, ReactNode> = {
  live_sold_out: <XCircle />,
  live_unpublished: <EyeSlash />,
  stock_not_live: <Clock />,
  stock_not_listed: <Tag />,
}

export function scrollToSection(id: string): void {
  if (typeof document === "undefined") return
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
}

export const pagination = (t: (k: string) => string) => ({
  of: t("pagination.of"),
  results: t("pagination.results"),
  pages: t("pagination.pages"),
  prev: t("pagination.prev"),
  next: t("pagination.next"),
})

/* ------------------------------------------------------------------ */
/* Counters                                                            */
/* ------------------------------------------------------------------ */

export function ActivityCounters({ status, lang, onAlert }: { status: OlxStatusResponse; lang: string; onAlert: (kind: OlxAlertKind) => void }) {
  const { t } = useTranslation("olx")
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2">
      <div className="flex flex-col">
        <Text size="xsmall" className="px-6 pt-4 text-ui-fg-muted">
          {t("stats.groupAlerts")}
        </Text>
        <StatTiles columns={4}>
          {ALERT_KINDS.map((k) => (
            <StatTile
              key={k}
              icon={ALERT_ICON[k]}
              label={t(`alerts.kind.${k}`)}
              value={fmtNumber(status.alerts[k], lang)}
              tone={status.alerts[k] > 0 ? ALERT_TONE[k] : "grey"}
              title={t(`alerts.hint.${k}`)}
              onClick={() => onAlert(k)}
            />
          ))}
        </StatTiles>
      </div>
      <div className="flex flex-col">
        <Text size="xsmall" className="px-6 pt-4 text-ui-fg-muted">
          {t("stats.groupActivity")}
        </Text>
        <StatTiles columns={4}>
          <StatTile label={t("stats.views")} value={fmtNumber(status.stats.views, lang)} />
          <StatTile label={t("stats.phoneViews")} value={fmtNumber(status.stats.phoneViews, lang)} />
          <StatTile label={t("stats.observers")} value={fmtNumber(status.stats.observers, lang)} />
          <StatTile
            label={t("stats.unread")}
            value={fmtNumber(status.messages.unreadMessages, lang)}
            tone={status.messages.unreadMessages > 0 ? "blue" : "grey"}
            onClick={() => scrollToSection("olx-messages")}
          />
        </StatTiles>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Demo note, shown in the popover of the mode badge                   */
/* ------------------------------------------------------------------ */

export function DemoDetails({ status }: { status: OlxStatusResponse }) {
  const { t } = useTranslation("olx")
  const prompt = usePrompt()
  const reset = useOlxDemoReset()
  if (status.mode !== "demo") return null
  const list = (xs: string[] | undefined) => (xs && xs.length > 0 ? xs.join(", ") : t("demo.none"))
  const sim = status.simulation
  const onReset = async () => {
    const ok = await prompt({
      title: t("demo.reset"),
      description: t("demo.text"),
      confirmText: t("demo.reset"),
      cancelText: t("writers.armConfirm.cancel"),
    })
    if (!ok) return
    try {
      await reset.mutateAsync()
      toast.success(t("demo.resetDone"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <>
      <span>{t("demo.text")}</span>
      {sim ? (
        <span className="text-ui-fg-muted">
          {t("demo.simulated", {
            soldOut: list(sim.soldOut),
            unpublished: list(sim.unpublished),
            paused: list(sim.paused),
            missing: sim.missingAttribute ?? t("demo.none"),
          })}
        </span>
      ) : null}
      <div>
        <Button size="small" variant="secondary" isLoading={reset.isPending} onClick={() => void onReset()}>
          <ArrowPath />
          {t("demo.reset")}
        </Button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

export function AlertsSection({
  status,
  lang,
  kind,
  onKind,
}: {
  status: OlxStatusResponse
  lang: string
  kind: OlxAlertKind | "all"
  onKind: (k: OlxAlertKind | "all") => void
}) {
  const { t } = useTranslation("olx")
  const [search, setSearch] = useState("")
  const q = useDebouncedValue(search.trim())
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [kind, q])
  const alerts = useOlxAlerts(kind, q, page * PAGE_SIZE, PAGE_SIZE)
  const rows = alerts.data?.alerts ?? []
  const count = alerts.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const total = ALERT_KINDS.reduce((sum, k) => sum + status.alerts[k], 0)

  return (
    <Section
      id="olx-alerts"
      icon={<BellAlert />}
      title={t("alerts.title")}
      pointsLabel={t("alerts.subtitle")}
      points={[
        { icon: <Clock />, text: t("alerts.points.every") },
        { icon: <BuildingStorefront />, text: t("alerts.points.compare") },
        status.plan.plannedAt ? { icon: <ArrowPath />, text: t("alerts.points.planned", { time: fmtDateTime(status.plan.plannedAt, lang) }) } : null,
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("alerts.search")} />}
    >
      {status.plan.plannedAt && !status.plan.stockComplete ? (
        <div className="px-6 py-4">
          <InlineTip variant="warning" label={t("alerts.title")}>
            {t("alerts.stockStale")}
          </InlineTip>
        </div>
      ) : null}
      <FilterBar>
        <FilterButton icon={<ListBullet />} label={t("alerts.all")} count={total} active={kind === "all"} onClick={() => onKind("all")} />
        <FilterDivider />
        {ALERT_KINDS.map((k) => (
          <FilterButton
            key={k}
            icon={ALERT_ICON[k]}
            label={t(`alerts.kind.${k}`)}
            count={status.alerts[k]}
            attention={ALERT_TONE[k] !== "blue"}
            title={t(`alerts.hint.${k}`)}
            active={kind === k}
            onClick={() => onKind(kind === k ? "all" : k)}
          />
        ))}
      </FilterBar>
      {kind !== "all" ? (
        <div className="px-6 py-3">
          <Text size="small" className="text-ui-fg-subtle">
            {t(`alerts.hint.${kind}`)}
          </Text>
        </div>
      ) : null}
      <KitFetchingBar active={alerts.isFetching && !alerts.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("alerts.col.product")}</Table.HeaderCell>
              <Table.HeaderCell>{t("alerts.col.advert")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("alerts.col.stock")}</Table.HeaderCell>
              <Table.HeaderCell>{t("alerts.col.since")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {alerts.isLoading ? (
              <KitSkeletonRows cols={5} rows={4} />
            ) : rows.length === 0 ? (
              <EmptyTableRow cols={5} icon={<BellAlert />} title={t("alerts.empty")} />
            ) : (
              rows.map((a) => (
                <Table.Row key={a.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-[320px]">
                    <div className="flex flex-col items-start gap-y-1">
                      <Link to={`/products/${a.productId}`} className="txt-compact-small-plus truncate text-ui-fg-base hover:text-ui-fg-interactive">
                        {a.productTitle ?? a.productId}
                      </Link>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {a.sku ? <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{a.sku}</span> : null}
                        {kind === "all" ? <AlertBadge kind={a.kind} /> : null}
                        {a.productStatus && a.productStatus !== "published" ? <ToneBadge tone="grey">{a.productStatus}</ToneBadge> : null}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-[320px]">
                    {a.advertUrl ? (
                      <div className="flex flex-col gap-y-1">
                        <span className="txt-compact-small truncate text-ui-fg-base">{a.advertTitle}</span>
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">
                          #{a.olxId} {a.advertStatus ? `(${a.advertStatus})` : ""}
                        </span>
                      </div>
                    ) : (
                      <ToneBadge tone="grey">{t("alerts.noAdvert")}</ToneBadge>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{a.stock === null ? <span className="text-ui-fg-muted">{t("alerts.untracked")}</span> : a.stock}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{fmtDate(a.firstSeenAt, lang)}</Table.Cell>
                  <Table.Cell className="text-right">
                    <RowActions
                      actions={[
                        { key: "product", label: t("adverts.openProduct"), icon: <BuildingStorefront />, href: `/app/products/${a.productId}` },
                        { key: "olx", label: t("actions.openOlx"), icon: <ArrowUpRightOnBox />, href: a.advertUrl ?? undefined, external: true, hidden: !a.advertUrl },
                      ]}
                    />
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Table.Pagination
        count={count}
        pageSize={PAGE_SIZE}
        pageIndex={page}
        pageCount={pageCount}
        canPreviousPage={page > 0}
        canNextPage={page + 1 < pageCount}
        previousPage={() => setPage((p) => Math.max(0, p - 1))}
        nextPage={() => setPage((p) => p + 1)}
        translations={pagination(t)}
      />
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export function MessagesSection({ status, lang }: { status: OlxStatusResponse; lang: string }) {
  const { t } = useTranslation("olx")
  const [filter, setFilter] = useState<"unread" | "all">("unread")
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter])
  const threads = useOlxThreads(filter, page * PAGE_SIZE, PAGE_SIZE)
  const sync = useOlxThreadsSync()
  const rows = threads.data?.threads ?? []
  const count = threads.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const m = status.messages
  const canRead = m.enabled && (status.mode === "demo" || status.connection.connected)

  const onRead = async () => {
    try {
      const r = await sync.mutateAsync()
      toast.info(r.alreadyRunning ? t("toast.alreadyRunning") : t("toast.messagesStarted"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Section
      id="olx-messages"
      icon={<ChatBubbleLeftRight />}
      title={t("messages.title")}
      pointsLabel={t("messages.subtitle")}
      points={[
        { icon: <ListBullet />, text: t("messages.points.counts") },
        { icon: <LockClosedSolid />, text: t("messages.points.noText"), tone: "green" },
        { icon: <ChatBubbleLeftRight />, text: t("messages.points.answer") },
        m.enabled && { icon: <Clock />, text: m.lastReadAt ? t("messages.points.lastRead", { when: fmtDateTime(m.lastReadAt, lang) }) : t("messages.notRead") },
      ]}
      actions={
        <>
          <Button size="small" variant="secondary" disabled={!canRead} isLoading={sync.isPending || m.running} onClick={() => void onRead()}>
            <ArrowPath />
            {t("actions.readMessages")}
          </Button>
          <Button size="small" variant="secondary" type="button" onClick={() => window.open(m.chatUrl, "_blank", "noopener")}>
            <ArrowUpRightOnBox />
            {t("actions.openChat")}
          </Button>
        </>
      }
    >
      {!m.enabled ? (
        <EmptyState icon={<ChatBubbleLeftRight />} title={t("messages.disabledTitle")} points={[{ icon: <ExclamationCircle />, text: "messagesEnabled: false" }]} />
      ) : (
        <>
          {m.complete === false && m.lastReadMessage ? (
            <div className="px-6 py-4">
              <InlineTip variant="warning" label={t("messages.title")}>
                {t("messages.incomplete", { message: m.lastReadMessage })}
              </InlineTip>
            </div>
          ) : null}
          <FilterBar>
            <FilterButton icon={<ChatBubbleLeftRight />} label={t("messages.filter.unread")} count={m.unreadThreads} attention active={filter === "unread"} onClick={() => setFilter("unread")} />
            <FilterButton icon={<ListBullet />} label={t("messages.filter.all")} count={m.threads} active={filter === "all"} onClick={() => setFilter("all")} />
          </FilterBar>
          <KitFetchingBar active={threads.isFetching && !threads.isLoading} />
          <div className="overflow-x-auto">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{t("messages.col.advert")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("messages.col.product")}</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">{t("messages.col.unread")}</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">{t("messages.col.total")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("messages.col.started")}</Table.HeaderCell>
                  <Table.HeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {threads.isLoading ? (
                  <KitSkeletonRows cols={6} rows={3} />
                ) : rows.length === 0 ? (
                  <EmptyTableRow cols={6} icon={<ChatBubbleLeftRight />} title={filter === "unread" ? t("messages.empty") : t("messages.emptyAll")} />
                ) : (
                  rows.map((th) => (
                    <Table.Row key={th.id} className="[&_td]:py-2.5">
                      <Table.Cell className="max-w-[340px]">
                        <div className="flex flex-col items-start gap-y-1">
                          <span className="txt-compact-small-plus truncate text-ui-fg-base">{th.advertUrl ? th.advertTitle : t("messages.unknownAdvert", { id: th.advertOlxId ?? "?" })}</span>
                          {th.favourite ? <ToneBadge tone="blue">{t("messages.favourite")}</ToneBadge> : null}
                        </div>
                      </Table.Cell>
                      <Table.Cell className="max-w-[240px]">
                        {th.productId ? (
                          <Link to={`/products/${th.productId}`} className="flex flex-col gap-y-0.5 hover:text-ui-fg-interactive">
                            <span className="txt-compact-small truncate text-ui-fg-base">{th.productTitle ?? th.productId}</span>
                            <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{th.sku}</span>
                          </Link>
                        ) : null}
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        {th.unread > 0 ? (
                          <ToneBadge tone="blue">
                            <span className="tabular-nums">{th.unread}</span>
                          </ToneBadge>
                        ) : (
                          <span className="tabular-nums text-ui-fg-muted">0</span>
                        )}
                      </Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{th.total}</Table.Cell>
                      <Table.Cell className="whitespace-nowrap">{fmtDateTime(th.createdAt, lang)}</Table.Cell>
                      <Table.Cell className="text-right">
                        <RowActions
                          actions={[
                            { key: "chat", label: t("actions.openChat"), icon: <ChatBubbleLeftRight />, href: m.chatUrl, external: true },
                            { key: "olx", label: t("actions.openOlx"), icon: <ArrowUpRightOnBox />, href: th.advertUrl ?? undefined, external: true, hidden: !th.advertUrl },
                          ]}
                        />
                      </Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table>
          </div>
          <Table.Pagination
            count={count}
            pageSize={PAGE_SIZE}
            pageIndex={page}
            pageCount={pageCount}
            canPreviousPage={page > 0}
            canNextPage={page + 1 < pageCount}
            previousPage={() => setPage((p) => Math.max(0, p - 1))}
            nextPage={() => setPage((p) => p + 1)}
            translations={pagination(t)}
          />
        </>
      )}
    </Section>
  )
}
