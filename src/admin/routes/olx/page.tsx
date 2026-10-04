import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpRightOnBox, Tag } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Copy,
  Heading,
  InlineTip,
  Input,
  StatusBadge,
  Table,
  Text,
  clx,
  toast,
  usePrompt,
} from "@medusajs/ui"
import type { OlxAdvertFilter, OlxRunDto, OlxStatusResponse } from "../../../modules/olx/lib/contract"
import {
  errorMessage,
  olxKeys,
  useOlxAdverts,
  useOlxConnect,
  useOlxDisconnect,
  useOlxRuns,
  useOlxStatus,
  useOlxSync,
} from "../../lib/olx-api"
import { AdvertStatus, KeyCell, StatTile, fmtDateTime, fmtDuration, fmtPrice } from "../../lib/olx-ui"

/**
 * OLX by Koda Plus: connection to the seller account, the advert snapshot
 * linked to products by SKU, and the sync history. Read-only towards OLX.
 */
const PAGE_SIZE = 20

const OlxPage = () => {
  const { t, i18n } = useTranslation("olx")
  const lang = i18n.language || "en"
  const client = useQueryClient()
  const [pollUntil, setPollUntil] = useState(0)
  const status = useOlxStatus(pollUntil)
  const s = status.data

  /* A finished run refreshes the tables. */
  const lastRunId = s?.lastRun?.id
  const seenRun = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (lastRunId && seenRun.current && seenRun.current !== lastRunId) {
      void client.invalidateQueries({ queryKey: olxKeys.all })
    }
    seenRun.current = lastRunId
  }, [lastRunId, client])

  /* A connection that completes while we wait gets one toast. */
  const wasConnecting = useRef(false)
  useEffect(() => {
    if (s?.connecting) wasConnecting.current = true
    else if (wasConnecting.current && s?.connection.connected) {
      wasConnecting.current = false
      toast.success(t("toast.connected"))
    }
  }, [s?.connecting, s?.connection.connected, t])

  const [filter, setFilter] = useState<OlxAdvertFilter>("all")

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} loading={status.isLoading} onSyncStarted={() => setPollUntil(Date.now() + 30_000)} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label="OLX">
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s ? <Tips status={s} /> : null}
        {s ? (
          <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-4 xl:grid-cols-7">
            <StatTile label={t("stats.adverts")} value={s.counts.adverts} active={filter === "all"} onClick={() => setFilter("all")} />
            <StatTile label={t("stats.live")} value={s.counts.live} tone="green" />
            <StatTile label={t("stats.linkedLive")} value={s.counts.linkedLive} tone="green" active={filter === "linked"} onClick={() => setFilter("linked")} />
            <StatTile label={t("stats.unmatched")} value={s.counts.unmatchedLive} tone="red" active={filter === "unmatched"} onClick={() => setFilter("unmatched")} />
            <StatTile label={t("stats.limited")} value={s.counts.limited} tone="orange" active={filter === "limited"} onClick={() => setFilter("limited")} />
            <StatTile label={t("stats.ended")} value={s.counts.ended} active={filter === "ended"} onClick={() => setFilter("ended")} />
            <StatTile label={t("stats.noKey")} value={s.counts.noKey} active={filter === "nokey"} onClick={() => setFilter("nokey")} />
          </div>
        ) : null}
      </Container>

      {s ? <ConnectionSection status={s} lang={lang} /> : null}
      {s ? <AdvertsSection status={s} lang={lang} filter={filter} onFilter={setFilter} /> : null}
      <RunsSection lang={lang} />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function modeBadge(s: OlxStatusResponse | undefined): { color: "green" | "orange" | "blue" | "grey" | "purple"; key: string } {
  if (!s) return { color: "grey", key: "mode.notConnected" }
  if (s.mode === "demo") return { color: "purple", key: "mode.demo" }
  if (!s.configured) return { color: "orange", key: "mode.notConfigured" }
  if (s.connection.connected) return { color: "green", key: "mode.connected" }
  if (s.connecting) return { color: "blue", key: "mode.waiting" }
  return { color: "grey", key: "mode.notConnected" }
}

