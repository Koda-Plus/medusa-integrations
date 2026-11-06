import { useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowDownTray,
  ArrowPath,
  ArrowRightOnRectangle,
  ArrowUpRightOnBox,
  ArrowUturnLeft,
  Beaker,
  CheckCircle,
  Clock,
  ExclamationCircle,
  Key,
  ListBullet,
  LockClosedSolid,
  MinusCircle,
  PaperPlane,
  ShieldCheck,
} from "@medusajs/icons"
import { Button, Copy, Drawer, InlineTip, Table, Text, toast, usePrompt } from "@medusajs/ui"
import type { ReturnDto, ReturnFilter, ReturnMethod, StatusResponse, WriterDto } from "../../modules/inpost/lib/contract"
import {
  errorMessage,
  returnLabelUrl,
  useInpostReturnCreate,
  useInpostReturnPlan,
  useInpostReturnRefresh,
  useInpostReturnRetry,
  useInpostReturns,
  useInpostReturnSkip,
  useInpostReturnsCheck,
} from "./inpost-api"
import { EmptyState, EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, ToneBadge, useDebouncedValue, type RowAction, type Tone } from "./inpost-blocks"
import { nb } from "./inpost-guide"
import { KitFetchingBar, KitLoading, KitSkeletonRows } from "./inpost-kit"
import { Fact, MedusaMark, OrderCell, ProblemList, TrackingCell, fmtDateTime } from "./inpost-ui"

/*
 * InPost returns (InPost Returns API): the list on the InPost page, the
 * "InPost return" part of the order widget, the plan a person reads before a
 * return is created, and the Returns API card of Settings. The customer drops
 * the parcel at any Paczkomat with a short code, or sticks on a label.
 */

const PAGE_SIZE = 10

const STATE_TONE: Record<string, Tone> = { pending: "orange", creating: "blue", created: "green", failed: "red", unknown: "red", skipped: "grey" }

export function ReturnStateBadge({ ret }: { ret: Pick<ReturnDto, "state" | "expired"> }) {
  const { t } = useTranslation("inpost")
  if (ret.state === "created" && ret.expired) return <ToneBadge tone="grey">{t("returns.expired")}</ToneBadge>
  return <ToneBadge tone={STATE_TONE[ret.state] ?? "grey"}>{t(`returns.state.${ret.state}`)}</ToneBadge>
}

/** The drop-off code, big, with a copy button: the customer types it at the Paczkomat. */
export function DropOffCode({ code, size = "large" }: { code: string; size?: "large" | "small" }) {
  const { t } = useTranslation("inpost")
  const shown = code.length === 9 ? `${code.slice(0, 3)} ${code.slice(3, 6)} ${code.slice(6)}` : code
  return (
    <span className="inline-flex items-center gap-x-2" title={t("returns.codeHint")}>
      <span className={size === "large" ? "font-mono text-2xl font-semibold tracking-wider text-ui-fg-base tabular-nums" : "txt-compact-small-plus font-mono tabular-nums text-ui-fg-base"}>{shown}</span>
      <Copy content={code} className="text-ui-fg-muted" />
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* The plan: read it, then create                                      */
/* ------------------------------------------------------------------ */

function PlanPart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-2 rounded-lg border border-ui-border-base px-4 py-3">
      <Text size="xsmall" weight="plus" className="text-ui-fg-muted">
        {title}
      </Text>
      {children}
    </div>
  )
}

