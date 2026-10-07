import type { DocumentRow, PlanRow } from "./dto"
import type { CounterDraft, FactDraft, MessageDraft, SummaryDraft } from "./kit-routes"
import type { SummaryState, Tone } from "./kit-contract"
import { integrationEn, integrationPl } from "./integration-texts"
import { goesToKsef, govState } from "./status"
import { isUnpaid } from "./unpaid"

/**
 * Fakturownia in the koda.integration/1 contract, as pure functions over the
 * plugin's own rows (testable without a database): one line per order and
 * per customer, the document and buyer facts of an overview card, and the
 * board counters.
 *
 * THE WORST RECORD SPEAKS. Every document of the order counts (the final
 * document, its proforma, its corrections) and every open plan: red first
 * (not issued, a lost answer, a KSeF rejection), then orange (waits for a
 * person: a correction to approve or to send, a proforma of a canceled order
 * still active, an e-mail that failed, a NIP to check, an unpaid document
 * past the reminder age, an order whose trigger is met without a document),
 * then blue (being issued, KSeF processing, an e-mail waiting for the KSeF
 * number), then green (issued). Nothing comes from order or cart metadata:
 * the rows are the plugin's record (the buyer fact says company or consumer
 * from what the row stored; the NIP itself is never kept), and the order is
 * read by id for its status and payments only.
 */

export const FAKTUROWNIA_EXTERNAL_HOSTS = ["fakturownia.pl"] as const
export const ORDER_WIDGET = "fakturownia.order"
export const ADMIN_PATH = "/fakturownia"

type Lang = "en" | "pl"

const KINDS: Record<Lang, Record<string, string>> = { en: integrationEn.kind, pl: integrationPl.kind }

/** "Faktura VAT", "Paragon": the kind in the answer's language. */
export function kindLabel(kind: string, lang: Lang): string {
  return KINDS[lang][kind] ?? KINDS.en[kind] ?? kind
}

/** "Faktura VAT FV 12/10/2026": the kind and the number Fakturownia gave. */
export function documentLabel(row: Pick<DocumentRow, "kind" | "number">, lang: Lang): string {
  const kind = kindLabel(row.kind, lang)
  return row.number ? `${kind} ${row.number}` : kind
}

/** What the plugin reads of a Medusa order (by id): its number, whether it is canceled, whether the trigger is met. */
export interface OrderFacts {
  id: string
  displayId: number | null
  canceled: boolean
  /** The trigger of the first document is met: the order is placed (`trigger: "order_placed"`) or captured in full. */
  triggerMet: boolean
}

export interface SummaryContext {
  lang: Lang
  demo: boolean
  /** A token and a valid account, or demo mode. */
  configured: boolean
  /** The corrections writer is armed: an approved correction goes out by itself. */
  correctionsArmed: boolean
  /** `YYYY-MM-DD` in Poland: an unpaid document issued on or before it waits too long. */
  overdueOn: string
  /** A date in the answer's language (`ctx.date` of the kit). */
  date: (value: string | Date) => string
}

interface Line {
  state: SummaryState
  title: MessageDraft
}

const RANK: Record<SummaryState, number> = { failed: 0, attention: 1, active: 2, ok: 3, none: 4, off: 4, unavailable: 4 }

const ISSUED = (r: Pick<DocumentRow, "status">) => r.status === "issued" || r.status === "needs_correction"

const order = (key: string, params?: Record<string, string | number>): MessageDraft => ({ key: `integration.order.${key}`, ...(params ? { params } : {}) })
const fact = (key: string, params?: Record<string, string | number>): MessageDraft => ({ key: `integration.fact.${key}`, ...(params ? { params } : {}) })

/** The document that speaks for an order: the final one (VAT invoice or receipt), else the proforma. Corrections apart. */
export function mainDocument(rows: readonly DocumentRow[]): DocumentRow | null {
  const pick = (list: DocumentRow[]) => list.find((r) => r.status !== "canceled") ?? list[0] ?? null
  return pick(rows.filter((r) => r.kind === "vat" || r.kind === "receipt")) ?? pick(rows.filter((r) => r.kind === "proforma"))
}

function warningOf(row: DocumentRow): string | null {
  let w = row.buyer_warning as unknown
  if (typeof w === "string") {
    try {
      w = JSON.parse(w)
    } catch {
      return null
    }
  }
  const code = w && typeof w === "object" ? (w as { code?: unknown }).code : null
  return typeof code === "string" ? code : null
}

