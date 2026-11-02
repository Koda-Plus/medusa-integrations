/**
 * CREATING A SHIPMENT AND GETTING ITS LABEL, exactly once.
 *
 * DPD has no idempotency key and no way to cancel a shipment. So every call
 * that writes to DPD is the outbox step of one row: the row is claimed in
 * one statement (pending or failed to creating, created to labeling, with a
 * token and a lease), the request goes out once with the deterministic
 * reference (the fulfillment id, for good: a refused request does not use
 * it up), and only the owner of the claim writes the result. An answer that
 * cannot be proven a refusal leaves the row `unknown`: it is looked up by
 * its reference before anything is sent again (resolve.ts), and a request
 * sent again with the same reference is refused by DPD as a duplicate, which
 * the create then adopts within the same claim.
 *
 * One click creates and labels: generatePackagesNumbers, then at once a
 * second claim and generateSpedLabels. A row whose label did not come stays
 * `created` with an error code and the label can be asked for again (a
 * label never makes a row `unknown`: printing the same shipment twice is
 * harmless).
 *
 * A business outcome (a refusal, an unclear answer) is not an exception: the
 * functions return the row in its new state. ActionError only for what is
 * refused before anything is sent.
 *
 * A call the client's pacing refused (nothing sent) is no attempt: the row
 * goes back to the state it was claimed from, attempts back to its value
 * before the claim, with a *_deferred history line. Claimed by the pass
 * (or chained to a create) the code is rate_limited and the pass sends it
 * again; claimed by a person it is rate_limited_manual, which the pass
 * leaves alone: a click DPD never got does not turn into a send later
 * without the person.
 */

import { randomUUID } from "node:crypto"
import { CREATE_LEASE_MS, LABEL_LEASE_MS, type LabelPage } from "../../modules/dpd/lib/constants"
import type { StoredBox, StoredBoxes } from "../../modules/dpd/lib/boxes"
import { readStoredBoxes } from "../../modules/dpd/lib/boxes"
import type { LabelsOutcome, NumbersOutcome } from "../../modules/dpd/lib/dpd-answers"
import { labelsRequest, nothingSent, type LabelSearch } from "../../modules/dpd/lib/dpdservices"
import { waybillsOf, type ShipmentRow } from "../../modules/dpd/lib/dto"
import type { ShipmentPatch } from "../../modules/dpd/lib/store"
import { saveLabel } from "./documents"
import { mergeProblems, planOf } from "./plan"
import {
  ActionError,
  annotateFulfillment,
  clientFor,
  dpdService,
  errorText,
  getShipmentOfMode,
  listShipments,
  loadOrder,
  recordEvent,
  requireArmed,
  settingsOf,
  storeFor,
  type Scope,
} from "./runtime"

export type Trigger = "manual" | "auto"

/** The error_code of a claim the pacing refused: the pass retries rate_limited, never rate_limited_manual. */
export function deferredCode(trigger: Trigger | "chained"): "rate_limited" | "rate_limited_manual" {
  return trigger === "manual" ? "rate_limited_manual" : "rate_limited"
}

/** References tried, newest last: at most this many. */
const REFERENCES_KEPT = 20

export type ReferenceAttempt = { reference: string; parcels: string[]; at: string; trigger: string; outcome: string }

/** The `references` history with one more attempt, the last REFERENCES_KEPT. */
export function withAttempt(stored: unknown, attempt: ReferenceAttempt): ReferenceAttempt[] {
  const list = Array.isArray(stored) ? stored.filter((x): x is ReferenceAttempt => Boolean(x) && typeof x === "object" && typeof (x as ReferenceAttempt).reference === "string") : []
  return [...list, attempt].slice(-REFERENCES_KEPT)
}

