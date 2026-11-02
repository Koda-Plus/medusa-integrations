/**
 * RESOLVING WHAT IS UNCLEAR, AND THE PERIODIC PASS.
 *
 * An `unknown` row (no clear answer to generatePackagesNumbers, or a lease
 * that ran out) is looked up by its reference with generateSpedLabels: DPD
 * finds one shipment per reference, so the answer is either the shipment
 * (its waybills and label are taken over) or "not found" (the row goes back
 * to pending and may be created again with the same reference; a shipment
 * DPD had after all answers as a duplicate and is adopted then). The lookup
 * advises the parcels, so it runs only with the shipment writer armed, and
 * only after the row settled (UNKNOWN_SETTLE_MS after it last changed).
 *
 * A person decides what a lookup cannot: `ambiguous` rows are accepted (the
 * waybills DPD gave become the row's) or skipped (shipped outside Medusa).
 *
 * The pass (job every 5 minutes): old documents removed, leases that ran out
 * taken back, unclear rows looked up, and with autoCreate the new pending
 * rows created (and the ones the pacing held back) and the labels that did
 * not come asked for again. Only rows recorded after the writer was armed
 * and within autoCreateMaxAgeHours: no backlog is ever sent by itself.
 */

import { randomUUID } from "node:crypto"
import { AUTO_BATCH, AUTO_LABEL_MAX_ATTEMPTS, CREATE_LEASE_MS, LOOKUP_BATCH, UNKNOWN_SETTLE_MS } from "../../modules/dpd/lib/constants"
import { readStoredBoxes } from "../../modules/dpd/lib/boxes"
import type { LabelsOutcome } from "../../modules/dpd/lib/dpd-answers"
import { labelsRequest, nothingSent } from "../../modules/dpd/lib/dpdservices"
import { waybillsOf, type ShipmentRow } from "../../modules/dpd/lib/dto"
import { canCallDpd } from "../../modules/dpd/lib/options"
import type { ShipmentPatch } from "../../modules/dpd/lib/store"
import { boxesWithWaybills, createAttempt, deferredCode, labelAttempt, mustFind, sourceOf, type Trigger } from "./create"
import { latestLabel, saveLabel } from "./documents"
import { refreshProblems } from "./plan"
import {
  ActionError,
  annotateFulfillment,
  clientFor,
  dpdService,
  errorText,
  exclusive,
  listShipments,
  loadOrder,
  recordEvent,
  requireArmed,
  settingsOf,
  storeFor,
  writerStates,
  type Scope,
} from "./runtime"

function time(v: unknown): number {
  if (v instanceof Date) return v.getTime()
  if (typeof v === "string" || typeof v === "number") return new Date(v).getTime()
  return Number.NaN
}

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

export async function lookupShipment(scope: Scope, id: string, input: { actor: string | null; trigger: Trigger; now?: Date }): Promise<ShipmentRow> {
  return (await lookupAttempt(scope, id, input)).row
}

/**
 * lookupShipment, saying whether DPD was asked (false: an auto lookup of a
 * row that has not settled yet returns it untouched, or the pacing sent
 * nothing and the row went back as it was). `input.now` is only the clock
 * of the settle check; the lease runs from the claim.
 */