function convertedIds(rows: readonly DocumentRow[]): Set<string> {
  return new Set(rows.map((r) => r.from_fakturownia_id).filter((id): id is string => Boolean(id)))
}

/** The order's document trigger is met and no document exists: a person should issue it ("Issue now"). */
function toIssue(rows: readonly DocumentRow[], facts: OrderFacts | null, ctx: SummaryContext): boolean {
  return Boolean(facts && ctx.configured && !facts.canceled && facts.triggerMet && rows.every((r) => r.kind === "correction"))
}

/** Every signal of an order, in the order of the rules (the worst first after sorting by rank). */
function lines(rows: readonly DocumentRow[], plans: readonly PlanRow[], facts: OrderFacts | null, ctx: SummaryContext): Line[] {
  const out: Line[] = []
  const main = mainDocument(rows)
  const converted = convertedIds(rows)
  /* red */
  for (const r of rows) {
    if (r.status === "failed") out.push({ state: "failed", title: order(r.kind === "correction" ? "correctionFailed" : "failed") })
    else if (r.status === "unknown") out.push({ state: "failed", title: order("unknown") })
    else if (ISSUED(r) && goesToKsef(r.kind) && govState(r.gov_status) === "problem") out.push({ state: "failed", title: order("ksefRejected") })
  }
  /* orange */
  if (main?.status === "needs_correction") out.push({ state: "attention", title: order("needsCorrection") })
  for (const p of plans) {
    if (p.status === "draft") out.push({ state: "attention", title: order("correctionToApprove") })
    else if (p.status === "manual") out.push({ state: "attention", title: order("correctionManual") })
  }
  for (const r of rows) {
    if (r.kind === "correction" && r.status === "pending" && !ctx.correctionsArmed) out.push({ state: "attention", title: order("correctionWaitsWriter") })
    if (r.kind === "proforma" && r.status === "issued" && r.error_code === "reject_failed") out.push({ state: "attention", title: order("rejectFailed") })
    if (r.email_status === "failed") out.push({ state: "attention", title: order("emailFailed") })
    if (isUnpaid(r, converted) && r.issue_date && r.issue_date <= ctx.overdueOn) out.push({ state: "attention", title: order("unpaidOverdue", { date: ctx.date(r.issue_date) }) })
  }
  if (main && ISSUED(main) && warningOf(main)) out.push({ state: "attention", title: order("buyerWarning") })
  if (toIssue(rows, facts, ctx)) out.push({ state: "attention", title: order("toIssue") })
  /* blue */
  for (const r of rows) {
    const waitsForPerson = r.kind === "correction" && r.status === "pending" && !ctx.correctionsArmed
    if (r.status === "issuing" || (r.status === "pending" && !waitsForPerson)) out.push({ state: "active", title: order("issuing") })
    if (ISSUED(r) && goesToKsef(r.kind) && (govState(r.gov_status) === "processing" || govState(r.gov_status) === "offline")) out.push({ state: "active", title: order("ksefProcessing") })
    if (r.email_status === "pending" || r.email_status === "sending") out.push({ state: "active", title: order("emailWaiting") })
  }
  /* green */
  if (main?.status === "issued") out.push({ state: "ok", title: order("issued", { document: documentLabel(main, ctx.lang) }) })
  return out
}

function ksefSub(row: DocumentRow): { sub: MessageDraft | null; tone: Tone | null } {
  if (!goesToKsef(row.kind)) return { sub: null, tone: null }
  switch (govState(row.gov_status)) {
    case "accepted":
      return { sub: row.gov_id ? fact("ksefAccepted", { number: row.gov_id }) : fact("ksefAcceptedNoNumber"), tone: "green" }
    case "processing":
      return { sub: fact("ksefProcessing"), tone: "blue" }
    case "offline":
      return { sub: fact("ksefOffline"), tone: "blue" }
    case "problem":
      return { sub: fact("ksefRejected"), tone: "red" }
    default:
      return { sub: null, tone: null }
  }
}

