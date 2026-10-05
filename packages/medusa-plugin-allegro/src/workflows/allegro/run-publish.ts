/**
 * PUBLISH BY EAN: draft offers for variants with an EAN and no offer.
 *
 *   plan     variants with a valid GTIN and no Allegro offer are looked up in
 *            the Allegro catalog (`GET /sale/products?phrase=&mode=GTIN`, at
 *            most 30 new EANs a run, answers cached for a week); exactly one
 *            catalog product makes a plan line, anything else is a reason;
 *   apply    an armed publish writer looks the signature up first
 *            (`GET /sale/offers?external.id=`), and only when nothing has it
 *            sends `POST /sale/product-offers` as a DRAFT (`INACTIVE`). The
 *            seller checks and activates it on Allegro. The plugin never
 *            activates an offer (the write barrier refuses it).
 */

import { randomUUID } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import type AllegroModuleService from "../../modules/allegro/service"
import { searchProductsByEan } from "../../modules/allegro/lib/api"
import { AllegroApiError } from "../../modules/allegro/lib/client"
import { apiGet, apiSend, isConnected } from "../../modules/allegro/lib/connection"
import { RUN_LEASE_MS } from "../../modules/allegro/lib/constants"
import { demoEan, demoProductsRaw } from "../../modules/allegro/lib/demo-stream"
import type { PlanItemRow } from "../../modules/allegro/lib/dto"
import { publishProblems } from "../../modules/allegro/lib/options"
import { catalogMatchFromApi, draftOfferBody, planPublish, validGtin, type CatalogMatch } from "../../modules/allegro/lib/publish"
import { releaseLease, takeLease } from "../../modules/allegro/lib/store"
import { loadCatalog, loadPublishCandidates, loadVariantPrices } from "./catalog"
import { demoPicked, updateOverlay } from "./demo-sim"
import { failurePatch, loadPlanRows, planSummary, savePlan, setPlanSummary, updatePlanRows } from "./plans"
import { allegroOf, errorText, exclusive, getState, queryOf, recordRun, setState, sqlOf } from "./runtime"
import { skippedResult, type WriterRunInput, type WriterRunResult } from "./run-stock"
import { armedWriters, recordOutcome, touchWriterRun } from "./writers"

/* One catalog cache per mode: simulated matches must never feed a real account. */
const cacheId = (demo: boolean): string => (demo ? "ean_cache:demo" : "ean_cache")
const CACHE_DAYS = 7
const SEARCHES_PER_RUN = 30

type EanCache = Record<string, CatalogMatch & { at: string }>

