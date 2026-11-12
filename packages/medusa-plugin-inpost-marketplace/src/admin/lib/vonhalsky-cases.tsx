import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowPath, ArrowUpRightMini, ArrowUturnLeft, CheckCircle, Clock, Envelope, ExclamationCircle, History as HistoryIcon, ListBullet, Phone, ReceiptPercent, Sparkles, User, XCircle } from "@medusajs/icons"
import { Button, Drawer, InlineTip, Input, Table, Text, Textarea, toast, usePrompt } from "@medusajs/ui"
import type { CaseDetailResponse, CaseDto, CaseFilter, StatusResponse } from "../../modules/vonhalsky/lib/contract"
import { errorMessage, useAcceptReturn, useRejectReturn, useResolveClaim, useRetryRefund, useSimulateCase, useVonHalskyCase, useVonHalskyCases, type ClaimResolution } from "./vonhalsky-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, ToneBadge, useDebouncedValue } from "./vonhalsky-blocks"
import { KitFetchingBar, KitLoading, KitSkeletonRows } from "./vonhalsky-kit"
import { CaseKindBadge, CaseStatusBadge, EventList, Fact, Field, SELECT, fmtDate, fmtDateTime, fmtMoney, parseAmount } from "./vonhalsky-ui"

export const CASE_FILTERS: CaseFilter[] = ["all", "open", "return", "claim", "refund"]
const PAGE = 50
const COLS = 9

const FILTER_ICON: Record<CaseFilter, ReactNode> = {
  all: <ListBullet />,
  open: <ExclamationCircle />,
  return: <ArrowUturnLeft />,
  claim: <XCircle />,
  refund: <ReceiptPercent />,
}
const FILTER_GROUPS: CaseFilter[][] = [["all"], ["open"], ["return", "claim", "refund"]]
const RESOLUTIONS: ClaimResolution[] = ["full", "partial", "reject"]

/** What the seller can still decide on a case (the server checks the same). */
function decisionOf(c: CaseDto): "return" | "claim" | "refund" | null {
  if (c.kind === "return" && c.status === "NEW") return "return"
  if (c.kind === "claim" && !c.sub_status) return "claim"
  if (c.kind === "refund" && c.sub_status === "DECLINED") return "refund"
  return null
}