/** The stored boxes with DPD's waybills written in, in DPD's order, for n < min(boxes, waybills). */
export function boxesWithWaybills(boxes: unknown, waybills: readonly string[]): StoredBoxes | null {
  const stored = readStoredBoxes(boxes)
  if (!stored) return null
  const items: StoredBox[] = stored.items.map((b, n) => (n < waybills.length ? { ...b, waybill: waybills[n] } : b))
  return { edited: stored.edited, items }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((w) => set.has(w)) && new Set(b).size === set.size
}

export function sourceOf(actor: string | null): "admin" | "system" {
  return actor && actor !== "system" ? "admin" : "system"
}

async function current(scope: Scope, id: string, fallback: ShipmentRow): Promise<ShipmentRow> {
  const [row] = await listShipments(dpdService(scope), { id }, { take: 1 })
  return row ?? fallback
}

/** A row of the current mode, else 404. */
export async function mustFind(scope: Scope, id: string): Promise<ShipmentRow> {
  const row = await getShipmentOfMode(dpdService(scope), id)
  if (!row) throw new ActionError(404, "not_found", "No DPD shipment with this id in the current mode.")
  return row
}

/** What the label of a row is searched by: its reference, else its waybills (a seeded demo row has no reference); null when it has neither. */
export function labelSearchOf(row: Pick<ShipmentRow, "reference" | "fulfillment_id" | "waybills">): LabelSearch | null {
  const reference = row.reference ?? row.fulfillment_id ?? null
  if (reference) return { packageReference: reference }
  const waybills = waybillsOf(row.waybills)
  return waybills.length > 0 ? { waybills } : null
}

/* ------------------------------------------------------------------ */
/* Creating                                                            */
/* ------------------------------------------------------------------ */

export async function createShipment(
  scope: Scope,
  id: string,
  input: { planHash?: string | null; page?: LabelPage | null; actor: string | null; trigger: Trigger },
): Promise<ShipmentRow> {
  return (await createAttempt(scope, id, input)).row
}

