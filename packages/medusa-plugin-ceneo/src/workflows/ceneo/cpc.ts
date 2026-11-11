/**
 * CPC: bids, promotion texts and the competition.
 *
 *   runCeneoCpc   the hourly run (and the admin button):
 *                 1. read the bids and the top 10 of the offers in the feed,
 *                    the least recently read first, at most `cpc.perRun`
 *                    (Ceneo takes 300 ids per call; the reads cost limits);
 *                 2. the bids writer, when armed: one planned step per row
 *                    (towards the target, within maxBid and
 *                    maxBidChangePercent), then the new bid is read back;
 *                 3. the promotion writer, when armed: the texts that changed.
 *   setTargets    a person's targets and texts, with the plan recomputed.
 *
 * Bids are set by Ceneo product id: a product Ceneo has not matched to the
 * offer yet (no id in the bid read) cannot get a bid, and the row says so.
 */

import { CeneoApiError, CeneoClient } from "../../modules/ceneo/lib/ceneo-client"
import type { CpcRunResult } from "../../modules/ceneo/lib/contract"
import { planBid, promoBatches, standing, type BidKind, type BidRead, type ProductOffers } from "../../modules/ceneo/lib/cpc"
import { demoCpcTransport, DEMO_SHOP, FunctionError, liveCpcTransport, type CpcTransport } from "../../modules/ceneo/lib/cpc-transport"
import { ceneoSvc, type CeneoServiceLike, type Row } from "../../modules/ceneo/lib/store"
import { outcomeOfStatus, type WriteOutcome, type WriterKey } from "../../modules/ceneo/lib/writers"
import { BID_TABLE } from "../../modules/ceneo/lib/constants"
import { rowsOf, withRunLease } from "../../modules/ceneo/lib/import-claim"
import { recordOutcome, sqlOf, stateOf, writerRows } from "./import-orders"
import { chunks, errorText, withLock, type Scope } from "./runtime"

const CPC_LEASE_MS = 15 * 60_000

export const BID_FIELDS = [
  "id",
  "kind",
  "key",
  "ceneo_product_id",
  "name",
  "current_bid",
  "click_rate",
  "min_suggested_bid",
  "target_bid",
  "planned_bid",
  "plan_reasons",
  "target_by",
  "target_at",
  "promo_text",
  "promo_applied",
  "promo_pending",
  "promo_at",
  "top10",
  "offers_number",
  "position",
  "lowest_price",
  "applied_at",
  "error",
  "error_at",
  "read_at",
  "demo",
]

const READ_BATCH = 300
const WRITE_BATCH = 50

export async function cpcTransportOf(svc: CeneoServiceLike, writers: readonly WriterKey[] = []): Promise<CpcTransport | null> {
  const o = svc.getOptions()
  if (o.demo) {
    const rows = await svc.listCeneoOffers({ retired_at: null, in_feed: true }, { take: 1000, select: ["offer_id", "price"] })
    const prices = new Map<string, number>()
    for (const r of rows) {
      const amount = (r.price as { amount?: unknown } | null)?.amount
      if (typeof r.offer_id === "string" && typeof amount === "number") prices.set(r.offer_id, amount)
    }
    return demoCpcTransport(prices)
  }
  if (!o.apiKey) return null
  return liveCpcTransport(new CeneoClient({ apiKey: o.apiKey, timeoutMs: o.timeoutMs, logger: svc.getLogger(), writers }))
}

export function shopNameOf(svc: CeneoServiceLike): string | null {
  const o = svc.getOptions()
  return o.cpc.shopName ?? (o.demo ? DEMO_SHOP : null)
}

/** The plan of one row with the current options. */
export function planOf(svc: CeneoServiceLike, r: Record<string, unknown>) {
  const o = svc.getOptions()
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
  return planBid({ current: n(r.current_bid), target: n(r.target_bid), maxBid: o.cpc.maxBid, maxChangePercent: o.cpc.maxBidChangePercent, minSuggested: n(r.min_suggested_bid) })
}

