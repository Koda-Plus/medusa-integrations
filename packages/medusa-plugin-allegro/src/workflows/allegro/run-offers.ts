/**
 * ONE OFFER SYNC: read the offers (Allegro REST API, or sample offers in demo
 * mode), match them to product variants by signature, run the stock check and
 * store the snapshot.
 *
 * THE COMPLETE-READ RULE. An offer missing from an incomplete list looks
 * exactly like an ended one. So a complete read replaces the snapshot, while
 * an incomplete read only adds and updates: rows it did not see stay as they
 * were and keep their links. Positive evidence (the offer IS on the list and
 * Allegro says it ended) is always applied, it is not a conclusion from absence.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type AllegroModuleService from "../../modules/allegro/service"
import { activeConnecting, getConnectionRow, isConnected, pollConnecting, readAllOffers, type OffersRead } from "../../modules/allegro/lib/connection"
import { ALLEGRO_MODULE, RUNS_TO_KEEP } from "../../modules/allegro/lib/constants"
import type { AllegroRunDto } from "../../modules/allegro/lib/contract"
import { buildDemoRawOffers } from "../../modules/allegro/lib/demo"
import { sameJson, toRunDto, type OfferRow, type RunRow } from "../../modules/allegro/lib/dto"
import { matchOffers, type MatchSummary, type OfferMatch } from "../../modules/allegro/lib/matching"
import { offersFromApi, type AllegroOfferInput } from "../../modules/allegro/lib/offers"
import { isStockIssue, stockState } from "../../modules/allegro/lib/stock"
import { demoPrices, loadCatalog, type QueryLike, type StockedVariant } from "./catalog"

export type SyncTrigger = "schedule" | "manual" | "auto"

export interface SyncInput {
  trigger?: SyncTrigger
}

export interface SyncResult {
  run: AllegroRunDto | null
  skipped: null | "running" | "not_configured" | "not_connected" | "disabled"
}

/* ------------------------------------------------------------------ */
/* One run at a time per process                                       */
/* ------------------------------------------------------------------ */

const RUNNING_KEY = Symbol.for("koda.allegro.offersRunning")
type Holder = typeof globalThis & { [RUNNING_KEY]?: boolean }

export function isOffersSyncRunning(): boolean {
  return Boolean((globalThis as Holder)[RUNNING_KEY])
}

function setRunning(value: boolean): void {
  ;(globalThis as Holder)[RUNNING_KEY] = value
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

/** Midnight UTC: the demo then changes nothing within a day and still looks fresh every day. */
export function demoDay(): Date {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  return today
}

export async function demoOffersRaw(query: QueryLike, variants: StockedVariant[]): Promise<Record<string, unknown>[]> {
  const picked = [...variants].sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)).slice(0, 12)
  const prices = await demoPrices(
    query,
    picked.map((v) => v.id),
  )
  return buildDemoRawOffers(
    picked.map((v) => ({ sku: v.sku, productTitle: v.productTitle ?? v.sku, price: prices.get(v.id) ?? null, available: v.available })),
    demoDay(),
  )
}

