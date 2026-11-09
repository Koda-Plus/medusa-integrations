/**
 * THE OFFERS: built from the Medusa catalog, listed and taken off by a
 * person, priced with the channel markup, stocked from Medusa inventory.
 *
 *   refreshOffers   reads the catalog and writes one row per variant: the
 *                   matching keys, the category (mapped from Medusa's, from
 *                   the marketplace catalog, or picked by a person), the
 *                   GPSR manufacturer, the reasons it cannot be listed, the
 *                   channel price and the quantity. It never lists anything.
 *   listOffers      "List selected": new offers go out in batches of 500
 *                   (`POST /offers/batch`), offers the marketplace knows are
 *                   patched (and reopened when closed). Every write is a
 *                   command the sync follows to SUCCESS or FAILURE.
 *   unlistOffers    closes listed offers.
 *   hintOffer       asks the marketplace catalog by EAN or part number:
 *                   its category and attributes fill what is missing.
 *   setCategory, setAttributes, setOverride, setPromotion, setProgram:
 *                   what a person decides per offer.
 *
 * THE COMPLETE-READ RULE: a partial read of the catalog adds and updates
 * rows, it never closes the offer of a variant it did not see.
 */

import { BATCH_OFFERS, PAGE_MAX } from "../../modules/vonhalsky/lib/client"
import type { BulkEditResponse, EditResponse, HintResponse, ImportOffersResponse, OfferDefaults, OfferDto, PromotionInput } from "../../modules/vonhalsky/lib/contract"
import { eligibility, nextOfferStatus, type VariantFacts } from "../../modules/vonhalsky/lib/eligibility"
import { buildProposal, editPatchOf, type OfferProposal } from "../../modules/vonhalsky/lib/offer-payload"
import { importPlan, type ImportRow } from "../../modules/vonhalsky/lib/offer-import"
import { afterEditStep, editStart, remotePatch } from "../../modules/vonhalsky/lib/offer-sync"
import { applyOverrides, daysToShipOf, isRefusal, mergeOverrides, overridesOf, parseOverridesPatch } from "../../modules/vonhalsky/lib/overrides"
import { channelPriceMinor, parseOverride } from "../../modules/vonhalsky/lib/pricing"
import type { CommandState, RemoteOffer } from "../../modules/vonhalsky/lib/remote"
import { logSync, readSettings, toOfferDto, vonHalskySvc, type Scope } from "../../modules/vonhalsky/lib/store"
import { editableFactsOf, loadFacts, thumbnailsOf } from "./catalog"
import { attributesOf, categoryInfo, mappedLeaf, type CategoryInfo } from "./categories"
import { VonHalskyFlowError, demoClientOf, errorText, optionsOf, requireClient, withLock } from "./runtime"

export interface RefreshResult {
  read: number
  created: number
  updated: number
  blocked: number
  closed: number
  complete: boolean
}

type Row = Record<string, any>

async function rowsByVariant(scope: Scope, variantIds: string[] | null): Promise<Map<string, Row>> {
  const svc = vonHalskySvc(scope)
  const out = new Map<string, Row>()
  if (variantIds && variantIds.length === 0) return out
  const take = 1000
  for (let skip = 0; ; skip += take) {
    const rows = ((await svc.listVonHalskyOffers(variantIds ? { variant_id: variantIds } : {}, { skip, take, order: { id: "ASC" } })) ?? []) as Row[]
    for (const r of rows) out.set(String(r.variant_id), r)
    if (rows.length < take) break
  }
  return out
}

async function rowsById(scope: Scope, ids: readonly string[]): Promise<Row[]> {
  if (ids.length === 0) return []
  return ((await vonHalskySvc(scope).listVonHalskyOffers({ id: ids.slice(0, 500) }, { take: 500 })) ?? []) as Row[]
}

/**
 * The category of an offer: one a person picked wins, then the leaf mapped
 * from the product's Medusa categories, then the catalog's hint.
 */
export function resolveCategory(row: Row | null, f: Pick<VariantFacts, "categoryIds">, map: Record<string, string>): { id: string | null; source: "manual" | "map" | "hint" | null } {
  if (row?.category_source === "manual" && row.category_id) return { id: String(row.category_id), source: "manual" }
  const mapped = mappedLeaf(f.categoryIds, map)
  if (mapped) return { id: mapped, source: "map" }
  if (row?.category_source === "hint" && row.category_id) return { id: String(row.category_id), source: "hint" }
  return { id: null, source: null }
}

const attributeValues = (v: unknown): Array<{ id: string; values: string[] }> =>
  Array.isArray(v) ? v.filter((a) => a && typeof a.id === "string").map((a) => ({ id: String(a.id), values: Array.isArray(a.values) ? a.values.map(String) : [] })) : []

/**
 * The row a variant's facts make, keeping what a person set (price override,
 * category, closed, listed, detached). The edits of "Edit offer" (name,
 * description, photos, package) are applied over Medusa's facts first: the
 * checks see what the marketplace will get, and the row's title is the name
 * that is sent.
 */
export function offerPatch(
  medusa: VariantFacts,
  existing: Row | null,
  pricing: { includesTax: boolean; vatRate: number; markupPercent: number },
  demo: boolean,
  category: { id: string | null; source: "manual" | "map" | "hint" | null; info: CategoryInfo | null },
): Record<string, unknown> {
  const f = applyOverrides(medusa, overridesOf(existing?.overrides))
  const e = eligibility(f, {
    categoryId: category.id && (category.info?.leaf ?? true) ? category.id : null,
    gpsrFree: category.info?.gpsrFree ?? false,
    requiredAttributes: category.info?.required ?? null,
    attributes: attributeValues(existing?.attributes),
  })
  const override = typeof existing?.price_override_minor === "number" ? existing.price_override_minor : null
  const status = nextOfferStatus(existing?.status ?? null, e.listable)
  return {
    variant_id: f.variantId,
    product_id: f.productId,
    sku: f.sku,
    title: f.title,
    status,
    ean: f.ean,
    brand: f.brand,
    mpn: f.mpn,
    manufacturer: f.manufacturer?.name ?? null,
    gpsr_source: f.gpsrSource,
    reasons: e.reasons,
    warnings: e.warnings,
    base_price_minor: f.basePriceMinor,
    price_minor: channelPriceMinor({ baseMinor: f.basePriceMinor, includesTax: pricing.includesTax, vatRate: f.vatRate ?? pricing.vatRate, markupPercent: pricing.markupPercent, overrideMinor: override }),
    currency_code: "pln",
    stock: f.stock,
    category_id: category.id,
    category_source: category.source,
    // A row that never reached a marketplace takes the current mode: the catalog
    // rows of a demo become real ones once the credentials are set. A row with a
    // remote offer keeps the flag of the marketplace that offer lives on.
    demo: existing && existing.remote_id ? existing.demo === true : demo,
  }
}