export async function lookupAttempt(scope: Scope, id: string, input: { actor: string | null; trigger: Trigger; now?: Date }): Promise<{ row: ShipmentRow; checked: boolean }> {
  const svc = dpdService(scope)
  const mode = svc.mode()
  const row = await mustFind(scope, id)
  if (row.state !== "unknown" && row.state !== "abandoned_unknown") throw new ActionError(409, "wrong_state", `The shipment is ${row.state}: only an unclear shipment is checked in DPD.`)
  /* Waybills mean DPD answered already: a second lookup would only advise the parcels again. */
  if (waybillsOf(row.waybills).length > 0) throw new ActionError(409, "wrong_state", "DPD already gave the waybills of this shipment; nothing to check.")
  await requireArmed(scope, "shipment")
  const client = clientFor(scope)
  if (!client) throw new ActionError(409, "not_configured", `DPD is not configured: ${svc.missingOptions().join(", ")}.`)
  const now = input.now ?? new Date()
  const changed = time(row.updated_at)
  const wait = Number.isFinite(changed) ? changed + UNKNOWN_SETTLE_MS - now.getTime() : 0
  if (wait > 0) {
    if (input.trigger === "auto") return { row, checked: false }
    throw new ActionError(409, "too_early", `Wait ${Math.ceil(wait / 1000)} seconds before checking in DPD: an answer may still be on its way.`)
  }
  const store = storeFor(scope)
  const token = randomUUID()
  /* The lease runs from the claim, not from the pass that started earlier (or a clock given for the settle check). */
  const claimed = await store.claim(row.id, ["unknown", "abandoned_unknown"], { token, leaseUntil: new Date(Date.now() + CREATE_LEASE_MS), to: "creating" })
  if (!claimed) throw new ActionError(409, "busy", "Another process is checking this shipment right now.")

  const order = row.order_id ? await loadOrder(scope, row.order_id) : null
  const f = row.fulfillment_id ? (order?.fulfillments ?? []).find((x) => x.id === row.fulfillment_id) : undefined
  const fulfillmentCanceled = Boolean(f?.canceled_at) || order?.status === "canceled" || row.state === "abandoned_unknown"
  const page = (await settingsOf(svc)).labelPage
  /* Only the reference finds a shipment that may not have numbers yet; without one there is nothing DPD could have under it. */
  const reference = row.reference ?? row.fulfillment_id ?? null
  let outcome: LabelsOutcome
  if (!reference) {
    outcome = { kind: "not_found", traceId: null, httpStatus: 0 }
  } else {
    try {
      outcome = await client.generateSpedLabels(labelsRequest({ packageReference: reference }, page))
    } catch (err) {
      outcome = { kind: "unclear", code: "network", message: errorText(svc, err).slice(0, 1000), traceId: null, httpStatus: 0 }
    }
  }

  if (nothingSent(outcome)) {
    /*
     * The pacing sent nothing: the row goes back as it was (state, error,
     * attempts and the settle clock); the pass looks an unclear row up
     * anyway. A person who asked sees rate_limited_manual instead of the
     * earlier error, until the next lookup.
     */
    const code = deferredCode(input.trigger)
    const before = time(row.updated_at)
    const finished = await store.finish(
      row.id,
      token,
      {
        state: fulfillmentCanceled && row.state === "unknown" ? "abandoned_unknown" : row.state,
        error: code === "rate_limited" ? row.error : outcome.kind === "refused" ? svc.mask(outcome.message) : null,
        error_code: code === "rate_limited" ? row.error_code : code,
      },
      { unsent: { updatedAt: Number.isFinite(before) ? new Date(before) : null } },
    )
    if (!finished) {
      const [now2] = await listShipments(svc, { id: row.id }, { take: 1 })
      return { row: now2 ?? claimed, checked: false }
    }
    await recordEvent(scope, {
      shipment_id: row.id,
      order_id: row.order_id,
      kind: "action",
      source: sourceOf(input.actor),
      actor: input.actor,
      message: "Not checked in DPD yet: too many DPD calls from this server right now.",
      data: { action: "lookup_deferred", code, trigger: input.trigger },
      mode,
    })
    return { row: finished, checked: false }
  }

  let patch: ShipmentPatch & { state: string }
  let result: string
  if (outcome.kind === "ok") {
    await saveLabel(scope, claimed, { pdfBase64: outcome.pdfBase64, page, documentId: outcome.documentId, actor: input.actor })
    const boxes = boxesWithWaybills(claimed.boxes, outcome.waybills)
    const expected = readStoredBoxes(claimed.boxes)?.items.length
    if (outcome.waybills.length === 0) {
      /* DPD found something under the reference but named no waybill: nothing to adopt or exclude, a person checks it. */
      result = "waybill_count_mismatch"
      patch = {
        state: "ambiguous",
        waybills: [],
        boxes,
        error: `DPD found a shipment under this reference but gave no waybills, ${expected ?? "an unknown number of"} box${expected === 1 ? " was" : "es were"} sent. Check the shipment in DPD, then mark it shipped outside Medusa if it is not to go.`,
        error_code: "waybill_count_mismatch",
      }
    } else if (fulfillmentCanceled) {
      result = "abandoned_found"
      patch = {
        state: "abandoned_unknown",
        waybills: outcome.waybills,
        boxes,
        error: `The fulfillment is canceled, but the shipment exists in DPD (${outcome.waybills.join(", ")}): exclude it from the handover to the courier.`,
        error_code: "abandoned_found",
      }
    } else {
      const matches = expected === outcome.waybills.length
      result = matches ? "adopted" : "waybill_count_mismatch"
      patch = matches
        ? { state: "labeled", waybills: outcome.waybills, boxes, error: null, error_code: "adopted" }
        : {
            state: "ambiguous",
            waybills: outcome.waybills,
            boxes,
            error: `DPD has ${outcome.waybills.length} box${outcome.waybills.length === 1 ? "" : "es"} under this reference, ${expected ?? "an unknown number"} were sent. Check the shipment in DPD, then accept its waybills or mark it shipped outside Medusa.`,
            error_code: "waybill_count_mismatch",
          }
    }
  } else if (outcome.kind === "not_found") {
    result = "not_created"
    patch = fulfillmentCanceled
      ? { state: "canceled", error: "DPD has no shipment under this reference and the fulfillment is canceled.", error_code: "not_created" }
      : { state: "pending", error: "DPD has no shipment under this reference; it can be created again.", error_code: "not_created" }
  } else {
    result = "lookup_failed"
    patch = {
      state: fulfillmentCanceled ? "abandoned_unknown" : "unknown",
      error: `Checking in DPD failed (${outcome.code}): ${svc.mask(outcome.message)} It is tried again later.`,
      error_code: "lookup_failed",
    }
  }
  const finished = await store.finish(row.id, token, patch)
  if (!finished) {
    const [now2] = await listShipments(svc, { id: row.id }, { take: 1 })
    return { row: now2 ?? claimed, checked: true }
  }
  await recordEvent(scope, {
    shipment_id: row.id,
    order_id: row.order_id,
    kind: "action",
    source: sourceOf(input.actor),
    actor: input.actor,
    message:
      outcome.kind === "ok"
        ? outcome.waybills.length > 0
          ? `Checked in DPD: the shipment exists (${outcome.waybills.join(", ")}), now ${finished.state}.`
          : `Checked in DPD: a shipment exists under the reference without waybills, now ${finished.state}.`
        : outcome.kind === "not_found"
          ? `Checked in DPD: no shipment under the reference, now ${finished.state}.`
          : `Checking in DPD failed (${outcome.code}); tried again later.`,
    data: { action: "lookup", outcome: result, state: finished.state, trigger: input.trigger, traceId: outcome.traceId },
    mode,
  })
  if (finished.state === "labeled") await annotateFulfillment(scope, finished)
  if (finished.state === "pending") return { row: await refreshProblems(scope, finished), checked: true }
  return { row: finished, checked: true }
}

