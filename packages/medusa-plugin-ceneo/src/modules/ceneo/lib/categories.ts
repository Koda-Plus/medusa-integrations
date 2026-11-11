/**
 * THE CENEO CATEGORY TREE AND THE MAPPING. Pure, zero runtime imports.
 *
 * The tree (https://developers.ceneo.pl/api/v3/kategorie) is XML:
 *
 *   <ArrayOfCategory>
 *     <Category><Id>2286</Id><Name>Biuro i firma</Name>
 *       <Subcategories><Category>...</Category></Subcategories>
 *     </Category>
 *   </ArrayOfCategory>
 *
 * About 4000 categories, 330 KB. Read with a small tokenizer for exactly
 * this shape (zero dependencies is a repo rule); anything unexpected throws,
 * so a broken download never replaces a good tree.
 *
 * MAPPING. A Medusa category mapped to a Ceneo category maps its whole
 * subtree, unless a subcategory has its own mapping. A product in several
 * categories takes the most specific mapped one (the deepest Medusa
 * category, then the id), so the result never depends on the order Medusa
 * returns the categories in.
 */

export interface CeneoTreeNode {
  ceneoId: string
  name: string
  parentCeneoId: string | null
  path: string
  depth: number
  leaf: boolean
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16))
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10))
    return ENTITIES[e] ?? ""
  })
}

/** Minimum size of a real tree: a page of an error or an empty answer is never stored. */
export const MIN_TREE_SIZE = 100

/**
 * Parses the Ceneo tree into a flat list, parents before children.
 * Throws on anything that is not the expected shape.
 */
export function parseCeneoTree(xml: string): CeneoTreeNode[] {
  const body = xml.replace(/^﻿/, "").replace(/<\?xml[^>]*\?>/, "").trim()
  if (!body.startsWith("<ArrayOfCategory")) throw new Error("The Ceneo category tree is not an ArrayOfCategory document.")
  const tokens = body.match(/<[^>]+>|[^<]+/g) ?? []

  const out: CeneoTreeNode[] = []
  type Frame = { id: string | null; name: string | null; node: CeneoTreeNode | null }
  const stack: Frame[] = []
  let field: "Id" | "Name" | null = null
  let text = ""

  const flush = (frame: Frame) => {
    if (frame.node || frame.id === null || frame.name === null) return
    const parent = [...stack].reverse().find((f) => f !== frame && f.node)?.node ?? null
    const name = frame.name.replace(/\s+/g, " ").trim()
    if (!/^\d+$/.test(frame.id) || !name) throw new Error(`A Ceneo category has no valid id or name (${frame.id}).`)
    frame.node = {
      ceneoId: frame.id,
      name,
      parentCeneoId: parent?.ceneoId ?? null,
      path: parent ? `${parent.path}/${name}` : name,
      depth: parent ? parent.depth + 1 : 0,
      leaf: true,
    }
    if (parent) parent.leaf = false
    out.push(frame.node)
  }

  for (const tok of tokens) {
    if (!tok.startsWith("<")) {
      if (field) text += tok
      continue
    }
    const m = /^<(\/?)([A-Za-z]+)[^>]*?(\/?)>$/.exec(tok)
    if (!m) continue
    const [, closing, tag, selfClosing] = m
    if (tag === "Category" && !closing && !selfClosing) {
      const parent = stack[stack.length - 1]
      if (parent) flush(parent)
      stack.push({ id: null, name: null, node: null })
    } else if (tag === "Category" && closing) {
      const frame = stack.pop()
      if (!frame) throw new Error("The Ceneo category tree is not balanced.")
      flush(frame)
      if (!frame.node) throw new Error("A Ceneo category has no id or name.")
    } else if ((tag === "Id" || tag === "Name") && !selfClosing) {
      if (!closing) {
        field = tag
        text = ""
      } else if (field === tag) {
        const frame = stack[stack.length - 1]
        if (frame) {
          if (tag === "Id") frame.id = decode(text).trim()
          else frame.name = decode(text)
        }
        field = null
      }
    } else if (tag === "Subcategories" && !closing) {
      const frame = stack[stack.length - 1]
      if (frame) flush(frame)
    }
  }
  if (stack.length > 0) throw new Error("The Ceneo category tree ends in the middle of a category.")
  const ids = new Set<string>()
  for (const n of out) {
    if (ids.has(n.ceneoId)) throw new Error(`The Ceneo category ${n.ceneoId} appears twice.`)
    ids.add(n.ceneoId)
  }
  return out
}

