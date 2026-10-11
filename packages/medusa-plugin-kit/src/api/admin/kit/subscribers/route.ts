import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SubscriberDto } from "../../../../modules/kit/lib/contract"

/**
 * GET /admin/kit/subscribers - the subscription log, newest first.
 * `?take=` and `?offset=` page it; `?status=failed` narrows it.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const svc = req.scope.resolve("kit") as any
  const take = Math.min(100, Number(req.query.take ?? 25) || 25)
  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0)
  const status = req.query.status === "failed" ? "failed" : undefined
  try {
    const rows = (await svc.listKitSubscriberLogs(
      status ? { status } : {},
      { take, skip: offset, order: { created_at: "DESC" } },
    )) ?? []
    const total = Array.isArray(rows) ? rows.length : 0
    const subscribers: SubscriberDto[] = (Array.isArray(rows) ? rows : []).map((r: any) => ({
      id: String(r.id),
      email: String(r.email ?? ""),
      first_name: r.first_name ?? null,
      kit_subscriber_id: r.kit_subscriber_id ?? null,
      state: r.state ?? null,
      tags: Array.isArray(r.tags) ? (r.tags as any[]).map(Number) : null,
      source: r.source ?? null,
      status: r.status === "failed" ? "failed" : "ok",
      error: r.error ?? null,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ""),
    }))
    return res.json({ subscribers, count: total })
  } catch {
    return res.json({ subscribers: [], count: 0 })
  }
}