/* ------------------------------------------------------------------ */
/* What a person decides                                               */
/* ------------------------------------------------------------------ */

/** Shipped outside Medusa: a row not sent (pending, failed) or one a person gave up on (ambiguous). */
export async function skipShipment(scope: Scope, id: string, actor: string | null): Promise<ShipmentRow> {
  const svc = dpdService(scope)
  const row = await mustFind(scope, id)
  const moved = await storeFor(scope).transition(row.id, ["pending", "failed", "ambiguous"], { state: "skipped" })
  if (!moved) throw new ActionError(409, "wrong_state", `The shipment is ${row.state}: only a shipment not created, refused or not matching DPD is marked as shipped outside Medusa.`)
  await recordEvent(scope, {
    shipment_id: row.id,
    order_id: row.order_id,
    kind: "action",
    source: sourceOf(actor),
    actor,
    message: `Marked as shipped outside Medusa (was ${row.state}).`,
    data: { action: "skipped", previous: row.state },
    mode: svc.mode(),
  })
  return moved
}

/** ambiguous with waybills: the waybills DPD gave become the row's; labeled when a label is stored, else created (the label is asked for then). */
export async function acceptShipment(scope: Scope, id: string, actor: string | null): Promise<ShipmentRow> {
  const svc = dpdService(scope)
  const row = await mustFind(scope, id)
  if (row.state !== "ambiguous") throw new ActionError(409, "wrong_state", `The shipment is ${row.state}: only a shipment not matching DPD is accepted.`)
  if (waybillsOf(row.waybills).length === 0) throw new ActionError(409, "wrong_state", "DPD gave no waybills for this shipment: there is nothing to accept. Check it in DPD, or mark it shipped outside Medusa.")
  const label = await latestLabel(scope, row.id)
  const moved = await storeFor(scope).transition(row.id, ["ambiguous"], { state: label ? "labeled" : "created", error: null, error_code: null })
  if (!moved) throw new ActionError(409, "wrong_state", "The shipment changed a moment ago; read it again.")
  await recordEvent(scope, {
    shipment_id: row.id,
    order_id: row.order_id,
    kind: "action",
    source: sourceOf(actor),
    actor,
    message: `The waybills from DPD were accepted: ${waybillsOf(row.waybills).join(", ")}.`,
    data: { action: "accepted", state: moved.state, previousCode: row.error_code },
    mode: svc.mode(),
  })
  await annotateFulfillment(scope, moved)
  return moved
}

