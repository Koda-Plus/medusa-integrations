import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/kit/integration/attention?scope=customers - what waits for a
 * person: the failed subscriptions of the last 7 days. Read only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const scope = String(req.query.scope ?? "customers")
  if (scope !== "customers") return res.json({ items: [] })
  const svc = req.scope.resolve("kit") as any
  let count = 0
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const rows = (await svc.listKitSubscriberLogs({ status: "failed", created_at: { $gte: weekAgo } })) ?? []
    count = Array.isArray(rows) ? rows.length : 0
  } catch {
    count = 0
  }
  return res.json({
    items:
      count > 0
        ? [
            {
              scope: "customers",
              key: "failed_subscriptions",
              count,
              tone: "orange",
              label: { key: "attention.failed", params: { n: count }, fallback: `${count} failed subscriptions` },
              link: { href: "/kit", label: { key: "attention.open", params: {}, fallback: "Open Kit" } },
            },
          ]
        : [],
  })
}
