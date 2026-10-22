import { useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  ArrowPath,
  ArrowUpRightOnBox,
  ArrowUturnLeft,
  Beaker,
  BuildingTax,
  CheckCircle,
  CheckCircleSolid,
  Clock,
  CurrencyDollar,
  DocumentText,
  ExclamationCircle,
  EyeSlash,
  History,
  Key,
  ListBullet,
  ShieldCheck,
  User,
  XCircle,
  XMarkMini,
} from "@medusajs/icons"
import { Button, Container, InlineTip, Table, Text, toast } from "@medusajs/ui"
import type { CheckResult, DocumentDto, DocumentFilter, PlanFilter, StatusResponse } from "../../../modules/fakturownia/lib/contract"
import {
  errorMessage,
  fakturowniaKeys,
  useFakturowniaCheck,
  useFakturowniaDemoSeed,
  useFakturowniaDocuments,
  useFakturowniaRuns,
  useFakturowniaStatus,
  useFakturowniaSync,
} from "../../lib/fakturownia-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, StatTile, StatTiles, ToneBadge, useDebouncedValue } from "../../lib/fakturownia-blocks"
import { CorrectionsSection } from "../../lib/fakturownia-corrections"
import { DocumentDrawer } from "../../lib/fakturownia-document"
import { AddStoreButton, HelpButtons, IntegrationHeader, KeyPoints, ModeBadge, ReferencesBadge, SettingsView, communityLabels, usePageNav, type PageNav } from "../../lib/fakturownia-guide"
import { GuideView, usePromptSpec } from "../../lib/fakturownia-guide-view"
import { FakturowniaIcon } from "../../lib/fakturownia-icon"
import { KitLoading, KitSkeletonRows } from "../../lib/fakturownia-kit"
import { DemoDetails, MailboxSection, SummarySection, UnpaidSection, WritersSection } from "../../lib/fakturownia-panels"
import {
  BuyerWarningText,
  DocumentStatusBadge,
  Fact,
  KindBadge,
  KsefBadge,
  MedusaMark,
  PaidBadge,
  RunStatusBadge,
  StoreOrderCell,
  connectionState,
  fmtDateTime,
  fmtDuration,
  fmtMoney,
  fmtNumber,
  fmtRating,
  referencesFor,
  runSummary,
  useDocumentActions,
} from "../../lib/fakturownia-ui"

/**
 * Fakturownia. Three views, switched in the header and kept in the URL:
 *
 * - Panel: the business side. Counters (each a filter of the documents), the
 *   documents next to the store orders they belong to (one click to each
 *   order), the corrections waiting for a person, the unpaid documents with
 *   reminders, the monthly summary.
 * - Setup guide (`?view=guide`).
 * - Settings (`?view=settings&tab=`): the technical side. The Fakturownia
 *   account with the options in use, the writers, the e-mails and the
 *   history of background runs.
 *
 * The demo note and the stores running the integration sit in header badges.
 * The document drawer opens from every list.
 *
 * Deep links (hosts, boards, the order card): `?filter=attention` (any filter
 * of the documents table), `?q=1042` (a search: order number, document
 * number, order id), `?doc=fkdoc_...` (opens the document drawer),
 * `?customer=cus_...` (the documents of a customer's orders) and
 * `?plans=open|approved|issued|closed|all` (the correction plans, scrolled to).
 */
const PAGE_SIZE = 15
const PLAN_FILTERS: readonly PlanFilter[] = ["open", "approved", "issued", "closed", "all"]

const SETTINGS_TABS = ["account", "writers", "mailbox", "runs"] as const
type SettingsTabId = (typeof SETTINGS_TABS)[number]

const FILTERS: DocumentFilter[] = ["all", "pending", "issued", "attention", "unpaid", "ksef", "corrections", "canceled"]

const FILTER_ICON: Record<DocumentFilter, ReactNode> = {
  all: <ListBullet />,
  pending: <Clock />,
  issued: <CheckCircle />,
  canceled: <XCircle />,
  attention: <ExclamationCircle />,
  unpaid: <CurrencyDollar />,
  ksef: <ShieldCheck />,
  corrections: <ArrowUturnLeft />,
}

