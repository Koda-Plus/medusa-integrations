/**
 * Shared plumbing of the Subiekt flows: the module service, the bridge (real
 * or demo), the connection row, run records and one-at-a-time guards.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type SubiektModuleService from "../../modules/subiekt/service"
import { HttpBridgeClient, type BridgeApi } from "../../modules/subiekt/lib/bridge-client"
import { CONNECTION_ID, CONTRACT_VERSION, DEMO_CONNECTION_ID, PLUGIN_VERSION, RUNS_TO_KEEP, SUBIEKT_MODULE } from "../../modules/subiekt/lib/constants"
import type { BridgeHealth, RunKind, RunStatus, RunTrigger } from "../../modules/subiekt/lib/contract"
import { capabilitiesOf } from "../../modules/subiekt/lib/capabilities"
import { toNumber } from "../../modules/subiekt/lib/numbers"
import { DemoBridge, type DemoCatalogItem, type DemoStore } from "../../modules/subiekt/lib/demo"
import type { ConnectionRow, DocumentRow, RunRow } from "../../modules/subiekt/lib/dto"

export type Scope = { resolve<T = unknown>(key: string): T } | MedusaContainer

export function subiektService(scope: Scope): SubiektModuleService {
  return (scope as MedusaContainer).resolve<SubiektModuleService>(SUBIEKT_MODULE)
}

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export function queryOf(scope: Scope): QueryLike {
  return (scope as MedusaContainer).resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
}

/* ------------------------------------------------------------------ */
/* The bridge                                                          */
/* ------------------------------------------------------------------ */

/** Demo documents of the current database, for the simulated bridge. */
function demoStore(svc: SubiektModuleService): DemoStore {
  return {
    async listDemoDocuments(orderId?: string) {
      const rows = (await svc.listSubiektDocuments(
        orderId ? ({ demo: true, order_id: orderId } as never) : ({ demo: true } as never),
        { take: orderId ? null : 1000, order: { created_at: orderId ? "ASC" : "DESC" } } as never,
      )) as unknown as DocumentRow[]
      return orderId ? rows : rows.reverse()
    },
    async countDemoDocuments(kind: string) {
      const [, count] = await svc.listAndCountSubiektDocuments({ demo: true, kind } as never, { take: 1, select: ["id"] } as never)
      return count
    },
  }
}

interface DemoVariantRecord {
  sku?: string | null
  barcode?: string | null
  ean?: string | null
  title?: string | null
  weight?: unknown
  product?: { title?: string | null } | null
  prices?: Array<{ amount?: unknown; currency_code?: string | null; price_list_id?: string | null; rules_count?: unknown }> | null
}

/**
 * Every variant with a SKU, for the demo bridge: stock, products and prices
 * are computed from the store's own catalog. Prices are whole relations
 * (`prices.*`): amounts are BigNumbers and single columns come back empty.
 */
async function demoCatalog(scope: Scope): Promise<DemoCatalogItem[]> {
  const query = queryOf(scope)
  const currency = subiektService(scope).getOptions().priceCurrency
  const out: DemoCatalogItem[] = []
  const take = 500
  for (let skip = 0; skip < 5000; skip += take) {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "sku", "barcode", "ean", "title", "weight", "product.title", "prices.*"],
      pagination: { skip, take, order: { id: "ASC" } },
    })
    for (const raw of data as DemoVariantRecord[]) {
      if (!raw.sku) continue
      const base = (raw.prices ?? []).find((p) => (p.currency_code ?? "").toLowerCase() === currency && !p.price_list_id && !toNumber(p.rules_count))
      const weight = toNumber(raw.weight)
      out.push({
        sku: raw.sku,
        ean: raw.ean ?? raw.barcode ?? null,
        title: [raw.product?.title, raw.title].filter(Boolean).join(" ") || null,
        price: base ? toNumber(base.amount) : null,
        weight: weight > 0 ? weight : null,
      })
    }
    if (data.length < take) break
  }
  return out
}

/** The bridge for this store: simulated in demo mode, signed HTTP otherwise. */
export function bridgeFor(scope: Scope): BridgeApi {
  const svc = subiektService(scope)
  const o = svc.getOptions()
  if (o.demo) return new DemoBridge(demoStore(svc), () => demoCatalog(scope))
  return new HttpBridgeClient({
    baseUrl: o.bridgeUrl,
    secret: o.secret,
    cfAccessClientId: o.cfAccessClientId,
    cfAccessClientSecret: o.cfAccessClientSecret,
    timeoutMs: o.timeoutMs,
    contractVersion: CONTRACT_VERSION,
    userAgent: `koda-medusa-subiekt-nexo/${PLUGIN_VERSION}`,
  })
}