/* ------------------------------------------------------------------ */
/* The pass                                                            */
/* ------------------------------------------------------------------ */

export type PassResult = { purged: number; expired: number; lookedUp: number; created: number; labeled: number; ran: boolean }

const LIST_TAKE = 200
/** Codes of a `created` row whose label the pass asks for again: no clear answer, a lease that ran out, or the pacing that sent nothing (never rate_limited_manual: a person asked, a person asks again). */
const AUTO_LABEL_CODES: readonly string[] = ["label_unclear", "label_lease_expired", "rate_limited"]
/** The code of a row whose create a person asked for and the pacing held back: the pass leaves it to the person. */
const MANUAL_DEFERRED = deferredCode("manual")

async function purgeDocuments(scope: Scope, now: Date): Promise<number> {
  const svc = dpdService(scope)
  const o = svc.getOptions()
  const before = now.getTime() - o.documentRetentionDays * 86_400_000
  const rows = await svc.listDpdDocuments({ mode: svc.mode() }, { take: LIST_TAKE, select: ["id", "created_at"], order: { created_at: "ASC" } })
  const old = rows.filter((r) => time(r.created_at) < before).map((r) => r.id)
  if (old.length === 0) return 0
  await svc.deleteDpdDocuments(old)
  svc.getLogger().info(`[dpd] Pass: ${old.length} documents older than ${o.documentRetentionDays} days removed.`)
  return old.length
}

