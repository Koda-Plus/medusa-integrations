import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AllegroImportFilter, AllegroImportRunResponse, AllegroImportsResponse } from "../../../../modules/allegro/lib/contract"
import { toImportDto, type ImportRow } from "../../../../modules/allegro/lib/dto"
import { isRunning } from "../../../../workflows/allegro/runtime"
import { importAllegroOrdersWorkflow } from "../../../../workflows/allegro/writer-workflows"
import { isArmed } from "../../../../workflows/allegro/writers"
import { allegroService, errorOf, intParam, like, sendError, strParam } from "../helpers"

const FILTERS: readonly AllegroImportFilter[] = ["all", "imported", "held", "pending", "skipped", "attention", "cancelled"]

/**
 * GET /admin/allegro/imports?filter=&q=&limit=&offset=
 *
 * Allegro checkout forms on their way into Medusa: imported (with the Medusa
 * order), held (with the reason), waiting, skipped, cancelled. No buyer data.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const rawFilter = strParam(req.query.filter) as AllegroImportFilter
  const filter: AllegroImportFilter = FILTERS.includes(rawFilter) ? rawFilter : "all"
  const limit = intParam(req.query.limit, 10, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const q = strParam(req.query.q).slice(0, 80)
  const where: Record<string, unknown> = { demo: svc.isDemo() }
  if (filter === "pending") where.status = ["pending", "unknown", "importing"]
  else if (filter === "attention") where.$or = [{ attention: { $ne: null } }, { total_mismatch: true }]
  else if (filter !== "all") where.status = filter
  if (q) {
    const search = [{ checkout_form_id: { $ilike: like(q) } }, { reason: { $ilike: like(q) } }]
    if (where.$or) {
      where.$and = [{ $or: where.$or }, { $or: search }]
      delete where.$or
    } else where.$or = search
  }
  const [rows, count] = (await svc.listAndCountAllegroOrderImports(where as never, {
    take: limit,
    skip: offset,
    /* Newest purchase first; rows still waiting for their form (no date yet) on top. */
    order: { bought_at: "DESC", created_at: "DESC" },
  })) as unknown as [ImportRow[], number]
  const body: AllegroImportsResponse = { imports: rows.map(toImportDto), count, limit, offset }
  res.json(body)
}

/**
 * POST /admin/allegro/imports  { mode: "plan" | "apply" }
 *
 * `plan`: a dry run, what the next run would do with the waiting forms
 * (nothing claimed, nothing created). `apply`: drain and import now, in the
 * background (202); only while the orders writer is armed.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const body = (req.body ?? {}) as { mode?: unknown }
  const mode = body.mode === "apply" ? "apply" : "plan"
  if (isRunning("import")) {
    const busy: AllegroImportRunResponse = { started: false, alreadyRunning: true, dryRun: mode === "plan", preview: [], message: null }
    res.status(202).json(busy)
    return
  }
  if (mode === "apply") {
    if (!(await isArmed(svc, "orders"))) {
      res.status(409).json({ message: "The orders writer is not armed. Allow it in the options (writes.orders) and arm it in the Writers section." })
      return
    }
    void importAllegroOrdersWorkflow(req.scope)
      .run({ input: { trigger: "manual", mode: "apply" } })
      .catch((err: unknown) => svc.getLogger().error(`[allegro] import: ${errorOf(svc, err)}`))
    const started: AllegroImportRunResponse = { started: true, alreadyRunning: false, dryRun: false, preview: [], message: null }
    res.status(202).json(started)
    return
  }
  try {
    const { result } = await importAllegroOrdersWorkflow(req.scope).run({ input: { trigger: "manual", mode: "plan" } })
    const answer: AllegroImportRunResponse = { started: true, alreadyRunning: false, dryRun: true, preview: result.preview, message: result.message }
    res.json(answer)
  } catch (err) {
    sendError(res, svc, err, "import plan")
  }
}
