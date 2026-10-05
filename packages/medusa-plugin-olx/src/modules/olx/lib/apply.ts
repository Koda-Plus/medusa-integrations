/**
 * WHAT AN ARMED WRITER DOES WITH ITS PLAN. Pure orchestration with injected
 * calls (store and transport), so the unit tests drive it without a network
 * and the demo drives it against the simulation.
 *
 * FOR EVERY ITEM, IN THIS ORDER:
 *
 *   1. CLAIM. One atomic update takes the row (pending or failed to
 *      applying, with a token and a lease). A row another process holds is
 *      skipped.
 *   2. LOOK FIRST. The advert is read from OLX before anything is written.
 *      Already in the wanted state: done, nothing sent. No longer applicable
 *      (a person ended it, the price changed on OLX meanwhile): the row goes
 *      idle with a note and the snapshot learns the fresh fact.
 *   3. ONE WRITE. Never retried within a run.
 *   4. THE ANSWER DECIDES.
 *        ok          done; the advert is read again and the snapshot updated
 *        rejected    counted; quarantined after three in a row
 *        unknown     `unknown`: the next run reads the advert BEFORE deciding
 *        throttled   the row waits, the run stops (OLX is limiting us)
 *        auth        the row waits, the run stops (the token needs a person)
 *
 * PUBLISHING IS EXACTLY ONCE PER VARIANT on top of that: a unique row per
 * variant exists before anything goes out, every create is preceded by a
 * lookup of the SKU in `external_id` (`GET /adverts?external_id=`), an
 * unclear create answer is followed by a second lookup, and an `unknown` row
 * is created again only when a lookup a quarter of an hour later still finds
 * nothing.
 */

import { LEASE_MS, UNKNOWN_GRACE_MS } from "./constants"
import { classifyError, type ErrorClass } from "./errors"
import { COMMAND_TARGET, type LifecycleCommand } from "./lifecycle"
import { buildPriceUpdateBody, samePrice, type Money } from "./pricing"
import type { PlanItemStore, PublicationStore } from "./store"
import { afterRejection } from "./writers"

export interface AdvertSnapshot {
  status: string | null
  price: Money | null
  /** The whole advert as OLX returned it (needed to rebuild an update). */
  raw: unknown
}

export interface ItemResult {
  id: string
  olxId: string | null
  variantId: string | null
  action: string
  outcome: "done" | "adopted" | "skipped" | "failed" | "quarantined" | "unknown" | "busy" | "waiting" | "planned"
  detail: string | null
}

export interface ApplyReport {
  attempted: number
  succeeded: number
  failed: number
  quarantined: number
  unknown: number
  skipped: number
  busy: number
  stoppedBy: null | "throttled" | "auth" | "errors" | "blocked"
  items: ItemResult[]
}

export function emptyReport(): ApplyReport {
  return { attempted: 0, succeeded: 0, failed: 0, quarantined: 0, unknown: 0, skipped: 0, busy: 0, stoppedBy: null, items: [] }
}

export interface ApplyClock {
  now: () => Date
  newToken: () => string
  sleep?: (ms: number) => Promise<void>
  /** Mask secrets in messages that are stored. */
  mask?: (text: string) => string
}

function message(err: unknown, mask?: (t: string) => string): string {
  const text = err instanceof Error ? err.message : String(err)
  return (mask ? mask(text) : text).slice(0, 500)
}

function stopFor(cls: ErrorClass): ApplyReport["stoppedBy"] {
  if (cls === "throttled") return "throttled"
  if (cls === "auth") return "auth"
  if (cls === "blocked_by_plugin") return "blocked"
  return null
}

