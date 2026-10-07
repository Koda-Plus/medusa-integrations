import {
  DEFAULT_COD_PROVIDERS,
  DEFAULT_LANG,
  DEFAULT_PAYMENT_TERM_DAYS,
  DEFAULT_QUANTITY_UNIT,
  DEFAULT_RECEIPT_KIND,
  DEFAULT_REMINDER_AFTER_DAYS,
  DEFAULT_REQUESTS_PER_MINUTE,
  DEFAULT_SHIPPING_POSITION_NAME,
  DEFAULT_TAX_ID_METADATA_KEYS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_VAT_RATE,
  FAKTUROWNIA_DOMAIN,
  MAX_REQUESTS_PER_MINUTE,
} from "./constants"
import { resolveNipSources, type NipSource } from "./nip"
import { resolveReferences, type ReferenceOption, type ResolvedReference } from "./references"
import { WRITERS, type WriterKey } from "./writers"

/**
 * Options of `@koda-plus/medusa-plugin-fakturownia`, passed in `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-fakturownia", options: { ... } }]
 *
 * Every key is optional. Missing values never break the boot: without an API
 * token the plugin registers, says "not configured" in the admin (in red) and
 * issues nothing. Demo mode (a simulated Fakturownia account) runs ONLY with
 * `demo: true`: a token lost on production must never turn real orders into
 * simulated documents.
 *
 * Numbers may come as strings (environment variables), lists as comma
 * separated strings.
 */
export type DocumentFlow = "vat" | "proforma_then_vat"
export type IssueTrigger = "payment_captured" | "order_placed"
/** A Fakturownia `tax` value: a rate in percent, or "zw" (exempt), "np" (not subject), "oo" (reverse charge). */
export type TaxValue = number | "zw" | "np" | "oo"

