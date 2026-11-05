import { labelPageOf, type ResolvedDpdOptions } from "./options"
import type { DpdMode, LabelPage } from "./constants"

/**
 * WHAT THE PLUGIN KEEPS IN `dpd_setting`, one row per key, with who changed
 * it and when. The options (environment variables) stay the source of
 * credentials, the sender and the rules; the database holds only what a
 * person switches in the admin, apart for each mode, so trying the demo or
 * the sandbox never changes live:
 *
 *   <mode>:writer:<writer>   the writer toggles (writers.ts)
 *   <mode>:settings          the label page a person prefers
 *   demo:seeded              the demo shipments were built
 */

export const DEMO_SEEDED_KEY = "demo:seeded"

export function settingsKey(mode: DpdMode): string {
  return `${mode}:settings`
}

/** The prefix of every key of one mode (the demo reset removes them). */
export function modeKeyPrefix(mode: DpdMode): string {
  return `${mode}:`
}

export type StoredSettings = {
  labelPage?: LabelPage | null
}

export type EffectiveSettings = {
  labelPage: LabelPage
  source: { labelPage: "admin" | "option" }
}

/** A stored value, cleaned the same way as the options. Unknown fields are dropped. */
export function readStoredSettings(value: unknown): StoredSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const v = value as Record<string, unknown>
  const out: StoredSettings = {}
  const page = labelPageOf(v.labelPage)
  if (page) out.labelPage = page
  return out
}

/** What the admin sends to save settings, checked field by field. */
export function validateSettingsInput(body: unknown): { ok: true; value: StoredSettings } | { ok: false; errors: string[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, errors: ["body"] }
  const b = body as Record<string, unknown>
  const errors: string[] = []
  if (b.labelPage !== undefined && b.labelPage !== null && !labelPageOf(b.labelPage)) errors.push("labelPage")
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: readStoredSettings(b) }
}

/** The settings in force: a saved value of the mode, else the option. */
export function effectiveSettings(o: Pick<ResolvedDpdOptions, "labelPage">, stored: StoredSettings | null | undefined): EffectiveSettings {
  const s = stored ?? {}
  return {
    labelPage: s.labelPage ?? o.labelPage,
    source: { labelPage: s.labelPage ? "admin" : "option" },
  }
}
