/**
 * THE CATEGORY TREE of the marketplace, kept in `vonhalsky_category`:
 *
 *   syncCategories   reads the tree (five levels) and writes one row per
 *                    category; categories gone from the tree are deleted.
 *                    Daily from the sync job, or from the admin.
 *   attributesOf     the attribute definitions of a leaf, read once and kept
 *                    for a week.
 *   categoryInfo     what offers need of their categories: the path, leaf,
 *                    GPSR and the required attributes when known.
 *   medusaCategories Medusa's categories with the leaf each is mapped to.
 */

import type { AttributeDto, CategoryDto, CategoryMapResponse } from "../../modules/vonhalsky/lib/contract"
import { flattenCategories, type AttributeDefinition } from "../../modules/vonhalsky/lib/remote"
import { logSync, readSettings, vonHalskySvc, type Scope } from "../../modules/vonhalsky/lib/store"
import { errorText, optionsOf, queryOf, requireClient, VonHalskyFlowError, withLock } from "./runtime"

type Row = Record<string, any>

const ATTRIBUTES_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function toCategoryDto(r: Row): CategoryDto {
  return { id: String(r.remote_id), name: String(r.name ?? ""), path: String(r.path ?? ""), depth: Number(r.depth) || 0, leaf: r.leaf === true, gpsr_free: r.gpsr_free === true }
}

export function toAttributeDto(a: AttributeDefinition): AttributeDto {
  return { id: a.id, name: a.name, type: a.type ?? "TEXT_VALUE", required: a.required, multiple: a.expected === "AT_LEAST_ONE" || a.expected === "ANY", options: a.options, unit: a.unit }
}

