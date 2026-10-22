import { useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowDownTray, ArrowPath, Beaker, BuildingStorefront, Calendar, CheckCircle, CheckCircleSolid, Clock, ExclamationCircle, ListBullet, LockClosedSolid, LockOpenSolid, MinusCircle, PauseSolid, XCircle } from "@medusajs/icons"
import { Button, InlineTip, Input, Label, Table, Text, toast } from "@medusajs/ui"
import type { AllegroImportFilter, AllegroImportRunResponse, AllegroStatusResponse } from "../../modules/allegro/lib/contract"
import { errorMessage, useAllegroImportHandled, useAllegroImportRetry, useAllegroImportRun, useAllegroImportWindow, useAllegroImports } from "./allegro-api"
import { EmptyState, EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, ToneBadge } from "./allegro-blocks"
import { KitFetchingBar, KitSkeletonRows } from "./allegro-kit"
import { IMPORT_TONE, ImportWhy, OrderLink, Pager, StoreColumn, fmtDateTime, fmtMoney, shortId, useDebounced } from "./allegro-ui"

const PAGE = 10
const FILTER_ICON: Record<AllegroImportFilter, ReactNode> = {
  all: <ListBullet />,
  imported: <CheckCircle />,
  held: <PauseSolid />,
  pending: <Clock />,
  attention: <ExclamationCircle />,
  skipped: <MinusCircle />,
  cancelled: <XCircle />,
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Allegro purchases as orders of the store: each row next to the store order
 * it became, or why there is none yet. The filter lives on the page, so the
 * counters above can open the held or the imported ones.
 */
export function ImportsSection({
  status,
  lang,
  filter,
  onFilter,
  onOpenWriters,
  initialQuery,
}: {
  status: AllegroStatusResponse
  lang: string
  filter: AllegroImportFilter
  onFilter: (f: AllegroImportFilter) => void
  /** Opens the writers in Settings, where the order import is armed. */
  onOpenWriters?: () => void
  /** The search a deep link (?q=) opens the list with. */
  initialQuery?: string
}) {
  const { t, i18n } = useTranslation("allegro")
  const [search, setSearch] = useState(initialQuery ?? "")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])
  const imports = useAllegroImports(filter, q, page * PAGE, PAGE)
  const run = useAllegroImportRun()
  const retry = useAllegroImportRetry()
  const handled = useAllegroImportHandled()
  const win = useAllegroImportWindow()
  const [preview, setPreview] = useState<AllegroImportRunResponse["preview"] | null>(null)
  const [previewNote, setPreviewNote] = useState<string | null>(null)
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 7 * 86_400_000)))
  const [to, setTo] = useState(isoDay(new Date()))

  const writer = status.writers.find((w) => w.key === "orders")
  const armed = Boolean(writer?.effective)
  const target = status.settings.importTarget
  const c = status.imports
  const counts: Partial<Record<AllegroImportFilter, number>> = {
    all: c.imported + c.held + c.pending + c.skipped + c.cancelled,
    imported: c.imported,
    held: c.held,
    pending: c.pending,
    skipped: c.skipped,
    cancelled: c.cancelled,
    attention: c.attention + c.mismatch,
  }

  const onDryRun = async () => {
    try {
      const r = await run.mutateAsync("plan")
      setPreview(r.preview)
      setPreviewNote(r.message)
      toast.success(t("toast.dryRunDone"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onImport = async () => {
    try {
      await run.mutateAsync("apply")
      toast.success(t("toast.importStarted"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onHandled = async (id: string) => {
    try {
      await handled.mutateAsync(id)
      toast.success(t("orderWidget.handledToast"))
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

  const onWindow = async () => {
    try {
      const r = await win.mutateAsync({ from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59`).toISOString() })
      if (r.message) toast.warning(r.message)
      toast.success(t("toast.windowQueued", { queued: r.queued, known: r.known }))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  /* A translated hint by reason code; the server's own words, with the details, stay in the tooltip. */
  const hint = (code: string | null, raw: string): string => {
    const key = code ? `imports.fix.${code}` : ""
    return key && i18n.exists(key, { ns: "allegro" }) ? t(key) : raw
  }

  const rows = imports.data?.imports ?? []
  const toggle = (f: AllegroImportFilter) => onFilter(filter === f && f !== "all" ? "all" : f)
  const notes = target.notes?.length ? target.notes.map((n) => t(`imports.note.${n.code}`, { value: n.value ?? "" })) : target.warnings
  return (
    <Section
      id="allegro-imports"
      icon={<ArrowDownTray />}
      title={t("imports.title")}
      pointsLabel={t("imports.subtitle")}
      points={[
        { icon: <CheckCircle />, text: t("imports.points.once"), title: t("imports.how") },
        { icon: <PauseSolid />, text: t("imports.points.held") },
        target.salesChannelName || target.regionName
          ? {
              icon: <BuildingStorefront />,
              text: t("imports.points.target", { channel: target.salesChannelName ?? "?", region: target.regionName ?? "?" }),
              title: t("imports.target", { channel: target.salesChannelName ?? "?", region: target.regionName ?? "?" }),
            }
          : { icon: <BuildingStorefront />, text: t("imports.points.noTarget"), tone: "orange", title: t("imports.noTarget") },
        c.cursor
          ? { icon: <Clock />, text: t("imports.points.cursor", { when: fmtDateTime(c.cursor.at, lang) }), title: t("imports.cursor", { id: c.cursor.id, when: fmtDateTime(c.cursor.at, lang) }) }
          : { icon: <Clock />, text: t("imports.points.noCursor"), title: t("imports.noCursor") },
        c.lastOkAt ? { icon: <CheckCircleSolid />, text: t("imports.points.lastOk", { when: fmtDateTime(c.lastOkAt, lang) }), tone: "green" } : null,
        !armed ? { icon: <LockClosedSolid />, text: t("imports.points.notArmed"), tone: "orange", title: t("imports.notArmed") } : null,
      ]}
      actions={
        <>
          <SearchInput value={search} onChange={setSearch} placeholder={t("orders.search")} />
          {!armed && onOpenWriters ? (
            <Button size="small" variant="secondary" onClick={onOpenWriters}>
              <LockOpenSolid />
              {t("actions.openWriters")}
            </Button>
          ) : null}
          <Button size="small" variant="secondary" isLoading={run.isPending && run.variables === "plan"} onClick={() => void onDryRun()}>
            <Beaker />
            {t("actions.dryRun")}
          </Button>
          <Button size="small" variant="primary" isLoading={status.running.import} disabled={!armed || status.running.import} onClick={() => void onImport()}>
            {t("actions.importNow")}
          </Button>
        </>
      }
    >
      {notes.length > 0 ? (
        <div className="flex flex-col gap-1 px-6 py-3">
          {notes.map((w) => (
            <Text key={w} size="xsmall" className="text-ui-tag-orange-text">
              {w}
            </Text>
          ))}
        </div>
      ) : null}
      {preview ? (
        <div className="flex flex-col gap-2 px-6 py-4">
          <Text size="small" weight="plus">
            {t("imports.preview.title")}
          </Text>
          {previewNote ? (
            <Text size="xsmall" className="text-ui-fg-subtle">
              {previewNote}
            </Text>
          ) : null}
          {preview.length === 0 ? (
            <EmptyState compact icon={<Beaker />} title={t("imports.preview.none")} />
          ) : (
            preview.map((p) => (
              <div key={p.checkoutFormId} className="flex flex-wrap items-baseline gap-2">
                <ToneBadge tone={p.decision === "create" ? "green" : p.decision === "hold" ? "orange" : "grey"}>{t(`imports.preview.decision.${p.decision}`)}</ToneBadge>
                <span className="font-mono txt-compact-xsmall text-ui-fg-muted" title={p.checkoutFormId}>
                  {shortId(p.checkoutFormId)}
                </span>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {p.reason}
                </Text>
              </div>
            ))
          )}
        </div>
      ) : null}
      <FilterBar>
        <FilterButton icon={FILTER_ICON.all} label={t("imports.filter.all")} count={counts.all} active={filter === "all"} onClick={() => onFilter("all")} />
        <FilterDivider />
        {(["held", "attention", "pending"] as const).map((f) => (
          <FilterButton key={f} icon={FILTER_ICON[f]} label={t(`imports.filter.${f}`)} count={counts[f]} attention={f !== "pending"} active={filter === f} onClick={() => toggle(f)} />
        ))}
        <FilterDivider />
        {(["imported", "skipped", "cancelled"] as const).map((f) => (
          <FilterButton key={f} icon={FILTER_ICON[f]} label={t(`imports.filter.${f}`)} count={counts[f]} active={filter === f} onClick={() => toggle(f)} />
        ))}
      </FilterBar>
      <KitFetchingBar active={imports.isFetching && !imports.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("imports.col.bought")}</Table.HeaderCell>
              <Table.HeaderCell>{t("imports.col.form")}</Table.HeaderCell>
              <Table.HeaderCell>{t("imports.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>
                <StoreColumn label={t("imports.col.order")} hint={t("imports.how")} />
              </Table.HeaderCell>
              <Table.HeaderCell>{t("imports.col.payment")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("imports.col.total")}</Table.HeaderCell>
              <Table.HeaderCell>{t("imports.col.note")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {imports.isLoading ? (
              <KitSkeletonRows cols={8} rows={4} />
            ) : rows.length === 0 ? (
              <EmptyTableRow cols={8} icon={<ArrowDownTray />} title={t("imports.empty")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5 align-top">
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.boughtAt ?? r.updatedAt, lang)}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <span className="font-mono txt-compact-small text-ui-fg-base" title={r.checkoutFormId}>
                        {shortId(r.checkoutFormId)}
                      </span>
                      {r.demo ? <ToneBadge tone="purple">{t("offers.sample")}</ToneBadge> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <ToneBadge tone={IMPORT_TONE[r.status] ?? "grey"}>{t(`imports.status.${r.status}`)}</ToneBadge>
                  </Table.Cell>
                  <Table.Cell className="max-w-[240px]">
                    {r.orderId ? <OrderLink orderId={r.orderId} displayId={r.displayId} /> : <ImportWhy status={r.status} reasonCode={r.reasonCode} reason={r.reason} />}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {r.paymentType ? (
                      <Text size="small" className="text-ui-fg-subtle">
                        {r.paymentType === "CASH_ON_DELIVERY" ? t("imports.cod") : r.paid ? t("imports.paid") : t("imports.notPaid")}
                      </Text>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    <div className="flex flex-col items-end">
                      <span>{fmtMoney(r.total, lang)}</span>
                      {r.totalMismatch ? (
                        <Text size="xsmall" className="text-ui-tag-orange-text">
                          {t("imports.mismatch", { total: fmtMoney(r.medusaTotal, lang) })}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-[340px]">
                    <div className="flex flex-col items-start gap-y-1">
                      {r.attention ? <ToneBadge tone="orange" title={r.attention}>{t("imports.attention")}</ToneBadge> : null}
                      {r.reason ? (
                        <Text size="xsmall" className={r.status === "held" ? "text-ui-tag-orange-text" : "text-ui-fg-subtle"} title={r.reason}>
                          {hint(r.reasonCode, r.reason)}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <RowActions
                      actions={[
                        {
                          key: "retry",
                          label: t("actions.retry"),
                          icon: <ArrowPath />,
                          hidden: !(r.status === "held" || r.status === "skipped"),
                          loading: retry.isPending && retry.variables === r.id,
                          onClick: () => void onRetry(r.id),
                        },
                        {
                          key: "handled",
                          label: t("orderWidget.handled"),
                          icon: <CheckCircle />,
                          hidden: !(r.attention || r.totalMismatch),
                          loading: handled.isPending && handled.variables === r.id,
                          onClick: () => void onHandled(r.id),
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
      <Pager count={imports.data?.count ?? 0} page={page} size={PAGE} onPage={setPage} />
      <div className="flex flex-col gap-3 px-6 py-4">
        <div className="flex items-center gap-x-2 text-ui-fg-subtle">
          <Calendar />
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {t("imports.window.title")}
          </Text>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label size="xsmall" htmlFor="allegro-window-from">
              {t("imports.window.from")}
            </Label>
            <Input id="allegro-window-from" size="small" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label size="xsmall" htmlFor="allegro-window-to">
              {t("imports.window.to")}
            </Label>
            <Input id="allegro-window-to" size="small" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button size="small" variant="secondary" isLoading={win.isPending} onClick={() => void onWindow()}>
            {t("actions.queue")}
          </Button>
        </div>
        <Text size="xsmall" className="max-w-3xl text-ui-fg-muted">
          {t("imports.window.text")}
        </Text>
        {status.mode === "live" && !status.writers.find((w) => w.key === "orders")?.allowed ? (
          <InlineTip variant="info" label={t("writers.names.orders")}>
            {t("writers.notAllowed", { key: "orders" })}
          </InlineTip>
        ) : null}
      </div>
    </Section>
  )
}
