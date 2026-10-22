import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArchiveBox, ArrowUpRightMini, ArrowUpRightOnBox, Cash, TruckFast } from "@medusajs/icons"
import { Copy, Text, clx } from "@medusajs/ui"
import type { ParcelDto, ParcelEventDto, ProblemDto, ReferenceDto, ShipmentStage, StatusResponse } from "../../modules/inpost/lib/contract"
import { pickText } from "../../modules/inpost/lib/references"
import { ToneBadge, type Tone } from "./inpost-blocks"
import { nb, type Reference } from "./inpost-guide"

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

export function fmtNumber(value: unknown, lang: string): string {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return "0"
  try {
    return new Intl.NumberFormat(lang).format(n)
  } catch {
    return String(n)
  }
}

/** "199.99" and "PLN" in the admin's format: "199,99 zł" or "PLN 199.99". */
export function fmtMoney(amount: string | null | undefined, currency: string | null | undefined, lang: string): string {
  if (amount === null || amount === undefined || amount === "") return ""
  const n = Number(amount)
  if (!Number.isFinite(n)) return amount
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: (currency || "PLN").toUpperCase() }).format(n)
  } catch {
    return `${amount} ${currency ?? ""}`.trim()
  }
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 s"
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}

/** A rating in the admin's number format: 5.0 or 5,0. */
export function fmtRating(value: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
  } catch {
    return value.toFixed(1)
  }
}

/** References of the option in the admin language, shaped for the kit. */
export function kitReferences(refs: ReferenceDto[], lang: string): Reference[] {
  return refs.map((r) => ({
    name: r.name,
    url: r.url ?? undefined,
    soon: r.soon,
    icon: r.icon,
    description: pickText(r.description, lang) || undefined,
    metrics: r.metrics.map((m) => ({ label: pickText(m.label, lang), value: m.value })),
    links: r.links.map((l) => ({ label: pickText(l.label, lang), url: l.url })),
    review: r.review ? { ...r.review, quote: pickText(r.review.quote, lang) || undefined } : null,
  }))
}

/** The mode of the module in one word, for the header badge. */
export function modeOf(s: StatusResponse | undefined): { key: string; tone: Tone } {
  if (!s) return { key: "unknown", tone: "grey" }
  if (s.mode === "demo") return { key: "demo", tone: "blue" }
  if (!s.configured) return { key: "notConfigured", tone: "orange" }
  if (s.lastCheck && !s.lastCheck.ok) return { key: "error", tone: "red" }
  if (s.sandbox) return { key: "sandbox", tone: "orange" }
  return { key: "live", tone: "green" }
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

const STAGE_TONE: Record<ShipmentStage, Tone> = {
  preparing: "blue",
  ready: "orange",
  in_transit: "blue",
  in_locker: "blue",
  delivered: "green",
  problem: "red",
  returned: "red",
  canceled: "grey",
}

const STATE_TONE: Record<string, Tone> = { pending: "orange", creating: "blue", failed: "red", unknown: "red", skipped: "grey", canceled: "grey", created: "green" }

/** The ShipX status name in the admin language (the raw name for a status InPost added later). */
export function useStatusName(): (status: string | null | undefined) => string {
  const { t } = useTranslation("inpost")
  return (status) => (status ? t(`status.${status}`, { defaultValue: status.replace(/_/g, " ") }) : "")
}

/**
 * One history line in the admin language: statuses by their names, actions
 * from the data the server records with them. The server's own message (in
 * English) is the fallback, which keeps ShipX's errors as ShipX wrote them.
 */
export function useEventText(): (e: ParcelEventDto) => string {
  const { t, i18n } = useTranslation("inpost")
  const statusName = useStatusName()
  return (e) => {
    if (e.kind === "status" && e.status) return statusName(e.status)
    if (e.kind === "webhook") return t("detail.webhook", { status: e.status ? statusName(e.status) : "" })
    const d = (e.data ?? {}) as Record<string, unknown>
    const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "")
    if (typeof d.action === "string") {
      const base = `history.actions.${d.action}${typeof d.outcome === "string" ? `_${d.outcome}` : ""}`
      const key = e.demo && i18n.exists(`${base}_demo`, { ns: "inpost" }) ? `${base}_demo` : base
      if (i18n.exists(key, { ns: "inpost" })) {
        return t(key, {
          shipment: e.shipmentId ?? "",
          offer: text(d.offer),
          dispatch: text(d.dispatch_order),
          from: text(d.from) || t("plan.none"),
          to: text(d.to),
          size: typeof d.size === "string" ? t(`size.long.${d.size}`, { defaultValue: d.size }) : "",
          guard: text(d.guard),
        })
      }
    }
    return e.message ?? t(`detail.kind.${e.kind}`, { defaultValue: e.kind })
  }
}

/** Who did it: a person's name, or the plugin itself. */
export function useActorLabel(): (actor: string | null | undefined) => string | null {
  const { t } = useTranslation("inpost")
  return (actor) => (!actor ? null : actor === "system" ? t("detail.system") : actor === "external" ? t("detail.external") : actor)
}

/** One badge for a row: our state before the shipment exists, the ShipX status after. */
export function ParcelStatus({ parcel }: { parcel: Pick<ParcelDto, "state" | "status" | "stage" | "offer"> }) {
  const { t } = useTranslation("inpost")
  const statusName = useStatusName()
  if (parcel.state !== "created" || !parcel.status) {
    return <ToneBadge tone={STATE_TONE[parcel.state] ?? "grey"}>{t(`state.${parcel.state}`)}</ToneBadge>
  }
  const tone = parcel.status === "offers_prepared" ? "orange" : STAGE_TONE[parcel.stage ?? "in_transit"]
  return (
    <ToneBadge tone={tone} title={parcel.status}>
      {parcel.status === "offers_prepared" ? t("parcels.awaitingPayment") : statusName(parcel.status)}
    </ToneBadge>
  )
}