async function allRows(scope: Scope, filters: Record<string, unknown> = {}): Promise<Row[]> {
  const svc = vonHalskySvc(scope)
  const out: Row[] = []
  for (let skip = 0; ; skip += 1000) {
    const rows = ((await svc.listVonHalskyCategories(filters, { skip, take: 1000, order: { path: "ASC" } })) ?? []) as Row[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

export async function syncCategories(scope: Scope): Promise<{ count: number; leaves: number; removed: number }> {
  const client = requireClient(scope)
  const o = optionsOf(scope)
  return withLock("categories", async () => {
    const svc = vonHalskySvc(scope)
    try {
      const flat = flattenCategories(await client.categories())
      if (flat.length === 0) throw new VonHalskyFlowError(502, "empty_tree", "The marketplace returned no categories.")
      const existing = new Map((await allRows(scope)).map((r) => [String(r.remote_id), r]))
      const now = new Date()
      const creates: Row[] = []
      const updates: Row[] = []
      for (const c of flat) {
        const row = { remote_id: c.id, parent_id: c.parentId, name: c.name, path: c.path, depth: c.depth, leaf: c.leaf, gpsr_free: c.gpsrFree, synced_at: now }
        const e = existing.get(c.id)
        if (e) updates.push({ id: e.id, ...row })
        else creates.push(row)
      }
      for (let i = 0; i < creates.length; i += 500) await svc.createVonHalskyCategories(creates.slice(i, i + 500))
      for (let i = 0; i < updates.length; i += 500) await svc.updateVonHalskyCategories(updates.slice(i, i + 500))
      const seen = new Set(flat.map((c) => c.id))
      const gone = [...existing.values()].filter((r) => !seen.has(String(r.remote_id))).map((r) => r.id)
      if (gone.length) await svc.deleteVonHalskyCategories(gone)
      const leaves = flat.filter((c) => c.leaf).length
      await logSync(scope, { area: "categories", action: "sync", message: `${flat.length} marketplace categories read (${leaves} leaves)${gone.length ? `, ${gone.length} gone` : ""}.`, count: flat.length, demo: o.demo })
      return { count: flat.length, leaves, removed: gone.length }
    } catch (err) {
      const message = errorText(err, scope)
      await logSync(scope, { area: "categories", action: "sync", outcome: "error", message, demo: o.demo })
      if (err instanceof VonHalskyFlowError) throw err
      throw new VonHalskyFlowError(502, "categories_failed", message)
    }
  })
}

/** The leaf's attribute definitions, from the table when read within a week, else from the marketplace. */
export async function attributesOf(scope: Scope, categoryId: string, fresh = false): Promise<AttributeDefinition[] | null> {
  const svc = vonHalskySvc(scope)
  const [row] = ((await svc.listVonHalskyCategories({ remote_id: categoryId }, { take: 1 })) ?? []) as Row[]
  const at = row?.attributes_at ? new Date(row.attributes_at).getTime() : 0
  if (!fresh && row && Array.isArray(row.attributes) && Date.now() - at < ATTRIBUTES_TTL_MS) return row.attributes as AttributeDefinition[]
  const client = requireClient(scope)
  try {
    const defs = await client.categoryAttributes(categoryId)
    if (row) await svc.updateVonHalskyCategories({ id: row.id, attributes: defs, attributes_at: new Date() })
    return defs
  } catch {
    return row && Array.isArray(row.attributes) ? (row.attributes as AttributeDefinition[]) : null
  }
}

export interface CategoryInfo {
  path: string
  leaf: boolean
  gpsrFree: boolean
  /** Ids of required attributes; null while the definitions were never read. */
  required: string[] | null
}

/** What offers need of these categories, from the table only (no call to the marketplace). */
export async function categoryInfo(scope: Scope, ids: readonly string[]): Promise<Map<string, CategoryInfo>> {
  const out = new Map<string, CategoryInfo>()
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return out
  const svc = vonHalskySvc(scope)
  for (let i = 0; i < unique.length; i += 500) {
    const rows = ((await svc.listVonHalskyCategories({ remote_id: unique.slice(i, i + 500) }, { take: 500 })) ?? []) as Row[]
    for (const r of rows) {
      const defs = Array.isArray(r.attributes) ? (r.attributes as AttributeDefinition[]) : null
      out.set(String(r.remote_id), { path: String(r.path ?? ""), leaf: r.leaf === true, gpsrFree: r.gpsr_free === true, required: defs ? defs.filter((d) => d.required).map((d) => d.id) : null })
    }
  }
  return out
}

/** Categories by a search in the path (leaves first), for the pickers. */
export async function searchCategories(scope: Scope, q: { search?: string; leafOnly?: boolean; limit: number; offset: number }): Promise<{ rows: CategoryDto[]; count: number }> {
  const svc = vonHalskySvc(scope)
  const filters: Record<string, unknown> = {}
  if (q.leafOnly) filters.leaf = true
  if (q.search && q.search.trim()) filters.path = { $ilike: `%${q.search.trim().slice(0, 100)}%` }
  const [rows, count] = (await svc.listAndCountVonHalskyCategories(filters, { skip: q.offset, take: q.limit, order: { path: "ASC" } })) as [Row[], number]
  return { rows: rows.map(toCategoryDto), count }
}

/** Medusa's product categories (at most 500) with the marketplace leaf each is mapped to. */
export async function medusaCategories(scope: Scope): Promise<CategoryMapResponse> {
  const settings = await readSettings(scope)
  const { data } = await queryOf(scope).graph({ entity: "product_category", fields: ["id", "name", "parent_category_id"], pagination: { take: 500, skip: 0 } })
  const list = data as Array<{ id: string; name?: string | null; parent_category_id?: string | null }>
  const byId = new Map(list.map((c) => [c.id, c]))
  const pathOf = (c: { id: string; name?: string | null; parent_category_id?: string | null }): string => {
    const names: string[] = []
    let cur: typeof c | undefined = c
    for (let guard = 0; cur && guard < 8; guard += 1) {
      names.unshift(String(cur.name ?? cur.id))
      cur = cur.parent_category_id ? byId.get(cur.parent_category_id) : undefined
    }
    return names.join(" > ")
  }
  const mappedIds = Object.values(settings.categories)
  const info = mappedIds.length ? await allRows(scope, { remote_id: mappedIds }) : []
  const byRemote = new Map(info.map((r) => [String(r.remote_id), toCategoryDto(r)]))
  return {
    medusa: list
      .map((c) => ({ id: c.id, name: String(c.name ?? c.id), path: pathOf(c), mapped: settings.categories[c.id] ? byRemote.get(settings.categories[c.id]) ?? null : null }))
      .sort((a, b) => a.path.localeCompare(b.path, "pl")),
  }
}

/** The leaf of a product: the first of its Medusa categories that is mapped. */
export function mappedLeaf(categoryIds: readonly string[], map: Record<string, string>): string | null {
  for (const id of categoryIds) if (map[id]) return map[id]
  return null
}
