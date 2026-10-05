/**
 * Writer arms, directions, cursors and the demo state, stored in
 * `baselinker_setting` (one row per key and mode) through the generated
 * service methods. The service stays thin: everything here calls it from the
 * outside.
 */

import type BaseLinkerModuleService from "../../modules/baselinker/service"
import { iso, type SettingRow } from "../../modules/baselinker/lib/dto"
import {
  effectiveDirections,
  WRITER_KEYS,
  writerStates,
  type ArmRecord,
  type Directions,
  type WriterKey,
  type WriterState,
} from "../../modules/baselinker/lib/writers"

/** Who did something in the admin: the user id and a readable label (e-mail or name). */
export interface Actor {
  id: string | null
  label: string | null
}

const writerKey = (key: WriterKey) => `writer:${key}`

export async function readSettingRow(svc: BaseLinkerModuleService, key: string): Promise<SettingRow | null> {
  const rows = (await svc.listBaseLinkerSettings({ key, demo: svc.isDemo() } as never, { take: 1 } as never)) as unknown as SettingRow[]
  return rows[0] ?? null
}

export async function readSetting<T>(svc: BaseLinkerModuleService, key: string): Promise<T | null> {
  const row = await readSettingRow(svc, key)
  return row && row.value !== undefined ? (row.value as T) : null
}

/**
 * Creates or updates one setting of the current mode. Two writers racing for
 * a new key meet on the unique index: the loser reads the row and updates it.
 */
export async function writeSetting(svc: BaseLinkerModuleService, key: string, value: unknown, actor?: Actor | null): Promise<void> {
  const demo = svc.isDemo()
  const stamp = actor ? { changed_by: actor.id, changed_by_label: actor.label, changed_at: new Date() } : {}
  const existing = await readSettingRow(svc, key)
  if (existing) {
    await svc.updateBaseLinkerSettings({ id: existing.id, value, ...stamp } as never)
    return
  }
  try {
    await svc.createBaseLinkerSettings({ key, value, demo, ...stamp } as never)
  } catch {
    const row = await readSettingRow(svc, key)
    if (!row) throw new Error(`Could not store the BaseLinker setting ${key}.`)
    await svc.updateBaseLinkerSettings({ id: row.id, value, ...stamp } as never)
  }
}

/* ------------------------------------------------------------------ */
/* Arms and directions                                                 */
/* ------------------------------------------------------------------ */

export async function loadArms(svc: BaseLinkerModuleService): Promise<Map<WriterKey, ArmRecord>> {
  const rows = (await svc.listBaseLinkerSettings({ key: WRITER_KEYS.map(writerKey), demo: svc.isDemo() } as never, {
    take: WRITER_KEYS.length * 2,
  } as never)) as unknown as SettingRow[]
  const out = new Map<WriterKey, ArmRecord>()
  for (const row of rows) {
    const key = row.key.slice("writer:".length) as WriterKey
    if (!WRITER_KEYS.includes(key)) continue
    const value = (row.value ?? {}) as { armed?: unknown }
    out.set(key, {
      armed: value.armed === true,
      changedBy: row.changed_by ?? null,
      changedByLabel: row.changed_by_label ?? null,
      changedAt: iso(row.changed_at),
    })
  }
  return out
}

/** Directions in force: the options, or in demo mode what a visitor picked. */
export async function loadDirections(svc: BaseLinkerModuleService): Promise<Directions> {
  const o = svc.getOptions()
  const pick = o.demo ? await readSetting<Partial<Directions>>(svc, "directions") : null
  return effectiveDirections(o, pick)
}

export async function loadWriters(svc: BaseLinkerModuleService): Promise<{ directions: Directions; writers: WriterState[] }> {
  const [directions, arms] = await Promise.all([loadDirections(svc), loadArms(svc)])
  return { directions, writers: writerStates(svc.getOptions(), directions, arms) }
}

/** Keys of the writers that write right now. */
export async function liveWriters(svc: BaseLinkerModuleService): Promise<Set<WriterKey>> {
  const { writers } = await loadWriters(svc)
  return new Set(writers.filter((w) => w.live).map((w) => w.key))
}

export async function setArm(svc: BaseLinkerModuleService, key: WriterKey, armed: boolean, actor: Actor): Promise<void> {
  await writeSetting(svc, writerKey(key), { armed }, actor)
  svc.getLogger().info(`[baselinker] writer ${key} ${armed ? "armed" : "disarmed"} by ${actor.label ?? actor.id ?? "unknown"}`)
}

/* ------------------------------------------------------------------ */
/* Demo state: what the simulated writers changed                      */
/* ------------------------------------------------------------------ */

/**
 * Demo mode only. Writes "succeed" against the simulation and the next
 * simulated read sees them, so a plan that was applied converges to nothing
 * to do, like on a real account.
 */
export interface DemoState {
  /** Cards created from Medusa variants, by variant id. */
  cards: Record<string, { blId: string; sku: string; name: string; ean: string | null }>
  /** Card names and EANs updated from Medusa, by card id. */
  cardUpdates: Record<string, { name?: string; ean?: string | null }>
  /** Warehouse stock written from Medusa, by card id. */
  stock: Record<string, number>
  /** Prices written from Medusa, by card id. */
  prices: Record<string, number>
  /** Catalog import items applied to the simulation, by item key, with the time. */
  imported: Record<string, string>
  /** Invoice numbers written to simulated orders, by BaseLinker order id. */
  invoiceNumbers: Record<string, string>
}

export function emptyDemoState(): DemoState {
  return { cards: {}, cardUpdates: {}, stock: {}, prices: {}, imported: {}, invoiceNumbers: {} }
}

export async function loadDemoState(svc: BaseLinkerModuleService): Promise<DemoState> {
  if (!svc.isDemo()) return emptyDemoState()
  const raw = (await readSetting<Partial<DemoState>>(svc, "demo:state")) ?? {}
  const base = emptyDemoState()
  return {
    cards: { ...base.cards, ...(raw.cards ?? {}) },
    cardUpdates: { ...base.cardUpdates, ...(raw.cardUpdates ?? {}) },
    stock: { ...base.stock, ...(raw.stock ?? {}) },
    prices: { ...base.prices, ...(raw.prices ?? {}) },
    imported: { ...base.imported, ...(raw.imported ?? {}) },
    invoiceNumbers: { ...base.invoiceNumbers, ...(raw.invoiceNumbers ?? {}) },
  }
}

/** Applies a change to the demo state and stores it. Demo mode only. */
export async function updateDemoState(svc: BaseLinkerModuleService, change: (state: DemoState) => void): Promise<DemoState> {
  const state = await loadDemoState(svc)
  change(state)
  if (svc.isDemo()) await writeSetting(svc, "demo:state", state)
  return state
}