export async function runShipmentPass(scope: Scope, now: Date = new Date()): Promise<PassResult> {
  const idle: PassResult = { purged: 0, expired: 0, lookedUp: 0, created: 0, labeled: 0, ran: false }
  const svc = dpdService(scope)
  const o = svc.getOptions()
  const configured = o.demo || canCallDpd(o)
  const result = await exclusive("pass", async (): Promise<PassResult> => {
    const out: PassResult = { ...idle, ran: configured }
    const mode = svc.mode()
    const logger = svc.getLogger()
    const safely = async (label: string, work: () => Promise<unknown>): Promise<boolean> => {
      try {
        await work()
        return true
      } catch (err) {
        logger.warn(`[dpd] Pass, ${label}: ${errorText(svc, err)}`)
        return false
      }
    }

    /* No DPD call: old labels go also while DPD is not configured. */
    await safely("documents", async () => {
      out.purged = await purgeDocuments(scope, now)
    })
    if (!configured) return out

    const expired = await storeFor(scope).expireLeases(mode, now)
    out.expired = expired.length
    for (const r of expired) {
      const lease = r.state === "unknown"
      await recordEvent(scope, {
        shipment_id: r.id,
        order_id: r.order_id,
        kind: "action",
        source: "system",
        message: lease ? "No answer from DPD within the lease: the shipment is looked up before anything is sent again." : "Getting the label took longer than its lease; it can be asked for again.",
        data: { action: lease ? "lease_expired" : "label_lease_expired", state: r.state },
        mode,
      })
    }

    const writers = await writerStates(svc)
    if (!writers.shipment.armed) return out

    /*
     * Settled unclear rows without waybills. An abandoned_unknown row DPD
     * already found (abandoned_found, with waybills) is never looked up
     * again, so the query leaves it out: a pile of them never hides the rows
     * that still need a lookup.
     */
    const settled = now.getTime() - UNKNOWN_SETTLE_MS
    const unclear = (
      await listShipments(
        svc,
        {
          mode,
          $or: [{ state: "unknown" }, { state: "abandoned_unknown", error_code: null }, { state: "abandoned_unknown", error_code: { $ne: "abandoned_found" } }],
          updated_at: { $lte: new Date(settled) },
        },
        { take: LIST_TAKE, order: { updated_at: "ASC" } },
      )
    )
      .filter((r) => waybillsOf(r.waybills).length === 0 && time(r.updated_at) <= settled)
      .slice(0, LOOKUP_BATCH)
    for (const r of unclear) {
      let checked = false
      const done = await safely(`lookup ${r.id}`, async () => {
        checked = (await lookupAttempt(scope, r.id, { actor: "system", trigger: "auto", now })).checked
      })
      if (done && checked) out.lookedUp += 1
    }

    if (!o.autoCreate) return out
    const armedAt = writers.shipment.updatedAt ? time(writers.shipment.updatedAt) : Number.NaN
    const windowStart = now.getTime() - o.autoCreateMaxAgeHours * 3_600_000
    const from = Number.isFinite(armedAt) ? Math.max(windowStart, armedAt) : windowStart
    /*
     * New pending rows (not the ones a person asked for and the pacing held
     * back), and failed rows the pass's own claim was held back for (nothing
     * reached DPD). Every condition is in the query, so rows the pass cannot
     * act on (problems, older than the window) never fill the page; the
     * filter after it is a second guard.
     */
    const windowFrom = new Date(from)
    const fresh = (
      await listShipments(
        svc,
        {
          mode,
          kind: "outbound",
          problems: null,
          created_at: { $gte: windowFrom },
          $or: [{ state: "pending", error_code: null }, { state: "pending", error_code: { $ne: MANUAL_DEFERRED } }, { state: "failed", error_code: "rate_limited" }],
        },
        { take: LIST_TAKE, order: { created_at: "DESC" } },
      )
    )
      .filter((r) => (r.problems === null || r.problems === undefined) && r.error_code !== MANUAL_DEFERRED && time(r.created_at) >= from)
      .slice(0, AUTO_BATCH)
    for (const r of fresh) {
      let sent = false
      const done = await safely(`auto create ${r.id}`, async () => {
        sent = (await createAttempt(scope, r.id, { actor: "system", trigger: "auto" })).sent
      })
      if (done && sent) out.created += 1
    }

    /* The same window as creating, and a cap: a label that keeps failing waits for a person. Conditions in the query, as above. */
    const labels = (
      await listShipments(
        svc,
        { mode, state: "created", error_code: [...AUTO_LABEL_CODES], created_at: { $gte: windowFrom }, attempts: { $lte: AUTO_LABEL_MAX_ATTEMPTS } },
        { take: LIST_TAKE, order: { created_at: "DESC" } },
      )
    )
      .filter((r) => r.error_code !== null && AUTO_LABEL_CODES.includes(r.error_code))
      .filter((r) => time(r.created_at) >= from && Number(r.attempts ?? 0) <= AUTO_LABEL_MAX_ATTEMPTS)
      .slice(0, AUTO_BATCH)
    for (const r of labels) {
      let asked = false
      const done = await safely(`auto label ${r.id}`, async () => {
        asked = (await labelAttempt(scope, r.id, { actor: "system", trigger: "auto" })).asked
      })
      if (done && asked) out.labeled += 1
    }
    return out
  })
  if (!result) return idle
  if (!result.ran) return result
  svc
    .getLogger()
    .info(
      `[dpd] Pass: ${result.purged} documents removed, ${result.expired} leases expired, ${result.lookedUp} looked up, ${result.created} created, ${result.labeled} labels asked again.`,
    )
  return result
}
