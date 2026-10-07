import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Badge, Button, Drawer, Input, Label, StatusBadge, Text, clx, toast, usePrompt } from "@medusajs/ui"
import { ArrowUpRightMini, ArrowUpRightOnBox } from "@medusajs/icons"
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
import { errorMessage, openFile, pdfPath, useFakturowniaDocumentAction, useFakturowniaMarkIssued, type DocumentAction } from "./fakturownia-api"

type Tone = "green" | "orange" | "red" | "grey" | "blue" | "purple"

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
  if (s.mode === "demo") return { key: "demo", tone: "purple" }
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

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const { t } = useTranslation("fakturownia")
  return <StatusBadge color={STATUS_TONE[status] ?? "grey"}>{t(`documents.statuses.${status}`)}</StatusBadge>
}

const KIND_TONE: Record<DocumentKind, "blue" | "purple" | "grey" | "orange"> = { vat: "blue", proforma: "purple", receipt: "grey", correction: "orange" }

export function KindBadge({ kind }: { kind: DocumentKind }) {
  const { t } = useTranslation("fakturownia")
  return (
    <Badge size="2xsmall" color={KIND_TONE[kind] ?? "grey"} className="whitespace-nowrap">
      {t(`documents.kinds.${kind}`)}
    </Badge>
  )
}

const GOV_TONE: Record<GovState, Tone> = { none: "grey", processing: "blue", accepted: "green", problem: "red", not_applicable: "grey", offline: "orange" }

/** The KSeF state of a VAT invoice or a correction; nothing for kinds KSeF does not take. */
export function KsefBadge({ doc }: { doc: Pick<DocumentDto, "kind" | "govState" | "govId" | "govError" | "status"> }) {
  const { t } = useTranslation("fakturownia")
  if ((doc.kind !== "vat" && doc.kind !== "correction") || doc.govState === "not_applicable" || (doc.status !== "issued" && doc.status !== "needs_correction")) return null
  return (
    <span title={doc.govId ?? doc.govError ?? undefined}>
      <StatusBadge color={GOV_TONE[doc.govState] ?? "grey"}>{t(`documents.ksefStates.${doc.govState}`)}</StatusBadge>
    </span>
  )
}

export function PaidBadge({ paid }: { paid: boolean }) {
  const { t } = useTranslation("fakturownia")
  return (
    <Badge size="2xsmall" color={paid ? "green" : "orange"}>
      {paid ? t("documents.paid") : t("documents.unpaid")}
    </Badge>
  )
}

const RUN_TONE: Record<RunStatus, Tone> = { ok: "green", partial: "orange", error: "red" }

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { t } = useTranslation("fakturownia")
  return <StatusBadge color={RUN_TONE[status] ?? "grey"}>{t(`runs.statuses.${status}`)}</StatusBadge>
}

export function StatTile({
  label,
  value,
  tone = "default",
  active = false,
  onClick,
}: {
  label: string
  value: ReactNode
  tone?: "default" | "green" | "orange" | "red"
  active?: boolean
  onClick?: () => void
}) {
  const dot =
    tone === "green" ? "bg-ui-tag-green-icon" : tone === "orange" ? "bg-ui-tag-orange-icon" : tone === "red" ? "bg-ui-tag-red-icon" : "bg-ui-fg-muted"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={clx(
        "flex h-full flex-col items-start justify-between gap-y-1 rounded-lg border px-4 py-3 text-left transition-fg",
        "border-ui-border-base bg-ui-bg-component",
        onClick ? "hover:bg-ui-bg-component-hover cursor-pointer" : "cursor-default",
        active && "border-ui-border-interactive shadow-borders-interactive-with-active",
      )}
    >
      <span className="flex items-center gap-x-1.5">
        <span className={clx("h-1.5 w-1.5 rounded-full", dot)} />
        <Text size="xsmall" className="text-ui-fg-subtle">
          {label}
        </Text>
      </span>
      <Text size="xlarge" weight="plus" className="tabular-nums text-ui-fg-base">
        {value}
      </Text>
    </button>
  )
}

