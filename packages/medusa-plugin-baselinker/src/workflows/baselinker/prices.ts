/**
 * PRICE PUSH RUN (catalogSource: "medusa"): Medusa base prices into one
 * BaseLinker price group, plan first.
 *
 * After every complete catalog read: plan with `lib/price-push.ts` (BaseLinker
 * keeps gross prices: for net Medusa prices the VAT rate of each card is read
 * from the product details); only when the `prices` writer is armed, write
 * within `maxPriceChangesPerRun` through `updateInventoryProductsPrices`
 * (1000 cards per call). Warnings per card fail that card and count towards
 * its quarantine.
 */

import { parseProductsData, type CardInput, type CatalogRead } from "../../modules/baselinker/lib/catalog"
import { BULK_UPDATE_MAX, PLUGIN_EVENTS } from "../../modules/baselinker/lib/constants"
import type { RunDto, RunTrigger } from "../../modules/baselinker/lib/contract"
import { buildDemoDetails, DEMO_PRICE_GROUP, type DemoVariant } from "../../modules/baselinker/lib/demo"
import { describeError } from "../../modules/baselinker/lib/errors"
import { planPricePush, priceGroupProblem, pricePayload, type PriceChange } from "../../modules/baselinker/lib/price-push"
import { selectForApply } from "../../modules/baselinker/lib/quarantine"
import { writerState } from "../../modules/baselinker/lib/writers"
import { loadMedusaCatalog, pricesIncludeTax } from "./medusa-catalog"
import { noteFailures, noteSuccesses, quarantinedKeys, quarantineRows, replacePlan, rowStatus, type Outcome, type PlanItemData } from "./plans"
import { baselinkerService, clientFor, emitEvent, exclusive, recordRun, type Scope } from "./runtime"
import { loadWriters, updateDemoState } from "./settings"

export interface PricesRunInput {
  trigger: RunTrigger
  read: CatalogRead
  cards: CardInput[]
  links: ReadonlyMap<string, string>
  conflicts?: ReadonlyMap<string, string>
  demo?: { list: Record<string, Record<string, unknown>>; variants: DemoVariant[] }
}

/** VAT rate of every linked card, from the details of its main product. */
async function cardRates(
  input: PricesRunInput,
  read: (ids: string[]) => Promise<ReturnType<typeof parseProductsData>>,
): Promise<Map<string, number | null>> {
  const linked = input.cards.filter((c) => input.links.has(c.blProductId))
  const mains = [...new Set(linked.map((c) => c.parentId ?? c.blProductId))]
  const details = await read(mains)
  const rateOf = new Map(details.map((d) => [d.blProductId, d.taxRate]))
  return new Map(linked.map((c) => [c.blProductId, rateOf.get(c.parentId ?? c.blProductId) ?? null]))
}

