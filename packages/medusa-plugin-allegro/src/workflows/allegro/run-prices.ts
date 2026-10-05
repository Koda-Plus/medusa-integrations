/**
 * THE PRICE PUSH: the Medusa price of a variant to the Buy Now price of its
 * primary live Allegro offer, inside the floor and ceiling from metadata.
 * PLAN FIRST, always; apply only when the prices writer is armed.
 *
 * Prices are re-read from Allegro right before the command: a price someone
 * changed since the plan is planned again, never overwritten blindly.
 */

import { randomUUID } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import type AllegroModuleService from "../../modules/allegro/service"
import { readOffersByIds } from "../../modules/allegro/lib/api"
import { isConnected } from "../../modules/allegro/lib/connection"
import { commandVerdict, groupForCommands, priceCommandBody } from "../../modules/allegro/lib/commands"
import { COMMAND_MAX_OFFERS, RUN_LEASE_MS } from "../../modules/allegro/lib/constants"
import type { OfferRow, PlanItemRow } from "../../modules/allegro/lib/dto"
import { offersFromApi } from "../../modules/allegro/lib/offers"
import { planPrices, recheckPrice, type PriceBounds } from "../../modules/allegro/lib/price-plan"
import { releaseLease, takeLease } from "../../modules/allegro/lib/store"
import { loadCatalog, loadVariantBounds, loadVariantPrices } from "./catalog"
import { runCommand, simulatedCommand } from "./commands-run"
import { demoOffersRaw, loadOverlay, updateOverlay } from "./demo-sim"
import { failurePatch, loadPlanRows, planSummary, savePlan, setPlanSummary, updatePlanRows } from "./plans"
import { allegroOf, errorText, exclusive, queryOf, recordRun, sqlOf } from "./runtime"
import { skippedResult, type WriterRunInput, type WriterRunResult } from "./run-stock"
import { armedWriters, recordOutcome, touchWriterRun } from "./writers"

/**
 * Demo floors and ceilings: a store that never set price bounds still sees a
 * working plan in the demo, with bounds around its own price. Real stores
 * set `allegro_price_min` and `allegro_price_max` in variant metadata.
 */
function demoBounds(prices: Map<string, Map<string, number>>): Map<string, PriceBounds> {
  const out = new Map<string, PriceBounds>()
  for (const [id, byCurrency] of prices) {
    const value = byCurrency.get("PLN") ?? [...byCurrency.values()][0]
    if (value) out.set(id, { min: Math.floor(value * 0.85 * 100) / 100, max: Math.ceil(value * 1.25 * 100) / 100 })
  }
  return out
}

