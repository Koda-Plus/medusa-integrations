/**
 * THE OFFERS: built from the Medusa catalog, listed and taken off by a
 * person, priced with the channel markup, stocked from Medusa inventory.
 *
 *   refreshOffers   reads the catalog and writes one row per variant: the
 *                   matching keys, the GPSR manufacturer, the reasons it
 *                   cannot be listed, the channel price and the quantity.
 *                   It never lists anything by itself.
 *   listOffers      the "List selected" action: offers without a blocking
 *                   reason go to the marketplace (demo: marked listed in our
 *                   table; sandbox and live: refused while the API is pending).
 *   unlistOffers    takes listed offers off.
 *   setOverride     a fixed gross price for one offer, or back to the markup.
 *
 * THE COMPLETE-READ RULE: a partial read of the catalog adds and updates
 * rows, it never closes the offer of a variant it did not see.
 */

import { eligibility, nextOfferStatus, type VariantFacts } from "../../modules/vonhalsky/lib/eligibility"
import { isPending, type OfferPayload } from "../../modules/vonhalsky/lib/client"
import { channelPriceMinor, parseOverride } from "../../modules/vonhalsky/lib/pricing"
import { logSync, readSettings, toOfferDto, vonHalskySvc, type Scope } from "../../modules/vonhalsky/lib/store"
import type { OfferDto } from "../../modules/vonhalsky/lib/contract"
import { loadFacts } from "./catalog"
import { VonHalskyFlowError, errorText, optionsOf, requireClient, withLock } from "./runtime"

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

/** The row a variant's facts make, keeping what a person set (override, closed, listed). */
export function offerPatch(f: VariantFacts, existing: Row | null, pricing: { includesTax: boolean; vatRate: number; markupPercent: number }, demo: boolean): Record<string, unknown> {
  const e = eligibility(f)
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
    price_minor: channelPriceMinor({ baseMinor: f.basePriceMinor, includesTax: pricing.includesTax, vatRate: pricing.vatRate, markupPercent: pricing.markupPercent, overrideMinor: override }),
    currency_code: "pln",
    stock: f.stock,
    demo: existing ? existing.demo === true : demo,
    ...(status === "listed" && demo ? { remote_status: f.stock > 0 ? "PUBLISHED" : "SOLDOUT", synced_at: new Date() } : {}),
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
    const creates: Record<string, unknown>[] = []
    const updates: Record<string, unknown>[] = []
    let blocked = 0
    for (const f of read.facts) {
      const row = existing.get(f.variantId) ?? null
      const patch = offerPatch(f, row, pricing, o.demo)
      if (patch.status === "blocked") blocked += 1
      if (row) updates.push({ id: row.id, ...patch, error: patch.status === "blocked" ? null : row.error ?? null })
      else creates.push(patch)
    }
    for (let i = 0; i < creates.length; i += 200) await svc.createVonHalskyOffers(creates.slice(i, i + 200))
    for (let i = 0; i < updates.length; i += 200) await svc.updateVonHalskyOffers(updates.slice(i, i + 200))
    let closed = 0
    if (read.complete) {
      const seen = new Set(read.facts.map((f) => f.variantId))
      const gone = [...existing.values()].filter((r) => !seen.has(String(r.variant_id)) && r.status !== "closed")
      if (gone.length > 0) {
        await svc.updateVonHalskyOffers(gone.map((r) => ({ id: r.id, status: "closed", error: "The variant no longer exists in Medusa." })))
        closed = gone.length
      }
    }
    const result = { read: read.facts.length, created: creates.length, updated: updates.length, blocked, closed, complete: read.complete }
    await logSync(scope, {
      area: "offers",
      action: "refresh",
      outcome: blocked > 0 ? "warning" : "ok",
      message: `Read ${result.read} variants: ${result.created} new offers, ${result.updated} updated, ${blocked} cannot be listed${closed ? `, ${closed} closed (variant gone)` : ""}${read.complete ? "" : " (partial read: nothing was closed)"}.`,
      count: result.read,
      demo: o.demo,
    })
    return result
  })
}

