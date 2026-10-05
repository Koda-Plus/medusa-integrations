/**
 * MESSAGE THREADS, READ ONLY: counts per thread (unread and total) and the
 * advert each thread is about. A complete read replaces the stored threads, an
 * incomplete one only adds and updates. Demo mode: simulated conversations
 * about the live demo adverts, through the same parser.
 */

import { ipBlockedUntil } from "../../modules/olx/lib/block"
import { isConnected } from "../../modules/olx/lib/connection"
import { demoThreadsRaw } from "../../modules/olx/lib/demo"
import type { ThreadRow } from "../../modules/olx/lib/dto"
import { readAllThreads, type ThreadsRead } from "../../modules/olx/lib/partner-api"
import { parseThreads } from "../../modules/olx/lib/threads"
import { chunks, isLocked, modeKey, olxServiceOf, setState, withLock, type Scope } from "./runtime"

export interface ThreadsRunState {
  at: string
  complete: boolean
  pages: number
  threads: number
  message: string | null
}

export function threadsStateKey(demo: boolean): string {
  return `threads:${modeKey(demo)}`
}

export function isThreadsRunning(): boolean {
  return isLocked("threads")
}

export async function runOlxThreads(scope: Scope, _input: { trigger?: string } = {}): Promise<ThreadsRunState | null> {
  const svc = olxServiceOf(scope)
  const o = svc.getOptions()
  const demo = o.demo
  if (!o.messagesEnabled) return null
  if (!demo) {
    if (!svc.isConfigured() || !(await isConnected(svc))) return null
    if (ipBlockedUntil(Date.now())) return null
  }
  return withLock("threads", async () => {
    const now = new Date()
    let read: ThreadsRead
    if (demo) {
      const adverts = (await svc.listOlxAdverts({ demo: true } as never, {
        take: null,
        select: ["olx_id", "status", "olx_created_at"],
      })) as unknown as Array<{ olx_id: string; status: string; olx_created_at: Date | string | null }>
      const day = new Date(now)
      day.setUTCMinutes(0, 0, 0)
      const raw = demoThreadsRaw(
        adverts.map((a) => ({ olxId: a.olx_id, status: a.status, createdAt: a.olx_created_at })),
        day,
      )
      read = { threads: parseThreads(raw), complete: true, pages: 1, reason: null }
    } else {
      read = await readAllThreads(svc)
    }

    const stored = (await svc.listOlxThreads({ demo } as never, { take: null })) as unknown as ThreadRow[]
    const byKey = new Map(stored.map((r) => [r.thread_key, r]))
    const seen = new Set<string>()
    const creates: Record<string, unknown>[] = []
    const updates: Record<string, unknown>[] = []
    for (const t of read.threads) {
      seen.add(t.key)
      const data = {
        thread_key: t.key,
        advert_olx_id: t.advertId,
        unread_count: t.unread,
        total_count: t.total,
        olx_created_at: t.createdAt ? new Date(t.createdAt) : null,
        is_favourite: t.favourite,
        demo,
      }
      const row = byKey.get(t.key)
      if (!row) creates.push(data)
      else if (
        row.advert_olx_id !== data.advert_olx_id ||
        row.unread_count !== data.unread_count ||
        row.total_count !== data.total_count ||
        Boolean(row.is_favourite) !== data.is_favourite
      ) {
        updates.push({ id: row.id, ...data })
      }
    }
    const removeIds = read.complete ? stored.filter((r) => !seen.has(r.thread_key)).map((r) => r.id) : []
    for (const part of chunks(removeIds, 500)) await svc.deleteOlxThreads(part)
    for (const part of chunks(creates, 200)) await svc.createOlxThreads(part as never)
    for (const part of chunks(updates, 200)) await svc.updateOlxThreads(part as never)

    const state: ThreadsRunState = {
      at: now.toISOString(),
      complete: read.complete,
      pages: read.pages,
      threads: read.threads.length,
      message: read.reason,
    }
    await setState(svc, threadsStateKey(demo), state)
    return state
  })
}