async function applyPrices(container: MedusaContainer, svc: AllegroModuleService, demo: boolean): Promise<{ applied: number; failed: number; message: string | null }> {
  const rows = (await loadPlanRows(svc, "prices")).filter((r) => r.status === "planned" && r.allegro_id && Boolean(r.demo) === demo)
  if (rows.length === 0) return { applied: 0, failed: 0, message: null }
  let armed = await armedWriters(svc)
  if (!armed.has("prices")) return { applied: 0, failed: 0, message: "The prices writer is not armed." }

  const ids = rows.map((r) => r.allegro_id as string)
  let fresh: Map<string, { status: string; price: { value: number; currency: string } | null }>
  try {
    if (demo) {
      const query = queryOf(container)
      const variants = await loadCatalog(query, svc.getOptions().stockLocationIds)
      const parsed = offersFromApi(await demoOffersRaw(query, variants, await loadOverlay(svc))).offers
      fresh = new Map(parsed.filter((o) => ids.includes(o.allegroId)).map((o) => [o.allegroId, o]))
    } else {
      fresh = await readOffersByIds(svc, ids)
    }
  } catch (err) {
    const message = `Re-reading the planned offers failed, nothing was sent: ${errorText(svc, err)}`
    await recordOutcome(svc, "prices", { kind: "systemic", message })
    return { applied: 0, failed: 0, message }
  }

  const updates: Array<Record<string, unknown> & { id: string }> = []
  const go: PlanItemRow[] = []
  for (const r of rows) {
    const target = r.target as { amount: string; currency: string } | null
    if (target && recheckPrice(target, fresh.get(r.allegro_id as string) ?? null)) go.push(r)
    else updates.push({ id: r.id, status: "skipped", last_error: "The price changed on Allegro since the plan (or the offer is not live); planned again on the next run." })
  }
  const byOffer = new Map(go.map((r) => [r.allegro_id as string, r]))
  const groups = groupForCommands(
    go.map((r) => {
      const t = r.target as { amount: string; currency: string }
      return { offerId: r.allegro_id as string, key: `${t.amount}|${t.currency}` }
    }),
    COMMAND_MAX_OFFERS,
  )

  let applied = 0
  let failed = 0
  let message: string | null = null
  const changes: Array<{ allegroId: string; amount: string; currency: string }> = []
  for (const group of groups) {
    armed = await armedWriters(svc)
    if (!armed.has("prices")) {
      message = "The prices writer was disarmed during the run; the rest waits."
      break
    }
    const [amount, currency] = group.key.split("|")
    const spec = { path: "/sale/offer-price-change-commands", body: priceCommandBody(amount, currency, group.offerIds), offerIds: group.offerIds }
    const result = demo ? simulatedCommand(spec) : await runCommand(svc, "prices", armed, spec)
    if (result.error) {
      for (const id of group.offerIds) {
        const row = byOffer.get(id) as PlanItemRow
        updates.push({ id: row.id, status: result.unclear ? "unknown" : "failed", last_error: result.error, command_id: result.commandId })
      }
      failed += group.offerIds.length
      const tripped = await recordOutcome(svc, "prices", { kind: "systemic", message: result.error })
      if (tripped || result.rateLimited) {
        message = tripped ? "The circuit breaker disarmed the prices writer." : "Allegro asked to slow down (429); the rest waits for the next run."
        break
      }
      continue
    }
    const tasks = new Map(result.tasks.map((t) => [t.offerId, t]))
    for (const id of group.offerIds) {
      const row = byOffer.get(id) as PlanItemRow
      const task = tasks.get(id)
      if (task?.status === "SUCCESS") {
        applied += 1
        changes.push({ allegroId: id, amount, currency })
        updates.push({ id: row.id, status: "applied", applied_at: new Date(), command_id: result.commandId, last_error: null, failures: 0 })
      } else if (task?.status === "FAIL") {
        failed += 1
        updates.push({ id: row.id, ...failurePatch(row, task.message ?? "Allegro refused the price."), command_id: result.commandId })
      } else {
        updates.push({ id: row.id, status: "unknown", command_id: result.commandId, last_error: "Allegro had not finished this change when we looked; the next run re-reads the offer." })
      }
    }
    const verdict = commandVerdict(result.tasks)
    const tripped = await recordOutcome(
      svc,
      "prices",
      verdict === "all_failed" ? { kind: "systemic", message: `Every offer of a command failed: ${result.tasks[0]?.message ?? "no reason given"}` } : { kind: "ok" },
    )
    if (tripped) {
      message = "The circuit breaker disarmed the prices writer."
      break
    }
  }
  await updatePlanRows(svc, updates)
  if (changes.length > 0) {
    if (demo) {
      await updateOverlay(svc, (o) => {
        for (const c of changes) o.offers[c.allegroId] = { ...(o.offers[c.allegroId] ?? {}), price: { amount: c.amount, currency: c.currency } }
      })
    }
    const offerRows = (await svc.listAllegroOffers({ allegro_id: changes.map((c) => c.allegroId), demo } as never, { take: null, select: ["id", "allegro_id"] })) as unknown as Array<{
      id: string
      allegro_id: string
    }>
    const byAllegro = new Map(offerRows.map((r) => [r.allegro_id, r.id]))
    const patches = changes
      .filter((c) => byAllegro.has(c.allegroId))
      .map((c) => ({ id: byAllegro.get(c.allegroId) as string, price: { value: Number(c.amount), currency: c.currency } }))
    if (patches.length > 0) await svc.updateAllegroOffers(patches as never)
  }
  return { applied, failed, message }
}

