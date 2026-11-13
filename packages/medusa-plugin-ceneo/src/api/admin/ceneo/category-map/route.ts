import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ancestry, effectiveMapping } from "../../../../modules/ceneo/lib/categories"
import type { CategoryMapResponse, CategoryMapRow, CeneoCategoryDto } from "../../../../modules/ceneo/lib/contract"
import { categoryStats, ceneoSvc } from "../../../../modules/ceneo/lib/store"
import { bodyOf, catalogChanged, medusaCategories, queryOf, toCategoryDto } from "../helpers"

/**
 * GET /admin/ceneo/category-map
 *
 * Every Medusa category with its own mapping and the mapping that applies
 * to it (its own or the nearest parent's), sorted by path.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  const cats = await medusaCategories(queryOf(req))
  const maps = await svc.listCeneoCategoryMaps({}, { take: null, select: ["category_id", "ceneo_id"] })
  const own = new Map<string, string>()
  for (const m of maps) if (typeof m.category_id === "string" && typeof m.ceneo_id === "string") own.set(m.category_id, m.ceneo_id)
  const ceneoIds = [...new Set(own.values())]
  const refs = new Map<string, CeneoCategoryDto>()
  if (ceneoIds.length > 0) {
    for (const r of await svc.listCeneoCategories({ ceneo_id: ceneoIds }, { take: null, select: ["ceneo_id", "name", "path", "leaf", "active"] })) {
      const dto = toCategoryDto(r)
      refs.set(dto.ceneoId, dto)
    }
  }
  const parents = new Map(cats.map((c) => [c.id, c.parentId]))
  const names = new Map(cats.map((c) => [c.id, c.name]))
  const unknown = (id: string): CeneoCategoryDto => ({ ceneoId: id, name: id, path: id, leaf: true, active: false })
  const rows: CategoryMapRow[] = cats.map((c) => {
    const chain = ancestry(c.id, parents)
    const eff = effectiveMapping(c.id, parents, own)
    const ownId = own.get(c.id)
    return {
      id: c.id,
      name: c.name,
      path: [...chain].reverse().map((id) => names.get(id) ?? id).join("/"),
      depth: chain.length - 1,
      hidden: c.hidden,
      own: ownId ? (refs.get(ownId) ?? unknown(ownId)) : null,
      effective: eff ? { ceneo: refs.get(eff.ceneoId) ?? unknown(eff.ceneoId), ceneoId: eff.ceneoId, fromCategoryId: eff.fromCategoryId, inherited: eff.inherited } : null,
    }
  })
  rows.sort((a, b) => a.path.localeCompare(b.path, "pl"))
  const body: CategoryMapResponse = { categories: rows, stats: await categoryStats(svc) }
  res.json(body)
}

/**
 * POST /admin/ceneo/category-map  { category_id, ceneo_id | null }
 *
 * Maps a Medusa category (and its subtree) to a Ceneo category, or removes
 * the mapping with `ceneo_id: null`. The Ceneo category must be in the
 * synced tree and active. The feed picks it up on its next build, within
 * about 10 minutes.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  const body = bodyOf(req)
  const categoryId = typeof body.category_id === "string" ? body.category_id.trim() : ""
  const raw = body.ceneo_id
  const ceneoId = raw === null ? null : typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : undefined
  if (!categoryId || ceneoId === undefined || (ceneoId !== null && !/^\d+$/.test(ceneoId))) {
    res.status(400).json({ code: "invalid", message: "Send { category_id, ceneo_id } with ceneo_id a Ceneo category id or null." })
    return
  }
  const { data } = await queryOf(req).graph({ entity: "product_category", fields: ["id"], filters: { id: categoryId } })
  if (data.length === 0) {
    res.status(404).json({ code: "category_not_found", message: `The Medusa category ${categoryId} does not exist.` })
    return
  }
  const [existing] = await svc.listCeneoCategoryMaps({ category_id: categoryId }, { take: 1, select: ["id", "ceneo_id"] })
  if (ceneoId === null) {
    if (existing) await svc.deleteCeneoCategoryMaps([existing.id])
  } else {
    const [ceneo] = await svc.listCeneoCategories({ ceneo_id: ceneoId, active: true }, { take: 1, select: ["id"] })
    if (!ceneo) {
      res.status(404).json({ code: "ceneo_category_not_found", message: `The Ceneo category ${ceneoId} is not in the synced tree.` })
      return
    }
    if (existing) await svc.updateCeneoCategoryMaps([{ id: existing.id, ceneo_id: ceneoId }])
    else await svc.createCeneoCategoryMaps([{ category_id: categoryId, ceneo_id: ceneoId }])
  }
  svc.getLogger().info(`[ceneo] Category ${categoryId} ${ceneoId ? `mapped to Ceneo ${ceneoId}` : "unmapped"}.`)
  await catalogChanged(req)
  res.json({ category_id: categoryId, ceneo_id: ceneoId })
}
