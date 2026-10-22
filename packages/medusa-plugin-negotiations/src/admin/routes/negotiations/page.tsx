import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  ArrowPath,
  ArrowUturnLeft,
  BarsArrowDown,
  BellAlert,
  ChatBubble,
  ChatBubbleLeftRight,
  CheckCircle,
  Clock,
  CurrencyDollar,
  CursorArrowRays,
  DocumentSeries,
  ListBullet,
  ShoppingCart,
  Tag,
  User,
  XCircle,
  XMarkMini,
} from "@medusajs/icons"
import { Container, InlineTip, Table, Text, clx, toast } from "@medusajs/ui"
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
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, SearchInput, Section, StatTile, StatTiles, ToneBadge, useDebouncedValue } from "../../lib/negotiations-blocks"
import { AddStoreButton, HelpButtons, IntegrationHeader, ModeBadge, ReferencesBadge, SettingsView, communityLabels, usePageNav, type HeaderAction, type PageNav } from "../../lib/negotiations-guide"
import { GuideView, usePromptSpec } from "../../lib/negotiations-guide-view"
import { NegotiationsIcon } from "../../lib/negotiations-icon"
import { KitFetchingBar, KitSkeletonRows } from "../../lib/negotiations-kit"
import { DemoDetails, GeneralSection, RunsSection, WritersSection } from "../../lib/negotiations-settings"
import { ThreadPage } from "../../lib/negotiations-thread"
import {
  CustomerCell,
  DemoBadge,
  NegotiationStatusBadge,
  PriceCell,
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
} from "../../lib/negotiations-ui"