function add(report: ApplyReport, r: ItemResult): void {
  report.items.push(r)
  if (r.outcome === "done" || r.outcome === "adopted") report.succeeded += 1
  else if (r.outcome === "failed") report.failed += 1
  else if (r.outcome === "quarantined") report.quarantined += 1
  else if (r.outcome === "unknown") report.unknown += 1
  else if (r.outcome === "busy") report.busy += 1
  else if (r.outcome === "skipped") report.skipped += 1
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export interface PlanItem {
  id: string
  olx_id: string
  action: string
  state: string
  attempts: number
  to_value: unknown
  from_value: unknown
  variant_id: string | null
  unknown_since?: Date | string | null
}

export interface LifecycleTransport {
  read(olxId: string): Promise<AdvertSnapshot | null>
  command(olxId: string, command: LifecycleCommand, isSuccess: boolean): Promise<void>
}

export interface LifecycleDeps extends ApplyClock {
  store: PlanItemStore
  transport: LifecycleTransport
  /** `is_success` of deactivate (whether the item sold through OLX). */
  isSuccess: boolean
  /** Fresh facts about an advert, for the snapshot. */
  onAdvert?: (olxId: string, snapshot: AdvertSnapshot) => Promise<void>
}

/** Whether the advert already is where the command would take it. */
export function lifecycleReached(command: LifecycleCommand, status: string | null): boolean {
  if (!status) return false
  if (command === "deactivate") return status !== "active" && status !== "new"
  if (command === "activate") return status === "active" || status === "new"
  return status !== "limited"
}

/** Whether the command still makes sense for the advert in this status. */
export function lifecycleApplicable(command: LifecycleCommand, status: string | null): boolean {
  if (command === "deactivate") return status === "active"
  if (command === "activate") return status === "removed_by_user"
  return status === "limited"
}

function pausePatch(command: LifecycleCommand, now: Date): { paused_at: Date | null } {
  return { paused_at: command === "deactivate" ? now : null }
}

export async function applyLifecycle(items: readonly PlanItem[], deps: LifecycleDeps): Promise<ApplyReport> {
  const report = emptyReport()
  let readErrors = 0
  for (const item of items) {
    const command = item.action as LifecycleCommand
    const base = { id: item.id, olxId: item.olx_id, variantId: item.variant_id, action: command }
    const now = deps.now()
    const token = deps.newToken()
    const claimed = await deps.store.claim(item.id, { now, leaseUntil: new Date(now.getTime() + LEASE_MS), token })
    if (!claimed) {
      add(report, { ...base, outcome: "busy", detail: null })
      continue
    }
    const back = item.state === "failed" ? "failed" : "pending"

    let before: AdvertSnapshot | null
    try {
      before = await deps.transport.read(item.olx_id)
      readErrors = 0
    } catch (err) {
      const cls = classifyError(err)
      await deps.store.finish(item.id, token, { state: back, last_error: message(err, deps.mask) })
      add(report, { ...base, outcome: "waiting", detail: message(err, deps.mask) })
      report.stoppedBy = stopFor(cls)
      if (report.stoppedBy) break
      readErrors += 1
      if (readErrors >= 3) {
        report.stoppedBy = "errors"
        break
      }
      continue
    }
    if (!before) {
      await deps.store.finish(item.id, token, { state: "idle", attempts: 0, note: "advert_gone", last_error: null })
      add(report, { ...base, outcome: "skipped", detail: "advert_gone" })
      continue
    }
    if (deps.onAdvert) await deps.onAdvert(item.olx_id, before).catch(() => undefined)
    if (!lifecycleApplicable(command, before.status)) {
      if (command === "activate" && lifecycleReached(command, before.status)) {
        await deps.store.finish(item.id, token, { state: "done", attempts: 0, done_at: now, note: "already_done", last_error: null, paused_at: null })
        add(report, { ...base, outcome: "adopted", detail: before.status })
      } else {
        await deps.store.finish(item.id, token, {
          state: "idle",
          attempts: 0,
          note: `status:${before.status ?? "unknown"}`,
          last_error: null,
          ...(command === "activate" ? { paused_at: null } : {}),
        })
        add(report, { ...base, outcome: "skipped", detail: before.status })
      }
      continue
    }

    report.attempted += 1
    try {
      await deps.transport.command(item.olx_id, command, deps.isSuccess)
    } catch (err) {
      const cls = classifyError(err)
      const text = message(err, deps.mask)
      if (cls === "rejected") {
        const next = afterRejection(item.attempts)
        await deps.store.finish(item.id, token, { ...next, last_error: text })
        add(report, { ...base, outcome: next.state, detail: text })
        continue
      }
      if (cls === "not_found") {
        await deps.store.finish(item.id, token, { state: "idle", attempts: 0, note: "advert_gone", last_error: null })
        add(report, { ...base, outcome: "skipped", detail: "advert_gone" })
        continue
      }
      const stop = stopFor(cls)
      if (stop) {
        await deps.store.finish(item.id, token, { state: back, last_error: text })
        add(report, { ...base, outcome: "waiting", detail: text })
        report.stoppedBy = stop
        break
      }
      await deps.store.finish(item.id, token, { state: "unknown", unknown_since: now, last_error: text })
      add(report, { ...base, outcome: "unknown", detail: text })
      continue
    }

    let after: AdvertSnapshot | null = null
    try {
      after = await deps.transport.read(item.olx_id)
    } catch {
      after = null
    }
    if (after && deps.onAdvert) await deps.onAdvert(item.olx_id, after).catch(() => undefined)
    await deps.store.finish(item.id, token, {
      state: "done",
      attempts: 0,
      done_at: now,
      last_error: null,
      note: after?.status ? `status:${after.status}` : null,
      ...pausePatch(command, now),
    })
    add(report, { ...base, outcome: "done", detail: after?.status ?? COMMAND_TARGET[command] })
  }
  return report
}

/** Unknown lifecycle rows: read the advert, then decide. Never writes to OLX. */
export async function reconcileLifecycle(items: readonly PlanItem[], deps: LifecycleDeps): Promise<ApplyReport> {
  const report = emptyReport()
  for (const item of items) {
    const command = item.action as LifecycleCommand
    const base = { id: item.id, olxId: item.olx_id, variantId: item.variant_id, action: command }
    let snap: AdvertSnapshot | null
    try {
      snap = await deps.transport.read(item.olx_id)
    } catch (err) {
      const stop = stopFor(classifyError(err))
      add(report, { ...base, outcome: "unknown", detail: message(err, deps.mask) })
      if (stop) {
        report.stoppedBy = stop
        break
      }
      continue
    }
    const now = deps.now()
    if (!snap) {
      await deps.store.transition(item.id, ["unknown"], { state: "idle", attempts: 0, note: "advert_gone" })
      add(report, { ...base, outcome: "skipped", detail: "advert_gone" })
      continue
    }
    if (deps.onAdvert) await deps.onAdvert(item.olx_id, snap).catch(() => undefined)
    if (lifecycleReached(command, snap.status)) {
      await deps.store.transition(item.id, ["unknown"], {
        state: "done",
        attempts: 0,
        done_at: now,
        last_error: null,
        note: `status:${snap.status}`,
        ...pausePatch(command, now),
      })
      add(report, { ...base, outcome: "adopted", detail: snap.status })
    } else {
      await deps.store.transition(item.id, ["unknown"], { state: "pending", note: "not_applied", last_error: null })
      add(report, { ...base, outcome: "planned", detail: snap.status })
    }
  }
  return report
}

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

export interface PriceTransport {
  read(olxId: string): Promise<AdvertSnapshot | null>
  put(olxId: string, body: Record<string, unknown>): Promise<AdvertSnapshot | null>
}

export interface PriceDeps extends ApplyClock {
  store: PlanItemStore
  transport: PriceTransport
  onAdvert?: (olxId: string, snapshot: AdvertSnapshot) => Promise<void>
}

function moneyOf(v: unknown): Money | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  const value = Number(o.value)
  const currency = typeof o.currency === "string" ? o.currency.toUpperCase() : ""
  return Number.isFinite(value) && currency ? { value, currency } : null
}

