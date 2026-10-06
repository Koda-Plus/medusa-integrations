import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ChatBubbleLeftRight, XMarkMini } from "@medusajs/icons"
import { Badge, Container, Heading, InlineTip, Input, Table, Text, clx, toast } from "@medusajs/ui"
import type { CurrencyAmountDto, StatusResponse, ThreadDto } from "../../../modules/negotiations/lib/contract"
import {
  errorCode,
  errorMessage,
  negotiationsKeys,
  useExpireNow,
  useNegotiationThreads,
  useNegotiationsStatus,
  useOldestWaiting,
  useResetDemo,
  useRunDraftOrders,
} from "../../lib/negotiations-api"
import { AddStoreButton, HelpButtons, IntegrationHeader, ModeBadge, ReferencesBadge, SettingsView, communityLabels, usePageNav, type HeaderAction, type PageNav } from "../../lib/negotiations-guide"
import { GuideView, usePromptSpec } from "../../lib/negotiations-guide-view"
import { NegotiationsIcon } from "../../lib/negotiations-icon"
import { DemoDetails, GeneralSection, RunsSection, WritersSection } from "../../lib/negotiations-settings"
import { ThreadDrawer } from "../../lib/negotiations-thread"
import {
  CustomerCell,
  DemoBadge,
  EmptyRow,
  FilterPills,
  NegotiationStatusBadge,
  PriceCell,
  StatTile,
  SubjectCell,
  WaitingDot,
  customerLine,
  fmtDateTime,
  fmtMoney,
  fmtMoneyCompact,
  fmtNumber,
  fmtRating,
  fmtRelative,
  referencesFor,
  useDebounced,
} from "../../lib/negotiations-ui"

/**
 * Negotiations by Koda Plus. Three views, switched in the header and kept in the URL:
 *
 * - Panel: the business side. Counters (what waits for the team, what is on
 *   the table, what was agreed), the queue with filters and search, and the
 *   thread drawer with the conversation and every move.
 * - Setup guide (`?view=guide`): the storefront calls, events, expiry, the
 *   writer, the go-live checklist.
 * - Settings (`?view=settings&tab=`): the options in use and the expiry, the
 *   draft order writer with its plan, the history of runs.
 *
 * `?thread=<id>` opens a thread (the widgets link here), `?customer=<id>`
 * narrows the queue to one customer.
 */
const PAGE_SIZE = 20

const SETTINGS_TABS = ["general", "writers", "runs"] as const
type SettingsTabId = (typeof SETTINGS_TABS)[number]

type QueueFilter = "all" | "waiting" | "open" | "counter_offered" | "accepted" | "rejected" | "expired"
const FILTERS: QueueFilter[] = ["all", "waiting", "open", "counter_offered", "accepted", "rejected", "expired"]

function isFilter(v: string | null): v is QueueFilter {
  return v !== null && (FILTERS as string[]).includes(v)
}