function payloadOf(row: Row, facts: { images: string[]; manufacturer: OfferPayload["manufacturer"] }): OfferPayload {
  return {
    externalId: String(row.variant_id),
    sku: row.sku ?? null,
    title: String(row.title ?? ""),
    ean: String(row.ean ?? ""),
    brand: String(row.brand ?? ""),
    mpn: row.mpn ?? null,
    grossPriceMinor: Number(row.price_minor) || 0,
    currency: "PLN",
    quantity: Number(row.stock) || 0,
    images: facts.images,
    manufacturer: facts.manufacturer,
  }
}

export interface ListResult {
  listed: number
  skipped: Array<{ id: string; reason: string }>
  offers: OfferDto[]
}

/**
 * "List selected": the chosen offers, read fresh from the catalog first
 * (a fix made a minute ago counts), go to the marketplace. Blocked ones are
 * skipped with their reason.
 */
export async function listOffers(scope: Scope, ids: string[]): Promise<ListResult> {
  const o = optionsOf(scope)
  const client = requireClient(scope)
  const svc = vonHalskySvc(scope)
  const chosen = ((await svc.listVonHalskyOffers({ id: ids.slice(0, 200) }, { take: 200 })) ?? []) as Row[]
  if (chosen.length === 0) throw new VonHalskyFlowError(404, "not_found", "None of the chosen offers exists.")
  const variantIds = chosen.map((r) => String(r.variant_id))
  await refreshOffers(scope, { variantIds })
  const read = await loadFacts(scope, o, { variantIds })
  const factsByVariant = new Map(read.facts.map((f) => [f.variantId, f]))
  const fresh = ((await svc.listVonHalskyOffers({ id: chosen.map((r) => r.id) }, { take: 200 })) ?? []) as Row[]
  const skipped: Array<{ id: string; reason: string }> = []
  const ready: Row[] = []
  for (const r of fresh) {
    if (r.status === "blocked") skipped.push({ id: r.id, reason: (r.reasons ?? [])[0] ?? "blocked" })
    else if (r.status === "listed") skipped.push({ id: r.id, reason: "already_listed" })
    else if (!factsByVariant.get(String(r.variant_id))?.manufacturer) skipped.push({ id: r.id, reason: "no_gpsr" })
    else ready.push(r)
  }
  if (ready.length === 0) {
    return { listed: 0, skipped, offers: fresh.map((r) => toOfferDto(r)) }
  }
  const payloads = ready.map((r) => {
    const f = factsByVariant.get(String(r.variant_id))!
    const m = f.manufacturer!
    return payloadOf(r, { images: f.thumbnail ? [f.thumbnail] : [], manufacturer: { name: m.name, email: m.email, address: m.address, phone: m.phone } })
  })
  try {
    const results = await client.upsertOffers(payloads)
    const byExternal = new Map(results.map((x) => [x.externalId, x]))
    const now = new Date()
    await svc.updateVonHalskyOffers(
      ready.map((r) => {
        const x = byExternal.get(String(r.variant_id))
        return { id: r.id, status: "listed", remote_id: x?.remoteId ?? r.remote_id ?? null, remote_status: x?.remoteStatus ?? null, listed_at: r.listed_at ?? now, synced_at: now, error: null }
      }),
    )
    await logSync(scope, {
      area: "offers",
      action: "list",
      message: `${ready.length} offers listed${o.demo ? " (demo: marked listed here, nothing was sent)" : ""}${skipped.length ? `, ${skipped.length} skipped` : ""}.`,
      count: ready.length,
      demo: o.demo,
      refs: { offer_ids: ready.map((r) => r.id).slice(0, 50) },
    })
  } catch (err) {
    const message = errorText(err, scope)
    await svc.updateVonHalskyOffers(ready.map((r) => ({ id: r.id, error: message.slice(0, 500) })))
    await logSync(scope, { area: "offers", action: "list", outcome: isPending(err) ? "warning" : "error", message, count: ready.length, demo: o.demo })
    if (isPending(err)) throw new VonHalskyFlowError(501, "api_pending", message)
    throw new VonHalskyFlowError(502, "list_failed", message)
  }
  const after = ((await svc.listVonHalskyOffers({ id: fresh.map((r) => r.id) }, { take: 200 })) ?? []) as Row[]
  return { listed: ready.length, skipped, offers: after.map((r) => toOfferDto(r)) }
}

