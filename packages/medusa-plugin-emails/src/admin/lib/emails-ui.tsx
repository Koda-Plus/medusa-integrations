import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Badge, StatusBadge, Table, Text, clx } from "@medusajs/ui"
import type { LocalizedTextDto, MessageDto, ReferenceDto, StatusResponse, TemplateDto } from "../../modules/emails/lib/contract"
import { nb, type Reference } from "./emails-guide"

type Tone = "green" | "orange" | "red" | "grey" | "blue" | "purple"

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

export function modeState(s: StatusResponse | undefined): { key: "demo" | "live" | "dev" | "notConfigured" | "unknown"; tone: Tone } {
  if (!s) return { key: "unknown", tone: "grey" }
  if (s.mode === "demo") return { key: "demo", tone: "purple" }
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
  return <StatusBadge color={STATUS_TONE[message.status] ?? "grey"}>{t(`log.statuses.${key}`, { defaultValue: message.status })}</StatusBadge>
}

export function KindBadge({ kind }: { kind: string }) {
  const { t } = useTranslation("emails")
  if (kind === "event") return null
  const tone: Record<string, "blue" | "purple" | "grey" | "orange"> = { test: "blue", seed: "purple", job: "grey", app: "orange" }
  return (
    <Badge size="2xsmall" color={tone[kind] ?? "grey"}>
      {t(`log.kinds.${kind}`, { defaultValue: kind })}
    </Badge>
  )
}

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  active = false,
  onClick,
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: "default" | "green" | "orange" | "red" | "blue"
  active?: boolean
  onClick?: () => void
}) {
  const dot =
    tone === "green" ? "bg-ui-tag-green-icon" : tone === "orange" ? "bg-ui-tag-orange-icon" : tone === "red" ? "bg-ui-tag-red-icon" : tone === "blue" ? "bg-ui-tag-blue-icon" : "bg-ui-fg-muted"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={clx(
        "flex h-full flex-col items-start justify-between gap-y-1 rounded-lg border px-4 py-3 text-left transition-fg",
        "border-ui-border-base bg-ui-bg-component",
        onClick ? "cursor-pointer hover:bg-ui-bg-component-hover" : "cursor-default",
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
      {hint ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {hint}
        </Text>
      ) : null}
    </button>
  )
}

export function FilterPills<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string; count?: number; disabled?: boolean }>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={clx(
            "txt-compact-small-plus inline-flex items-center gap-x-1.5 rounded-full border px-3 py-1 transition-fg disabled:cursor-not-allowed disabled:opacity-50",
            value === o.value ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color" : "border-ui-border-base bg-ui-bg-component text-ui-fg-subtle hover:bg-ui-bg-component-hover",
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
    <div className="flex min-w-0 flex-col gap-y-0.5">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className={clx("txt-compact-small min-w-0 break-words text-ui-fg-base", mono && "font-mono")}>{children}</div>
    </div>
  )
}

export function OnOff({ on, labels }: { on: boolean; labels: [string, string] }) {
  return (
    <Badge size="2xsmall" color={on ? "green" : "grey"}>
      {on ? labels[0] : labels[1]}
    </Badge>
  )
}

export function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <Table.Row>
      <td colSpan={cols} className="px-6 py-6 text-center">
        <Text size="small" className="text-ui-fg-muted">
          {text}
        </Text>
      </td>
    </Table.Row>
  )
}

export function useDebounced(value: string, ms = 300): string {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value.trim()), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return out
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
