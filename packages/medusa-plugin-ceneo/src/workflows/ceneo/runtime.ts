/**
 * WHAT EVERY CENEO RUN NEEDS FROM MEDUSA: Query and one run at a time per
 * process.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export type Scope = Pick<MedusaContainer, "resolve">

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export function queryOf(scope: Scope): QueryLike {
  return scope.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
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

export function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500)
}
