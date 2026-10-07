/**
 * Options of `@koda-plus/medusa-plugin-emails`.
 *
 * The plugin has two registrations in medusa-config.ts that take THE SAME
 * options object: the plugin itself (the send log, the admin page, the
 * subscribers and jobs) and its notification provider (rendering and
 * sending). Keep the object in one constant and pass it to both:
 *
 *   const emails = { apiKey: process.env.RESEND_API_KEY, from: "...", ... }
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-emails", options: emails }]
 *   modules: [{ resolve: "@medusajs/medusa/notification", options: { providers: [
 *     { resolve: "@koda-plus/medusa-plugin-emails/providers/emails", id: "emails",
 *       options: { channels: ["email"], ...emails } },
 *   ] } }]
 *
 * The admin compares both and says when they differ.
 *
 * NOTHING HERE THROWS. Missing options never break the boot: without an API
 * key the provider logs instead of sending; broken values fall back to
 * defaults and are listed in `problems` for the admin.
 */

import {
  DEFAULT_ABANDONED_AFTER_HOURS,
  DEFAULT_ABANDONED_MAX_AGE_HOURS,
  DEFAULT_ABANDONED_MAX_PER_RUN,
  DEFAULT_MAX_RETRIES,
  DEFAULT_REQUESTS_PER_SECOND,
  DEFAULT_RESET_MINUTES,
  DEFAULT_RESETS_PER_HOUR,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_SKIP_ORDER_METADATA_KEYS,
  DEFAULT_TIMEOUT_MS,
  isLocale,
  isTemplateKey,
  type EmailLocale,
} from "./constants"
import { cssFontFamily, fontFaceName, safeHttpsUrl, safeUrl } from "./html"
import { sha256 } from "./keys"
import { validTimeZone } from "./locale"
import { resolveReferences, resolveText, type ReferenceOption, type ResolvedReference, type ResolvedText } from "./references"
import { addressList, isEmail, parseSender, type Sender } from "./security"
import { normalizeHex } from "./theme"
import type { EmailTemplateDefinition, LocalizedText } from "./types"

export interface EmailsBrandOptions {
  /** The store name in subjects and texts ("Your Koda Supply account is ready"). */
  name?: string
  /** The logo as live text: `text`, an `accent` part in the accent colour (a "+"), a lighter `suffix`. Default: the name. */
  logo?: { text?: string; accent?: string; suffix?: string; italic?: boolean }
  /** Buttons and highlights. Default #26D07C. */
  accentColor?: string
  /** The dark band at the top. Default #212721. A colour too light for white text is darkened. */
  headerColor?: string
  /** One line in the footer: the company and address, or a sentence about the store. */
  footer?: LocalizedText
  /** Shown in the "Questions?" box as a mailto link. */
  supportEmail?: string
  /** CSS font-family lists. Default: the system sans of each device. */
  headingFont?: string
  bodyFont?: string
  /** Web fonts loaded where the mail app allows them (https only). */
  fontFaces?: Array<{ family: string; url: string }>
}

/**
 * Links in messages. An absolute address, or a path joined to `storefrontUrl`.
 * Placeholders, URI-encoded: {order_id} {display_id} {cart_id} {country}
 * {locale} {token} {email} {id} {ref}.
 */
export interface EmailsLinksOptions {
  store?: string
  account?: string
  order?: string
  cart?: string
  passwordReset?: string
  adminPasswordReset?: string
  negotiation?: string
}

