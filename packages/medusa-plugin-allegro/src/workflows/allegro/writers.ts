/**
 * THE WRITER TOGGLES IN THE DATABASE: what the admin shows, what a run may
 * do, who flipped what and when, and the circuit breaker.
 */

import type AllegroModuleService from "../../modules/allegro/service"
import { grantedScope, isConnected } from "../../modules/allegro/lib/connection"
import type { AllegroWriterDto } from "../../modules/allegro/lib/contract"
import { toWriterDto } from "../../modules/allegro/lib/dto"
import {
  WRITER_KEYS,
  afterOutcome,
  armRefusal,
  toggledPatch,
  writerState,
  type WriteOutcome,
  type WriterKey,
  type WriterRow,
  type WriterState,
} from "../../modules/allegro/lib/writers"

export async function loadWriterRows(svc: AllegroModuleService): Promise<Map<WriterKey, WriterRow>> {
  const rows = (await svc.listAllegroWriters({}, { take: 50 })) as unknown as WriterRow[]
  return new Map(rows.map((r) => [r.id as WriterKey, r]))
}

export interface WriterContext {
  mode: "demo" | "live"
  configured: boolean
  connected: boolean
  scope: string | null
}

export async function writerContext(svc: AllegroModuleService): Promise<WriterContext> {
  const demo = svc.isDemo()
  return {
    mode: demo ? "demo" : "live",
    configured: demo || svc.isConfigured(),
    connected: demo ? true : await isConnected(svc),
    scope: demo ? null : await grantedScope(svc),
  }
}

export function stateOf(svc: AllegroModuleService, key: WriterKey, row: WriterRow | null, ctx: WriterContext): WriterState {
  return writerState({
    key,
    allowed: svc.getOptions().writes[key],
    row,
    mode: ctx.mode,
    configured: ctx.configured,
    connected: ctx.connected,
    scope: ctx.scope,
  })
}

export async function writerDtos(svc: AllegroModuleService): Promise<AllegroWriterDto[]> {
  const rows = await loadWriterRows(svc)
  const ctx = await writerContext(svc)
  return WRITER_KEYS.map((k) => toWriterDto(stateOf(svc, k, rows.get(k) ?? null, ctx), rows.get(k) ?? null))
}

/** The writers that may write right now. Read at the start of every run and before every batch. */
export async function armedWriters(svc: AllegroModuleService): Promise<Set<WriterKey>> {
  const rows = await loadWriterRows(svc)
  const ctx = await writerContext(svc)
  const out = new Set<WriterKey>()
  for (const k of WRITER_KEYS) if (stateOf(svc, k, rows.get(k) ?? null, ctx).effective) out.add(k)
  return out
}

export async function isArmed(svc: AllegroModuleService, key: WriterKey): Promise<boolean> {
  return (await armedWriters(svc)).has(key)
}

async function upsertWriter(svc: AllegroModuleService, key: WriterKey, patch: Record<string, unknown>): Promise<void> {
  const rows = (await svc.listAllegroWriters({ id: key } as never, { take: 1, select: ["id"] })) as unknown as Array<{ id: string }>
  if (rows[0]) await svc.updateAllegroWriters({ id: key, ...patch } as never)
  else await svc.createAllegroWriters({ id: key, armed: false, failure_streak: 0, ...patch } as never)
}

export class WriterRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WriterRefusedError"
  }
}

/**
 * A person arms or disarms a writer. Disarming always works; arming is
 * refused while the hard switch is off, the account is not connected or the
 * token lacks a scope.
 */
export async function setWriterArmed(
  svc: AllegroModuleService,
  key: WriterKey,
  armed: boolean,
  actor: { id: string | null; name: string },
): Promise<AllegroWriterDto> {
  const rows = await loadWriterRows(svc)
  const ctx = await writerContext(svc)
  const state = stateOf(svc, key, rows.get(key) ?? null, ctx)
  if (armed) {
    const refusal = armRefusal(state)
    if (refusal) throw new WriterRefusedError(refusal)
  }
  await upsertWriter(svc, key, toggledPatch(armed, actor, new Date(), ctx.mode))
  svc.getLogger().info(`[allegro] writer ${key} ${armed ? "armed" : "disarmed"} by ${actor.name}`)
  const fresh = await loadWriterRows(svc)
  return toWriterDto(stateOf(svc, key, fresh.get(key) ?? null, ctx), fresh.get(key) ?? null)
}

/**
 * The outcome of one write call, for the circuit breaker. Returns true when
 * the breaker just disarmed the writer: the caller stops writing.
 */
export async function recordOutcome(svc: AllegroModuleService, key: WriterKey, outcome: WriteOutcome): Promise<boolean> {
  const rows = await loadWriterRows(svc)
  const row = rows.get(key) ?? null
  const { patch, tripped } = afterOutcome(
    { failure_streak: row?.failure_streak ?? 0, armed: Boolean(row?.armed) },
    outcome,
    svc.getOptions().breakerThreshold,
    new Date(),
  )
  await upsertWriter(svc, key, patch as Record<string, unknown>)
  if (tripped) svc.getLogger().warn(`[allegro] writer ${key} disarmed by the circuit breaker: ${outcome.kind === "ok" ? "" : outcome.message}`)
  return tripped
}

export async function touchWriterRun(svc: AllegroModuleService, key: WriterKey): Promise<void> {
  await upsertWriter(svc, key, { last_run_at: new Date() }).catch(() => undefined)
}
