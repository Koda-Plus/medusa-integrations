import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowUpRightMini, ArrowUturnLeft, Beaker, CheckCircleSolid, Clock, DocumentText, MagnifyingGlass } from "@medusajs/icons"
import { Button, Heading, Text, toast } from "@medusajs/ui"
import type { DocumentDto, OrderDocumentsResponse } from "../../modules/fakturownia/lib/contract"
import { errorMessage, useFakturowniaCheckOrderCorrections, useFakturowniaIssueOrder, useFakturowniaOrder } from "../lib/fakturownia-api"
import { EmptyState, RowActions, ToneBadge, type Tone } from "../lib/fakturownia-blocks"
import { PlanCard } from "../lib/fakturownia-corrections"
import { DocumentDrawer } from "../lib/fakturownia-document"
import { FakturowniaIcon } from "../lib/fakturownia-icon"
import { WidgetFrame, hostable } from "../lib/fakturownia-kit"
import { BuyerWarningText, DocumentStatusBadge, KindBadge, KsefBadge, PaidBadge, fmtDateTime, fmtMoney, useDocumentActions } from "../lib/fakturownia-ui"

/**
 * Order page, side column: the Fakturownia documents of this order (kind,
 * number, status, payment, KSeF), their PDF (streamed by the backend,
 * generated in demo mode), the details drawer (KSeF history, e-mails),
 * "Issue now" when the order has no document yet, and the correction plans
 * of the order with "Check for corrections".
 *
 * A host (an app that shows every integration as tabs of one card) embeds it
 * with `embedded`: no frame and header of its own, a line while loading
 * instead of nothing. It registers as `fakturownia.order` in the zone
 * `order.details`, tab order 20.
 */