async function upsert(svc: CeneoServiceLike, kind: BidKind, key: string, demo: boolean, patch: Record<string, unknown>): Promise<Row> {
  const [row] = await svc.listCeneoBids({ kind, key, demo }, { take: 1, select: BID_FIELDS })
  if (row) {
    const [out] = await svc.updateCeneoBids([{ id: row.id, ...patch }])
    return out ?? { ...row, ...patch }
  }
  try {
    const [out] = await svc.createCeneoBids([{ kind, key, demo, ...patch }])
    return out
  } catch {
    const [again] = await svc.listCeneoBids({ kind, key, demo }, { take: 1, select: BID_FIELDS })
    if (!again) throw new Error(`Could not write the bid row ${kind}:${key}.`)
    const [out] = await svc.updateCeneoBids([{ id: again.id, ...patch }])
    return out ?? { ...again, ...patch }
  }
}

function readPatch(svc: CeneoServiceLike, prev: Row | undefined, bid: BidRead | undefined, top: ProductOffers | undefined, at: Date): Record<string, unknown> {
  const patch: Record<string, unknown> = { read_at: at }
  if (bid) {
    patch.current_bid = bid.bid
    patch.click_rate = bid.clickRate
    if (bid.ceneoProductId) patch.ceneo_product_id = bid.ceneoProductId
    if (bid.name) patch.name = bid.name
  }
  if (top) {
    const st = standing(top.offers, shopNameOf(svc))
    patch.top10 = top.offers
    patch.offers_number = top.offersNumber
    patch.min_suggested_bid = top.minSuggestedBid
    patch.position = st.position
    patch.lowest_price = st.lowest === null ? null : { amount: st.lowest, currency_code: "pln" }
    if (top.ceneoProductId && !patch.ceneo_product_id) patch.ceneo_product_id = top.ceneoProductId
  }
  const plan = planOf(svc, { current_bid: patch.current_bid ?? prev?.current_bid, target_bid: prev?.target_bid, min_suggested_bid: patch.min_suggested_bid ?? prev?.min_suggested_bid })
  patch.planned_bid = plan.next
  patch.plan_reasons = plan.reasons.length > 0 ? plan.reasons : null
  return patch
}

function outcomeOf(err: unknown): WriteOutcome {
  const message = errorText(err)
  if (err instanceof CeneoApiError) return outcomeOfStatus(err.status, message)
  /* Ceneo refused these rows: their data, not the writer. */
  if (err instanceof FunctionError) return { kind: "item", message }
  return { kind: "systemic", message }
}

/** A run sends at most one step per row within this window, whichever process runs it. */
const STEP_GAP_MS = 50 * 60_000

