/**
 * WHAT EVERY CENEO RUN NEEDS FROM MEDUSA: Query, one run at a time per
 * process, and the feed lease across processes.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ensureLeaseRow, withRunLease, type SqlRunner } from "../../modules/ceneo/lib/import-claim"
import type { TaxLinesLike } from "./catalog"

export type Scope = Pick<MedusaContainer, "resolve">

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export function queryOf(scope: Scope): QueryLike {
  return scope.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
}

/** The tax module, for gross prices from net ones; null when the app runs without it. */
export function taxesOf(scope: Scope): TaxLinesLike | null {
  try {
    const svc = scope.resolve(Modules.TAX) as unknown as Partial<TaxLinesLike> | undefined
    return svc && typeof svc.getTaxLines === "function" ? (svc as TaxLinesLike) : null
  } catch {
    return null
  }
}

type LockHolder = typeof globalThis & { [k: symbol]: boolean | undefined }

function lockSymbol(name: string): symbol {
  return Symbol.for(`koda.ceneo.lock.${name}`)
}

export function isLocked(name: string): boolean {
  return Boolean((globalThis as LockHolder)[lockSymbol(name)])
}

/** Runs `fn` unless a run of the same name is in progress in this process; then null. */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const holder = globalThis as LockHolder
  const key = lockSymbol(name)
  if (holder[key]) return null
  holder[key] = true
  try {
    return await fn()
  } finally {
    holder[key] = false
  }
}

export const FEED_LEASE = "feed"
/** Longer than any build; a crashed process frees the lease after it. */
export const FEED_LEASE_MS = 30 * 60_000

/**
 * Runs `fn` as the only feed build or id move: first in this process, then
 * across processes (server and worker) through the database lease. Null
 * when another run holds either, so `fn` never returns null itself.
 */
export async function withFeedLease<T extends {}>(scope: Scope, fn: () => Promise<T>): Promise<T | null> {
  return withLock(FEED_LEASE, async () => {
    const sql = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlRunner
    await ensureLeaseRow(sql, FEED_LEASE)
    return withRunLease(sql, FEED_LEASE, FEED_LEASE_MS, fn)
  }).then((r) => r ?? null)
}

export function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500)
}