export async function refreshOffers(scope: Scope, only: { variantIds?: string[]; productIds?: string[] } = {}): Promise<RefreshResult> {
  const o = optionsOf(scope)
  if (o.mode === "off") throw new VonHalskyFlowError(409, "not_configured", "InPost Von Halsky is not configured: set the credentials or demo: true.")
  return withLock("offers", async () => {
    const svc = vonHalskySvc(scope)
    const settings = await readSettings(scope)
    const read = await loadFacts(scope, o, only)
    const existing = await rowsByVariant(scope, only.variantIds || only.productIds ? read.facts.map((f) => f.variantId) : null)
    const pricing = { includesTax: read.includesTax, vatRate: o.vatRate, markupPercent: settings.pricing.markupPercent }
    const categories = read.facts.map((f) => resolveCategory(existing.get(f.variantId) ?? null, f, settings.categories))
    const info = await categoryInfo(
      scope,
      categories.map((c) => c.id).filter((x): x is string => Boolean(x)),
    )
    const creates: Record<string, unknown>[] = []
    const updates: Record<string, unknown>[] = []
    let blocked = 0
    read.facts.forEach((f, i) => {
      const row = existing.get(f.variantId) ?? null
      const c = categories[i]
      const patch = offerPatch(f, row, pricing, o.demo, { ...c, info: c.id ? info.get(c.id) ?? null : null })
      if (patch.status === "blocked") blocked += 1
      if (row) updates.push({ id: row.id, ...patch })
      else creates.push(patch)
    })
    for (let i = 0; i < creates.length; i += 200) await svc.createVonHalskyOffers(creates.slice(i, i + 200))
    for (let i = 0; i < updates.length; i += 200) await svc.updateVonHalskyOffers(updates.slice(i, i + 200))
    let closed = 0
    if (read.complete) {
      const seen = new Set(read.facts.map((f) => f.variantId))
      const gone = [...existing.values()].filter((r) => !seen.has(String(r.variant_id)) && r.status !== "closed")
      for (const r of gone) {
        if (r.status === "listed" && r.remote_id) {
          try {
            const c = await requireClient(scope).closeOffer(String(r.remote_id))
            if (c) await svc.updateVonHalskyOffers({ id: r.id, command_id: c.commandId, command_kind: "close", command_status: c.status, command_at: new Date() })
          } catch {
            /* closed here anyway; the person sees the error on the next list */
          }
        }
        await svc.updateVonHalskyOffers({ id: r.id, status: "closed", error: "The variant no longer exists in Medusa." })
        closed += 1
      }
    }
    const result = { read: read.facts.length, created: creates.length, updated: updates.length, blocked, closed, complete: read.complete }
    if (!only.variantIds && !only.productIds) {
      await logSync(scope, {
        area: "offers",
        action: "refresh",
        outcome: blocked > 0 ? "warning" : "ok",
        message: `Read ${result.read} variants: ${result.created} new offers, ${result.updated} updated, ${blocked} cannot be listed${closed ? `, ${closed} closed (variant gone)` : ""}${read.complete ? "" : " (partial read: nothing was closed)"}.`,
        count: result.read,
        demo: o.demo,
      })
    }
    return result
  })
}

export interface ListResult {
  listed: number
  skipped: Array<{ id: string; reason: string }>
  offers: OfferDto[]
}

function commandFields(c: CommandState | null, kind: string, now: Date): Record<string, unknown> {
  return c ? { command_id: c.commandId, command_kind: kind, command_status: c.status, command_at: now } : {}
}

/**
 * The proposal of one row: Medusa's facts with the row's edits over them
 * (name from the row, description, photos, package from the overrides) and
 * its own days to ship over the offer defaults.
 */
export function rowProposal(r: Row, medusa: VariantFacts, gpsrFree: boolean, defaults: OfferDefaults, vatRate: number): OfferProposal {
  const edits = overridesOf(r.overrides)
  return buildProposal({
    row: r as never,
    facts: applyOverrides(medusa, edits),
    categoryId: String(r.category_id),
    gpsrFree,
    defaults: { ...defaults, daysToShip: daysToShipOf(edits, defaults.daysToShip) },
    vatRate,
  })
}

/** The proposals of rows that have a category, from a fresh read of Medusa. */
async function proposalsOf(scope: Scope, rows: readonly Row[]): Promise<Map<string, OfferProposal>> {
  const out = new Map<string, OfferProposal>()
  const usable = rows.filter((r) => r.category_id)
  if (usable.length === 0) return out
  const o = optionsOf(scope)
  const read = await loadFacts(scope, o, { variantIds: usable.map((r) => String(r.variant_id)) })
  const facts = new Map(read.facts.map((f) => [f.variantId, f]))
  const info = await categoryInfo(scope, [...new Set(usable.map((r) => String(r.category_id)))])
  const settings = await readSettings(scope)
  for (const r of usable) {
    const f = facts.get(String(r.variant_id))
    if (f) out.set(r.id, rowProposal(r, f, info.get(String(r.category_id))?.gpsrFree ?? false, settings.offerDefaults, o.vatRate))
  }
  return out
}