export interface EmailsPluginOptions {
  /** Resend API key (`re_...`), sending access is enough. Without it nothing is sent: the provider logs. */
  apiKey?: string
  /** `Store <orders@mail.your-store.com>`, on a domain verified in Resend. */
  from?: string
  replyTo?: string | string[]
  /** A simulated outbox: nothing leaves the server, every message is kept to look at in the admin. */
  demo?: boolean
  /** The language when the recipient's is unknown: "en" (default) or "pl". */
  defaultLocale?: EmailLocale
  /** For dates in messages. Default "UTC". */
  timeZone?: string
  /** The public address of the storefront: links in messages and the password reset page. */
  storefrontUrl?: string
  /** The admin address, for admin password resets. Default: `admin.backendUrl` and `admin.path` of medusa-config. */
  adminUrl?: string
  links?: EmailsLinksOptions
  brand?: EmailsBrandOptions
  /**
   * `false` turns a template off for good (the admin cannot turn it on),
   * `true` turns an optional one on, and a definition adds or replaces a
   * template: `{ "company.approved": defineEmailTemplate({ ... }) }`.
   */
  templates?: Record<string, boolean | EmailTemplateDefinition<any>>
  /** The abandoned cart job (the `cart.abandoned` template is off until turned on). */
  abandonedCart?: { afterHours?: number; maxAgeHours?: number; maxPerRun?: number }
  /** Orders with one of these metadata keys get no e-mail. Default ["marketplace_order_ref"]. */
  skipOrderMetadataKeys?: string[]
  /** Tracking links per fulfillment provider id when the label has none: { "inpost": "https://.../{number}" }. */
  trackingUrls?: Record<string, string>
  /** How long a password reset link works, for the text of the message. Default 15. */
  passwordResetMinutes?: number
  /** Password reset e-mails per address in any hour (1 to 50). Default 3; further requests are logged as skipped. */
  passwordResetsPerHour?: number
  /**
   * Only for negotiation events that send `price` as a number and no
   * `price_amount`: major units (469 for 469.00, the default, as Medusa keeps
   * amounts) or minor (46900). The Koda Plus negotiations plugin sends both
   * fields, so it needs nothing here.
   */
  negotiationAmounts?: "minor" | "major"
  /** Requests to Resend per second from this process. Default 5. */
  requestsPerSecond?: number
  timeoutMs?: number
  /** Extra tries of one send after a temporary error. Default 2. */
  maxRetries?: number
  /** Days the send log keeps. Default 365; 0 keeps everything. */
  logRetentionDays?: number
  /** Stores running the plugin, shown in the admin. Empty by default. */
  references?: ReferenceOption[]
  /** Provider registration only: the channels it serves. Must include "email". */
  channels?: string[]
}

export interface ResolvedBrand {
  name: string | null
  logo: { text: string | null; accent: string | null; suffix: string | null; italic: boolean }
  accentColor: string | null
  headerColor: string | null
  footer: ResolvedText | null
  supportEmail: string | null
  headingFont: string
  bodyFont: string
  fontFaces: Array<{ family: string; url: string }>
}

export type LinkKey = keyof EmailsLinksOptions

export const LINK_KEYS: readonly LinkKey[] = ["store", "account", "order", "cart", "passwordReset", "adminPasswordReset", "negotiation"]

export type EmailsMode = "demo" | "dev" | "live"

export interface ResolvedEmailsOptions {
  apiKey: string
  sender: Sender | null
  replyTo: string[]
  demo: boolean
  /** demo: the simulated outbox; dev: no API key, the provider logs; live: sends through Resend. */
  mode: EmailsMode
  defaultLocale: EmailLocale
  timeZone: string
  storefrontUrl: string | null
  adminUrl: string | null
  /** Link templates, absolute; null when they cannot be built. */
  links: Record<LinkKey, string | null>
  brand: ResolvedBrand
  /** Hard switches from `templates`: false off for good, true on by default. */
  switches: Record<string, boolean>
  /** Templates defined in the options. */
  definitions: Record<string, EmailTemplateDefinition<any>>
  abandonedCart: { afterHours: number; maxAgeHours: number; maxPerRun: number }
  skipOrderMetadataKeys: string[]
  trackingUrls: Record<string, string>
  passwordResetMinutes: number
  passwordResetsPerHour: number
  negotiationAmounts: "minor" | "major"
  requestsPerSecond: number
  timeoutMs: number
  maxRetries: number
  logRetentionDays: number
  references: ResolvedReference[]
  channels: string[]
  /** Option values that were ignored, for the admin. */
  problems: string[]
}

