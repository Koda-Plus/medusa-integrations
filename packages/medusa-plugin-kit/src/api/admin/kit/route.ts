import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { StatusResponse } from "../../../modules/kit/lib/contract"
import { clientOf, optionsOf, settingsOf } from "../../kit/helpers"

/**
 * GET /admin/kit - the panel in one read: the configuration, the account
 * behind the key (when configured), the settings in effect and the counters
 * of the subscription log. Read only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const svc = req.scope.resolve("kit") as any
  const o = optionsOf(req.scope)
  const settings = await settingsOf(req.scope)
  const missing: string[] = []
  if (!o.apiKey) missing.push("apiKey")

  let account: StatusResponse["account"] = null
  if (o.apiKey) {
    try {
      const a = await clientOf(req.scope).account()
      account = { id: a.id, name: a.name, plan_type: a.plan_type, primary_email_address: a.primary_email_address }
    } catch {
      account = null
    }
  }

  let counts = { subscribed: 0, failed: 0, last_7_days: 0 }
  try {
    const ok = (await svc.listKitSubscriberLogs({ status: "ok" })) ?? []
    const failed = (await svc.listKitSubscriberLogs({ status: "failed" })) ?? []
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const last7 = (await svc.listKitSubscriberLogs({ created_at: { $gte: weekAgo } })) ?? []
    counts = { subscribed: Array.isArray(ok) ? ok.length : 0, failed: Array.isArray(failed) ? failed.length : 0, last_7_days: Array.isArray(last7) ? last7.length : 0 }
  } catch {
    /* the table may not exist yet */
  }

  const body: StatusResponse = {
    configured: Boolean(o.apiKey),
    demo: false,
    missing,
    problems: o.problems,
    options: {
      apiKey: o.apiKey ? `***${o.apiKey.slice(-4)}` : "",
      source: o.source,
      doubleOptIn: o.doubleOptIn,
      formId: o.formId,
      tags: o.tags,
      storefrontUrl: o.storefrontUrl,
    },
    account,
    settings: { tags: settings.tags, form_id: settings.form_id, double_opt_in: settings.double_opt_in },
    counts,
  }
  res.setHeader("Cache-Control", "no-store, must-revalidate")
  return res.json(body)
}
