import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Button, Container, InlineTip, Input, Label, StatusBadge, Table, Text, toast } from "@medusajs/ui"
import type { AllegroImportFilter, AllegroImportRunResponse, AllegroStatusResponse } from "../../modules/allegro/lib/contract"
import { errorMessage, useAllegroImportRetry, useAllegroImportRun, useAllegroImportWindow, useAllegroImports } from "./allegro-api"
import { EmptyRow, IMPORT_TONE, ImportWhy, OrderLink, Pager, Pills, SectionHeader, StoreColumn, fmtDateTime, fmtMoney, shortId, useDebounced } from "./allegro-ui"

const PAGE = 10
const FILTERS: AllegroImportFilter[] = ["all", "imported", "held", "pending", "attention", "skipped", "cancelled"]

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
}: {
  status: AllegroStatusResponse
  lang: string
  filter: AllegroImportFilter
  onFilter: (f: AllegroImportFilter) => void
  /** Opens the writers in Settings, where the order import is armed. */
  onOpenWriters?: () => void
}) {
  const { t, i18n } = useTranslation("allegro")
  const [search, setSearch] = useState("")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])
  const imports = useAllegroImports(filter, q, page * PAGE, PAGE)
  const run = useAllegroImportRun()
  const retry = useAllegroImportRetry()
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
  return (
    <Container className="divide-y p-0" id="allegro-imports">
      <SectionHeader
        title={t("imports.title")}
        subtitle={t("imports.subtitle")}
        actions={
          <>
            <Button size="small" variant="secondary" isLoading={run.isPending && run.variables === "plan"} onClick={() => void onDryRun()}>
              {t("actions.dryRun")}
            </Button>
            <Button size="small" variant="primary" isLoading={status.running.import} disabled={!armed || status.running.import} onClick={() => void onImport()}>
              {t("actions.importNow")}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-1.5 px-6 py-3">
        <Text size="xsmall" className="text-ui-fg-subtle">
          {target.salesChannelName || target.regionName
            ? t("imports.target", { channel: target.salesChannelName ?? "?", region: target.regionName ?? "?" })
            : t("imports.noTarget")}
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          {c.cursor ? t("imports.cursor", { id: c.cursor.id, when: fmtDateTime(c.cursor.at, lang) }) : t("imports.noCursor")}
          {c.lastOkAt ? ` ${t("imports.lastOk", { when: fmtDateTime(c.lastOkAt, lang) })}` : ""}
        </Text>
        {(target.notes?.length ? target.notes.map((n) => t(`imports.note.${n.code}`, { value: n.value ?? "" })) : target.warnings).map((w) => (
          <Text key={w} size="xsmall" className="text-ui-tag-orange-text">
            {w}
          </Text>
        ))}
        {!armed ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("imports.notArmed")}
            </Text>
            {onOpenWriters ? (
              <button type="button" onClick={onOpenWriters} className="txt-compact-xsmall-plus text-ui-fg-interactive transition-fg hover:text-ui-fg-interactive-hover">
                {t("actions.openWriters")}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
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
            <Text size="small" className="text-ui-fg-muted">
              {t("imports.preview.none")}
            </Text>
          ) : (
            preview.map((p) => (
              <div key={p.checkoutFormId} className="flex flex-wrap items-baseline gap-2">
                <Badge size="2xsmall" color={p.decision === "create" ? "green" : p.decision === "hold" ? "red" : "grey"}>
                  {t(`imports.preview.decision.${p.decision}`)}
                </Badge>
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
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <Pills filters={FILTERS} value={filter} onChange={onFilter} label={(f) => t(`imports.filter.${f}`)} count={(f) => counts[f] ?? null} />
        <div className="w-full lg:w-64">
          <Input size="small" type="search" placeholder={t("orders.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
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
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow span={7} loading={imports.isLoading} text={t("imports.empty")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5 align-top">
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.boughtAt ?? r.updatedAt, lang)}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <span className="font-mono txt-compact-small text-ui-fg-base" title={r.checkoutFormId}>
                        {shortId(r.checkoutFormId)}
                      </span>
                      {r.demo ? (
                        <Badge size="2xsmall" color="purple">
                          {t("offers.sample")}
                        </Badge>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge color={IMPORT_TONE[r.status] ?? "grey"}>{t(`imports.status.${r.status}`)}</StatusBadge>
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
                      {r.attention ? (
                        <Text size="xsmall" className="text-ui-tag-orange-text" title={r.attention}>
                          {t("imports.attention")}
                        </Text>
                      ) : null}
                      {r.reason ? (
                        <Text size="xsmall" className={r.status === "held" ? "text-ui-tag-red-text" : "text-ui-fg-subtle"} title={r.reason}>
                          {hint(r.reasonCode, r.reason)}
                        </Text>
                      ) : null}
                      {r.status === "held" || r.status === "skipped" ? (
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
      <Pager count={imports.data?.count ?? 0} page={page} size={PAGE} onPage={setPage} />
      <div className="flex flex-col gap-3 px-6 py-4">
        <div className="flex flex-col gap-1">
          <Text size="small" weight="plus">
            {t("imports.window.title")}
          </Text>
          <Text size="xsmall" className="max-w-3xl text-ui-fg-subtle">
            {t("imports.window.text")}
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
        {status.mode === "live" && !status.writers.find((w) => w.key === "orders")?.allowed ? (
          <InlineTip variant="info" label={t("writers.names.orders")}>
            {t("writers.notAllowed", { key: "orders" })}
          </InlineTip>
        ) : null}
      </div>
    </Container>
  )
}
