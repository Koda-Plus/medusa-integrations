/**
 * THE STOCK PUSH: Medusa's available quantity of a variant to the stock of
 * its primary Allegro offer. PLAN FIRST, always; apply only when the stock
 * writer is armed (both switches), and only what the plan says.
 *
 *   1. Medusa is read (with the location guards); a failed or suspicious read
 *      plans nothing;
 *   2. the plan is computed from the offer snapshot (`lib/stock-plan.ts`) and
 *      stored: the admin shows it, with the reason of every line;
 *   3. an armed run re-reads the planned offers from Allegro right before the
 *      command, so a decrease never turns into a raise and an offer that
 *      ended in the meantime is left alone;
 *   4. quantities go as `FIXED` quantity commands, sold-out offers as an END
 *      publication command (Allegro cannot hold zero items). Never ACTIVATE.
 *
 * One run per process (a flag) and across processes (a lease row).
 */

import { randomUUID } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import type AllegroModuleService from "../../modules/allegro/service"
import { readOffersByIds } from "../../modules/allegro/lib/api"
import { isConnected } from "../../modules/allegro/lib/connection"
import { endCommandBody, groupForCommands, commandVerdict, quantityCommandBody } from "../../modules/allegro/lib/commands"
import { COMMAND_MAX_OFFERS, RUN_LEASE_MS } from "../../modules/allegro/lib/constants"
import type { AllegroPlanSummaryDto, AllegroRunDto } from "../../modules/allegro/lib/contract"
import type { OfferRow, PlanItemRow } from "../../modules/allegro/lib/dto"
import { offersFromApi } from "../../modules/allegro/lib/offers"
import { stockState } from "../../modules/allegro/lib/stock"
import { planStock, raiseGuard, recheck, type StockPlanResult } from "../../modules/allegro/lib/stock-plan"
import { releaseLease, takeLease } from "../../modules/allegro/lib/store"
import { loadCatalog, locationCount, unknownLocations } from "./catalog"
import { runCommand, simulatedCommand, type CommandSpec } from "./commands-run"
import { demoOffersRaw, loadOverlay, updateOverlay } from "./demo-sim"
import { failurePatch, loadPlanRows, planSummary, savePlan, setPlanSummary, updatePlanRows } from "./plans"
import { allegroOf, errorText, exclusive, queryOf, recordRun, sqlOf } from "./runtime"
import { armedWriters, loadWriterRows, recordOutcome, touchWriterRun } from "./writers"

export type PlanMode = "plan" | "apply" | "auto"

export interface WriterRunInput {
  trigger?: "schedule" | "manual" | "auto" | "event"
  /** plan: a dry run; apply: plan and apply now (refused when not armed); auto: apply when armed. */
  mode?: PlanMode
}

export interface WriterRunResult {
  skipped: null | "running" | "not_configured" | "not_connected" | "lease"
  summary: AllegroPlanSummaryDto | null
  applied: number
  failed: number
  message: string | null
  run: AllegroRunDto | null
}

export function skippedResult(skipped: WriterRunResult["skipped"], message: string | null = null): WriterRunResult {
  return { skipped, summary: null, applied: 0, failed: 0, message, run: null }
}

async function raiseInfo(svc: AllegroModuleService, armed: ReadonlySet<string>): Promise<{ allowed: boolean; reason: string | null }> {
  /* The last healthy import drain (never a dry run): the orders writer records it on every run. */
  const orders = (await loadWriterRows(svc)).get("orders")
  const [, held] = (await svc.listAndCountAllegroOrderImports({ status: "held" } as never, { take: 1, select: ["id"] })) as unknown as [unknown[], number]
  const last = orders?.last_success_at ? new Date(orders.last_success_at) : null
  return raiseGuard({ importArmed: armed.has("orders"), lastImportOkAt: last, heldImports: held, now: new Date() })
}

/** Writes what Allegro now shows into the snapshot, so the stock check labels move at once. */
async function patchSnapshot(svc: AllegroModuleService, changes: ReadonlyArray<{ allegroId: string; available: number; status?: string }>, demo: boolean): Promise<void> {
  if (changes.length === 0) return
  const rows = (await svc.listAllegroOffers({ allegro_id: changes.map((c) => c.allegroId), demo } as never, { take: null })) as unknown as OfferRow[]
  const byId = new Map(rows.map((r) => [r.allegro_id, r]))
  const updates: Array<Record<string, unknown>> = []
  for (const c of changes) {
    const row = byId.get(c.allegroId)
    if (!row) continue
    const status = c.status ?? row.status
    const state = row.variant_id && row.is_primary ? stockState({ status, allegro: c.available, medusa: row.medusa_available }) : row.stock_state
    updates.push({ id: row.id, available: c.available, status, stock_state: state })
  }
  if (updates.length > 0) await svc.updateAllegroOffers(updates as never)
}

