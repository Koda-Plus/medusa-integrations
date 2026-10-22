import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Button, Drawer, Input, Label, Text, clx, toast, usePrompt } from "@medusajs/ui"
import {
  ArrowDownTray,
  ArrowPath,
  ArrowUpRightMini,
  ArrowUpRightOnBox,
  ArrowUturnLeft,
  Bolt,
  CheckCircle,
  DocumentSeries,
  DocumentText,
  Eye,
  LockClosedSolid,
  MagnifyingGlass,
  PencilSquare,
  Receipt,
} from "@medusajs/icons"
import { useTranslation } from "react-i18next"
import type {
  BuyerWarningDto,
  DocumentDto,
  DocumentKind,
  DocumentStatus,
  GovState,
  LocalizedTextDto,
  MoneyDto,
  PlanStatus,
  ReferenceDto,
  RunDto,
  RunStatus,
  StatusResponse,
  WriterDto,
} from "../../modules/fakturownia/lib/contract"
import type { Reference } from "./fakturownia-guide"
import { ToneBadge, type RowAction, type Tone } from "./fakturownia-blocks"
import { errorMessage, openFile, pdfPath, useFakturowniaDocumentAction, useFakturowniaMarkIssued, type DocumentAction } from "./fakturownia-api"

export function fmtDateTime(value: string | null | undefined, lang: string): string {
  if (!value) return ""
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return ""
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(d)
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ")
  }
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 s"
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}

export function fmtNumber(value: unknown, lang: string): string {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return "0"
  try {
    return new Intl.NumberFormat(lang).format(n)
  } catch {
    return String(n)
  }
}