export interface CategoryRowLite {
  id: string
  ceneo_id: string
  name?: string | null
  parent_ceneo_id?: string | null
  path?: string | null
  depth?: number | null
  leaf?: boolean | null
  active?: boolean | null
}

export interface CategoryRowData {
  ceneo_id: string
  name: string
  parent_ceneo_id: string | null
  path: string
  depth: number
  leaf: boolean
  active: boolean
}

export interface CategorySyncPlan {
  create: CategoryRowData[]
  update: Array<{ id: string; data: CategoryRowData }>
  /** Rows whose category left the tree: kept, `active` false. */
  deactivate: string[]
}

function toData(n: CeneoTreeNode): CategoryRowData {
  return { ceneo_id: n.ceneoId, name: n.name, parent_ceneo_id: n.parentCeneoId, path: n.path, depth: n.depth, leaf: n.leaf, active: true }
}

function same(r: CategoryRowLite, d: CategoryRowData): boolean {
  return (
    r.name === d.name &&
    (r.parent_ceneo_id ?? null) === d.parent_ceneo_id &&
    r.path === d.path &&
    (r.depth ?? 0) === d.depth &&
    (r.leaf ?? true) === d.leaf &&
    r.active !== false
  )
}

export function planCategorySync(rows: readonly CategoryRowLite[], nodes: readonly CeneoTreeNode[]): CategorySyncPlan {
  const byId = new Map(rows.map((r) => [r.ceneo_id, r]))
  const seen = new Set<string>()
  const plan: CategorySyncPlan = { create: [], update: [], deactivate: [] }
  for (const n of nodes) {
    seen.add(n.ceneoId)
    const data = toData(n)
    const row = byId.get(n.ceneoId)
    if (!row) plan.create.push(data)
    else if (!same(row, data)) plan.update.push({ id: row.id, data })
  }
  for (const r of rows) if (!seen.has(r.ceneo_id) && r.active !== false) plan.deactivate.push(r.id)
  return plan
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

export interface CeneoCategoryRef {
  ceneoId: string
  path: string
  active: boolean
}

export interface MedusaCategoryNode {
  id: string
  parentId: string | null
}

/** The chain of a Medusa category: itself first, then its parents. Cycles stop. */
export function ancestry(id: string, parents: ReadonlyMap<string, string | null>): string[] {
  const chain: string[] = []
  const guard = new Set<string>()
  let cur: string | null = id
  while (cur && !guard.has(cur)) {
    guard.add(cur)
    chain.push(cur)
    cur = parents.get(cur) ?? null
  }
  return chain
}

export interface EffectiveMapping {
  ceneoId: string
  /** The Medusa category that holds the mapping (the category itself or a parent). */
  fromCategoryId: string
  inherited: boolean
}

/** The mapping of one Medusa category: its own, else the nearest parent's. */
export function effectiveMapping(categoryId: string, parents: ReadonlyMap<string, string | null>, maps: ReadonlyMap<string, string>): EffectiveMapping | null {
  for (const id of ancestry(categoryId, parents)) {
    const ceneoId = maps.get(id)
    if (ceneoId) return { ceneoId, fromCategoryId: id, inherited: id !== categoryId }
  }
  return null
}

/** The Ceneo category of a product: the most specific mapped category, ties by id. */
export function productCeneoCategory(
  categoryIds: readonly string[],
  parents: ReadonlyMap<string, string | null>,
  maps: ReadonlyMap<string, string>,
): { ceneoId: string; categoryId: string } | null {
  let best: { ceneoId: string; categoryId: string; depth: number } | null = null
  for (const id of categoryIds) {
    const m = effectiveMapping(id, parents, maps)
    if (!m) continue
    const depth = ancestry(id, parents).length
    if (!best || depth > best.depth || (depth === best.depth && id < best.categoryId)) best = { ceneoId: m.ceneoId, categoryId: id, depth }
  }
  return best ? { ceneoId: best.ceneoId, categoryId: best.categoryId } : null
}