export async function runPricePushPlan(scope: Scope, input: PricesRunInput): Promise<RunDto | null> {
  return exclusive(scope, "prices", async () => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const startedAt = new Date()
    const priceGroupId = o.demo ? Number(DEMO_PRICE_GROUP) : o.priceGroupId
    if (priceGroupId === null) return null
    if (!input.read.complete) {
      return recordRun(svc, {
        kind: "prices",
        trigger: input.trigger,
        status: "partial",
        startedAt,
        message: "The BaseLinker read was incomplete, so no price was planned or written. The previous plan stays.",
        counts: { skipped: "incomplete_read" },
      })
    }
    const [{ writers }, catalog, taxInclusive] = await Promise.all([
      loadWriters(svc),
      loadMedusaCatalog(scope, { currency: o.priceCurrency, manufacturerAs: o.manufacturerAs }),
      pricesIncludeTax(scope, o.priceCurrency),
    ])

    let rates: Map<string, number | null> | undefined
    if (!taxInclusive) {
      try {
        rates = await cardRates(input, async (ids) =>
          o.demo && input.demo
            ? parseProductsData(buildDemoDetails(input.demo.variants, input.demo.list).products)
            : clientFor(svc).getInventoryProductsData(o.inventoryId as number, ids),
        )
      } catch (err) {
        return recordRun(svc, {
          kind: "prices",
          trigger: input.trigger,
          status: "error",
          startedAt,
          message: `Medusa keeps net prices and the VAT rates of the cards could not be read, so nothing was planned: ${svc.mask(describeError(err).message)}`,
        })
      }
    }

    const plan = planPricePush({
      cards: input.cards.map((c) => ({
        blProductId: c.blProductId,
        variantId: input.links.get(c.blProductId) ?? null,
        conflict: input.conflicts?.get(c.blProductId) ?? null,
        prices: c.prices,
      })),
      variants: catalog.variants.map((v) => ({
        id: v.id,
        productId: v.productId,
        sku: v.sku,
        label: [v.productTitle, v.variantTitle].filter(Boolean).join(" "),
        price: v.price,
      })),
      complete: true,
      priceGroupId,
      taxInclusive,
      rates,
    })

    const writer = writerState(writers, "prices")
    const quarantine = await quarantineRows(svc, "prices")
    const held = quarantinedKeys(quarantine)

    /* Before the first write of a run: the group must exist, be a standard group and be in the Medusa currency. */
    let groupProblem: string | null = null
    if (writer.live && plan.changes.length > 0 && !o.demo) {
      try {
        groupProblem = priceGroupProblem(await clientFor(svc).getInventoryPriceGroups(), priceGroupId, o.priceCurrency)
      } catch (err) {
        groupProblem = `The price groups could not be read (${svc.mask(describeError(err).message)})`
      }
    }

    const selection =
      writer.live && !groupProblem
        ? selectForApply(plan.changes, (c) => c.key, held, o.maxPriceChangesPerRun)
        : { apply: [] as PriceChange[], overCap: [] as PriceChange[], quarantined: plan.changes.filter((c) => held.has(c.key)) }

    const outcomes = new Map<string, Outcome>()
    let callError: string | null = null
    if (selection.apply.length > 0) {
      if (o.demo) {
        await updateDemoState(svc, (s) => {
          for (const c of selection.apply) s.prices[c.blProductId] = c.to
        })
        for (const c of selection.apply) outcomes.set(c.key, { ok: true })
      } else {
        const client = clientFor(svc).forWriter("prices")
        for (let i = 0; i < selection.apply.length; i += BULK_UPDATE_MAX) {
          const batch = selection.apply.slice(i, i + BULK_UPDATE_MAX)
          if (callError) {
            for (const c of batch) outcomes.set(c.key, { ok: false, error: callError, countable: false })
            continue
          }
          try {
            const res = await client.updateInventoryProductsPrices(o.inventoryId as number, pricePayload(batch, priceGroupId))
            for (const c of batch) {
              const warning = res.warnings[c.blProductId]
              outcomes.set(c.key, warning ? { ok: false, error: warning, countable: true } : { ok: true })
            }
          } catch (err) {
            callError = svc.mask(describeError(err).message)
            for (const c of batch) outcomes.set(c.key, { ok: false, error: callError, countable: false })
          }
        }
      }
    }

    const failed = selection.apply.filter((c) => outcomes.get(c.key)?.ok === false)
    await noteFailures(
      svc,
      "prices",
      failed
        .filter((c) => (outcomes.get(c.key) as Extract<Outcome, { ok: false }>).countable)
        .map((c) => ({ key: c.key, label: c.sku ?? c.label, error: (outcomes.get(c.key) as Extract<Outcome, { ok: false }>).error })),
      quarantine,
    )
    await noteSuccesses(
      svc,
      selection.apply.filter((c) => outcomes.get(c.key)?.ok).map((c) => c.key),
      quarantine,
    )

    const overCap = new Set(selection.overCap.map((c) => c.key))
    const now = new Date()
    const rows: PlanItemData[] = plan.changes.map((c) => {
      const outcome = outcomes.get(c.key)
      return {
        itemKey: c.key,
        action: "update",
        status: rowStatus({ applicable: true, outcome, quarantined: held.has(c.key), overCap: overCap.has(c.key) }),
        label: c.label,
        sku: c.sku,
        productId: c.productId,
        variantId: c.variantId,
        blProductId: c.blProductId,
        changes: [{ field: "price", from: c.from, to: c.to }],
        error: outcome && !outcome.ok ? outcome.error : null,
        appliedAt: outcome?.ok ? now : null,
      }
    })
    const applied = [...outcomes.values()].filter((x) => x.ok).length
    const s = plan.stats
    const mode = writer.live ? "write" : "plan"
    const run = await recordRun(svc, {
      kind: "prices",
      trigger: input.trigger,
      status: callError || groupProblem ? "error" : failed.length > 0 || selection.overCap.length > 0 ? "partial" : "ok",
      complete: true,
      startedAt,
      counts: { ...s, mode, priceGroupId, currency: o.priceCurrency, taxInclusive, applied, failed: failed.length, overCap: selection.overCap.length, quarantined: selection.quarantined.length },
      message: groupProblem
        ? `${groupProblem}: nothing was written. The plan stays for reading; fix priceGroupId or priceCurrency.`
        : mode === "plan"
          ? `Plan only: ${s.toChange} price(s) would change in group ${priceGroupId}, nothing written.`
          : callError
            ? `${applied} price(s) written, then an error: ${callError}`
            : `${applied} price(s) written${failed.length > 0 ? `, ${failed.length} refused by BaseLinker` : ""}.`,
    })
    await replacePlan(svc, "prices", run.id, rows)
    if (applied > 0) await emitEvent(scope, PLUGIN_EVENTS.planApplied, { kind: "prices", applied, failed: failed.length, demo: o.demo })
    return run
  })
}
