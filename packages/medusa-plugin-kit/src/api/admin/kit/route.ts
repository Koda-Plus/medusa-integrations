import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SourceRow, StatusResponse } from "../../../modules/kit/lib/contract"
import { clientOf, optionsOf, settingsOf } from "../../kit/helpers"
import { isActive, missingOptions } from "../../../modules/kit/lib/options"

/**
 * GET /admin/kit - the panel in one read: the configuration, the account
 * behind the key (when configured), the settings in effect and the counters
 * of the subscription log. Read only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const svc = req.scope.resolve("kit") as any
  const o = optionsOf(req.scope)
  const settings = await settingsOf(req.scope)
  const missing = missingOptions(o)

  let account: StatusResponse["account"] = null
  if (isActive(o)) {
    try {
      const a = await clientOf(req.scope).account()
      account = { id: a.id, name: a.name, plan_type: a.plan_type, primary_email_address: a.primary_email_address }
    } catch {
      account = null
    }
  }

  let counts = { subscribed: 0, failed: 0, last_7_days: 0 }
  const bySource = new Map<string, SourceRow>()
  const row = (source: string): SourceRow => {
    let r = bySource.get(source)
    if (!r) bySource.set(source, (r = { source, name: null, ok: 0, failed: 0, last_at: null }))
    return r
  }
  try {
    const ok = (await svc.listKitSubscriberLogs({ status: "ok" })) ?? []
    const failed = (await svc.listKitSubscriberLogs({ status: "failed" })) ?? []
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const last7 = (await svc.listKitSubscriberLogs({ created_at: { $gte: weekAgo } })) ?? []
    for (const [list, key] of [[ok, "ok"], [failed, "failed"]] as const) {
      for (const l of Array.isArray(list) ? list : []) {
        const r = row(typeof l.source === "string" && l.source.trim() ? l.source.trim() : "form")
        r[key] += 1
        const at = l.created_at instanceof Date ? l.created_at.toISOString() : typeof l.created_at === "string" ? l.created_at : null
        if (at && (!r.last_at || at > r.last_at)) r.last_at = at
      }
    }
    counts = { subscribed: Array.isArray(ok) ? ok.length : 0, failed: Array.isArray(failed) ? failed.length : 0, last_7_days: Array.isArray(last7) ? last7.length : 0 }
  } catch {
    /* the table may not exist yet */
  }

  /* The declared storefront forms first (even before a sign-up), then any other source seen or given tags. */
  for (const f of o.forms) row(f.source).name = f.name
  for (const source of Object.keys(settings.source_tags ?? {})) row(source)
  const declared = o.forms.map((f) => f.source)
  const rank = (s: SourceRow) => (declared.includes(s.source) ? declared.indexOf(s.source) : declared.length)
  const sources = [...bySource.values()].sort((a, b) => rank(a) - rank(b) || (b.last_at ?? "").localeCompare(a.last_at ?? "") || a.source.localeCompare(b.source))

  const body: StatusResponse = {
    configured: isActive(o),
    demo: o.demo,
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
    settings: {
      tags: settings.tags,
      form_id: settings.form_id,
      double_opt_in: settings.double_opt_in,
      source_tags: settings.source_tags,
      buyer_tags: settings.buyer_tags,
      product_tags: settings.product_tags,
      product_tag_prefix: settings.product_tag_prefix,
    },
    counts,
    sources,
  }
  res.setHeader("Cache-Control", "no-store, must-revalidate")
  return res.json(body)
}