/** After sale: returns, claims and refunds as the sync saved them, with a live detail and the seller's decisions. */
export function CasesSection({ status: s, lang, initialQuery }: { status: StatusResponse; lang: string; initialQuery: string }) {
  const { t } = useTranslation("vonhalsky")
  const [filter, setFilter] = useState<CaseFilter>(s.counts.cases_open > 0 ? "open" : "all")
  const [input, setInput] = useState(initialQuery)
  const q = useDebouncedValue(input.trim())
  const [offset, setOffset] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  useEffect(() => setOffset(0), [filter, q])

  const list = useVonHalskyCases(filter, q, offset, PAGE)
  const rows = list.data?.cases ?? []
  const count = list.data?.count ?? 0
  const simulate = useSimulateCase()
  const demo = s.mode === "demo"
  const fresh = filter === "all" && !q
  const pick = (f: CaseFilter) => setFilter(filter === f ? "all" : f)

  const onSimulate = async (kind: "return" | "claim") => {
    try {
      const c = await simulate.mutateAsync(kind)
      toast.success(t("toast.caseSimulated", { kind: t(`caseKind.${c.kind}`) }))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Section
      id="vonhalsky-cases"
      icon={<ArrowUturnLeft />}
      title={t("cases.title")}
      pointsLabel={t("cases.subtitle")}
      points={[
        { icon: <ArrowUturnLeft />, text: t("cases.points.kinds") },
        { icon: <Clock />, text: t("cases.points.deadline") },
        { icon: <User />, text: t("cases.points.contact"), tone: "green" },
      ]}
      actions={
        <>
          <SearchInput value={input} onChange={setInput} placeholder={t("cases.search")} className="sm:w-64" />
          {demo ? (
            <>
              <Button size="small" variant="secondary" isLoading={simulate.isPending && simulate.variables === "return"} onClick={() => void onSimulate("return")}>
                <Sparkles />
                {t("actions.simulateReturn")}
              </Button>
              <Button size="small" variant="secondary" isLoading={simulate.isPending && simulate.variables === "claim"} onClick={() => void onSimulate("claim")}>
                <Sparkles />
                {t("actions.simulateClaim")}
              </Button>
            </>
          ) : null}
        </>
      }
    >
      <FilterBar>
        {FILTER_GROUPS.map((group, i) => (
          <span key={group.join()} className="contents">
            {i > 0 ? <FilterDivider /> : null}
            {group.map((f) => (
              <FilterButton key={f} icon={FILTER_ICON[f]} label={t(`caseFilter.${f}`)} count={f === "open" ? s.counts.cases_open : undefined} attention={f === "open"} active={filter === f} onClick={() => pick(f)} />
            ))}
          </span>
        ))}
      </FilterBar>
      <KitFetchingBar active={list.isFetching && !list.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("cases.kind")}</Table.HeaderCell>
              <Table.HeaderCell>{t("cases.number")}</Table.HeaderCell>
              <Table.HeaderCell>{t("cases.order")}</Table.HeaderCell>
              <Table.HeaderCell>{t("cases.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("cases.reason")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("cases.amount")}</Table.HeaderCell>
              <Table.HeaderCell>{t("cases.opened")}</Table.HeaderCell>
              <Table.HeaderCell>{t("cases.expires")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.isLoading ? <KitSkeletonRows cols={COLS} rows={5} /> : null}
            {!list.isLoading && rows.length === 0 ? (
              <EmptyTableRow cols={COLS} icon={FILTER_ICON[filter]} title={fresh ? t("cases.empty") : t("cases.emptyFiltered")} points={fresh && demo ? [{ icon: <Sparkles />, text: t("cases.emptyDemo") }] : undefined} />
            ) : null}
            {rows.map((c) => (
              <Table.Row key={c.id} className="cursor-pointer [&_td]:py-2.5 align-top" onClick={() => setOpenId(c.id)}>
                <Table.Cell>
                  <span className="flex flex-wrap items-center gap-1">
                    <CaseKindBadge kind={c.kind} />
                    {c.open ? <ToneBadge tone="orange">{t("cases.toDecide")}</ToneBadge> : null}
                    {c.demo ? <ToneBadge tone="purple">{t("demo.badge")}</ToneBadge> : null}
                  </span>
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap font-mono txt-compact-small">{c.display_id ?? c.remote_id}</Table.Cell>
                <Table.Cell onClick={(e) => e.stopPropagation()}>
                  <OrderRef item={c} />
                </Table.Cell>
                <Table.Cell>
                  <CaseStatusBadge item={c} />
                </Table.Cell>
                <Table.Cell>
                  <Text size="xsmall" className="max-w-[220px] text-ui-fg-subtle">
                    {c.reason ?? ""}
                  </Text>
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtMoney(c.amount, "pln", lang)}</Table.Cell>
                <Table.Cell className="whitespace-nowrap tabular-nums">{fmtDate(c.opened_at, lang)}</Table.Cell>
                <Table.Cell className="whitespace-nowrap tabular-nums">
                  <span className={c.open && c.expires_at ? "text-ui-tag-orange-text" : undefined}>{fmtDate(c.expires_at, lang)}</span>
                </Table.Cell>
                <Table.Cell className="text-right">
                  <RowActions actions={[{ key: "open", label: t("actions.openCase"), icon: <HistoryIcon />, onClick: () => setOpenId(c.id) }]} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
      {count > PAGE ? (
        <Table.Pagination
          count={count}
          pageSize={PAGE}
          pageIndex={Math.floor(offset / PAGE)}
          pageCount={Math.max(1, Math.ceil(count / PAGE))}
          canPreviousPage={offset > 0}
          canNextPage={offset + PAGE < count}
          previousPage={() => setOffset(Math.max(0, offset - PAGE))}
          nextPage={() => setOffset(offset + PAGE)}
          translations={{ of: t("pagination.of"), results: t("pagination.results"), pages: t("pagination.pages"), prev: t("pagination.prev"), next: t("pagination.next") }}
        />
      ) : null}
      {openId ? <CaseDrawer id={openId} lang={lang} onDone={() => setOpenId(null)} /> : null}
    </Section>
  )
}

/** The Medusa order of the case when it was imported, else the marketplace order id. */
function OrderRef({ item: c }: { item: Pick<CaseDto, "order_id" | "display_order_id" | "marketplace_order_id"> }) {
  const { t } = useTranslation("vonhalsky")
  if (c.order_id) {
    return (
      <Link to={`/orders/${c.order_id}`} className="txt-compact-small-plus inline-flex items-center gap-x-0.5 whitespace-nowrap text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
        {c.display_order_id !== null ? `#${c.display_order_id}` : t("actions.openOrder")}
        <ArrowUpRightMini />
      </Link>
    )
  }
  return <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{c.marketplace_order_id ?? t("cases.noOrder")}</span>
}

/** One case, read live: the lines, the buyer contact (shown, not kept), the history and the decision the seller can make. */
function CaseDrawer({ id, lang, onDone }: { id: string; lang: string; onDone: () => void }) {
  const { t } = useTranslation("vonhalsky")
  const detail = useVonHalskyCase(id)
  const d = detail.data
  return (
    <Drawer open onOpenChange={(open) => (open ? undefined : onDone())}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{d ? t("caseDrawer.title", { kind: t(`caseKind.${d.case.kind}`), number: d.case.display_id ?? d.case.remote_id }) : t("caseDrawer.loading")}</Drawer.Title>
          <Drawer.Description className="txt-small text-ui-fg-subtle">{t("caseDrawer.text")}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-5 overflow-y-auto">
          {detail.isLoading ? <KitLoading label={t("caseDrawer.loading")} /> : null}
          {detail.isError ? (
            <InlineTip variant="error" label={t("caseDrawer.failed")}>
              {errorMessage(detail.error)}
            </InlineTip>
          ) : null}
          {d ? <CaseBody detail={d} lang={lang} /> : null}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.close")}
            </Button>
          </Drawer.Close>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

function CaseBody({ detail, lang }: { detail: CaseDetailResponse; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const c = detail.case
  const decision = decisionOf(c)
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <CaseKindBadge kind={c.kind} />
        <CaseStatusBadge item={c} />
        {c.demo ? <ToneBadge tone="purple">{t("demo.badge")}</ToneBadge> : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Fact label={t("cases.order")}>
          <OrderRef item={c} />
        </Fact>
        <Fact label={t("cases.amount")}>{fmtMoney(c.amount, "pln", lang) || t("orders.unknown")}</Fact>
        <Fact label={t("cases.opened")}>{fmtDateTime(c.opened_at, lang) || t("orders.unknown")}</Fact>
        <Fact label={t("cases.expires")}>{fmtDateTime(c.expires_at, lang) || t("orders.unknown")}</Fact>
        <Fact label={t("cases.reason")}>{c.reason ?? t("orders.unknown")}</Fact>
        <Fact label={t("cases.source")}>{c.source ?? t("orders.unknown")}</Fact>
        {c.decided_at ? <Fact label={t("cases.decided")}>{fmtDateTime(c.decided_at, lang)}</Fact> : null}
        {c.refund_id ? (
          <Fact label={t("cases.refundId")} mono>
            {c.refund_id}
          </Fact>
        ) : null}
      </div>
      {detail.description ? (
        <div className="flex flex-col gap-y-1.5">
          <Text size="small" weight="plus">
            {t("caseDrawer.buyerDescription")}
          </Text>
          <Text size="small" className="whitespace-pre-line rounded-md border border-ui-border-base px-3 py-2 text-ui-fg-subtle">
            {detail.description}
          </Text>
        </div>
      ) : null}
      <div className="flex flex-col gap-y-1.5">
        <Text size="small" weight="plus">
          {t("caseDrawer.lines")}
        </Text>
        {c.lines.length === 0 ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("caseDrawer.noLines")}
          </Text>
        ) : (
          <ul className="flex flex-col gap-y-1">
            {c.lines.map((l, i) => (
              <li key={`${l.offerId ?? "line"}-${i}`} className="flex flex-col rounded-md border border-ui-border-base px-3 py-2">
                <span className="txt-compact-small text-ui-fg-base">
                  {l.quantity} x {l.name ?? l.offerId ?? t("orders.unknown")}
                </span>
                <span className="txt-compact-xsmall text-ui-fg-muted">{[l.ean && `EAN ${l.ean}`, l.price && fmtMoney(l.price, "pln", lang), l.reason].filter(Boolean).join(", ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-y-1.5">
        <Text size="small" weight="plus">
          {t("caseDrawer.contact")}
        </Text>
        {detail.contact ? (
          <div className="flex flex-col gap-y-1">
            {detail.contact.name ? (
              <span className="txt-compact-small inline-flex items-center gap-x-1.5 text-ui-fg-base">
                <User className="text-ui-fg-muted" />
                {detail.contact.name}
              </span>
            ) : null}
            {detail.contact.email ? (
              <a href={`mailto:${detail.contact.email}`} className="txt-compact-small inline-flex items-center gap-x-1.5 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                <Envelope className="text-ui-fg-muted" />
                {detail.contact.email}
              </a>
            ) : null}
            {detail.contact.phone ? (
              <span className="txt-compact-small inline-flex items-center gap-x-1.5 text-ui-fg-base">
                <Phone className="text-ui-fg-muted" />
                {detail.contact.phone}
              </span>
            ) : null}
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("caseDrawer.contactNote")}
            </Text>
          </div>
        ) : (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("caseDrawer.noContact")}
          </Text>
        )}
      </div>
      {decision === "return" ? <ReturnDecision item={c} reasons={detail.rejectReasons} lang={lang} /> : null}
      {decision === "claim" ? <ClaimDecision item={c} /> : null}
      {decision === "refund" ? <RefundRetry item={c} lang={lang} /> : null}
      {!decision ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("caseDrawer.nothingToDecide")}
        </Text>
      ) : null}
      {c.events.length > 0 ? (
        <div className="flex flex-col gap-y-1.5">
          <Text size="small" weight="plus">
            {t("orders.events")}
          </Text>
          <EventList events={c.events} lang={lang} />
        </div>
      ) : null}
    </>
  )
}

/** A new return: accept it (the marketplace refunds the amount) or reject it with one of the marketplace's reasons. */
function ReturnDecision({ item: c, reasons, lang }: { item: CaseDto; reasons: CaseDetailResponse["rejectReasons"]; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const prompt = usePrompt()
  const accept = useAcceptReturn()
  const reject = useRejectReturn()
  const [value, setValue] = useState(c.amount ?? "")
  const [reasonId, setReasonId] = useState("")
  const amount = parseAmount(value)
  const onAccept = async () => {
    if (!amount) return
    const ok = await prompt({ title: t("confirm.acceptTitle"), description: t("confirm.acceptText", { amount: fmtMoney(amount, "pln", lang) }), confirmText: t("actions.acceptReturn"), cancelText: t("actions.cancel") })
    if (!ok) return
    try {
      await accept.mutateAsync({ id: c.id, amount })
      toast.success(t("toast.returnAccepted"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const onReject = async () => {
    const reason = reasons.find((r) => r.id === reasonId)
    if (!reason) return
    const ok = await prompt({ title: t("confirm.rejectTitle"), description: t("confirm.rejectText", { reason: reason.description ?? reason.code }), confirmText: t("actions.rejectReturn"), cancelText: t("actions.cancel"), variant: "danger" })
    if (!ok) return
    try {
      await reject.mutateAsync({ id: c.id, reasonId })
      toast.success(t("toast.returnRejected"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <div className="flex flex-col gap-y-4 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
      <Text size="small" weight="plus">
        {t("caseDrawer.decideReturn")}
      </Text>
      <Field label={t("caseDrawer.refundAmount")} hint={t("caseDrawer.refundAmountHint")} required>
        <Input size="small" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="49.99" />
      </Field>
      <Button size="small" variant="primary" className="self-start" isLoading={accept.isPending} disabled={!amount} onClick={() => void onAccept()}>
        <CheckCircle />
        {t("actions.acceptReturn")}
      </Button>
      <Field label={t("caseDrawer.rejectReason")}>
        <select className={SELECT} value={reasonId} onChange={(e) => setReasonId(e.target.value)} disabled={reasons.length === 0}>
          <option value="">{reasons.length === 0 ? t("caseDrawer.noReasons") : t("caseDrawer.chooseReason")}</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.description ?? r.code}
            </option>
          ))}
        </select>
      </Field>
      <Button size="small" variant="danger" className="self-start" isLoading={reject.isPending} disabled={!reasonId} onClick={() => void onReject()}>
        <XCircle />
        {t("actions.rejectReturn")}
      </Button>
    </div>
  )
}

/** An open claim: a full refund, a partial one or a rejection, with a note to the buyer. */
function ClaimDecision({ item: c }: { item: CaseDto }) {
  const { t } = useTranslation("vonhalsky")
  const prompt = usePrompt()
  const resolve = useResolveClaim()
  const [how, setHow] = useState<ClaimResolution>("full")
  const [description, setDescription] = useState("")
  const onResolve = async () => {
    const ok = await prompt({
      title: t("confirm.resolveTitle"),
      description: t("confirm.resolveText", { how: t(`resolution.${how}`) }),
      confirmText: t("actions.resolveClaim"),
      cancelText: t("actions.cancel"),
      variant: how === "reject" ? "danger" : "confirmation",
    })
    if (!ok) return
    try {
      await resolve.mutateAsync({ id: c.id, how, description: description.trim() })
      toast.success(t("toast.claimResolved"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <div className="flex flex-col gap-y-4 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
      <Text size="small" weight="plus">
        {t("caseDrawer.decideClaim")}
      </Text>
      <Field label={t("caseDrawer.how")}>
        <select className={SELECT} value={how} onChange={(e) => setHow(e.target.value as ClaimResolution)}>
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {t(`resolution.${r}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("caseDrawer.description")} hint={t("caseDrawer.descriptionHint")}>
        <Textarea rows={4} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Button size="small" variant={how === "reject" ? "danger" : "primary"} className="self-start" isLoading={resolve.isPending} onClick={() => void onResolve()}>
        <CheckCircle />
        {t("actions.resolveClaim")}
      </Button>
    </div>
  )
}

/** A refund whose payment was declined: ask the marketplace to pay it again. */
function RefundRetry({ item: c, lang }: { item: CaseDto; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const prompt = usePrompt()
  const retry = useRetryRefund()
  const onRetry = async () => {
    const ok = await prompt({ title: t("confirm.retryRefundTitle"), description: t("confirm.retryRefundText", { amount: fmtMoney(c.amount, "pln", lang) }), confirmText: t("actions.retryRefund"), cancelText: t("actions.cancel") })
    if (!ok) return
    try {
      await retry.mutateAsync(c.id)
      toast.success(t("toast.refundRetried"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <div className="flex flex-col gap-y-3 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
      <Text size="small" weight="plus">
        {t("caseDrawer.declined")}
      </Text>
      <Button size="small" variant="primary" className="self-start" isLoading={retry.isPending} onClick={() => void onRetry()}>
        <ArrowPath />
        {t("actions.retryRefund")}
      </Button>
    </div>
  )
}