/** createShipment, saying whether the request left this server (false: the pacing sent nothing and the row was deferred). */
export async function createAttempt(
  scope: Scope,
  id: string,
  input: { planHash?: string | null; page?: LabelPage | null; actor: string | null; trigger: Trigger },
): Promise<{ row: ShipmentRow; sent: boolean }> {
  const svc = dpdService(scope)
  const mode = svc.mode()
  const row = await mustFind(scope, id)
  if (row.kind !== "outbound") throw new ActionError(409, "wrong_state", "Only an outbound shipment is created here.")
  if (row.state === "creating" || row.state === "labeling") throw new ActionError(409, "busy", "Another process is working on this shipment right now.")
  if (row.state !== "pending" && row.state !== "failed") throw new ActionError(409, "wrong_state", `The shipment is ${row.state}, not waiting to be created.`)
  await requireArmed(scope, "shipment")
  const client = clientFor(scope)
  if (!client) throw new ActionError(409, "not_configured", `DPD is not configured: ${svc.missingOptions().join(", ")}.`)

  const { plan } = await planOf(scope, row)
  if (!plan.ok || !plan.request) {
    const problems = mergeProblems(plan.problems, row.problems, row.state)
    await storeFor(scope).transition(row.id, [row.state], { problems })
    throw new ActionError(422, "plan_problems", `The plan has problems: ${plan.problems.map((p) => p.code).join(", ")}.`)
  }
  if (input.trigger === "manual") {
    if (!input.planHash) throw new ActionError(400, "plan_hash_missing", "Read the plan first: send the planHash it shows.")
    if (input.planHash !== plan.hash) throw new ActionError(409, "plan_changed", "The plan changed since it was read (the order, the options or the boxes). Read it again.")
  }
  const page: LabelPage = input.page ?? (await settingsOf(svc)).labelPage
  const store = storeFor(scope)
  const token = randomUUID()
  const at = new Date()
  const items: StoredBox[] = plan.boxes.map((b, n) => ({
    weightKg: b.weightKg,
    lengthCm: b.lengthCm,
    widthCm: b.widthCm,
    heightCm: b.heightCm,
    reference: plan.parcelReferences[n] ?? null,
    waybill: null,
  }))
  const sentBoxes: StoredBoxes = { edited: plan.boxesSource === "edited", items }
  const claimed = await store.claim(row.id, ["pending", "failed"], {
    token,
    leaseUntil: new Date(at.getTime() + CREATE_LEASE_MS),
    to: "creating",
    patch: {
      plan_hash: plan.hash,
      cod_minor: plan.codDue ? plan.codDue.minor : null,
      currency: plan.codDue ? plan.codDue.currency : row.currency,
      session_type: plan.sessionType ?? "DOMESTIC",
      service: "courier",
      reference: plan.reference,
      boxes: sentBoxes,
      problems: null,
      error: null,
      error_code: null,
    },
  })
  if (!claimed) throw new ActionError(409, "busy", "Another process is creating this shipment, or it changed a moment ago.")

  const source = sourceOf(input.actor)
  const codAmount = plan.codDue ? plan.codDue.amount : null

  let outcome: NumbersOutcome
  try {
    outcome = await client.generatePackagesNumbers(plan.request)
  } catch (err) {
    /* The client never throws for an answer; anything thrown here is unclear: the request may have gone out. */
    outcome = { kind: "unclear", code: "network", message: errorText(svc, err).slice(0, 1000), traceId: null, httpStatus: 0 }
  }

  if (nothingSent(outcome)) {
    /* The pacing sent nothing: no attempt, no reference used; back to where it was claimed from. The pass sends it again only if the pass claimed it. */
    const code = deferredCode(input.trigger)
    const finished = await store.finish(
      row.id,
      token,
      { state: row.state === "failed" ? "failed" : "pending", error: outcome.kind === "refused" ? svc.mask(outcome.message) : null, error_code: code },
      { unsent: {} },
    )
    if (!finished) return { row: await current(scope, row.id, claimed), sent: false }
    await recordEvent(scope, {
      shipment_id: row.id,
      order_id: row.order_id,
      kind: "action",
      source,
      actor: input.actor,
      message:
        code === "rate_limited"
          ? "Not sent to DPD yet: too many DPD calls from this server right now. It is sent again later."
          : "Not sent to DPD: too many DPD calls from this server right now. Create it again in a minute.",
      data: { action: "create_deferred", trigger: input.trigger, reference: plan.reference, code },
      mode,
    })
    return { row: finished, sent: false }
  }

  /* Written once the request left (or may have left): a paced call above never says "sent". */
  await recordEvent(scope, {
    shipment_id: row.id,
    order_id: row.order_id,
    kind: "action",
    source,
    actor: input.actor,
    message: `Sent to DPD: ${items.length} box${items.length === 1 ? "" : "es"}${codAmount ? `, cash on delivery ${codAmount} ${plan.codDue?.currency ?? ""}`.trimEnd() : ""}.`,
    data: { action: "create_sent", trigger: input.trigger, reference: plan.reference, boxes: items.length, cod: codAmount },
    mode,
  })
  const references = withAttempt(claimed.references, { reference: plan.reference, parcels: plan.parcelReferences, at: at.toISOString(), trigger: input.trigger, outcome: outcome.kind })

  if (outcome.kind === "ok") {
    const waybills = outcome.parcels.map((p) => p.waybill)
    const finished = await store.finish(row.id, token, {
      state: "created",
      waybills,
      session_id: outcome.sessionId,
      boxes: { edited: sentBoxes.edited, items: items.map((b, n) => ({ ...b, waybill: waybills[n] ?? null })) },
      references,
      error: null,
      error_code: null,
    })
    if (!finished) return { row: await current(scope, row.id, claimed), sent: true }
    await recordEvent(scope, {
      shipment_id: row.id,
      order_id: row.order_id,
      kind: "action",
      source,
      actor: input.actor,
      message: `DPD created the shipment: ${waybills.join(", ")}.`,
      data: { action: "created", waybills, sessionId: outcome.sessionId, traceId: outcome.traceId },
      mode,
    })
    await annotateFulfillment(scope, finished)
    try {
      return { row: await labelShipment(scope, row.id, { page, actor: input.actor, trigger: "chained" }), sent: true }
    } catch (err) {
      /* The shipment exists: the create answers with it; the label can be asked for again. */
      svc.getLogger().warn(`[dpd] create ${row.id}: the label right after the waybills was not asked for: ${errorText(svc, err)}`)
      return { row: await current(scope, row.id, finished), sent: true }
    }
  }

  if (outcome.kind === "exists") {
    /* DPD already has this reference (an earlier request whose answer was lost): take its waybills over in this claim. */
    let label: LabelsOutcome
    try {
      label = await client.generateSpedLabels(labelsRequest({ packageReference: plan.reference }, page))
    } catch (err) {
      label = { kind: "unclear", code: "network", message: errorText(svc, err).slice(0, 1000), traceId: null, httpStatus: 0 }
    }
    if (label.kind === "ok") {
      await saveLabel(scope, claimed, { pdfBase64: label.pdfBase64, page, documentId: label.documentId, actor: input.actor })
      const matches = label.waybills.length === plan.boxes.length
      const finished = await store.finish(row.id, token, {
        state: matches ? "labeled" : "ambiguous",
        waybills: label.waybills,
        boxes: boxesWithWaybills(sentBoxes, label.waybills),
        references,
        error: matches ? null : `DPD has ${label.waybills.length} box${label.waybills.length === 1 ? "" : "es"} under this reference, ${plan.boxes.length} were sent. Check the shipment in DPD, then accept its waybills or mark it shipped outside Medusa.`,
        error_code: matches ? "adopted" : "waybill_count_mismatch",
      })
      if (!finished) return { row: await current(scope, row.id, claimed), sent: true }
      await recordEvent(scope, {
        shipment_id: row.id,
        order_id: row.order_id,
        kind: "action",
        source,
        actor: input.actor,
        message: matches
          ? `DPD already had this shipment (${outcome.status}): its waybills and label were taken over: ${label.waybills.join(", ")}.`
          : `DPD already had this shipment (${outcome.status}) with ${label.waybills.length} waybills for ${plan.boxes.length} boxes sent.`,
        data: { action: "adopted", outcome: matches ? "labeled" : "ambiguous", waybills: label.waybills, traceId: label.traceId },
        mode,
      })
      if (matches) await annotateFulfillment(scope, finished)
      return { row: finished, sent: true }
    }
    const notFound = label.kind === "not_found"
    const dpdCode = label.kind === "not_found" ? null : label.code
    const finished = await store.finish(row.id, token, {
      state: notFound ? "ambiguous" : "unknown",
      references,
      error:
        label.kind === "not_found"
          ? "DPD says the reference is taken but finds no shipment under it. Check in DPD before anything else."
          : `DPD says the shipment exists, its waybills could not be read yet (${label.code}): ${svc.mask(label.message)}`,
      error_code: notFound ? "duplicate_not_found" : "adopt_failed",
    })
    if (!finished) return { row: await current(scope, row.id, claimed), sent: true }
    await recordEvent(scope, {
      shipment_id: row.id,
      order_id: row.order_id,
      kind: "action",
      source,
      actor: input.actor,
      message: notFound ? `DPD answered ${outcome.status} but finds no shipment under the reference.` : `DPD answered ${outcome.status}; reading the shipment failed (${dpdCode}). It is looked up again.`,
      data: { action: "adopted", outcome: notFound ? "ambiguous" : "unknown", code: notFound ? "duplicate_not_found" : dpdCode, traceId: label.traceId },
      mode,
    })
    return { row: finished, sent: true }
  }

  if (outcome.kind === "refused") {
    const finished = await store.finish(row.id, token, {
      state: "failed",
      references,
      error: svc.mask(outcome.message),
      /* A DPD 429 on a person's click stays theirs to retry, like a paced one: the pass does not send it on its own. */
      error_code: outcome.code === "rate_limited" ? deferredCode(input.trigger) : outcome.code,
      problems: mergeProblems([], outcome.problems, "failed"),
    })
    if (!finished) return { row: await current(scope, row.id, claimed), sent: true }
    await recordEvent(scope, {
      shipment_id: row.id,
      order_id: row.order_id,
      kind: "action",
      source,
      actor: input.actor,
      message: outcome.message,
      data: { action: "create_refused", code: outcome.code, httpStatus: outcome.httpStatus, problems: outcome.problems.map((p) => p.code), traceId: outcome.traceId },
      mode,
    })
    return { row: finished, sent: true }
  }

  /* unclear: the request may have reached DPD. Never sent again from here: the row is looked up by its reference first. */
  const finished = await store.finish(row.id, token, { state: "unknown", references, error: svc.mask(outcome.message), error_code: outcome.code })
  if (!finished) return { row: await current(scope, row.id, claimed), sent: true }
  await recordEvent(scope, {
    shipment_id: row.id,
    order_id: row.order_id,
    kind: "action",
    source,
    actor: input.actor,
    message: `No clear answer from DPD (${outcome.code}). The shipment is looked up before anything is sent again.`,
    data: { action: "create_unclear", code: outcome.code, httpStatus: outcome.httpStatus, traceId: outcome.traceId },
    mode,
  })
  svc.getLogger().warn(`[dpd] create ${row.id}: unknown (${outcome.code})${outcome.traceId ? ` trace=${outcome.traceId}` : ""}`)
  return { row: finished, sent: true }
}