export interface FakturowniaPluginOptions {
  /** API token (Fakturownia: Ustawienia, Ustawienia konta, Integracja, Kod autoryzacyjny API). Never leaves the server. */
  apiToken?: string
  /** The account subdomain: "mojafirma" for https://mojafirma.fakturownia.pl. The full address works too. */
  account?: string
  /** Simulated account, nothing leaves Medusa. Only when set to true (default false, also without a token). */
  demo?: boolean | string
  /** "vat" (default): the final document at the trigger. "proforma_then_vat": a proforma at the trigger, the final document after the first fulfillment. */
  documentFlow?: DocumentFlow | string
  /** "payment_captured" (default) or "order_placed". */
  trigger?: IssueTrigger | string
  /** Buyers without a tax ID get a receipt instead of a VAT invoice. Default false. */
  receiptForConsumers?: boolean | string
  /** The API `kind` of a receipt. Default "receipt". */
  receiptKind?: string
  /** Rate for a line without Medusa tax lines. Default 23. */
  defaultVatRate?: number | string
  /** Document language ("pl", "en", "de", "pl/en"...). Default "pl". */
  lang?: string
  /** "Miejsce wystawienia" printed on the document. The API does not take it from the account settings. */
  issuePlace?: string
  /** Seller department (Ustawienia, Dane firmy). Default: the main company of the account. */
  departmentId?: number | string
  /** Income category of the documents. */
  categoryId?: number | string
  /** Name of the shipping position when the shipping method has none. Default "Dostawa". */
  shippingPositionName?: string
  /** Unit of every product position. Default "szt.". */
  quantityUnit?: string
  /** Fakturownia `payment_type` by payment provider id prefix, like { pp_stripe: "card", pp_payu: "payu" }. Anything else: "transfer". */
  paymentTypes?: Record<string, string>
  /** Payment provider id prefixes meaning cash on delivery ("cash_on_delivery"). Default pp_cod, pp_cash. */
  codProviders?: string[] | string
  /** Payment term of documents issued unpaid, in days. Default 7. */
  paymentTermDays?: number | string
  /** When a payment is captured for a document issued unpaid, set it paid in Fakturownia. Default true. */
  markPaidOnCapture?: boolean | string
  /** After issuing, ask Fakturownia to e-mail the document to the buyer. Default false. */
  sendByEmail?: boolean | string
  /** A canceled order rejects its proforma and flags a VAT invoice or receipt for a correction. Default true. */
  cancelOnOrderCanceled?: boolean | string
  /** Metadata keys holding the buyer's tax ID (order, then billing address). Default nip, tax_id, invoice_nip. */
  taxIdMetadataKeys?: string[] | string
  /** Prefix of the order number sent as `oid`, for accounts that already hold documents numbered like Medusa orders. Default none. */
  oidPrefix?: string
  /** Self-imposed rate limit. Default 60 per minute. */
  requestsPerMinute?: number | string
  /** Timeout of one request in ms. Default 30000. */
  timeoutMs?: number | string
  /**
   * Correction invoices. "plan" (default): when an issued order changes (a
   * return received, a refund, an order edit, a cancellation), a correction
   * plan is computed for a person to approve. "off": no plans (a canceled
   * order's invoice is only flagged, as in 0.1.0).
   */
  corrections?: "plan" | "off" | string
  /**
   * Hard switches of the writes added in 0.2.0. Each defaults to true: a
   * person may turn the writer on in the admin (it starts off). `false` turns
   * it off for good; the admin cannot override it.
   */
  writers?: { corrections?: boolean | string; emails?: boolean | string; ksef?: boolean | string }
  /** Attach the PDF to the e-mails Fakturownia sends (`email_pdf`). Default false. */
  emailPdf?: boolean | string
  /** Unpaid proformas and VAT invoices older than this many days are listed for a reminder. Default 7. */
  reminderAfterDays?: number | string
  /**
   * Where the buyer's NIP is looked for, in order: "order.metadata.<key>",
   * "billing_address.metadata.<key>", "billing_address.tax_id",
   * "billing_address.company" (a NIP typed into the company name), or a
   * company module: { entity: "company", customerField: "customer_id",
   * nipField: "nip", nameField: "name" }. Default: the keys of
   * taxIdMetadataKeys in the order and billing address metadata, then
   * billing_address.tax_id.
   */
  nipSources?: Array<string | { entity: string; customerField?: string; nipField?: string; nameField?: string | null }> | string
  /** The seller department by sales channel id, like { "sc_01J...": 123 }. Others use departmentId. */
  departmentsBySalesChannel?: Record<string, number | string>
  /** Stores running the integration, shown in the admin ("Running in production"). */
  references?: ReferenceOption[]
}

export interface ResolvedFakturowniaOptions {
  apiToken: string
  account: string
  demo: boolean
  /** Why demo mode is on: the `demo` option (the only way since 0.3.0). Null in live mode. */
  demoReason: "option" | "no_token" | null
  documentFlow: DocumentFlow
  trigger: IssueTrigger
  receiptForConsumers: boolean
  receiptKind: string
  defaultVatRate: TaxValue
  lang: string
  issuePlace: string
  departmentId: number | null
  categoryId: number | null
  shippingPositionName: string
  quantityUnit: string
  /** Longest prefix first, so `pp_stripe-blik` beats `pp_stripe`. */
  paymentTypes: Array<[string, string]>
  codProviders: string[]
  paymentTermDays: number
  markPaidOnCapture: boolean
  sendByEmail: boolean
  cancelOnOrderCanceled: boolean
  taxIdMetadataKeys: string[]
  oidPrefix: string
  requestsPerMinute: number
  timeoutMs: number
  corrections: "plan" | "off"
  /** true: a person may turn the writer on; false: off for good. */
  writers: Record<WriterKey, boolean>
  emailPdf: boolean
  reminderAfterDays: number
  nipSources: NipSource[]
  /** [sales channel id, department id], in the order given. */
  departmentsBySalesChannel: Array<[string, number]>
  references: ResolvedReference[]
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "")

/** true / false from booleans and the usual strings; `null` when the value says neither. */
export function boolOrNull(v: unknown): boolean | null {
  if (typeof v === "boolean") return v
  if (typeof v === "string") {
    if (/^(1|true|yes|on)$/i.test(v.trim())) return true
    if (/^(0|false|no|off)$/i.test(v.trim())) return false
  }
  return null
}

