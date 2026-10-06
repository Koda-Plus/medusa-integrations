/**
 * WHAT THE ADMIN AND THE STORE READ: the queue, one thread, the widgets, the
 * status of the page and the customer's own threads. Reads only.
 *
 * The admin sees a company and a product title instead of raw ids, and a
 * person instead of a user id: every lookup goes through Query (customers,
 * products, variants) or the user module, best effort, so a failed lookup
 * leaves the id and never the page empty.
 */

import { ADMIN_PAGE_DEFAULT, ADMIN_PAGE_MAX, isStatus, MAX_SEARCH_MATCHES, STORE_PAGE_DEFAULT, STORE_PAGE_MAX, type NegotiationStatus } from "../../modules/negotiations/lib/constants"
import type { CustomerDto, StatusResponse, StoreThreadResponse, StoreThreadsResponse, ThreadDto, ThreadsResponse } from "../../modules/negotiations/lib/contract"
import { toReferenceDto, toRunDto, toStoreThreadDto, toThreadDto, type Enrichment } from "../../modules/negotiations/lib/dto"
import { expiresSoon } from "../../modules/negotiations/lib/expiry"
import { formatAmount, sumByCurrency } from "../../modules/negotiations/lib/money"
import type { DraftOrderRow, MessageRow } from "../../modules/negotiations/lib/rows"
import type { ThreadFilter } from "../../modules/negotiations/lib/store"
import { isEntityId, likePattern } from "../../modules/negotiations/lib/text"
import type { Thread } from "../../modules/negotiations/lib/thread"
import { firstParam, intParam } from "../../modules/negotiations/lib/validation"
import { demoInfo } from "./demo"
import { toWriterDto, writerStates } from "./draft-orders"
import { envOf, graph, normalize, storeDefaults, userNames, type Env, type Scope } from "./runtime"
import { customerThread } from "./threads"

/* ------------------------------------------------------------------ */
/* Enrichment                                                          */
/* ------------------------------------------------------------------ */

