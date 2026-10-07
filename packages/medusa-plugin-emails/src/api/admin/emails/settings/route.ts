import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SettingsRequest } from "../../../../modules/emails/lib/contract"
import { resolveTemplate } from "../../../../modules/emails/lib/registry"
import { brandKey, forgetSettings, mergeOverrides, readSettings, sanitizeBrandOverrides, templateKey, type BrandOverrides } from "../../../../modules/emails/lib/settings"
import { storeFor } from "../../../../workflows/emails/runtime"
import { actorOf, buildStatus, emailsService, serverError } from "../helpers"

/**
 * POST /admin/emails/settings  { brand?: {...} | null, templates?: { "order.placed": true } }
 *
 * What a person changes in Settings, stored with who changed it and when,
 * apart for demo and live mode (demo changes are forgotten after a day):
 *
 *   brand      overrides of the branding options; a field set to null or ""
 *              goes back to the option, `brand: null` resets them all
 *   templates  the switches; a template the options turned off
 *              (`templates: { key: false }`) cannot be turned on here
 *
 * Answers with the new status. Sends nothing.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = emailsService(req.scope)
  const o = svc.getOptions()
  const input = (req.body ?? {}) as SettingsRequest
  const actor = actorOf(req)
  const store = storeFor(req.scope)
  const demo = svc.isDemo()

  const switches: Array<[string, boolean]> = []
  if (input.templates !== undefined) {
    if (!input.templates || typeof input.templates !== "object") {
      res.status(400).json({ message: "templates: an object of template keys and true or false." })
      return
    }
    for (const [key, on] of Object.entries(input.templates)) {
      const t = resolveTemplate(key, o)
      if (!t || typeof on !== "boolean") {
        res.status(400).json({ message: `templates["${key.slice(0, 64)}"]: an existing template and true or false.` })
        return
      }
      if (on && o.switches[key] === false) {
        res.status(409).json({ message: `The template ${key} is turned off in the plugin options (templates: { "${key}": false }); the admin cannot turn it on.` })
        return
      }
      switches.push([key, on])
    }
  }

  let brand: Record<string, unknown> | null | undefined
  if (input.brand === null) brand = {}
  else if (input.brand !== undefined) {
    const { value, errors } = sanitizeBrandOverrides(input.brand)
    if (errors.length > 0) {
      res.status(400).json({ message: `Check these fields: ${errors.join(", ")}.`, fields: errors })
      return
    }
    /* Merged with what the database holds now, not with this process's cache: another admin on another instance may have just saved. */
    let current: BrandOverrides | null
    try {
      current = readSettings(await store.settings(), demo).brand
    } catch (err) {
      serverError(req, res, err, "The settings cannot be saved. Did the migrations run (npx medusa db:migrate)? The server log has the details.", 503)
      return
    }
    brand = mergeOverrides(current, value) as Record<string, unknown>
  }

  try {
    for (const [key, on] of switches) await store.setSetting(templateKey(demo, key), { on }, actor)
    if (brand !== undefined) await store.setSetting(brandKey(demo), brand, actor)
  } catch (err) {
    serverError(req, res, err, "The settings cannot be saved. Did the migrations run (npx medusa db:migrate)? The server log has the details.", 503)
    return
  }
  forgetSettings({ keepFallback: true })
  if (switches.length > 0) svc.getLogger().info(`[emails] Templates ${switches.map(([k, on]) => `${k} ${on ? "on" : "off"}`).join(", ")} by ${actor ?? "unknown"}`)
  if (brand !== undefined) svc.getLogger().info(`[emails] Branding ${input.brand === null ? "reset" : "changed"} by ${actor ?? "unknown"}`)
  try {
    res.json(await buildStatus(req.scope))
  } catch (err) {
    serverError(req, res, err, "The settings were saved, but the status could not be read. The server log has the details.")
  }
}