async function demoRead(query: QueryLike, variants: StockedVariant[]): Promise<OffersRead> {
  const parsed = offersFromApi(await demoOffersRaw(query, variants))
  return { offers: parsed.offers, statuses: parsed.statuses, complete: true, totalCount: parsed.offers.length, pages: 1, reason: null }
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

function rowToInput(r: OfferRow): AllegroOfferInput {
  const d = (v: Date | string | null): string | null => (v ? new Date(v).toISOString() : null)
  return {
    allegroId: r.allegro_id,
    name: r.name,
    status: r.status,
    externalId: r.external_id,
    price: r.price ?? null,
    available: r.available ?? null,
    sold: r.sold ?? null,
    format: r.format,
    categoryId: r.category_id,
    startedAt: d(r.started_at),
    endingAt: d(r.ending_at),
    endedBy: r.ended_by,
  }
}

type OfferData = Omit<OfferRow, "id" | "updated_at">

function desiredRow(
  input: AllegroOfferInput,
  m: OfferMatch | undefined,
  stockOf: Map<string, number | null>,
  demo: boolean,
): OfferData {
  const variant = m?.variant ?? null
  const primary = m?.isPrimary ?? false
  const medusa = variant && primary ? (stockOf.get(variant.id) ?? null) : null
  const state = variant && primary ? stockState({ status: input.status, allegro: input.available, medusa }) : null
  return {
    allegro_id: input.allegroId,
    name: input.name,
    status: input.status,
    external_id: input.externalId,
    match_key: m?.key ?? null,
    variant_id: variant?.id ?? null,
    product_id: variant?.productId ?? null,
    sku: variant?.sku ?? null,
    product_title: variant?.productTitle ?? null,
    is_primary: primary,
    price: input.price,
    available: input.available,
    sold: input.sold,
    medusa_available: variant && primary ? medusa : null,
    stock_state: state,
    format: input.format,
    category_id: input.categoryId,
    started_at: input.startedAt ? new Date(input.startedAt) : null,
    ending_at: input.endingAt ? new Date(input.endingAt) : null,
    ended_by: input.endedBy,
    demo,
  }
}

const TEXT_FIELDS = [
  "name",
  "status",
  "external_id",
  "match_key",
  "variant_id",
  "product_id",
  "sku",
  "product_title",
  "stock_state",
  "format",
  "category_id",
  "ended_by",
] as const

const NUMBER_FIELDS = ["available", "sold", "medusa_available"] as const

function ms(v: Date | string | null | undefined): number | null {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

function changed(row: OfferRow, want: OfferData): boolean {
  for (const f of TEXT_FIELDS) if ((row[f] ?? null) !== (want[f] ?? null)) return true
  for (const f of NUMBER_FIELDS) if ((row[f] ?? null) !== (want[f] ?? null)) return true
  if (Boolean(row.is_primary) !== want.is_primary) return true
  if (Boolean(row.demo) !== want.demo) return true
  if (!sameJson(row.price, want.price)) return true
  if (ms(row.started_at) !== ms(want.started_at)) return true
  if (ms(row.ending_at) !== ms(want.ending_at)) return true
  return false
}

export function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

async function applyRead(
  svc: AllegroModuleService,
  read: OffersRead,
  variants: StockedVariant[],
  demo: boolean,
): Promise<{ summary: MatchSummary; created: number; updated: number; removed: number; issues: number }> {
  const stored = (await svc.listAllegroOffers({}, { take: null })) as unknown as OfferRow[]
  const sameMode = stored.filter((r) => Boolean(r.demo) === demo)
  const otherMode = stored.filter((r) => Boolean(r.demo) !== demo)
  const fresh = new Map(read.offers.map((o) => [o.allegroId, o]))
  const byId = new Map(sameMode.map((r) => [r.allegro_id, r]))

  const universe: Array<{ input: AllegroOfferInput; row: OfferRow | null }> = read.offers.map((o) => ({
    input: o,
    row: byId.get(o.allegroId) ?? null,
  }))
  /* Incomplete read: what we did not see stays exactly as it was. */
  if (!read.complete) {
    for (const r of sameMode) if (!fresh.has(r.allegro_id)) universe.push({ input: rowToInput(r), row: r })
  }

  /* Demo rows go when a real account syncs (and the other way round). */
  const removeIds = otherMode.map((r) => r.id)
  if (read.complete) for (const r of sameMode) if (!fresh.has(r.allegro_id)) removeIds.push(r.id)

  const { matches, summary } = matchOffers(
    universe.map((u) => u.input),
    variants,
  )
  const stockOf = new Map(variants.map((v) => [v.id, v.available]))

  const creates: OfferData[] = []
  const updates: Array<OfferData & { id: string }> = []
  let issues = 0
  for (const u of universe) {
    const want = desiredRow(u.input, matches.get(u.input.allegroId), stockOf, demo)
    if (isStockIssue(want.stock_state)) issues += 1
    if (!u.row) creates.push(want)
    else if (changed(u.row, want)) updates.push({ id: u.row.id, ...want })
  }

  /* Removals first: they free the unique offer ids for the creates. */
  for (const part of chunks(removeIds, 500)) await svc.deleteAllegroOffers(part)
  for (const part of chunks(creates, 200)) await svc.createAllegroOffers(part as never)
  for (const part of chunks(updates, 200)) await svc.updateAllegroOffers(part as never)

  return { summary, created: creates.length, updated: updates.length, removed: removeIds.length, issues }
}

export async function pruneRuns(svc: AllegroModuleService, kind: string): Promise<void> {
  const old = (await svc.listAllegroSyncRuns({ kind } as never, {
    order: { started_at: "DESC" },
    skip: RUNS_TO_KEEP,
    take: 500,
    select: ["id"],
  })) as unknown as Array<{ id: string }>
  if (old.length > 0) await svc.deleteAllegroSyncRuns(old.map((r) => r.id))
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function runAllegroOffersSync(container: MedusaContainer, input: SyncInput = {}): Promise<SyncResult> {
  if (isOffersSyncRunning()) return { run: null, skipped: "running" }
  setRunning(true)
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  const o = svc.getOptions()
  const trigger: SyncTrigger = input.trigger ?? "manual"
  const source = o.demo ? "demo" : "api"
  const startedAt = new Date()
  try {
    if (!o.demo) {
      if (!svc.isConfigured()) return { run: null, skipped: "not_configured" }
      /* The safety net of the device login: a seller who approved while
       * nobody had the admin open still gets connected within the hour. */
      if (activeConnecting(svc, await getConnectionRow(svc))) await pollConnecting(svc).catch(() => undefined)
      if (!(await isConnected(svc))) return { run: null, skipped: "not_connected" }
    }
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
    const variants = await loadCatalog(query, o.stockLocationIds)
    const read = o.demo ? await demoRead(query, variants) : await readAllOffers(svc)
    const applied = await applyRead(svc, read, variants, o.demo)
    const status = read.complete ? "ok" : read.pages === 0 ? "error" : "partial"
    const finishedAt = new Date()
    const created = (await svc.createAllegroSyncRuns({
      kind: "offers",
      source,
      trigger,
      status,
      complete: read.complete,
      pages: read.pages,
      items: read.offers.length,
      statuses: read.statuses,
      linked: applied.summary.linked,
      linked_live: applied.summary.linkedLive,
      unmatched_live: applied.summary.unmatchedLive,
      issues: applied.issues,
      created_count: applied.created,
      updated_count: applied.updated,
      removed_count: applied.removed,
      message: read.complete ? null : read.reason,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      started_at: startedAt,
      finished_at: finishedAt,
    } as never)) as unknown as RunRow
    await pruneRuns(svc, "offers")
    svc
      .getLogger()
      .info(
        `[allegro] offers ${source}/${trigger} ${status}: offers=${read.offers.length} pages=${read.pages} ` +
          `linked=${applied.summary.linked} linked_live=${applied.summary.linkedLive} ` +
          `unmatched_live=${applied.summary.unmatchedLive} stock_issues=${applied.issues} created=${applied.created} ` +
          `updated=${applied.updated} removed=${applied.removed}` +
          (read.complete ? "" : ` incomplete: ${read.reason ?? "unknown reason"}`),
      )
    return { run: toRunDto(created), skipped: null }
  } catch (err) {
    /* An Allegro failure is not a store failure: record it and move on. */
    const message = svc.mask(err instanceof Error ? err.message : String(err))
    svc.getLogger().error(`[allegro] offers ${source}/${trigger} failed: ${message}`)
    const finishedAt = new Date()
    const failed = (await svc
      .createAllegroSyncRuns({
        kind: "offers",
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