/**
 * "List selected": the chosen offers, read fresh from the catalog first (a
 * fix made a minute ago counts). Offers without a category ask the catalog
 * first; the attribute definitions of their categories are read, so a
 * missing required attribute blocks here, not on the marketplace.
 */
export async function listOffers(scope: Scope, ids: string[]): Promise<ListResult> {
  const o = optionsOf(scope)
  const client = requireClient(scope)
  const svc = vonHalskySvc(scope)
  const chosen = await rowsById(scope, ids)
  if (chosen.length === 0) throw new VonHalskyFlowError(404, "not_found", "None of the chosen offers exists.")
  const variantIds = chosen.map((r) => String(r.variant_id))
  await refreshOffers(scope, { variantIds })

  /* Fill what the catalog knows, read the attribute definitions, check again. */
  let fresh = await rowsById(scope, chosen.map((r) => r.id))
  for (const r of fresh.filter((x) => !x.category_id && !x.hint && (x.ean || x.mpn)).slice(0, 50)) {
    await hintOffer(scope, r.id).catch(() => undefined)
  }
  fresh = await rowsById(scope, chosen.map((r) => r.id))
  const cats = [...new Set(fresh.map((r) => r.category_id).filter((x): x is string => Boolean(x)))]
  for (const c of cats.slice(0, 50)) await attributesOf(scope, c).catch(() => null)
  await refreshOffers(scope, { variantIds })
  fresh = await rowsById(scope, chosen.map((r) => r.id))

  const read = await loadFacts(scope, o, { variantIds })
  const facts = new Map(read.facts.map((f) => [f.variantId, f]))
  const info = await categoryInfo(scope, cats)
  const settings = await readSettings(scope)
  const skipped: Array<{ id: string; reason: string }> = []
  const create: Row[] = []
  const update: Row[] = []
  for (const r of fresh) {
    /* A detached row keeps its status through refreshes: its reasons still block a new listing. */
    if (r.status === "blocked" || (r.status === "detached" && (r.reasons ?? []).length)) skipped.push({ id: r.id, reason: (r.reasons ?? [])[0] ?? "blocked" })
    else if (r.status === "listed" && r.remote_status !== "CLOSED") skipped.push({ id: r.id, reason: "already_listed" })
    else if (r.command_status === "PENDING") skipped.push({ id: r.id, reason: "command_pending" })
    else if (!facts.get(String(r.variant_id)) || !r.category_id) skipped.push({ id: r.id, reason: "no_category" })
    else if (r.remote_id) update.push(r)
    else create.push(r)
  }
  const proposalOf = (r: Row) => rowProposal(r, facts.get(String(r.variant_id))!, info.get(String(r.category_id))?.gpsrFree ?? false, settings.offerDefaults, o.vatRate)
  const now = new Date()
  let listed = 0
  const failures: string[] = []

  for (let i = 0; i < create.length; i += BATCH_OFFERS) {
    const batch = create.slice(i, i + BATCH_OFFERS)
    try {
      const created = await client.createOffers(batch.map(proposalOf))
      const byExternal = new Map(created.map((c) => [c.externalId, c]))
      await svc.updateVonHalskyOffers(
        batch.map((r) => {
          const c = byExternal.get(String(r.variant_id))
          if (!c) return { id: r.id, error: "The marketplace did not confirm this offer." }
          listed += 1
          return {
            id: r.id,
            status: "listed",
            remote_id: c.offerId,
            remote_status: "PENDING",
            command_id: c.commandId,
            command_kind: "create",
            command_status: "PENDING",
            command_at: now,
            pushed_price_minor: r.price_minor ?? null,
            pushed_stock: r.stock ?? null,
            listed_at: r.listed_at ?? now,
            error: null,
          }
        }),
      )
    } catch (err) {
      const message = errorText(err, scope)
      failures.push(message)
      await svc.updateVonHalskyOffers(batch.map((r) => ({ id: r.id, error: message.slice(0, 500) })))
    }
  }

  for (const r of update) {
    try {
      const p = proposalOf(r)
      const { externalId: _e, ...patch } = p
      await client.patchOffer(String(r.remote_id), patch)
      let c: CommandState | null = null
      if (r.remote_status === "CLOSED") c = await client.reopenOffer(String(r.remote_id))
      await svc.updateVonHalskyOffers({
        id: r.id,
        status: "listed",
        ...commandFields(c, "reopen", now),
        pushed_price_minor: r.price_minor ?? null,
        pushed_stock: r.stock ?? null,
        listed_at: r.listed_at ?? now,
        error: null,
      })
      listed += 1
    } catch (err) {
      const message = errorText(err, scope)
      failures.push(message)
      await svc.updateVonHalskyOffers({ id: r.id, error: message.slice(0, 500) })
    }
  }

  await logSync(scope, {
    area: "offers",
    action: "list",
    outcome: failures.length ? "error" : skipped.length ? "warning" : "ok",
    message: `${listed} offers sent to the marketplace (it checks them and publishes; the sync follows)${skipped.length ? `, ${skipped.length} skipped` : ""}${failures.length ? `. Failed: ${failures[0]}` : ""}.`,
    count: listed,
    demo: o.demo,
    refs: { offer_ids: [...create, ...update].map((r) => r.id).slice(0, 50) },
  })
  if (listed === 0 && failures.length) throw new VonHalskyFlowError(502, "list_failed", failures[0])
  const after = await rowsById(scope, fresh.map((r) => r.id))
  const thumbs = await thumbnailsOf(scope, after.map((r) => String(r.variant_id)))
  return { listed, skipped, offers: after.map((r) => toOfferDto(r, { thumbnail: thumbs.get(String(r.variant_id)) ?? null, categoryPath: r.category_id ? info.get(String(r.category_id))?.path ?? null : null })) }
}

