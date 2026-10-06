/**
 * WHAT A PERSON CHANGES IN THE ADMIN: the branding and the template switches.
 * Zero imports from Medusa.
 *
 * Stored in `emails_setting`, one row per key, with who changed it and when,
 * apart for demo and live mode:
 *
 *   live:brand                    the branding overrides (fields left out
 *                                 come from the options)
 *   live:template:order.placed    { on: boolean }
 *
 * Demo rows older than a day are ignored, so a shared demo never keeps a
 * stranger's changes.
 *
 * A template sends only when both switches say yes: the option (`templates:
 * { key: false }` turns it off for good) and the switch in the admin (on by
 * default, except the optional templates: abandoned carts and negotiations).
 */

import { DEMO_RESET_MS, SETTINGS_CACHE_MS } from "./constants"
import type { ResolvedBrand, ResolvedEmailsOptions } from "./options"
import { normalizeHex } from "./theme"
import { isEmail } from "./security"

export interface BrandOverrides {
  name?: string | null
  logoText?: string | null
  logoAccent?: string | null
  logoSuffix?: string | null
  logoItalic?: boolean | null
  accentColor?: string | null
  headerColor?: string | null
  footerEn?: string | null
  footerPl?: string | null
  supportEmail?: string | null
}

export const BRAND_FIELDS: ReadonlyArray<keyof BrandOverrides> = [
  "name",
  "logoText",
  "logoAccent",
  "logoSuffix",
  "logoItalic",
  "accentColor",
  "headerColor",
  "footerEn",
  "footerPl",
  "supportEmail",
]

const LIMITS: Record<string, number> = { name: 80, logoText: 40, logoAccent: 4, logoSuffix: 30, footerEn: 300, footerPl: 300 }

/**
 * Overrides sent by the admin, checked field by field. An empty string or
 * null removes the override (the option applies again). Errors name the
 * field; valid fields are kept.
 */
export function sanitizeBrandOverrides(input: unknown): { value: BrandOverrides; errors: string[] } {
  const value: BrandOverrides = {}
  const errors: string[] = []
  if (!input || typeof input !== "object" || Array.isArray(input)) return { value, errors: input === undefined ? [] : ["brand"] }
  const raw = input as Record<string, unknown>
  for (const field of BRAND_FIELDS) {
    if (!(field in raw)) continue
    const v = raw[field]
    if (v === null || v === "") {
      ;(value as Record<string, unknown>)[field] = null
      continue
    }
    if (field === "logoItalic") {
      if (typeof v === "boolean") value.logoItalic = v
      else errors.push(field)
      continue
    }
    if (typeof v !== "string") {
      errors.push(field)
      continue
    }
    // eslint-disable-next-line no-control-regex
    const s = v.replace(/[\u0000-\u001F\u007F]+/g, " ").trim()
    if (field === "accentColor" || field === "headerColor") {
      const hex = normalizeHex(s)
      if (hex) value[field] = hex
      else errors.push(field)
      continue
    }
    if (field === "supportEmail") {
      if (isEmail(s)) value.supportEmail = s
      else errors.push(field)
      continue
    }
    const max = LIMITS[field] ?? 200
    if (s.length > max) errors.push(field)
    else (value as Record<string, unknown>)[field] = s
  }
  return { value, errors }
}

/** The brand of the options with the admin's overrides on top. */
export function applyBrandOverrides(brand: ResolvedBrand, o: BrandOverrides | null | undefined): ResolvedBrand {
  if (!o) return brand
  const pick = <T,>(override: T | null | undefined, base: T): T => (override === undefined || override === null ? base : override)
  const footerEn = o.footerEn ?? null
  const footerPl = o.footerPl ?? null
  return {
    ...brand,
    name: pick(o.name, brand.name),
    logo: {
      text: pick(o.logoText, brand.logo.text),
      accent: pick(o.logoAccent, brand.logo.accent),
      suffix: pick(o.logoSuffix, brand.logo.suffix),
      italic: pick(o.logoItalic, brand.logo.italic),
    },
    accentColor: pick(o.accentColor, brand.accentColor),
    headerColor: pick(o.headerColor, brand.headerColor),
    footer: footerEn || footerPl ? { en: footerEn ?? brand.footer?.en ?? null, pl: footerPl ?? brand.footer?.pl ?? null } : brand.footer,
    supportEmail: pick(o.supportEmail, brand.supportEmail),
  }
}

