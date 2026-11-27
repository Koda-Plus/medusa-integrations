/**
 * The consent rule, as pure functions: an avatar may speak only with the
 * written consent of the person whose face and voice it uses.
 *
 * Signed means three things on record: the document (a file stored through
 * the File Module), the name of the person who signed it and the date. The
 * admin who recorded it is kept next to them. Revoking keeps the history
 * (file, names, dates) and only flips the state, so the record of what was
 * agreed stays.
 */
import { isConsentState, NAME_MAX, NOTE_MAX, URL_MAX, type ConsentState } from "./constants"

export interface ConsentRecord {
  state: ConsentState
  file_url: string | null
  signed_by: string | null
  signed_at: string | null
}

export interface ConsentInput {
  file_url?: unknown
  signed_by?: unknown
  signed_at?: unknown
  note?: unknown
}

export type ConsentProblem = "file_missing" | "file_invalid" | "signer_missing" | "date_missing" | "date_invalid" | "date_future" | "note_too_long"

export interface ConsentPatch {
  consent_state: ConsentState
  consent_file_url: string
  consent_signed_by: string
  consent_signed_at: Date
  consent_note: string | null
  consent_recorded_by: string | null
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/** An http(s) URL, or a path the File Module serves from the same host. */
function isFileUrl(value: string): boolean {
  if (value.length > URL_MAX) return false
  if (value.startsWith("/")) return !value.startsWith("//")
  try {
    const u = new URL(value)
    if (u.protocol === "https:") return true
    /* Plain http only for the local file provider of a dev store. */
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")
  } catch {
    return false
  }
}

/**
 * Checks the consent form and returns either the problems or the columns to
 * write. `now` is passed in so the rule stays testable.
 */
export function signConsent(input: ConsentInput, actor: string | null, now: Date): { ok: false; problems: ConsentProblem[] } | { ok: true; patch: ConsentPatch } {
  const problems: ConsentProblem[] = []
  const file = str(input.file_url)
  const signer = str(input.signed_by).slice(0, NAME_MAX)
  const dateText = str(input.signed_at)
  const note = str(input.note)

  if (!file) problems.push("file_missing")
  else if (!isFileUrl(file)) problems.push("file_invalid")
  if (!signer) problems.push("signer_missing")

  let date: Date | null = null
  if (!dateText) problems.push("date_missing")
  else {
    date = new Date(dateText)
    if (Number.isNaN(date.getTime())) problems.push("date_invalid")
    /* A day of slack for time zones: a document signed "today" in Warsaw may be tomorrow in UTC terms. */ else if (date.getTime() > now.getTime() + 24 * 3600 * 1000) problems.push("date_future")
  }
  if (note.length > NOTE_MAX) problems.push("note_too_long")

  if (problems.length > 0 || !date) return { ok: false, problems }
  return {
    ok: true,
    patch: {
      consent_state: "signed",
      consent_file_url: file,
      consent_signed_by: signer,
      consent_signed_at: date,
      consent_note: note || null,
      consent_recorded_by: actor,
    },
  }
}

/** Whether a render may start with an avatar of this consent. */
export function canRender(c: ConsentRecord): boolean {
  return c.state === "signed" && Boolean(c.file_url) && Boolean(c.signed_by) && Boolean(c.signed_at)
}

/** Reads the consent columns of a row, tolerating anything a row may hold. */
export function consentOf(row: Record<string, unknown>): ConsentRecord {
  const state = isConsentState(row.consent_state) ? row.consent_state : "none"
  const date = row.consent_signed_at
  return {
    state,
    file_url: typeof row.consent_file_url === "string" && row.consent_file_url ? row.consent_file_url : null,
    signed_by: typeof row.consent_signed_by === "string" && row.consent_signed_by ? row.consent_signed_by : null,
    signed_at: date instanceof Date ? date.toISOString() : typeof date === "string" && date ? date : null,
  }
}
