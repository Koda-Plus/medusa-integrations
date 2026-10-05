import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AllegroActionResponse, AllegroOutboxResponse } from "../../../../modules/allegro/lib/contract"
import { toOutboxDto, type OutboxRow } from "../../../../modules/allegro/lib/dto"
import { isRunning } from "../../../../workflows/allegro/runtime"
import { attachAllegroInvoicesWorkflow, pushAllegroShipmentsWorkflow } from "../../../../workflows/allegro/writer-workflows"
import { isArmed } from "../../../../workflows/allegro/writers"
import { allegroService, errorOf, intParam, strParam } from "../helpers"

/**
 * GET /admin/allegro/outbox?writer=shipping|invoices&status=&limit=&offset=
 *
 * Parcels, seller statuses and invoices on their way to Allegro, once each.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const writer = strParam(req.query.writer) === "invoices" ? "invoices" : "shipping"
  const status = strParam(req.query.status)
  const limit = intParam(req.query.limit, 10, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const where: Record<string, unknown> = { writer, demo: svc.isDemo() }
  if (status === "open") where.status = ["pending", "sending", "unknown"]
  else if (["pending", "sending", "done", "failed", "unknown", "skipped"].includes(status)) where.status = status
  const [rows, count] = (await svc.listAndCountAllegroOutboxes(where as never, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })) as unknown as [OutboxRow[], number]
  const body: AllegroOutboxResponse = { items: rows.map(toOutboxDto), count, limit, offset }
  res.json(body)
}

/** POST /admin/allegro/outbox  { writer } : send what is due now, in the background (only while armed). */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const writer = (req.body as { writer?: unknown } | undefined)?.writer === "invoices" ? "invoices" : "shipping"
  if (!(await isArmed(svc, writer))) {
    res.status(409).json({ message: `The ${writer} writer is not armed. Allow it in the options (writes.${writer}) and arm it in the Writers section.` })
    return
  }
  if (!isRunning(writer)) {
    const workflow = writer === "invoices" ? attachAllegroInvoicesWorkflow : pushAllegroShipmentsWorkflow
    void workflow(req.scope)
      .run({ input: { trigger: "manual" } })
      .catch((err: unknown) => svc.getLogger().error(`[allegro] ${writer}: ${errorOf(svc, err)}`))
  }
  const body: AllegroActionResponse = { ok: true, message: null }
  res.status(202).json(body)
}
