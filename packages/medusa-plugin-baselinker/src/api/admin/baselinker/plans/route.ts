import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PLAN_KINDS, type PlanFilter, type PlanKind, type PlansResponse, type RunKind } from "../../../../modules/baselinker/lib/contract"
import { toPlanItemDto, type PlanItemRow, type QuarantineRow } from "../../../../modules/baselinker/lib/dto"
import { writerState, type WriterKey } from "../../../../modules/baselinker/lib/writers"
import { quarantineRows, storedSummary } from "../../../../workflows/baselinker/plans"
import { lastRun } from "../../../../workflows/baselinker/runtime"
import { loadWriters } from "../../../../workflows/baselinker/settings"
import { baselinkerService, guarded, intParam, like, strParam, toWriterDto } from "../helpers"

const FILTERS: readonly PlanFilter[] = ["all", "changes", "create", "update", "draft", "conflict", "skip", "failed", "quarantined"]

const WRITER_OF: Record<PlanKind, WriterKey> = {
  catalog_import: "catalogImport",
  cards: "cards",
  stock_push: "stockToBaseLinker",
  prices: "prices",
}

/**
 * GET /admin/baselinker/plans?kind=catalog_import|cards|stock_push|prices&filter=&q=&limit=&offset=
 *
 * The latest plan of one writer: what it would do, item by item, field by
 * field, with the outcome of the last run and the quarantine of each item.
 * `filter`: all, changes (create, update, draft), one action, failed or
 * quarantined. Reads the database only.
 */
export const GET = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  const kindParam = strParam(req.query.kind) as PlanKind
  if (!PLAN_KINDS.includes(kindParam)) {
    res.status(400).json({ message: `kind must be one of: ${PLAN_KINDS.join(", ")}.` })
    return
  }
  const kind = kindParam
  const raw = strParam(req.query.filter) as PlanFilter
  const filter: PlanFilter = FILTERS.includes(raw) ? raw : "all"
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const q = strParam(req.query.q).slice(0, 80)

  const and: Array<Record<string, unknown>> = [{ kind, demo: svc.isDemo() }]
  if (filter === "changes") and.push({ action: ["create", "update", "draft"] })
  else if (filter === "failed" || filter === "quarantined") and.push({ status: filter })
  else if (filter !== "all") and.push({ action: filter })
  if (q) {
    const pattern = like(q)
    and.push({ $or: [{ label: { $ilike: pattern } }, { sku: { $ilike: pattern } }, { bl_product_id: { $ilike: pattern } }, { item_key: { $ilike: pattern } }] })
  }
  const [rows, count] = (await svc.listAndCountBaseLinkerPlanItems({ $and: and } as never, {
    take: limit,
    skip: offset,
    order: { created_at: "ASC", item_key: "ASC" },
  } as never)) as unknown as [PlanItemRow[], number]
  const quarantine: Map<string, QuarantineRow> = await quarantineRows(svc, kind)
  const { writers } = await loadWriters(svc)

  const body: PlansResponse = {
    kind,
    mode: svc.isDemo() ? "demo" : "live",
    items: rows.map((r) => toPlanItemDto(r, quarantine.get(r.item_key) ?? null)),
    count,
    limit,
    offset,
    summary: await storedSummary(svc, kind),
    run: await lastRun(svc, kind as RunKind),
    writer: toWriterDto(writerState(writers, WRITER_OF[kind])),
  }
  res.json(body)
})
