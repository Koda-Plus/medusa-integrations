/**
 * THE CENEO TREE IN THE TABLE, AND THE MAPPING AS THE FEED READS IT.
 *
 * SYNC. Once a day (and from the admin): download the public tree, parse
 * it, and write only what changed. A category gone from the tree is kept
 * with `active` false. A download that fails, does not parse or is
 * suspiciously small changes nothing: the previous tree stays.
 */

import { CENEO_TREE_URL } from "../../modules/ceneo/lib/constants"
import { MIN_TREE_SIZE, parseCeneoTree, planCategorySync, productCeneoCategory, type CategoryRowLite, type CeneoCategoryRef } from "../../modules/ceneo/lib/categories"
import type { CategorySyncResult } from "../../modules/ceneo/lib/contract"
import { ceneoSvc, type CeneoServiceLike } from "../../modules/ceneo/lib/store"
import { chunks, errorText, withLock, type Scope } from "./runtime"

const WRITE_CHUNK = 500
const CATEGORY_FIELDS = ["id", "ceneo_id", "name", "parent_ceneo_id", "path", "depth", "leaf", "active"]

export type { CategorySyncResult }

/** The tree as text. Its own timeout: Ceneo's developer site is slower than its API. */
async function downloadTree(timeoutMs: number): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(CENEO_TREE_URL, { headers: { Accept: "application/xml" }, signal: ctrl.signal })
    if (!res.ok) throw new Error(`Ceneo answered ${res.status} for the category tree.`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

export async function runCeneoCategorySync(scope: Scope, input: { trigger?: string } = {}): Promise<CategorySyncResult> {
  const svc = ceneoSvc(scope)
  const trigger = input.trigger ?? "schedule"
  const result = await withLock("categories", async (): Promise<CategorySyncResult> => {
    const started = Date.now()
    let written = false
    try {
      const xml = await downloadTree(Math.max(60_000, svc.getOptions().timeoutMs))
      const nodes = parseCeneoTree(xml)
      if (nodes.length < MIN_TREE_SIZE) throw new Error(`The Ceneo category tree has only ${nodes.length} categories; the previous tree stays.`)
      const rows = (await svc.listCeneoCategories({}, { take: null, select: CATEGORY_FIELDS })) as unknown as CategoryRowLite[]
      const active = rows.filter((r) => r.active !== false).length
      if (nodes.length < active / 2) throw new Error(`The Ceneo category tree has ${nodes.length} categories, less than half of the ${active} in use; the previous tree stays.`)
      const plan = planCategorySync(rows, nodes)
      const now = new Date()
      written = true
      for (const part of chunks(plan.create, WRITE_CHUNK)) await svc.createCeneoCategories(part.map((d) => ({ ...d, synced_at: now })))
      for (const part of chunks(plan.update, WRITE_CHUNK)) await svc.updateCeneoCategories(part.map((u) => ({ id: u.id, ...u.data, synced_at: now })))
      for (const part of chunks(plan.deactivate, WRITE_CHUNK)) await svc.updateCeneoCategories(part.map((id) => ({ id, active: false, synced_at: now })))
      const out: CategorySyncResult = { status: "synced", categories: nodes.length, created: plan.create.length, updated: plan.update.length, removed: plan.deactivate.length, duration_ms: Date.now() - started }
      svc.getLogger().info(`[ceneo] Category tree (${trigger}): ${out.categories} categories, ${out.created} new, ${out.updated} changed, ${out.removed} removed.`)
      return out
    } catch (err) {
      const error = errorText(err)
      const left = written ? "partly applied, the next run completes it" : "the previous tree stays"
      svc.getLogger().warn(`[ceneo] Category tree sync failed (${trigger}), ${left}: ${error}`)
      return { status: "failed", error, duration_ms: Date.now() - started }
    }
  })
  return result ?? { status: "skipped", reason: "running" }
}

export interface CategoryMapping {
  /** The mapped Ceneo category of a product, with its path, or null. */
  forProduct(categoryIds: readonly string[], parents: ReadonlyMap<string, string | null>): CeneoCategoryRef | null
}

/** The mapping and the mapped Ceneo categories, read once per build. */
export async function loadCategoryMapping(svc: CeneoServiceLike): Promise<CategoryMapping> {
  const maps = await svc.listCeneoCategoryMaps({}, { take: null, select: ["category_id", "ceneo_id"] })
  const byCategory = new Map<string, string>()
  for (const m of maps) if (typeof m.category_id === "string" && typeof m.ceneo_id === "string") byCategory.set(m.category_id, m.ceneo_id)
  const ceneoIds = [...new Set(byCategory.values())]
  const refs = new Map<string, CeneoCategoryRef>()
  for (const part of chunks(ceneoIds, WRITE_CHUNK)) {
    const rows = await svc.listCeneoCategories({ ceneo_id: part }, { take: null, select: ["ceneo_id", "path", "active"] })
    for (const r of rows) if (typeof r.ceneo_id === "string") refs.set(r.ceneo_id, { ceneoId: r.ceneo_id, path: String(r.path ?? ""), active: r.active !== false })
  }
  return {
    forProduct(categoryIds, parents) {
      const hit = productCeneoCategory(categoryIds, parents, byCategory)
      if (!hit) return null
      /* A mapping to an id the table does not know (the tree never synced): inactive, so the feed warns and falls back. */
      return refs.get(hit.ceneoId) ?? { ceneoId: hit.ceneoId, path: "", active: false }
    },
  }
}