/* ------------------------------------------------------------------ */
/* The label                                                           */
/* ------------------------------------------------------------------ */

export async function labelShipment(
  scope: Scope,
  id: string,
  input: { page?: LabelPage | null; actor: string | null; trigger: Trigger | "chained" },
): Promise<ShipmentRow> {
  return (await labelAttempt(scope, id, input)).row
}

/** labelShipment, saying whether DPD was asked (false: the pass skipped a canceled fulfillment, or the pacing sent nothing). */
export async function labelAttempt(
  scope: Scope,
  id: string,
  input: { page?: LabelPage | null; actor: string | null; trigger: Trigger | "chained" },
): Promise<{ row: ShipmentRow; asked: boolean }> {
  const svc = dpdService(scope)
  const mode = svc.mode()
  const row = await mustFind(scope, id)
  if (row.state === "labeling") throw new ActionError(409, "busy", "The label of this shipment is being fetched right now.")
  if (row.state !== "created") throw new ActionError(409, "wrong_state", `The shipment is ${row.state}: a label is fetched for a created shipment.`)
  if (input.trigger !== "chained") await requireArmed(scope, "shipment")
  const client = clientFor(scope)
  if (!client) throw new ActionError(409, "not_configured", `DPD is not configured: ${svc.missingOptions().join(", ")}.`)
  if (input.trigger === "auto" && row.order_id) {
    /* The pass never advises a parcel that will not go. */
    const order = await loadOrder(scope, row.order_id)
    const f = (order?.fulfillments ?? []).find((x) => x.id === row.fulfillment_id)
    if (order?.status === "canceled" || f?.canceled_at) {
      svc.getLogger().info(`[dpd] label ${row.id}: skipped, the fulfillment or the order is canceled.`)
      return { row, asked: false }
    }
  }
  const page: LabelPage = input.page ?? (await settingsOf(svc)).labelPage
  const store = storeFor(scope)
  const token = randomUUID()
  const claimed = await store.claim(row.id, ["created"], { token, leaseUntil: new Date(Date.now() + LABEL_LEASE_MS), to: "labeling" })
  if (!claimed) throw new ActionError(409, "busy", "Another process is fetching this label, or the shipment changed a moment ago.")

  const search = labelSearchOf(claimed)
  let outcome: LabelsOutcome
  if (!search) {
    outcome = { kind: "not_found", traceId: null, httpStatus: 0 }
  } else {
    try {
      outcome = await client.generateSpedLabels(labelsRequest(search, page))
    } catch (err) {
      outcome = { kind: "unclear", code: "network", message: errorText(svc, err).slice(0, 1000), traceId: null, httpStatus: 0 }
    }
  }
  const source = sourceOf(input.actor)
  const stored = waybillsOf(claimed.waybills)

  if (outcome.kind === "ok") {
    await saveLabel(scope, claimed, { pdfBase64: outcome.pdfBase64, page, documentId: outcome.documentId, actor: input.actor })
    const same = sameSet(outcome.waybills, stored)
    const patch: ShipmentPatch & { state: string } = same
      ? { state: "labeled", error: null, error_code: null }
      : {
          state: "ambiguous",
          waybills: outcome.waybills,
          boxes: boxesWithWaybills(claimed.boxes, outcome.waybills),
          error: `DPD returned other waybills (${outcome.waybills.join(", ")}) than the stored ones (${stored.join(", ")}). Check the shipment in DPD, then accept its waybills or mark it shipped outside Medusa.`,
          error_code: "waybill_mismatch",
        }
    const finished = await store.finish(row.id, token, patch)
    if (!finished) return { row: await current(scope, row.id, claimed), asked: true }
    await recordEvent(scope, {
      shipment_id: row.id,
      order_id: row.order_id,
      kind: "action",
      source,
      actor: input.actor,
      message: same ? `Label stored (${page}).` : "The label came with other waybills than the stored ones.",
      data: { action: "labeled", outcome: same ? "labeled" : "ambiguous", page, trigger: input.trigger, traceId: outcome.traceId, ...(same ? {} : { previous: stored, waybills: outcome.waybills }) },
      mode,
    })
    return { row: finished, asked: true }
  }

  if (nothingSent(outcome)) {
    /* The pacing sent nothing: created again, the claim not counted; rate_limited is asked again by the pass (AUTO_LABEL_CODES), rate_limited_manual waits for the person. */
    const code = deferredCode(input.trigger)
    const finished = await store.finish(row.id, token, { state: "created", error: outcome.kind === "refused" ? svc.mask(outcome.message) : null, error_code: code }, { unsent: {} })
    if (!finished) return { row: await current(scope, row.id, claimed), asked: false }
    await recordEvent(scope, {
      shipment_id: row.id,
      order_id: row.order_id,
      kind: "action",
      source,
      actor: input.actor,
      message:
        code === "rate_limited"
          ? "The label was not asked for yet: too many DPD calls from this server right now. It is asked for again later."
          : "The label was not asked for: too many DPD calls from this server right now. Get it again in a minute.",
      data: { action: "label_deferred", code, trigger: input.trigger },
      mode,
    })
    return { row: finished, asked: false }
  }

  const code =
    outcome.kind === "not_found" ? "label_not_found" : outcome.kind === "unclear" ? "label_unclear" : outcome.code === "rate_limited" ? deferredCode(input.trigger) : outcome.code
  const message =
    outcome.kind === "not_found"
      ? "DPD does not find this shipment for the label."
      : outcome.kind === "unclear"
        ? `No clear answer for the label (${outcome.code}); get it again.`
        : svc.mask(outcome.message)
  const finished = await store.finish(row.id, token, { state: "created", error: message, error_code: code })
  if (!finished) return { row: await current(scope, row.id, claimed), asked: true }
  await recordEvent(scope, {
    shipment_id: row.id,
    order_id: row.order_id,
    kind: "action",
    source,
    actor: input.actor,
    message: `The label did not come: ${message}`,
    data: { action: "label_failed", code, trigger: input.trigger, traceId: outcome.traceId, ...(outcome.kind === "not_found" ? {} : { dpdCode: outcome.code }) },
    mode,
  })
  return { row: finished, asked: true }
}
