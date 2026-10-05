import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CatalogChangeDto, CatalogChangeStatus, ProductsResponse, QuarantineDto } from "../../../../modules/subiekt/lib/contract"
import { iso, toRunDto, type RunRow } from "../../../../modules/subiekt/lib/dto"
import type { CatalogRow } from "../../../../workflows/subiekt/catalog"
import { intParam, strParam, subiektService } from "../helpers"

const STATUSES: CatalogChangeStatus[] = ["planned", "applied", "simulated", "over_cap", "failed", "quarantined", "stale", "skipped"]

function toDto(r: CatalogRow): CatalogChangeDto {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status as CatalogChangeStatus,
    symbol: r.symbol,
    sku: r.sku,
    ean: r.ean,
    title: r.title,
    variantId: r.variant_id,
    productId: r.product_id,
    currency: r.currency,
    from: r.from_minor === null ? null : r.from_minor / 100,
    to: r.to_minor === null ? null : r.to_minor / 100,
    level: r.level,
    matchedBy: r.matched_by,
    attempts: r.attempts ?? 0,
    lastError: r.last_error,
    appliedAt: iso(r.applied_at),
  }
}

/**
 * GET /admin/subiekt/products?kind=price|create&status=&q=&limit=&offset=
 *
 * The current catalog plan from Subiekt: price changes and products to create,
 * with what happened to each, the counters per status, the last products run
 * and the quarantined items. Reads the database only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  const demo = svc.isDemo()
  const kind = strParam(req.query.kind)
  const status = strParam(req.query.status)
  const q = strParam(req.query.q)
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 100_000)

  const where: Record<string, unknown> = { demo }
  if (kind === "price" || kind === "create") where.kind = kind
  if ((STATUSES as string[]).includes(status)) where.status = status
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`
    where.$or = [{ symbol: { $ilike: like } }, { sku: { $ilike: like } }, { title: { $ilike: like } }, { ean: { $ilike: like } }]
  }

  const [rows, count] = await svc.listAndCountSubiektCatalogChanges(where as never, {
    take: limit,
    skip: offset,
    order: { kind: "DESC", symbol: "ASC" },
  } as never)

  const summary = Object.fromEntries(STATUSES.map((s) => [s, 0])) as ProductsResponse["summary"]
  summary.total = 0
  const all = (await svc.listSubiektCatalogChanges({ demo, ...(where.kind ? { kind: where.kind } : {}) } as never, { take: null, select: ["id", "status"] } as never)) as unknown as Array<{ status: CatalogChangeStatus }>
  for (const r of all) {
    summary[r.status] = (summary[r.status] ?? 0) + 1
    summary.total += 1
  }

  const runs = (await svc.listSubiektSyncRuns({ kind: "products", demo } as never, { take: 1, order: { started_at: "DESC" } } as never)) as unknown as RunRow[]
  const quarantined = (await svc.listSubiektCatalogQuarantines({ demo, quarantined: true } as never, { take: 50, order: { updated_at: "DESC" } } as never)) as unknown as Array<{
    id: string
    kind: "price" | "create"
    item_key: string
    failures: number
    last_error: string | null
    updated_at?: Date | string | null
  }>

  const body: ProductsResponse = {
    changes: (rows as unknown as CatalogRow[]).map(toDto),
    count,
    offset,
    limit,
    summary,
    run: runs[0] ? toRunDto(runs[0]) : null,
    quarantined: quarantined.map(
      (x): QuarantineDto => ({ id: x.id, kind: x.kind, key: x.item_key, failures: x.failures, lastError: x.last_error, updatedAt: iso(x.updated_at) }),
    ),
  }
  res.json(body)
}
