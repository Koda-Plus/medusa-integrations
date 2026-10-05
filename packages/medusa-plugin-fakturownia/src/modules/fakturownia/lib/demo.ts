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

/** Fakturownia ids of simulated documents start above this number. */
export const DEMO_ID_BASE = 700_000_000

/** A clearly fake seller NIP for simulated KSeF numbers. */
export const DEMO_SELLER_NIP = "0000000000"

const PREFIX: Record<string, string> = { vat: "FV", proforma: "PRO", receipt: "PAR" }

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
  if (args.kind !== "vat") return "not_applicable"
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

/** The readable refusal of the failing demo document, shaped like a real Fakturownia 422. */
export const DEMO_FAILURE = {
  code: "HTTP_422",
  status: 422,
  detail:
    "buyer_tax_no: nieprawidłowy numer NIP. Demo: this is how a refused document waits for a person; after the order data is corrected, Retry sends it again.",
} as const