async function applyPublish(svc: AllegroModuleService, demo: boolean): Promise<{ applied: number; failed: number; message: string | null }> {
  const rows = (await loadPlanRows(svc, "publish")).filter((r) => r.status === "planned" && Boolean(r.demo) === demo)
  if (rows.length === 0) return { applied: 0, failed: 0, message: null }
  const o = svc.getOptions()
  if (publishProblems(o).length > 0 || !o.publish.location || !o.publish.shippingRatesId) {
    return { applied: 0, failed: 0, message: `Missing options: ${publishProblems(o).join(", ")}.` }
  }
  const updates: Array<Record<string, unknown> & { id: string }> = []
  let applied = 0
  let failed = 0
  let message: string | null = null
  for (const row of rows) {
    const armed = await armedWriters(svc)
    if (!armed.has("publish")) {
      message = "The publish writer was disarmed during the run; the rest waits."
      break
    }
    const sku = row.sku ?? ""
    const target = (row.target ?? {}) as { catalogProductId?: string; price?: { amount: string; currency: string } | null; quantity?: number | null }
    if (demo) {
      const offerId = String(18_000_000_000 + Math.floor(Math.random() * 900_000_000))
      await updateOverlay(svc, (ov) => {
        ov.drafts[row.target_key] = { offerId, sku, name: row.title ?? sku, price: target.price ?? null, available: Math.max(1, Number(target.quantity ?? 1)), createdAt: new Date().toISOString() }
      })
      updates.push({ id: row.id, status: "applied", applied_at: new Date(), last_error: null, command_id: offerId, failures: 0 })
      applied += 1
      continue
    }
    try {
      /* Lookup before create: an offer with this signature means the draft (or an offer) is there already. */
      const found = await apiGet<{ offers?: Array<{ id?: string }> }>(svc, "/sale/offers", { "external.id": sku, limit: "10" })
      const existing = (found.offers ?? []).find((x) => x?.id)
      if (existing?.id) {
        updates.push({ id: row.id, status: "applied", applied_at: new Date(), last_error: "An offer with this signature already exists; nothing was created.", command_id: existing.id })
        continue
      }
      const res = await apiSend<{ id?: string }>(svc, {
        method: "POST",
        path: "/sale/product-offers",
        json: draftOfferBody(
          { catalogProductId: target.catalogProductId ?? null, price: target.price ?? null, quantity: target.quantity ?? 1, sku },
          { shippingRatesId: o.publish.shippingRatesId, location: o.publish.location, invoice: o.publish.invoice },
        ),
        idempotent: false,
        writer: "publish",
        armed,
      })
      updates.push({ id: row.id, status: "applied", applied_at: new Date(), last_error: res.status === 202 ? "Accepted; Allegro finishes the draft in the background." : null, command_id: res.data?.id ?? null, failures: 0 })
      applied += 1
      await recordOutcome(svc, "publish", { kind: "ok" })
    } catch (err) {
      const text = errorText(svc, err)
      const unclear = (err as { name?: string })?.name === "AllegroUnclearError"
      const status = err instanceof AllegroApiError ? err.status : 0
      if (unclear) {
        updates.push({ id: row.id, status: "unknown", last_error: `${text} The next run looks the signature up before anything is created again.` })
        await recordOutcome(svc, "publish", { kind: "systemic", message: text })
      } else if (status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429) {
        failed += 1
        updates.push({ id: row.id, ...failurePatch(row as PlanItemRow, text) })
        await recordOutcome(svc, "publish", { kind: "item", message: text })
      } else {
        failed += 1
        updates.push({ id: row.id, status: "failed", last_error: text })
        if (await recordOutcome(svc, "publish", { kind: "systemic", message: text })) {
          message = "The circuit breaker disarmed the publish writer."
          break
        }
      }
    }
  }
  await updatePlanRows(svc, updates)
  return { applied, failed, message }
}