export async function applyPrices(items: readonly PlanItem[], deps: PriceDeps): Promise<ApplyReport> {
  const report = emptyReport()
  let readErrors = 0
  for (const item of items) {
    const base = { id: item.id, olxId: item.olx_id, variantId: item.variant_id, action: "price" }
    const to = moneyOf(item.to_value)
    const from = moneyOf(item.from_value)
    const now = deps.now()
    const token = deps.newToken()
    const claimed = await deps.store.claim(item.id, { now, leaseUntil: new Date(now.getTime() + LEASE_MS), token })
    if (!claimed) {
      add(report, { ...base, outcome: "busy", detail: null })
      continue
    }
    const back = item.state === "failed" ? "failed" : "pending"
    if (!to) {
      await deps.store.finish(item.id, token, { state: "idle", note: "no_target" })
      add(report, { ...base, outcome: "skipped", detail: "no_target" })
      continue
    }

    let before: AdvertSnapshot | null
    try {
      before = await deps.transport.read(item.olx_id)
      readErrors = 0
    } catch (err) {
      const cls = classifyError(err)
      await deps.store.finish(item.id, token, { state: back, last_error: message(err, deps.mask) })
      add(report, { ...base, outcome: "waiting", detail: message(err, deps.mask) })
      report.stoppedBy = stopFor(cls)
      if (report.stoppedBy) break
      readErrors += 1
      if (readErrors >= 3) {
        report.stoppedBy = "errors"
        break
      }
      continue
    }
    if (!before) {
      await deps.store.finish(item.id, token, { state: "idle", attempts: 0, note: "advert_gone", last_error: null })
      add(report, { ...base, outcome: "skipped", detail: "advert_gone" })
      continue
    }
    if (deps.onAdvert) await deps.onAdvert(item.olx_id, before).catch(() => undefined)
    if (before.status !== "active") {
      await deps.store.finish(item.id, token, { state: "idle", attempts: 0, note: `status:${before.status ?? "unknown"}`, last_error: null })
      add(report, { ...base, outcome: "skipped", detail: before.status })
      continue
    }
    if (before.price && samePrice(before.price.value, to.value)) {
      await deps.store.finish(item.id, token, { state: "done", attempts: 0, done_at: now, note: "already_done", last_error: null })
      add(report, { ...base, outcome: "adopted", detail: null })
      continue
    }
    if (!before.price || !from || !samePrice(before.price.value, from.value)) {
      await deps.store.finish(item.id, token, { state: "idle", attempts: 0, note: "price_changed_on_olx", last_error: null })
      add(report, { ...base, outcome: "skipped", detail: "price_changed_on_olx" })
      continue
    }
    const built = buildPriceUpdateBody(before.raw, to.value)
    if (!built.ok) {
      const next = afterRejection(item.attempts)
      await deps.store.finish(item.id, token, { ...next, last_error: built.error })
      add(report, { ...base, outcome: next.state, detail: built.error })
      continue
    }

    report.attempted += 1
    let after: AdvertSnapshot | null
    try {
      after = await deps.transport.put(item.olx_id, built.body)
    } catch (err) {
      const cls = classifyError(err)
      const text = message(err, deps.mask)
      if (cls === "rejected") {
        const next = afterRejection(item.attempts)
        await deps.store.finish(item.id, token, { ...next, last_error: text })
        add(report, { ...base, outcome: next.state, detail: text })
        continue
      }
      if (cls === "not_found") {
        await deps.store.finish(item.id, token, { state: "idle", attempts: 0, note: "advert_gone", last_error: null })
        add(report, { ...base, outcome: "skipped", detail: "advert_gone" })
        continue
      }
      const stop = stopFor(cls)
      if (stop) {
        await deps.store.finish(item.id, token, { state: back, last_error: text })
        add(report, { ...base, outcome: "waiting", detail: text })
        report.stoppedBy = stop
        break
      }
      await deps.store.finish(item.id, token, { state: "unknown", unknown_since: now, last_error: text })
      add(report, { ...base, outcome: "unknown", detail: text })
      continue
    }
    const fresh = after ?? { ...before, price: { value: to.value, currency: to.currency } }
    if (deps.onAdvert) await deps.onAdvert(item.olx_id, fresh).catch(() => undefined)
    await deps.store.finish(item.id, token, { state: "done", attempts: 0, done_at: now, last_error: null, note: fresh.status ? `status:${fresh.status}` : null })
    add(report, { ...base, outcome: "done", detail: null })
  }
  return report
}