function bool(v: unknown, fallback: boolean): boolean {
  return boolOrNull(v) ?? fallback
}

/** A positive integer id, or null. Accepts numbers and numeric strings. */
export function positiveInt(v: unknown): number | null {
  const s = str(v)
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function bounded(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v)
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function textList(v: unknown, fallback: readonly string[]): string[] {
  const raw = Array.isArray(v) ? v.map((x) => str(x)) : typeof v === "string" ? v.split(",").map((x) => x.trim()) : null
  if (!raw) return [...fallback]
  const out = raw.filter(Boolean)
  return out.length > 0 ? [...new Set(out)] : [...fallback]
}

/** Fakturownia subdomains: letters, digits and hyphens, like DNS labels. */
export const ACCOUNT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * "mojafirma", "mojafirma.fakturownia.pl" and "https://mojafirma.fakturownia.pl/"
 * all become "mojafirma". Anything else is kept as typed (lowercased) and
 * reported as invalid: the account becomes part of a host name, so it is
 * never trusted without `isValidAccount`.
 */
export function normalizeAccount(v: unknown): string {
  let s = str(v).toLowerCase()
  s = s.replace(/^[a-z]+:\/\//, "")
  s = s.split(/[/?#]/)[0] ?? ""
  const suffix = `.${FAKTUROWNIA_DOMAIN}`
  if (s.endsWith(suffix)) s = s.slice(0, -suffix.length)
  return s
}

export function isValidAccount(account: string): boolean {
  return ACCOUNT_PATTERN.test(account)
}

/** A tax value: 23, "23", "8%", "zw", "np", "oo". Anything else gives the fallback. */
export function parseTaxValue(v: unknown, fallback: TaxValue): TaxValue {
  const s = str(v).toLowerCase().replace("%", "").trim()
  if (s === "zw" || s === "np" || s === "oo") return s
  if (s === "") return fallback
  const n = Number(s.replace(",", "."))
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback
}

/** Document languages: "pl", "en-GB", or two of them for a bilingual document ("pl/en"). */
const LANG_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?(?:\/[a-z]{2}(?:-[A-Z]{2})?)?$/

function lang(v: unknown): string {
  const s = str(v)
  return LANG_PATTERN.test(s) ? s : DEFAULT_LANG
}

/** Payment types by provider prefix, longest prefix first. Values at most 40 characters. */
function typeList(v: unknown): Array<[string, string]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return []
  return Object.entries(v as Record<string, unknown>)
    .map(([prefix, type]) => [prefix.trim().toLowerCase(), str(type).slice(0, 40)] as [string, string])
    .filter(([prefix, type]) => prefix && type)
    .sort((a, b) => b[0].length - a[0].length)
}

function clipped(v: unknown, fallback: string, max: number): string {
  const s = str(v)
  return (s || fallback).slice(0, max)
}

/** Hard switches: anything but an explicit "no" leaves the writer available to the admin. */
function writerSwitches(v: unknown): Record<WriterKey, boolean> {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const out = {} as Record<WriterKey, boolean>
  for (const key of WRITERS) out[key] = boolOrNull(o[key]) !== false
  return out
}

/** Sales channel to department, valid pairs only. */
function channelDepartments(v: unknown): Array<[string, number]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return []
  const out: Array<[string, number]> = []
  for (const [channel, department] of Object.entries(v as Record<string, unknown>)) {
    const id = positiveInt(department)
    if (/^[A-Za-z0-9_-]{1,64}$/.test(channel.trim()) && id !== null) out.push([channel.trim(), id])
  }
  return out
}

export function resolveOptions(o: FakturowniaPluginOptions | undefined | null): ResolvedFakturowniaOptions {
  const opts = o ?? {}
  const apiToken = str(opts.apiToken)
  /* Demo only when asked for: a missing token on production means "not configured", never simulated documents. */
  const demo = boolOrNull(opts.demo) === true
  const flow = str(opts.documentFlow).toLowerCase()
  const trigger = str(opts.trigger).toLowerCase()
  const receiptKind = str(opts.receiptKind).toLowerCase()
  const taxIdMetadataKeys = textList(opts.taxIdMetadataKeys, DEFAULT_TAX_ID_METADATA_KEYS)
  return {
    apiToken,
    account: normalizeAccount(opts.account),
    demo,
    demoReason: demo ? "option" : null,
    documentFlow: flow === "proforma_then_vat" ? "proforma_then_vat" : "vat",
    trigger: trigger === "order_placed" ? "order_placed" : "payment_captured",
    receiptForConsumers: bool(opts.receiptForConsumers, false),
    receiptKind: /^[a-z_]{2,40}$/.test(receiptKind) ? receiptKind : DEFAULT_RECEIPT_KIND,
    defaultVatRate: parseTaxValue(opts.defaultVatRate, DEFAULT_VAT_RATE),
    lang: lang(opts.lang),
    issuePlace: str(opts.issuePlace).slice(0, 200),
    departmentId: positiveInt(opts.departmentId),
    categoryId: positiveInt(opts.categoryId),
    shippingPositionName: clipped(opts.shippingPositionName, DEFAULT_SHIPPING_POSITION_NAME, 256),
    quantityUnit: clipped(opts.quantityUnit, DEFAULT_QUANTITY_UNIT, 20),
    paymentTypes: typeList(opts.paymentTypes),
    codProviders: textList(opts.codProviders, DEFAULT_COD_PROVIDERS).map((p) => p.toLowerCase()),
    paymentTermDays: bounded(opts.paymentTermDays, DEFAULT_PAYMENT_TERM_DAYS, 0, 365),
    markPaidOnCapture: bool(opts.markPaidOnCapture, true),
    sendByEmail: bool(opts.sendByEmail, false),
    cancelOnOrderCanceled: bool(opts.cancelOnOrderCanceled, true),
    taxIdMetadataKeys,
    oidPrefix: str(opts.oidPrefix).replace(/\s+/g, "").slice(0, 20),
    requestsPerMinute: bounded(opts.requestsPerMinute, DEFAULT_REQUESTS_PER_MINUTE, 1, MAX_REQUESTS_PER_MINUTE),
    timeoutMs: bounded(opts.timeoutMs, DEFAULT_TIMEOUT_MS, 5000, 120_000),
    corrections: str(opts.corrections).toLowerCase() === "off" ? "off" : "plan",
    writers: writerSwitches(opts.writers),
    emailPdf: bool(opts.emailPdf, false),
    reminderAfterDays: bounded(opts.reminderAfterDays, DEFAULT_REMINDER_AFTER_DAYS, 0, 365),
    nipSources: resolveNipSources(opts.nipSources, taxIdMetadataKeys),
    departmentsBySalesChannel: channelDepartments(opts.departmentsBySalesChannel),
    references: resolveReferences(opts.references),
  }
}

/** The seller department of an order: its sales channel's, or `departmentId`. */
export function departmentFor(o: Pick<ResolvedFakturowniaOptions, "departmentId" | "departmentsBySalesChannel">, salesChannelId: string | null | undefined): number | null {
  const channel = String(salesChannelId ?? "").trim()
  if (channel) for (const [id, department] of o.departmentsBySalesChannel) if (id === channel) return department
  return o.departmentId
}

/**
 * Option names live mode still needs, for the admin. Empty in demo mode.
 * The account must be a valid subdomain: it becomes part of the host name.
 */
export function missingOptions(o: ResolvedFakturowniaOptions): string[] {
  if (o.demo) return []
  const missing: string[] = []
  if (!o.apiToken) missing.push("apiToken")
  if (!o.account) missing.push("account")
  else if (!isValidAccount(o.account)) missing.push("account (the subdomain, like mojafirma)")
  return missing
}

/** Documents can be issued: demo, or a token and a valid account. */
export function canIssue(o: ResolvedFakturowniaOptions): boolean {
  return missingOptions(o).length === 0
}

/** The panel address of the account, for "Open in Fakturownia" (live mode only). */
export function accountUrl(o: ResolvedFakturowniaOptions): string | null {
  if (o.demo || !isValidAccount(o.account)) return null
  return `https://${o.account}.${FAKTUROWNIA_DOMAIN}`
}