export function fmtMoney(value: number | null | undefined, currency: string | null | undefined, lang: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ""
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: (currency || "PLN").toUpperCase() }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency ?? ""}`.trim()
  }
}

/** One word for the whole connection, for the mode badge of the header: what a person needs to know first. */
export function connectionState(s: StatusResponse | undefined): { key: string; tone: Tone } {
  if (!s) return { key: "unknown", tone: "grey" }
  if (s.mode === "demo") return { key: "demo", tone: "blue" }
  if (!s.configured) return { key: "notConfigured", tone: "orange" }
  const last = s.lastRuns.issue
  if (s.lastCheck && !s.lastCheck.ok) return { key: "error", tone: "red" }
  if (last?.status === "error") return { key: "error", tone: "red" }
  if (last || s.lastCheck?.ok) return { key: "connected", tone: "green" }
  return { key: "unknown", tone: "grey" }
}

const STATUS_TONE: Record<DocumentStatus, Tone> = {
  pending: "blue",
  issuing: "blue",
  issued: "green",
  failed: "red",
  unknown: "orange",
  canceled: "grey",
  needs_correction: "orange",
}

export function documentTone(status: DocumentStatus): Tone {
  return STATUS_TONE[status] ?? "grey"
}

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const { t } = useTranslation("fakturownia")
  return <ToneBadge tone={documentTone(status)}>{t(`documents.statuses.${status}`)}</ToneBadge>
}

/** The kind of a document is a label, not a state: grey, with its own icon. */
const KIND_ICON: Record<DocumentKind, ReactNode> = { vat: <DocumentText />, proforma: <DocumentSeries />, receipt: <Receipt />, correction: <ArrowUturnLeft /> }

export function KindBadge({ kind }: { kind: DocumentKind }) {
  const { t } = useTranslation("fakturownia")
  return (
    <ToneBadge tone="grey" icon={KIND_ICON[kind]}>
      {t(`documents.kinds.${kind}`)}
    </ToneBadge>
  )
}

const GOV_TONE: Record<GovState, Tone> = { none: "grey", processing: "blue", accepted: "green", problem: "red", not_applicable: "grey", offline: "orange" }

export function govTone(state: GovState): Tone {
  return GOV_TONE[state] ?? "grey"
}

/** The KSeF state of a VAT invoice or a correction; nothing for kinds KSeF does not take. */
export function KsefBadge({ doc }: { doc: Pick<DocumentDto, "kind" | "govState" | "govId" | "govError" | "status"> }) {
  const { t } = useTranslation("fakturownia")
  if ((doc.kind !== "vat" && doc.kind !== "correction") || doc.govState === "not_applicable" || (doc.status !== "issued" && doc.status !== "needs_correction")) return null
  return (
    <ToneBadge tone={govTone(doc.govState)} title={doc.govId ?? doc.govError ?? undefined}>
      {t(`documents.ksefStates.${doc.govState}`)}
    </ToneBadge>
  )
}

export function PaidBadge({ paid }: { paid: boolean }) {
  const { t } = useTranslation("fakturownia")
  return <ToneBadge tone={paid ? "green" : "orange"}>{paid ? t("documents.paid") : t("documents.unpaid")}</ToneBadge>
}

const RUN_TONE: Record<RunStatus, Tone> = { ok: "green", partial: "orange", error: "red" }

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { t } = useTranslation("fakturownia")
  return <ToneBadge tone={RUN_TONE[status] ?? "grey"}>{t(`runs.statuses.${status}`)}</ToneBadge>
}

export function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-y-0.5">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className={clx("txt-compact-small text-ui-fg-base min-w-0 break-words", mono && "font-mono")}>{children}</div>
    </div>
  )
}

/** The Medusa mark (the hexagon of the admin's own login screen), in the text colour. */
export function MedusaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 38" fill="none" aria-hidden className={className}>
      <path
        d="M30.85 6.16832L22.2453 1.21782C19.4299 -0.405941 15.9801 -0.405941 13.1648 1.21782L4.52043 6.16832C1.74473 7.79208 0 10.802 0 14.0099V23.9505C0 27.198 1.74473 30.1683 4.52043 31.7921L13.1251 36.7822C15.9405 38.4059 19.3903 38.4059 22.2056 36.7822L30.8103 31.7921C33.6257 30.1683 35.3307 27.198 35.3307 23.9505V14.0099C35.41 10.802 33.6653 7.79208 30.85 6.16832ZM17.6852 27.8317C12.8079 27.8317 8.8426 23.8713 8.8426 19C8.8426 14.1287 12.8079 10.1683 17.6852 10.1683C22.5625 10.1683 26.5674 14.1287 26.5674 19C26.5674 23.8713 22.6022 27.8317 17.6852 27.8317Z"
        fill="currentColor"
      />
    </svg>
  )
}

/**
 * The store side of a document, a correction or a reminder: its Medusa order,
 * one click away. The order number (#1042) on top, the Medusa id below. In a
 * narrow column the id takes its own line instead of shrinking to "ord...".
 */
export function StoreOrderCell({ orderId, displayId }: { orderId: string; displayId: number | null }) {
  const { t } = useTranslation("fakturownia")
  return (
    <Link to={`/orders/${orderId}`} className="group flex min-w-0 items-center gap-x-2.5" title={t("documents.openOrder")}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ui-bg-component shadow-borders-base transition-fg group-hover:bg-ui-bg-component-hover">
        <MedusaMark className="h-4 w-4 text-ui-fg-base" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="txt-compact-small-plus truncate tabular-nums text-ui-fg-base group-hover:text-ui-fg-interactive">{displayId ? `#${displayId}` : orderId}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
          {displayId ? (
            <span className="min-w-0 grow basis-28 truncate font-mono text-ui-fg-muted txt-compact-xsmall" title={orderId}>
              {orderId}
            </span>
          ) : null}
          <span className="txt-compact-xsmall-plus inline-flex shrink-0 items-center gap-x-0.5 text-ui-fg-interactive">
            {t("documents.openOrder")}
            <ArrowUpRightMini />
          </span>
        </span>
      </span>
    </Link>
  )
}

function downloadPdf(doc: DocumentDto, t: Translate): void {
  void openFile(pdfPath(doc.id), `${doc.number ?? doc.id}.pdf`).catch((err: unknown) => toast.error(t("toast.error", { error: errorMessage(err) })))
}