/** Unknown price rows: read the advert; the new price there means done, anything else waits for the next run. */
export async function reconcilePrices(items: readonly PlanItem[], deps: PriceDeps): Promise<ApplyReport> {
  const report = emptyReport()
  for (const item of items) {
    const base = { id: item.id, olxId: item.olx_id, variantId: item.variant_id, action: "price" }
    const to = moneyOf(item.to_value)
    let snap: AdvertSnapshot | null
    try {
      snap = await deps.transport.read(item.olx_id)
    } catch (err) {
      const stop = stopFor(classifyError(err))
      add(report, { ...base, outcome: "unknown", detail: message(err, deps.mask) })
      if (stop) {
        report.stoppedBy = stop
        break
      }
      continue
    }
    if (!snap) {
      await deps.store.transition(item.id, ["unknown"], { state: "idle", attempts: 0, note: "advert_gone" })
      add(report, { ...base, outcome: "skipped", detail: "advert_gone" })
      continue
    }
    if (deps.onAdvert) await deps.onAdvert(item.olx_id, snap).catch(() => undefined)
    if (to && snap.price && samePrice(snap.price.value, to.value)) {
      await deps.store.transition(item.id, ["unknown"], { state: "done", attempts: 0, done_at: deps.now(), last_error: null, note: "already_done" })
      add(report, { ...base, outcome: "adopted", detail: null })
    } else {
      await deps.store.transition(item.id, ["unknown"], { state: "pending", note: "not_applied", last_error: null })
      add(report, { ...base, outcome: "planned", detail: null })
    }
  }
  return report
}

