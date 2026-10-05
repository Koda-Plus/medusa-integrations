/**
 * THE BUYER'S NIP. Polish tax id: ten digits, the last one a checksum
 * (weights 6 5 7 2 3 4 5 6 7, sum modulo 11, a remainder of 10 is never
 * valid). The bridge checks the same before it creates a contractor; checking
 * here too means an invalid NIP never even leaves Medusa as a buyer, and the
 * admin says why the ZK went to the retail buyer.
 *
 * `nipSources` (option) says where to look, in order:
 *   `metadata.<key>`                   order metadata, a field meant for the NIP
 *   `billing_address.metadata.<key>`   billing address metadata, same
 *   `billing_address.<field>`          free text, for example the company field
 *                                      "Salon Ania sp. z o.o., NIP 123-456-32-18"
 * A dedicated field with an invalid NIP decides (the buyer meant it); free
 * text only yields a NIP when a candidate passes the checksum.
 *
 * Pure, so every branch is unit tested.
 */

const WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7]

/** "PL 123-456-32-18" gives "1234563218". Null when it is not ten digits with separators. */
export function normalizeNip(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  let text = String(value).trim()
  if (/^pl/i.test(text)) text = text.slice(2)
  if (/[^0-9\s.\-]/.test(text)) return null
  const digits = text.replace(/[^0-9]/g, "")
  return digits.length === 10 ? digits : null
}

export function isValidNip(value: unknown): boolean {
  const d = normalizeNip(value)
  if (!d || /^(\d)\1{9}$/.test(d)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * WEIGHTS[i]
  const check = sum % 11
  return check !== 10 && check === Number(d[9])
}

/** "123-456-32-18", the way Subiekt shows a NIP. */
export function formatNip(digits: string): string {
  return /^\d{10}$/.test(digits) ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}` : digits
}

const IN_TEXT = /(?:PL\s?)?\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}(?!\d)|(?:PL\s?)?\d{3}[-\s]?\d{2}[-\s]?\d{2}[-\s]?\d{3}(?!\d)/gi

/** Every NIP-shaped number in a free text, normalized, in order of appearance. */
export function nipsInText(text: unknown): string[] {
  if (typeof text !== "string") return []
  const out: string[] = []
  for (const match of text.matchAll(IN_TEXT)) {
    const before = match.index !== undefined && match.index > 0 ? text[match.index - 1] : ""
    if (/\d/.test(before)) continue
    const n = normalizeNip(match[0])
    if (n && !out.includes(n)) out.push(n)
  }
  return out
}

/** A company name without the "NIP ..." part a checkout may have appended. */
export function companyWithoutNip(text: unknown): string | null {
  if (typeof text !== "string") return null
  const cleaned = text
    .replace(/[,;]?\s*(?:NIP|VAT(?:\s*ID)?|TAX\s*ID)\s*[:.]?\s*(?:PL\s?)?[\d\s.\-]{10,16}/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[,;]$/, "")
    .trim()
  return cleaned.length > 0 ? cleaned : null
}

export interface NipSourceRecord {
  metadata?: Record<string, unknown> | null
  billing_address?: ({ metadata?: Record<string, unknown> | null } & Record<string, unknown>) | null
}

export interface NipLookup {
  /** A NIP that passed the checksum, normalized. */
  nip: string | null
  /** The `nipSources` entry it came from. */
  source: string | null
  /** A value that looked like a NIP and failed the checksum, when no valid one was found. */
  invalid: { source: string; value: string } | null
}

function valueAt(order: NipSourceRecord, path: string): unknown {
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean)
  let current: unknown = order
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/** Is this source a field meant for a NIP (metadata), or free text (an address field)? */
function dedicated(path: string): boolean {
  return /(^|\.)metadata\./.test(path)
}

export function findNip(order: NipSourceRecord, sources: readonly string[]): NipLookup {
  let invalid: NipLookup["invalid"] = null
  for (const source of sources) {
    const raw = valueAt(order, source)
    if (raw === undefined || raw === null) continue
    const value = String(raw).trim()
    if (!value) continue
    if (dedicated(source)) {
      const n = normalizeNip(value)
      if (n && isValidNip(n)) return { nip: n, source, invalid: null }
      // The buyer typed something in a NIP field: it decides, even when wrong.
      return { nip: null, source, invalid: { source, value } }
    }
    const candidates = nipsInText(value)
    const valid = candidates.find((c) => isValidNip(c))
    if (valid) return { nip: valid, source, invalid: null }
    if (candidates.length > 0 && !invalid) invalid = { source, value: candidates[0] }
  }
  return { nip: null, source: invalid?.source ?? null, invalid }
}