/** Closes listed offers on the marketplace; the rows become `closed`. */
export async function unlistOffers(scope: Scope, ids: string[]): Promise<{ closed: number }> {
  const o = optionsOf(scope)
  const client = requireClient(scope)
  const svc = vonHalskySvc(scope)
  const rows = (await rowsById(scope, ids)).filter((r) => r.status === "listed" || r.status === "draft")
  let closed = 0
  const now = new Date()
  for (const r of rows) {
    try {
      const c = r.status === "listed" && r.remote_id && r.remote_status !== "CLOSED" ? await client.closeOffer(String(r.remote_id)) : null
      await svc.updateVonHalskyOffers({ id: r.id, status: "closed", ...commandFields(c, "close", now), error: null })
      closed += 1
    } catch (err) {
      const message = errorText(err, scope)
      await svc.updateVonHalskyOffers({ id: r.id, error: message.slice(0, 500) })
      await logSync(scope, { area: "offers", action: "unlist", outcome: "error", message, demo: o.demo })
    }
  }
  await logSync(scope, { area: "offers", action: "unlist", message: `${closed} offers taken off${o.demo ? " (demo)" : ""}.`, count: closed, demo: o.demo })
  return { closed }
}

/** Brings closed offers back to draft (a person lists them again, which reopens them on the marketplace). */
export async function reopenOffers(scope: Scope, ids: string[]): Promise<{ reopened: number }> {
  const svc = vonHalskySvc(scope)
  const rows = (await rowsById(scope, ids)).filter((r) => r.status === "closed")
  if (rows.length > 0) await svc.updateVonHalskyOffers(rows.map((r) => ({ id: r.id, status: "draft", error: null })))
  if (rows.length > 0) await refreshOffers(scope, { variantIds: rows.map((r) => String(r.variant_id)) })
  return { reopened: rows.length }
}

/** A fixed gross price for one offer ("129.99"), or null to go back to the markup. */
export async function setOverride(scope: Scope, id: string, value: unknown): Promise<OfferDto> {
  const svc = vonHalskySvc(scope)
  const parsed = parseOverride(value)
  if (parsed === undefined) throw new VonHalskyFlowError(400, "invalid_price", "Give a gross price above 0, like 129.99, or nothing to use the markup.")
  const [row] = await rowsById(scope, [id])
  if (!row) throw new VonHalskyFlowError(404, "not_found", "Offer not found.")
  await svc.updateVonHalskyOffers({ id, price_override_minor: parsed })
  await refreshOffers(scope, { variantIds: [String(row.variant_id)] })
  const [after] = await rowsById(scope, [id])
  await logSync(scope, { area: "offers", action: "price", message: parsed === null ? `Offer ${row.sku ?? id} back to the markup.` : `Offer ${row.sku ?? id} priced at ${(parsed / 100).toFixed(2)} PLN.`, demo: optionsOf(scope).demo })
  return toOfferDto(after ?? row)
}

/**
 * The marketplace catalog's match for an offer (by EAN, else the part
 * number, else the name). Its category is used when the offer has none
 * picked or mapped; its attribute values when the offer has none yet.
 */
export async function hintOffer(scope: Scope, id: string): Promise<HintResponse> {
  const client = requireClient(scope)
  const svc = vonHalskySvc(scope)
  const [row] = await rowsById(scope, [id])
  if (!row) throw new VonHalskyFlowError(404, "not_found", "Offer not found.")
  let hints = row.ean ? await client.hints({ ean: row.ean }) : []
  if (hints.length === 0 && row.mpn) hints = await client.hints({ mpn: row.mpn })
  if (hints.length === 0 && row.title) hints = await client.hints({ name: String(row.title).slice(0, 100) })
  const info = await categoryInfo(
    scope,
    hints.map((h) => h.categoryId).filter((x): x is string => Boolean(x)),
  )
  const best = hints[0] ?? null
  const patch: Record<string, unknown> = { hint: best ? { productId: best.productId, categoryId: best.categoryId, name: best.name, brand: best.brand } : null }
  if (best?.categoryId && (!row.category_id || row.category_source === "hint")) {
    patch.category_id = best.categoryId
    patch.category_source = "hint"
  }
  if (best && attributeValues(row.attributes).length === 0 && best.attributes.length) patch.attributes = best.attributes.map((a) => ({ id: a.id, values: a.values }))
  await svc.updateVonHalskyOffers({ id, ...patch })
  if (best?.categoryId) await attributesOf(scope, best.categoryId).catch(() => null)
  await refreshOffers(scope, { variantIds: [String(row.variant_id)] }).catch(() => undefined)
  return {
    hints: hints.slice(0, 10).map((h) => ({
      productId: h.productId,
      name: h.name,
      brand: h.brand,
      categoryId: h.categoryId,
      categoryPath: h.categoryId ? info.get(h.categoryId)?.path ?? null : null,
      ean: h.ean,
      mpn: h.mpn,
      attributes: h.attributes.length,
    })),
  }
}

/** A category a person picked for offers (a leaf), or null to go back to the mapping and the catalog. */
export async function setCategory(scope: Scope, ids: string[], categoryId: string | null): Promise<{ updated: number; sent: number; skipped: Array<{ id: string; reason: string }> }> {
  const svc = vonHalskySvc(scope)
  if (categoryId) {
    const info = await categoryInfo(scope, [categoryId])
    if (!info.get(categoryId)?.leaf) throw new VonHalskyFlowError(400, "not_leaf", "Pick a category of the lowest level (a leaf).")
    await attributesOf(scope, categoryId).catch(() => null)
  }
  const rows = await rowsById(scope, ids)
  if (rows.length === 0) return { updated: 0, sent: 0, skipped: [] }
  await svc.updateVonHalskyOffers(rows.map((r) => (categoryId ? { id: r.id, category_id: categoryId, category_source: "manual" } : { id: r.id, category_id: null, category_source: null })))
  await refreshOffers(scope, { variantIds: rows.map((r) => String(r.variant_id)) })
  // An offer already on the marketplace gets the new category like an edit
  // (a patch, or close, patch and reopen for a live one); the others wait for "List".
  const skipped: Array<{ id: string; reason: string }> = []
  const onMarketplace = (await rowsById(scope, rows.map((r) => r.id))).filter((r) => editStart(r) !== "local")
  const sent = onMarketplace.length ? await sendEdits(scope, onMarketplace.map((r) => r.id), skipped) : 0
  return { updated: rows.length, sent, skipped }
}