export async function runCeneoCpc(scope: Scope, input: { trigger?: string } = {}): Promise<CpcRunResult> {
  const svc = ceneoSvc(scope)
  const o = svc.getOptions()
  const rowsW = await writerRows(svc)
  const bidsState = stateOf(svc, "bids", rowsW.get("bids") ?? null)
  const promoState = stateOf(svc, "promo", rowsW.get("promo") ?? null)
  const writers: WriterKey[] = [...(bidsState.effective ? (["bids"] as const) : []), ...(promoState.effective ? (["promo"] as const) : [])]
  const transport = await cpcTransportOf(svc, writers)
  if (!transport) return { status: "off", reason: "missing_key" }
  const sql = sqlOf(scope)
  const result = await withLock("cpc", async (): Promise<CpcRunResult> => {
    const started = Date.now()
    const at = new Date()
    const demo = o.demo
    let read = 0
    let bidsSent = 0
    let promosSent = 0
    let failed = 0
    let readError: string | null = null

    /* 1. Reads: the offers in the feed, least recently read first. */
    try {
      const offers = await svc.listCeneoOffers({ retired_at: null, in_feed: true }, { take: 5000, select: ["offer_id", "title"] })
      const keys = offers.map((r) => String(r.offer_id ?? "")).filter(Boolean)
      const existing = new Map<string, Row>()
      for (const part of chunks(keys, 500)) for (const r of await svc.listCeneoBids({ kind: "product", key: part, demo }, { take: null, select: BID_FIELDS })) existing.set(String(r.key), r)
      const titles = new Map(offers.map((r) => [String(r.offer_id ?? ""), typeof r.title === "string" ? r.title : null]))
      const ordered = [...keys].sort((a, b) => new Date(String(existing.get(a)?.read_at ?? 0)).getTime() - new Date(String(existing.get(b)?.read_at ?? 0)).getTime()).slice(0, o.cpc.perRun)
      for (const part of chunks(ordered, READ_BATCH)) {
        const [bids, tops] = await Promise.all([transport.productBids(part), transport.topOffers(part)])
        const byBid = new Map(bids.map((b) => [b.key, b]))
        const byTop = new Map(tops.map((t) => [t.key, t]))
        for (const key of part) {
          const prev = existing.get(key)
          const patch = readPatch(svc, prev, byBid.get(key), byTop.get(key), at)
          if (!prev && titles.get(key)) patch.name = patch.name ?? titles.get(key)
          existing.set(key, await upsert(svc, "product", key, demo, patch))
          read += 1
        }
      }
      for (const r of await svc.listCeneoBids({ kind: "category", demo }, { take: 200, select: BID_FIELDS })) {
        const [bid] = await transport.categoryBid(String(r.key))
        await upsert(svc, "category", String(r.key), demo, readPatch(svc, r, bid, undefined, at))
        read += 1
      }
    } catch (err) {
      readError = errorText(err)
      svc.getLogger().warn(`[ceneo] CPC read failed (${input.trigger ?? "schedule"}): ${readError}`)
    }

    /* 2. The bids writer: one planned step per row. */
    /* Each writer phase under its database lease: a second process skips it, never sends it twice. */
    if (bidsState.effective && !readError) await withRunLease(sql, "bids", CPC_LEASE_MS, async () => {
      /* The plan is computed again now, from the options of this process: a lowered maxBid or step never sends an old plan. */
      const since = new Date(at.getTime() - STEP_GAP_MS)
      const candidates = await svc.listCeneoBids(
        { demo, planned_bid: { $ne: null }, $or: [{ applied_at: null }, { applied_at: { $lt: since } }] },
        { take: o.cpc.perRun, select: BID_FIELDS, order: { applied_at: "ASC" } },
      )
      const planned: Row[] = []
      for (const r of candidates) {
        const plan = planOf(svc, r)
        const ceiling = o.cpc.maxBid
        if (plan.next === null || plan.next < 0 || ceiling === null || plan.next > ceiling) {
          await svc.updateCeneoBids([{ id: r.id, planned_bid: plan.next, plan_reasons: plan.reasons }])
          continue
        }
        planned.push(plan.next === r.planned_bid ? r : { ...r, planned_bid: plan.next })
      }
      const products = planned.filter((r) => r.kind === "product" && typeof r.ceneo_product_id === "string")
      const categories = planned.filter((r) => r.kind === "category")
      for (const r of planned.filter((x) => x.kind === "product" && typeof x.ceneo_product_id !== "string")) {
        await svc.updateCeneoBids([{ id: r.id, error: "Ceneo has not matched this offer to a product yet: no bid can be set.", error_at: at }])
      }
      /* One batch; a batch Ceneo refuses goes again row by row, so one wrong id never holds back the others. */
      const sendPart = async (part: Row[], fn: (rows: Row[]) => Promise<void>): Promise<boolean> => {
        try {
          await fn(part)
          await svc.updateCeneoBids(part.map((r) => ({ id: r.id, current_bid: r.planned_bid, applied_at: at, error: null, error_at: null })))
          bidsSent += part.length
          await recordOutcome(svc, "bids", { kind: "ok" })
          return true
        } catch (err) {
          if (err instanceof FunctionError && part.length > 1) {
            for (const one of part) if (!(await sendPart([one], fn))) return false
            return true
          }
          await svc.updateCeneoBids(part.map((r) => ({ id: r.id, error: errorText(err), error_at: at })))
          failed += part.length
          return !(await recordOutcome(svc, "bids", outcomeOf(err)))
        }
      }
      const send = async (rows: Row[], fn: (rows: Row[]) => Promise<void>) => {
        for (const part of chunks(rows, WRITE_BATCH)) if (!(await sendPart(part, fn))) return false
        return true
      }
      const go = await send(products, (rows) => transport.setProductBids(rows.map((r) => ({ ceneoProductId: String(r.ceneo_product_id), bid: Number(r.planned_bid) }))))
      if (go) await send(categories, (rows) => transport.setCategoryBids(rows.map((r) => ({ categoryId: String(r.key), bid: Number(r.planned_bid) }))))
      /* Read back what was set, and the next step. */
      const changed = products.map((r) => String(r.key))
      for (const part of chunks(changed, READ_BATCH)) {
        try {
          const back = new Map((await transport.productBids(part)).map((b) => [b.key, b]))
          for (const r of products.filter((x) => part.includes(String(x.key)))) {
            const [now] = await svc.listCeneoBids({ id: r.id }, { take: 1, select: BID_FIELDS })
            await svc.updateCeneoBids([{ id: r.id, ...readPatch(svc, now ?? r, back.get(String(r.key)), undefined, at) }])
          }
        } catch {
          /* The next run reads them again. */
        }
      }
      for (const r of categories) {
        const [now] = await svc.listCeneoBids({ id: r.id }, { take: 1, select: BID_FIELDS })
        if (now) await svc.updateCeneoBids([{ id: r.id, ...readPatch(svc, now, undefined, undefined, at) }])
      }
    })

    /* 3. The promotion writer: the texts that changed. */
    if (promoState.effective) await withRunLease(sql, "promo", CPC_LEASE_MS, async () => {
      const pending = await svc.listCeneoBids({ demo, promo_pending: true }, { take: 500, select: BID_FIELDS })
      for (const kind of ["product", "category"] as const) {
        const rows = pending.filter((r) => r.kind === kind)
        for (const batch of promoBatches(rows.map((r) => ({ key: String(r.key), promo: typeof r.promo_text === "string" ? r.promo_text : null })))) {
          const ids = rows.filter((r) => batch.keys.includes(String(r.key)))
          try {
            const refused = new Set(await transport.setPromo(kind, batch.keys, batch.text))
            const ok = ids.filter((r) => !refused.has(String(r.key)))
            /* Only rows whose text is still the one sent: a text changed meanwhile stays pending for the next run. */
            if (ok.length > 0) {
              await sql.raw(
                `update "${BID_TABLE}" set "promo_applied" = ?, "promo_pending" = false, "promo_at" = ?, "error" = null, "updated_at" = now()
                 where "id" in (${ok.map(() => "?").join(", ")}) and "promo_text" is not distinct from ? and "deleted_at" is null
                 returning "id"`,
                [batch.text, at, ...ok.map((r) => r.id), batch.text],
              ).then(rowsOf)
            }
            const no = ids.filter((r) => refused.has(String(r.key)))
            if (no.length > 0) await svc.updateCeneoBids(no.map((r) => ({ id: r.id, promo_pending: false, error: "Ceneo did not take the promotion text for this id.", error_at: at })))
            promosSent += ok.length
            failed += no.length
            await recordOutcome(svc, "promo", { kind: "ok" })
          } catch (err) {
            await svc.updateCeneoBids(ids.map((r) => ({ id: r.id, error: errorText(err), error_at: at })))
            failed += ids.length
            if (await recordOutcome(svc, "promo", outcomeOf(err))) return
          }
        }
      }
    })

    const out: CpcRunResult = { status: readError ? "failed" : "ran", read, bidsSent, promosSent, failed, error: readError, demo: transport.demo, duration_ms: Date.now() - started }
    if (bidsSent + promosSent + failed > 0) svc.getLogger().info(`[ceneo] CPC (${input.trigger ?? "schedule"}): ${read} read, ${bidsSent} bids set, ${promosSent} promotion texts, ${failed} failed.`)
    return out
  })
  return result ?? { status: "skipped", reason: "running" }
}

