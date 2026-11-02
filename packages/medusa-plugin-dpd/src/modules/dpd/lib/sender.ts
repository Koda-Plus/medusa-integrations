/**
 * THE SENDER AND THE ORDERER, checked against the strictest DPD limits.
 * Zero imports.
 *
 * One sender serves every DPD request, so it must fit the tightest schema of
 * the DPDServices OpenAPI 5.27.0 that uses it:
 *
 *   company      50   GenerateReturnLabelSenderOrReceiver.company (the store
 *                     is the receiver of a return label)
 *   name         30   GenerateReturnLabelSenderOrReceiver.name
 *   street       30   GenerateReturnLabelSenderOrReceiver.address (100 on a
 *                     shipment, 30 on a return label)
 *   city         35   GenerateReturnLabelSenderOrReceiver.city
 *   postal code  PL   Sender.postalCode of the courier order: 4 to 5
 *                     characters, so five Polish digits without the dash
 *   phone        20   Sender.phone of the courier order (30 on a return
 *                     label), required there and on a return label
 *   e-mail      100   SenderOrReceiver.email
 *
 * The orderer of a courier order (Orderer: name, fullName, phone, all
 * required, 100, 100 and 20 characters) falls back to the sender.
 *
 * Nothing here throws and nothing is cut: a value that does not fit is kept
 * as typed and reported as a problem, so the admin can say what to fix
 * instead of the plugin sending a clipped address.
 */

export type DpdSenderOption = {
  /** Company name, at most 50 characters. */
  company?: string
  /** Contact person, at most 30 characters. */
  name?: string
  /** Phone, required by the courier order and the return label. */
  phone?: string
  email?: string
  /** Street and number in one line, at most 30 characters. */
  street?: string
  /** At most 35 characters. */
  city?: string
  /** "00-950" or "00950"; a courier order needs a Polish one. */
  postalCode?: string
  /** ISO alpha-2, default PL. */
  countryCode?: string
}

export type DpdOrdererOption = {
  /** Short name (DPD Orderer.name), default the sender's company. */
  name?: string
  /** Full name of the person (DPD Orderer.fullName), default the sender's contact person. */
  fullName?: string
  phone?: string
}

export type ResolvedSender = {
  company: string
  name: string
  phone: string
  email: string
  street: string
  city: string
  /** Polish codes as five digits ("00950"), the form DPD takes; other countries upper case without spaces. */
  postalCode: string
  countryCode: string
}

export type ResolvedOrderer = {
  name: string
  fullName: string
  phone: string
}

/** The limits a sender must fit (characters). */
export const SENDER_LIMITS = {
  company: 50,
  name: 30,
  street: 30,
  city: 35,
  phone: 20,
  email: 100,
} as const

export const ORDERER_LIMITS = {
  name: 100,
  fullName: 100,
  phone: 20,
} as const

/**
 *   missing     no sender at all (outside demo mode)
 *   required    a field DPD requires is empty
 *   too_long    longer than the limit in `max`
 *   invalid     not a phone, an e-mail, a postal code or a country code
 *   not_polish  a courier order needs a sender in Poland
 */
export type SenderProblemCode = "missing" | "required" | "too_long" | "invalid" | "not_polish"

export type SenderProblem = {
  code: SenderProblemCode
  /** Where: "sender.street", "orderer.phone", "senders.sloc_01.city". */
  path: string
  max?: number
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : typeof v === "number" && Number.isFinite(v) ? String(v) : "")

/**
 * A phone as DPD takes it: digits, a leading + for a foreign number.
 *
 *   "+48 600 100 200", "0048600100200", "600-100-200"   "600100200"
 *   "+49 30 1234567"                                    "+49301234567"
 *
 * In Poland (the default) a number without a country code must have nine
 * digits. Null when the value cannot be a phone.
 */
export function normalizePhone(raw: unknown, countryCode = "PL"): string | null {
  let s = text(raw).replace(/[\s().\-/]/g, "")
  if (!s) return null
  /* 00 as the international prefix only before a country code and a number (0048 600 100 200), never in a nine digit number. */
  if (s.startsWith("00") && s.length >= 11) s = `+${s.slice(2)}`
  if (!/^\+?\d{6,15}$/.test(s)) return null
  const plus = s.startsWith("+")
  const digits = plus ? s.slice(1) : s
  if (/^48\d{9}$/.test(digits) && (plus || countryCode.toUpperCase() === "PL")) return digits.slice(2)
  if (plus) return `+${digits}`
  if (countryCode.toUpperCase() === "PL") return /^\d{9}$/.test(digits) ? digits : null
  return digits
}

/** Five digits for Poland ("00-950" and "00950" become "00950"); other countries upper case, without spaces and dashes. */
export function normalizePostalCode(raw: unknown, countryCode = "PL"): string {
  const s = text(raw)
  if (countryCode.toUpperCase() === "PL") {
    const d = s.replace(/[\s-]/g, "")
    return /^\d{5}$/.test(d) ? d : s
  }
  return s.toUpperCase().replace(/[\s-]/g, "")
}

export function isPolishPostalCode(code: string): boolean {
  return /^\d{5}$/.test(code)
}

