/**
 * DEMO MODE: A SIMULATED FAKTUROWNIA ACCOUNT INSIDE THE PLUGIN. Zero imports,
 * zero outgoing requests.
 *
 * Lets anyone evaluate the plugin without a Fakturownia account. Documents
 * are built from the store's real orders by the SAME builder as live ones
 * (positions, totals, buyer type, kind), so bad order data fails like it
 * would live; only the answer comes from here.
 *
 * DETERMINISTIC (FNV-1a hash of the order id): the same order always gets the
 * same story, so a restart does not reshuffle the demo.
 *
 *   - numbers per kind and month: "FV 12/10/2026", "PRO 3/10/2026",
 *     "PAR 7/10/2026" (Fakturownia's default format is "<nr>/<mm>/<yyyy>"
 *     and accounts add their own prefixes; the demo adds one per kind so the
 *     kinds read at a glance);
 *   - paid: every document of a captured order, and about a third of the
 *     others, like payments a bank import marks in Fakturownia;
 *   - KSeF: a VAT invoice is "processing" after issue and "ok" (accepted, with
 *     a KSeF number) two to eight minutes later; proformas and receipts are
 *     "not_applicable";
 *   - the first visit backfills the newest orders, and one of them fails
 *     with a readable Fakturownia error, so the admin shows that state too.
 */

/** Fakturownia ids of simulated documents of version 0.1.0 start above this number. */
export const DEMO_ID_BASE = 700_000_000

/** A clearly fake seller NIP for simulated KSeF numbers. */
export const DEMO_SELLER_NIP = "0000000000"

const PREFIX: Record<string, string> = { vat: "FV", proforma: "PRO", receipt: "PAR", correction: "KOR" }

/**
 * SIMULATED IDS THAT CARRY THEIR NUMBER (since 0.2.0). A simulated document
 * id is `7`, a digit for the kind, the year and month of issue and a five
 * digit sequence: 7 1 202610 00012 is "FV 12/10/2026". So anything that only
 * knows the id (another plugin calling `downloadPdf({ externalId, demo })`,
 * which must not read the database) can still print the number. Ids of
 * version 0.1.0 (700000001 and up) stay valid and simply carry no number.
 */
const KIND_DIGIT: Record<string, string> = { vat: "1", proforma: "2", receipt: "3", correction: "4" }
const DIGIT_KIND: Record<string, string> = { "1": "vat", "2": "proforma", "3": "receipt", "4": "correction" }

export function encodeDemoId(kind: string, issueDate: string, sequence: number): string {
  const digit = KIND_DIGIT[kind] ?? "9"
  const yyyymm = `${issueDate.slice(0, 4)}${issueDate.slice(5, 7)}`
  const seq = String(Math.min(99_999, Math.max(1, Math.floor(sequence)))).padStart(5, "0")
  return `7${digit}${yyyymm}${seq}`
}

export interface DecodedDemoId {
  kind: string
  /** `YYYY-MM-01`: the month of issue. */
  month: string
  sequence: number
  number: string
}

/** The kind and number of an id from `encodeDemoId`, or null (an id of 0.1.0, or not a demo id). */
export function decodeDemoId(id: string | number): DecodedDemoId | null {
  const m = /^7([1-4])(\d{4})(\d{2})(\d{5})$/.exec(String(id ?? "").trim())
  if (!m) return null
  const month = Number(m[3])
  if (month < 1 || month > 12) return null
  const kind = DIGIT_KIND[m[1]]
  const sequence = Number(m[4])
  const date = `${m[2]}-${m[3]}-01`
  return { kind, month: date, sequence, number: demoNumber(kind, sequence, date) }
}

/** FNV-1a, 32 bit. Stable across processes, so demo data does not jump on a restart. */
export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** "FV 12/10/2026": the sequence number within the month, the month, the year. */
export function demoNumber(kind: string, sequence: number, issueDate: string): string {
  const prefix = PREFIX[kind] ?? "DOK"
  return `${prefix} ${Math.max(1, Math.floor(sequence))}/${issueDate.slice(5, 7)}/${issueDate.slice(0, 4)}`
}

/** The next simulated Fakturownia id after the highest one given out. */
export function nextDemoId(highestGiven: number | null): number {
  return highestGiven && highestGiven > DEMO_ID_BASE ? highestGiven + 1 : DEMO_ID_BASE + 1
}

/** Paid at issue: a captured order always, about a third of the others. */
export function demoPaid(orderId: string, captured: boolean): boolean {
  return captured || hash32(`${orderId}#paid`) % 3 === 0
}

/** Minutes until KSeF accepts a simulated VAT invoice: 2, 3, 4, 6 or 8. */
export function demoKsefMinutes(orderId: string): number {
  return [2, 3, 4, 6, 8][hash32(`${orderId}#ksef`) % 5]
}

/** The simulated `gov_status` of a document now. */
export function demoGovStatus(args: { kind: string; orderId: string; issuedAt: Date; now: Date }): string {
  if (args.kind !== "vat" && args.kind !== "correction") return "not_applicable"
  const ready = args.issuedAt.getTime() + demoKsefMinutes(args.orderId) * 60_000
  return args.now.getTime() >= ready ? "ok" : "processing"
}

/** A KSeF-shaped number, `{NIP}-{YYYYMMDD}-{12 hex}`, stable per order and fake by its NIP. */
export function demoGovId(orderId: string, issueDate: string): string {
  const a = hash32(`${orderId}#gov-a`).toString(16).toUpperCase().padStart(8, "0")
  const b = hash32(`${orderId}#gov-b`).toString(16).toUpperCase().padStart(8, "0")
  return `${DEMO_SELLER_NIP}-${issueDate.replace(/-/g, "")}-${(a + b).slice(0, 12)}`
}

/** Of the backfilled orders, the one that shows a failed document: the lowest hash. */
export function demoFailingOrder(orderIds: readonly string[]): string | null {
  if (orderIds.length < 3) return null
  return [...orderIds].sort((a, b) => hash32(`${a}#fail`) - hash32(`${b}#fail`))[0]
}

/**
 * The KSeF rejection of the demo, word for word the example of the KSeF guide
 * of the Fakturownia API (KSeF.md, "Sprawdzanie błędów walidacji").
 */
export const DEMO_KSEF_REJECTION = "Telefon klienta - pole jest za długie (maksymalna ilość znaków: 16)"

/** Days back the demo seed moves a few unpaid documents, so reminders and the monthly summary have something to show. */
export const DEMO_BACKDATE_DAYS: readonly number[] = [9, 16, 38]

/**
 * The readable refusal of the failing demo document, shaped like a real
 * Fakturownia 422: the example of the KSeF guide of the API (a line with the
 * zw rate without the basis of the exemption on a KSeF account). A wrong NIP
 * no longer reaches Fakturownia since 0.2.0, so it is not the demo's example.
 */
export const DEMO_FAILURE = {
  code: "HTTP_422",
  status: 422,
  detail:
    "exempt_tax_kind: nie może być puste. Demo: this is how a refused document waits for a person; after the data is corrected, Retry sends it again.",
} as const