function Header({
  status,
  loading,
  onSyncStarted,
}: {
  status: OlxStatusResponse | undefined
  loading: boolean
  onSyncStarted: () => void
}) {
  const { t } = useTranslation("olx")
  const sync = useOlxSync()
  const badge = modeBadge(status)
  const canSync = Boolean(status && (status.mode === "demo" || status.connection.connected))

  const onSync = async () => {
    try {
      const r = await sync.mutateAsync()
      if (r.alreadyRunning) toast.info(t("toast.syncRunning"))
      else toast.success(t("toast.syncStarted"))
      onSyncStarted()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-x-2">
          <Heading level="h1">{t("title")}</Heading>
          <Badge size="2xsmall" color="grey">
            {t("by")}
          </Badge>
          {!loading ? <StatusBadge color={badge.color}>{t(badge.key)}</StatusBadge> : null}
        </div>
        <Text size="small" className="mt-1 max-w-2xl text-ui-fg-subtle">
          {t("subtitle")}
        </Text>
      </div>
      <Button
        size="small"
        variant="primary"
        isLoading={sync.isPending || Boolean(status?.running)}
        disabled={!canSync}
        onClick={() => void onSync()}
      >
        <ArrowPath />
        {status?.running ? t("actions.syncing") : t("actions.sync")}
      </Button>
    </div>
  )
}

function Tips({ status }: { status: OlxStatusResponse }) {
  const { t } = useTranslation("olx")
  if (status.mode === "demo") {
    return (
      <div className="px-6 py-4">
        <InlineTip variant="info" label={t("demo.label")}>
          {t("demo.text")}
        </InlineTip>
      </div>
    )
  }
  if (!status.configured) {
    return (
      <div className="px-6 py-4">
        <InlineTip variant="warning" label={t("missing.label")}>
          {t("missing.text", {
            missing: status.missing.join(", "),
            host: status.marketHost,
            redirect: status.redirectUri ?? t("missing.redirectFallback"),
          })}
        </InlineTip>
      </div>
    )
  }
  return null
}

/* ------------------------------------------------------------------ */

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-y-0.5">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <Text size="small" className={clx("text-ui-fg-base", mono && "font-mono break-all")}>
        {value}
      </Text>
    </div>
  )
}