/** The `document` fact (priority 80: Fakturownia is the system of record of its documents). */
export function documentFact(rows: readonly DocumentRow[], facts: OrderFacts | null, ctx: SummaryContext): FactDraft | null {
  const main = mainDocument(rows)
  const base = { slot: "document" as const, priority: 80 }
  if (!main) {
    if (!toIssue(rows, facts, ctx)) return null
    return { ...base, value: fact("documentToIssue"), tone: "orange", link: { kind: "admin", href: facts?.displayId ? `${ADMIN_PATH}?q=${facts.displayId}` : ADMIN_PATH } }
  }
  const link = { kind: "admin" as const, href: `${ADMIN_PATH}?doc=${main.id}` }
  const kind = kindLabel(main.kind, ctx.lang)
  if (ISSUED(main)) {
    const ksef = ksefSub(main)
    /* KSeF speaks first for the kinds that go there; a proforma or a receipt says whether it is paid. */
    const sub = ksef.sub ?? (main.kind === "correction" ? null : fact(main.paid ? "paid" : "unpaid"))
    const tone: Tone = main.status === "needs_correction" ? "orange" : (ksef.tone ?? "green")
    const out: FactDraft = { ...base, value: fact("document", { document: documentLabel(main, ctx.lang) }), tone, link }
    if (sub) out.sub = sub
    return out
  }
  if (main.status === "pending" || main.status === "issuing") return { ...base, value: fact("documentPending", { kind }), tone: "blue", link }
  if (main.status === "failed") return { ...base, value: fact("documentFailed", { kind }), tone: "red", link }
  if (main.status === "unknown") return { ...base, value: fact("documentUnknown", { kind }), tone: "red", link }
  if (main.status === "canceled" && main.number) return { ...base, value: fact("documentCanceled", { document: documentLabel(main, ctx.lang) }), tone: "grey", link }
  return null
}

/** The `buyer` fact (priority 60): company or consumer, as the issued document says. Never the NIP itself. */
export function buyerFact(rows: readonly DocumentRow[]): FactDraft | null {
  const main = mainDocument(rows)
  if (!main || !ISSUED(main) || (main.buyer_type !== "company" && main.buyer_type !== "person")) return null
  const base = { slot: "buyer" as const, priority: 60, link: { kind: "admin" as const, href: `${ADMIN_PATH}?doc=${main.id}` } }
  if (main.buyer_type === "company") return { ...base, value: fact("buyerCompany") }
  switch (warningOf(main)) {
    case "invalid_nip":
      return { ...base, value: fact("buyerInvalidNip"), tone: "orange" }
    case "company_without_nip":
      return { ...base, value: fact("buyerNoNip"), tone: "orange" }
    case "nip_on_receipt":
      return { ...base, value: fact("buyerReceiptNip"), tone: "orange" }
    default:
      return { ...base, value: fact("buyerPerson") }
  }
}

function latest(rows: readonly DocumentRow[]): Date | null {
  let best = 0
  for (const r of rows) {
    for (const v of [r.issued_at, r.gov_checked_at, r.updated_at]) {
      const t = v ? new Date(v as string | Date).getTime() : 0
      if (Number.isFinite(t) && t > best) best = t
    }
  }
  return best > 0 ? new Date(best) : null
}

/**
 * The line of one order from its rows and open plans (current mode) and the
 * order read by id. `undefined` when there is nothing to say (the kit then
 * answers "none").
 */
export function orderSummary(rows: readonly DocumentRow[], plans: readonly PlanRow[], facts: OrderFacts | null, ctx: SummaryContext): SummaryDraft | undefined {
  const href = facts?.displayId ? `${ADMIN_PATH}?q=${facts.displayId}` : facts ? `${ADMIN_PATH}?q=${facts.id}` : ADMIN_PATH
  const links = [{ kind: "admin" as const, href }]
  const docs = rows.filter((r) => r.kind !== "correction")
  const counts = {
    documents: docs.filter(ISSUED).length,
    corrections: rows.filter((r) => r.kind === "correction" && ISSUED(r)).length,
    unpaid: rows.filter((r) => isUnpaid(r, convertedIds(rows))).length,
  }
  const facts_ = [documentFact(rows, facts, ctx), buyerFact(rows)].filter((f): f is FactDraft => f !== null)
  const all = lines(rows, plans, facts, ctx)
  const sorted = [...all].sort((a, b) => RANK[a.state] - RANK[b.state])
  const worst = sorted[0]

  if (!worst) {
    const main = mainDocument(rows)
    let line: Line | null = null
    if (!ctx.configured) line = { state: "off", title: order("notConfigured") }
    else if (main?.status === "canceled" && main.number) line = { state: "none", title: order("canceled", { document: documentLabel(main, ctx.lang) }) }
    else if (facts?.canceled) line = { state: "none", title: order("canceledNone") }
    else if (facts && !facts.triggerMet && docs.length === 0) line = { state: "none", title: order("waitingPayment") }
    else if (rows.length > 0) line = { state: "none", title: order("canceledNone") }
    if (!line) return undefined
    return { state: line.state, title: line.title, ...(ctx.demo ? { detail: order("demo") } : {}), facts: facts_, counts, links, widget: ORDER_WIDGET, updatedAt: latest(rows) }
  }

  const more = all.filter((l) => RANK[l.state] <= RANK.attention).length - 1
  let detail: MessageDraft | undefined
  if (RANK[worst.state] <= RANK.attention && more > 0) detail = order("more", { count: more })
  else if (ctx.demo) detail = order("demo")
  return { state: worst.state, title: worst.title, ...(detail ? { detail } : {}), facts: facts_, counts, links, widget: ORDER_WIDGET, updatedAt: latest(rows) }
}

