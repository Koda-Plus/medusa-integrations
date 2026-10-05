/**
 * CUSTOMER ISSUES, READ ONLY: customer returns, disputes and claims, and the
 * number of unread message threads. Nothing is answered, accepted or
 * rejected: the admin counts them and links to the seller panel (and to the
 * imported Medusa order when there is one).
 *
 * A part whose scope the stored token lacks is skipped with a note: returns
 * need orders:read, disputes and claims `allegro:api:disputes`, messages
 * `allegro:api:messaging` (the last two have no read-only variant, so they
 * are off unless `issues.disputes` / `issues.messages` turn them on).
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import type AllegroModuleService from "../../modules/allegro/service"
import { getCustomerReturns, getIssues, getThreads } from "../../modules/allegro/lib/api"
import { grantedScope, isConnected } from "../../modules/allegro/lib/connection"
import { DISPUTES_SCOPE, MESSAGING_SCOPE, ORDERS_SCOPE, THREADS_SCANNED } from "../../modules/allegro/lib/constants"
import { demoIssuesRaw, demoThreadsRaw } from "../../modules/allegro/lib/demo-stream"
import { issuesFromApi, returnsFromApi, unreadThreads, type IssueInput } from "../../modules/allegro/lib/issues"
import { grantedScopes } from "../../modules/allegro/lib/writers"
import { loadCatalog } from "./catalog"
import { demoStream } from "./demo-sim"
import { allegroOf, chunks, errorText, exclusive, queryOf, recordRun, setState } from "./runtime"

const DAY_MS = 24 * 60 * 60 * 1000
const RETURNS_DAYS = 30
const KEEP_DAYS = 120
const MAX_PAGES = 5

export interface IssuesRunResult {
  skipped: null | "running" | "not_configured" | "not_connected"
  counts: Record<string, number>
  notes: string[]
}

async function upsertIssues(svc: AllegroModuleService, items: readonly IssueInput[], demo: boolean): Promise<{ created: number; updated: number }> {
  if (items.length === 0) return { created: 0, updated: 0 }
  const existing = (await svc.listAllegroIssues({ allegro_id: items.map((i) => i.allegroId), demo } as never, { take: null, select: ["id", "kind", "allegro_id"] })) as unknown as Array<{
    id: string
    kind: string
    allegro_id: string
  }>
  const byKey = new Map(existing.map((r) => [`${r.kind}:${r.allegro_id}`, r.id]))
  const creates: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  for (const i of items) {
    const data = {
      kind: i.kind,
      allegro_id: i.allegroId,
      checkout_form_id: i.checkoutFormId,
      status: i.status,
      reason_code: i.reasonCode,
      reference_number: i.referenceNumber,
      opened_at: i.openedAt ? new Date(i.openedAt) : null,
      due_at: i.dueAt ? new Date(i.dueAt) : null,
      needs_reply: i.needsReply,
      is_open: i.open,
      items: i.items,
      last_message_at: i.lastMessageAt ? new Date(i.lastMessageAt) : null,
      demo,
    }
    const id = byKey.get(`${i.kind}:${i.allegroId}`)
    if (id) updates.push({ id, ...data })
    else creates.push(data)
  }
  for (const part of chunks(creates, 200)) await svc.createAllegroIssues(part as never)
  for (const part of chunks(updates, 200)) await svc.updateAllegroIssues(part as never)
  return { created: creates.length, updated: updates.length }
}

export async function runIssues(container: MedusaContainer, input: { trigger?: string } = {}): Promise<IssuesRunResult> {
  const result = await exclusive("issues", async (): Promise<IssuesRunResult> => {
    const svc = allegroOf(container)
    const o = svc.getOptions()
    const startedAt = new Date()
    const notes: string[] = []
    const counts: Record<string, number> = {}
    if (!o.demo) {
      if (!svc.isConfigured()) return { skipped: "not_configured", counts, notes }
      if (!(await isConnected(svc))) return { skipped: "not_connected", counts, notes }
    }
    const granted = o.demo ? null : grantedScopes(await grantedScope(svc))
    const can = (scope: string) => granted === null || granted.includes(scope)

    let returns: IssueInput[] = []
    let issues: IssueInput[] = []
    let threads: { unread: number; scanned: number } | null = null
    let failed = false
    try {
      if (o.demo) {
        const query = queryOf(container)
        const stream = await demoStream(svc, query, await loadCatalog(query, o.stockLocationIds), 7)
        const raw = demoIssuesRaw(stream.seeds, stream.now)
        if (o.issues.returns) returns = returnsFromApi(raw.returns)
        if (o.issues.disputes) issues = issuesFromApi(raw.issues)
        if (o.issues.messages) threads = unreadThreads([demoThreadsRaw(stream.now)])
      } else {
        if (o.issues.returns) {
          if (!can(ORDERS_SCOPE)) notes.push(`Customer returns need ${ORDERS_SCOPE}; connect the account again.`)
          else {
            const since = new Date(Date.now() - RETURNS_DAYS * DAY_MS)
            for (let page = 0; page < MAX_PAGES; page += 1) {
              const raw = await getCustomerReturns(svc, since, page * 100)
              const list = returnsFromApi(raw)
              returns.push(...list)
              if (list.length < 100) break
            }
          }
        }
        if (o.issues.disputes) {
          if (!can(DISPUTES_SCOPE)) notes.push(`Disputes and claims need ${DISPUTES_SCOPE}; connect the account again.`)
          else {
            for (let page = 0; page < MAX_PAGES; page += 1) {
              const list = issuesFromApi(await getIssues(svc, page * 100))
              issues.push(...list)
              if (list.length < 100) break
            }
          }
        }
        if (o.issues.messages) {
          if (!can(MESSAGING_SCOPE)) notes.push(`Unread messages need ${MESSAGING_SCOPE}; connect the account again.`)
          else {
            const pages: unknown[] = []
            for (let offset = 0; offset < THREADS_SCANNED; offset += 20) {
              const page = await getThreads(svc, offset)
              pages.push(page)
              const list = (page as { threads?: unknown[] } | null)?.threads
              if (!Array.isArray(list) || list.length < 20) break
            }
            threads = unreadThreads(pages)
          }
        }
      }
      const r = await upsertIssues(svc, [...returns, ...issues], o.demo)
      counts.created = r.created
      counts.updated = r.updated
      counts.returns = returns.length
      counts.issues = issues.length
      if (threads) {
        counts.unread = threads.unread
        await setState(svc, "messages", { unread: threads.unread, scanned: threads.scanned, at: new Date().toISOString(), demo: o.demo })
      }
      /* Old and other-mode rows go. */
      const old = (await svc.listAllegroIssues({ $or: [{ demo: !o.demo }, { opened_at: { $lt: new Date(Date.now() - KEEP_DAYS * DAY_MS) } }] } as never, {
        take: 1000,
        select: ["id"],
      })) as unknown as Array<{ id: string }>
      if (old.length > 0) await svc.deleteAllegroIssues(old.map((x) => x.id))
    } catch (err) {
      failed = true
      notes.push(errorText(svc, err))
    }
    await recordRun(svc, {
      kind: "issues",
      source: o.demo ? "demo" : "api",
      trigger: input.trigger ?? "manual",
      status: failed ? "error" : notes.length > 0 ? "partial" : "ok",
      items: returns.length + issues.length,
      created: counts.created ?? 0,
      updated: counts.updated ?? 0,
      statuses: counts,
      message: notes.join(" ") || null,
      startedAt,
    })
    return { skipped: null, counts, notes }
  })
  return result ?? { skipped: "running", counts: {}, notes: [] }
}