/* ------------------------------------------------------------------ */
/* Publishing, exactly once per variant                                */
/* ------------------------------------------------------------------ */

export interface PublicationItem {
  id: string
  variant_id: string
  sku: string
  state: string
  attempts: number
  payload: unknown
  unknown_since?: Date | string | null
}

export interface FoundAdvert {
  olxId: string
  url: string | null
  status: string | null
  externalId: string | null
}

export interface PublishTransport {
  /** `GET /adverts?external_id=`. */
  findByExternalId(externalId: string): Promise<FoundAdvert[]>
  /** `POST /adverts`. */
  create(payload: Record<string, unknown>): Promise<FoundAdvert>
}

export interface PublishDeps extends ApplyClock {
  store: PublicationStore
  transport: PublishTransport
  /** Pause before the second lookup after an unclear create. */
  rescanDelayMs?: number
  onPublished?: (item: PublicationItem, advert: FoundAdvert) => Promise<void>
}

export function sameKey(a: string | null | undefined, b: string | null | undefined): boolean {
  return String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase() && String(a ?? "").trim() !== ""
}

async function lookup(deps: PublishDeps, sku: string): Promise<FoundAdvert | null> {
  const found = await deps.transport.findByExternalId(sku)
  return found.find((f) => sameKey(f.externalId, sku)) ?? null
}

function publishedPatch(advert: FoundAdvert, now: Date, adopted: boolean): Record<string, unknown> {
  return {
    state: "published",
    olx_id: advert.olxId,
    olx_url: advert.url,
    olx_status: advert.status,
    adopted,
    published_at: now,
    last_error: null,
    unknown_since: null,
    note: adopted ? "adopted" : null,
  }
}