/** Attribute values a person typed, cut to the API's limits; `keepEmpty` keeps ids without values (a bulk edit removes them). */
function cleanAttributes(input: unknown, known: Set<string> | null, keepEmpty = false): Array<{ id: string; values: string[] }> {
  return attributeValues(input)
    .map((a) => ({ id: a.id, values: a.values.map((v) => v.trim().slice(0, 1024)).filter(Boolean).slice(0, 50) }))
    .filter((a) => (keepEmpty || a.values.length) && (!known || known.has(a.id)))
    .slice(0, 120)
}

/**
 * The attribute values of one offer: [{ id, values }]. Unknown ids of the
 * category are dropped. An offer on the marketplace gets them at once, the
 * way every edit goes (see `sendEdit`); a draft gets them with its listing.
 */
export async function setAttributes(scope: Scope, id: string, input: unknown): Promise<OfferDto> {
  const svc = vonHalskySvc(scope)
  const [row] = await rowsById(scope, [id])
  if (!row) throw new VonHalskyFlowError(404, "not_found", "Offer not found.")
  if (editStart(row) === "busy") throw new VonHalskyFlowError(409, "command_pending", "The marketplace has not finished the last change of this offer: try again in a few minutes.")
  const defs = row.category_id ? await attributesOf(scope, String(row.category_id)) : null
  const known = defs ? new Set(defs.map((d) => d.id)) : null
  await svc.updateVonHalskyOffers({ id, attributes: cleanAttributes(input, known) })
  await refreshOffers(scope, { variantIds: [String(row.variant_id)] })
  const [after] = await rowsById(scope, [id])
  if (after) await sendEditSafely(scope, after)
  const [done] = await rowsById(scope, [id])
  return toOfferDto(done ?? after ?? row)
}

/**
 * The same category parameters on many offers of ONE category (bulk): the
 * values given replace those parameters on every offer, a parameter given
 * with no values is removed, the others stay. Offers on the marketplace get
 * the change at once.
 */
export async function setAttributesMany(scope: Scope, ids: string[], input: unknown): Promise<BulkEditResponse> {
  const svc = vonHalskySvc(scope)
  const rows = await rowsById(scope, ids)
  if (rows.length === 0) throw new VonHalskyFlowError(404, "not_found", "None of the chosen offers exists.")
  const categories = new Set(rows.map((r) => r.category_id ?? null))
  if (categories.has(null)) throw new VonHalskyFlowError(400, "no_category", "Every chosen offer needs a marketplace category first.")
  if (categories.size > 1) throw new VonHalskyFlowError(400, "mixed_categories", "The chosen offers are in different categories: choose offers of one category.")
  const categoryId = String(rows[0].category_id)
  const defs = await attributesOf(scope, categoryId)
  const given = cleanAttributes(input, defs ? new Set(defs.map((d) => d.id)) : null, true)
  if (given.length === 0) throw new VonHalskyFlowError(400, "nothing_to_change", "Give at least one parameter of the category.")
  const skipped: Array<{ id: string; reason: string }> = []
  const ready = rows.filter((r) => (editStart(r) === "busy" ? (skipped.push({ id: r.id, reason: "command_pending" }), false) : true))
  if (ready.length > 0) {
    await svc.updateVonHalskyOffers(
      ready.map((r) => {
        const map = new Map(attributeValues(r.attributes).map((a) => [a.id, a.values]))
        for (const a of given) {
          if (a.values.length) map.set(a.id, a.values)
          else map.delete(a.id)
        }
        return { id: r.id, attributes: [...map].map(([id, values]) => ({ id, values })).slice(0, 120) }
      }),
    )
    await refreshOffers(scope, { variantIds: ready.map((r) => String(r.variant_id)) })
  }
  const sent = await sendEdits(scope, ready.map((r) => r.id), skipped)
  await logSync(scope, { area: "offers", action: "attributes", outcome: skipped.length ? "warning" : "ok", message: `Category parameters set on ${ready.length} offers, ${sent} sent to the marketplace${skipped.length ? `, ${skipped.length} skipped` : ""}.`, count: ready.length, demo: optionsOf(scope).demo })
  return { updated: ready.length, sent, skipped }
}

/* ------------------------------------------------------------------ */
/* Edits of offers on the marketplace                                  */
/* ------------------------------------------------------------------ */

/**
 * Sends the current edit of one row to the marketplace (see `editStart`):
 *   an offer that is not on the marketplace: nothing ("local");
 *   a live offer: closed first ("close"), the sync sends the patch when the
 *   close is done and reopens the offer after it (`continueEdit`);
 *   any other offer on the marketplace: the merge patch now ("patch").
 * Throws when the marketplace refuses the request itself.
 */
export async function sendEdit(scope: Scope, row: Row): Promise<"local" | "patch" | "close"> {
  const start = editStart(row)
  if (start === "local") return "local"
  if (start === "busy") throw new VonHalskyFlowError(409, "command_pending", "The marketplace has not finished the last change of this offer: try again in a few minutes.")
  const svc = vonHalskySvc(scope)
  const now = new Date()
  if (start === "close") {
    const c = await requireClient(scope).closeOffer(String(row.remote_id))
    if (!c) throw new VonHalskyFlowError(404, "remote_gone", "The marketplace does not know this offer any more.")
    await svc.updateVonHalskyOffers({ id: row.id, ...commandFields(c, "edit_close", now), error: null })
    return "close"
  }
  await patchStep(scope, row, start)
  return "patch"
}

/** `sendEdit` that never throws: a refusal stays on the row (and in the log) for the person to see. */
async function sendEditSafely(scope: Scope, row: Row): Promise<"local" | "patch" | "close" | "failed"> {
  try {
    return await sendEdit(scope, row)
  } catch (err) {
    const message = errorText(err, scope)
    await vonHalskySvc(scope).updateVonHalskyOffers({ id: row.id, error: message.slice(0, 500) })
    await logSync(scope, { area: "offers", action: "edit", outcome: "error", message: `Offer ${row.sku ?? row.id}: ${message}`, demo: optionsOf(scope).demo })
    return "failed"
  }
}

