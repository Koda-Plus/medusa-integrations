import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import type { DocumentDto } from "../../modules/fakturownia/lib/contract"
import { errorMessage, useFakturowniaIssueOrder, useFakturowniaOrder } from "../lib/fakturownia-api"
import { FakturowniaIcon } from "../lib/fakturownia-icon"
import { DocumentActions, DocumentLinks, DocumentStatusBadge, KindBadge, KsefBadge, PaidBadge, fmtDateTime, fmtMoney } from "../lib/fakturownia-ui"

/**
 * Order page, side column: the Fakturownia documents of this order (kind,
 * number, status, payment, KSeF), the PDF (streamed by the backend, live mode
 * only), "Issue now" when the order has no document yet, and "Retry" or the
 * unknown-result actions when a document needs a person.
 */
const FakturowniaOrderWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const { t, i18n } = useTranslation("fakturownia")
  const lang = i18n.language || "en"
  const q = useFakturowniaOrder(data.id)
  const issue = useFakturowniaIssueOrder()
  const info = q.data
  const docs = info?.documents ?? []
  const canceled = data.status === "canceled"

  const onIssue = async () => {
    try {
      const r = await issue.mutateAsync(data.id)
      toast.success(t("toast.issueQueued", { kinds: r.queued.map((k) => t(`documents.kinds.${k}`)).join(", ") }))
      void q.refetch()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  return (
    <Container className="divide-y p-0">
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
        <Link to="/fakturownia" className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {t("widget.more")}
        </Link>
      </div>

      {q.isLoading ? null : (
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
            docs.map((d) => <DocumentBlock key={d.id} doc={d} lang={lang} onDone={() => void q.refetch()} />)
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
        </>
      )}
    </Container>
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

function DocumentBlock({ doc, lang, onDone }: { doc: DocumentDto; lang: string; onDone: () => void }) {
  const { t } = useTranslation("fakturownia")
  return (
    <div className="flex flex-col gap-y-3 px-6 py-4">
      <div className="flex items-center justify-between gap-x-2">
        <KindBadge kind={doc.kind} />
        <DocumentStatusBadge status={doc.status} />
      </div>
      {doc.number ? (
        <Line label={t("documents.col.number")}>
          <span className="font-mono txt-compact-small-plus">{doc.number}</span>
        </Line>
      ) : null}
      {doc.totalGross !== null ? (
        <Line label={t("documents.col.total")}>
          <span className="tabular-nums txt-compact-small">{fmtMoney(doc.totalGross, doc.currency, lang)}</span>
        </Line>
      ) : null}
      {doc.status === "issued" || doc.status === "needs_correction" ? (
        <Line label={t("documents.col.paid")}>
          <PaidBadge paid={doc.paid} />
        </Line>
      ) : null}
      {doc.kind === "vat" && (doc.status === "issued" || doc.status === "needs_correction") ? (
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
          {t("widget.queued")}
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        {doc.demo && doc.status === "issued" ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("widget.pdfDemo")}
          </Text>
        ) : (
          <DocumentLinks doc={doc} />
        )}
        <DocumentActions doc={doc} onDone={onDone} />
      </div>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default FakturowniaOrderWidget