function ConnectionSection({ status, lang }: { status: OlxStatusResponse; lang: string }) {
  const { t } = useTranslation("olx")
  const prompt = usePrompt()
  const connect = useOlxConnect()
  const disconnect = useOlxDisconnect()
  const c = status.connection
  const demo = status.mode === "demo"

  const onConnect = async () => {
    try {
      const r = await connect.mutateAsync()
      if (r.connecting?.url) window.open(r.connecting.url, "_blank", "noopener")
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onDisconnect = async () => {
    const ok = await prompt({
      title: t("disconnect.title"),
      description: t("disconnect.description"),
      confirmText: t("disconnect.confirm"),
      cancelText: t("disconnect.cancel"),
    })
    if (!ok) return
    try {
      await disconnect.mutateAsync()
      toast.success(t("toast.disconnected"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("connection.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("connection.subtitle", { host: status.marketHost })}
        </Text>
      </div>

      <div className="flex flex-col gap-4 px-6 py-4">
        {demo ? (
          <Text size="small" className="text-ui-fg-subtle">
            {t("connection.demoNote")}
          </Text>
        ) : (
          <>
            {status.connecting ? (
              <InlineTip variant="info" label={t("connection.waitingLabel")}>
                <span className="flex flex-col gap-y-2">
                  <span>{t("connection.waitingText")}</span>
                  <a href={status.connecting.url} target="_blank" rel="noreferrer" className="break-all font-mono text-xs underline">
                    {status.connecting.url}
                  </a>
                  <span className="text-ui-fg-muted">
                    {t("connection.waitingUntil", { time: fmtDateTime(status.connecting.expiresAt, lang) })}
                  </span>
                </span>
              </InlineTip>
            ) : null}
            {c.lastError ? (
              <InlineTip variant="error" label={t("connection.lastError")}>
                {c.lastError}
                {c.lastErrorAt ? ` (${fmtDateTime(c.lastErrorAt, lang)})` : ""}
              </InlineTip>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Fact label={t("connection.connectedAt")} value={fmtDateTime(c.connectedAt, lang) || t("connection.never")} />
              <Fact label={t("connection.refreshedAt")} value={fmtDateTime(c.refreshedAt, lang) || t("connection.never")} />
              <Fact label={t("connection.expiresAt")} value={fmtDateTime(c.accessExpiresAt, lang) || t("connection.none")} />
            </div>
          </>
        )}

        {status.redirectUri ? (
          <div className="flex items-center gap-x-2">
            <Fact label={t("connection.redirectUri")} value={status.redirectUri} mono />
            <Copy content={status.redirectUri} className="mt-4" />
          </div>
        ) : null}

        {!demo ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="small"
              variant={c.connected ? "secondary" : "primary"}
              isLoading={connect.isPending}
              disabled={!status.configured}
              onClick={() => void onConnect()}
            >
              {c.connected ? t("actions.reconnect") : status.connecting ? t("actions.openConsent") : t("actions.connect")}
            </Button>
            <Button
              size="small"
              variant="secondary"
              isLoading={disconnect.isPending}
              disabled={!c.connected}
              onClick={() => void onDisconnect()}
            >
              {t("actions.disconnect")}
            </Button>
          </div>
        ) : null}

        <Text size="xsmall" className="text-ui-fg-muted">
          {t("connection.tokensNote")}
        </Text>
      </div>
    </Container>
  )
}

/* ------------------------------------------------------------------ */

const FILTERS: OlxAdvertFilter[] = ["all", "linked", "unmatched", "limited", "ended", "nokey"]

function filterCount(status: OlxStatusResponse, f: OlxAdvertFilter): number {
  const c = status.counts
  switch (f) {
    case "all":
      return c.adverts
    case "linked":
      return c.linked
    case "unmatched":
      return c.unmatchedLive
    case "limited":
      return c.limited
    case "ended":
      return c.ended
    case "nokey":
      return c.noKey
  }
}

function AdvertsSection({
  status,
  lang,
  filter,
  onFilter,
}: {
  status: OlxStatusResponse
  lang: string
  filter: OlxAdvertFilter
  onFilter: (f: OlxAdvertFilter) => void
}) {
  const { t } = useTranslation("olx")
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(0)

  useEffect(() => {
    const id = window.setTimeout(() => setQ(search.trim()), 300)
    return () => window.clearTimeout(id)
  }, [search])
  useEffect(() => setPage(0), [filter, q])

  const adverts = useOlxAdverts(filter, q, page * PAGE_SIZE, PAGE_SIZE)
  const rows = adverts.data?.adverts ?? []
  const count = adverts.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("adverts.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("adverts.subtitle")}
        </Text>
      </div>

      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onFilter(f)}
              className={clx(
                "txt-compact-small-plus inline-flex items-center gap-x-1.5 rounded-full border px-3 py-1 transition-fg",
                filter === f
                  ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                  : "border-ui-border-base bg-ui-bg-component text-ui-fg-subtle hover:bg-ui-bg-component-hover",
              )}
            >
              {t(`adverts.filter.${f}`)}
              <span className="tabular-nums opacity-80">{filterCount(status, f)}</span>
            </button>
          ))}
        </div>
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("adverts.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("adverts.col.advert")}</Table.HeaderCell>
              <Table.HeaderCell>{t("adverts.col.status")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("adverts.col.price")}</Table.HeaderCell>
              <Table.HeaderCell>{t("adverts.col.key")}</Table.HeaderCell>
              <Table.HeaderCell>{t("adverts.col.product")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <Table.Row>
                <td colSpan={5} className="py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {adverts.isLoading ? "" : t("adverts.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : (
              rows.map((a) => (
                <Table.Row key={a.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-[340px]">
                    <div className="flex flex-col gap-y-1">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="txt-compact-small-plus inline-flex items-center gap-x-1 text-ui-fg-base hover:text-ui-fg-interactive"
                        title={t("actions.openOlx")}
                      >
                        <span className="truncate">{a.title}</span>
                        <ArrowUpRightOnBox className="shrink-0 text-ui-fg-muted" />
                      </a>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">#{a.olxId}</span>
                        {a.isPrimary ? (
                          <Badge size="2xsmall" color="green">
                            {t("adverts.primary")}
                          </Badge>
                        ) : null}
                        {a.demo ? (
                          <Badge size="2xsmall" color="purple">
                            {t("adverts.sample")}
                          </Badge>
                        ) : null}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <AdvertStatus advert={a} />
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{fmtPrice(a.price, lang)}</Table.Cell>
                  <Table.Cell>
                    <KeyCell advert={a} />
                  </Table.Cell>
                  <Table.Cell className="max-w-[260px]">
                    {a.productId ? (
                      <Link to={`/products/${a.productId}`} className="flex flex-col gap-y-0.5 hover:text-ui-fg-interactive">
                        <span className="txt-compact-small-plus truncate text-ui-fg-base">{a.productTitle ?? a.productId}</span>
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{a.sku}</span>
                      </Link>
                    ) : (
                      <Text size="small" className="text-ui-fg-muted">
                        {a.matchKey ? t("adverts.noProduct") : ""}
                      </Text>
                    )}
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
        translations={{
          of: t("pagination.of"),
          results: t("pagination.results"),
          pages: t("pagination.pages"),
          prev: t("pagination.prev"),
          next: t("pagination.next"),
        }}
      />
    </Container>
  )
}

/* ------------------------------------------------------------------ */

const RUN_COLOR: Record<OlxRunDto["status"], "green" | "orange" | "red"> = {
  ok: "green",
  partial: "orange",
  error: "red",
}

function RunsSection({ lang }: { lang: string }) {
  const { t } = useTranslation("olx")
  const runs = useOlxRuns()
  const list = useMemo(() => runs.data?.runs ?? [], [runs.data])

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("runs.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("runs.subtitle")}
        </Text>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("runs.col.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.source")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.result")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("runs.col.adverts")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("runs.col.linked")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.changes")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("runs.col.duration")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.length === 0 ? (
              <Table.Row>
                <td colSpan={7} className="py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {runs.isLoading ? "" : t("runs.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : (
              list.map((r) => (
                <Table.Row key={r.id} title={r.message ?? undefined}>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.startedAt, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {t(`runs.source.${r.source}`)}
                    <span className="text-ui-fg-muted"> / {t(`runs.trigger.${r.trigger}`)}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge color={RUN_COLOR[r.status]}>{t(`runs.${r.status}`)}</StatusBadge>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{r.adverts}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{r.linkedLive}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {t("runs.changes", { created: r.created, updated: r.updated, removed: r.removed })}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{fmtDuration(r.durationMs)}</Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "OLX",
  icon: Tag,
})

export default OlxPage
