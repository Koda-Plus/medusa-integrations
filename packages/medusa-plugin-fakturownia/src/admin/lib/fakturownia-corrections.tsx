import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Button, Container, Drawer, Heading, InlineTip, Input, Label, Table, Text, Textarea, toast } from "@medusajs/ui"
import type { CorrectionPlanDto, PlanFilter, StatusResponse, WriterDto } from "../../modules/fakturownia/lib/contract"
import { errorMessage, useFakturowniaCorrections, useFakturowniaPlanAction } from "./fakturownia-api"
import { DocumentStatusBadge, FilterPills, KindBadge, OrderLink, PlanStatusBadge, WriterBadge, fmtDateTime, fmtDelta, fmtMoney, fmtQuantity } from "./fakturownia-ui"

const PAGE = 10
const FILTERS: PlanFilter[] = ["open", "approved", "issued", "closed", "all"]

/**
 * CORRECTIONS: what changed after a document was issued (a return, a
 * refund, an order edit, a cancellation), the positions before and after,
 * and the decision of a person. An approved plan becomes a correction
 * invoice once, when the corrections writer is on.
 */
export function CorrectionsSection({ status, lang, onOpenDocument }: { status: StatusResponse; lang: string; onOpenDocument: (id: string) => void }) {
  const { t } = useTranslation("fakturownia")
  const [filter, setFilter] = useState<PlanFilter>("open")
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(0)
  useEffect(() => {
    const id = window.setTimeout(() => setQ(search.trim()), 300)
    return () => window.clearTimeout(id)
  }, [search])
  useEffect(() => setPage(0), [filter, q])
  const plans = useFakturowniaCorrections(filter, q, page * PAGE, PAGE, false)
  const rows = plans.data?.plans ?? []
  const count = plans.data?.count ?? 0
  const writer = status.writers.corrections
  const off = status.options.corrections === "off"
  const counts: Partial<Record<PlanFilter, number>> = { open: status.counts.correctionsOpen, approved: status.counts.correctionsApproved, issued: status.counts.correctionsIssued }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-3xl flex-col gap-1">
          <Heading level="h2">{t("corrections.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("corrections.subtitle")}
          </Text>
        </div>
        <span className="flex items-center gap-x-2">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("writers.names.corrections")}
          </Text>
          <WriterBadge writer={writer} />
        </span>
      </div>
      {off ? (
        <div className="px-6 py-4">
          <InlineTip variant="info" label={t("corrections.title")}>
            {t("corrections.off")}
          </InlineTip>
        </div>
      ) : (
        <>
          {!writer.armed && status.counts.correctionsApproved > 0 ? (
            <div className="px-6 py-4">
              <InlineTip variant="warning" label={t("writers.names.corrections")}>
                {t("corrections.waitingForWriter", { count: status.counts.correctionsApproved })}
              </InlineTip>
            </div>
          ) : null}
          <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
            <FilterPills<PlanFilter> value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f, label: t(`corrections.filter.${f}`), count: counts[f] }))} />
            <div className="w-full lg:w-72">
              <Input size="small" type="search" placeholder={t("corrections.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-y-3 px-6 py-4">
            {rows.length === 0 ? (
              <Text size="small" className="py-4 text-center text-ui-fg-muted">
                {plans.isLoading ? "" : t(`corrections.empty.${filter}`)}
              </Text>
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
    </Container>
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
        <span className="flex flex-wrap items-center gap-2">
          {!compact ? <OrderLink orderId={plan.orderId} displayId={plan.displayId} /> : null}
          <Text size="small" className="text-ui-fg-subtle">
            {t("corrections.of")}
          </Text>
          <KindBadge kind={plan.documentKind} />
          <span className="txt-compact-small font-mono">{plan.documentNumber ?? ""}</span>
          {plan.simulated ? (
            <Badge size="2xsmall" color="purple">
              {t("corrections.simulated")}
            </Badge>
          ) : null}
        </span>
        <PlanStatusBadge status={plan.status} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {plan.reasons.map((r) => (
          <Badge key={r} size="2xsmall" color="grey">
            {t(`corrections.reasons.${r}`)}
          </Badge>
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
              {t("corrections.dismiss")}
            </Button>
          ) : null}
          {plan.actions.done ? (
            <Button size="small" variant="secondary" onClick={() => setClosing("done")}>
              {t("corrections.markDone")}
            </Button>
          ) : null}
          {plan.actions.approve ? (
            <Button size="small" variant="primary" onClick={() => setApproving(true)}>
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
