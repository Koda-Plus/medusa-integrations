/**
 * ONE SYNC RUN: read the adverts (OLX Partner API, or sample adverts in demo
 * mode), match them to product variants by SKU and store the snapshot.
 *
 * THE COMPLETE-READ RULE. An advert missing from an incomplete list looks
 * exactly like an ended one. So a complete read replaces the snapshot, while
 * an incomplete read only adds and updates: rows it did not see stay as they
 * were and keep their links. Positive evidence (the advert IS on the list and
 * OLX says it ended) is always applied, it is not a conclusion from absence.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type OlxModuleService from "../../modules/olx/service"
import { advertsFromPartnerApi, compilePatterns, type OlxAdvertInput } from "../../modules/olx/lib/adverts"
import { isConnected, readAllAdverts, type AdvertsRead } from "../../modules/olx/lib/connection"
import { OLX_MODULE, RUNS_TO_KEEP, olxUrls } from "../../modules/olx/lib/constants"
import type { OlxRunDto } from "../../modules/olx/lib/contract"
import { buildDemoRawAdverts, type DemoVariant } from "../../modules/olx/lib/demo"
import { toRunDto, type AdvertRow, type RunRow } from "../../modules/olx/lib/dto"
import { matchAdverts, type AdvertMatch, type CatalogVariant, type MatchSummary } from "../../modules/olx/lib/matching"
import type { ResolvedOlxOptions } from "../../modules/olx/lib/options"

export type SyncTrigger = "schedule" | "manual" | "auto"

export interface SyncInput {
  trigger?: SyncTrigger
}

export interface SyncResult {
  run: OlxRunDto | null
  skipped: null | "running" | "not_configured" | "not_connected"
}

/* ------------------------------------------------------------------ */
/* One run at a time per process                                       */
/* ------------------------------------------------------------------ */

const RUNNING_KEY = Symbol.for("koda.olx.syncRunning")

type Holder = typeof globalThis & { [RUNNING_KEY]?: boolean }

export function isSyncRunning(): boolean {
  return Boolean((globalThis as Holder)[RUNNING_KEY])
}

function setRunning(value: boolean): void {
  ;(globalThis as Holder)[RUNNING_KEY] = value
}

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

interface VariantRecord {
  id: string
  sku?: string | null
  product_id?: string | null
  product?: { title?: string | null } | null
  prices?: Array<{ amount?: number | string | null; currency_code?: string | null }> | null
}

/** Every variant with a SKU, 1 000 per query. */
async function loadCatalog(query: QueryLike): Promise<CatalogVariant[]> {
  const out: CatalogVariant[] = []
  const take = 1000
  for (let skip = 0; skip < 500_000; skip += take) {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "sku", "product_id", "product.title"],
      pagination: { skip, take, order: { id: "ASC" } },
    })
    for (const raw of data as VariantRecord[]) {
      const sku = String(raw.sku ?? "").trim()
      if (!sku || !raw.product_id) continue
      out.push({ id: raw.id, sku, productId: raw.product_id, productTitle: raw.product?.title ?? null })
    }
    if (data.length < take) break
  }
  return out
}

const MARKET_CURRENCY: Record<string, string> = {
  pl: "pln",
  ro: "ron",
  pt: "eur",
  bg: "eur",
  ua: "uah",
  kz: "kzt",
  uz: "uzs",
}

/** Prices of the few variants used by the demo. Optional: no prices, no problem. */
async function demoPrices(query: QueryLike, ids: string[], market: string): Promise<Map<string, DemoVariant["price"]>> {
  const out = new Map<string, DemoVariant["price"]>()
  if (ids.length === 0) return out
  try {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "prices.amount", "prices.currency_code"],
      filters: { id: ids },
    })
    const wanted = MARKET_CURRENCY[market] ?? "eur"
    for (const raw of data as VariantRecord[]) {
      const prices = (raw.prices ?? []).filter((p) => p && p.amount != null && p.currency_code)
      const pick = prices.find((p) => String(p.currency_code).toLowerCase() === wanted) ?? prices[0]
      if (!pick) continue
      const value = Number(pick.amount)
      if (Number.isFinite(value)) out.set(raw.id, { value, currency: String(pick.currency_code).toUpperCase() })
    }
  } catch {
    /* Prices are decoration in demo mode. */
  }
  return out
}

