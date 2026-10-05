/**
 * CARD RUN (catalogSource: "medusa"): Medusa variants into BaseLinker cards,
 * plan first.
 *
 * After every complete catalog read: plan with `lib/card-plan.ts`; only when
 * the `cards` writer is armed, apply within `maxCatalogChangesPerRun`:
 *
 *   create   look the SKU up, adopt a card that is there, otherwise one
 *            `addInventoryProduct` (and after an unclear answer, look again
 *            instead of creating twice); the new card is linked right away
 *   update   `addInventoryProduct` with the card id, name and EAN only
 *
 * In demo mode the simulated account records the card, and the next
 * simulated read has it, linked.
 */

import type BaseLinkerModuleService from "../../modules/baselinker/service"
import { addCardParams, planCards, updateCardParams, type CardItem, type CardPlanVariant } from "../../modules/baselinker/lib/card-plan"
import type { CardInput, CatalogRead } from "../../modules/baselinker/lib/catalog"
import { toBaseLinkerPrice } from "../../modules/baselinker/lib/catalog-import"
import { PLUGIN_EVENTS } from "../../modules/baselinker/lib/constants"
import type { RunDto, RunTrigger } from "../../modules/baselinker/lib/contract"
import { DEMO_PRICE_GROUP, DEMO_WAREHOUSE_ID, demoNewCardId } from "../../modules/baselinker/lib/demo"
import { describeError, isTransient } from "../../modules/baselinker/lib/errors"
import { normalizeSku } from "../../modules/baselinker/lib/matching"
import { isBaseWarehouse } from "../../modules/baselinker/lib/options"
import { selectForApply } from "../../modules/baselinker/lib/quarantine"
import { writerState } from "../../modules/baselinker/lib/writers"
import { loadMedusaCatalog, pricesIncludeTax } from "./medusa-catalog"
import { noteFailures, noteSuccesses, quarantinedKeys, quarantineRows, replacePlan, rowStatus, type Outcome, type PlanItemData } from "./plans"
import { baselinkerService, clientFor, emitEvent, exclusive, recordRun, type Scope } from "./runtime"
import { loadWriters, updateDemoState } from "./settings"

export interface CardsRunInput {
  trigger: RunTrigger
  read: CatalogRead
  /** Every card of the read (containers included). */
  cards: CardInput[]
  /** Card id to linked variant id. */
  links: ReadonlyMap<string, string>
  /** Card id to its conflict, for cards that are not linked because of one. */
  conflicts?: ReadonlyMap<string, string>
  /** Medusa available quantity per variant (for the first stock of a new card, stock source Medusa only). */
  available?: ReadonlyMap<string, number>
}

const APPLICABLE = new Set(["create", "update"])

async function linkCard(svc: BaseLinkerModuleService, item: CardItem, blProductId: string, available: number | null): Promise<void> {
  const create = item.create
  const existing = (await svc.listBaseLinkerProducts({ bl_product_id: blProductId, demo: false } as never, { take: 1 } as never)) as unknown as Array<{ id: string }>
  const link = {
    variant_id: item.variantId,
    product_id: item.productId || null,
    variant_sku: item.sku,
    match_key: normalizeSku(item.sku),
    match_source: "sku",
    conflict: null,
  }
  if (existing[0]) {
    await svc.updateBaseLinkerProducts({ id: existing[0].id, ...link } as never)
    return
  }
  await svc.createBaseLinkerProducts({
    bl_product_id: blProductId,
    parent_id: null,
    sku: create?.sku ?? item.sku,
    ean: create?.ean ?? null,
    name: create?.name ?? item.label,
    stock: available,
    price: null,
    product_title: item.label,
    demo: false,
    ...link,
  } as never)
}