export const SYSTEM_FONTS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
export const MONO_FONTS = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v)
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function clip(v: unknown, max: number): string | null {
  const s = str(v)
  return s ? s.slice(0, max) : null
}

/** A base address without a trailing slash, http(s) only. */
function baseUrl(v: unknown): string | null {
  const s = safeUrl(str(v))
  return s ? s.replace(/\/+$/, "") : null
}

const PLACEHOLDER = /\{(order_id|display_id|cart_id|country|locale|token|email|id|ref)\}/g

/**
 * A link template, absolute. A path ("/account", "/{country}/cart") is
 * joined to the storefront. Checked with every placeholder filled; null when
 * the result is not an http(s) address.
 */
export function resolveLinkTemplate(value: unknown, base: string | null): string | null {
  const s = str(value)
  if (!s) return null
  const absolute = /^https?:\/\//i.test(s) ? s : s.startsWith("/") && base ? `${base}${s}` : null
  if (!absolute) return null
  const probe = absolute.replace(PLACEHOLDER, "x")
  if (/\{[^}]*\}/.test(probe)) return null
  return safeUrl(probe) ? absolute : null
}

/**
 * A link from a template and values, every value URI-encoded. An empty
 * value leaves no double slash behind ("/{country}/account" with no country
 * is "/account"). Null without a template or when the result is not valid.
 */