/** Sends the edits of these rows (read fresh); counts what went out, notes what failed. */
async function sendEdits(scope: Scope, ids: string[], skipped: Array<{ id: string; reason: string }>): Promise<number> {
  let sent = 0
  for (const r of await rowsById(scope, ids)) {
    const how = await sendEditSafely(scope, r)
    if (how === "patch" || how === "close") sent += 1
    else if (how === "failed") skipped.push({ id: r.id, reason: "send_failed" })
  }
  return sent
}

/**
 * The merge patch of an edit (`editPatchOf` of the row's proposal), followed
 * as a command of the given kind. A marketplace that answers with the offer
 * instead of a command has applied it: the row takes the offer, and a patch
 * of an offer we closed goes on at once (reopen or wait for stock).
 */
async function patchStep(scope: Scope, row: Row, kind: "patch" | "edit_patch"): Promise<void> {
  const svc = vonHalskySvc(scope)
  const proposal = (await proposalsOf(scope, [row])).get(row.id)
  if (!proposal) throw new VonHalskyFlowError(409, "no_category", "The offer has no marketplace category or its variant is gone: nothing to send.")
  const answer = await requireClient(scope).updateOffer(String(row.remote_id), editPatchOf(proposal))
  const now = new Date()
  if (answer.command) {
    await svc.updateVonHalskyOffers({ id: row.id, ...commandFields(answer.command, kind, now), error: null })
    return
  }
  if (!answer.offer) throw new VonHalskyFlowError(404, "remote_gone", "The marketplace does not know this offer any more.")
  const next = { ...row, command_kind: kind, command_status: "SUCCESS" }
  await svc.updateVonHalskyOffers({ id: row.id, ...remotePatch(next, answer.offer, now), command_kind: kind, command_status: "SUCCESS", command_at: now, error: null })
  if (kind === "edit_patch") await continueEdit(scope, { ...next, remote_status: answer.offer.status }, { status: "SUCCESS" })
}

/**
 * The next step of an edit after a command of it finished (the sync calls
 * this once the row has taken the command's result):
 *   the close is done: the patch is sent; if that request fails, the offer
 *   is reopened at once (it must not stay closed for a refused change);
 *   the patch is done or refused: the offer is reopened, or at zero stock it
 *   waits closed as a `close` of the price and stock sync.
 */
export async function continueEdit(scope: Scope, row: Row, c: Pick<CommandState, "status">): Promise<void> {
  const next = afterEditStep(row, c)
  if (next === "none") return
  const svc = vonHalskySvc(scope)
  const now = new Date()
  if (next === "park") {
    await svc.updateVonHalskyOffers({ id: row.id, command_kind: "close", command_status: "SUCCESS", command_at: now, pushed_stock: 0 })
    return
  }
  if (next === "send_patch") {
    try {
      await patchStep(scope, row, "edit_patch")
      return
    } catch (err) {
      const message = errorText(err, scope)
      await svc.updateVonHalskyOffers({ id: row.id, error: message.slice(0, 500) })
      await logSync(scope, { area: "offers", action: "edit", outcome: "error", message: `Offer ${row.sku ?? row.id}: the change was refused (${message}); the offer is reopened as it was.`, demo: optionsOf(scope).demo })
    }
  }
  const c2 = await requireClient(scope).reopenOffer(String(row.remote_id)).catch(() => null)
  if (c2) await svc.updateVonHalskyOffers({ id: row.id, ...commandFields(c2, "reopen", now), pushed_stock: null })
}

/** The editable fields of one offer as the admin shows them (Medusa's values read for the placeholders). */
async function editDto(scope: Scope, row: Row): Promise<OfferDto> {
  const o = optionsOf(scope)
  const [medusa, thumbs, settings, info] = await Promise.all([
    editableFactsOf(scope, o, [String(row.variant_id)]),
    thumbnailsOf(scope, [String(row.variant_id)]),
    readSettings(scope),
    row.category_id ? categoryInfo(scope, [String(row.category_id)]).catch(() => new Map<string, CategoryInfo>()) : Promise.resolve(new Map<string, CategoryInfo>()),
  ])
  return toOfferDto(row, {
    thumbnail: thumbs.get(String(row.variant_id)) ?? null,
    categoryPath: row.category_id ? info.get(String(row.category_id))?.path ?? null : null,
    medusa: medusa.get(String(row.variant_id)) ?? null,
    daysToShip: settings.offerDefaults.daysToShip,
  })
}

/**
 * "Edit offer": the name, the description, the photos, the package, the
 * days to ship of one offer, over Medusa's values (null goes back to
 * Medusa). Checked against the marketplace's rules first, kept on the row,
 * the row checked again, and an offer on the marketplace gets the change.
 */
export async function editOffer(scope: Scope, id: string, input: unknown): Promise<EditResponse> {
  const patch = parseOverridesPatch(input)
  if (isRefusal(patch)) throw new VonHalskyFlowError(400, patch.code, patch.message)
  const svc = vonHalskySvc(scope)
  const [row] = await rowsById(scope, [id])
  if (!row) throw new VonHalskyFlowError(404, "not_found", "Offer not found.")
  if (editStart(row) === "busy") throw new VonHalskyFlowError(409, "command_pending", "The marketplace has not finished the last change of this offer: try again in a few minutes.")
  await svc.updateVonHalskyOffers({ id, overrides: mergeOverrides(row.overrides, patch) })
  await refreshOffers(scope, { variantIds: [String(row.variant_id)] })
  const [after] = await rowsById(scope, [id])
  let sent: "local" | "patch" | "close" = "local"
  try {
    sent = await sendEdit(scope, after ?? row)
  } catch (err) {
    const message = errorText(err, scope)
    await svc.updateVonHalskyOffers({ id, error: message.slice(0, 500) })
    await logSync(scope, { area: "offers", action: "edit", outcome: "error", message: `Offer ${row.sku ?? id}: saved here, the marketplace refused it (${message}).`, demo: optionsOf(scope).demo })
    throw err instanceof VonHalskyFlowError ? err : new VonHalskyFlowError(502, "edit_failed", `Saved here, but the marketplace refused the change: ${message}`)
  }
  const fields = [...Object.keys(patch.set), ...patch.clear.map((f) => `${f} (back to Medusa)`)].join(", ")
  await logSync(scope, { area: "offers", action: "edit", message: `Offer ${row.sku ?? id} edited: ${fields}${sent === "close" ? "; closed on the marketplace, the sync patches and reopens it" : sent === "patch" ? "; sent to the marketplace" : ""}.`, demo: optionsOf(scope).demo, refs: { offer_id: id } })
  const [done] = await rowsById(scope, [id])
  return { offer: await editDto(scope, done ?? after ?? row), sent }
}

