import { useRef, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Text, clx } from "@medusajs/ui"
import type { LocalizedTextDto, MessageDto, ReferenceDto, StatusResponse, TemplateDto } from "../../modules/emails/lib/contract"
import { nb, type Reference } from "./emails-guide"
import { ToneBadge, useDebouncedValue, type Tone } from "./emails-blocks"

/* ------------------------------------------------------------------ */
/* Formats                                                             */
/* ------------------------------------------------------------------ */

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

export function fmtNumber(value: unknown, lang: string, digits = 0): string {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return "0"
  try {
    return new Intl.NumberFormat(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n)
  } catch {
    return String(n)
  }
}

export function fmtKb(bytes: number, lang: string): string {
  return fmtNumber(bytes / 1024, lang, 1)
}

/** The text of the admin language, or the other one. */
export function pickText(text: LocalizedTextDto | null | undefined, lang: string): string {
  if (!text) return ""
  const pl = /^pl/i.test(lang)
  return ((pl ? text.pl ?? text.en : text.en ?? text.pl) ?? "").trim()
}

/** A template's name in the admin language: its own label, else its key. Polish typeset. */
export function templateLabel(t: Pick<TemplateDto, "key" | "label"> | undefined, lang: string, fallback = ""): string {
  if (!t) return fallback
  const s = pickText(t.label, lang) || t.key
  return /^pl/i.test(lang) ? nb(s) : s
}

export function templateDescription(t: Pick<TemplateDto, "description"> | undefined, lang: string): string {
  const s = t ? pickText(t.description, lang) : ""
  return /^pl/i.test(lang) ? nb(s) : s
}

export function fmtRating(value: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
  } catch {
    return value.toFixed(1)
  }
}

/** The references of the options in the admin language, for the kit's `References` and `ReferencesBadge`. */
export function referencesFor(items: readonly ReferenceDto[], lang: string): Reference[] {
  return items.map((r) => ({
    name: r.name,
    url: r.url ?? undefined,
    soon: r.soon,
    icon: r.icon,
    description: pickText(r.description, lang) || undefined,
    metrics: r.metrics.map((m) => ({ label: pickText(m.label, lang), value: m.value })).filter((m) => m.label),
    links: r.links.map((l) => ({ label: pickText(l.label, lang) || l.url, url: l.url })),
    review: r.review ? { ...r.review, quote: pickText(r.review.quote, lang) || undefined } : null,
  }))
}

/* ------------------------------------------------------------------ */
/* The state of the whole module, for the mode badge                  */
/* ------------------------------------------------------------------ */

/**
 * The badge in the header. The provider decides what happens to an e-mail,
 * so when the provider of this process runs in another mode than the plugin
 * options say, the badge says so in red instead of "Demo mode".
 */
export function modeState(s: StatusResponse | undefined): { key: "demo" | "live" | "dev" | "app" | "appMissing" | "notConfigured" | "unknown" | "mismatch"; tone: Tone } {
  if (!s) return { key: "unknown", tone: "grey" }
  /* App mode: the store's own provider sends; red only when Medusa has it off the email channel. */
  if (s.mode === "app") return s.provider.app?.serving === false ? { key: "appMissing", tone: "red" } : { key: "app", tone: "green" }
  if (s.provider.loaded && s.provider.mode && s.provider.mode !== s.mode) return { key: "mismatch", tone: "red" }
  if (s.mode === "demo") return { key: "demo", tone: "blue" }
  if (s.mode === "dev") return { key: "dev", tone: "orange" }
  if (!s.configured || !s.provider.loaded) return { key: "notConfigured", tone: "red" }
  return { key: "live", tone: "green" }
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

const STATUS_TONE: Record<string, Tone> = { sent: "green", sending: "blue", failed: "red", unknown: "orange", skipped: "grey" }

export function MessageStatusBadge({ message, demo }: { message: Pick<MessageDto, "status" | "kind">; demo: boolean }) {
  const { t } = useTranslation("emails")
  const key = demo && message.status === "sent" ? "simulated" : message.status
  return <ToneBadge tone={STATUS_TONE[message.status] ?? "grey"}>{t(`log.statuses.${key}`, { defaultValue: message.status })}</ToneBadge>
}

export function KindBadge({ kind }: { kind: string }) {
  const { t } = useTranslation("emails")
  /* Where a message came from (the store's provider, Medusa's history) says nothing to the office: only test and demo sends are marked. */
  if (kind === "event" || kind === "app" || kind === "medusa") return null
  /* Purple only for the demo sample rows: a highlight, never a state. */
  const tone: Record<string, Tone> = { test: "blue", seed: "purple", job: "grey" }
  return <ToneBadge tone={tone[kind] ?? "grey"}>{t(`log.kinds.${kind}`, { defaultValue: kind })}</ToneBadge>
}

export function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-y-0.5">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className={clx("txt-compact-small min-w-0 break-words text-ui-fg-base", mono && "font-mono")}>{children}</div>
    </div>
  )
}

export function OnOff({ on, labels }: { on: boolean; labels: [string, string] }) {
  return <ToneBadge tone={on ? "green" : "grey"}>{on ? labels[0] : labels[1]}</ToneBadge>
}

/** The kit's debounced value, trimmed: the log asks the server after a pause, not per letter. */
export function useDebounced(value: string, ms = 300): string {
  return useDebouncedValue(value, ms).trim()
}

/**
 * A rendered e-mail in a sandboxed frame (no scripts), as tall as the e-mail
 * itself, on a desktop width or a phone width.
 */
export function EmailFrame({ html, title, width, minHeight = 360 }: { html: string; title: string; width: "desktop" | "mobile"; minHeight?: number }) {
  const ref = useRef<HTMLIFrameElement | null>(null)
  const fit = () => {
    const frame = ref.current
    const doc = frame?.contentDocument
    if (!frame || !doc) return
    frame.style.height = `${Math.max(minHeight, doc.documentElement.scrollHeight)}px`
  }
  return (
    <iframe
      ref={ref}
      key={`${width}-${html.length}`}
      srcDoc={html}
      title={title}
      sandbox="allow-same-origin"
      className="rounded-md bg-ui-bg-base shadow-elevation-card-rest"
      style={{ display: "block", width: width === "mobile" ? 390 : "100%", maxWidth: "100%", height: minHeight, border: 0 }}
      onLoad={() => {
        fit()
        ref.current?.contentDocument?.fonts?.ready.then(fit).catch(() => undefined)
      }}
    />
  )
}

/** Explains a code of the send log in the admin language, or shows the code. */
export function useErrorText(): (code: string | null | undefined) => string {
  const { t } = useTranslation("emails")
  return (code) => (code ? t(`errors.${code}`, { defaultValue: "" }) : "")
}