export async function publishOnce(items: readonly PublicationItem[], deps: PublishDeps): Promise<ApplyReport> {
  const report = emptyReport()
  for (const item of items) {
    const base = { id: item.id, olxId: null, variantId: item.variant_id, action: "publish" }
    const now = deps.now()
    const token = deps.newToken()
    const claimed = await deps.store.claim(item.id, { now, leaseUntil: new Date(now.getTime() + LEASE_MS), token })
    if (!claimed) {
      add(report, { ...base, outcome: "busy", detail: null })
      continue
    }
    const back = item.state === "failed" ? "failed" : "planned"
    const payload = item.payload && typeof item.payload === "object" ? (item.payload as Record<string, unknown>) : null
    if (!payload) {
      await deps.store.finish(item.id, token, { state: "blocked", note: "no_payload" })
      add(report, { ...base, outcome: "skipped", detail: "no_payload" })
      continue
    }

    let existing: FoundAdvert | null
    try {
      existing = await lookup(deps, item.sku)
    } catch (err) {
      const text = message(err, deps.mask)
      await deps.store.finish(item.id, token, { state: back, last_error: text })
      add(report, { ...base, outcome: "waiting", detail: text })
      report.stoppedBy = stopFor(classifyError(err)) ?? "errors"
      break
    }
    if (existing) {
      await deps.store.finish(item.id, token, publishedPatch(existing, now, true))
      if (deps.onPublished) await deps.onPublished(item, existing).catch(() => undefined)
      add(report, { ...base, olxId: existing.olxId, outcome: "adopted", detail: existing.status })
      continue
    }

    report.attempted += 1
    try {
      const created = await deps.transport.create(payload)
      await deps.store.finish(item.id, token, publishedPatch(created, now, false))
      if (deps.onPublished) await deps.onPublished(item, created).catch(() => undefined)
      add(report, { ...base, olxId: created.olxId, outcome: "done", detail: created.status })
    } catch (err) {
      const cls = classifyError(err)
      const text = message(err, deps.mask)
      if (cls === "rejected" || cls === "not_found") {
        const next = afterRejection(item.attempts)
        await deps.store.finish(item.id, token, { ...next, last_error: text })
        add(report, { ...base, outcome: next.state, detail: text })
        continue
      }
      const stop = stopFor(cls)
      if (stop) {
        await deps.store.finish(item.id, token, { state: back, last_error: text })
        add(report, { ...base, outcome: "waiting", detail: text })
        report.stoppedBy = stop
        break
      }
      /* Unclear: the advert may exist. Look again before deciding anything. */
      if (deps.sleep) await deps.sleep(deps.rescanDelayMs ?? 5000)
      let after: FoundAdvert | null = null
      try {
        after = await lookup(deps, item.sku)
      } catch {
        after = null
      }
      if (after) {
        await deps.store.finish(item.id, token, publishedPatch(after, now, true))
        if (deps.onPublished) await deps.onPublished(item, after).catch(() => undefined)
        add(report, { ...base, olxId: after.olxId, outcome: "adopted", detail: after.status })
      } else {
        await deps.store.finish(item.id, token, { state: "unknown", unknown_since: now, last_error: text })
        add(report, { ...base, outcome: "unknown", detail: text })
      }
    }
  }
  return report
}

/** Unknown publications: adopt what OLX has, and allow a new create only after the grace period. */
export async function reconcilePublications(items: readonly PublicationItem[], deps: PublishDeps): Promise<ApplyReport> {
  const report = emptyReport()
  for (const item of items) {
    const base = { id: item.id, olxId: null, variantId: item.variant_id, action: "publish" }
    let found: FoundAdvert | null
    try {
      found = await lookup(deps, item.sku)
    } catch (err) {
      const stop = stopFor(classifyError(err))
      add(report, { ...base, outcome: "unknown", detail: message(err, deps.mask) })
      if (stop) {
        report.stoppedBy = stop
        break
      }
      continue
    }
    const now = deps.now()
    if (found) {
      await deps.store.transition(item.id, ["unknown"], publishedPatch(found, now, true))
      if (deps.onPublished) await deps.onPublished(item, found).catch(() => undefined)
      add(report, { ...base, olxId: found.olxId, outcome: "adopted", detail: found.status })
      continue
    }
    const since = item.unknown_since ? new Date(item.unknown_since).getTime() : 0
    if (Number.isFinite(since) && since > 0 && now.getTime() - since < UNKNOWN_GRACE_MS) {
      add(report, { ...base, outcome: "unknown", detail: "grace" })
      continue
    }
    await deps.store.transition(item.id, ["unknown"], { state: "planned", note: "not_created", last_error: null, unknown_since: null })
    add(report, { ...base, outcome: "planned", detail: "not_created" })
  }
  return report
}