async function demoRead(query: QueryLike, variants: CatalogVariant[], o: ResolvedOlxOptions): Promise<AdvertsRead> {
  const picked = [...variants].sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)).slice(0, 10)
  const prices = await demoPrices(
    query,
    picked.map((v) => v.id),
    o.market,
  )
  /* Dates anchored to the start of the UTC day: the hourly run then changes
   * nothing, and the sample adverts still look fresh every day. */
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const raw = buildDemoRawAdverts(
    picked.map((v) => ({ sku: v.sku, productTitle: v.productTitle ?? v.sku, price: prices.get(v.id) ?? null })),
    { market: o.market, host: olxUrls(o.market).host, now: today },
  )
  const parsed = advertsFromPartnerApi(raw, compilePatterns(o.skuPatterns))
  return { adverts: parsed.adverts, statuses: parsed.statuses, complete: true, pages: 1, reason: null }
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

function rowToInput(r: AdvertRow): OlxAdvertInput {
  const d = (v: Date | string | null): string | null => (v ? new Date(v).toISOString() : null)
  return {
    olxId: r.olx_id,
    url: r.url,
    title: r.title,
    status: r.status,
    externalId: r.external_id,
    descriptionSku: r.description_sku,
    price: r.price ?? null,
    validTo: d(r.valid_to),
    createdAt: d(r.olx_created_at),
  }
}

type AdvertData = Omit<AdvertRow, "id" | "updated_at">

function desiredRow(input: OlxAdvertInput, m: AdvertMatch | undefined, demo: boolean): AdvertData {
  return {
    olx_id: input.olxId,
    title: input.title,
    url: input.url,
    status: input.status,
    external_id: input.externalId,
    description_sku: input.descriptionSku,
    match_key: m?.key ?? null,
    match_source: m?.source ?? null,
    variant_id: m?.variant?.id ?? null,
    product_id: m?.variant?.productId ?? null,
    sku: m?.variant?.sku ?? null,
    product_title: m?.variant?.productTitle ?? null,
    is_primary: m?.isPrimary ?? false,
    price: input.price,
    valid_to: input.validTo ? new Date(input.validTo) : null,
    olx_created_at: input.createdAt ? new Date(input.createdAt) : null,
    demo,
  }
}

const TEXT_FIELDS = [
  "title",
  "url",
  "status",
  "external_id",
  "description_sku",
  "match_key",
  "match_source",
  "variant_id",
  "product_id",
  "sku",
  "product_title",
] as const

