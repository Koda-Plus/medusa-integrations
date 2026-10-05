import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowPath, ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Container, Heading, InlineTip, Input, Table, Text, toast, usePrompt } from "@medusajs/ui"
import type { OlxAlertKind, OlxStatusResponse } from "../../modules/olx/lib/contract"
import { errorMessage, useOlxAlerts, useOlxDemoReset, useOlxThreads, useOlxThreadsSync } from "./olx-api"
import { ALERT_COLOR, AlertBadge, Chip, StatTile, fmtDate, fmtDateTime, fmtNumber } from "./olx-ui"

/*
 * Sections of the Panel view that only read: the activity counters, the
 * alerts, the messages and the demo note. The writers live in olx-writers.tsx.
 */

const PAGE_SIZE = 20

export const ALERT_KINDS: OlxAlertKind[] = ["live_sold_out", "live_unpublished", "stock_not_live", "stock_not_listed"]

export function scrollToSection(id: string): void {
  if (typeof document === "undefined") return
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
}

function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value.trim()), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return debounced
}

const pagination = (t: (k: string) => string) => ({
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
  const tone = (k: OlxAlertKind) => (status.alerts[k] > 0 ? ALERT_COLOR[k] : "default")
  return (
    <div className="flex flex-col gap-y-2 px-6 py-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_2fr]">
        <div className="flex flex-col gap-y-2">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("stats.groupAlerts")}
          </Text>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {ALERT_KINDS.map((k) => (
              <StatTile
                key={k}
                label={t(`alerts.kind.${k}`)}
                value={status.alerts[k]}
                tone={tone(k)}
                onClick={() => {
                  onAlert(k)
                  scrollToSection("olx-alerts")
                }}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-y-2">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("stats.groupActivity")}
          </Text>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label={t("stats.views")} value={fmtNumber(status.stats.views, lang)} />
            <StatTile label={t("stats.phoneViews")} value={fmtNumber(status.stats.phoneViews, lang)} />
            <StatTile label={t("stats.observers")} value={fmtNumber(status.stats.observers, lang)} />
            <StatTile
              label={t("stats.unread")}
              value={status.messages.unreadMessages}
              tone={status.messages.unreadMessages > 0 ? "blue" : "default"}
              onClick={() => scrollToSection("olx-messages")}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Demo note                                                           */
/* ------------------------------------------------------------------ */

export function SimulationNote({ status }: { status: OlxStatusResponse }) {
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
    <div className="flex flex-col gap-3 px-6 py-4">
      <InlineTip variant="info" label={t("demo.label")}>
        <span className="flex flex-col gap-y-2">
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
        </span>
      </InlineTip>
      <div>
        <Button size="small" variant="secondary" isLoading={reset.isPending} onClick={() => void onReset()}>
          <ArrowPath />
          {t("demo.reset")}
        </Button>
      </div>
    </div>
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
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [kind, q])
  const alerts = useOlxAlerts(kind, q, page * PAGE_SIZE, PAGE_SIZE)
  const rows = alerts.data?.alerts ?? []
  const count = alerts.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const total = ALERT_KINDS.reduce((sum, k) => sum + status.alerts[k], 0)

  return (
    <Container className="divide-y p-0" id="olx-alerts">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("alerts.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("alerts.subtitle")}
          {status.plan.plannedAt ? ` ${t("alerts.planned", { time: fmtDateTime(status.plan.plannedAt, lang) })}` : ""}
        </Text>
      </div>
      {status.plan.plannedAt && !status.plan.stockComplete ? (
        <div className="px-6 py-4">
          <InlineTip variant="warning" label={t("alerts.title")}>
            {t("alerts.stockStale")}
          </InlineTip>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <Chip active={kind === "all"} label={t("alerts.all")} count={total} onClick={() => onKind("all")} />
          {ALERT_KINDS.map((k) => (
            <Chip key={k} active={kind === k} label={t(`alerts.kind.${k}`)} count={status.alerts[k]} onClick={() => onKind(k)} />
          ))}
        </div>
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("alerts.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {kind !== "all" ? (
        <div className="px-6 py-3">
          <Text size="small" className="text-ui-fg-subtle">
            {t(`alerts.hint.${kind}`)}
          </Text>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("alerts.col.product")}</Table.HeaderCell>
              <Table.HeaderCell>{t("alerts.col.advert")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("alerts.col.stock")}</Table.HeaderCell>
              <Table.HeaderCell>{t("alerts.col.since")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <Table.Row>
                <td colSpan={4} className="py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {alerts.isLoading ? "" : t("alerts.empty")}
                  </Text>
                </td>
              </Table.Row>
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
                        {a.productStatus && a.productStatus !== "published" ? (
                          <Badge size="2xsmall" color="grey">
                            {a.productStatus}
                          </Badge>
                        ) : null}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-[320px]">
                    {a.advertUrl ? (
                      <div className="flex flex-col gap-y-1">
                        <a
                          href={a.advertUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="txt-compact-small inline-flex items-center gap-x-1 text-ui-fg-base hover:text-ui-fg-interactive"
                        >
                          <span className="truncate">{a.advertTitle}</span>
                          <ArrowUpRightOnBox className="shrink-0 text-ui-fg-muted" />
                        </a>
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">
                          #{a.olxId} {a.advertStatus ? `(${a.advertStatus})` : ""}
                        </span>
                      </div>
                    ) : (
                      <Text size="small" className="text-ui-fg-muted">
                        {t("alerts.noAdvert")}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{a.stock === null ? <span className="text-ui-fg-muted">{t("alerts.untracked")}</span> : a.stock}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{fmtDate(a.firstSeenAt, lang)}</Table.Cell>
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
    </Container>
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
    <Container className="divide-y p-0" id="olx-messages">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <Heading level="h2">{t("messages.title")}</Heading>
          <Text size="small" className="max-w-2xl text-ui-fg-subtle">
            {t("messages.subtitle")}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {m.lastReadAt ? t("messages.lastRead", { when: fmtDateTime(m.lastReadAt, lang) }) : t("messages.notRead")}
          </Text>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="small" variant="secondary" disabled={!canRead} isLoading={sync.isPending || m.running} onClick={() => void onRead()}>
            <ArrowPath />
            {t("actions.readMessages")}
          </Button>
          <a href={m.chatUrl} target="_blank" rel="noreferrer">
            <Button size="small" variant="secondary" type="button">
              {t("actions.openChat")}
              <ArrowUpRightOnBox />
            </Button>
          </a>
        </div>
      </div>
      {!m.enabled ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-muted">
            {t("messages.disabled")}
          </Text>
        </div>
      ) : (
        <>
          {m.complete === false && m.lastReadMessage ? (
            <div className="px-6 py-4">
              <InlineTip variant="warning" label={t("messages.title")}>
                {t("messages.incomplete", { message: m.lastReadMessage })}
              </InlineTip>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 px-6 py-4">
            <Chip active={filter === "unread"} label={t("messages.filter.unread")} count={m.unreadThreads} onClick={() => setFilter("unread")} />
            <Chip active={filter === "all"} label={t("messages.filter.all")} count={m.threads} onClick={() => setFilter("all")} />
          </div>
          <div className="overflow-x-auto">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{t("messages.col.advert")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("messages.col.product")}</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">{t("messages.col.unread")}</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">{t("messages.col.total")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("messages.col.started")}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.length === 0 ? (
                  <Table.Row>
                    <td colSpan={5} className="py-6 text-center">
                      <Text size="small" className="text-ui-fg-muted">
                        {threads.isLoading ? "" : filter === "unread" ? t("messages.empty") : t("messages.emptyAll")}
                      </Text>
                    </td>
                  </Table.Row>
                ) : (
                  rows.map((th) => (
                    <Table.Row key={th.id} className="[&_td]:py-2.5">
                      <Table.Cell className="max-w-[340px]">
                        <div className="flex flex-col gap-y-1">
                          {th.advertUrl ? (
                            <a
                              href={th.advertUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="txt-compact-small-plus inline-flex items-center gap-x-1 text-ui-fg-base hover:text-ui-fg-interactive"
                            >
                              <span className="truncate">{th.advertTitle}</span>
                              <ArrowUpRightOnBox className="shrink-0 text-ui-fg-muted" />
                            </a>
                          ) : (
                            <Text size="small">{t("messages.unknownAdvert", { id: th.advertOlxId ?? "?" })}</Text>
                          )}
                          {th.favourite ? (
                            <span>
                              <Badge size="2xsmall" color="orange">
                                {t("messages.favourite")}
                              </Badge>
                            </span>
                          ) : null}
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
                          <Badge size="2xsmall" color="blue">
                            <span className="tabular-nums">{th.unread}</span>
                          </Badge>
                        ) : (
                          <span className="tabular-nums text-ui-fg-muted">0</span>
                        )}
                      </Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{th.total}</Table.Cell>
                      <Table.Cell className="whitespace-nowrap">{fmtDateTime(th.createdAt, lang)}</Table.Cell>
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
    </Container>
  )
}