export async function enrich(scope: Scope, env: Env, threads: readonly Thread[], messages: readonly MessageRow[] = []): Promise<Enrichment> {
  const uniq = (xs: Array<string | null | undefined>) => [...new Set(xs.filter((x): x is string => typeof x === "string" && x.length > 0))]
  const customerIds = uniq(threads.map((t) => t.customerId))
  const productIds = uniq(threads.map((t) => t.productId))
  const variantIds = uniq(threads.map((t) => t.variantId))
  const [customers, products, variants, users, drafts] = await Promise.all([
    customerIds.length
      ? graph<{ id: string; email?: string | null; first_name?: string | null; last_name?: string | null; company_name?: string | null }>(scope, {
          entity: "customer",
          fields: ["id", "email", "first_name", "last_name", "company_name"],
          filters: { id: customerIds },
        })
      : Promise.resolve([]),
    productIds.length
      ? graph<{ id: string; title?: string | null; thumbnail?: string | null }>(scope, { entity: "product", fields: ["id", "title", "thumbnail"], filters: { id: productIds } })
      : Promise.resolve([]),
    variantIds.length
      ? graph<{ id: string; title?: string | null; sku?: string | null }>(scope, { entity: "product_variant", fields: ["id", "title", "sku"], filters: { id: variantIds } })
      : Promise.resolve([]),
    userNames(scope, [...threads.map((t) => t.assignedTo), ...messages.filter((m) => m.author_type === "admin").map((m) => m.author_id)]),
    threads.length ? env.stores.drafts.byThreads(threads.map((t) => t.id), threads[0].demo) : Promise.resolve([] as DraftOrderRow[]),
  ])
  return {
    customers: new Map<string, CustomerDto>(
      customers.map((c) => [
        c.id,
        { id: c.id, email: c.email ?? null, name: [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || null, company: c.company_name ?? null },
      ]),
    ),
    products: new Map(products.map((p) => [p.id, { id: p.id, title: p.title ?? null, thumbnail: p.thumbnail ?? null }])),
    variants: new Map(variants.map((v) => [v.id, { id: v.id, title: v.title ?? null, sku: v.sku ?? null }])),
    users,
    drafts: new Map(drafts.map((d) => [d.negotiation_id, d])),
  }
}

/** Admin DTOs of a page of rows, with each thread's last public message. */
async function adminDtos(scope: Scope, env: Env, threads: Thread[]): Promise<ThreadDto[]> {
  const last = await env.stores.threads.lastMessages(threads.map((t) => t.id))
  const byThread = new Map(last.map((m) => [m.negotiation_id, m]))
  const e = await enrich(scope, env, threads, last)
  return threads.map((t) => toThreadDto(t, e, { lastMessage: byThread.get(t.id) ?? null }))
}

/** One thread with its whole conversation, internal notes included. */
export async function adminThreadDto(scope: Scope, env: Env, thread: Thread): Promise<ThreadDto> {
  const messages = await env.stores.threads.listMessages(thread.id, true)
  const e = await enrich(scope, env, [thread], messages)
  const publicMessages = messages.filter((m) => m.internal !== true)
  return toThreadDto(thread, e, { messages, lastMessage: publicMessages[publicMessages.length - 1] ?? null })
}

/**
 * One thread with its conversation (internal notes marked `internal`), for
 * subscribers of the events: an e-mails plugin reads the message of
 * `message_id` and the customer here. Any mode; the DTO says `demo`.
 */
export async function getNegotiationThread(scope: Scope, id: string): Promise<ThreadDto | null> {
  if (!isEntityId(id)) return null
  const env = await envOf(scope)
  const row = await env.stores.threads.getThread(id)
  return row ? adminThreadDto(scope, env, normalize(env, row)) : null
}

/* ------------------------------------------------------------------ */
/* Admin lists                                                         */
/* ------------------------------------------------------------------ */

/** Customers and products the phrase finds through their own modules, for the search of the queue. */
async function searchIds(scope: Scope, q: string): Promise<{ customerIds: string[]; productIds: string[] }> {
  const [customers, products] = await Promise.all([
    graph<{ id: string }>(scope, { entity: "customer", fields: ["id"], filters: { q }, pagination: { take: MAX_SEARCH_MATCHES } }),
    graph<{ id: string }>(scope, { entity: "product", fields: ["id"], filters: { q }, pagination: { take: MAX_SEARCH_MATCHES } }),
  ])
  return { customerIds: customers.map((c) => c.id).filter(isEntityId), productIds: products.map((p) => p.id).filter(isEntityId) }
}

export type QueueFilter = "all" | "waiting" | NegotiationStatus

/**
 * GET /admin/negotiations/threads: `status` (all, waiting, or a status), `q`,
 * `customer_id`, `product_id`, `order` (recent, or oldest: the thread that
 * waits longest first), `limit`, `offset`.
 */
export async function adminList(scope: Scope, query: Record<string, unknown>): Promise<ThreadsResponse> {
  const env = await envOf(scope)
  const status = firstParam(query.status)
  const q = firstParam(query.q).slice(0, 100)
  const customerId = firstParam(query.customer_id)
  const productId = firstParam(query.product_id)
  const limit = intParam(query.limit, ADMIN_PAGE_DEFAULT, 1, ADMIN_PAGE_MAX)
  const offset = intParam(query.offset, 0, 0, 1_000_000)
  const filter: ThreadFilter = {
    demo: env.options.demo,
    statuses: isStatus(status) ? [status] : null,
    waitingForTeam: status === "waiting",
    customerId: isEntityId(customerId) ? customerId : null,
    product: isEntityId(productId) ? { id: productId, skus: [] } : null,
    search: q ? { like: likePattern(q), ...(await searchIds(scope, q)) } : null,
    oldestFirst: firstParam(query.order) === "oldest",
    limit,
    offset,
  }
  const { rows, count } = await env.stores.threads.listThreads(filter)
  return { threads: await adminDtos(scope, env, rows.map((r) => normalize(env, r))), count, limit, offset }
}

/** The product widget: threads of the product (and older ones that only carry one of its SKUs). */
export async function productThreads(scope: Scope, productId: string): Promise<ThreadsResponse & { mode: "demo" | "live" }> {
  const env = await envOf(scope)
  const variants = await graph<{ sku?: string | null }>(scope, { entity: "product_variant", fields: ["sku"], filters: { product_id: productId } })
  const skus = [...new Set(variants.map((v) => v.sku).filter((s): s is string => typeof s === "string" && s.length > 0))].slice(0, 200)
  const { rows, count } = await env.stores.threads.listThreads({ demo: env.options.demo, product: { id: productId, skus }, limit: 10, offset: 0 })
  return { threads: await adminDtos(scope, env, rows.map((r) => normalize(env, r))), count, limit: 10, offset: 0, mode: env.options.demo ? "demo" : "live" }
}

/** The customer widget: the customer's threads, newest activity first. */
export async function customerThreadsForAdmin(scope: Scope, customerId: string): Promise<ThreadsResponse & { mode: "demo" | "live" }> {
  const env = await envOf(scope)
  const { rows, count } = await env.stores.threads.listThreads({ demo: env.options.demo, customerId, limit: 10, offset: 0 })
  return { threads: await adminDtos(scope, env, rows.map((r) => normalize(env, r))), count, limit: 10, offset: 0, mode: env.options.demo ? "demo" : "live" }
}

/* ------------------------------------------------------------------ */
/* Status of the page                                                  */
/* ------------------------------------------------------------------ */

const DAY = 24 * 60 * 60 * 1000

export async function buildStatus(scope: Scope): Promise<StatusResponse> {
  const env = await envOf(scope)
  const o = env.options
  const demo = o.demo
  const [counts, active, accepted, writers, drafts, runs, info, defaults] = await Promise.all([
    env.stores.threads.statusCounts(demo),
    env.stores.threads.activeThreads(demo, 5000),
    env.stores.threads.acceptedSince(demo, new Date(env.now.getTime() - 30 * DAY)),
    writerStates(scope, env),
    env.stores.drafts.counts(demo),
    env.stores.settings.lastRuns(demo),
    demoInfo(scope),
    storeDefaults(scope),
  ])
  const by = (s: string) => counts.find((c) => c.status === s)?.count ?? 0
  const activeThreads = active.map((r) => normalize(env, r))
  const acceptedThreads = accepted.map((r) => normalize(env, r))
  const perCurrency = (threads: Thread[]) =>
    sumByCurrency(threads.map((t) => ({ currency: t.currencyCode, amount: t.value }))).map((c) => {
      const digits = threads.find((t) => t.currencyCode === c.currency)?.digits ?? 2
      return { currencyCode: c.currency, amount: c.amount, value: formatAmount(c.amount, digits) }
    })
  const lastRuns: StatusResponse["lastRuns"] = {}
  for (const r of runs) {
    const dto = toRunDto(r)
    lastRuns[dto.kind] = dto
  }
  return {
    mode: demo ? "demo" : "live",
    options: {
      expiryDays: o.expiryDays,
      defaultCurrency: o.defaultCurrency,
      storeCurrency: defaults.currency,
      taxInclusive: o.taxInclusive,
      storeApi: o.storeApi,
      customerAccept: o.customerAccept,
      maxMessageLength: o.maxMessageLength,
      maxQuantity: o.maxQuantity,
      maxActivePerCustomer: o.maxActivePerCustomer,
      openPerHour: o.openPerHour,
      messagesPerHour: o.messagesPerHour,
      draftOrders: { ...o.draftOrders },
      writersAllowed: { ...o.writers },
    },
    counts: {
      all: counts.reduce((sum, c) => sum + c.count, 0),
      open: by("open"),
      counter_offered: by("counter_offered"),
      accepted: by("accepted"),
      rejected: by("rejected"),
      expired: by("expired"),
      waiting: counts.reduce((sum, c) => sum + (c.status === "open" || c.status === "counter_offered" ? c.waiting : 0), 0),
      expiringSoon: activeThreads.filter((t) => expiresSoon({ status: t.status, expiresAt: t.expiresAt, lastActivityAt: null }, 0, env.now)).length,
      fromStore: counts.reduce((sum, c) => sum + c.from_store, 0),
      acceptedLast30Days: acceptedThreads.length,
    },
    valueInTalks: perCurrency(activeThreads),
    acceptedValue30Days: perCurrency(acceptedThreads),
    writers: { draftOrders: toWriterDto(writers.draftOrders) },
    draftOrders: {
      pending: drafts.pending ?? 0,
      creating: drafts.creating ?? 0,
      created: drafts.created ?? 0,
      failed: drafts.failed ?? 0,
      unknown: drafts.unknown ?? 0,
      blocked: drafts.blocked ?? 0,
    },
    lastRuns,
    references: o.references.map(toReferenceDto),
    demo: info,
  }
}

/* ------------------------------------------------------------------ */
/* Store API                                                           */
/* ------------------------------------------------------------------ */

function storeOptions(env: Env) {
  return { customerAccept: env.options.customerAccept, taxInclusive: env.options.taxInclusive, now: env.now }
}

/** GET /store/negotiations: the customer's threads; `status`, `product_id`, `variant_id`, `cart_id`, `limit`, `offset`. */
export async function storeList(scope: Scope, customerId: string, query: Record<string, unknown>): Promise<StoreThreadsResponse> {
  const env = await envOf(scope)
  const statuses = firstParam(query.status)
    .split(",")
    .map((s) => s.trim())
    .filter(isStatus)
  const limit = intParam(query.limit, STORE_PAGE_DEFAULT, 1, STORE_PAGE_MAX)
  const offset = intParam(query.offset, 0, 0, 1_000_000)
  const productId = firstParam(query.product_id)
  const variantId = firstParam(query.variant_id)
  const cartId = firstParam(query.cart_id)
  const narrow = isEntityId(variantId) || isEntityId(cartId)
  const base: ThreadFilter = {
    demo: env.options.demo,
    customerId,
    statuses: statuses.length > 0 ? statuses : null,
    product: isEntityId(productId) ? { id: productId, skus: [] } : null,
    excludeDemoStory: true,
    limit,
    offset,
  }
  if (!narrow) {
    const { rows, count } = await env.stores.threads.listThreads(base)
    return { negotiations: rows.map((r) => toStoreThreadDto(normalize(env, r), storeOptions(env))), count, limit, offset }
  }
  /* By variant or cart ("is there a negotiation about this?"): among the customer's latest 500. */
  const { rows } = await env.stores.threads.listThreads({ ...base, limit: 500, offset: 0 })
  const narrowed = rows.filter((r) => (!isEntityId(variantId) || r.variant_id === variantId) && (!isEntityId(cartId) || r.cart_id === cartId))
  return {
    negotiations: narrowed.slice(offset, offset + limit).map((r) => toStoreThreadDto(normalize(env, r), storeOptions(env))),
    count: narrowed.length,
    limit,
    offset,
  }
}

/** GET /store/negotiations/:id: one of the customer's threads with the conversation (no internal notes). */
export async function storeDetail(scope: Scope, customerId: string, id: string): Promise<StoreThreadResponse> {
  const env = await envOf(scope)
  const { thread } = await customerThread(env, customerId, id)
  const messages = await env.stores.threads.listMessages(thread.id, false)
  return { negotiation: toStoreThreadDto(thread, storeOptions(env), messages) }
}

/** The answer of a store move: the thread after it, with its conversation. */
export async function storeAnswer(scope: Scope, thread: Thread): Promise<StoreThreadResponse> {
  const env = await envOf(scope)
  const messages = await env.stores.threads.listMessages(thread.id, false)
  return { negotiation: toStoreThreadDto(thread, storeOptions(env), messages) }
}
