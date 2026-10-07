import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Checkbox, Copy, Drawer, Input, Label, StatusBadge, Text, toast } from "@medusajs/ui"
import type { DocumentDetailResponse, DocumentDto, EmailDto, GovState, KsefEventDto, WriterDto } from "../../modules/fakturownia/lib/contract"
import { errorMessage, ksefFilePath, saveFile, useFakturowniaDocument, useFakturowniaEmail, useFakturowniaKsefResend } from "./fakturownia-api"
import { PlanCard } from "./fakturownia-corrections"
import {
  BuyerWarningText,
  DocumentActions,
  DocumentLinks,
  DocumentStatusBadge,
  Fact,
  KindBadge,
  KsefBadge,
  PaidBadge,
  Section,
  StoreOrderCell,
  WriterBadge,
  fmtDate,
  fmtDateTime,
  fmtMoney,
} from "./fakturownia-ui"

const GOV_TONE: Record<GovState, "green" | "orange" | "red" | "grey" | "blue"> = {
  none: "grey",
  processing: "blue",
  accepted: "green",
  problem: "red",
  not_applicable: "grey",
  offline: "orange",
}

/**
 * One document in a drawer: what it is, its KSeF story (number, dates, the
 * errors KSeF gave, the UPO and the history, "send again"), its e-mails
 * (send, a reminder, the history with masked addresses) and its corrections.
 */