function ms(v: Date | string | null | undefined): number | null {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

function changed(row: AdvertRow, want: AdvertData): boolean {
  for (const f of TEXT_FIELDS) if ((row[f] ?? null) !== (want[f] ?? null)) return true
  if (Boolean(row.is_primary) !== want.is_primary) return true
  if (Boolean(row.demo) !== want.demo) return true
  if (JSON.stringify(row.price ?? null) !== JSON.stringify(want.price ?? null)) return true
  if (ms(row.valid_to) !== ms(want.valid_to)) return true
  if (ms(row.olx_created_at) !== ms(want.olx_created_at)) return true
  return false
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

async function applyRead(
  svc: OlxModuleService,
  read: AdvertsRead,
  variants: CatalogVariant[],
  demo: boolean,
): Promise<{ summary: MatchSummary; created: number; updated: number; removed: number }> {
  const stored = (await svc.listOlxAdverts({}, { take: null })) as unknown as AdvertRow[]
  const sameMode = stored.filter((r) => Boolean(r.demo) === demo)
  const otherMode = stored.filter((r) => Boolean(r.demo) !== demo)
  const fresh = new Map(read.adverts.map((a) => [a.olxId, a]))
  const byOlxId = new Map(sameMode.map((r) => [r.olx_id, r]))

  const universe: Array<{ input: OlxAdvertInput; row: AdvertRow | null }> = read.adverts.map((a) => ({
    input: a,
    row: byOlxId.get(a.olxId) ?? null,
  }))
  /* Incomplete read: what we did not see stays exactly as it was. */
  if (!read.complete) {
    for (const r of sameMode) if (!fresh.has(r.olx_id)) universe.push({ input: rowToInput(r), row: r })
  }

  /* Demo rows go when a real account syncs (and the other way round). */
  const removeIds = otherMode.map((r) => r.id)
  if (read.complete) for (const r of sameMode) if (!fresh.has(r.olx_id)) removeIds.push(r.id)

  const { matches, summary } = matchAdverts(
    universe.map((u) => u.input),
    variants,
  )

  const creates: AdvertData[] = []
  const updates: Array<AdvertData & { id: string }> = []
  for (const u of universe) {
    const want = desiredRow(u.input, matches.get(u.input.olxId), demo)
    if (!u.row) creates.push(want)
    else if (changed(u.row, want)) updates.push({ id: u.row.id, ...want })
  }

  /* Removals first: they free the unique advert ids for the creates. */
  for (const part of chunks(removeIds, 500)) await svc.deleteOlxAdverts(part)
  for (const part of chunks(creates, 200)) await svc.createOlxAdverts(part as never)
  for (const part of chunks(updates, 200)) await svc.updateOlxAdverts(part as never)

  return { summary, created: creates.length, updated: updates.length, removed: removeIds.length }
}

async function pruneRuns(svc: OlxModuleService): Promise<void> {
  const old = (await svc.listOlxSyncRuns({}, {
    order: { started_at: "DESC" },
    skip: RUNS_TO_KEEP,
    take: 500,
    select: ["id"],
  })) as unknown as Array<{ id: string }>
  if (old.length > 0) await svc.deleteOlxSyncRuns(old.map((r) => r.id))
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function runOlxSync(container: MedusaContainer, input: SyncInput = {}): Promise<SyncResult> {
  if (isSyncRunning()) return { run: null, skipped: "running" }
  setRunning(true)
  const svc = container.resolve<OlxModuleService>(OLX_MODULE)
  const o = svc.getOptions()
  const trigger: SyncTrigger = input.trigger ?? "manual"
  const source = o.demo ? "demo" : "api"
  const startedAt = new Date()
  try {
    if (!o.demo) {
      if (!svc.isConfigured()) return { run: null, skipped: "not_configured" }
      if (!(await isConnected(svc))) return { run: null, skipped: "not_connected" }
    }
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
    const variants = await loadCatalog(query)
    const read = o.demo ? await demoRead(query, variants, o) : await readAllAdverts(svc)
    const applied = await applyRead(svc, read, variants, o.demo)
    const status = read.complete ? "ok" : read.pages === 0 ? "error" : "partial"
    const finishedAt = new Date()
    const created = (await svc.createOlxSyncRuns({
      source,
      trigger,
      status,
      complete: read.complete,
      pages: read.pages,
      adverts: read.adverts.length,
      statuses: read.statuses,
      linked: applied.summary.linked,
      linked_live: applied.summary.linkedLive,
      unmatched_live: applied.summary.unmatchedLive,
      created_count: applied.created,
      updated_count: applied.updated,
      removed_count: applied.removed,
      message: read.complete ? null : read.reason,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      started_at: startedAt,
      finished_at: finishedAt,
    } as never)) as unknown as RunRow
    await pruneRuns(svc)
    svc
      .getLogger()
      .info(
        `[olx] sync ${source}/${trigger} ${status}: adverts=${read.adverts.length} pages=${read.pages} ` +
          `linked=${applied.summary.linked} linked_live=${applied.summary.linkedLive} ` +
          `unmatched_live=${applied.summary.unmatchedLive} created=${applied.created} ` +
          `updated=${applied.updated} removed=${applied.removed}` +
          (read.complete ? "" : ` incomplete: ${read.reason ?? "unknown reason"}`),
      )
    return { run: toRunDto(created), skipped: null }
  } catch (err) {
    /* An OLX failure is not a store failure: record it and move on. */
    const message = svc.mask(err instanceof Error ? err.message : String(err))
    svc.getLogger().error(`[olx] sync ${source}/${trigger} failed: ${message}`)
    const finishedAt = new Date()
    const failed = (await svc
      .createOlxSyncRuns({
        source,
        trigger,
        status: "error",
        complete: false,
        message,
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        started_at: startedAt,
        finished_at: finishedAt,
      } as never)
      .catch(() => null)) as unknown as RunRow | null
    return { run: failed ? toRunDto(failed) : null, skipped: null }
  } finally {
    setRunning(false)
  }
}
