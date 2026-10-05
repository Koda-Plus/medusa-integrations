import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { sellerPanel } from "../../../../modules/allegro/lib/constants"
import type { AllegroActionResponse, AllegroIssueFilter, AllegroIssuesResponse } from "../../../../modules/allegro/lib/contract"
import { toIssueDto, type ImportRow, type IssueRow } from "../../../../modules/allegro/lib/dto"
import { isRunning } from "../../../../workflows/allegro/runtime"
import { syncAllegroIssuesWorkflow } from "../../../../workflows/allegro/writer-workflows"
import { allegroService, errorOf, intParam, strParam } from "../helpers"

const FILTERS: readonly AllegroIssueFilter[] = ["all", "open", "needs_reply", "returns", "disputes", "claims"]

/**
 * GET /admin/allegro/issues?filter=&limit=&offset=
 *
 * Customer returns, disputes and claims as Allegro reports them, read only,
 * linked to the imported Medusa order where there is one and to the seller
 * panel. No buyer data.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const rawFilter = strParam(req.query.filter) as AllegroIssueFilter
  const filter: AllegroIssueFilter = FILTERS.includes(rawFilter) ? rawFilter : "open"
  const limit = intParam(req.query.limit, 10, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const where: Record<string, unknown> = { demo: svc.isDemo() }
  if (filter === "open") where.is_open = true
  else if (filter === "needs_reply") where.needs_reply = true
  else if (filter === "returns") where.kind = "return"
  else if (filter === "disputes") where.kind = "dispute"
  else if (filter === "claims") where.kind = "claim"
  const [rows, count] = (await svc.listAndCountAllegroIssues(where as never, {
    take: limit,
    skip: offset,
    order: { opened_at: "DESC" },
  })) as unknown as [IssueRow[], number]
  const forms = rows.map((r) => r.checkout_form_id).filter((x): x is string => Boolean(x))
  const imports = forms.length
    ? ((await svc.listAllegroOrderImports({ checkout_form_id: forms } as never, {
        take: forms.length,
        select: ["checkout_form_id", "order_id", "display_id"],
      })) as unknown as Array<Pick<ImportRow, "checkout_form_id" | "order_id" | "display_id">>)
    : []
  const byForm = new Map(imports.filter((i) => i.order_id).map((i) => [i.checkout_form_id, { id: i.order_id as string, display_id: i.display_id ?? null }]))
  const panel = sellerPanel(svc.getOptions().environment)
  const body: AllegroIssuesResponse = {
    issues: rows.map((r) => toIssueDto(r, r.kind === "return" ? panel.returns : panel.discussions, r.checkout_form_id ? byForm.get(r.checkout_form_id) ?? null : null)),
    count,
    limit,
    offset,
  }
  res.json(body)
}

/** POST /admin/allegro/issues : read returns, disputes, claims and unread messages now, in the background. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  if (!isRunning("issues")) {
    void syncAllegroIssuesWorkflow(req.scope)
      .run({ input: { trigger: "manual" } })
      .catch((err: unknown) => svc.getLogger().error(`[allegro] issues: ${errorOf(svc, err)}`))
  }
  const body: AllegroActionResponse = { ok: true, message: null }
  res.status(202).json(body)
}