export async function runCardsPlan(scope: Scope, input: CardsRunInput): Promise<RunDto | null> {
  return exclusive("cards", async () => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const startedAt = new Date()
    if (!input.read.complete) {
      return recordRun(svc, {
        kind: "cards",
        trigger: input.trigger,
        status: "partial",
        startedAt,
        message: "The BaseLinker read was incomplete, so no card was planned: a card missing from a broken list would be created twice. The previous plan stays.",
        counts: { skipped: "incomplete_read" },
      })
    }
    const [{ directions, writers }, catalog, taxInclusive] = await Promise.all([
      loadWriters(svc),
      loadMedusaCatalog(scope, { currency: o.priceCurrency, manufacturerAs: o.manufacturerAs }),
      pricesIncludeTax(scope, o.priceCurrency),
    ])
    const priceGroupId = o.demo ? Number(DEMO_PRICE_GROUP) : o.priceGroupId
    const warehouseId = o.demo ? DEMO_WAREHOUSE_ID : isBaseWarehouse(o.warehouseId) ? o.warehouseId : null
    const withStock = directions.stock === "medusa" && warehouseId !== null

    const variants: CardPlanVariant[] = catalog.variants.map((v) => ({
      id: v.id,
      productId: v.productId,
      sku: v.sku,
      ean: v.ean,
      name: [v.productTitle, v.variantTitle].filter(Boolean).join(" "),
      description: v.description,
      images: v.images,
      weightKg: v.weight === null ? null : o.weightUnit === "g" ? v.weight / 1000 : v.weight,
      /* A new card gets a price only when Medusa keeps gross prices: the card has no VAT rate yet to convert with. */
      price: priceGroupId !== null && taxInclusive ? toBaseLinkerPrice(v.price, null, true) : null,
      available: withStock ? input.available?.get(v.id) ?? null : null,
    }))
    const plan = planCards({
      complete: true,
      variants,
      cards: input.cards.map((c) => ({
        blProductId: c.blProductId,
        sku: c.sku,
        ean: c.ean,
        name: c.name,
        variantId: input.links.get(c.blProductId) ?? null,
        conflict: input.conflicts?.get(c.blProductId) ?? null,
      })),
    })

    const writer = writerState(writers, "cards")
    const quarantine = await quarantineRows(svc, "cards")
    const held = quarantinedKeys(quarantine)
    const applicable = plan.items.filter((i) => APPLICABLE.has(i.action))
    const selection = writer.live
      ? selectForApply(applicable, (i) => i.key, held, o.maxCatalogChangesPerRun)
      : { apply: [] as CardItem[], overCap: [] as CardItem[], quarantined: applicable.filter((i) => held.has(i.key)) }

    const outcomes = new Map<string, Outcome>()
    const adopted: string[] = []
    if (selection.apply.length > 0) {
      if (o.demo) {
        await updateDemoState(svc, (s) => {
          for (const item of selection.apply) {
            if (item.action === "create" && item.create) {
              s.cards[item.variantId] = { blId: demoNewCardId(item.variantId), sku: item.create.sku, name: item.create.name, ean: item.create.ean }
              if (item.create.available !== null) s.stock[demoNewCardId(item.variantId)] = item.create.available
              if (item.create.price !== null) s.prices[demoNewCardId(item.variantId)] = item.create.price
            } else if (item.update) {
              s.cardUpdates[item.update.blProductId] = {
                ...(s.cardUpdates[item.update.blProductId] ?? {}),
                ...(item.update.name !== undefined ? { name: item.update.name } : {}),
                ...(item.update.ean !== undefined ? { ean: item.update.ean } : {}),
              }
            }
            outcomes.set(item.key, { ok: true })
          }
        })
      } else {
        const client = clientFor(svc).forWriter("cards")
        const inventoryId = o.inventoryId as number
        for (const item of selection.apply) {
          try {
            if (item.action === "create" && item.create) {
              const params = addCardParams(item.create, { inventoryId, priceGroupId, warehouseId: withStock ? warehouseId : null })
              const res = await client.createCardOnce(inventoryId, params, item.create.sku, warehouseId)
              if (res.adopted) adopted.push(item.key)
              await linkCard(svc, item, res.productId, item.create.available)
            } else if (item.update) {
              await client.addInventoryProduct(updateCardParams(item.update, inventoryId))
            }
            outcomes.set(item.key, { ok: true })
          } catch (err) {
            const d = describeError(err)
            outcomes.set(item.key, { ok: false, error: d.message, countable: !isTransient(err) && d.code !== "unknown_result" })
            /* BaseLinker is not answering: the rest would only wait for the same timeout. */
            if (d.code === "ERROR_NETWORK" || d.code.startsWith("HTTP_5")) break
          }
        }
      }
    }

    const failed = selection.apply.filter((i) => outcomes.get(i.key)?.ok === false)
    await noteFailures(
      svc,
      "cards",
      failed
        .map((i) => ({ item: i, outcome: outcomes.get(i.key) as Extract<Outcome, { ok: false }> }))
        .filter((x) => x.outcome.countable)
        .map((x) => ({ key: x.item.key, label: x.item.label, error: x.outcome.error })),
      quarantine,
    )
    await noteSuccesses(
      svc,
      selection.apply.filter((i) => outcomes.get(i.key)?.ok).map((i) => i.key),
      quarantine,
    )

    const overCap = new Set(selection.overCap.map((i) => i.key))
    const now = new Date()
    const rows: PlanItemData[] = plan.items.map((i) => {
      const outcome = outcomes.get(i.key)
      return {
        itemKey: i.key,
        action: i.action,
        status: rowStatus({ applicable: APPLICABLE.has(i.action), outcome, quarantined: held.has(i.key), overCap: overCap.has(i.key) }),
        reason: adopted.includes(i.key) ? "adopted" : i.reason,
        label: i.label,
        sku: i.sku,
        productId: i.productId,
        variantId: i.variantId,
        blProductId: i.blProductId,
        changes: i.changes,
        error: outcome && !outcome.ok ? outcome.error : null,
        appliedAt: outcome?.ok ? now : null,
      }
    })
    const applied = [...outcomes.values()].filter((x) => x.ok).length
    const s = plan.stats
    const mode = writer.live ? "write" : "plan"
    const run = await recordRun(svc, {
      kind: "cards",
      trigger: input.trigger,
      status: failed.length > 0 || selection.overCap.length > 0 ? "partial" : "ok",
      complete: true,
      startedAt,
      counts: { ...s, mode, applied, adopted: adopted.length, failed: failed.length, overCap: selection.overCap.length, quarantined: selection.quarantined.length, taxInclusive },
      message:
        mode === "plan"
          ? `Plan only: ${s.create} card(s) to create, ${s.update} to update, ${s.conflict} conflict(s). Nothing written.`
          : `${applied} applied${adopted.length > 0 ? ` (${adopted.length} found by SKU and linked)` : ""}${failed.length > 0 ? `, ${failed.length} failed` : ""}.`,
    })
    await replacePlan(svc, "cards", run.id, rows)
    if (applied > 0) await emitEvent(scope, PLUGIN_EVENTS.planApplied, { kind: "cards", applied, failed: failed.length, demo: o.demo })
    return run
  })
}
