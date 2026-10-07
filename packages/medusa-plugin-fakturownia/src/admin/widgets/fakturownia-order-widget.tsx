import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Button, Heading, Text, toast } from "@medusajs/ui"
import type { DocumentDto } from "../../modules/fakturownia/lib/contract"
import { errorMessage, useFakturowniaCheckOrderCorrections, useFakturowniaIssueOrder, useFakturowniaOrder } from "../lib/fakturownia-api"
import { PlanCard } from "../lib/fakturownia-corrections"
import { DocumentDrawer } from "../lib/fakturownia-document"
import { FakturowniaIcon } from "../lib/fakturownia-icon"
import { WidgetFrame, hostable } from "../lib/fakturownia-kit"
import { BuyerWarningText, DocumentActions, DocumentLinks, DocumentStatusBadge, KindBadge, KsefBadge, PaidBadge, fmtDateTime, fmtMoney } from "../lib/fakturownia-ui"

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
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-2">
            <FakturowniaIcon width={18} height={18} className="shrink-0" />
            <Heading level="h2">{t("widget.title")}</Heading>
            {info?.mode === "demo" ? (
              <Badge size="2xsmall" color="purple">
                {t("widget.demo")}
              </Badge>
            ) : null}
          </div>
          <Link to={`/fakturownia?q=${data.display_id ?? data.id}`} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("widget.more")}
          </Link>
        </div>
      }
    >
      {embedded && info?.mode === "demo" ? (
        <div className="px-6 py-2">
          <Badge size="2xsmall" color="purple">
            {t("widget.demo")}
          </Badge>
        </div>
      ) : null}
      {q.isError && !info ? (
        <Quiet>{t("widget.failed")}</Quiet>
      ) : q.isLoading ? null : (
        <>
          {docs.length === 0 ? (
            <div className="flex flex-col gap-y-1 px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle">
                {!info?.configured ? t("widget.notConfigured") : t("widget.none")}
              </Text>
              {info?.configured && info.waitingFor && !canceled ? (
                <Text size="xsmall" className="text-ui-fg-muted">
                  {t("widget.waiting", { when: t(info.waitingFor === "order_placed" ? "widget.whenPlaced" : "widget.whenCaptured") })}
                </Text>
              ) : null}
            </div>
          ) : (
            docs.map((d) => <DocumentBlock key={d.id} doc={d} lang={lang} onDone={() => void q.refetch()} onOpen={() => setOpen(d.id)} />)
          )}

          {info?.canIssue && !canceled ? (
            <div className="flex flex-col items-start gap-y-2 px-6 py-4">
              {info.nextKind ? (
                <Text size="xsmall" className="text-ui-fg-muted">
                  {t("widget.nextKind", { kind: t(`documents.kinds.${info.nextKind}`) })}
                </Text>
              ) : null}
              <Button size="small" variant="secondary" isLoading={issue.isPending} onClick={() => void onIssue()}>
                {t("actions.issueNow")}
              </Button>
            </div>
          ) : null}

          {info && info.corrections === "plan" && (issued || plans.length > 0) ? (
            <div className="flex flex-col gap-y-3 px-6 py-4">
              <div className="flex items-center justify-between gap-2">
                <Text size="small" weight="plus" className="text-ui-fg-base">
                  {t("widget.corrections")}
                </Text>
                <Button size="small" variant="transparent" isLoading={check.isPending} onClick={() => void onCheck()}>
                  {t("widget.checkCorrections")}
                </Button>
              </div>
              {plans.length === 0 ? (
                <Text size="xsmall" className="text-ui-fg-muted">
                  {t("widget.noCorrections")}
                </Text>
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

function Quiet({ children }: { children: ReactNode }) {
  return (
    <div className="px-6 py-4">
      <Text size="small" className="text-ui-fg-subtle">
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
  return (
    <div className="flex flex-col gap-y-3 px-6 py-4">
      <div className="flex items-center justify-between gap-x-2">
        <KindBadge kind={doc.kind} />
        <DocumentStatusBadge status={doc.status} />
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex flex-wrap items-center gap-x-3">
          <DocumentLinks doc={doc} />
          <Button size="small" variant="transparent" onClick={onOpen}>
            {t("documents.details")}
          </Button>
        </span>
        <DocumentActions doc={doc} onDone={onDone} />
      </div>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default hostable({ id: "fakturownia.order", ns: "fakturownia", zone: "order.details", name: "Fakturownia", order: 20, Icon: FakturowniaIcon }, FakturowniaOrderCard)
