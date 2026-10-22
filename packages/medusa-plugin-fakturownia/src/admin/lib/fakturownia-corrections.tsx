import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArchiveBox, ArrowUturnLeft, Beaker, CheckCircle, CheckCircleSolid, Clock, DocumentText, Eye, ListBullet, PencilSquare, ShieldCheck, XCircle } from "@medusajs/icons"
import { Button, Drawer, InlineTip, Input, Label, Table, Text, Textarea, toast } from "@medusajs/ui"
import type { CorrectionPlanDto, PlanFilter, StatusResponse, WriterDto } from "../../modules/fakturownia/lib/contract"
import { errorMessage, useFakturowniaCorrections, useFakturowniaPlanAction } from "./fakturownia-api"
import { EmptyState, FilterBar, FilterButton, FilterDivider, Section, SearchInput, ToneBadge, useDebouncedValue } from "./fakturownia-blocks"
import { KitLoading } from "./fakturownia-kit"
import { DocumentStatusBadge, KindBadge, PlanStatusBadge, StoreOrderCell, WriterBadge, fmtDateTime, fmtDelta, fmtMoney, fmtQuantity } from "./fakturownia-ui"

const PAGE = 10

const FILTER_ICON: Record<PlanFilter, ReactNode> = {
  all: <ListBullet />,
  open: <Clock />,
  approved: <CheckCircle />,
  issued: <DocumentText />,
  closed: <ArchiveBox />,
}

/**
 * CORRECTIONS: what changed after a document was issued (a return, a
 * refund, an order edit, a cancellation), the positions before and after,
 * and the decision of a person. An approved plan becomes a correction
 * invoice once, when the corrections writer is on.
 */
export function CorrectionsSection({
  status,
  lang,
  onOpenDocument,
  initialFilter = "open",
  focus = false,
}: {
  status: StatusResponse
  lang: string
  onOpenDocument: (id: string) => void
  /** A deep link (`?plans=open`): the filter to start with, and the section scrolled into view. */
  initialFilter?: PlanFilter
  focus?: boolean
}) {
  const { t } = useTranslation("fakturownia")
  const [filter, setFilter] = useState<PlanFilter>(initialFilter)
  const section = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (focus) section.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [focus])
  const [search, setSearch] = useState("")
  const q = useDebouncedValue(search.trim())
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])
  const plans = useFakturowniaCorrections(filter, q, page * PAGE, PAGE, false)
  const rows = plans.data?.plans ?? []
  const count = plans.data?.count ?? 0
  const writer = status.writers.corrections
  const off = status.options.corrections === "off"
  const c = status.counts
  /* A second click on the active filter clears it (back to all plans). */
  const pick = (f: PlanFilter) => setFilter(filter === f && f !== "all" ? "all" : f)
  const button = (f: PlanFilter, count?: number, attention?: boolean) => (
    <FilterButton key={f} icon={FILTER_ICON[f]} label={t(`corrections.filter.${f}`)} count={count} attention={attention} active={filter === f} onClick={() => pick(f)} />
  )

  return (
    <div ref={section} className="scroll-mt-4">
      <Section
        id="fakturownia-corrections"
        icon={<ArrowUturnLeft />}
        title={t("corrections.title")}
        badges={<WriterBadge writer={writer} label={t("writers.names.corrections")} />}
        pointsLabel={t("corrections.subtitle")}
        points={[
          { icon: <ArrowUturnLeft />, text: t("corrections.points.changes") },
          { icon: <Eye />, text: t("corrections.points.beforeAfter") },
          { icon: <CheckCircle />, text: t("corrections.points.approve") },
          { icon: <ShieldCheck />, text: t("corrections.points.once"), tone: "green" },
        ]}
        actions={off ? null : <SearchInput value={search} onChange={setSearch} placeholder={t("corrections.search")} />}
      >
        {off ? (
          <EmptyState icon={<XCircle />} title={t("corrections.offTitle")} points={[{ icon: <PencilSquare />, text: t("corrections.offPoint") }]} />
        ) : (
          <>
            <FilterBar>
              {button("all")}
              <FilterDivider />
              {button("open", c.correctionsOpen, true)}
              {button("approved", c.correctionsApproved)}
              {button("issued", c.correctionsIssued)}
              {button("closed")}
            </FilterBar>
            {!writer.armed && c.correctionsApproved > 0 ? (
              <div className="px-6 py-4">
                <InlineTip variant="warning" label={t("writers.names.corrections")}>
                  {t("corrections.waitingForWriter", { count: c.correctionsApproved })}
                </InlineTip>
              </div>
            ) : null}
            <div className="flex flex-col gap-y-3 px-6 py-4">
              {plans.isLoading ? (
                <KitLoading />
              ) : rows.length === 0 ? (
                <EmptyState compact icon={filter === "open" ? <CheckCircleSolid /> : FILTER_ICON[filter]} title={t(`corrections.empty.${filter}`)} />
              ) : (
                rows.map((p) => <PlanCard key={p.id} plan={p} lang={lang} writer={writer} onOpenDocument={onOpenDocument} />)
              )}
            </div>
            {count > PAGE ? (
              <div className="flex items-center justify-between px-6 py-3">
                <Text size="xsmall" className="text-ui-fg-muted">
                  {t("corrections.page", { from: page * PAGE + 1, to: Math.min(count, (page + 1) * PAGE), count })}
                </Text>
                <span className="flex gap-2">
                  <Button size="small" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    {t("pagination.prev")}
                  </Button>
                  <Button size="small" variant="secondary" disabled={(page + 1) * PAGE >= count} onClick={() => setPage(page + 1)}>
                    {t("pagination.next")}
                  </Button>
                </span>
              </div>
            ) : null}
          </>
        )}
      </Section>
    </div>
  )
}