export interface TargetInput {
  kind: BidKind
  key: string
  /** Grosze; null clears the target; undefined leaves it. */
  targetBid?: number | null
  /** null removes the text; undefined leaves it. */
  promoText?: string | null
}

/** A person's targets and texts. The plan is recomputed at once; nothing is sent until the writers run. */
export async function setTargets(scope: Scope, items: TargetInput[], actor: string | null): Promise<number> {
  const svc = ceneoSvc(scope)
  const demo = svc.getOptions().demo
  const at = new Date()
  let n = 0
  for (const it of items) {
    const [prev] = await svc.listCeneoBids({ kind: it.kind, key: it.key, demo }, { take: 1, select: BID_FIELDS })
    const patch: Record<string, unknown> = {}
    if (it.targetBid !== undefined) {
      patch.target_bid = it.targetBid
      patch.target_by = actor
      patch.target_at = at
      const plan = planOf(svc, { current_bid: prev?.current_bid, target_bid: it.targetBid, min_suggested_bid: prev?.min_suggested_bid })
      patch.planned_bid = plan.next
      patch.plan_reasons = plan.reasons.length > 0 ? plan.reasons : null
    }
    if (it.promoText !== undefined) {
      patch.promo_text = it.promoText
      patch.promo_pending = (prev?.promo_applied ?? null) !== it.promoText
    }
    if (Object.keys(patch).length === 0) continue
    await upsert(svc, it.kind, it.key, demo, patch)
    n += 1
  }
  return n
}