/** A plain e-mail check: a name, one at sign, a domain with a dot, no spaces. */
export function isEmail(raw: unknown): boolean {
  const s = text(raw)
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)
}

export function isCountryCode(raw: unknown): boolean {
  return /^[A-Z]{2}$/.test(text(raw).toUpperCase())
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** The sender as typed, cleaned (spaces, the phone, the postal code, upper case country). Never cut. */
export function resolveSender(v: unknown): ResolvedSender {
  const o = record(v)
  const countryCode = text(o.countryCode).toUpperCase() || "PL"
  const phoneRaw = text(o.phone)
  return {
    company: text(o.company),
    name: text(o.name),
    phone: normalizePhone(phoneRaw, countryCode) ?? phoneRaw,
    email: text(o.email),
    street: text(o.street),
    city: text(o.city),
    postalCode: normalizePostalCode(o.postalCode, countryCode),
    countryCode,
  }
}

/** Any field typed at all. */
export function hasSender(s: ResolvedSender | null | undefined): boolean {
  return Boolean(s && [s.company, s.name, s.phone, s.email, s.street, s.city, s.postalCode].some((x) => x !== ""))
}

/** The orderer of a courier order, each field falling back to the sender. */
export function resolveOrderer(v: unknown, sender: ResolvedSender): ResolvedOrderer {
  const o = record(v)
  const phoneRaw = text(o.phone)
  return {
    name: text(o.name) || sender.company || sender.name,
    fullName: text(o.fullName) || sender.name || sender.company,
    phone: phoneRaw ? (normalizePhone(phoneRaw) ?? phoneRaw) : sender.phone,
  }
}

/** The problems of one sender, under `path` ("sender", "senders.sloc_01"). */
export function validateSender(s: ResolvedSender, path = "sender"): SenderProblem[] {
  const out: SenderProblem[] = []
  const long = (field: keyof typeof SENDER_LIMITS, value: string) => {
    if (value.length > SENDER_LIMITS[field]) out.push({ code: "too_long", path: `${path}.${field}`, max: SENDER_LIMITS[field] })
  }
  if (!s.company && !s.name) out.push({ code: "required", path: `${path}.company` })
  long("company", s.company)
  long("name", s.name)
  if (!s.street) out.push({ code: "required", path: `${path}.street` })
  long("street", s.street)
  if (!s.city) out.push({ code: "required", path: `${path}.city` })
  long("city", s.city)
  if (!isCountryCode(s.countryCode)) out.push({ code: "invalid", path: `${path}.countryCode` })
  else if (s.countryCode !== "PL") out.push({ code: "not_polish", path: `${path}.countryCode` })
  if (!s.postalCode) out.push({ code: "required", path: `${path}.postalCode` })
  else if (s.countryCode === "PL" && !isPolishPostalCode(s.postalCode)) out.push({ code: "invalid", path: `${path}.postalCode` })
  if (!s.phone) out.push({ code: "required", path: `${path}.phone` })
  else if (normalizePhone(s.phone, s.countryCode) === null) out.push({ code: "invalid", path: `${path}.phone` })
  else long("phone", s.phone)
  if (s.email) {
    if (!isEmail(s.email)) out.push({ code: "invalid", path: `${path}.email` })
    else long("email", s.email)
  }
  return out
}

export function validateOrderer(o: ResolvedOrderer, path = "orderer"): SenderProblem[] {
  const out: SenderProblem[] = []
  const check = (field: keyof typeof ORDERER_LIMITS, value: string) => {
    if (!value) out.push({ code: "required", path: `${path}.${field}` })
    else if (value.length > ORDERER_LIMITS[field]) out.push({ code: "too_long", path: `${path}.${field}`, max: ORDERER_LIMITS[field] })
  }
  check("name", o.name)
  check("fullName", o.fullName)
  check("phone", o.phone)
  if (o.phone && normalizePhone(o.phone) === null) out.push({ code: "invalid", path: `${path}.phone` })
  return out
}

/**
 * Every sender problem of the options, for the admin and the boot log:
 * the sender, the orderer and each sender of `senders`. Demo mode needs no
 * sender (it uses a sample one), so a missing sender is no problem there.
 */
export function senderProblems(o: { demo: boolean; sender: ResolvedSender; orderer: ResolvedOrderer; senders: Readonly<Record<string, ResolvedSender>> }): SenderProblem[] {
  const out: SenderProblem[] = []
  if (!hasSender(o.sender)) {
    if (!o.demo) out.push({ code: "missing", path: "sender" })
  } else {
    out.push(...validateSender(o.sender, "sender"))
    out.push(...validateOrderer(o.orderer, "orderer"))
  }
  for (const [locationId, s] of Object.entries(o.senders)) out.push(...validateSender(s, `senders.${locationId}`))
  return out
}

/** The sender of a stock location: its own from `senders`, else the main one. */
export function senderFor(o: { sender: ResolvedSender; senders: Readonly<Record<string, ResolvedSender>> }, locationId: string | null | undefined): ResolvedSender {
  return (locationId && o.senders[locationId]) || o.sender
}
