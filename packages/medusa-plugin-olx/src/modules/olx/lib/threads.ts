/**
 * MESSAGE THREADS, READ ONLY. `GET /threads` (scope `read`) lists the
 * seller's conversations: one thread per buyer and advert, with the number of
 * messages and of unread messages. Pure, zero imports.
 *
 * WHAT IS KEPT: the thread key (its `uuid`, documented as the preferred
 * identifier, or the deprecated numeric `id`), the advert id, the two counts,
 * the creation date and the favourite flag. NOT KEPT: the buyer's user id and
 * every message text. Reading the conversation happens on OLX, where the
 * admin links (the chat inbox and the advert).
 *
 * PAGING WITHOUT A KNOWN PAGE SIZE. The documentation names `offset` and
 * `limit` without a maximum, so the read moves by the number of threads it
 * actually got and stops on an EMPTY page, never on a short one: a server cap
 * below our `limit` would otherwise look like the end of the list.
 */

export interface OlxThreadInput {
  key: string
  advertId: string | null
  unread: number
  total: number
  createdAt: string | null
  favourite: boolean
}

function count(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function date(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  const text = raw.trim().replace(" ", "T")
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text)
  const t = Date.parse(hasZone ? text : `${text}Z`)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** One page of `GET /threads`: an array, or `{ data: [...] }`. */
export function parseThreads(raw: unknown): OlxThreadInput[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).data)
      ? ((raw as Record<string, unknown>).data as unknown[])
      : []
  const out: OlxThreadInput[] = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const t = item as Record<string, unknown>
    const uuid = typeof t.uuid === "string" ? t.uuid.trim() : ""
    const legacy = t.id === null || t.id === undefined ? "" : String(t.id).trim()
    const key = uuid || legacy
    if (!key) continue
    const advert = t.advert_id === null || t.advert_id === undefined ? "" : String(t.advert_id).trim()
    out.push({
      key,
      advertId: advert || null,
      unread: count(t.unread_count),
      total: count(t.total_count),
      createdAt: date(t.created_at),
      favourite: t.is_favourite === true,
    })
  }
  return out
}

export interface ThreadTotals {
  threads: number
  unreadThreads: number
  unreadMessages: number
}

export function threadTotals(threads: ReadonlyArray<{ unread: number }>): ThreadTotals {
  let unreadThreads = 0
  let unreadMessages = 0
  for (const t of threads) {
    if (t.unread > 0) {
      unreadThreads += 1
      unreadMessages += t.unread
    }
  }
  return { threads: threads.length, unreadThreads, unreadMessages }
}