/**
 * Negotiations by Koda Plus. Three views, switched in the header and kept in the URL:
 *
 * - Panel: the business side. Counters (what waits for the team, what is on
 *   the table, what was agreed) and the queue with filters and search.
 * - Setup guide (`?view=guide`): the storefront calls, events, expiry, the
 *   writer, the go-live checklist.
 * - Settings (`?view=settings&tab=`): the options in use and the expiry, the
 *   draft order writer with its plan, the history of runs.
 *
 * `?thread=<id>` opens one thread as a page of its own (the widgets link
 * here), `?customer=<id>` narrows the queue to one customer, `?status=` picks
 * the filter and `?q=` the search.
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
  const filter: QueueFilter = isFilter(params.get("status")) ? (params.get("status") as QueueFilter) : "all"
  const [preview, setPreview] = useState<ThreadDto | null>(null)

  const setParam = (key: string, value: string | null) => {
    const p = new URLSearchParams(params)
    if (value) p.set(key, value)
    else p.delete(key)
    setParams(p, { replace: true })
  }
  const setFilter = (f: QueueFilter) => setParam("status", f === "all" ? null : f)
  const openThread = (thread: ThreadDto) => {
    setPreview(thread)
    const p = new URLSearchParams(params)
    p.set("thread", thread.id)
    setParams(p)
  }

  /* One thread: its own page with the way back to the queue as it was. */
  if (openId) {
    const back = new URLSearchParams(params)
    back.delete("thread")
    const query = back.toString()
    return <ThreadPage id={openId} preview={preview?.id === openId ? preview : null} status={s} backHref={`/app/negotiations${query ? `?${query}` : ""}`} />
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} loading={status.isLoading} lang={lang} nav={nav} onOpen={openThread} />
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
          initialQuery={params.get("q") ?? ""}
          customerId={customerId}
          onClearCustomer={() => setParam("customer", null)}
          onOpen={openThread}
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
      icon: <Clock />,
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
      icon: <DocumentSeries />,
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
      icon: <ArrowUturnLeft />,
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
      badges={
        <>
          {!loading ? (
            <ModeBadge color={badge.color} label={t(badge.key)} title={t("demo.label")}>
              {status?.mode === "demo" ? <DemoDetails status={status} lang={lang} /> : null}
            </ModeBadge>
          ) : null}
          {count > 0 ? <ToneBadge tone="orange">{t("waitingBadge", { count })}</ToneBadge> : null}
          {status?.writers.draftOrders.armed ? <ToneBadge tone="blue">{t("mode.writing")}</ToneBadge> : null}
        </>
      }
      description={t("subtitle")}
      points={[
        { icon: <User />, text: t("points.requests") },
        { icon: <ShoppingCart />, text: t("points.subject") },
        { icon: <ChatBubbleLeftRight />, text: t("points.moves") },
        { icon: <BellAlert />, text: t("points.events") },
        { icon: <Clock />, text: t("points.expiry") },
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

function Counters({ status, lang, filter, onFilter }: { status: StatusResponse; lang: string; filter: QueueFilter; onFilter: (f: QueueFilter) => void }) {
  const { t } = useTranslation("negotiations")
  const c = status.counts
  const tile = (f: QueueFilter) => ({ active: filter === f, onClick: () => onFilter(filter === f ? "all" : f) })
  const more = (list: CurrencyAmountDto[]) => (list.length > 1 ? t("stats.moreCurrencies", { count: list.length - 1, list: list.slice(1).map((m) => fmtMoney(m, m.currencyCode, lang)).join(", ") }) : undefined)
  const currency = status.options.defaultCurrency ?? status.options.storeCurrency
  const inTalks = moneyTile(status.valueInTalks, currency, lang)
  const agreed = moneyTile(status.acceptedValue30Days, currency, lang)
  const tip = (full: string, shown: string, hint: string) => [full !== shown ? full : null, hint].filter(Boolean).join("\n")
  /* The pipeline and what it is worth on top, the outcomes below. Colour only where it means something. */
  return (
    <StatTiles columns={4}>
      <StatTile label={t("stats.waiting")} value={fmtNumber(c.waiting, lang)} tone={c.waiting > 0 ? "orange" : "grey"} {...tile("waiting")} />
      <StatTile label={t("stats.open")} value={fmtNumber(c.open, lang)} {...tile("open")} />
      <StatTile label={t("stats.counter")} value={fmtNumber(c.counter_offered, lang)} tone={c.counter_offered > 0 ? "blue" : "grey"} {...tile("counter_offered")} />
      <StatTile label={t("stats.value")} value={inTalks.value} hint={more(status.valueInTalks)} title={tip(inTalks.full, inTalks.value, t("stats.valueHint"))} />
      <StatTile label={t("stats.accepted")} value={fmtNumber(c.accepted, lang)} tone={c.accepted > 0 ? "green" : "grey"} hint={t("stats.acceptedHint", { count: c.acceptedLast30Days })} {...tile("accepted")} />
      <StatTile label={t("stats.agreed")} value={agreed.value} tone={status.acceptedValue30Days.length > 0 ? "green" : "grey"} hint={more(status.acceptedValue30Days)} title={tip(agreed.full, agreed.value, t("stats.agreedHint"))} />
      <StatTile label={t("stats.rejected")} value={fmtNumber(c.rejected, lang)} {...tile("rejected")} />
      <StatTile
        label={t("stats.expired")}
        value={fmtNumber(c.expired, lang)}
        tone={c.expiringSoon > 0 ? "orange" : "grey"}
        hint={c.expiringSoon > 0 ? t("stats.expiringSoon", { count: c.expiringSoon }) : undefined}
        {...tile("expired")}
      />
    </StatTiles>
  )
}

function filterCount(status: StatusResponse, f: QueueFilter): number {
  const c = status.counts
  if (f === "all") return c.all
  if (f === "waiting") return c.waiting
  return c[f]
}

const FILTER_ICON: Record<QueueFilter, ReactNode> = {
  all: <ListBullet />,
  waiting: <BellAlert />,
  open: <ChatBubble />,
  counter_offered: <CurrencyDollar />,
  accepted: <CheckCircle />,
  rejected: <XCircle />,
  expired: <Clock />,
}

/* All | what waits | on the table | closed. */
const FILTER_GROUPS: QueueFilter[][] = [["all"], ["waiting"], ["open", "counter_offered"], ["accepted", "rejected", "expired"]]

function QueueSection({
  status,
  lang,
  filter,
  onFilter,
  initialQuery,
  customerId,
  onClearCustomer,
  onOpen,
}: {
  status: StatusResponse
  lang: string
  filter: QueueFilter
  onFilter: (f: QueueFilter) => void
  initialQuery: string
  customerId: string | null
  onClearCustomer: () => void
  onOpen: (thread: ThreadDto) => void
}) {
  const { t } = useTranslation("negotiations")
  const [search, setSearch] = useState(initialQuery)
  const q = useDebouncedValue(search.trim())
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q, customerId])
  const threads = useNegotiationThreads(filter, q, page * PAGE_SIZE, PAGE_SIZE, customerId)
  const rows = threads.data?.threads ?? []
  const count = threads.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const customerChip = useMemo(() => (customerId && rows[0]?.customerId === customerId ? customerLine(rows[0], t, lang).main : customerId), [customerId, rows, t, lang])
  const filteredView = Boolean(q || filter !== "all" || customerId)

  return (
    <Section
      id="negotiations-queue"
      icon={<ChatBubbleLeftRight />}
      title={t("queue.title")}
      points={[
        { icon: <BarsArrowDown />, text: t("queue.points.newest") },
        { icon: <BellAlert />, text: t("queue.points.waiting"), tone: status.counts.waiting > 0 ? "orange" : undefined },
        { icon: <CursorArrowRays />, text: t("queue.points.row") },
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("queue.search")} />}
    >
      <FilterBar>
        {FILTER_GROUPS.map((group, i) => (
          <span key={group.join()} className="contents">
            {i > 0 ? <FilterDivider /> : null}
            {group.map((f) => (
              <FilterButton
                key={f}
                icon={FILTER_ICON[f]}
                label={t(`filter.${f}`)}
                count={customerId ? undefined : filterCount(status, f)}
                attention={f === "waiting"}
                active={filter === f}
                onClick={() => onFilter(filter === f ? "all" : f)}
              />
            ))}
          </span>
        ))}
        {customerId ? (
          <>
            <FilterDivider />
            <FilterButton icon={<XMarkMini />} label={t("queue.customerFilter", { name: customerChip })} active onClick={onClearCustomer} title={t("queue.clearCustomer")} />
          </>
        ) : null}
      </FilterBar>
      <KitFetchingBar active={threads.isFetching && !threads.isLoading} />
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
            {threads.isLoading ? (
              <KitSkeletonRows cols={8} rows={5} />
            ) : rows.length === 0 ? (
              <EmptyTableRow
                cols={8}
                icon={<ChatBubbleLeftRight />}
                title={filteredView ? t("queue.emptyFiltered") : t("queue.empty")}
                points={filteredView ? undefined : [{ icon: <Tag />, text: t("queue.emptyHint") }]}
              />
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
    </Section>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "negotiations",
  icon: NegotiationsIcon,
})

export default NegotiationsPage
