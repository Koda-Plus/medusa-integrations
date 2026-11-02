import type { ProblemDto, WriterDto, WriterKey } from "../../modules/dpd/lib/contract"

/**
 * The plain logic of the admin: no React, no kit, no DOM, so `node --test`
 * loads it (the .tsx files around it it cannot). Errors of the admin API,
 * money, the refused fields of the boxes, the writers and the label file.
 */

export class DpdRequestError extends Error {
  readonly status: number
  readonly code: string | null
  /** The JSON body of the answer, null when it was not JSON (the boxes route lists its refused fields here). */
  readonly body: unknown
  constructor(status: number, message: string, code: string | null, body: unknown = null) {
    super(message)
    this.name = "DpdRequestError"
    this.status = status
    this.code = code
    this.body = body
  }
}

/** The JSON of an answer's text, or null. */
export function parseJson(text: string): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : null
  } catch {
    return null
  }
}

/** The error of an answer that is not ok: the server's code and message from its JSON body (ErrorResponse). */
export function requestError(status: number, text: string): DpdRequestError {
  const json = parseJson(text)
  const body = (json && typeof json === "object" ? json : {}) as { message?: unknown; code?: unknown }
  return new DpdRequestError(status, typeof body.message === "string" ? body.message : `HTTP ${status}`, typeof body.code === "string" ? body.code : null, json)
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

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

/**
 * An amount in minor units (grosze, cents) in the admin's format: 12345 PLN
 * is "123,45 zł" in Polish. Minor units are always hundredths, as the server
 * counts them (toMinor and formatMinor of money.ts), whatever the currency
 * says of its own digits: 1000 JPY minor units are 10 yen there, so here too.
 */
export function fmtMinor(minor: number, currency: string, lang: string): string {
  const abs = Math.abs(Math.trunc(minor))
  const amount = `${minor < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`
  return fmtMoney(amount, currency, lang)
}

/** The `amount` of a warning (order_paid), when the server sent a usable one. */
export function moneyOf(value: unknown): { minor: number; currency: string } | null {
  if (!value || typeof value !== "object") return null
  const v = value as { minor?: unknown; currency?: unknown }
  if (typeof v.minor !== "number" || !Number.isFinite(v.minor) || typeof v.currency !== "string" || !/^[A-Za-z]{3}$/.test(v.currency)) return null
  return { minor: v.minor, currency: v.currency }
}

/**
 * The value a problem or warning text puts in {{detail}}: its amount in the
 * admin's language when it has one (order_paid), else the detail the server
 * wrote for its logs, else the field.
 */
export function problemDetail(p: ProblemDto & { amount?: unknown }, lang: string): string {
  const money = moneyOf(p.amount)
  if (money) return fmtMinor(money.minor, money.currency, lang)
  return p.detail ?? p.field ?? ""
}

/* ------------------------------------------------------------------ */
/* The boxes refused by POST .../boxes                                 */
/* ------------------------------------------------------------------ */

/** The fields of a box as the boxes DTO names them; each has its words under plan.boxFields. */
export const BOX_FIELDS = ["weightKg", "lengthCm", "widthCm", "heightCm"] as const
export type BoxField = (typeof BOX_FIELDS)[number]

/** Other names a server may give the same field (the DPD request calls the sides sizeX, sizeY, sizeZ). */
const FIELD_ALIASES: Record<string, BoxField> = {
  weight: "weightKg",
  sizeX: "lengthCm",
  sizeXCm: "lengthCm",
  sizeY: "widthCm",
  sizeYCm: "widthCm",
  sizeZ: "heightCm",
  sizeZCm: "heightCm",
}

export type BoxFieldError = { index: number; field: string }

/**
 * The refused fields of a 400 of POST .../boxes, `fields` of its body: a
 * zero based box index and a field name. Entries of another shape are left
 * out; an empty list means the admin shows the server's message instead.
 */
export function boxFieldErrors(body: unknown): BoxFieldError[] {
  if (!body || typeof body !== "object") return []
  const fields = (body as { fields?: unknown }).fields
  if (!Array.isArray(fields)) return []
  const out: BoxFieldError[] = []
  for (const f of fields) {
    if (!f || typeof f !== "object") continue
    const { index, field } = f as { index?: unknown; field?: unknown }
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || typeof field !== "string" || !field) continue
    out.push({ index, field: FIELD_ALIASES[field] ?? field })
  }
  return out
}

export function isBoxField(field: string): field is BoxField {
  return (BOX_FIELDS as readonly string[]).includes(field)
}

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

/** The writers that write nothing yet in this version; the shipment writer already creates shipments. */
export const LATER_WRITERS: readonly WriterKey[] = ["pickup", "fulfillmentStatus"]

export function isLaterWriter(key: WriterKey): boolean {
  return LATER_WRITERS.includes(key)
}

/**
 * The writers that write now: armed (allowed and on) and used by this
 * version. An armed later writer writes nothing yet, so the header does not
 * count it as writing.
 */
export function writingWriters<W extends Pick<WriterDto, "key" | "armed">>(writers: Partial<Record<WriterKey, W>> | undefined): W[] {
  if (!writers) return []
  return Object.values(writers).filter((w): w is W => w !== undefined && w.armed && !isLaterWriter(w.key))
}

/**
 * Why a call to DPD cannot run: "off" when the options turn the shipment
 * writer off (arming it in Settings would not help), "not_armed" when a
 * person has not armed it, null when it writes. Without the writer (not
 * loaded yet) only `armed` counts.
 */
export function writerBlock(writer: Pick<WriterDto, "allowed"> | undefined, armed: boolean): "off" | "not_armed" | null {
  if (writer && !writer.allowed) return "off"
  return armed ? null : "not_armed"
}

/* ------------------------------------------------------------------ */
/* The label file                                                      */
/* ------------------------------------------------------------------ */

/** The file name of a label: the one of Content-Disposition when it is readable and plain, else the fallback. */
export function labelFileName(disposition: string | null, fallback: string): string {
  const m = disposition?.match(/filename="?([^";]+)"?/i)
  const name = m?.[1]?.trim() ?? ""
  return /^[\w.-]{1,120}\.pdf$/i.test(name) ? name : fallback
}

export type LabelFetcher = (url: string, init: RequestInit) => Promise<Response>

/**
 * The stored label PDF, fetched with the admin's auth (`init`, from the kit:
 * the session cookie or the JWT a bare URL in a new tab never carries). An
 * answer that is not ok throws DpdRequestError with the server's code, so a
 * removed or missing label reads as no_label.
 */
export async function fetchLabelFile(fetcher: LabelFetcher, url: string, init: RequestInit, fallbackName = "dpd-label.pdf"): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetcher(url, init)
  if (!res.ok) throw requestError(res.status, await res.text())
  const raw = await res.blob()
  const blob = raw.type === "application/pdf" ? raw : new Blob([raw], { type: "application/pdf" })
  return { blob, fileName: labelFileName(res.headers.get("content-disposition"), fallbackName) }
}
