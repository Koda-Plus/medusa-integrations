import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath } from "@medusajs/icons"
import { Badge, Button, Container, Heading, InlineTip, Input, Table, Text, toast } from "@medusajs/ui"
import type { CheckResult, DocumentFilter, StatusResponse } from "../../../modules/fakturownia/lib/contract"
import {
  errorMessage,
  fakturowniaKeys,
  useFakturowniaCheck,
  useFakturowniaDocuments,
  useFakturowniaRuns,
  useFakturowniaStatus,
  useFakturowniaSync,
} from "../../lib/fakturownia-api"
import { CorrectionsSection } from "../../lib/fakturownia-corrections"
import { DocumentDrawer } from "../../lib/fakturownia-document"
import { References, ViewSwitch, usePageView } from "../../lib/fakturownia-guide"
import { GuideView } from "../../lib/fakturownia-guide-view"
import { FakturowniaIcon } from "../../lib/fakturownia-icon"
import { MailboxSection, SummarySection, UnpaidSection, WritersSection } from "../../lib/fakturownia-panels"
import {
  BuyerWarningText,
  DocumentActions,
  DocumentLinks,
  DocumentStatusBadge,
  Fact,
  FilterPills,
  KindBadge,
  KsefBadge,
  ModeBadge,
  OrderLink,
  PaidBadge,
  RunStatusBadge,
  StatTile,
  fmtDateTime,
  fmtDuration,
  fmtMoney,
  fmtNumber,
  referencesFor,
  runSummary,
  sinceMonth,
} from "../../lib/fakturownia-ui"

/**
 * Fakturownia by Koda Plus: the Panel (the connection, the writers, the
 * corrections, the documents with their KSeF and e-mail history, the unpaid
 * documents, the e-mails, the monthly summary, the background runs) and the
 * Setup guide, switched in the header and kept in `?view=guide`.
 */
const PAGE_SIZE = 15

