/**
 * CUSTOMER ISSUES, READ ONLY. Pure, zero imports.
 *
 *   returns    `GET /order/customer-returns` (beta), orders:read
 *   disputes   `GET /sale/issues` (beta), type DISPUTE, allegro:api:disputes
 *   claims     `GET /sale/issues` (beta), type CLAIM
 *   messages   `GET /messaging/threads`, allegro:api:messaging: a count of
 *              unread threads, nothing else
 *
 * Stored: ids, statuses, reason CODES, dates, item counts. Never stored: the
 * buyer, the description, the chat, the attachments. The admin links each
 * issue to the seller panel and, when the order was imported, to Medusa.
 */

export type IssueKind = "return" | "dispute" | "claim"

export interface IssueInput {
  kind: IssueKind
  allegroId: string
  checkoutFormId: string | null
  status: string
  reasonCode: string | null
  referenceNumber: string | null
  openedAt: string | null
  dueAt: string | null
  needsReply: boolean
  open: boolean
  items: number
  lastMessageAt: string | null
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function str(v: unknown, max = 100): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

function iso(v: unknown): string | null {
  const s = str(v, 40)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Return statuses that still need the seller (a parcel on its way, delivered and not refunded). */
const OPEN_RETURNS = new Set(["CREATED", "DISPATCHED", "IN_TRANSIT", "DELIVERED", "WAREHOUSE_DELIVERED", "WAREHOUSE_VERIFICATION"])

export function returnsFromApi(raw: unknown): IssueInput[] {
  const out: IssueInput[] = []
  for (const r of Array.isArray(obj(raw).customerReturns) ? (obj(raw).customerReturns as unknown[]) : []) {
    const o = obj(r)
    const id = str(o.id, 64)
    if (!id) continue
    const status = (str(o.status, 40) ?? "CREATED").toUpperCase()
    const items = Array.isArray(o.items) ? o.items : []
    const reason = obj(obj(items[0]).reason)
    out.push({
      kind: "return",
      allegroId: id,
      checkoutFormId: str(o.orderId, 64),
      status,
      reasonCode: str(reason.type, 60),
      referenceNumber: str(o.referenceNumber, 60),
      openedAt: iso(o.createdAt),
      dueAt: null,
      /* A delivered return waits for the refund: that is the seller's move. */
      needsReply: status === "DELIVERED" || status === "WAREHOUSE_DELIVERED",
      open: OPEN_RETURNS.has(status),
      items: items.reduce<number>((sum, it) => sum + (Number(obj(it).quantity) || 0), 0),
      lastMessageAt: null,
    })
  }
  return out
}

/** The last message is not the seller's: the buyer or an Allegro advisor waits for an answer. */
const WAITING_FOR_SELLER = new Set(["NEW", "BUYER_REPLIED", "ALLEGRO_ADVISOR_REPLIED"])
const OPEN_ISSUES = new Set(["DISPUTE_ONGOING", "DISPUTE_UNRESOLVED", "CLAIM_SUBMITTED"])

export function issuesFromApi(raw: unknown): IssueInput[] {
  const out: IssueInput[] = []
  for (const i of Array.isArray(obj(raw).issues) ? (obj(raw).issues as unknown[]) : []) {
    const o = obj(i)
    const id = str(o.id, 64)
    if (!id) continue
    const type = String(o.type ?? "").toUpperCase()
    const state = obj(o.currentState)
    const status = (str(state.status, 40) ?? (type === "CLAIM" ? "CLAIM_SUBMITTED" : "DISPUTE_ONGOING")).toUpperCase()
    const last = obj(obj(o.chat).lastMessage)
    const lastStatus = String(last.status ?? "").toUpperCase()
    const open = OPEN_ISSUES.has(status)
    out.push({
      kind: type === "CLAIM" ? "claim" : "dispute",
      allegroId: id,
      checkoutFormId: str(obj(o.checkoutForm).id, 64),
      status,
      reasonCode: str(o.subject, 80),
      referenceNumber: str(o.referenceNumber, 60),
      openedAt: iso(o.openedDate),
      dueAt: iso(o.decisionDueDate) ?? iso(state.statusDueDate),
      needsReply: open && state.chatActive !== false && WAITING_FOR_SELLER.has(lastStatus),
      open,
      items: 0,
      lastMessageAt: iso(last.createdAt),
    })
  }
  return out
}

/** Unread threads among the threads read (`read: false`). */
export function unreadThreads(pages: readonly unknown[]): { unread: number; scanned: number } {
  let unread = 0
  let scanned = 0
  const seen = new Set<string>()
  for (const page of pages) {
    for (const t of Array.isArray(obj(page).threads) ? (obj(page).threads as unknown[]) : []) {
      const o = obj(t)
      const id = str(o.id, 64)
      if (!id || seen.has(id)) continue
      seen.add(id)
      scanned += 1
      if (o.read === false) unread += 1
    }
  }
  return { unread, scanned }
}

/** Counters for the admin tiles. */
export function issueCounts(rows: ReadonlyArray<Pick<IssueInput, "kind" | "open" | "needsReply" | "dueAt">>, now: Date) {
  const soon = now.getTime() + 3 * 24 * 60 * 60 * 1000
  return {
    returnsOpen: rows.filter((r) => r.kind === "return" && r.open).length,
    disputesOpen: rows.filter((r) => r.kind === "dispute" && r.open).length,
    claimsOpen: rows.filter((r) => r.kind === "claim" && r.open).length,
    needReply: rows.filter((r) => r.needsReply).length,
    dueSoon: rows.filter((r) => r.open && r.dueAt && new Date(r.dueAt).getTime() <= soon).length,
  }
}
