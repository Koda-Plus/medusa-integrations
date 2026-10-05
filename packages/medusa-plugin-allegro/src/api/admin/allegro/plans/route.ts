import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AllegroPlanKind, AllegroPlanResponse, AllegroPlanRunResponse } from "../../../../modules/allegro/lib/contract"
import { toPlanItemDto, type PlanItemRow } from "../../../../modules/allegro/lib/dto"
import { planSummary } from "../../../../workflows/allegro/plans"
import { isRunning } from "../../../../workflows/allegro/runtime"
import { publishAllegroOffersWorkflow, pushAllegroPricesWorkflow, pushAllegroStockWorkflow } from "../../../../workflows/allegro/writer-workflows"
import { isArmed } from "../../../../workflows/allegro/writers"
import { allegroService, errorOf, intParam, like, strParam } from "../helpers"

const KINDS: readonly AllegroPlanKind[] = ["stock", "prices", "publish"]
const FILTERS = ["all", "changes", "planned", "deferred", "quarantined", "skipped", "in_sync", "applied", "failed"] as const

function kindOf(value: unknown): AllegroPlanKind | null {
  const k = strParam(value) as AllegroPlanKind
  return KINDS.includes(k) ? k : null
}

/**
 * GET /admin/allegro/plans?kind=stock|prices|publish&filter=&q=&limit=&offset=
 *
 * The plan of a writer, line by line: what would change, from what to what,
 * and why. `filter=changes` (default) shows what the writer would do or did.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const kind = kindOf(req.query.kind)
  if (!kind) {
    res.status(400).json({ message: "kind must be stock, prices or publish." })
    return
  }
  const rawFilter = strParam(req.query.filter)
  const filter = (FILTERS as readonly string[]).includes(rawFilter) ? rawFilter : "changes"
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const q = strParam(req.query.q).slice(0, 80)
  const where: Record<string, unknown> = { kind, demo: svc.isDemo() }
  if (filter === "changes") where.status = ["planned", "deferred", "quarantined", "applied", "failed", "unknown"]
  else if (filter !== "all") where.status = filter
  if (q) {
    const pattern = like(q)
    where.$or = [{ title: { $ilike: pattern } }, { sku: { $ilike: pattern } }, { allegro_id: { $ilike: pattern } }]
  }
  const [rows, count] = (await svc.listAndCountAllegroPlanItems(where as never, {
    take: limit,
    skip: offset,
    order: { status: "ASC", sku: "ASC" },
  })) as unknown as [PlanItemRow[], number]
  const env = svc.getOptions().environment
  const body: AllegroPlanResponse = { kind, summary: await planSummary(svc, kind), items: rows.map((r) => toPlanItemDto(r, env)), count, limit, offset }
  res.json(body)
}

/**
 * POST /admin/allegro/plans  { kind, mode: "plan" | "apply" }
 *
 * `plan`: a dry run now, answered when it is done. `apply`: plan and apply in
 * the background (202); the run itself refuses to write when the writer is
 * not armed.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const body = (req.body ?? {}) as { kind?: unknown; mode?: unknown }
  const kind = kindOf(body.kind)
  if (!kind) {
    res.status(400).json({ message: "kind must be stock, prices or publish." })
    return
  }
  const mode = body.mode === "apply" ? "apply" : "plan"
  if (isRunning(kind)) {
    const busy: AllegroPlanRunResponse = { kind, dryRun: mode === "plan", summary: await planSummary(svc, kind), applied: 0, failed: 0, message: "A run is already going." }
    res.status(202).json(busy)
    return
  }
  const workflow = kind === "stock" ? pushAllegroStockWorkflow : kind === "prices" ? pushAllegroPricesWorkflow : publishAllegroOffersWorkflow
  if (mode === "apply") {
    if (!(await isArmed(svc, kind))) {
      res.status(409).json({ message: `The ${kind} writer is not armed. Allow it in the options (writes.${kind}) and arm it in the Writers section.` })
      return
    }
    void workflow(req.scope)
      .run({ input: { trigger: "manual", mode: "apply" } })
      .catch((err: unknown) => svc.getLogger().error(`[allegro] ${kind} apply: ${errorOf(svc, err)}`))
    const started: AllegroPlanRunResponse = { kind, dryRun: false, summary: await planSummary(svc, kind), applied: 0, failed: 0, message: null }
    res.status(202).json(started)
    return
  }
  try {
    const { result } = await workflow(req.scope).run({ input: { trigger: "manual", mode: "plan" } })
    const answer: AllegroPlanRunResponse = {
      kind,
      dryRun: true,
      summary: result.summary ?? (await planSummary(svc, kind)),
      applied: 0,
      failed: 0,
      message: result.skipped ? `Skipped: ${result.skipped}.` : result.message,
    }
    res.json(answer)
  } catch (err) {
    res.status(500).json({ message: errorOf(svc, err) })
  }
}