/**
 * The same edit on many offers (the bulk "Days to ship"): each offer the way
 * `editOffer` goes; one whose last change is still pending is skipped.
 */
export async function editOffers(scope: Scope, ids: string[], input: unknown): Promise<BulkEditResponse> {
  const patch = parseOverridesPatch(input)
  if (isRefusal(patch)) throw new VonHalskyFlowError(400, patch.code, patch.message)
  const svc = vonHalskySvc(scope)
  const rows = await rowsById(scope, ids)
  if (rows.length === 0) throw new VonHalskyFlowError(404, "not_found", "None of the chosen offers exists.")
  const skipped: Array<{ id: string; reason: string }> = []
  const ready = rows.filter((r) => (editStart(r) === "busy" ? (skipped.push({ id: r.id, reason: "command_pending" }), false) : true))
  if (ready.length > 0) {
    await svc.updateVonHalskyOffers(ready.map((r) => ({ id: r.id, overrides: mergeOverrides(r.overrides, patch) })))
    await refreshOffers(scope, { variantIds: ready.map((r) => String(r.variant_id)) })
  }
  const sent = await sendEdits(scope, ready.map((r) => r.id), skipped)
  const fields = [...Object.keys(patch.set), ...patch.clear.map((f) => `${f} (back to Medusa)`)].join(", ")
  await logSync(scope, { area: "offers", action: "edit", outcome: skipped.length ? "warning" : "ok", message: `${ready.length} offers edited (${fields}), ${sent} sent to the marketplace${skipped.length ? `, ${skipped.length} skipped` : ""}.`, count: ready.length, demo: optionsOf(scope).demo })
  return { updated: ready.length, sent, skipped }
}

/* ------------------------------------------------------------------ */
/* Removing from the panel, importing from the marketplace             */
/* ------------------------------------------------------------------ */

/** What a row forgets when its marketplace offer is no longer ours to follow. */
const FORGET_REMOTE = {
  remote_id: null,
  remote_status: null,
  remote_price_minor: null,
  remote_final_price_minor: null,
  remote_stock: null,
  promotion: null,
  program: null,
  validation: null,
  command_id: null,
  command_kind: null,
  command_status: null,
  command_at: null,
  pushed_price_minor: null,
  pushed_stock: null,
  image_count: null,
  published_at: null,
  listed_at: null,
  synced_at: null,
  error: null,
}

/**
 * "Remove from the panel only": the plugin forgets the marketplace offer of
 * these rows WITHOUT asking InPost anything. The offer stays as it is on
 * the marketplace (published ones keep selling); the row becomes `detached`
 * and the sync never touches it again (no price, no stock, no status) until
 * a person lists it again (a new offer) or imports it ("Import from InPost").
 * Orders of a detached offer are held until it is imported again. Closing
 * on the marketplace is the other action, "Close on InPost" (`unlistOffers`).
 */
export async function detachOffers(scope: Scope, ids: string[]): Promise<{ detached: number; skipped: Array<{ id: string; reason: string }> }> {
  const svc = vonHalskySvc(scope)
  const rows = await rowsById(scope, ids)
  const skipped: Array<{ id: string; reason: string }> = []
  const chosen = rows.filter((r) => (r.remote_id ? true : (skipped.push({ id: r.id, reason: "not_on_marketplace" }), false)))
  if (chosen.length > 0) await svc.updateVonHalskyOffers(chosen.map((r) => ({ id: r.id, status: "detached", ...FORGET_REMOTE })))
  await logSync(scope, {
    area: "offers",
    action: "detach",
    outcome: chosen.length ? "ok" : "warning",
    message: `${chosen.length} offers removed from the panel only: they stay on InPost Von Halsky as they were, the sync no longer touches them.`,
    count: chosen.length,
    demo: optionsOf(scope).demo,
    refs: { offers: chosen.slice(0, 50).map((r) => ({ id: r.id, remote_id: r.remote_id })) },
  })
  return { detached: chosen.length, skipped }
}

/** Import reads at most this many marketplace offers in one go. */
export const IMPORT_MAX = 5000

/**
 * "Import from InPost": the offers already on the marketplace (listed by
 * hand, by another tool, or removed from this panel) become rows of this
 * panel, so the price and stock sync takes them over. The catalog is read
 * first (a row per variant), then every page of the marketplace's offers;
 * each offer not linked yet is matched to a variant by its external id (our
 * variant id), then the SKU, the EAN, the manufacturer part number (see
 * `importPlan`). A linked row takes the marketplace's status, prices and
 * stock, with them as "last sent", so the next sync sends Medusa's values
 * where they differ. Offers matching nothing are reported, never invented
 * as products.
 */