const NegotiationsPage = () => {
  const { t, i18n } = useTranslation("negotiations")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const status = useNegotiationsStatus()
  const s = status.data
  const [params, setParams] = useSearchParams()
  const openId = params.get("thread")
  const customerId = params.get("customer")
  const [filter, setFilter] = useState<QueueFilter>(() => (isFilter(params.get("status")) ? (params.get("status") as QueueFilter) : "all"))
  const [preview, setPreview] = useState<ThreadDto | null>(null)

  const setParam = (key: string, value: string | null) => {
    const p = new URLSearchParams(params)
    if (value) p.set(key, value)
    else p.delete(key)
    setParams(p, { replace: true })
  }
  const openThread = (thread: ThreadDto | null, id?: string) => {
    setPreview(thread)
    setParam("thread", thread?.id ?? id ?? null)
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} loading={status.isLoading} lang={lang} nav={nav} onOpen={(th) => openThread(th)} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s && nav.view === "panel" ? <Counters status={s} lang={lang} filter={filter} onFilter={setFilter} /> : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} /> : null}

      {s && nav.view === "panel" ? (
        <QueueSection
          status={s}
          lang={lang}
          filter={filter}
          onFilter={setFilter}
          customerId={customerId}
          onClearCustomer={() => setParam("customer", null)}
          onOpen={(th) => openThread(th)}
        />
      ) : null}

      {s && nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "general", label: t("settings.tab.general") },
            { id: "writers", label: t("settings.tab.writers"), badge: s.writers.draftOrders.armed ? t("writers.armed") : null, tone: "green" },
            { id: "runs", label: t("settings.tab.runs") },
          ]}
        >
          {nav.tab === "general" ? <GeneralSection status={s} lang={lang} /> : null}
          {nav.tab === "writers" ? <WritersSection status={s} lang={lang} /> : null}
          {nav.tab === "runs" ? <RunsSection lang={lang} /> : null}
        </SettingsView>
      ) : null}

      {openId ? <ThreadDrawer id={openId} preview={preview?.id === openId ? preview : null} status={s} onClose={() => openThread(null)} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function modeBadge(s: StatusResponse | undefined): { color: "green" | "purple" | "grey"; key: string } {
  if (!s) return { color: "grey", key: "mode.loading" }
  return s.mode === "demo" ? { color: "purple", key: "mode.demo" } : { color: "green", key: "mode.live" }
}

function Header({ status, loading, lang, nav, onOpen }: { status: StatusResponse | undefined; loading: boolean; lang: string; nav: PageNav<SettingsTabId>; onOpen: (thread: ThreadDto) => void }) {
  const { t } = useTranslation("negotiations")
  const client = useQueryClient()
  const expire = useExpireNow()
  const drafts = useRunDraftOrders()
  const reset = useResetDemo()
  const waiting = useOldestWaiting()
  const badge = modeBadge(status)
  const references = status ? referencesFor(status.references, lang) : []
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)
  const count = status?.counts.waiting ?? 0
  const oldest = waiting.data?.threads[0] ?? null

  const fail = (err: unknown) => {
    const code = errorCode(err)
    toast.error(code ? t(`errors.${code}`, { defaultValue: errorMessage(err) }) : t("toast.error", { error: errorMessage(err) }))
  }

  const actions: HeaderAction[] = [
    { key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, onClick: () => void client.invalidateQueries({ queryKey: negotiationsKeys.all }) },
  ]
  if (status?.mode === "live") {
    actions.push({
      key: "expire",
      label: t("actions.expireNow"),
      loading: expire.isPending,
      onClick: () =>
        void expire
          .mutateAsync()
          .then((r) => toast.success(t("toast.expired", { count: r.run?.counts.expired ?? 0 })))
          .catch(fail),
    })
  }
  if (status?.writers.draftOrders.armed) {
    actions.push({
      key: "drafts",
      label: t("actions.runDrafts"),
      loading: drafts.isPending,
      onClick: () =>
        void drafts
          .mutateAsync({ dryRun: false })
          .then(() => toast.success(t("toast.draftsRun")))
          .catch(fail),
    })
  }
  if (status?.mode === "demo") {
    actions.push({
      key: "reset",
      label: t("actions.resetDemo"),
      loading: reset.isPending,
      onClick: () =>
        void reset
          .mutateAsync()
          .then(() => toast.success(t("toast.demoReset")))
          .catch(fail),
    })
  }

  return (
    <IntegrationHeader
      icon={<NegotiationsIcon width={28} height={28} />}
      title={t("title")}
      by={t("by")}
      badges={
        <>
          {!loading ? (
            <ModeBadge color={badge.color} label={t(badge.key)} title={t("demo.label")}>
              {status?.mode === "demo" ? <DemoDetails status={status} lang={lang} /> : null}
            </ModeBadge>
          ) : null}
          {count > 0 ? (
            <Badge size="2xsmall" color="red">
              {t("waitingBadge", { count })}
            </Badge>
          ) : null}
          {status?.writers.draftOrders.armed ? (
            <Badge size="2xsmall" color="orange">
              {t("mode.writing")}
            </Badge>
          ) : null}
        </>
      }
      description={t("subtitle")}
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
        nav.view === "panel"
          ? {
              key: "next",
              label: count > 0 ? t("actions.next", { count }) : t("actions.nextNone"),
              icon: <ChatBubbleLeftRight />,
              disabled: !oldest,
              onClick: () => {
                if (oldest) onOpen(oldest)
              },
            }
          : null
      }
      actions={nav.view !== "guide" ? actions : []}
    />
  )
}