const FakturowniaPage = () => {
  const { t, i18n } = useTranslation("fakturownia")
  const lang = i18n.language || "en"
  const client = useQueryClient()
  const [view, setView] = usePageView()
  const [pollUntil, setPollUntil] = useState(0)
  const status = useFakturowniaStatus(pollUntil)
  const s = status.data
  const polling = (s?.running.length ?? 0) > 0 || Date.now() < pollUntil
  const [filter, setFilter] = useState<DocumentFilter>("all")
  const [openDocument, setOpenDocument] = useState<string | null>(null)

  /* A finished run refreshes the tables below. */
  const runKey = JSON.stringify(Object.values(s?.lastRuns ?? {}).map((r) => r?.id ?? ""))
  const seen = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (seen.current !== undefined && seen.current !== runKey) {
      void client.invalidateQueries({ queryKey: fakturowniaKeys.all, predicate: (q) => q.queryKey[1] !== "status" })
    }
    seen.current = runKey
  }, [runKey, client])

  const poll = () => setPollUntil(Date.now() + 30_000)

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} view={view} onView={setView} onAction={poll} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s?.mode === "demo" ? (
          <div className="px-6 py-4">
            <InlineTip variant="info" label={t("demo.label")}>
              <span className="flex flex-col gap-y-1">
                <span>{t("demo.text")}</span>
                <span>{t("demo.new")}</span>
                {s.demoReason === "no_token" ? <span>{t("demo.noToken")}</span> : null}
              </span>
            </InlineTip>
          </div>
        ) : null}
        {s && s.mode === "live" && s.missing.length > 0 ? (
          <div className="px-6 py-4">
            <InlineTip variant="warning" label={t("missing.label")}>
              {t("missing.text", { missing: s.missing.join(", ") })}
            </InlineTip>
          </div>
        ) : null}
        {s && view === "panel" ? (
          <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-4">
            <StatTile label={t("stats.issued24h")} value={fmtNumber(s.counts.issued24h, lang)} tone="green" active={filter === "issued"} onClick={() => setFilter("issued")} />
            <StatTile
              label={t("stats.pending")}
              value={fmtNumber(s.counts.pending, lang)}
              tone={s.counts.pending > 0 ? "orange" : "default"}
              active={filter === "pending"}
              onClick={() => setFilter("pending")}
            />
            <StatTile
              label={t("stats.attention")}
              value={fmtNumber(s.counts.attention, lang)}
              tone={s.counts.attention > 0 ? "red" : "default"}
              active={filter === "attention"}
              onClick={() => setFilter("attention")}
            />
            <StatTile
              label={t("stats.unpaid")}
              value={fmtNumber(s.counts.unpaid, lang)}
              tone={s.counts.unpaid > 0 ? "orange" : "default"}
              active={filter === "unpaid"}
              onClick={() => setFilter("unpaid")}
            />
            <StatTile label={t("stats.ksefAccepted")} value={fmtNumber(s.counts.ksefAccepted, lang)} tone="green" />
            <StatTile label={t("stats.ksefProcessing")} value={fmtNumber(s.counts.ksefProcessing, lang)} tone={s.counts.ksefProcessing > 0 ? "orange" : "default"} />
            <StatTile
              label={t("stats.ksefRejected")}
              value={fmtNumber(s.counts.ksefProblems, lang)}
              tone={s.counts.ksefProblems > 0 ? "red" : "default"}
              active={filter === "ksef"}
              onClick={() => setFilter("ksef")}
            />
            <StatTile label={t("stats.corrections")} value={fmtNumber(s.counts.correctionsOpen, lang)} tone={s.counts.correctionsOpen > 0 ? "orange" : "default"} />
          </div>
        ) : null}
      </Container>

      {s && view === "guide" ? <GuideView status={s} /> : null}

      {s && view === "panel" ? (
        <>
          <References
            items={referencesFor(s.references, lang)}
            title={t("references.title")}
            subtitle={t("references.subtitle")}
            openLabel={t("references.open")}
            sinceLabel={(since) => t("references.since", { date: sinceMonth(since, lang) })}
          />
          <WritersSection status={s} lang={lang} />
          <ConnectionSection status={s} lang={lang} />
          <CorrectionsSection status={s} lang={lang} onOpenDocument={setOpenDocument} />
          <DocumentsSection status={s} lang={lang} filter={filter} onFilter={setFilter} poll={polling} onAction={poll} onOpen={setOpenDocument} />
          <UnpaidSection status={s} lang={lang} onOpenDocument={setOpenDocument} />
          <MailboxSection status={s} lang={lang} />
          <SummarySection lang={lang} />
          <RunsSection lang={lang} poll={polling} />
        </>
      ) : null}
      {openDocument ? <DocumentDrawer documentId={openDocument} onClose={() => setOpenDocument(null)} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Header({ status, view, onView, onAction }: { status: StatusResponse | undefined; view: "panel" | "guide"; onView: (v: "panel" | "guide") => void; onAction: () => void }) {
  const { t } = useTranslation("fakturownia")
  const sync = useFakturowniaSync()
  const running = new Set(status?.running ?? [])
  const ready = Boolean(status?.configured)

  const start = async (what: "issue" | "statuses") => {
    try {
      const r = await sync.mutateAsync(what)
      if (r.alreadyRunning) toast.info(t("toast.already"))
      else toast.success(t("toast.started"))
      onAction()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <FakturowniaIcon width={24} height={24} className="shrink-0" />
          <Heading level="h1">{t("title")}</Heading>
          <Badge size="2xsmall" color="grey">
            {t("by")}
          </Badge>
          {status ? <ModeBadge status={status} /> : null}
        </div>
        <Text size="small" className="max-w-2xl text-ui-fg-subtle">
          {t("subtitle")}
        </Text>
      </div>
      <div className="flex flex-col items-start gap-3 md:items-end">
        <ViewSwitch value={view} onChange={onView} labels={{ panel: t("view.panel"), guide: t("view.guide") }} />
        {view === "panel" ? (
          <div className="flex flex-wrap gap-2">
            <Button size="small" variant="secondary" disabled={!ready || running.has("statuses")} onClick={() => void start("statuses")}>
              {running.has("statuses") ? t("actions.running") : t("actions.refreshStatuses")}
            </Button>
            <Button size="small" variant="primary" isLoading={sync.isPending && sync.variables === "issue"} disabled={!ready || running.has("issue")} onClick={() => void start("issue")}>
              <ArrowPath />
              {running.has("issue") ? t("actions.running") : t("actions.issuePending")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CheckLines({ result, configured }: { result: CheckResult; configured: StatusResponse["options"] }) {
  const { t } = useTranslation("fakturownia")
  if (!result.ok) {
    return (
      <InlineTip variant="error" label={t("actions.check")}>
        {t("connection.checkFailed", { error: result.error ?? "?" })}
      </InlineTip>
    )
  }
  const lines: Array<{ ok: boolean; text: string }> = [{ ok: true, text: t("connection.checkOk") }]
  if (result.departments.length > 0) {
    lines.push({ ok: true, text: t("connection.companies", { list: result.departments.map((d) => `${d.id} ${d.name}`).join(", ") }) })
  }
  if (configured.departmentId !== null && result.departmentFound !== null) {
    lines.push(
      result.departmentFound
        ? { ok: true, text: t("connection.departmentFound", { id: configured.departmentId, name: result.departmentName ?? "" }) }
        : { ok: false, text: t("connection.departmentMissing", { id: configured.departmentId }) },
    )
  }
  for (const c of result.channelDepartments ?? []) {
    lines.push(
      c.found
        ? { ok: true, text: t("connection.channelFound", { channel: c.salesChannelId, id: c.departmentId, name: c.name ?? "" }) }
        : { ok: false, text: t("connection.channelMissing", { channel: c.salesChannelId, id: c.departmentId }) },
    )
  }
  if (configured.categoryId !== null && result.categoryFound !== null) {
    lines.push(
      result.categoryFound
        ? { ok: true, text: t("connection.categoryFound", { id: configured.categoryId, name: result.categoryName ?? "" }) }
        : { ok: false, text: t("connection.categoryMissing", { id: configured.categoryId }) },
    )
  }
  const allOk = lines.every((l) => l.ok)
  return (
    <InlineTip variant={allOk ? "success" : "warning"} label={t("actions.check")}>
      <span className="flex flex-col gap-y-1">
        {lines.map((l) => (
          <span key={l.text}>{l.text}</span>
        ))}
      </span>
    </InlineTip>
  )
}

function ConnectionSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("fakturownia")
  const check = useFakturowniaCheck()
  const o = status.options
  const demo = status.mode === "demo"
  const result = check.data?.result ?? status.lastCheck

  const onCheck = async () => {
    try {
      const r = await check.mutateAsync()
      if (r.result.ok) toast.success(t("toast.checkOk"))
      else toast.error(t("toast.checkFailed", { error: r.result.error ?? "?" }))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const onOff = (v: boolean) => (
    <Badge size="2xsmall" color={v ? "green" : "grey"}>
      {v ? t("connection.on") : t("connection.off")}
    </Badge>
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <Heading level="h2">{t("connection.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {demo ? t("connection.demoNote") : t("connection.subtitle")}
          </Text>
        </div>
        <Button size="small" variant="secondary" isLoading={check.isPending} disabled={!status.configured} onClick={() => void onCheck()}>
          {t("actions.check")}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label={t("connection.account")} mono>
          {demo ? (
            "demo"
          ) : status.accountUrl ? (
            <a href={status.accountUrl} target="_blank" rel="noreferrer" className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
              {status.account}
            </a>
          ) : (
            <span className="font-sans text-ui-tag-red-text">{status.account ?? t("connection.notSet")}</span>
          )}
        </Fact>
        {!demo ? (
          <Fact label={t("connection.token")}>
            {status.tokenSet ? t("connection.tokenSet") : <span className="text-ui-tag-red-text">{t("connection.tokenMissing")}</span>}
          </Fact>
        ) : null}
        <Fact label={t("connection.flow")}>{t(`connection.flows.${o.documentFlow}`)}</Fact>
        <Fact label={t("connection.trigger")}>{t(`connection.triggers.${o.trigger}`)}</Fact>
        <Fact label={t("connection.consumers")}>{o.receiptForConsumers ? t("connection.consumersReceipt", { kind: o.receiptKind }) : t("connection.consumersVat")}</Fact>
        <Fact label={t("connection.vat")} mono>
          {/^\d/.test(o.defaultVatRate) ? `${o.defaultVatRate}%` : o.defaultVatRate}
        </Fact>
        <Fact label={t("connection.language")} mono>
          {o.lang}
        </Fact>
        <Fact label={t("connection.place")}>{o.issuePlace ?? t("connection.notSet")}</Fact>
        <Fact label={t("connection.department")} mono>
          {o.departmentId ?? <span className="font-sans">{t("connection.accountDefault")}</span>}
          {result?.ok && result.departmentName ? <span className="font-sans text-ui-fg-subtle"> ({result.departmentName})</span> : null}
        </Fact>
        {o.departmentsBySalesChannel.length > 0 ? (
          <Fact label={t("connection.channelDepartments")} mono>
            {o.departmentsBySalesChannel.map((c) => `${c.salesChannelId}: ${c.departmentId}`).join(", ")}
          </Fact>
        ) : null}
        <Fact label={t("connection.category")} mono>
          {o.categoryId ?? <span className="font-sans">{t("connection.notSet")}</span>}
          {result?.ok && result.categoryName ? <span className="font-sans text-ui-fg-subtle"> ({result.categoryName})</span> : null}
        </Fact>
        <Fact label={t("connection.paymentTerm")}>{t("connection.days", { count: o.paymentTermDays })}</Fact>
        <Fact label={t("connection.markPaid")}>{onOff(o.markPaidOnCapture)}</Fact>
        <Fact label={t("connection.email")}>{onOff(o.sendByEmail)}</Fact>
        <Fact label={t("connection.emailPdf")}>{onOff(o.emailPdf)}</Fact>
        <Fact label={t("connection.cancel")}>{o.cancelOnOrderCanceled ? t("connection.cancelOn") : onOff(false)}</Fact>
        <Fact label={t("connection.corrections")}>{o.corrections === "plan" ? t("connection.correctionsPlan") : onOff(false)}</Fact>
        <Fact label={t("connection.reminders")}>{t("connection.days", { count: o.reminderAfterDays })}</Fact>
        <Fact label={t("connection.nipSources")} mono>
          <span className="txt-compact-xsmall">{o.nipSources.join(", ")}</span>
        </Fact>
        {o.oidPrefix ? (
          <Fact label={t("connection.oidPrefix")} mono>
            {o.oidPrefix}
          </Fact>
        ) : null}
        <Fact label={t("connection.lastCheck")}>{result ? fmtDateTime(result.checkedAt, lang) : t("connection.never")}</Fact>
      </div>
      {result ? (
        <div className="flex flex-col gap-y-1 px-6 py-4">
          <CheckLines result={result} configured={o} />
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("connection.checkedAt", { time: fmtDateTime(result.checkedAt, lang) })}
          </Text>
        </div>
      ) : null}
      <div className="px-6 py-3">
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("connection.schedule")}
        </Text>
      </div>
    </Container>
  )
}

/* ------------------------------------------------------------------ */

function Pagination({ count, page, onPage }: { count: number; page: number; onPage: (p: number) => void }) {
  const { t } = useTranslation("fakturownia")
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  return (
    <Table.Pagination
      count={count}
      pageSize={PAGE_SIZE}
      pageIndex={page}
      pageCount={pageCount}
      canPreviousPage={page > 0}
      canNextPage={page + 1 < pageCount}
      previousPage={() => onPage(Math.max(0, page - 1))}
      nextPage={() => onPage(page + 1)}
      translations={{
        of: t("pagination.of"),
        results: t("pagination.results"),
        pages: t("pagination.pages"),
        prev: t("pagination.prev"),
        next: t("pagination.next"),
      }}
    />
  )
}

function useDebounced(value: string, ms = 300): string {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value.trim()), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return out
}

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <Table.Row>
      <td colSpan={cols} className="px-6 py-6 text-center">
        <Text size="small" className="text-ui-fg-muted">
          {text}
        </Text>
      </td>
    </Table.Row>
  )
}

const FILTERS: DocumentFilter[] = ["all", "pending", "issued", "attention", "unpaid", "ksef", "corrections", "canceled"]

function filterCount(status: StatusResponse, f: DocumentFilter): number | undefined {
  const c = status.counts
  switch (f) {
    case "all":
      return c.total
    case "pending":
      return c.pending
    case "issued":
      return c.issued
    case "attention":
      return c.attention
    case "unpaid":
      return c.unpaid
    case "ksef":
      return c.ksefProblems
    case "canceled":
      return c.canceled
    case "corrections":
      return undefined
  }
}

function DocumentsSection({
  status,
  lang,
  filter,
  onFilter,
  poll,
  onAction,
  onOpen,
}: {
  status: StatusResponse
  lang: string
  filter: DocumentFilter
  onFilter: (f: DocumentFilter) => void
  poll: boolean
  onAction: () => void
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation("fakturownia")
  const [search, setSearch] = useState("")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])
  const documents = useFakturowniaDocuments(filter, q, page * PAGE_SIZE, PAGE_SIZE, poll)
  const rows = documents.data?.documents ?? []

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("documents.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("documents.subtitle")}
        </Text>
      </div>
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <FilterPills<DocumentFilter> value={filter} onChange={onFilter} options={FILTERS.map((f) => ({ value: f, label: t(`documents.filter.${f}`), count: filterCount(status, f) }))} />
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("documents.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("documents.col.order")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.col.kind")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.col.number")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.col.status")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("documents.col.total")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.col.paid")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.col.ksef")}</Table.HeaderCell>
              <Table.HeaderCell>{t("documents.col.issuedAt")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow cols={9} text={documents.isLoading ? "" : t("documents.empty")} />
            ) : (
              rows.map((d) => (
                <Table.Row key={d.id} className="[&_td]:py-2.5 align-top">
                  <Table.Cell>
                    <OrderLink orderId={d.orderId} displayId={d.displayId} />
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <KindBadge kind={d.kind} />
                      {d.buyerType ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t(d.buyerType === "company" ? "documents.company" : "documents.person")}
                        </Text>
                      ) : null}
                      {d.fromFakturowniaId && d.kind !== "correction" ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("documents.fromProforma")}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    <div className="flex flex-col items-start gap-y-0.5">
                      {d.number ? (
                        <button type="button" className="txt-compact-small font-mono text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={() => onOpen(d.id)}>
                          {d.number}
                        </button>
                      ) : null}
                      {d.emailStatus ? (
                        <Text size="xsmall" className={d.emailStatus === "failed" ? "text-ui-tag-red-text" : "text-ui-fg-muted"} title={d.emailError ?? undefined}>
                          {t(`documents.email.${d.emailStatus}`, { time: fmtDateTime(d.emailedAt, lang) })}
                        </Text>
                      ) : d.emailedAt ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("documents.email.sent", { time: fmtDateTime(d.emailedAt, lang) })}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-md">
                    <div className="flex flex-col items-start gap-y-1">
                      <DocumentStatusBadge status={d.status} />
                      {d.error && d.errorCode !== "adopted" ? (
                        <Text size="xsmall" className={d.status === "failed" || d.status === "unknown" ? "text-ui-tag-red-text" : "text-ui-fg-subtle"}>
                          {d.errorCode && /^(HTTP_|API_|ERROR_|conflict|unknown_result)/.test(d.errorCode) ? <span className="font-mono">[{d.errorCode}] </span> : null}
                          {d.error}
                        </Text>
                      ) : null}
                      {d.errorCode === "adopted" ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("documents.adopted")}
                        </Text>
                      ) : null}
                      <BuyerWarningText warning={d.buyerWarning} />
                      {d.status === "pending" && d.nextAttemptAt && d.attempts > 0 ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("documents.nextAttempt", { time: fmtDateTime(d.nextAttemptAt, lang) })}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtMoney(d.totalGross, d.currency, lang)}</Table.Cell>
                  <Table.Cell>{(d.status === "issued" || d.status === "needs_correction") && d.kind !== "correction" ? <PaidBadge paid={d.paid} /> : null}</Table.Cell>
                  <Table.Cell>
                    <KsefBadge doc={d} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(d.issuedAt, lang)}</Table.Cell>
                  <Table.Cell className="text-right">
                    <div className="flex flex-col items-end gap-y-2">
                      <DocumentActions doc={d} onDone={onAction} />
                      <span className="inline-flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                        <DocumentLinks doc={d} />
                        <Button size="small" variant="transparent" onClick={() => onOpen(d.id)}>
                          {t("documents.details")}
                        </Button>
                      </span>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pagination count={documents.data?.count ?? 0} page={page} onPage={setPage} />
    </Container>
  )
}

/* ------------------------------------------------------------------ */

function RunsSection({ lang, poll }: { lang: string; poll: boolean }) {
  const { t } = useTranslation("fakturownia")
  const runs = useFakturowniaRuns(poll)
  const rows = runs.data?.runs ?? []
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
              <Table.HeaderCell>{t("runs.col.kind")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.result")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.summary")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("runs.col.duration")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow cols={5} text={runs.isLoading ? "" : t("runs.empty")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5" title={r.message ?? undefined}>
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.startedAt, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {t(`runs.kinds.${r.kind}`)}
                    <span className="text-ui-fg-muted"> / {t(`runs.triggers.${r.trigger}`)}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <RunStatusBadge status={r.status} />
                  </Table.Cell>
                  <Table.Cell className="max-w-xl">
                    <Text size="small">{runSummary(r, t)}</Text>
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
  label: "Fakturownia",
  icon: FakturowniaIcon,
})

export default FakturowniaPage