export async function importOffers(scope: Scope): Promise<ImportOffersResponse> {
  const o = optionsOf(scope)
  const client = requireClient(scope)
  const svc = vonHalskySvc(scope)
  return withLock("import", async () => {
    demoClientOf(scope)?.addForeignOffer()
    await refreshOffers(scope)
    const rows: Row[] = []
    for (let skip = 0; ; skip += 1000) {
      const page = ((await svc.listVonHalskyOffers({}, { skip, take: 1000, order: { id: "ASC" }, select: ["id", "variant_id", "sku", "ean", "mpn", "remote_id", "status", "title"] })) ?? []) as Row[]
      rows.push(...page)
      if (page.length < 1000) break
    }
    const remote: RemoteOffer[] = []
    let complete = true
    for (let offset = 0; ; offset += PAGE_MAX) {
      const page = await client.listOffers({ offset, limit: PAGE_MAX })
      remote.push(...page.offers)
      if (page.offers.length < PAGE_MAX || offset + PAGE_MAX >= page.total) break
      if (remote.length >= IMPORT_MAX) {
        complete = false
        break
      }
    }
    const plan = importPlan(remote, rows as ImportRow[])
    const now = new Date()
    const byId = new Map(rows.map((r) => [r.id, r]))
    for (const x of plan.refresh) {
      const r = byId.get(x.rowId)
      if (r) await svc.updateVonHalskyOffers({ id: r.id, ...remotePatch(r, x.remote, now) })
    }
    for (const x of plan.link) {
      const r = byId.get(x.rowId)
      if (!r) continue
      const status = x.remote.status === "CLOSED" ? "closed" : "listed"
      await svc.updateVonHalskyOffers({
        id: r.id,
        ...FORGET_REMOTE,
        status,
        ...remotePatch({ ...r, status }, x.remote, now),
        /* "Last sent" is what the marketplace holds: the next sync sends Medusa's price and stock where they differ. */
        pushed_price_minor: x.remote.grossPriceMinor,
        pushed_stock: x.remote.stock,
        listed_at: x.remote.createdAt ? new Date(x.remote.createdAt) : now,
        demo: o.demo,
      })
    }
    const result: ImportOffersResponse = { read: remote.length, linked: plan.link.length, updated: plan.refresh.length, unmatched: plan.unmatched.slice(0, 200), complete }
    await logSync(scope, {
      area: "offers",
      action: "import",
      outcome: plan.unmatched.length ? "warning" : "ok",
      message: `Import from InPost Von Halsky: ${result.read} offers read, ${result.linked} linked to variants, ${result.updated} already linked${plan.unmatched.length ? `, ${plan.unmatched.length} match no variant (nothing was created)` : ""}${complete ? "" : " (stopped at the limit)"}.`,
      count: result.linked,
      demo: o.demo,
      refs: { linked: plan.link.slice(0, 50).map((x) => ({ id: x.rowId, remote_id: x.remote.id, by: x.by })) },
    })
    return result
  })
}

export type { PromotionInput }

/** Validates a promotion a person typed; the API rounds the times down to whole minutes. */
export function parsePromotion(v: unknown): PromotionInput | null {
  if (!v || typeof v !== "object") return null
  const p = v as Record<string, unknown>
  const mode = p.mode === "PERCENTAGE" || p.mode === "FIXED_PRICE" || p.mode === "AMOUNT" ? p.mode : null
  const value = Number(typeof p.value === "string" ? p.value.replace(",", ".") : p.value)
  const start = typeof p.start === "string" ? Date.parse(p.start) : NaN
  const end = typeof p.end === "string" ? Date.parse(p.end) : NaN
  if (!mode || !Number.isFinite(value) || value <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  if (mode === "PERCENTAGE" && value >= 100) return null
  return { mode, value: Math.round(value * 100) / 100, start: new Date(start).toISOString(), end: new Date(end).toISOString() }
}

/** A promotion on listed offers, or null to end it. */
export async function setPromotion(scope: Scope, ids: string[], input: unknown): Promise<{ sent: number; failed: number }> {
  const o = optionsOf(scope)
  const client = requireClient(scope)
  const svc = vonHalskySvc(scope)
  const promo = input === null ? null : parsePromotion(input)
  if (input !== null && !promo) throw new VonHalskyFlowError(400, "invalid_promotion", "Give a mode, a value above 0 (a percentage below 100) and an end after the start.")
  const rows = (await rowsById(scope, ids)).filter((r) => r.status === "listed" && r.remote_id)
  let sent = 0
  let failed = 0
  const now = new Date()
  for (const r of rows) {
    try {
      const c = promo ? await client.setPromotion(String(r.remote_id), promo) : await client.deletePromotion(String(r.remote_id))
      await svc.updateVonHalskyOffers({ id: r.id, ...commandFields(c, "promotion", now), error: null })
      sent += 1
    } catch (err) {
      failed += 1
      await svc.updateVonHalskyOffers({ id: r.id, error: errorText(err, scope).slice(0, 500) })
    }
  }
  await logSync(scope, { area: "offers", action: "promotion", outcome: failed ? "warning" : "ok", message: promo ? `Promotion (${promo.mode} ${promo.value}) sent for ${sent} offers${failed ? `, ${failed} failed` : ""}.` : `Promotion ended on ${sent} offers.`, count: sent, demo: o.demo })
  return { sent, failed }
}

/** Joins or leaves the marketplace's price program ("Cenowy Sztos") for listed offers. */
export async function setProgram(scope: Scope, ids: string[], mode: unknown): Promise<{ sent: number }> {
  if (mode !== "IN" && mode !== "OUT") throw new VonHalskyFlowError(400, "invalid_mode", "The price program mode is IN or OUT.")
  const o = optionsOf(scope)
  const client = requireClient(scope)
  const svc = vonHalskySvc(scope)
  const rows = (await rowsById(scope, ids)).filter((r) => r.status === "listed" && r.remote_id)
  if (rows.length === 0) return { sent: 0 }
  const commands = await client.setProgram(rows.map((r) => ({ offerId: String(r.remote_id), mode })))
  const byOffer = new Map(commands.map((c) => [c.offerId, c]))
  const now = new Date()
  await svc.updateVonHalskyOffers(rows.map((r) => ({ id: r.id, ...commandFields(byOffer.get(String(r.remote_id)) ?? null, "program", now) })))
  await logSync(scope, { area: "offers", action: "program", message: `${rows.length} offers ${mode === "IN" ? "joined" : "left"} the price program.`, count: rows.length, demo: o.demo })
  return { sent: rows.length }
}