/** Overrides without the removed (null) fields, as stored. */
export function mergeOverrides(current: BrandOverrides | null, change: BrandOverrides): BrandOverrides {
  const next: Record<string, unknown> = { ...(current ?? {}) }
  for (const [k, v] of Object.entries(change)) {
    if (v === null || v === undefined) delete next[k]
    else next[k] = v
  }
  return next as BrandOverrides
}

export function settingKey(demo: boolean, name: string): string {
  return `${demo ? "demo" : "live"}:${name}`
}

export const brandKey = (demo: boolean) => settingKey(demo, "brand")
export const templateKey = (demo: boolean, key: string) => settingKey(demo, `template:${key}`)

export interface SettingRow {
  key: string
  value: unknown
  updated_by?: string | null
  updated_at?: Date | string | null
}

export interface TemplateSwitch {
  on: boolean
  updatedBy: string | null
  updatedAt: string | null
}

export interface EffectiveSettings {
  brand: BrandOverrides | null
  brandUpdatedBy: string | null
  brandUpdatedAt: string | null
  templates: Record<string, TemplateSwitch>
}

export const EMPTY_SETTINGS: EffectiveSettings = { brand: null, brandUpdatedBy: null, brandUpdatedAt: null, templates: {} }

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/** The rows of one mode as settings. Demo rows older than a day are ignored. */
export function readSettings(rows: readonly SettingRow[], demo: boolean, now: Date = new Date()): EffectiveSettings {
  const prefix = `${demo ? "demo" : "live"}:`
  const out: EffectiveSettings = { brand: null, brandUpdatedBy: null, brandUpdatedAt: null, templates: {} }
  for (const row of rows) {
    if (!row || typeof row.key !== "string" || !row.key.startsWith(prefix)) continue
    const at = iso(row.updated_at)
    if (demo && at && now.getTime() - Date.parse(at) > DEMO_RESET_MS) continue
    const name = row.key.slice(prefix.length)
    const value = row.value && typeof row.value === "object" ? (row.value as Record<string, unknown>) : {}
    if (name === "brand") {
      out.brand = sanitizeBrandOverrides(value).value
      out.brandUpdatedBy = row.updated_by ?? null
      out.brandUpdatedAt = at
    } else if (name.startsWith("template:")) {
      out.templates[name.slice("template:".length)] = { on: value.on === true, updatedBy: row.updated_by ?? null, updatedAt: at }
    }
  }
  return out
}

export interface TemplateState {
  /** The options allow it (`templates: { key: false }` does not). */
  allowed: boolean
  /** Off until turned on: abandoned carts, negotiations, an app template with `enabledByDefault: false`. */
  optional: boolean
  /** The admin switch, or the default when nobody flipped it. */
  on: boolean
  /** It sends: allowed and on. */
  enabled: boolean
  updatedBy: string | null
  updatedAt: string | null
}

export function templateState(key: string, enabledByDefault: boolean, o: Pick<ResolvedEmailsOptions, "switches">, s: EffectiveSettings): TemplateState {
  const option = o.switches[key]
  const allowed = option !== false
  const byDefault = option === true ? true : enabledByDefault
  const sw = s.templates[key]
  const on = sw ? sw.on : byDefault
  return { allowed, optional: !enabledByDefault, on, enabled: allowed && on, updatedBy: sw?.updatedBy ?? null, updatedAt: sw?.updatedAt ?? null }
}

/* ------------------------------------------------------------------ */
/* One cache per process, shared by the provider and the admin routes */
/* ------------------------------------------------------------------ */

const CACHE_KEY = Symbol.for("koda.emails.settingsCache")
type CacheEntry = { at: number; value: EffectiveSettings }
type CacheHolder = typeof globalThis & { [CACHE_KEY]?: Map<string, CacheEntry> }

function cache(): Map<string, CacheEntry> {
  const holder = globalThis as CacheHolder
  if (!holder[CACHE_KEY]) holder[CACHE_KEY] = new Map()
  return holder[CACHE_KEY] as Map<string, CacheEntry>
}

/**
 * Settings of a mode, read at most every 10 seconds per process. A failing
 * read (no table yet) gives the defaults and is tried again next time.
 */
export async function cachedSettings(demo: boolean, load: () => Promise<readonly SettingRow[]>, now: number = Date.now()): Promise<EffectiveSettings> {
  const key = demo ? "demo" : "live"
  const hit = cache().get(key)
  if (hit && now - hit.at < SETTINGS_CACHE_MS) return hit.value
  try {
    const value = readSettings(await load(), demo, new Date(now))
    cache().set(key, { at: now, value })
    return value
  } catch {
    return EMPTY_SETTINGS
  }
}

/** After a change in the admin: the next read goes to the database. */
export function forgetSettings(): void {
  cache().clear()
}
