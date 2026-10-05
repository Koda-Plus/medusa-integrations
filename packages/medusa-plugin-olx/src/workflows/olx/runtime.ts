/**
 * WHAT EVERY OLX RUN NEEDS FROM MEDUSA: the module service, Query, the raw
 * database connection for the atomic statements, the small state table and
 * one-run-at-a-time flags per process.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type OlxModuleService from "../../modules/olx/service"
import { OLX_MODULE } from "../../modules/olx/lib/constants"
import type { SqlRunner } from "../../modules/olx/lib/store"

export type Scope = Pick<MedusaContainer, "resolve">

export function olxServiceOf(scope: Scope): OlxModuleService {
  return scope.resolve<OlxModuleService>(OLX_MODULE)
}

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export function queryOf(scope: Scope): QueryLike {
  return scope.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
}

export function sqlOf(scope: Scope): SqlRunner {
  return scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlRunner
}

export function modeKey(demo: boolean): "demo" | "live" {
  return demo ? "demo" : "live"
}

/* ------------------------------------------------------------------ */
/* State rows                                                          */
/* ------------------------------------------------------------------ */

export async function getState<T>(svc: OlxModuleService, key: string): Promise<T | null> {
  const rows = (await svc.listOlxStates({ id: key } as never, { take: 1 })) as unknown as Array<{ value: unknown }>
  return rows[0] ? ((rows[0].value ?? null) as T | null) : null
}

export async function getStates(svc: OlxModuleService, keys: string[]): Promise<Map<string, unknown>> {
  const rows = (await svc.listOlxStates({ id: keys } as never, { take: null })) as unknown as Array<{ id: string; value: unknown }>
  return new Map(rows.map((r) => [r.id, r.value ?? null]))
}

export async function setState(svc: OlxModuleService, key: string, value: unknown): Promise<void> {
  const rows = (await svc.listOlxStates({ id: key } as never, { take: 1, select: ["id"] })) as unknown as Array<{ id: string }>
  if (rows.length > 0) await svc.updateOlxStates({ id: key, value } as never)
  else await svc.createOlxStates({ id: key, value } as never)
}

/* ------------------------------------------------------------------ */
/* One run at a time per process                                       */
/* ------------------------------------------------------------------ */

type LockHolder = typeof globalThis & { [k: symbol]: boolean | undefined }

function lockSymbol(name: string): symbol {
  return Symbol.for(`koda.olx.lock.${name}`)
}

export function isLocked(name: string): boolean {
  return Boolean((globalThis as LockHolder)[lockSymbol(name)])
}

export function tryLock(name: string): boolean {
  const holder = globalThis as LockHolder
  const key = lockSymbol(name)
  if (holder[key]) return false
  holder[key] = true
  return true
}

export function unlock(name: string): void {
  ;(globalThis as LockHolder)[lockSymbol(name)] = false
}

export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  if (!tryLock(name)) return null
  try {
    return await fn()
  } finally {
    unlock(name)
  }
}

export function errorText(svc: OlxModuleService, err: unknown): string {
  return svc.mask(err instanceof Error ? err.message : String(err)).slice(0, 500)
}

export function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