function scrollToSection(id: string): void {
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }))
}

const FakturowniaPage = () => {
  const { t, i18n } = useTranslation("fakturownia")
  const lang = i18n.language || "en"
  const client = useQueryClient()
  const nav = usePageNav(SETTINGS_TABS)
  const [pollUntil, setPollUntil] = useState(0)
  const status = useFakturowniaStatus(pollUntil)
  const s = status.data
  const polling = (s?.running.length ?? 0) > 0 || Date.now() < pollUntil
  const [params] = useSearchParams()
  const [filter, setFilter] = useState<DocumentFilter>(() => {
    const asked = params.get("filter")
    return asked && (FILTERS as readonly string[]).includes(asked) ? (asked as DocumentFilter) : "all"
  })
  const initialQuery = (params.get("q") ?? "").slice(0, 80)
  const [customer, setCustomer] = useState(() => {
    const id = params.get("customer") ?? ""
    return /^cus_[A-Za-z0-9]{1,60}$/.test(id) ? id : ""
  })
  const plansParam = params.get("plans")
  const plansFilter = PLAN_FILTERS.includes(plansParam as PlanFilter) ? (plansParam as PlanFilter) : null
  const [openDocument, setOpenDocument] = useState<string | null>(() => {
    const doc = params.get("doc") ?? ""
    return /^fkdoc_[A-Za-z0-9]{1,60}$/.test(doc) ? doc : null
  })

  /* Demo mode, first visit: the sample documents, asked for once (GET routes never write). */
  const seed = useFakturowniaDemoSeed()
  const seedAsked = useRef(false)
  useEffect(() => {
    if (!s || s.mode !== "demo" || s.demoPrepared || seedAsked.current) return
    seedAsked.current = true
    seed.mutate()
  }, [s, seed])

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

  /* A tile filters the documents below; a second click on the active one clears it. */
  const pick = (f: DocumentFilter) => {
    setFilter(filter === f && f !== "all" ? "all" : f)
    scrollToSection("fakturownia-documents")
  }
  const n = s?.counts

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} fetching={status.isFetching} lang={lang} nav={nav} onAction={poll} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s ? <Warnings status={s} /> : null}
        {seed.isPending ? <KitLoading label={t("demo.preparing")} /> : null}
        {!s && status.isLoading ? <KitLoading /> : null}
        {s && n && nav.view === "panel" ? (
          <StatTiles columns={4}>
            <StatTile icon={<CheckCircle />} label={t("stats.issued24h")} value={fmtNumber(n.issued24h, lang)} tone="green" active={filter === "issued"} onClick={() => pick("issued")} title={t("stats.filterHint")} />
            <StatTile icon={<Clock />} label={t("stats.pending")} value={fmtNumber(n.pending, lang)} tone={n.pending > 0 ? "blue" : "grey"} active={filter === "pending"} onClick={() => pick("pending")} title={t("stats.filterHint")} />
            <StatTile icon={<ExclamationCircle />} label={t("stats.attention")} value={fmtNumber(n.attention, lang)} tone={n.attention > 0 ? "red" : "grey"} active={filter === "attention"} onClick={() => pick("attention")} title={t("stats.filterHint")} />
            <StatTile icon={<CurrencyDollar />} label={t("stats.unpaid")} value={fmtNumber(n.unpaid, lang)} tone={n.unpaid > 0 ? "orange" : "grey"} active={filter === "unpaid"} onClick={() => pick("unpaid")} title={t("stats.filterHint")} />
            <StatTile icon={<ShieldCheck />} label={t("stats.ksefAccepted")} value={fmtNumber(n.ksefAccepted, lang)} tone="green" />
            <StatTile icon={<Clock />} label={t("stats.ksefProcessing")} value={fmtNumber(n.ksefProcessing, lang)} tone={n.ksefProcessing > 0 ? "blue" : "grey"} />
            <StatTile icon={<XCircle />} label={t("stats.ksefRejected")} value={fmtNumber(n.ksefProblems, lang)} tone={n.ksefProblems > 0 ? "red" : "grey"} active={filter === "ksef"} onClick={() => pick("ksef")} title={t("stats.filterHint")} />
            <StatTile
              icon={<ArrowUturnLeft />}
              label={t("stats.corrections")}
              value={fmtNumber(n.correctionsOpen, lang)}
              tone={n.correctionsOpen > 0 ? "orange" : "grey"}
              onClick={() => scrollToSection("fakturownia-corrections")}
              title={t("stats.correctionsHint")}
            />
          </StatTiles>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} /> : null}

      {s && nav.view === "panel" ? (
        <>
          <DocumentsSection
            status={s}
            lang={lang}
            filter={filter}
            onFilter={setFilter}
            poll={polling}
            onAction={poll}
            onOpen={setOpenDocument}
            initialQuery={initialQuery}
            customer={customer}
            onClearCustomer={() => setCustomer("")}
          />
          <CorrectionsSection status={s} lang={lang} onOpenDocument={setOpenDocument} initialFilter={plansFilter ?? "open"} focus={plansFilter !== null} />
          <UnpaidSection status={s} lang={lang} onOpenDocument={setOpenDocument} />
          <SummarySection lang={lang} />
        </>
      ) : null}

      {s && nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "account", label: t("settings.tab.account") },
            { id: "writers", label: t("settings.tab.writers"), badge: Object.values(s.writers).filter((w) => w.armed).length, tone: "green" },
            { id: "mailbox", label: t("settings.tab.mailbox") },
            { id: "runs", label: t("settings.tab.runs") },
          ]}
        >
          {nav.tab === "account" ? <ConnectionSection status={s} lang={lang} /> : null}
          {nav.tab === "writers" ? <WritersSection status={s} lang={lang} /> : null}
          {nav.tab === "mailbox" ? <MailboxSection status={s} lang={lang} /> : null}
          {nav.tab === "runs" ? <RunsSection lang={lang} poll={polling} /> : null}
        </SettingsView>
      ) : null}

      {openDocument ? <DocumentDrawer documentId={openDocument} onClose={() => setOpenDocument(null)} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Header({ status, fetching, lang, nav, onAction }: { status: StatusResponse | undefined; fetching: boolean; lang: string; nav: PageNav<SettingsTabId>; onAction: () => void }) {
  const { t } = useTranslation("fakturownia")
  const client = useQueryClient()
  const sync = useFakturowniaSync()
  const running = new Set(status?.running ?? [])
  const ready = Boolean(status?.configured)
  const mode = connectionState(status)
  const demo = status?.mode === "demo"
  const references = status ? referencesFor(status.references, lang) : []
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)

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

  const panel = nav.view !== "guide"

  return (
    <IntegrationHeader
      icon={<FakturowniaIcon width={28} height={28} />}
      title={t("title")}
      badges={
        status ? (
          <ModeBadge color={mode.tone} label={t(`mode.${mode.key}`)} title={t("demo.label")}>
            {demo ? <DemoDetails status={status} /> : null}
          </ModeBadge>
        ) : null
      }
      description={t("subtitle")}
      points={[
        { icon: <DocumentText />, text: t("points.documents") },
        { icon: <ShieldCheck />, text: t("points.once"), tone: "green" },
        { icon: <BuildingTax />, text: t("points.ksef") },
        { icon: <CurrencyDollar />, text: t("points.payments") },
        { icon: <EyeSlash />, text: t("points.noBuyerData") },
        demo && { icon: <Beaker />, text: t("points.demo"), tone: "blue" },
      ]}
      social={
        <>
          <ReferencesBadge
            items={references}
            labels={{
              count: (live, soon) =>
                live > 0
                  ? live === 1
                    ? t("references.badgeOne")
                    : t("references.badgeMany", { count: live })
                  : soon === 1
                    ? t("references.badgeSoonOne")
                    : t("references.badgeSoonMany", { count: soon }),
              soonMore: (soon) => t("references.soonMore", { count: soon }),
              soon: t("references.soon"),
              title: t("references.title"),
              subtitle: t("references.subtitle"),
              open: t("references.open"),
              review: t("references.review"),
              rating: (value) => fmtRating(value, lang),
            }}
          />
          <AddStoreButton labels={community.addStore} />
        </>
      }
      help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
      view={nav.view}
      onView={(v) => nav.go(v)}
      labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("settings.title"), more: t("actions.moreActions") }}
      primary={
        panel
          ? {
              key: "issue",
              label: running.has("issue") ? t("actions.running") : t("actions.issuePending"),
              icon: <DocumentText />,
              loading: sync.isPending && sync.variables === "issue",
              disabled: !ready || running.has("issue"),
              onClick: () => void start("issue"),
            }
          : null
      }
      actions={[
        {
          key: "refresh",
          label: t("actions.refresh"),
          icon: <ArrowPath />,
          loading: fetching,
          onClick: () => void client.invalidateQueries({ queryKey: fakturowniaKeys.all }),
        },
        ...(panel
          ? [
              {
                key: "statuses",
                label: running.has("statuses") ? t("actions.running") : t("actions.refreshStatuses"),
                icon: <ShieldCheck />,
                disabled: !ready || running.has("statuses"),
                onClick: () => void start("statuses"),
              },
            ]
          : []),
        ...(status?.accountUrl && !demo
          ? [
              {
                key: "open",
                label: t("actions.open"),
                icon: <ArrowUpRightOnBox />,
                onClick: () => window.open(status.accountUrl ?? "", "_blank", "noopener"),
              },
            ]
          : []),
      ]}
    />
  )
}