/** Locker or courier, cash on delivery, the size letter. */
export function KindBadges({ parcel }: { parcel: Pick<ParcelDto, "kind" | "cod" | "size"> }) {
  const { t } = useTranslation("inpost")
  return (
    <span className="flex flex-wrap items-center gap-1">
      <ToneBadge icon={parcel.kind === "locker" ? <ArchiveBox /> : <TruckFast />}>{t(`kind.${parcel.kind}`)}</ToneBadge>
      {parcel.cod ? (
        <ToneBadge tone="blue" icon={<Cash />}>
          {t("kind.cod")}
        </ToneBadge>
      ) : null}
      {parcel.size ? <ToneBadge title={t(`size.long.${parcel.size}`)}>{t(`size.letter.${parcel.size}`)}</ToneBadge> : null}
    </span>
  )
}

/** The Medusa order of a row, one click away. */
export function OrderCell({ orderId, displayId }: { orderId: string; displayId: number | null }) {
  const { t } = useTranslation("inpost")
  return (
    <Link to={`/orders/${orderId}`} className="group flex items-center gap-x-2.5" title={t("actions.openOrder")}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ui-bg-component shadow-borders-base transition-fg group-hover:bg-ui-bg-component-hover">
        <MedusaMark className="h-3.5 w-3.5 text-ui-fg-base" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="txt-compact-small-plus truncate text-ui-fg-base group-hover:text-ui-fg-interactive">{displayId !== null ? `#${displayId}` : orderId}</span>
        <span className="txt-compact-xsmall-plus inline-flex items-center gap-x-0.5 whitespace-nowrap text-ui-fg-interactive">
          {t("actions.openOrder")}
          <ArrowUpRightMini />
        </span>
      </span>
    </Link>
  )
}

/** The tracking number with its link (live rows) and a copy button. */
export function TrackingCell({ parcel }: { parcel: Pick<ParcelDto, "trackingNumber" | "trackingUrl" | "demo"> }) {
  const { t } = useTranslation("inpost")
  if (!parcel.trackingNumber) return <span className="text-ui-fg-muted">&nbsp;</span>
  return (
    <span className="flex items-center gap-x-1">
      {parcel.trackingUrl ? (
        <a href={parcel.trackingUrl} target="_blank" rel="noreferrer" className="txt-compact-small inline-flex items-center gap-x-0.5 font-mono text-ui-fg-interactive hover:text-ui-fg-interactive-hover" title={t("actions.track")}>
          {parcel.trackingNumber}
          <ArrowUpRightOnBox className="h-3.5 w-3.5 shrink-0" />
        </a>
      ) : (
        <span className="txt-compact-small font-mono text-ui-fg-subtle" title={parcel.demo ? t("parcels.sampleTracking") : undefined}>
          {parcel.trackingNumber}
        </span>
      )}
      <Copy content={parcel.trackingNumber} className="text-ui-fg-muted" />
    </span>
  )
}

/** Plan problems or warnings, translated; an unknown code falls back to the code. */
export function ProblemList({ items, tone = "error", kind = "problem" }: { items: ProblemDto[]; tone?: "error" | "warning"; kind?: "problem" | "warning" }) {
  const { t, i18n } = useTranslation("inpost")
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-y-0.5">
      {items.map((p, i) => {
        const key = `${kind}.${p.code}`
        const text = i18n.exists(key, { ns: "inpost" }) ? t(key, { detail: p.detail ?? "" }) : `${p.code}${p.detail ? `: ${p.detail}` : ""}`
        return (
          <li key={`${p.code}-${i}`} className="flex gap-x-1.5">
            <span className={clx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", tone === "error" ? "bg-ui-tag-red-icon" : "bg-ui-tag-orange-icon")} />
            <Text size="xsmall" className="text-ui-fg-subtle">
              {text}
            </Text>
          </li>
        )
      })}
    </ul>
  )
}

/** A label over a value, for facts in sections and drawers. */
export function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-y-0.5">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className={clx("txt-small text-ui-fg-base", mono && "break-all font-mono")}>{children}</div>
    </div>
  )
}

/** The locker in two lines, with its map link. */
export function LockerLines({ locker }: { locker: ParcelDto["locker"] }) {
  const { t } = useTranslation("inpost")
  if (!locker) return null
  const second = locker.address ? locker.address.line2 || [locker.address.post_code, locker.address.city].filter(Boolean).join(" ") : ""
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex items-center gap-x-1.5">
        <span className="txt-compact-small-plus font-mono text-ui-fg-base">{locker.code}</span>
        {locker.mapUrl ? (
          <a href={locker.mapUrl} target="_blank" rel="noreferrer" className="txt-compact-xsmall-plus inline-flex items-center gap-x-0.5 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("actions.openMap")}
            <ArrowUpRightOnBox className="h-3 w-3" />
          </a>
        ) : null}
      </span>
      {locker.address ? (
        <span className="txt-compact-xsmall truncate text-ui-fg-subtle">{nb([locker.address.line1, second].filter(Boolean).join(", "))}</span>
      ) : null}
    </span>
  )
}