export function FilterPills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string; count?: number }>
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clx(
            "txt-compact-small-plus inline-flex items-center gap-x-1.5 rounded-full border px-3 py-1 transition-fg",
            value === o.value
              ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color"
              : "border-ui-border-base bg-ui-bg-component text-ui-fg-subtle hover:bg-ui-bg-component-hover",
          )}
        >
          {o.label}
          {typeof o.count === "number" ? <span className="tabular-nums opacity-80">{o.count}</span> : null}
        </button>
      ))}
    </div>
  )
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

/** "Open in Fakturownia" (live mode) and the PDF streamed by the backend. */
export function DocumentLinks({ doc }: { doc: DocumentDto }) {
  const { t } = useTranslation("fakturownia")
  if (!doc.fakturowniaUrl && !doc.actions.pdf) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {doc.actions.pdf ? (
        <button
          type="button"
          className="inline-flex items-center gap-x-1 txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
          onClick={() =>
            void openFile(pdfPath(doc.id), `${doc.number ?? doc.id}.pdf`).catch((err: unknown) => toast.error(t("toast.error", { error: errorMessage(err) })))
          }
        >
          {t("actions.pdf")}
          <ArrowUpRightOnBox className="shrink-0" />
        </button>
      ) : null}
      {doc.fakturowniaUrl ? (
        <a href={doc.fakturowniaUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-x-1 txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {t("actions.open")}
          <ArrowUpRightOnBox className="shrink-0" />
        </a>
      ) : null}
    </span>
  )
}

/**
 * What a person can do with a document that needs one: "Retry" (failed),
 * "Check in Fakturownia", "Issue again" and "Mark as issued" (unknown).
 * Every write asks for a confirmation first.
 */
export function DocumentActions({ doc, onDone }: { doc: DocumentDto; onDone?: () => void }) {
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

  if (!doc.actions.retry && !doc.actions.reconcile && !doc.actions.issueAgain && !doc.actions.markIssued) return null
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {doc.actions.retry ? (
        <Button size="small" variant="secondary" isLoading={busy("retry")} onClick={() => void run("retry")}>
          {t("actions.retry")}
        </Button>
      ) : null}
      {doc.actions.reconcile ? (
        <Button size="small" variant="secondary" isLoading={busy("check")} onClick={() => void run("check")}>
          {t("actions.checkRemote")}
        </Button>
      ) : null}
      {doc.actions.issueAgain ? (
        <Button size="small" variant="secondary" isLoading={busy("issue-again")} onClick={() => void run("issue-again")}>
          {t("actions.issueAgain")}
        </Button>
      ) : null}
      {doc.actions.markIssued ? (
        <Button size="small" variant="transparent" onClick={() => setMarking(true)}>
          {t("actions.markIssued")}
        </Button>
      ) : null}
      {marking ? <MarkIssuedDrawer doc={doc} onClose={() => setMarking(false)} onDone={onDone} /> : null}
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
  return <StatusBadge color={PLAN_TONE[status] ?? "grey"}>{t(`corrections.statuses.${status}`)}</StatusBadge>
}

/** Whether a writer writes, is off, or cannot be turned on (the option). */
export function WriterBadge({ writer }: { writer: WriterDto }) {
  const { t } = useTranslation("fakturownia")
  if (!writer.allowed) return <StatusBadge color="grey">{t("writers.blocked")}</StatusBadge>
  return <StatusBadge color={writer.armed ? "green" : "orange"}>{writer.armed ? t("writers.armed") : t("writers.off")}</StatusBadge>
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

/** A small framed block with a label, for the drawers. */
export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-3 rounded-lg border border-ui-border-base bg-ui-bg-component px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text size="small" weight="plus" className="text-ui-fg-base">
          {title}
        </Text>
        {aside}
      </div>
      {children}
    </div>
  )
}