/**
 * The line of a customer: the worst of their orders speaks, with how many
 * orders it concerns; otherwise how many documents were issued. The last
 * issued document and its buyer are the facts.
 */
export function customerSummary(
  customerId: string,
  orders: ReadonlyArray<{ facts: OrderFacts; rows: readonly DocumentRow[]; plans: readonly PlanRow[] }>,
  ctx: SummaryContext,
): SummaryDraft | undefined {
  if (orders.length === 0) return undefined
  const links = [{ kind: "admin" as const, href: `${ADMIN_PATH}?customer=${customerId}` }]
  const states = orders.map((o) => orderSummary(o.rows, o.plans, o.facts, ctx)?.state ?? "none")
  const rows = orders.flatMap((o) => o.rows)
  const issued = rows.filter((r) => r.kind !== "correction" && ISSUED(r))
  const counts = { orders: orders.length, documents: issued.length, unpaid: rows.filter((r) => isUnpaid(r, convertedIds(rows))).length }
  const last = [...issued].sort((a, b) => new Date((b.issued_at ?? 0) as string | Date).getTime() - new Date((a.issued_at ?? 0) as string | Date).getTime())[0]
  const facts: FactDraft[] = []
  if (last) {
    facts.push({
      slot: "document",
      priority: 80,
      value: fact("lastDocument", { document: documentLabel(last, ctx.lang) }),
      ...(last.issued_at ? { sub: fact("issuedOn", { date: ctx.date(last.issued_at as string | Date) }) } : {}),
      link: { kind: "admin", href: `${ADMIN_PATH}?doc=${last.id}` },
    })
    const buyer = buyerFact([last])
    if (buyer) facts.push(buyer)
  }
  const n = (s: SummaryState) => states.filter((x) => x === s).length
  const c = (key: string, count?: number) => ({ key: `integration.customer.${key}`, ...(count !== undefined ? { params: { count } } : {}) })
  let state: SummaryState
  let title: MessageDraft
  if (!ctx.configured) {
    state = "off"
    title = order("notConfigured")
  } else if (n("failed") > 0) {
    state = "failed"
    title = c("failed", n("failed"))
  } else if (n("attention") > 0) {
    state = "attention"
    title = c("attention", n("attention"))
  } else if (n("active") > 0) {
    state = "active"
    title = c("active")
  } else if (issued.length > 0) {
    state = "ok"
    title = c("ok", issued.length)
  } else {
    state = "none"
    title = c("none")
  }
  return { state, title, ...(ctx.demo ? { detail: order("demo") } : {}), facts, counts, links, widget: null, updatedAt: latest(rows) }
}

/** The board counters, each the length of the list its link opens. */
export function fakturowniaCounters(
  counts: { attention: number; ksef: number; toApprove: number; toIssue: number },
  ids: { attention?: string[]; ksef?: string[]; toApprove?: string[]; toIssue?: string[] } = {},
): CounterDraft[] {
  const uniq = (list?: string[]) => (list && list.length > 0 ? [...new Set(list)] : undefined)
  return [
    { key: "documents_attention", scope: "orders", count: counts.attention, tone: "red", link: { kind: "admin", href: `${ADMIN_PATH}?filter=attention` }, entity: "order", ids: uniq(ids.attention) },
    { key: "ksef_problems", scope: "orders", count: counts.ksef, tone: "red", link: { kind: "admin", href: `${ADMIN_PATH}?filter=ksef` }, entity: "order", ids: uniq(ids.ksef) },
    { key: "corrections_to_approve", scope: "orders", count: counts.toApprove, tone: "orange", link: { kind: "admin", href: `${ADMIN_PATH}?plans=open` }, entity: "order", ids: uniq(ids.toApprove) },
    { key: "to_issue", scope: "orders", count: counts.toIssue, tone: "orange", link: { kind: "admin", href: `${ADMIN_PATH}?filter=pending` }, entity: "order", ids: uniq(ids.toIssue) },
  ]
}