export async function runPublish(container: MedusaContainer, input: WriterRunInput = {}): Promise<WriterRunResult> {
  const result = await exclusive("publish", async () => {
    const svc = allegroOf(container)
    const o = svc.getOptions()
    const mode = input.mode ?? "auto"
    const startedAt = new Date()
    if (!o.demo) {
      if (!svc.isConfigured()) return skippedResult("not_configured")
      if (!(await isConnected(svc))) return skippedResult("not_connected")
    }
    const sql = sqlOf(container)
    const owner = randomUUID()
    if (sql && !(await takeLease(sql, "publish", owner, RUN_LEASE_MS).catch(() => true))) return skippedResult("lease", "Another process is planning drafts.")
    try {
      const query = queryOf(container)
      const candidates = await loadPublishCandidates(query)
      const stock = await loadCatalog(query, o.stockLocationIds)
      const available = new Map(stock.map((v) => [v.id, v.available]))
      const offers = (await svc.listAllegroOffers({ demo: o.demo, variant_id: { $ne: null } } as never, { take: null, select: ["variant_id"] })) as unknown as Array<{ variant_id: string }>
      const linked = new Set(offers.map((r) => r.variant_id))
      /* Demo: the variants the demo account does not list get a simulated EAN, so the plan has something to show. */
      const demoIds = o.demo ? new Set(demoPicked(stock).map((v) => v.id)) : new Set<string>()
      const withEan = candidates
        .filter((c) => !linked.has(c.id))
        .map((c) => ({ ...c, ean: validGtin(c.ean) ?? (o.demo && !demoIds.has(c.id) ? demoEan(c.sku) : null) }))
        .filter((c) => c.ean)
        .slice(0, 500)

      const cache: EanCache = (await getState<EanCache>(svc, cacheId(o.demo))) ?? {}
      const fresh = (at: string) => Date.now() - Date.parse(at) < CACHE_DAYS * 24 * 60 * 60 * 1000
      let searches = 0
      const matches = new Map<string, CatalogMatch>()
      for (const c of withEan) {
        const ean = c.ean as string
        const hit = cache[ean]
        if (hit && fresh(hit.at)) {
          matches.set(ean, hit)
          continue
        }
        if (searches >= SEARCHES_PER_RUN) continue
        searches += 1
        try {
          const raw = o.demo ? demoProductsRaw(ean, c.title) : await searchProductsByEan(svc, ean)
          const match = catalogMatchFromApi(raw)
          matches.set(ean, match)
          cache[ean] = { ...match, at: new Date().toISOString() }
        } catch {
          matches.set(ean, { status: "failed", productId: null, productName: null, categoryId: null })
        }
      }
      await setState(svc, cacheId(o.demo), Object.fromEntries(Object.entries(cache).filter(([, v]) => fresh(v.at))))

      const prices = await loadVariantPrices(
        query,
        withEan.map((c) => c.id),
        null,
      )
      const rows = await loadPlanRows(svc, "publish")
      const quarantined = new Set(rows.filter((r) => r.status === "quarantined").map((r) => r.target_key))
      const plan = planPublish({
        variants: withEan.map((c) => {
          const pln = prices.get(c.id)?.get("PLN")
          return { id: c.id, sku: c.sku, productId: c.productId, title: c.title, ean: c.ean, price: pln ? { value: pln, currency: "PLN" } : null, available: available.get(c.id) ?? null }
        }),
        linked,
        matches,
        optionsMissing: o.demo ? [] : publishProblems(o),
        cap: o.publish.cap,
        quarantined,
      })
      await savePlan(
        svc,
        "publish",
        plan.map((e) => ({
          targetKey: e.variantId,
          allegroId: null,
          variantId: e.variantId,
          productId: e.productId,
          sku: e.sku,
          title: e.title,
          action: e.reason === "create" ? "create" : "none",
          reason: e.reason,
          status: e.status,
          current: { ean: e.ean, simulatedEan: o.demo && !validGtin(candidates.find((c) => c.id === e.variantId)?.ean ?? null) ? true : undefined },
          target: e.catalogProductId ? { catalogProductId: e.catalogProductId, catalogName: e.catalogName, price: e.price, quantity: e.quantity } : null,
        })),
        o.demo,
      )
      const counts: Record<string, number> = {}
      for (const e of plan) counts[e.status] = (counts[e.status] ?? 0) + 1
      await setPlanSummary(svc, "publish", { plannedAt: new Date().toISOString(), refused: null, counts })

      const armed = await armedWriters(svc)
      const wantApply = mode === "apply" || (mode === "auto" && armed.has("publish"))
      let applied = 0
      let failed = 0
      let message: string | null = null
      if (wantApply) {
        if (!armed.has("publish")) message = "The publish writer is not armed: this was a plan only."
        else {
          await touchWriterRun(svc, "publish")
          const r = await applyPublish(svc, o.demo)
          applied = r.applied
          failed = r.failed
          message = r.message
          await setPlanSummary(svc, "publish", { lastApply: { at: new Date().toISOString(), applied, failed, message } })
        }
      }
      const run = await recordRun(svc, {
        kind: "publish",
        source: o.demo ? "demo" : "api",
        trigger: input.trigger ?? "manual",
        status: failed > 0 ? "partial" : "ok",
        dryRun: !(wantApply && armed.has("publish")),
        items: plan.length,
        created: applied,
        issues: failed,
        statuses: counts,
        message,
        startedAt,
      })
      return { skipped: null, summary: await planSummary(svc, "publish"), applied, failed, message, run }
    } finally {
      if (sql) await releaseLease(sql, "publish", owner).catch(() => undefined)
    }
  })
  return result ?? skippedResult("running")
}