export async function runPricePush(container: MedusaContainer, input: WriterRunInput = {}): Promise<WriterRunResult> {
  const result = await exclusive("prices", async () => {
    const svc = allegroOf(container)
    const o = svc.getOptions()
    const trigger = input.trigger ?? "manual"
    const mode = input.mode ?? "auto"
    const startedAt = new Date()
    if (!o.demo) {
      if (!svc.isConfigured()) return skippedResult("not_configured")
      if (!(await isConnected(svc))) return skippedResult("not_connected")
    }
    const sql = sqlOf(container)
    const owner = randomUUID()
    if (sql && !(await takeLease(sql, "prices", owner, RUN_LEASE_MS).catch(() => true))) {
      return skippedResult("lease", "Another process is running the price push.")
    }
    try {
      const query = queryOf(container)
      const offers = (await svc.listAllegroOffers({ demo: o.demo, is_primary: true } as never, { take: null })) as unknown as OfferRow[]
      const variantIds = [...new Set(offers.map((r) => r.variant_id).filter((x): x is string => Boolean(x)))]
      let refused: string | null = null
      let prices = new Map<string, Map<string, number>>()
      let bounds = new Map<string, PriceBounds>()
      const simulated = new Set<string>()
      try {
        prices = await loadVariantPrices(query, variantIds, o.prices.priceListId)
        bounds = await loadVariantBounds(query, variantIds, o.prices.minKey, o.prices.maxKey)
        if (o.demo) {
          const demo = demoBounds(prices)
          for (const [id, b] of demo) {
            const set = bounds.get(id)
            if (!set || (set.min === null && set.max === null)) {
              bounds.set(id, b)
              simulated.add(id)
            }
          }
        }
      } catch (err) {
        refused = `Reading Medusa prices failed, nothing is planned: ${errorText(svc, err)}`
      }
      const rows = await loadPlanRows(svc, "prices")
      const quarantined = new Set(rows.filter((r) => r.status === "quarantined").map((r) => r.target_key))
      const plan = refused
        ? null
        : planPrices({
            offers: offers.map((r) => ({
              allegroId: r.allegro_id,
              name: r.name,
              status: r.status,
              price: r.price,
              variantId: r.variant_id,
              sku: r.sku,
              productId: r.product_id,
              productTitle: r.product_title,
              isPrimary: Boolean(r.is_primary),
            })),
            medusa: prices,
            bounds,
            requireFloor: o.prices.requireFloor,
            maxChangePercent: o.prices.maxChangePercent,
            cap: o.prices.cap,
            quarantined,
          })
      if (plan) {
        await savePlan(
          svc,
          "prices",
          plan.entries.map((e) => ({
            targetKey: e.allegroId,
            allegroId: e.allegroId,
            variantId: e.variantId,
            productId: e.productId,
            sku: e.sku,
            title: e.productTitle ?? e.name,
            action: e.reason === "price_down" || e.reason === "price_up" ? e.reason : "none",
            reason: e.reason,
            status: e.status,
            current: {
              ...(e.current ?? {}),
              min: e.bounds.min,
              max: e.bounds.max,
              ...(e.variantId && simulated.has(e.variantId) ? { demoBounds: true } : {}),
            },
            target: e.target,
          })),
          o.demo,
        )
      }
      await setPlanSummary(svc, "prices", { plannedAt: new Date().toISOString(), refused, counts: (plan?.counts ?? {}) as unknown as Record<string, number> })

      const armed = await armedWriters(svc)
      const wantApply = mode === "apply" || (mode === "auto" && armed.has("prices"))
      let applied = 0
      let failed = 0
      let message: string | null = refused
      if (wantApply && !refused) {
        if (!armed.has("prices")) message = "The prices writer is not armed: this was a plan only."
        else {
          await touchWriterRun(svc, "prices")
          const r = await applyPrices(container, svc, o.demo)
          applied = r.applied
          failed = r.failed
          message = r.message
          await setPlanSummary(svc, "prices", { lastApply: { at: new Date().toISOString(), applied, failed, message } })
        }
      }
      const run = await recordRun(svc, {
        kind: "prices",
        source: o.demo ? "demo" : "api",
        trigger,
        status: refused ? "error" : failed > 0 ? "partial" : "ok",
        dryRun: !(wantApply && armed.has("prices")),
        items: plan?.entries.length ?? 0,
        created: applied,
        issues: failed,
        statuses: (plan?.counts ?? null) as unknown as Record<string, number> | null,
        message,
        startedAt,
      })
      return { skipped: null, summary: await planSummary(svc, "prices"), applied, failed, message, run }
    } finally {
      if (sql) await releaseLease(sql, "prices", owner).catch(() => undefined)
    }
  })
  return result ?? skippedResult("running")
}