/* ------------------------------------------------------------------ */

/** A money counter: the main currency in full, or in short form when the full amount is very long (the full one on hover). */
function moneyTile(list: CurrencyAmountDto[], fallbackCurrency: string | null, lang: string): { value: string; full: string } {
  if (list.length === 0) {
    const zero = fmtMoney({ value: "0.00" }, fallbackCurrency, lang)
    return { value: zero, full: zero }
  }
  const full = fmtMoney(list[0], list[0].currencyCode, lang)
  return { value: [...full].length > 16 ? fmtMoneyCompact(list[0], list[0].currencyCode, lang) || full : full, full }
}

/*
 * The counter grid: at most four columns (two rows of four on a laptop and
 * wider), fewer on a narrower page, a column never under 13rem so a value has
 * room, and never wider than the row on a phone. 2.25rem is the three gaps
 * of gap-3. Inline, so it never depends on which classes the admin build
 * generates.
 */
const COUNTER_COLUMNS = "repeat(auto-fit, minmax(min(100%, max(13rem, calc((100% - 2.25rem) / 4))), 1fr))"

function Counters({ status, lang, filter, onFilter }: { status: StatusResponse; lang: string; filter: QueueFilter; onFilter: (f: QueueFilter) => void }) {
  const { t } = useTranslation("negotiations")
  const c = status.counts
  const tile = (f: QueueFilter) => ({ active: filter === f, onClick: () => onFilter(filter === f ? "all" : f) })
  const more = (list: CurrencyAmountDto[]) => (list.length > 1 ? t("stats.moreCurrencies", { count: list.length - 1, list: list.slice(1).map((m) => fmtMoney(m, m.currencyCode, lang)).join(", ") }) : undefined)
  const currency = status.options.defaultCurrency ?? status.options.storeCurrency
  const inTalks = moneyTile(status.valueInTalks, currency, lang)
  const agreed = moneyTile(status.acceptedValue30Days, currency, lang)
  /* The pipeline and what it is worth on top, the outcomes below. */
  return (
    <div className="grid gap-3 px-6 py-4" style={{ gridTemplateColumns: COUNTER_COLUMNS }}>
      <StatTile label={t("stats.waiting")} value={fmtNumber(c.waiting, lang)} tone={c.waiting > 0 ? "red" : "default"} {...tile("waiting")} />
      <StatTile label={t("stats.open")} value={fmtNumber(c.open, lang)} tone="orange" {...tile("open")} />
      <StatTile label={t("stats.counter")} value={fmtNumber(c.counter_offered, lang)} tone="blue" {...tile("counter_offered")} />
      <StatTile label={t("stats.value")} value={inTalks.value} fullValue={inTalks.full} tone="purple" hint={more(status.valueInTalks) ?? t("stats.valueHint")} />
      <StatTile label={t("stats.accepted")} value={fmtNumber(c.accepted, lang)} tone="green" hint={t("stats.acceptedHint", { count: c.acceptedLast30Days })} {...tile("accepted")} />
      <StatTile label={t("stats.agreed")} value={agreed.value} fullValue={agreed.full} tone="green" hint={more(status.acceptedValue30Days) ?? t("stats.agreedHint")} />
      <StatTile label={t("stats.rejected")} value={fmtNumber(c.rejected, lang)} {...tile("rejected")} />
      <StatTile label={t("stats.expired")} value={fmtNumber(c.expired, lang)} hint={c.expiringSoon > 0 ? t("stats.expiringSoon", { count: c.expiringSoon }) : undefined} {...tile("expired")} />
    </div>
  )
}

function filterCount(status: StatusResponse, f: QueueFilter): number {
  const c = status.counts
  if (f === "all") return c.all
  if (f === "waiting") return c.waiting
  return c[f]
}