/** Takes listed offers off the marketplace (demo: marked closed here). */
export async function unlistOffers(scope: Scope, ids: string[]): Promise<{ closed: number }> {
  const o = optionsOf(scope)
  const client = requireClient(scope)
  const svc = vonHalskySvc(scope)
  const rows = (((await svc.listVonHalskyOffers({ id: ids.slice(0, 200) }, { take: 200 })) ?? []) as Row[]).filter((r) => r.status === "listed" || r.status === "draft")
  let closed = 0
  for (const r of rows) {
    try {
      if (r.status === "listed" && r.remote_id) await client.closeOffer(String(r.remote_id))
      await svc.updateVonHalskyOffers({ id: r.id, status: "closed", remote_status: r.status === "listed" ? "CLOSED" : r.remote_status ?? null, error: null })
      closed += 1
    } catch (err) {
      const message = errorText(err, scope)
      await svc.updateVonHalskyOffers({ id: r.id, error: message.slice(0, 500) })
      await logSync(scope, { area: "offers", action: "unlist", outcome: isPending(err) ? "warning" : "error", message, demo: o.demo })
      if (isPending(err)) throw new VonHalskyFlowError(501, "api_pending", message)
    }
  }
  await logSync(scope, { area: "offers", action: "unlist", message: `${closed} offers taken off${o.demo ? " (demo)" : ""}.`, count: closed, demo: o.demo })
  return { closed }
}

/** Brings closed offers back to draft (a person lists them again). */
export async function reopenOffers(scope: Scope, ids: string[]): Promise<{ reopened: number }> {
  const svc = vonHalskySvc(scope)
  const rows = (((await svc.listVonHalskyOffers({ id: ids.slice(0, 200) }, { take: 200 })) ?? []) as Row[]).filter((r) => r.status === "closed")
  if (rows.length > 0) await svc.updateVonHalskyOffers(rows.map((r) => ({ id: r.id, status: "draft", error: null })))
  if (rows.length > 0) await refreshOffers(scope, { variantIds: rows.map((r) => String(r.variant_id)) })
  return { reopened: rows.length }
}

/** A fixed gross price for one offer ("129.99"), or null to go back to the markup. */
export async function setOverride(scope: Scope, id: string, value: unknown): Promise<OfferDto> {
  const svc = vonHalskySvc(scope)
  const parsed = parseOverride(value)
  if (parsed === undefined) throw new VonHalskyFlowError(400, "invalid_price", "Give a gross price above 0, like 129.99, or nothing to use the markup.")
  const [row] = ((await svc.listVonHalskyOffers({ id }, { take: 1 })) ?? []) as Row[]
  if (!row) throw new VonHalskyFlowError(404, "not_found", "Offer not found.")
  await svc.updateVonHalskyOffers({ id, price_override_minor: parsed })
  await refreshOffers(scope, { variantIds: [String(row.variant_id)] })
  const [after] = ((await svc.listVonHalskyOffers({ id }, { take: 1 })) ?? []) as Row[]
  await logSync(scope, { area: "offers", action: "price", message: parsed === null ? `Offer ${row.sku ?? id} back to the markup.` : `Offer ${row.sku ?? id} priced at ${(parsed / 100).toFixed(2)} PLN.`, demo: optionsOf(scope).demo })
  return toOfferDto(after ?? row)
}