/** "PDF" and "Open in Fakturownia" (live mode) as links, for the document drawer. */
export function DocumentLinks({ doc }: { doc: DocumentDto }) {
  const { t } = useTranslation("fakturownia")
  if (!doc.fakturowniaUrl && !doc.actions.pdf) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {doc.actions.pdf ? (
        <Button size="small" variant="secondary" onClick={() => downloadPdf(doc, t)}>
          <ArrowDownTray />
          {t("actions.pdf")}
        </Button>
      ) : null}
      {doc.fakturowniaUrl ? (
        <Button size="small" variant="secondary" asChild>
          <a href={doc.fakturowniaUrl} target="_blank" rel="noreferrer">
            <ArrowUpRightOnBox />
            {t("actions.open")}
          </a>
        </Button>
      ) : null}
    </span>
  )
}

/**
 * The actions of one document as `RowActions` items: the writes a document
 * may need ("Retry" for a failed one, "Check in Fakturownia", "Issue again"
 * and "Mark as issued" for an unknown result), each confirmed first, and with
 * `links` the PDF, Fakturownia and the details drawer. `extra` holds the
 * "Mark as issued" drawer: render it next to the actions.
 */
export function useDocumentActions(doc: DocumentDto, { onDone, onOpen, links = false }: { onDone?: () => void; onOpen?: () => void; links?: boolean } = {}): { actions: RowAction[]; extra: ReactNode } {
  const { t } = useTranslation("fakturownia")
  const prompt = usePrompt()
  const action = useFakturowniaDocumentAction()
  const [marking, setMarking] = useState(false)
  const busy = (a: DocumentAction) => action.isPending && action.variables?.id === doc.id && action.variables?.action === a

  const run = async (a: DocumentAction) => {
    if (a !== "check") {
      const confirmed = await prompt({
        title: t(a === "retry" ? "prompts.retry.title" : "prompts.issueAgain.title"),
        description: t(a === "retry" ? "prompts.retry.description" : "prompts.issueAgain.description", { number: doc.displayId ?? doc.orderId }),
        confirmText: t(a === "retry" ? "prompts.retry.confirm" : "prompts.issueAgain.confirm"),
        cancelText: t("actions.cancel"),
        variant: a === "retry" ? "confirmation" : "danger",
      })
      if (!confirmed) return
    }
    try {
      const r = await action.mutateAsync({ id: doc.id, action: a })
      if (a === "check") toast.info(t(`toast.checked.${r.outcome ?? "error"}`, { defaultValue: t("toast.checked.error") }))
      else toast.success(t("toast.queued"))
      onDone?.()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const actions: RowAction[] = [
    { key: "retry", label: t("actions.retry"), icon: <ArrowPath />, loading: busy("retry"), hidden: !doc.actions.retry, onClick: () => void run("retry") },
    { key: "check", label: t("actions.checkRemote"), icon: <MagnifyingGlass />, loading: busy("check"), hidden: !doc.actions.reconcile, onClick: () => void run("check") },
    { key: "issue-again", label: t("actions.issueAgain"), icon: <Bolt />, danger: true, loading: busy("issue-again"), hidden: !doc.actions.issueAgain, onClick: () => void run("issue-again") },
    { key: "mark", label: t("actions.markIssued"), icon: <CheckCircle />, hidden: !doc.actions.markIssued, onClick: () => setMarking(true) },
  ]
  if (links) {
    actions.push(
      { key: "pdf", label: t("actions.pdf"), icon: <ArrowDownTray />, hidden: !doc.actions.pdf, onClick: () => downloadPdf(doc, t) },
      { key: "open", label: t("actions.open"), icon: <ArrowUpRightOnBox />, hidden: !doc.fakturowniaUrl, href: doc.fakturowniaUrl ?? undefined, external: true },
      { key: "details", label: t("documents.details"), icon: <Eye />, hidden: !onOpen, onClick: () => onOpen?.() },
    )
  }
  return { actions, extra: marking ? <MarkIssuedDrawer doc={doc} onClose={() => setMarking(false)} onDone={onDone} /> : null }
}

/** The writes of a document as visible buttons with icons (the drawer). */
export function DocumentActions({ doc, onDone }: { doc: DocumentDto; onDone?: () => void }) {
  const { actions, extra } = useDocumentActions(doc, { onDone })
  const shown = actions.filter((a) => !a.hidden)
  if (!shown.length) return null
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {shown.map((a) => (
        <Button key={a.key} size="small" variant={a.danger ? "danger" : "secondary"} isLoading={a.loading} onClick={() => a.onClick?.()}>
          {a.icon}
          {a.label}
        </Button>
      ))}
      {extra}
    </div>
  )
}

function MarkIssuedDrawer({ doc, onClose, onDone }: { doc: DocumentDto; onClose: () => void; onDone?: () => void }) {
  const { t } = useTranslation("fakturownia")
  const mark = useFakturowniaMarkIssued()
  const [number, setNumber] = useState("")
  const [remoteId, setRemoteId] = useState("")
  const save = async () => {
    try {
      await mark.mutateAsync({ id: doc.id, number: number.trim(), fakturowniaId: remoteId.trim() })
      toast.success(t("toast.marked"))
      onDone?.()
      onClose()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{t("prompts.markIssued.title")}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4">
          <Text size="small" className="text-ui-fg-subtle">
            {t("prompts.markIssued.description", { number: doc.displayId ?? doc.orderId })}
          </Text>
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="fakturownia-number" size="small" weight="plus">
              {t("prompts.markIssued.number")}
            </Label>
            <Input id="fakturownia-number" value={number} placeholder="FV 12/10/2026" onChange={(e) => setNumber(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="fakturownia-id" size="small" weight="plus">
              {t("prompts.markIssued.fakturowniaId")}
            </Label>
            <Input id="fakturownia-id" value={remoteId} inputMode="numeric" placeholder="123456789" onChange={(e) => setRemoteId(e.target.value.replace(/\D/g, ""))} />
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("prompts.markIssued.fakturowniaIdHint")}
            </Text>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.cancel")}
            </Button>
          </Drawer.Close>
          <Button size="small" variant="primary" isLoading={mark.isPending} disabled={!number.trim()} onClick={() => void save()}>
            {t("actions.save")}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

type Translate = (key: string, options?: Record<string, unknown>) => string

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/**
 * The summary of a run in the admin language, built from its counters. Errors
 * keep the stored message: it is the Fakturownia or network text a person needs.
 */
export function runSummary(run: RunDto, t: Translate): string {
  const c = run.counts ?? {}
  if (run.status === "error") return run.message ?? ""
  if (run.kind === "issue") {
    return t("runs.summary.issue", { issued: num(c.issued), adopted: num(c.adopted), retry: num(c.retry), unknown: num(c.unknown), failed: num(c.failed) })
  }
  if (run.kind === "payments") {
    if (run.status === "partial" && Array.isArray(c.errors) && c.errors.length > 0) return run.message ?? ""
    return t("runs.summary.payments", { marked: num(c.marked), already: num(c.alreadyPaid), mismatched: num(c.mismatched) })
  }
  if (run.kind === "corrections") {
    return t("runs.summary.corrections", { checked: num(c.checked), created: num(c.created), updated: num(c.updated), obsolete: num(c.obsolete) })
  }
  if (run.status === "partial" && run.message && num(c.read) === 0) return run.message
  return t("runs.summary.statuses", { read: num(c.read), accepted: num(c.accepted), emailed: num(c.emailsSent), finals: num(c.finalsQueued) })
}

/* ---- 0.2.0 ---------------------------------------------------------- */

export function fmtDate(value: string | null | undefined, lang: string): string {
  if (!value) return ""
  const d = new Date(value.length === 10 ? `${value}T12:00:00Z` : value)
  if (!Number.isFinite(d.getTime())) return ""
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: value.length === 10 ? "UTC" : undefined }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/** Amounts in several currencies, never added together: "199,50 zł, 10,00 €". */
export function fmtMoneyList(list: readonly MoneyDto[], lang: string): string {
  if (list.length === 0) return fmtMoney(0, "PLN", lang)
  return list.map((m) => fmtMoney(m.amount, m.currency, lang)).join(", ")
}

/** A signed amount for a change: "+40,00 zł", "-61,50 zł". */
export function fmtDelta(value: number, currency: string | null | undefined, lang: string): string {
  const text = fmtMoney(Math.abs(value), currency, lang)
  if (Math.abs(value) < 0.005) return text
  return `${value > 0 ? "+" : "-"}${text}`
}

export function fmtQuantity(value: number, lang: string): string {
  return fmtNumber(Math.round(value * 10_000) / 10_000, lang)
}

/** The text of the admin language, or the other one. */
export function pickText(text: LocalizedTextDto | null | undefined, lang: string): string | undefined {
  if (!text) return undefined
  const pl = /^pl/i.test(lang)
  return (pl ? text.pl ?? text.en : text.en ?? text.pl) ?? undefined
}

/** The references of the options in the admin language, for the kit's `References` and `ReferencesBadge`. */
export function referencesFor(items: readonly ReferenceDto[], lang: string): Reference[] {
  return items.map((r) => ({
    name: r.name,
    url: r.url ?? undefined,
    soon: r.soon,
    icon: r.icon,
    description: pickText(r.description, lang),
    metrics: r.metrics.map((m) => ({ label: pickText(m.label, lang) ?? "", value: m.value })).filter((m) => m.label),
    links: r.links.map((l) => ({ label: pickText(l.label, lang) ?? l.url, url: l.url })),
    review: r.review ? { ...r.review, quote: pickText(r.review.quote, lang) || undefined } : null,
  }))
}

/** A rating in the admin's number format: 5.0 or 5,0. */
export function fmtRating(value: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
  } catch {
    return value.toFixed(1)
  }
}

const PLAN_TONE: Record<PlanStatus, Tone> = { draft: "orange", manual: "orange", approved: "blue", issued: "green", dismissed: "grey", done: "green", obsolete: "grey" }

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  const { t } = useTranslation("fakturownia")
  return <ToneBadge tone={PLAN_TONE[status] ?? "grey"}>{t(`corrections.statuses.${status}`)}</ToneBadge>
}

/** Whether a writer writes, is off, or cannot be turned on (the option); `label` names the writer in front. */
export function WriterBadge({ writer, label }: { writer: WriterDto; label?: string }) {
  const { t } = useTranslation("fakturownia")
  const prefix = label ? `${label}: ` : ""
  if (!writer.allowed) {
    return (
      <ToneBadge tone="grey" icon={<LockClosedSolid />}>
        {prefix + t("writers.blocked")}
      </ToneBadge>
    )
  }
  return (
    <ToneBadge tone={writer.armed ? "green" : "orange"} icon={<PencilSquare />}>
      {prefix + (writer.armed ? t("writers.armed") : t("writers.off"))}
    </ToneBadge>
  )
}

/** Why a buyer that looks like a company got a consumer document. */
export function BuyerWarningText({ warning }: { warning: BuyerWarningDto | null }) {
  const { t } = useTranslation("fakturownia")
  if (!warning) return null
  const text =
    warning.code === "invalid_nip"
      ? t("documents.buyerWarning.invalid", { reason: t(`documents.buyerWarning.reasons.${warning.reason ?? "checksum"}`), source: warning.source ?? "?" })
      : warning.code === "nip_on_receipt"
        ? t("documents.buyerWarning.nipOnReceipt", { source: warning.source ?? "?" })
        : t("documents.buyerWarning.companyWithoutNip")
  return (
    <Text size="xsmall" className="text-ui-tag-orange-text">
      {text}
    </Text>
  )
}

/** A framed block with an icon and a label, for the document drawer. */
export function DrawerBlock({ icon, title, children, aside }: { icon?: ReactNode; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-3 rounded-lg border border-ui-border-base bg-ui-bg-component px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-x-2">
          {icon ? <span className="flex shrink-0 text-ui-fg-subtle [&_svg]:size-4">{icon}</span> : null}
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {title}
          </Text>
        </span>
        {aside}
      </div>
      {children}
    </div>
  )
}
