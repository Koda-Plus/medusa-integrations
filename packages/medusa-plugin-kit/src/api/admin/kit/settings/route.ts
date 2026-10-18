import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { clientOf, optionsOf } from "../../../kit/helpers"
import { idList, prefixOf, readSettings, sourceKey, sourceTagsOf, writeSetting } from "../../../../modules/kit/lib/store"

/**
 * GET / POST /admin/kit/settings - the list settings the team picks: the
 * tags new subscribers get, the double opt-in form, the double opt-in
 * switch, the extra tags by sign-up source and the tags for buyers.
 * Writes are validated against the account before they land.
 */

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const o = optionsOf(req.scope)
  const stored = await readSettings(req.scope)
  return res.json({
    tags: Array.isArray(stored?.tags) ? stored.tags : o.tags,
    form_id: stored?.form_id !== undefined ? stored.form_id : o.formId,
    double_opt_in: typeof stored?.double_opt_in === "boolean" ? stored.double_opt_in : o.doubleOptIn,
    source_tags: stored?.source_tags ?? {},
    buyer_tags: stored?.buyer_tags ?? [],
    product_tags: stored?.product_tags === true,
    product_tag_prefix: prefixOf(stored?.product_tag_prefix),
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as {
    tags?: unknown
    form_id?: unknown
    double_opt_in?: unknown
    source_tags?: unknown
    buyer_tags?: unknown
    product_tags?: unknown
    product_tag_prefix?: unknown
  }
  const client = clientOf(req.scope)

  /** Tag ids must exist on the account; one read serves every tag field of the request. */
  let knownIds: Set<number> | null = null
  const unknownTags = async (ids: number[]) => {
    if (!knownIds) knownIds = new Set((await client.tags()).map((t) => t.id))
    return ids.filter((t) => !knownIds!.has(t))
  }

  if (body.source_tags !== undefined) {
    const raw = body.source_tags && typeof body.source_tags === "object" && !Array.isArray(body.source_tags) ? (body.source_tags as Record<string, unknown>) : {}
    const badKeys = Object.keys(raw).filter((k) => !sourceKey(k))
    if (badKeys.length > 0) {
      return res.status(400).json({ error: "invalid_data", message: `Invalid source names: ${badKeys.join(", ")} (letters, digits, - and _)` })
    }
    const map = sourceTagsOf(raw)
    const bad = await unknownTags([...new Set(Object.values(map).flat())])
    if (bad.length > 0) return res.status(400).json({ error: "invalid_data", message: `Unknown tag ids: ${bad.join(", ")}` })
    await writeSetting(req.scope, "source_tags", map)
  }

  if (body.buyer_tags !== undefined) {
    const ids = idList(body.buyer_tags)
    const bad = await unknownTags(ids)
    if (bad.length > 0) return res.status(400).json({ error: "invalid_data", message: `Unknown tag ids: ${bad.join(", ")}` })
    await writeSetting(req.scope, "buyer_tags", ids)
  }

  if (typeof body.product_tags === "boolean") {
    await writeSetting(req.scope, "product_tags", body.product_tags)
  }

  if (typeof body.product_tag_prefix === "string") {
    await writeSetting(req.scope, "product_tag_prefix", prefixOf(body.product_tag_prefix))
  }

  if (body.tags !== undefined) {
    const tags = idList(body.tags)
    const unknown = await unknownTags(tags)
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