/** Only what needs a person now: missing options in live mode (in red: nothing is issued). The demo note lives in the mode badge. */
function Warnings({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("fakturownia")
  if (status.mode === "demo" || status.missing.length === 0) return null
  return (
    <div className="px-6 py-4">
      <InlineTip variant="error" label={t("missing.label")}>
        {t("missing.text", { missing: status.missing.join(", ") })}
      </InlineTip>
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

  const onOff = (v: boolean) => <ToneBadge tone={v ? "green" : "grey"}>{v ? t("connection.on") : t("connection.off")}</ToneBadge>

  return (
    <Section
      icon={<Key />}
      title={t("connection.title")}
      pointsLabel={demo ? t("connection.demoNote") : t("connection.subtitle")}
      points={
        demo
          ? [{ icon: <Beaker />, text: t("connection.points.demo"), tone: "blue" }]
          : [
              { icon: <Key />, text: t("connection.points.header") },
              { icon: <EyeSlash />, text: t("connection.points.masked") },
              { icon: <ShieldCheck />, text: t("connection.points.checkReads"), tone: "green" },
            ]
      }
      actions={
        <Button size="small" variant="secondary" isLoading={check.isPending} disabled={!status.configured} onClick={() => void onCheck()}>
          <CheckCircleSolid />
          {t("actions.check")}
        </Button>
      }
    >
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
            {status.tokenSet ? <ToneBadge tone="green">{t("connection.tokenSet")}</ToneBadge> : <ToneBadge tone="red">{t("connection.tokenMissing")}</ToneBadge>}
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
        <KeyPoints
          label={t("connection.schedule")}
          items={[
            { icon: <Clock />, text: t("connection.every.issue") },
            { icon: <Clock />, text: t("connection.every.payments") },
            { icon: <Clock />, text: t("connection.every.statuses") },
            { icon: <Clock />, text: t("connection.every.corrections") },
          ]}
        />
      </div>
    </Section>
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
      return c.corrections
  }
}

/** The actions of one row: the writes it may need, then PDF, Fakturownia and the details. */
function DocumentRowActions({ doc, onDone, onOpen }: { doc: DocumentDto; onDone: () => void; onOpen: () => void }) {
  const { actions, extra } = useDocumentActions(doc, { onDone, onOpen, links: true })
  return (
    <>
      <RowActions actions={actions} />
      {extra}
    </>
  )
}

function DocumentsSection({
  status,
  lang,
  filter,
  onFilter,
  poll,
  onAction,
  onOpen,
  initialQuery = "",
  customer = "",
  onClearCustomer,
}: {
  status: StatusResponse
  lang: string
  filter: DocumentFilter
  onFilter: (f: DocumentFilter) => void
  poll: boolean
  onAction: () => void
  onOpen: (id: string) => void
  initialQuery?: string
  /** A deep link from a customer card: only the documents of this customer's orders. */
  customer?: string
  onClearCustomer?: () => void
}) {
  const { t } = useTranslation("fakturownia")
  const [search, setSearch] = useState(initialQuery)
  const q = useDebouncedValue(search.trim())
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q, customer])
  const documents = useFakturowniaDocuments(filter, q, page * PAGE_SIZE, PAGE_SIZE, poll, customer)
  const rows = documents.data?.documents ?? []
  /* A second click on the active filter clears it. */
  const pick = (f: DocumentFilter) => onFilter(filter === f && f !== "all" ? "all" : f)
  const button = (f: DocumentFilter, attention = false) => (
    <FilterButton
      key={f}
      icon={FILTER_ICON[f]}
      label={t(`documents.filter.${f}`)}
      count={customer ? undefined : filterCount(status, f)}
      attention={attention}
      active={filter === f}
      onClick={() => pick(f)}
    />
  )

  return (
    <Section
      id="fakturownia-documents"
      icon={<DocumentText />}
      title={t("documents.title")}
      pointsLabel={t("documents.subtitle")}
      points={[
        { icon: <MedusaMark className="size-3.5" />, text: t("documents.points.order") },
        { icon: <ShieldCheck />, text: t("documents.points.once"), tone: "green", title: t("documents.exactlyOnce") },
        { icon: <DocumentText />, text: t("documents.points.number") },
        { icon: <History />, text: t("documents.points.history") },
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("documents.search")} />}
    >
      <FilterBar>
        {button("all")}
        <FilterDivider />
        {button("pending")}
        {button("issued")}
        {button("canceled")}
        <FilterDivider />
        {button("attention", true)}
        {button("unpaid", true)}
        {button("ksef", true)}
        <FilterDivider />
        {button("corrections")}
        {customer ? (
          <>
            <FilterDivider />
            <Button size="small" variant="secondary" onClick={onClearCustomer} title={t("documents.showAll")} className="gap-x-1.5">
              <User />
              <span className="max-w-[16rem] truncate font-mono">{t("documents.customer", { id: customer })}</span>
              <XMarkMini />
            </Button>
          </>
        ) : null}
      </FilterBar>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>
                <span className="inline-flex items-center gap-x-1.5" title={t("documents.exactlyOnce")}>
                  <MedusaMark className="h-3.5 w-3.5 text-ui-fg-muted" />
                  {t("documents.col.order")}
                </span>
              </Table.HeaderCell>
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
            {documents.isLoading ? <KitSkeletonRows cols={9} rows={5} /> : null}
            {!documents.isLoading && rows.length === 0 ? (
              <EmptyTableRow cols={9} icon={filter === "attention" || filter === "ksef" ? <CheckCircleSolid /> : FILTER_ICON[filter]} title={t(`documents.emptyBy.${filter}`)} />
            ) : null}
            {rows.map((d) => (
              <Table.Row key={d.id} className="[&_td]:py-2.5 align-top">
                <Table.Cell className="max-w-[260px]">
                  <StoreOrderCell orderId={d.orderId} displayId={d.displayId} />
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
                  <DocumentRowActions doc={d} onDone={onAction} onOpen={() => onOpen(d.id)} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
      <Pagination count={documents.data?.count ?? 0} page={page} onPage={setPage} />
    </Section>
  )
}

/* ------------------------------------------------------------------ */

function RunsSection({ lang, poll }: { lang: string; poll: boolean }) {
  const { t } = useTranslation("fakturownia")
  const runs = useFakturowniaRuns(poll)
  const rows = runs.data?.runs ?? []
  return (
    <Section
      icon={<History />}
      title={t("runs.title")}
      pointsLabel={t("runs.subtitle")}
      points={[
        { icon: <Clock />, text: t("runs.points.background") },
        { icon: <ListBullet />, text: t("runs.points.newest") },
      ]}
    >
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
            {runs.isLoading ? <KitSkeletonRows cols={5} rows={4} /> : null}
            {!runs.isLoading && rows.length === 0 ? <EmptyTableRow cols={5} icon={<History />} title={t("runs.empty")} /> : null}
            {rows.map((r) => (
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
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

export const config = defineRouteConfig({
  label: "Fakturownia",
  icon: FakturowniaIcon,
})

export default FakturowniaPage