export function buildLink(template: string | null, values: Partial<Record<string, string | number | null | undefined>> = {}): string | null {
  if (!template) return null
  const filled = template.replace(PLACEHOLDER, (_m, name: string) => {
    const v = values[name]
    return v === null || v === undefined ? "" : encodeURIComponent(String(v))
  })
  const m = /^(https?:\/\/[^/?#]+)(.*)$/i.exec(filled)
  if (!m) return null
  const rest = m[2].replace(/(^|[^:])\/{2,}/g, "$1/")
  return safeUrl(`${m[1]}${rest}`)
}

function resolveBrand(b: EmailsBrandOptions | undefined, problems: string[]): ResolvedBrand {
  const o = b && typeof b === "object" ? b : {}
  const accentColor = o.accentColor === undefined ? null : normalizeHex(o.accentColor)
  if (o.accentColor !== undefined && !accentColor) problems.push("brand.accentColor (a hex colour like #26D07C)")
  const headerColor = o.headerColor === undefined ? null : normalizeHex(o.headerColor)
  if (o.headerColor !== undefined && !headerColor) problems.push("brand.headerColor (a hex colour like #212721)")
  const supportEmail = o.supportEmail === undefined ? null : isEmail(str(o.supportEmail)) ? str(o.supportEmail) : null
  if (o.supportEmail !== undefined && !supportEmail) problems.push("brand.supportEmail (one e-mail address)")
  const logo = o.logo && typeof o.logo === "object" ? o.logo : {}
  const faces: Array<{ family: string; url: string }> = []
  if (Array.isArray(o.fontFaces)) {
    for (const f of o.fontFaces.slice(0, 6)) {
      const family = fontFaceName((f as { family?: unknown })?.family)
      const url = safeHttpsUrl((f as { url?: unknown })?.url)
      if (family && url) faces.push({ family, url })
      else problems.push("brand.fontFaces (each { family, url } with an https url)")
    }
  }
  return {
    name: clip(o.name, 80),
    logo: { text: clip(logo.text, 40), accent: clip(logo.accent, 4), suffix: clip(logo.suffix, 30), italic: logo.italic === true },
    accentColor,
    headerColor,
    footer: resolveText(o.footer, 300),
    supportEmail,
    headingFont: cssFontFamily(o.headingFont, SYSTEM_FONTS),
    bodyFont: cssFontFamily(o.bodyFont, SYSTEM_FONTS),
    fontFaces: faces,
  }
}

function isDefinition(v: unknown): v is EmailTemplateDefinition<any> {
  return Boolean(v) && typeof v === "object" && typeof (v as { render?: unknown }).render === "function"
}

export function resolveOptions(input: EmailsPluginOptions | undefined | null): ResolvedEmailsOptions {
  const o = (input && typeof input === "object" ? input : {}) as EmailsPluginOptions
  const problems: string[] = []
  const apiKey = str(o.apiKey)
  const demo = o.demo === true
  const sender = parseSender(o.from)
  if (str(o.from) && !sender) problems.push("from (an address, or Name <address>)")
  const replyTo = addressList(o.replyTo, 5)
  if (o.replyTo !== undefined && replyTo.length === 0) problems.push("replyTo (an address or a list)")
  const defaultLocale: EmailLocale = isLocale(o.defaultLocale) ? o.defaultLocale : "en"
  if (o.defaultLocale !== undefined && !isLocale(o.defaultLocale)) problems.push('defaultLocale ("en" or "pl")')
  const timeZone = validTimeZone(o.timeZone) ? str(o.timeZone) : "UTC"
  if (o.timeZone !== undefined && !validTimeZone(o.timeZone)) problems.push('timeZone (an IANA zone like "Europe/Warsaw")')
  const storefrontUrl = baseUrl(o.storefrontUrl)
  if (o.storefrontUrl !== undefined && str(o.storefrontUrl) && !storefrontUrl) problems.push("storefrontUrl (an http(s) address)")
  const adminUrl = baseUrl(o.adminUrl)

  const linkOptions = (o.links && typeof o.links === "object" ? o.links : {}) as EmailsLinksOptions
  const defaults: Record<LinkKey, string | null> = {
    store: storefrontUrl,
    account: storefrontUrl ? `${storefrontUrl}/account` : null,
    order: storefrontUrl ? `${storefrontUrl}/account` : null,
    cart: storefrontUrl ? `${storefrontUrl}/cart` : null,
    passwordReset: storefrontUrl ? `${storefrontUrl}/reset-password?token={token}&email={email}` : null,
    adminPasswordReset: adminUrl ? `${adminUrl}/reset-password?token={token}&email={email}` : null,
    negotiation: storefrontUrl ? `${storefrontUrl}/account` : null,
  }
  const links = {} as Record<LinkKey, string | null>
  for (const key of LINK_KEYS) {
    const given = linkOptions[key]
    if (given === undefined || given === null || str(given) === "") {
      links[key] = defaults[key]
      continue
    }
    const resolved = resolveLinkTemplate(given, storefrontUrl)
    if (!resolved) problems.push(`links.${key} (an http(s) address or a path, with known placeholders)`)
    links[key] = resolved ?? defaults[key]
  }

  const switches: Record<string, boolean> = {}
  const definitions: Record<string, EmailTemplateDefinition<any>> = {}
  if (o.templates && typeof o.templates === "object") {
    for (const [key, value] of Object.entries(o.templates)) {
      if (!isTemplateKey(key)) {
        problems.push(`templates["${String(key).slice(0, 40)}"] (letters, digits, dots, dashes)`)
        continue
      }
      if (typeof value === "boolean") switches[key] = value
      else if (isDefinition(value)) definitions[key] = value
      else problems.push(`templates["${key}"] (true, false or a template with render())`)
    }
  }

  const ac = o.abandonedCart && typeof o.abandonedCart === "object" ? o.abandonedCart : {}
  const afterHours = int(ac.afterHours, DEFAULT_ABANDONED_AFTER_HOURS, 1, 24 * 14)
  const maxAgeHours = Math.max(afterHours + 1, int(ac.maxAgeHours, DEFAULT_ABANDONED_MAX_AGE_HOURS, 2, 24 * 30))

  const skip = Array.isArray(o.skipOrderMetadataKeys)
    ? o.skipOrderMetadataKeys.filter((k): k is string => typeof k === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(k))
    : [...DEFAULT_SKIP_ORDER_METADATA_KEYS]

  const trackingUrls: Record<string, string> = {}
  if (o.trackingUrls && typeof o.trackingUrls === "object") {
    for (const [provider, template] of Object.entries(o.trackingUrls)) {
      const t = str(template)
      if (/^[A-Za-z0-9_.-]{1,80}$/.test(provider) && t.includes("{number}") && safeUrl(t.replace("{number}", "x"))) trackingUrls[provider] = t
      else problems.push(`trackingUrls["${provider.slice(0, 40)}"] (an http(s) address with {number})`)
    }
  }

  const channels = Array.isArray(o.channels) ? o.channels.filter((c): c is string => typeof c === "string") : []
  const rps = Number(o.requestsPerSecond)

  return {
    apiKey,
    sender,
    replyTo,
    demo,
    mode: demo ? "demo" : apiKey ? "live" : "dev",
    defaultLocale,
    timeZone,
    storefrontUrl,
    adminUrl,
    links,
    brand: resolveBrand(o.brand, problems),
    switches,
    definitions,
    abandonedCart: { afterHours, maxAgeHours, maxPerRun: int(ac.maxPerRun, DEFAULT_ABANDONED_MAX_PER_RUN, 1, 500) },
    skipOrderMetadataKeys: skip,
    trackingUrls,
    passwordResetMinutes: int(o.passwordResetMinutes, DEFAULT_RESET_MINUTES, 1, 24 * 60),
    passwordResetsPerHour: int(o.passwordResetsPerHour, DEFAULT_RESETS_PER_HOUR, 1, 50),
    negotiationAmounts: o.negotiationAmounts === "minor" ? "minor" : "major",
    requestsPerSecond: Number.isFinite(rps) && rps > 0 ? Math.min(50, rps) : DEFAULT_REQUESTS_PER_SECOND,
    timeoutMs: int(o.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 120_000),
    maxRetries: int(o.maxRetries, DEFAULT_MAX_RETRIES, 0, 5),
    logRetentionDays: int(o.logRetentionDays, DEFAULT_RETENTION_DAYS, 0, 3650),
    references: resolveReferences(o.references),
    channels,
    problems,
  }
}

/** Options live mode still needs; empty in demo mode and when the provider can send. */
export function missingOptions(o: ResolvedEmailsOptions): string[] {
  if (o.demo) return []
  const missing: string[] = []
  if (!o.apiKey) missing.push("apiKey")
  if (!o.sender) missing.push("from")
  return missing
}

/** Recommended options, for the admin: messages work without them, but read worse. */
export function recommendedOptions(o: ResolvedEmailsOptions): string[] {
  const out: string[] = []
  if (!o.brand.name) out.push("brand.name")
  if (!o.storefrontUrl) out.push("storefrontUrl")
  if (o.replyTo.length === 0 && !o.brand.supportEmail) out.push("replyTo")
  if (o.timeZone === "UTC") out.push("timeZone")
  return out
}

/** The template key as an option name, for messages: templates["order.placed"]. */
export function templateOptionName(key: string): string {
  return `templates["${key}"]`
}

/**
 * A fingerprint of what shapes a message, to tell whether the provider and
 * the plugin got the same options. The API key counts by its hash only;
 * template definitions by their keys.
 */
export function optionsFingerprint(o: ResolvedEmailsOptions): Record<string, string> {
  const brand = { ...o.brand, footer: o.brand.footer }
  return {
    mode: o.mode,
    apiKey: o.apiKey ? sha256(o.apiKey).slice(0, 12) : "",
    from: o.sender?.value ?? "",
    replyTo: o.replyTo.join(","),
    defaultLocale: o.defaultLocale,
    timeZone: o.timeZone,
    storefrontUrl: o.storefrontUrl ?? "",
    links: JSON.stringify(o.links),
    brand: JSON.stringify(brand),
    templates: JSON.stringify({ switches: o.switches, definitions: Object.keys(o.definitions).sort() }),
    trackingUrls: JSON.stringify(o.trackingUrls),
    skipOrderMetadataKeys: o.skipOrderMetadataKeys.join(","),
    negotiationAmounts: o.negotiationAmounts,
    passwordResetsPerHour: String(o.passwordResetsPerHour),
  }
}

/** Names of the options whose fingerprints differ. */
export function fingerprintDifferences(a: Record<string, string>, b: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter((k) => a[k] !== b[k]).sort()
}
