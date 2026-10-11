import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { KIT_MODULE } from "./constants"
import type { ResolvedKitOptions } from "./options"

/**
 * THE SETTINGS THE TEAM PICKS IN THE ADMIN, over the options: the tags new
 * subscribers get, the double opt-in form, the double opt-in switch. Pure
 * helpers over the container: the routes call them from outside the module.
 */

export type KitSettings = {
  tags: number[]
  form_id: number | null
  double_opt_in: boolean
}

/** The settings in effect: the options first, the admin settings override. */
export function effectiveSettings(o: ResolvedKitOptions, stored: Partial<KitSettings> | null): KitSettings {
  const s = stored ?? {}
  return {
    tags: Array.isArray(s.tags) ? s.tags : o.tags,
    form_id: typeof s.form_id === "number" ? s.form_id : o.formId,
    double_opt_in: typeof s.double_opt_in === "boolean" ? s.double_opt_in : o.doubleOptIn,
  }
}

export async function readSettings(scope: { resolve: (key: string) => unknown }): Promise<Partial<KitSettings> | null> {
  try {
    const svc = scope.resolve(KIT_MODULE) as any
    const rows = (await svc.listKitSettings({})) ?? []
    if (!Array.isArray(rows) || rows.length === 0) return null
    const out: Partial<KitSettings> = {}
    for (const row of rows) {
      if (row.key === "tags" && Array.isArray(row.value)) out.tags = (row.value as any[]).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
      if (row.key === "form_id" && (row.value === null || typeof row.value === "number")) out.form_id = row.value as number | null
      if (row.key === "double_opt_in" && typeof row.value === "boolean") out.double_opt_in = row.value as boolean
    }
    return out
  } catch {
    return null
  }
}

export async function writeSetting(scope: { resolve: (key: string) => unknown }, key: string, value: unknown): Promise<void> {
  const svc = scope.resolve(KIT_MODULE) as any
  const rows = (await svc.listKitSettings({ key })) ?? []
  if (Array.isArray(rows) && rows.length > 0) {
    await svc.updateKitSettings({ id: rows[0].id, value })
  } else {
    await svc.createKitSettings({ key, value })
  }
}

export function kitService(scope: { resolve: (key: string) => unknown }): any {
  return scope.resolve(KIT_MODULE)
}

export function loggerOf(scope: { resolve: (key: string) => unknown }) {
  return scope.resolve(ContainerRegistrationKeys.LOGGER) as { warn: (m: string) => void; error: (m: string) => void; info: (m: string) => void }
}