const FakturowniaOrderCard = ({ data, embedded }: DetailWidgetProps<AdminOrder> & { embedded?: boolean }) => {
  const { t, i18n } = useTranslation("fakturownia")
  const lang = i18n.language || "en"
  const q = useFakturowniaOrder(data.id)
  const issue = useFakturowniaIssueOrder()
  const check = useFakturowniaCheckOrderCorrections()
  const [open, setOpen] = useState<string | null>(null)
  const info = q.data
  const docs = info?.documents ?? []
  const plans = info?.plans ?? []
  const canceled = data.status === "canceled"
  const issued = docs.some((d) => (d.kind === "vat" || d.kind === "receipt") && (d.status === "issued" || d.status === "needs_correction"))

  const onIssue = async () => {
    try {
      const r = await issue.mutateAsync(data.id)
      toast.success(t("toast.issueQueued", { kinds: r.queued.map((k) => t(`documents.kinds.${k}`)).join(", ") }))
      void q.refetch()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const onCheck = async () => {
    try {
      const r = await check.mutateAsync(data.id)
      toast.info(t(`widget.checked.${r.outcome}`, { defaultValue: t("widget.checked.none") }))
      void q.refetch()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  if (embedded && (q.isLoading || !info)) return <Quiet>{q.isError ? t("widget.failed") : t("widget.loading")}</Quiet>

  return (
    <WidgetFrame embedded={embedded} header={<Header info={info} orderRef={data.display_id ?? data.id} />}>
      {embedded && info?.mode === "demo" ? (
        <div className="px-6 py-2">
          <ToneBadge tone="blue" icon={<Beaker />}>
            {t("widget.demo")}
          </ToneBadge>
        </div>
      ) : null}
      {q.isError && !info ? (
        <Quiet tone="error">{t("widget.failed")}</Quiet>
      ) : q.isLoading ? null : (
        <>
          {docs.length === 0 ? (
            <EmptyState
              compact
              icon={<DocumentText />}
              title={!info?.configured ? t("widget.notConfigured") : t("widget.none")}
              points={
                info?.configured && info.waitingFor && !canceled
                  ? [{ icon: <Clock />, text: t(info.waitingFor === "order_placed" ? "widget.points.whenPlaced" : "widget.points.whenCaptured") }]
                  : undefined
              }
            />
          ) : (
            docs.map((d) => <DocumentBlock key={d.id} doc={d} lang={lang} onDone={() => void q.refetch()} onOpen={() => setOpen(d.id)} />)
          )}

          {info?.canIssue && !canceled ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
              {info.nextKind ? (
                <Text size="xsmall" className="text-ui-fg-muted">
                  {t("widget.nextKind", { kind: t(`documents.kinds.${info.nextKind}`) })}
                </Text>
              ) : (
                <span />
              )}
              <Button size="small" variant="secondary" isLoading={issue.isPending} onClick={() => void onIssue()}>
                <DocumentText />
                {t("actions.issueNow")}
              </Button>
            </div>
          ) : null}

          {info && info.corrections === "plan" && (issued || plans.length > 0) ? (
            <div className="flex flex-col gap-y-3 px-6 py-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-x-1.5 text-ui-fg-subtle [&_svg]:size-4">
                  <ArrowUturnLeft />
                  <Text size="small" weight="plus" className="text-ui-fg-base">
                    {t("widget.corrections")}
                  </Text>
                </span>
                <Button size="small" variant="secondary" isLoading={check.isPending} onClick={() => void onCheck()}>
                  <MagnifyingGlass />
                  {t("widget.checkCorrections")}
                </Button>
              </div>
              {plans.length === 0 ? (
                <EmptyState compact icon={<CheckCircleSolid />} title={t("widget.noCorrections")} />
              ) : (
                plans.map((p) => <PlanCard key={p.id} plan={p} lang={lang} writer={info.writers.corrections} onOpenDocument={setOpen} compact />)
              )}
            </div>
          ) : null}
        </>
      )}
      {open ? <DocumentDrawer documentId={open} onClose={() => setOpen(null)} /> : null}
    </WidgetFrame>
  )
}

/** One word for the order: no document, waiting, needs a person, issued. */
function orderState(info: OrderDocumentsResponse | undefined): { key: string; tone: Tone } | null {
  if (!info) return null
  const docs = info.documents
  if (docs.length === 0) return { key: "none", tone: "grey" }
  if (docs.some((d) => d.status === "failed")) return { key: "failed", tone: "red" }
  if (docs.some((d) => d.status === "unknown" || d.status === "needs_correction" || d.govState === "problem")) return { key: "attention", tone: "orange" }
  if (docs.some((d) => d.status === "pending" || d.status === "issuing")) return { key: "pending", tone: "blue" }
  if (docs.every((d) => d.status === "canceled")) return { key: "canceled", tone: "grey" }
  return { key: "issued", tone: "green" }
}

function Header({ info, orderRef }: { info: OrderDocumentsResponse | undefined; orderRef: string | number }) {
  const { t } = useTranslation("fakturownia")
  const state = orderState(info)
  return (
    <div className="flex items-center justify-between gap-x-2 px-6 py-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <FakturowniaIcon width={18} height={18} className="shrink-0" />
        <Heading level="h2">{t("widget.title")}</Heading>
        {state ? <ToneBadge tone={state.tone}>{t(`widget.state.${state.key}`)}</ToneBadge> : null}
        {info?.mode === "demo" ? (
          <ToneBadge tone="blue" icon={<Beaker />}>
            {t("widget.demo")}
          </ToneBadge>
        ) : null}
      </div>
      <Link to={`/fakturownia?q=${encodeURIComponent(String(orderRef))}`} className="txt-compact-small-plus inline-flex shrink-0 items-center gap-x-0.5 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
        {t("widget.more")}
        <ArrowUpRightMini />
      </Link>
    </div>
  )
}

function Quiet({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <div className="px-6 py-4">
      <Text size="small" className={tone === "error" ? "text-ui-tag-red-text" : "text-ui-fg-subtle"}>
        {children}
      </Text>
    </div>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-x-2">
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <div className="text-right">{children}</div>
    </div>
  )
}

function DocumentBlock({ doc, lang, onDone, onOpen }: { doc: DocumentDto; lang: string; onDone: () => void; onOpen: () => void }) {
  const { t } = useTranslation("fakturownia")
  const { actions, extra } = useDocumentActions(doc, { onDone, onOpen, links: true })
  return (
    <div className="flex flex-col gap-y-2.5 px-6 py-4">
      <div className="flex items-center justify-between gap-x-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <KindBadge kind={doc.kind} />
          <DocumentStatusBadge status={doc.status} />
        </span>
        <RowActions actions={actions} />
        {extra}
      </div>
      {doc.number ? (
        <Line label={t("documents.col.number")}>
          <button type="button" className="txt-compact-small-plus font-mono text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={onOpen}>
            {doc.number}
          </button>
        </Line>
      ) : null}
      {doc.totalGross !== null ? (
        <Line label={t("documents.col.total")}>
          <span className="tabular-nums txt-compact-small">{fmtMoney(doc.totalGross, doc.currency, lang)}</span>
        </Line>
      ) : null}
      {(doc.status === "issued" || doc.status === "needs_correction") && doc.kind !== "correction" ? (
        <Line label={t("documents.col.paid")}>
          <PaidBadge paid={doc.paid} />
        </Line>
      ) : null}
      {(doc.kind === "vat" || doc.kind === "correction") && (doc.status === "issued" || doc.status === "needs_correction") ? (
        <Line label={t("documents.col.ksef")}>
          <KsefBadge doc={doc} />
        </Line>
      ) : null}
      {doc.govId ? (
        <Line label={t("widget.ksefNumber")}>
          <span className="font-mono txt-compact-xsmall break-all">{doc.govId}</span>
        </Line>
      ) : null}
      {doc.issuedAt ? (
        <Line label={t("widget.issuedAt")}>
          <Text size="small">{fmtDateTime(doc.issuedAt, lang)}</Text>
        </Line>
      ) : null}
      {doc.status === "pending" && doc.attempts === 0 ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {doc.kind === "correction" ? t("widget.correctionQueued") : t("widget.queued")}
        </Text>
      ) : null}
      {doc.error && doc.errorCode !== "adopted" ? (
        <Text size="xsmall" className={doc.status === "failed" || doc.status === "unknown" ? "text-ui-tag-red-text" : "text-ui-fg-muted"}>
          {doc.error}
        </Text>
      ) : null}
      {doc.errorCode === "adopted" ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("documents.adopted")}
        </Text>
      ) : null}
      <BuyerWarningText warning={doc.buyerWarning} />
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default hostable({ id: "fakturownia.order", ns: "fakturownia", zone: "order.details", name: "Fakturownia", order: 20, Icon: FakturowniaIcon }, FakturowniaOrderCard)