export function DocumentDrawer({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation("fakturownia")
  const lang = i18n.language || "en"
  const q = useFakturowniaDocument(documentId)
  const data = q.data
  const doc = data?.document
  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content className="max-w-2xl">
        <Drawer.Header>
          <Drawer.Title className="flex items-center gap-x-2">
            {doc ? <KindBadge kind={doc.kind} /> : null}
            <span className="font-mono">{doc?.number ?? t("drawer.loading")}</span>
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          {q.isError ? (
            <Text size="small" className="text-ui-tag-red-text">
              {errorMessage(q.error)}
            </Text>
          ) : null}
          {data && doc ? (
            <>
              <Overview doc={doc} corrected={data.corrected} lang={lang} />
              {doc.kind === "vat" || doc.kind === "correction" ? <KsefPanel doc={doc} events={data.ksef} writer={data.writers.ksef} lang={lang} /> : null}
              <EmailPanel doc={doc} emails={data.emails} writer={data.writers.emails} lang={lang} />
              {data.corrections.length > 0 || data.plans.length > 0 ? <CorrectionsPanel data={data} lang={lang} /> : null}
            </>
          ) : null}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("drawer.close")}
            </Button>
          </Drawer.Close>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

function Overview({ doc, corrected, lang }: { doc: DocumentDto; corrected: DocumentDto | null; lang: string }) {
  const { t } = useTranslation("fakturownia")
  return (
    <Section title={t("drawer.overview")} aside={<DocumentStatusBadge status={doc.status} />}>
      <div className="grid grid-cols-2 gap-3">
        <Fact label={t("documents.col.order")}>
          <StoreOrderCell orderId={doc.orderId} displayId={doc.displayId} />
        </Fact>
        <Fact label={t("documents.col.total")}>{fmtMoney(doc.totalGross, doc.currency, lang)}</Fact>
        <Fact label={t("drawer.issueDate")}>{fmtDate(doc.issueDate, lang) || "-"}</Fact>
        <Fact label={t("documents.col.paid")}>{doc.status === "issued" || doc.status === "needs_correction" ? <PaidBadge paid={doc.paid} /> : "-"}</Fact>
        <Fact label={t("drawer.buyer")}>{doc.buyerType ? t(doc.buyerType === "company" ? "documents.company" : "documents.person") : "-"}</Fact>
        {corrected ? (
          <Fact label={t("drawer.corrects")}>
            <span className="font-mono">{corrected.number ?? corrected.id}</span>
          </Fact>
        ) : null}
      </div>
      <BuyerWarningText warning={doc.buyerWarning} />
      {doc.error && doc.errorCode !== "adopted" ? (
        <Text size="xsmall" className={doc.status === "failed" || doc.status === "unknown" ? "text-ui-tag-red-text" : "text-ui-fg-subtle"}>
          {doc.error}
        </Text>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DocumentLinks doc={doc} />
        <DocumentActions doc={doc} />
      </div>
    </Section>
  )
}

function KsefPanel({ doc, events, writer, lang }: { doc: DocumentDto; events: KsefEventDto[]; writer: WriterDto; lang: string }) {
  const { t } = useTranslation("fakturownia")
  const resend = useFakturowniaKsefResend()
  const base = (doc.govStatus ?? "").replace(/^demo_/, "")
  const hint = !doc.actions.ksefResend && (base === "status_check_error" || base === "duplicate_error") ? t(`ksef.hints.${base}`) : null
  const onResend = async () => {
    try {
      const r = await resend.mutateAsync(doc.id)
      if (r.outcome === "sent") toast.success(t("ksef.resent"))
      else toast.error(t("toast.error", { error: r.message ?? "?" }))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  return (
    <Section title={t("ksef.title")} aside={<KsefBadge doc={doc} />}>
      {doc.demo ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("ksef.demo")}
        </Text>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fact label={t("ksef.number")} mono>
          {doc.govId ? (
            <span className="inline-flex items-center gap-x-1 break-all">
              {doc.govId}
              <Copy content={doc.govId} />
            </span>
          ) : (
            <span className="font-sans text-ui-fg-muted">{t("ksef.noNumber")}</span>
          )}
        </Fact>
        <Fact label={t("ksef.sent")}>{fmtDateTime(doc.govSendDate, lang) || "-"}</Fact>
        <Fact label={t("ksef.checked")}>{fmtDateTime(doc.govCheckedAt, lang) || "-"}</Fact>
        {doc.kind === "correction" ? (
          <Fact label={t("ksef.correctedNumber")} mono>
            {doc.govCorrectedNumber ?? <span className="font-sans text-ui-fg-muted">-</span>}
          </Fact>
        ) : null}
      </div>
      {doc.govErrors.length > 0 ? (
        <div className="flex flex-col gap-y-1 rounded-md border border-ui-tag-red-border bg-ui-tag-red-bg px-3 py-2">
          <Text size="xsmall" weight="plus" className="text-ui-tag-red-text">
            {t("ksef.errors")}
          </Text>
          {doc.govErrors.map((e) => (
            <Text key={e} size="xsmall" className="text-ui-tag-red-text">
              {e}
            </Text>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {doc.govVerificationLink ? (
          <a href={doc.govVerificationLink} target="_blank" rel="noreferrer" className="txt-compact-small inline-flex items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("ksef.verify")}
            <ArrowUpRightOnBox />
          </a>
        ) : null}
        {doc.actions.ksefFiles ? (
          <>
            {(["upo", "xml"] as const).map((file) => (
              <button
                key={file}
                type="button"
                className="txt-compact-small inline-flex items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                onClick={() =>
                  void saveFile(ksefFilePath(doc.id, file), `${file === "upo" ? "UPO" : "KSeF"}-${doc.id}.xml`).catch((err: unknown) =>
                    toast.error(t("toast.error", { error: errorMessage(err) })),
                  )
                }
              >
                {t(file === "upo" ? "ksef.upo" : "ksef.xml")}
              </button>
            ))}
          </>
        ) : null}
      </div>
      {doc.actions.ksefResend ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="small" variant="secondary" isLoading={resend.isPending} disabled={!writer.armed} onClick={() => void onResend()}>
            {t("ksef.resend")}
          </Button>
          <WriterBadge writer={writer} />
          {!writer.armed ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              {writer.allowed ? t("ksef.writerOff") : t("ksef.writerBlocked")}
            </Text>
          ) : null}
        </div>
      ) : null}
      {hint ? (
        <Text size="xsmall" className="text-ui-fg-subtle">
          {hint}
        </Text>
      ) : null}
      <div className="flex flex-col gap-y-2">
        <Text size="xsmall" weight="plus" className="text-ui-fg-muted">
          {t("ksef.history")}
        </Text>
        {events.length === 0 ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("ksef.noHistory")}
          </Text>
        ) : (
          <ol className="flex flex-col gap-y-2 border-l border-ui-border-base pl-3">
            {events.map((e) => (
              <li key={e.id} className="flex flex-col gap-y-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge color={GOV_TONE[e.govState] ?? "grey"}>{e.govStatus ? t(`documents.ksefStates.${e.govState}`) : t("ksef.statusNone")}</StatusBadge>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {t(`ksef.sources.${e.source}`)}
                    {e.requestedBy ? `, ${e.requestedBy === "system" ? t("ksef.system") : e.requestedBy}` : ""}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {fmtDateTime(e.createdAt, lang)}
                  </Text>
                </span>
                {e.govId ? <span className="txt-compact-xsmall break-all font-mono text-ui-fg-subtle">{e.govId}</span> : null}
                {e.errors.map((x) => (
                  <Text key={x} size="xsmall" className="text-ui-tag-red-text">
                    {x}
                  </Text>
                ))}
                {e.note ? (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {e.note}
                  </Text>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Section>
  )
}

function EmailPanel({ doc, emails, writer, lang }: { doc: DocumentDto; emails: EmailDto[]; writer: WriterDto; lang: string }) {
  const { t } = useTranslation("fakturownia")
  const send = useFakturowniaEmail()
  const [to, setTo] = useState("")
  const [pdf, setPdf] = useState(false)
  const unpaidForReminder = !doc.paid && (doc.kind === "proforma" || doc.kind === "vat") && doc.status === "issued"
  const go = async (kind: "manual" | "reminder") => {
    try {
      await send.mutateAsync({ id: doc.id, kind, to: to.trim() || undefined, attachPdf: pdf })
      toast.success(t(kind === "reminder" ? "email.reminded" : "email.sent"))
      setTo("")
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  return (
    <Section title={t("email.title")} aside={<WriterBadge writer={writer} />}>
      {doc.actions.email ? (
        <div className="flex flex-col gap-y-3">
          <div className="flex flex-col gap-y-1">
            <Label htmlFor={`fk-to-${doc.id}`} size="small" weight="plus">
              {t("email.to")}
            </Label>
            <Input id={`fk-to-${doc.id}`} size="small" value={to} placeholder={t("email.toPlaceholder")} onChange={(e) => setTo(e.target.value)} />
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("email.toHint")}
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <Checkbox id={`fk-pdf-${doc.id}`} checked={pdf} onCheckedChange={(v) => setPdf(v === true)} />
            <Label htmlFor={`fk-pdf-${doc.id}`} size="small">
              {t("email.attachPdf")}
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="small" variant="secondary" isLoading={send.isPending && send.variables?.kind === "manual"} disabled={!writer.armed} onClick={() => void go("manual")}>
              {t("email.send")}
            </Button>
            {unpaidForReminder ? (
              <Button size="small" variant="secondary" isLoading={send.isPending && send.variables?.kind === "reminder"} disabled={!writer.armed} onClick={() => void go("reminder")}>
                {t("email.remind")}
              </Button>
            ) : null}
          </div>
          {!writer.armed ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              {writer.allowed ? t("email.writerOff") : t("email.writerBlocked")}
            </Text>
          ) : null}
          {doc.demo ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("email.demo")}
            </Text>
          ) : null}
        </div>
      ) : (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("email.notIssued")}
        </Text>
      )}
      <EmailHistory emails={emails} lang={lang} />
    </Section>
  )
}

const EMAIL_TONE: Record<EmailDto["status"], "green" | "orange" | "red"> = { sent: "green", refused: "orange", failed: "red" }

export function EmailHistory({ emails, lang, showDocument = false }: { emails: EmailDto[]; lang: string; showDocument?: boolean }) {
  const { t } = useTranslation("fakturownia")
  if (emails.length === 0) {
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        {t("email.none")}
      </Text>
    )
  }
  return (
    <ul className="flex flex-col divide-y divide-ui-border-base">
      {emails.map((e) => (
        <li key={e.id} className="flex flex-col gap-y-0.5 py-2">
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge color={EMAIL_TONE[e.status]}>{t(`email.statuses.${e.status}`)}</StatusBadge>
            <Badge size="2xsmall" color="grey">
              {t(`email.kinds.${e.kind}`)}
            </Badge>
            {showDocument && e.documentNumber ? <span className="txt-compact-xsmall font-mono text-ui-fg-subtle">{e.documentNumber}</span> : null}
            <Text size="xsmall" className="text-ui-fg-muted">
              {fmtDateTime(e.createdAt, lang)}
            </Text>
          </span>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {t("email.line", {
              to: e.recipient ?? t("email.buyer"),
              by: e.requestedBy === "system" ? t("ksef.system") : e.requestedBy ?? "-",
            })}
            {e.withPdf ? `, ${t("email.withPdf")}` : ""}
          </Text>
          {e.subject ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("email.subject", { subject: e.subject })}
            </Text>
          ) : null}
          {e.error ? (
            <Text size="xsmall" className={e.status === "failed" ? "text-ui-tag-red-text" : "text-ui-tag-orange-text"}>
              {e.error}
            </Text>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function CorrectionsPanel({ data, lang }: { data: DocumentDetailResponse; lang: string }) {
  const { t } = useTranslation("fakturownia")
  return (
    <Section title={t("drawer.corrections")}>
      {data.corrections.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-x-2">
            <span className="txt-compact-small font-mono">{c.number ?? t("drawer.pendingNumber")}</span>
            <DocumentStatusBadge status={c.status} />
          </span>
          <span className="txt-compact-small tabular-nums">{fmtMoney(c.totalGross, c.currency, lang)}</span>
        </div>
      ))}
      {data.plans.map((p) => (
        <PlanCard key={p.id} plan={p} lang={lang} writer={data.writers.corrections} compact />
      ))}
    </Section>
  )
}