/** One plan: the change, the positions before and after, the totals, and what a person can do. */
export function PlanCard({
  plan,
  lang,
  writer,
  onOpenDocument,
  compact = false,
}: {
  plan: CorrectionPlanDto
  lang: string
  writer: WriterDto
  onOpenDocument?: (id: string) => void
  compact?: boolean
}) {
  const { t } = useTranslation("fakturownia")
  const [approving, setApproving] = useState(false)
  const [closing, setClosing] = useState<"dismiss" | "done" | null>(null)
  const currency = plan.currency
  return (
    <div className="flex flex-col gap-y-3 rounded-lg border border-ui-border-base bg-ui-bg-component px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          {!compact ? <StoreOrderCell orderId={plan.orderId} displayId={plan.displayId} /> : null}
          <span className="flex flex-wrap items-center gap-2">
            <Text size="small" className="text-ui-fg-subtle">
              {t("corrections.of")}
            </Text>
            <KindBadge kind={plan.documentKind} />
            <span className="txt-compact-small font-mono">{plan.documentNumber ?? ""}</span>
            {plan.simulated ? (
              <ToneBadge tone="blue" icon={<Beaker />}>{t("corrections.simulated")}</ToneBadge>
            ) : null}
          </span>
        </span>
        <PlanStatusBadge status={plan.status} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {plan.reasons.map((r) => (
          <ToneBadge key={r} tone="grey">{t(`corrections.reasons.${r}`)}</ToneBadge>
        ))}
        {plan.sources
          .filter((s) => s.type !== "demo")
          .map((s) => (
            <span key={`${s.type}:${s.id}`} className="txt-compact-xsmall font-mono text-ui-fg-muted" title={s.id}>
              {t(`corrections.sources.${s.type}`, { defaultValue: s.type })} {s.id.length > 18 ? `${s.id.slice(0, 18)}...` : s.id}
            </span>
          ))}
        {plan.computedAt ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("corrections.computed", { time: fmtDateTime(plan.computedAt, lang) })}
          </Text>
        ) : null}
      </div>

      {plan.manualReason ? (
        <InlineTip variant="info" label={t("corrections.manualLabel")}>
          {t(`corrections.manual.${plan.manualReason}`)}
        </InlineTip>
      ) : null}

      {plan.positions.length > 0 && compact ? (
        <ul className="flex flex-col divide-y divide-ui-border-base rounded-md border border-ui-border-base">
          {plan.positions.map((p) => (
            <li key={`${p.name}|${p.code}|${p.tax}`} className="flex flex-col gap-y-1 px-3 py-2">
              <span className="flex items-start justify-between gap-x-2">
                <Text size="small">{p.name}</Text>
                <span className={`txt-compact-small-plus whitespace-nowrap tabular-nums ${p.delta.gross < 0 ? "text-ui-tag-red-text" : "text-ui-tag-green-text"}`}>{fmtDelta(p.delta.gross, currency, lang)}</span>
              </span>
              <Text size="xsmall" className="tabular-nums text-ui-fg-muted">
                {t("corrections.col.before")}: {fmtQuantity(p.before.quantity, lang)} {p.unit} / {fmtMoney(p.before.gross, currency, lang)}, {t("corrections.col.after")}: {fmtQuantity(p.after.quantity, lang)} {p.unit} /{" "}
                {fmtMoney(p.after.gross, currency, lang)}
              </Text>
            </li>
          ))}
        </ul>
      ) : null}

      {plan.positions.length > 0 && !compact ? (
        <div className="overflow-x-auto">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("corrections.col.position")}</Table.HeaderCell>
                <Table.HeaderCell className="text-right">{t("corrections.col.before")}</Table.HeaderCell>
                <Table.HeaderCell className="text-right">{t("corrections.col.after")}</Table.HeaderCell>
                <Table.HeaderCell className="text-right">{t("corrections.col.change")}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {plan.positions.map((p) => (
                <Table.Row key={`${p.name}|${p.code}|${p.tax}`} className="[&_td]:py-2 align-top">
                  <Table.Cell>
                    <div className="flex flex-col">
                      <Text size="small">{p.name}</Text>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {[p.code, /^\d/.test(p.tax) ? `VAT ${p.tax}%` : p.tax.toUpperCase()].filter(Boolean).join(", ")}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right tabular-nums">
                    {fmtQuantity(p.before.quantity, lang)} {p.unit} / {fmtMoney(p.before.gross, currency, lang)}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right tabular-nums">
                    {fmtQuantity(p.after.quantity, lang)} {p.unit} / {fmtMoney(p.after.gross, currency, lang)}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right tabular-nums">
                    <div className="flex flex-col items-end">
                      <span className={p.delta.gross < 0 ? "text-ui-tag-red-text" : "text-ui-tag-green-text"}>{fmtDelta(p.delta.gross, currency, lang)}</span>
                      {Math.abs(p.delta.quantity) > 0 ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {p.delta.quantity > 0 ? "+" : ""}
                          {fmtQuantity(p.delta.quantity, lang)} {p.unit}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      ) : null}

      {plan.positions.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-x-6 gap-y-1">
          <Text size="small" className="text-ui-fg-subtle">
            {t("corrections.net")} <span className="tabular-nums text-ui-fg-base">{fmtDelta(plan.totals.net, currency, lang)}</span>
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            {t("corrections.vat")} <span className="tabular-nums text-ui-fg-base">{fmtDelta(plan.totals.vat, currency, lang)}</span>
          </Text>
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {t("corrections.gross")} <span className="tabular-nums">{fmtDelta(plan.totals.gross, currency, lang)}</span>
          </Text>
        </div>
      ) : null}

      {plan.notes.map((n) => (
        <Text key={n.code} size="xsmall" className="text-ui-fg-subtle">
          {t(`corrections.notes.${n.code}`, { amount: fmtMoney(n.amount ?? 0, currency, lang), defaultValue: n.detail ?? n.code })}
        </Text>
      ))}

      {plan.reason && (plan.status === "draft" || plan.status === "approved" || plan.status === "issued") ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("corrections.reasonLine", { reason: plan.reason })}
        </Text>
      ) : null}

      {plan.correction ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-ui-bg-subtle px-3 py-2">
          <Text size="xsmall" className="text-ui-fg-subtle">
            {t("corrections.document")}
          </Text>
          <DocumentStatusBadge status={plan.correction.status} />
          {plan.correction.number ? <span className="txt-compact-small font-mono">{plan.correction.number}</span> : null}
          {plan.status === "approved" && plan.correction.status === "pending" && !writer.armed ? (
            <Text size="xsmall" className="text-ui-tag-orange-text">
              {t("corrections.waitsForWriter")}
            </Text>
          ) : null}
          {plan.correction.error && plan.correction.errorCode !== "adopted" ? (
            <Text size="xsmall" className={plan.correction.status === "failed" ? "text-ui-tag-red-text" : "text-ui-fg-muted"}>
              {plan.correction.error}
            </Text>
          ) : null}
          {onOpenDocument ? (
            <Button size="small" variant="transparent" onClick={() => onOpenDocument(plan.correction?.id ?? "")}>
              <Eye />
              {t("corrections.openDocument")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {plan.approvedBy || plan.closedBy || plan.closeNote ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {plan.approvedAt ? t("corrections.approvedBy", { who: plan.approvedBy ?? "-", time: fmtDateTime(plan.approvedAt, lang) }) : null}
          {plan.closedAt ? t(`corrections.closedBy.${plan.status === "done" ? "done" : plan.status === "obsolete" ? "obsolete" : "dismissed"}`, { who: plan.closedBy ?? "-", time: fmtDateTime(plan.closedAt, lang) }) : null}
          {plan.closeNote ? ` ${plan.closeNote}` : ""}
        </Text>
      ) : null}

      {plan.actions.approve || plan.actions.dismiss || plan.actions.done ? (
        <div className="flex flex-wrap justify-end gap-2">
          {plan.actions.dismiss ? (
            <Button size="small" variant="secondary" onClick={() => setClosing("dismiss")}>
              <XCircle />
              {t("corrections.dismiss")}
            </Button>
          ) : null}
          {plan.actions.done ? (
            <Button size="small" variant="secondary" onClick={() => setClosing("done")}>
              <CheckCircle />
              {t("corrections.markDone")}
            </Button>
          ) : null}
          {plan.actions.approve ? (
            <Button size="small" variant="primary" onClick={() => setApproving(true)}>
              <CheckCircleSolid />
              {t("corrections.approve")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {approving ? <ApproveDrawer plan={plan} writer={writer} lang={lang} onClose={() => setApproving(false)} /> : null}
      {closing ? <CloseDrawer plan={plan} mode={closing} onClose={() => setClosing(null)} /> : null}
    </div>
  )
}

/** "Approve": the reason printed on the correction, the totals once more, and the writer's state. */
function ApproveDrawer({ plan, writer, lang, onClose }: { plan: CorrectionPlanDto; writer: WriterDto; lang: string; onClose: () => void }) {
  const { t } = useTranslation("fakturownia")
  const action = useFakturowniaPlanAction()
  const [reason, setReason] = useState(plan.reason ?? "")
  const save = async () => {
    try {
      const r = await action.mutateAsync({ id: plan.id, action: "approve", revision: plan.revision, reason: reason.trim() })
      toast.success(r.armed ? t("corrections.approvedNow") : t("corrections.approvedWaiting"))
      onClose()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{t("corrections.approveTitle", { number: plan.documentNumber ?? "" })}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4">
          <Text size="small" className="text-ui-fg-subtle">
            {t("corrections.approveText", { gross: fmtDelta(plan.totals.gross, plan.currency, lang), count: plan.positions.length })}
          </Text>
          <div className="flex flex-col gap-y-1">
            <Label htmlFor={`fk-reason-${plan.id}`} size="small" weight="plus">
              {t("corrections.reasonLabel")}
            </Label>
            <Input id={`fk-reason-${plan.id}`} value={reason} maxLength={256} onChange={(e) => setReason(e.target.value)} />
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("corrections.reasonHint", { left: 256 - reason.length })}
            </Text>
          </div>
          {writer.armed ? (
            <InlineTip variant="info" label={t("writers.names.corrections")}>
              {t("corrections.approveArmed")}
            </InlineTip>
          ) : (
            <InlineTip variant="warning" label={t("writers.names.corrections")}>
              {writer.allowed ? t("corrections.approveNotArmed") : t("corrections.approveBlocked")}
            </InlineTip>
          )}
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("corrections.approveRevision", { revision: plan.revision })}
          </Text>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.cancel")}
            </Button>
          </Drawer.Close>
          <Button size="small" variant="primary" isLoading={action.isPending} onClick={() => void save()}>
            {t("corrections.approve")}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/** "Dismiss" or "Mark as done", with an optional note for the history. */
function CloseDrawer({ plan, mode, onClose }: { plan: CorrectionPlanDto; mode: "dismiss" | "done"; onClose: () => void }) {
  const { t } = useTranslation("fakturownia")
  const action = useFakturowniaPlanAction()
  const [note, setNote] = useState("")
  const save = async () => {
    try {
      await action.mutateAsync({ id: plan.id, action: mode, note: note.trim() })
      toast.success(t(mode === "done" ? "corrections.doneToast" : "corrections.dismissedToast"))
      onClose()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{t(mode === "done" ? "corrections.doneTitle" : "corrections.dismissTitle")}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4">
          <Text size="small" className="text-ui-fg-subtle">
            {t(mode === "done" ? "corrections.doneText" : "corrections.dismissText")}
          </Text>
          <div className="flex flex-col gap-y-1">
            <Label htmlFor={`fk-note-${plan.id}`} size="small" weight="plus">
              {t("corrections.noteLabel")}
            </Label>
            <Textarea id={`fk-note-${plan.id}`} value={note} maxLength={500} rows={3} placeholder={t(mode === "done" ? "corrections.donePlaceholder" : "corrections.dismissPlaceholder")} onChange={(e) => setNote(e.target.value)} />
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.cancel")}
            </Button>
          </Drawer.Close>
          <Button size="small" variant={mode === "done" ? "primary" : "danger"} isLoading={action.isPending} onClick={() => void save()}>
            {t(mode === "done" ? "corrections.markDone" : "corrections.dismiss")}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
