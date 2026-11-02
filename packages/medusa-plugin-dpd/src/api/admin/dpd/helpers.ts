import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type DpdModuleService from "../../../modules/dpd/service"
import { SHIPMENT_GROUPS, type ErrorResponse, type EventDto, type OptionsSummaryDto, type ShipmentFilter, type StatusResponse, type WriterDto, type WriterKey } from "../../../modules/dpd/lib/contract"
import { countsOf, toEventDto, toWriterDto, type EventRow } from "../../../modules/dpd/lib/dto"
import type { ResolvedDpdOptions } from "../../../modules/dpd/lib/options"
import { secretState } from "../../../modules/dpd/lib/security"
import { DEMO_SEEDED_KEY } from "../../../modules/dpd/lib/settings"
import { WRITERS } from "../../../modules/dpd/lib/writers"
import { KIT_META } from "../../../modules/dpd/lib/kit-meta"
import { ActionError, actorNames, dpdService, getSetting, settingsOf, storeFor, writerStates, type Scope } from "../../../workflows/dpd/runtime"

/* Only files named `route.ts` register routes; this one is a helper. */

export { dpdService, ActionError }

/** The user id of an admin request (who armed a writer). */
export function actorOf(req: MedusaRequest): string | null {
  const ctx = (req as MedusaRequest & { auth_context?: { actor_id?: string | null } }).auth_context
  return typeof ctx?.actor_id === "string" && ctx.actor_id ? ctx.actor_id : null
}

export function intParam(value: unknown, fallback: number, min: number, max: number): number {
  const v = Array.isArray(value) ? value[0] : value
  if (v === undefined || v === null || v === "") return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function strParam(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === "string" ? v.trim() : ""
}

/** The JSON body of a request, or an empty object. */
export function bodyOf(req: MedusaRequest): Record<string, unknown> {
  const b = req.body as unknown
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
}

export function isFilter(v: unknown): v is ShipmentFilter {
  return v === "all" || (typeof v === "string" && (SHIPMENT_GROUPS as readonly string[]).includes(v))
}

/** An ErrorResponse with its status. */
export function refuse(res: MedusaResponse, status: number, code: ErrorResponse["code"], message: string): void {
  const body: ErrorResponse = { code, message }
  res.status(status).json(body)
}

/** An error as an answer: refusals with their status, anything else 500 with a plain sentence (the details stay in the log, masked). */
export function sendError(scope: Scope, res: MedusaResponse, err: unknown): void {
  if (err instanceof ActionError) {
    refuse(res, err.status, err.code, err.message)
    return
  }
  let svc: DpdModuleService | null = null
  try {
    svc = dpdService(scope)
  } catch {
    svc = null
  }
  const detail = (err as Error)?.stack ?? (err as Error)?.message ?? String(err)
  if (svc) svc.getLogger().error(`[dpd] ${svc.mask(detail)}`)
  refuse(res, 500, "error", "Something went wrong on the server; the details are in the server log.")
}

export async function writersDto(scope: Scope): Promise<Record<WriterKey, WriterDto>> {
  const svc = dpdService(scope)
  const states = await writerStates(svc)
  const names = await actorNames(scope, WRITERS.map((w) => states[w].updatedBy))
  const out = {} as Record<WriterKey, WriterDto>
  for (const w of WRITERS) out[w] = toWriterDto(states[w], names)
  return out
}

export async function eventDtos(scope: Scope, rows: EventRow[]): Promise<EventDto[]> {
  const names = await actorNames(scope, rows.map((r) => r.actor))
  return rows.map((r) => toEventDto(r, names))
}

/** What the admin may know of the options: never a secret, only whether it is set. */
export function optionsSummary(o: ResolvedDpdOptions): OptionsSummaryDto {
  return {
    credentials: {
      login: secretState(o.login),
      password: secretState(o.password),
      infoLogin: secretState(o.infoLogin),
      infoPassword: secretState(o.infoPassword),
      infoChannel: secretState(o.infoChannel),
      pickupLogin: secretState(o.pickupLogin),
      pickupPassword: secretState(o.pickupPassword),
      pickupApiKey: secretState(o.pickupApiKey),
    },
    masterFid: o.masterFid,
    payerFid: o.payerFid,
    trackingMode: o.trackingMode,
    labelPage: o.labelPage,
    countries: [...o.countries],
    codCountries: Object.fromEntries(Object.entries(o.codCountries).map(([country, currencies]) => [country, [...currencies]])),
    codPaymentProviders: [...o.codPaymentProviders],
    internationalReturns: o.internationalReturns,
    weightUnit: o.weightUnit,
    defaultBox: o.defaultBox ? { ...o.defaultBox } : null,
    documentRetentionDays: o.documentRetentionDays,
    autoCreate: o.autoCreate,
    senderLocations: Object.keys(o.senders),
  }
}

/**
 * Status for the admin. READS OUR DATABASE ONLY: not a single call to DPD
 * and not a single write while rendering. Demo mode builds its sample
 * shipments through POST /admin/dpd/demo/seed (the page asks for it).
 */
export async function buildStatus(scope: Scope): Promise<StatusResponse> {
  const svc = dpdService(scope)
  const o = svc.getOptions()
  const mode = svc.mode()
  const counts = countsOf(await storeFor(scope).counts(mode))
  const settings = await settingsOf(svc)
  const seeded = o.demo ? Boolean(await getSetting(svc, DEMO_SEEDED_KEY)) : false
  return {
    mode,
    demo: o.demo,
    configured: svc.isConfigured(),
    missing: svc.missingOptions(),
    optionProblems: o.problems.map((p) => svc.mask(p)),
    senderProblems: svc.senderProblems().map((p) => ({ code: p.code, path: p.path, ...(p.max !== undefined ? { max: p.max } : {}) })),
    writers: await writersDto(scope),
    counts,
    settings: { labelPage: settings.labelPage, source: { labelPage: settings.source.labelPage } },
    options: optionsSummary(o),
    demoSeeded: seeded,
    version: KIT_META.version,
  }
}