async function applyStock(container: MedusaContainer, svc: AllegroModuleService, demo: boolean): Promise<{ applied: number; failed: number; message: string | null }> {
  const rows = (await loadPlanRows(svc, "stock")).filter((r) => r.status === "planned" && r.allegro_id && Boolean(r.demo) === demo)
  if (rows.length === 0) return { applied: 0, failed: 0, message: null }
  let armed = await armedWriters(svc)
  if (!armed.has("stock")) return { applied: 0, failed: 0, message: "The stock writer is not armed." }

  /* 1. Allegro as it is NOW. */
  const ids = rows.map((r) => r.allegro_id as string)
  let fresh: Map<string, { status: string; available: number | null }>
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
    await recordOutcome(svc, "stock", { kind: "systemic", message })
    return { applied: 0, failed: 0, message }
  }

  const updates: Array<Record<string, unknown> & { id: string }> = []
  const go: PlanItemRow[] = []
  for (const r of rows) {
    const target = Number((r.target as { quantity?: unknown } | null)?.quantity ?? 0)
    const check = recheck({ action: r.action as "decrease" | "increase" | "end" | "none", target }, fresh.get(r.allegro_id as string) ?? null)
    if (check.ok) go.push(r)
    else if (check.reason === "already_done") updates.push({ id: r.id, status: "in_sync", last_error: null })
    else updates.push({ id: r.id, status: "skipped", last_error: `Changed on Allegro since the plan (${check.reason}); planned again on the next run.` })
  }

  /* 2. One command per target value, at most 1 000 offers each. */
  const byOffer = new Map(go.map((r) => [r.allegro_id as string, r]))
  const groups = groupForCommands(
    go.map((r) => ({ offerId: r.allegro_id as string, key: r.action === "end" ? "end" : String(Number((r.target as { quantity?: unknown } | null)?.quantity ?? 0)) })),
    COMMAND_MAX_OFFERS,
  )
  let applied = 0
  let failed = 0
  let message: string | null = null
  const snapshot: Array<{ allegroId: string; available: number; status?: string }> = []
  for (const group of groups) {
    armed = await armedWriters(svc)
    if (!armed.has("stock")) {
      message = "The stock writer was disarmed during the run; the rest waits."
      break
    }
    const spec: CommandSpec =
      group.key === "end"
        ? { path: "/sale/offer-publication-commands", body: endCommandBody(group.offerIds), offerIds: group.offerIds }
        : { path: "/sale/offer-quantity-change-commands", body: quantityCommandBody(Number(group.key), group.offerIds), offerIds: group.offerIds }
    const result = demo ? simulatedCommand(spec) : await runCommand(svc, "stock", armed, spec)
    if (result.error) {
      for (const id of group.offerIds) {
        const row = byOffer.get(id) as PlanItemRow
        /* A failed command is not the offer's fault: no failure is counted, nothing quarantined. */
        updates.push({ id: row.id, status: result.unclear ? "unknown" : "failed", last_error: result.error, command_id: result.commandId })
      }
      failed += group.offerIds.length
      const tripped = await recordOutcome(svc, "stock", { kind: "systemic", message: result.error })
      if (tripped || result.rateLimited) {
        message = tripped ? "The circuit breaker disarmed the stock writer." : "Allegro asked to slow down (429); the rest waits for the next run."
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
        updates.push({ id: row.id, status: "applied", applied_at: new Date(), command_id: result.commandId, last_error: null, failures: 0 })
        snapshot.push(group.key === "end" ? { allegroId: id, available: 0, status: "ENDED" } : { allegroId: id, available: Number(group.key) })
      } else if (task?.status === "FAIL") {
        failed += 1
        updates.push({ id: row.id, ...failurePatch(row, task.message ?? "Allegro refused the change."), command_id: result.commandId })
      } else {
        updates.push({ id: row.id, status: "unknown", command_id: result.commandId, last_error: "Allegro had not finished this change when we looked; the next run re-reads the offer." })
      }
    }
    const verdict = commandVerdict(result.tasks)
    const tripped = await recordOutcome(
      svc,
      "stock",
      verdict === "all_failed" ? { kind: "systemic", message: `Every offer of a command failed: ${result.tasks[0]?.message ?? "no reason given"}` } : { kind: "ok" },
    )
    if (tripped) {
      message = "The circuit breaker disarmed the stock writer."
      break
    }
  }
  await updatePlanRows(svc, updates)
  if (demo) {
    await updateOverlay(svc, (o) => {
      for (const s of snapshot) o.offers[s.allegroId] = { ...(o.offers[s.allegroId] ?? {}), available: s.available, ...(s.status ? { status: s.status } : {}) }
    })
  }
  await patchSnapshot(svc, snapshot, demo)
  return { applied, failed, message }
}

