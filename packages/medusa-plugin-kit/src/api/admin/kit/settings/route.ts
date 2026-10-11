import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { clientOf, optionsOf } from "../../../kit/helpers"
import { readSettings, writeSetting } from "../../../../modules/kit/lib/store"

/**
 * GET / POST /admin/kit/settings - the list settings the team picks: the
 * tags new subscribers get, the double opt-in form, the double opt-in
 * switch. Writes are validated against the account before they land.
 */

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const o = optionsOf(req.scope)
  const stored = await readSettings(req.scope)
  return res.json({
    tags: Array.isArray(stored?.tags) ? stored.tags : o.tags,
    form_id: stored?.form_id !== undefined ? stored.form_id : o.formId,
    double_opt_in: typeof stored?.double_opt_in === "boolean" ? stored.double_opt_in : o.doubleOptIn,
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as { tags?: unknown; form_id?: unknown; double_opt_in?: unknown }
  const client = clientOf(req.scope)

  if (body.tags !== undefined) {
    const tags = (Array.isArray(body.tags) ? body.tags : []).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
    const known = await client.tags()
    const ids = new Set(known.map((t) => t.id))
    const unknown = tags.filter((t) => !ids.has(t))
    if (unknown.length > 0) {
      return res.status(400).json({ error: "invalid_data", message: `Unknown tag ids: ${unknown.join(", ")}` })
    }
    await writeSetting(req.scope, "tags", tags)
  }

  if (body.form_id !== undefined && body.form_id !== null) {
    const formId = Number(body.form_id)
    const forms = await client.forms()
    if (!forms.some((f) => f.id === formId)) {
      return res.status(400).json({ error: "invalid_data", message: `Unknown form id: ${formId}` })
    }
    await writeSetting(req.scope, "form_id", formId)
  } else if (body.form_id === null) {
    await writeSetting(req.scope, "form_id", null)
  }

  if (typeof body.double_opt_in === "boolean") {
    await writeSetting(req.scope, "double_opt_in", body.double_opt_in)
  }

  return res.json({ ok: true })
}