/* ------------------------------------------------------------------ */
/* Connection row                                                      */
/* ------------------------------------------------------------------ */

function connectionId(svc: SubiektModuleService): string {
  return svc.isDemo() ? DEMO_CONNECTION_ID : CONNECTION_ID
}

export async function getConnection(svc: SubiektModuleService): Promise<ConnectionRow> {
  const id = connectionId(svc)
  const rows = (await svc.listSubiektConnections({ id } as never, { take: 1 } as never)) as unknown as ConnectionRow[]
  if (rows[0]) return rows[0]
  try {
    return (await svc.createSubiektConnections({ id } as never)) as unknown as ConnectionRow
  } catch {
    // Two processes created it at the same time: read the winner.
    const again = (await svc.listSubiektConnections({ id } as never, { take: 1 } as never)) as unknown as ConnectionRow[]
    return again[0]
  }
}

/** What the bridge can do, from the last stored health answer (1.0 set when it reports none). */
export async function storedCapabilities(svc: SubiektModuleService): Promise<string[]> {
  const conn = await getConnection(svc)
  return capabilitiesOf((conn.health as unknown as BridgeHealth | null) ?? null)
}

export async function saveConnection(svc: SubiektModuleService, patch: Partial<Omit<ConnectionRow, "id">>): Promise<void> {
  await getConnection(svc)
  await svc.updateSubiektConnections({ id: connectionId(svc), ...patch } as never)
}

/** Records a successful contact with the bridge. */
export async function markReachable(svc: SubiektModuleService, extra: Partial<Omit<ConnectionRow, "id">> = {}): Promise<void> {
  await saveConnection(svc, { reachable: true, consecutive_failures: 0, ...extra })
}

/** Records a failed contact with the bridge. */
export async function markUnreachable(svc: SubiektModuleService, message: string): Promise<void> {
  const row = await getConnection(svc)
  await saveConnection(svc, {
    reachable: false,
    last_error: svc.mask(message).slice(0, 1000),
    last_error_at: new Date(),
    consecutive_failures: (row.consecutive_failures ?? 0) + 1,
  })
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

export interface RunRecord {
  kind: RunKind
  trigger: RunTrigger
  status: RunStatus
  startedAt: Date
  message?: string | null
  stats?: Record<string, unknown> | null
  dryRun?: boolean
}

export async function recordRun(svc: SubiektModuleService, r: RunRecord): Promise<RunRow> {
  const finishedAt = new Date()
  const row = (await svc.createSubiektSyncRuns({
    kind: r.kind,
    trigger: r.trigger,
    status: r.status,
    dry_run: Boolean(r.dryRun),
    message: r.message ? svc.mask(r.message).slice(0, 2000) : null,
    stats: r.stats ?? null,
    started_at: r.startedAt,
    finished_at: finishedAt,
    duration_ms: finishedAt.getTime() - r.startedAt.getTime(),
    demo: svc.isDemo(),
  } as never)) as unknown as RunRow

  const old = (await svc.listSubiektSyncRuns({ kind: r.kind, demo: svc.isDemo() } as never, {
    skip: RUNS_TO_KEEP,
    take: 200,
    select: ["id"],
    order: { started_at: "DESC" },
  } as never)) as unknown as Array<{ id: string }>
  if (old.length > 0) await svc.deleteSubiektSyncRuns(old.map((o) => o.id))
  return row
}

/* ------------------------------------------------------------------ */
/* One run of each kind at a time per process                          */
/* ------------------------------------------------------------------ */

const RUNNING_KEY = Symbol.for("koda.subiekt.running")
type Holder = typeof globalThis & { [RUNNING_KEY]?: Set<string> }

function runningSet(): Set<string> {
  const holder = globalThis as Holder
  if (!holder[RUNNING_KEY]) holder[RUNNING_KEY] = new Set<string>()
  return holder[RUNNING_KEY]!
}

export function runningKinds(): RunKind[] {
  return [...runningSet()] as RunKind[]
}

export function isRunning(kind: RunKind): boolean {
  return runningSet().has(kind)
}

/** Runs `fn` unless the same kind already runs in this process; then returns `null`. */
export async function exclusive<T>(kind: RunKind, fn: () => Promise<T>): Promise<T | null> {
  const set = runningSet()
  if (set.has(kind)) return null
  set.add(kind)
  try {
    return await fn()
  } finally {
    set.delete(kind)
  }
}