export async function runStockPush(container: MedusaContainer, input: WriterRunInput = {}): Promise<WriterRunResult> {
  const result = await exclusive("stock", async () => {
    const svc = allegroOf(container)
    const o = svc.getOptions()
    const trigger = input.trigger ?? "manual"
    const mode = input.mode ?? "auto"
    const source = o.demo ? "demo" : "api"
    const startedAt = new Date()
    if (!o.demo) {
      if (!svc.isConfigured()) return skippedResult("not_configured")
      if (!(await isConnected(svc))) return skippedResult("not_connected")
    }
    const sql = sqlOf(container)
    const owner = randomUUID()
    if (sql && !(await takeLease(sql, "stock", owner, RUN_LEASE_MS).catch(() => true))) {
      return skippedResult("lease", "Another process is running the stock push.")
    }
    try {
      const query = queryOf(container)
      let refusal: string | null = null
      let medusaComplete = true
      const medusa = new Map<string, number | null>()
      try {
        const unknown = await unknownLocations(query, o.stockLocationIds)
        if (unknown.length > 0) {
          refusal = `stockLocationIds lists ${unknown.join(", ")}, which do not exist. Medusa would report zero for every variant, so nothing is planned.`
        } else if ((await locationCount(query)) === 0) {
          refusal = "The store has no stock location, so Medusa reports zero for every variant. Nothing is planned."
        } else {
          for (const v of await loadCatalog(query, o.stockLocationIds)) medusa.set(v.id, v.available)
        }
      } catch (err) {
        medusaComplete = false
        refusal = `Reading Medusa stock failed: ${errorText(svc, err)}`
      }

      const offers = (await svc.listAllegroOffers({ demo: o.demo, is_primary: true } as never, { take: null })) as unknown as OfferRow[]
      const armed = await armedWriters(svc)
      const raise = o.stockPush === "mirror" ? await raiseInfo(svc, armed) : { allowed: false, reason: null }
      const rows = await loadPlanRows(svc, "stock")
      const quarantined = new Set(rows.filter((r) => r.status === "quarantined").map((r) => r.target_key))

      const plan: StockPlanResult = refusal
        ? { entries: [], refused: refusal, counts: { decrease: 0, increase: 0, end: 0, skipped: 0, inSync: 0, quarantined: 0, deferred: 0 } }
        : planStock({
            mode: o.stockPush,
            endAtZero: o.endOffersAtZero,
            offers: offers.map((r) => ({
              allegroId: r.allegro_id,
              name: r.name,
              status: r.status,
              available: r.available,
              variantId: r.variant_id,
              sku: r.sku,
              productId: r.product_id,
              productTitle: r.product_title,
              isPrimary: Boolean(r.is_primary),
            })),
            medusa,
            medusaComplete,
            raise,
            cap: o.stockPushCap,
            quarantined,
          })

      if (!plan.refused) {
        await savePlan(
          svc,
          "stock",
          plan.entries.map((e) => ({
            targetKey: e.allegroId,
            allegroId: e.allegroId,
            variantId: e.variantId,
            productId: e.productId,
            sku: e.sku,
            title: e.productTitle ?? e.name,
            action: e.action,
            reason: e.reason,
            status: e.status,
            current: { allegro: e.allegro, medusa: e.medusa },
            target: e.target === null ? null : { quantity: e.target },
          })),
          o.demo,
        )
      }
      await setPlanSummary(svc, "stock", {
        plannedAt: new Date().toISOString(),
        refused: plan.refused,
        counts: plan.counts as unknown as Record<string, number>,
      })

      let applied = 0
      let failed = 0
      let message: string | null = plan.refused
      const wantApply = mode === "apply" || (mode === "auto" && armed.has("stock"))
      if (wantApply && !plan.refused) {
        if (!armed.has("stock")) {
          message = "The stock writer is not armed: this was a plan only."
        } else {
          await touchWriterRun(svc, "stock")
          const r = await applyStock(container, svc, o.demo)
          applied = r.applied
          failed = r.failed
          message = r.message
          await setPlanSummary(svc, "stock", { lastApply: { at: new Date().toISOString(), applied, failed, message } })
        }
      }

      const run = await recordRun(svc, {
        kind: "stock",
        source,
        trigger,
        status: plan.refused ? "error" : failed > 0 ? "partial" : "ok",
        dryRun: !(wantApply && armed.has("stock")),
        items: plan.entries.length,
        created: applied,
        issues: failed,
        statuses: plan.counts as unknown as Record<string, number>,
        message,
        startedAt,
      })
      return { skipped: null, summary: await planSummary(svc, "stock"), applied, failed, message, run }
    } finally {
      if (sql) await releaseLease(sql, "stock", owner).catch(() => undefined)
    }
  })
  return result ?? skippedResult("running")
}