/** The plan of an InPost return for an order (and a Medusa return), read before anything is sent; Create sends exactly this plan. */
export function ReturnPlanDrawer({ orderId, returnId, displayId, lang, onClose, onSettings }: { orderId: string; returnId: string | null; displayId?: number | null; lang: string; onClose: () => void; onSettings?: () => void }) {
  const { t } = useTranslation("inpost")
  const [method, setMethod] = useState<ReturnMethod>("code")
  const [showRequest, setShowRequest] = useState(false)
  const q = useInpostReturnPlan(orderId, returnId, method)
  const create = useInpostReturnCreate()
  const data = q.data
  const plan = data?.plan
  const blocked = Boolean(data?.existing && data.existing.state !== "pending")
  const canCreate = Boolean(plan?.ok && data?.writerArmed && !blocked)

  const onCreate = async () => {
    if (!plan) return
    try {
      await create.mutateAsync({ orderId, returnId, method, planHash: plan.hash })
      toast.success(data?.mode === "demo" ? t("returns.toast.createdDemo") : t("returns.toast.created"))
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
      void q.refetch()
    }
  }

  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content className="max-w-2xl">
        <Drawer.Header>
          <Drawer.Title className="flex flex-wrap items-center gap-2">
            {t("returns.plan.title")}
            {data?.mode === "demo" ? <ToneBadge tone="blue">{t("demo.badge")}</ToneBadge> : null}
          </Drawer.Title>
          <Drawer.Description>{t("returns.plan.subtitle", { order: displayId ?? orderId })}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-3 overflow-y-auto">
          {q.isLoading ? <KitLoading label={t("returns.plan.loading")} /> : null}
          {q.isError ? (
            <InlineTip variant="error" label={t("returns.plan.title")}>
              {errorMessage(q.error)}
            </InlineTip>
          ) : null}
          {blocked && data?.existing ? (
            <InlineTip variant="warning" label={t("returns.plan.exists")}>
              {t("returns.plan.existsText", { state: t(`returns.state.${data.existing.state}`) })}
            </InlineTip>
          ) : null}
          {plan ? (
            <>
              {plan.problems.length > 0 ? (
                <InlineTip variant="error" label={t("plan.problems")}>
                  <ProblemList items={plan.problems} />
                </InlineTip>
              ) : null}
              <PlanPart title={t("returns.plan.method")}>
                <div role="radiogroup" className="flex flex-wrap gap-2">
                  {(["code", "label"] as const).map((m) => (
                    <Button key={m} type="button" role="radio" aria-checked={method === m} size="small" variant={method === m ? "primary" : "secondary"} onClick={() => setMethod(m)}>
                      {t(`returns.method.${m}`)}
                    </Button>
                  ))}
                </div>
                <Text size="xsmall" className="text-ui-fg-muted">
                  {t(`returns.method.${method}Hint`)}
                </Text>
              </PlanPart>
              <PlanPart title={t("returns.plan.sender")}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Fact label={t("plan.name")}>{plan.sender.name || <span className="text-ui-fg-muted">{t("plan.none")}</span>}</Fact>
                  <Fact label={t("plan.phone")} mono>
                    {plan.sender.phone ?? <span className="font-sans text-ui-tag-red-text">{t("plan.missing")}</span>}
                  </Fact>
                  <Fact label={t("plan.email")} mono>
                    {plan.sender.email ?? <span className="font-sans text-ui-tag-red-text">{t("plan.missing")}</span>}
                  </Fact>
                  <Fact label={t("returns.plan.origin")}>{plan.originCountry ?? t("returns.plan.originAccount")}</Fact>
                </div>
                {plan.sender.sample ? (
                  <span className="w-fit">
                    <ToneBadge tone="purple">{t("plan.sampleContact")}</ToneBadge>
                  </span>
                ) : null}
              </PlanPart>
              <PlanPart title={t("returns.plan.return")}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Fact label={t("plan.reference")} mono>
                    {plan.reference}
                  </Fact>
                  <Fact label={t("returns.plan.expiry")}>{plan.expirationDate ? fmtDateTime(plan.expirationDate, lang) : t("returns.plan.expiryAccount")}</Fact>
                  <Fact label={t("returns.plan.destination")}>{t("returns.plan.destinationAccount")}</Fact>
                  {returnId ? (
                    <Fact label={t("returns.plan.medusaReturn")} mono>
                      {returnId}
                    </Fact>
                  ) : null}
                </div>
              </PlanPart>
              {plan.warnings.length > 0 ? (
                <PlanPart title={t("plan.warnings")}>
                  <ProblemList items={plan.warnings} tone="warning" kind="warning" />
                </PlanPart>
              ) : null}
              {plan.request ? (
                <div className="flex flex-col gap-y-2">
                  <Button size="small" variant="transparent" className="w-fit" onClick={() => setShowRequest(!showRequest)}>
                    {showRequest ? t("plan.hideRequest") : t("plan.showRequest")}
                  </Button>
                  {showRequest ? (
                    <pre className="max-h-[40vh] overflow-auto rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-2 font-mono text-[11px] leading-[18px] text-ui-fg-subtle">{JSON.stringify(plan.request, null, 2)}</pre>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
          {data && !data.writerArmed ? (
            <InlineTip variant="info" label={t("returns.plan.notArmed")}>
              <span className="flex flex-col gap-y-2">
                <span>{t("returns.plan.armHint")}</span>
                {onSettings ? (
                  <button type="button" className="txt-compact-small-plus w-fit text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={onSettings}>
                    {t("plan.openWriters")}
                  </button>
                ) : null}
              </span>
            </InlineTip>
          ) : null}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.close")}
            </Button>
          </Drawer.Close>
          <Button size="small" variant="primary" disabled={!canCreate} isLoading={create.isPending} onClick={() => void onCreate()}>
            <PaperPlane />
            {data?.mode === "demo" ? t("returns.plan.confirmDemo") : t("returns.plan.confirm")}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/* ------------------------------------------------------------------ */
/* What a person may do with one return                                */
/* ------------------------------------------------------------------ */

export function ReturnActions({ ret, lang, writers, onSettings, layout = "row" }: { ret: ReturnDto; lang: string; writers: Record<string, WriterDto> | undefined; onSettings?: () => void; layout?: "row" | "buttons" }) {
  const { t } = useTranslation("inpost")
  const prompt = usePrompt()
  const [planOpen, setPlanOpen] = useState(false)
  const refresh = useInpostReturnRefresh()
  const retry = useInpostReturnRetry()
  const skip = useInpostReturnSkip()
  const armed = Boolean(writers?.returns?.armed)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.success(ok)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const onRetry = async () => {
    if (ret.state === "unknown") {
      const yes = await prompt({ title: t("returns.retryUnknown.title"), description: t("returns.retryUnknown.text"), confirmText: t("returns.retryUnknown.confirm"), cancelText: t("cancel.back") })
      if (!yes) return
    }
    await run(() => retry.mutateAsync({ id: ret.id, checked: ret.state === "unknown" }), t("returns.toast.retried"))
  }
  const onSkip = async () => {
    const yes = await prompt({ title: t("returns.skip.title"), description: t("returns.skip.text"), confirmText: t("returns.skip.confirm"), cancelText: t("cancel.back") })
    if (yes) await run(() => skip.mutateAsync({ id: ret.id }), t("returns.toast.skipped"))
  }

  const actions: RowAction[] = [
    { key: "create", label: armed ? t("returns.actions.create") : t("returns.actions.createNotArmed"), icon: <PaperPlane />, hidden: !ret.actions.create, onClick: () => setPlanOpen(true) },
    { key: "label", label: t("returns.actions.label"), icon: <ArrowDownTray />, hidden: !ret.actions.label, onClick: () => window.open(returnLabelUrl(ret.id), "_blank", "noopener") },
    { key: "retry", label: t("actions.retry"), icon: <ArrowUturnLeft />, hidden: !ret.actions.retry, loading: retry.isPending, onClick: () => void onRetry() },
    { key: "refresh", label: t("returns.actions.refresh"), icon: <ArrowPath />, hidden: !ret.actions.refresh, loading: refresh.isPending, onClick: () => void run(() => refresh.mutateAsync({ id: ret.id }), t("returns.toast.refreshed")) },
    { key: "track", label: t("actions.track"), icon: <ArrowUpRightOnBox />, hidden: !ret.trackingUrl, href: ret.trackingUrl ?? undefined, external: true },
    { key: "skip", label: t("returns.actions.skip"), icon: <ArrowRightOnRectangle />, hidden: !ret.actions.skip, onClick: () => void onSkip() },
  ]
  const shown = actions.filter((a) => !a.hidden)
  const main = ["create", "label", "retry"].map((k) => shown.find((a) => a.key === k)).find(Boolean)

  return (
    <>
      {layout === "buttons" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {shown.map((a) =>
            a.href ? (
              <a key={a.key} href={a.href} target="_blank" rel="noreferrer" className="txt-compact-small-plus inline-flex items-center gap-x-1 px-2 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                {a.label}
                <ArrowUpRightOnBox className="h-3.5 w-3.5" />
              </a>
            ) : (
              <Button key={a.key} size="small" variant={a === main ? "primary" : "secondary"} disabled={a.disabled} isLoading={a.loading} onClick={a.onClick} className="whitespace-nowrap">
                {a.icon}
                {a.label}
              </Button>
            ),
          )}
        </div>
      ) : (
        <div className="flex items-center justify-end gap-1.5">
          {main ? (
            <Button size="small" variant="secondary" isLoading={main.loading} title={main.label} onClick={main.onClick} className="whitespace-nowrap">
              {main.icon}
              {main.key === "create" ? t("actions.create") : main.label}
            </Button>
          ) : null}
          <RowActions actions={shown.filter((a) => a !== main)} />
        </div>
      )}
      {planOpen ? <ReturnPlanDrawer orderId={ret.orderId} returnId={ret.returnId} displayId={ret.displayId} lang={lang} onClose={() => setPlanOpen(false)} onSettings={onSettings} /> : null}
    </>
  )
}

/** What the row says under its state: the error, the expiry, who marked it. */
function ReturnNotes({ ret, lang }: { ret: ReturnDto; lang: string }) {
  const { t } = useTranslation("inpost")
  return (
    <>
      {ret.error && (ret.state === "failed" || ret.state === "unknown") ? (
        <Text size="xsmall" className="text-ui-tag-red-text">
          {nb(ret.error)}
        </Text>
      ) : null}
      {ret.state === "unknown" ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("returns.unknownHint")}
        </Text>
      ) : null}
      {ret.state === "skipped" ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("returns.skippedNote")}
        </Text>
      ) : null}
      {ret.state === "created" && ret.expiresAt ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t(ret.expired ? "returns.expiredAt" : "returns.expiresAt", { time: fmtDateTime(ret.expiresAt, lang) })}
        </Text>
      ) : null}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* The list on the InPost page                                         */
/* ------------------------------------------------------------------ */

const FILTERS: ReturnFilter[] = ["all", "open", "attention", "created", "skipped"]
const FILTER_ICON: Record<ReturnFilter, ReactNode> = { all: <ListBullet />, open: <Clock />, attention: <ExclamationCircle />, created: <CheckCircle />, skipped: <MinusCircle /> }

function returnCount(s: StatusResponse, f: ReturnFilter): number {
  return f === "all" ? s.returns.counts.all : s.returns.counts[f]
}

export function ReturnsSection({ status, lang, poll, onSettings }: { status: StatusResponse; lang: string; poll: boolean; onSettings: () => void }) {
  const { t } = useTranslation("inpost")
  const [filter, setFilter] = useState<ReturnFilter>("all")
  const [search, setSearch] = useState("")
  const q = useDebouncedValue(search.trim())
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])
  const list = useInpostReturns(filter, q, page * PAGE_SIZE, PAGE_SIZE, poll)
  const rows = list.data?.returns ?? []
  const count = list.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const fresh = filter === "all" && !q
  const r = status.returns

  return (
    <Section
      id="inpost-returns"
      icon={<ArrowUturnLeft />}
      title={t("returns.title")}
      badges={!r.configured ? <ToneBadge tone="orange">{t("returns.notConfigured")}</ToneBadge> : status.writers.returns.armed ? <ToneBadge tone="orange">{t("writers.armed")}</ToneBadge> : <ToneBadge>{t("mode.readOnly")}</ToneBadge>}
      pointsLabel={t("returns.subtitle")}
      points={[
        { icon: <Key />, text: t("returns.points.code") },
        { icon: <ArrowDownTray />, text: t("returns.points.label") },
        { icon: <ShieldCheck />, text: t("returns.points.once"), tone: "green" },
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("returns.search")} className="sm:w-72" />}
    >
      <FilterBar>
        {FILTERS.map((f, i) => (
          <span key={f} className="contents">
            {i === 1 || i === 3 ? <FilterDivider /> : null}
            <FilterButton icon={FILTER_ICON[f]} label={t(`returns.filter.${f}`)} count={returnCount(status, f)} attention={f === "attention" || f === "open"} active={filter === f} onClick={() => setFilter(filter === f ? "all" : f)} />
          </span>
        ))}
      </FilterBar>
      <KitFetchingBar active={list.isFetching && !list.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>
                <span className="inline-flex items-center gap-x-1.5">
                  <MedusaMark className="h-3.5 w-3.5 text-ui-fg-muted" />
                  {t("parcels.col.order")}
                </span>
              </Table.HeaderCell>
              <Table.HeaderCell>{t("parcels.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("returns.col.code")}</Table.HeaderCell>
              <Table.HeaderCell>{t("parcels.col.tracking")}</Table.HeaderCell>
              <Table.HeaderCell>{t("returns.col.expiry")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.isLoading ? <KitSkeletonRows cols={6} rows={3} /> : null}
            {!list.isLoading && rows.length === 0 ? (
              <EmptyTableRow cols={6} icon={<ArrowUturnLeft />} title={fresh ? t("returns.emptyAll") : t("parcels.empty")} points={fresh ? [{ icon: <PaperPlane />, text: t("returns.emptyHint") }] : undefined} />
            ) : null}
            {rows.map((ret) => (
              <Table.Row key={ret.id} className="align-top [&_td]:py-2.5">
                <Table.Cell className="max-w-[200px]">
                  <div className="flex flex-col items-start gap-y-1">
                    <OrderCell orderId={ret.orderId} displayId={ret.displayId} />
                    {ret.returnId ? (
                      <Text size="xsmall" className="font-mono text-ui-fg-muted">
                        {ret.returnId}
                      </Text>
                    ) : null}
                    {ret.demo ? <ToneBadge tone="purple">{t("parcels.sample")}</ToneBadge> : null}
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex max-w-[280px] flex-col items-start gap-y-1">
                    <ReturnStateBadge ret={ret} />
                    {ret.method ? <ToneBadge>{t(`returns.method.${ret.method}`)}</ToneBadge> : null}
                    <ReturnNotes ret={ret} lang={lang} />
                  </div>
                </Table.Cell>
                <Table.Cell>{ret.dropOffCode ? <DropOffCode code={ret.dropOffCode} size="small" /> : <span className="text-ui-fg-muted">{ret.state === "created" ? t("returns.noCode") : ""}</span>}</Table.Cell>
                <Table.Cell>
                  <TrackingCell parcel={ret} />
                  {ret.shortNumber ? (
                    <Text size="xsmall" className="font-mono text-ui-fg-muted">
                      {t("returns.short", { number: ret.shortNumber })}
                    </Text>
                  ) : null}
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap">{ret.expiresAt ? fmtDateTime(ret.expiresAt, lang) : ""}</Table.Cell>
                <Table.Cell className="text-right">
                  <ReturnActions ret={ret} lang={lang} writers={status.writers} onSettings={onSettings} />
                </Table.Cell>
              </Table.Row>
            ))}
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
        previousPage={() => setPage((x) => Math.max(0, x - 1))}
        nextPage={() => setPage((x) => x + 1)}
        translations={{ of: t("pagination.of"), results: t("pagination.results"), pages: t("pagination.pages"), prev: t("pagination.prev"), next: t("pagination.next") }}
      />
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* The order widget                                                    */
/* ------------------------------------------------------------------ */

/** "InPost return" on the order page: each return of the order, and a button to create one from its plan. */
export function OrderReturns({ orderId, displayId, returns, writers, configured, lang }: { orderId: string; displayId: number | null; returns: ReturnDto[]; writers: Record<string, WriterDto> | undefined; configured: boolean; lang: string }) {
  const { t } = useTranslation("inpost")
  const [planOpen, setPlanOpen] = useState(false)
  const armed = Boolean(writers?.returns?.armed)
  /* A return for the order itself (no Medusa return) exists once; Medusa returns bring their own rows. */
  const own = returns.some((r) => !r.returnId)
  return (
    <div className="flex flex-col gap-y-3 px-6 py-4">
      <div className="flex items-center justify-between gap-x-2">
        <Text size="small" weight="plus" className="flex items-center gap-x-1.5 text-ui-fg-base">
          <ArrowUturnLeft className="text-ui-fg-muted" />
          {t("returns.widget.title")}
        </Text>
        {!own ? (
          <Button size="small" variant="secondary" disabled={!configured} onClick={() => setPlanOpen(true)} title={!configured ? t("returns.notConfigured") : undefined}>
            <PaperPlane />
            {armed ? t("returns.widget.create") : t("returns.widget.plan")}
          </Button>
        ) : null}
      </div>
      {!configured ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("returns.widget.notConfigured")}
        </Text>
      ) : !armed && returns.length === 0 ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("returns.widget.notArmed")}
        </Text>
      ) : null}
      {returns.length === 0 && configured ? <EmptyState compact icon={<ArrowUturnLeft />} title={t("returns.widget.none")} /> : null}
      {returns.map((ret) => (
        <div key={ret.id} className="flex flex-col gap-y-2 rounded-lg border border-ui-border-base px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <ReturnStateBadge ret={ret} />
            {ret.method ? <ToneBadge>{t(`returns.method.${ret.method}`)}</ToneBadge> : null}
          </div>
          {ret.dropOffCode ? (
            <div className="flex flex-col gap-y-1">
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("returns.widget.code")}
              </Text>
              <DropOffCode code={ret.dropOffCode} />
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("returns.codeHint")}
              </Text>
            </div>
          ) : null}
          {ret.trackingNumber ? (
            <div className="flex items-start justify-between gap-x-3">
              <Text size="small" className="shrink-0 text-ui-fg-subtle">
                {t("detail.tracking")}
              </Text>
              <TrackingCell parcel={ret} />
            </div>
          ) : null}
          {ret.returnId ? (
            <Text size="xsmall" className="font-mono text-ui-fg-muted">
              {t("returns.widget.medusaReturn", { id: ret.returnId })}
            </Text>
          ) : null}
          <ReturnNotes ret={ret} lang={lang} />
          <ReturnActions ret={ret} lang={lang} writers={writers} layout="buttons" />
        </div>
      ))}
      {planOpen ? <ReturnPlanDrawer orderId={orderId} returnId={null} displayId={displayId} lang={lang} onClose={() => setPlanOpen(false)} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Settings: the Returns API                                           */
/* ------------------------------------------------------------------ */

export function ReturnsAccountSection({ status: s, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("inpost")
  const check = useInpostReturnsCheck()
  const demo = s.mode === "demo"
  const r = s.returns
  const result = check.data?.result ?? r.lastCheck

  const onCheck = async () => {
    try {
      const res = await check.mutateAsync()
      if (res.result.ok) toast.success(t("returns.toast.checkOk"))
      else toast.error(t("toast.checkFailed", { error: res.result.error ?? "?" }))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const value = (set: boolean) => (demo ? "-" : set ? t("account.tokenSet") : <span className="text-ui-tag-red-text">{t("account.notSet")}</span>)

  return (
    <Section
      icon={<ArrowUturnLeft />}
      title={t("returns.account.title")}
      badges={<ToneBadge tone={r.configured ? "green" : "orange"}>{r.configured ? t("returns.account.configured") : t("returns.notConfigured")}</ToneBadge>}
      pointsLabel={demo ? t("returns.account.demoNote") : t("returns.account.subtitle")}
      points={[
        demo && { icon: <Beaker />, text: t("account.points.demo"), tone: "blue" },
        { icon: <Key />, text: t("returns.account.points.oauth") },
        { icon: <LockClosedSolid />, text: t("returns.account.points.secret"), tone: "green" },
      ]}
      actions={
        <Button size="small" variant="secondary" isLoading={check.isPending} disabled={!r.configured} onClick={() => void onCheck()}>
          <ShieldCheck />
          {t("returns.account.check")}
        </Button>
      }
    >
      {!demo && r.missing.length > 0 ? (
        <div className="px-6 py-4">
          <InlineTip variant="warning" label={t("returns.account.missingLabel")}>
            {t("returns.account.missing", { missing: r.missing.join(", ") })}
          </InlineTip>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label={t("returns.account.environment")}>
          <ToneBadge tone={r.environment === "stage" ? "orange" : "green"}>{t(`returns.account.env.${r.environment}`)}</ToneBadge>
          <span className="block text-ui-fg-muted txt-compact-xsmall">{r.host.replace(/^https:\/\//, "")}</span>
        </Fact>
        <Fact label={t("returns.account.clientId")}>{value(r.clientIdSet)}</Fact>
        <Fact label={t("returns.account.secret")}>{value(r.secretSet)}</Fact>
        <Fact label={t("returns.account.organization")} mono>
          {demo ? "-" : (r.organizationId ?? <span className="font-sans text-ui-tag-red-text">{t("account.notSet")}</span>)}
        </Fact>
        <Fact label={t("returns.account.expiry")}>{r.expirationDays ? t("returns.account.expiryDays", { count: r.expirationDays }) : t("returns.plan.expiryAccount")}</Fact>
        <Fact label={t("account.lastCheck")}>
          {result ? (
            result.ok ? (
              <span>
                {t("returns.account.checkOk", { seconds: result.expiresIn ?? 0 })}
                <span className="block text-ui-fg-muted txt-compact-xsmall">{fmtDateTime(result.checkedAt, lang)}</span>
              </span>
            ) : (
              <span className="text-ui-tag-red-text">{result.error}</span>
            )
          ) : (
            t("account.never")
          )}
        </Fact>
        <Fact label={t("returns.account.writer")}>
          <ToneBadge tone={s.writers.returns.armed ? "orange" : s.writers.returns.allowed ? "grey" : "red"}>
            {s.writers.returns.armed ? t("writers.armed") : s.writers.returns.allowed ? t("writers.disarmed") : t("writers.blocked")}
          </ToneBadge>
        </Fact>
      </div>
    </Section>
  )
}