function QueueSection({
  status,
  lang,
  filter,
  onFilter,
  customerId,
  onClearCustomer,
  onOpen,
}: {
  status: StatusResponse
  lang: string
  filter: QueueFilter
  onFilter: (f: QueueFilter) => void
  customerId: string | null
  onClearCustomer: () => void
  onOpen: (thread: ThreadDto) => void
}) {
  const { t } = useTranslation("negotiations")
  const [search, setSearch] = useState("")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q, customerId])
  const threads = useNegotiationThreads(filter, q, page * PAGE_SIZE, PAGE_SIZE, customerId)
  const rows = threads.data?.threads ?? []
  const count = threads.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const customerChip = useMemo(() => (customerId && rows[0]?.customerId === customerId ? customerLine(rows[0], t, lang).main : customerId), [customerId, rows, t, lang])

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("queue.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("queue.subtitle")}
        </Text>
      </div>
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPills<QueueFilter> value={filter} onChange={onFilter} options={FILTERS.map((f) => ({ value: f, label: t(`filter.${f}`), count: customerId ? undefined : filterCount(status, f) }))} />
          {customerId ? (
            <button
              type="button"
              onClick={onClearCustomer}
              className="txt-compact-small-plus inline-flex items-center gap-x-1 rounded-full border border-ui-border-interactive bg-ui-bg-highlight px-3 py-1 text-ui-fg-interactive"
              title={t("queue.clearCustomer")}
            >
              {t("queue.customerFilter", { name: customerChip })}
              <XMarkMini />
            </button>
          ) : null}
        </div>
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("queue.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("queue.col.thread")}</Table.HeaderCell>
              <Table.HeaderCell>{t("queue.col.customer")}</Table.HeaderCell>
              <Table.HeaderCell>{t("queue.col.subject")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("queue.col.qty")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("queue.col.price")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("queue.col.value")}</Table.HeaderCell>
              <Table.HeaderCell>{t("queue.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("queue.col.activity")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow cols={8} text={threads.isLoading ? t("queue.loading") : q || filter !== "all" || customerId ? t("queue.emptyFiltered") : t("queue.empty")} />
            ) : (
              rows.map((n) => (
                <Table.Row key={n.id} className={clx("cursor-pointer [&_td]:py-2.5", n.waitingFor === "team" && "bg-ui-bg-highlight")} onClick={() => onOpen(n)}>
                  <Table.Cell>
                    <div className="flex items-center gap-x-2">
                      <WaitingDot waiting={n.waitingFor === "team"} />
                      <div className="flex flex-col">
                        <span className="flex items-center gap-x-1.5">
                          <Text size="small" weight="plus" leading="compact" className="tabular-nums">
                            {n.ref}
                          </Text>
                          {n.demo ? <DemoBadge /> : null}
                        </span>
                        <Text size="xsmall" leading="compact" className="tabular-nums text-ui-fg-muted">
                          {t("queue.messages", { count: n.messageCount })}
                        </Text>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-[14rem]">
                    <CustomerCell thread={n} />
                  </Table.Cell>
                  <Table.Cell className="max-w-[16rem]">
                    <SubjectCell thread={n} />
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{n.subject === "cart" ? "-" : fmtNumber(n.qty, lang)}</Table.Cell>
                  <Table.Cell className="text-right">
                    <PriceCell thread={n} lang={lang} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtMoney(n.value, n.currencyCode, lang) || "-"}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <NegotiationStatusBadge status={n.status} />
                      {n.draftOrder?.state === "created" ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("queue.draftCreated", { number: n.draftOrder.displayId !== null ? `#${n.draftOrder.displayId}` : "" })}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col">
                      <Text size="small" leading="compact" title={fmtDateTime(n.lastActivityAt, lang)}>
                        {fmtRelative(n.lastActivityAt, lang)}
                      </Text>
                      {n.lastMessage ? (
                        <Text size="xsmall" leading="compact" className="text-ui-fg-muted">
                          {t(`last.${n.lastMessage.authorType}`)}
                        </Text>
                      ) : null}
                    </div>
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
        previousPage={() => setPage(Math.max(0, page - 1))}
        nextPage={() => setPage(page + 1)}
        translations={{ of: t("pagination.of"), results: t("pagination.results"), pages: t("pagination.pages"), prev: t("pagination.prev"), next: t("pagination.next") }}
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "negotiations",
  icon: NegotiationsIcon,
})

export default NegotiationsPage
