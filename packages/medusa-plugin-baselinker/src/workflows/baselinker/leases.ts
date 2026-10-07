/**
 * LEASES: ONE RUN OF A JOB, ONE WORKER PER RECORD, ACROSS EVERY PROCESS.
 *
 * Medusa runs a store as several processes (a server and a worker, or more
 * instances), and the Locking module spans them only with a Redis or
 * Postgres provider; the default one lives in memory. So the plugin keeps
 * its own leases in `baselinker_setting`, one row per key and mode:
 *
 *   lease:job:<kind>    one run of the catalog, the order queue, the status read...
 *   lease:lock:<key>    one sender of an order, one importer of a marketplace
 *                       order, one writer of an invoice number
 *
 * Taking a lease is creating its row; the unique index on (key, demo) lets
 * exactly one of two racing processes succeed. A holder renews its row every
 * minute while it works; a row whose time ran out (its process died) is
 * deleted by id and taken over, and a slow racer that deletes the same row
 * by the same id deletes nothing new. Plain generated CRUD: no raw SQL, no
 * migration.
 *
 * A FAILING STORE IS NOT "BUSY". When the database does not answer, the
 * caller gets LockUnavailableError, which lands in the run history and the
 * log, so a broken lock store never looks like a quiet queue.
 *
 * Known limit, the same as every lease: a process frozen for longer than the
 * lease, whose lease another process took over, may still finish the step it
 * was in when it wakes up.
 */

import { randomUUID } from "node:crypto"
import { hostname } from "node:os"
import type BaseLinkerModuleService from "../../modules/baselinker/service"
import { LEASE_RENEW_MS, LEASE_TTL_MS } from "../../modules/baselinker/lib/constants"

export class LockUnavailableError extends Error {
  readonly code = "lock_unavailable"
  /** The store may answer on the next run. */
  readonly retryable = true
  readonly key: string
  constructor(key: string, cause: unknown) {
    super(`The lock store did not answer for ${key} (${messageOf(cause)}). Nothing was done; the next run tries again.`)
    this.name = "LockUnavailableError"
    this.key = key
  }
}

export interface Lease {
  key: string
  /** The id of the row this holder created: renewing and releasing touch only this row. */
  id: string
  owner: string
}

interface LeaseValue {
  owner?: unknown
  until?: unknown
  since?: unknown
  host?: unknown
}

interface LeaseRow {
  id: string
  key: string
  value: LeaseValue | null
}

function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.length > 300 ? `${text.slice(0, 300)}...` : text
}

/** A lease row whose time has not run out. */
export function leaseIsLive(value: unknown, now: Date): boolean {
  const until = (value as LeaseValue | null)?.until
  const t = typeof until === "string" || until instanceof Date ? new Date(until).getTime() : NaN
  return Number.isFinite(t) && t > now.getTime()
}

function host(): string | null {
  try {
    return hostname().slice(0, 100)
  } catch {
    return null
  }
}

async function listByKey(svc: BaseLinkerModuleService, key: string): Promise<LeaseRow[]> {
  return (await svc.listBaseLinkerSettings({ key, demo: svc.isDemo() } as never, { take: 2 } as never)) as unknown as LeaseRow[]
}

/** Takes the lease, or answers null when a live holder has it. Throws LockUnavailableError when the store fails. */
export async function takeLease(svc: BaseLinkerModuleService, key: string, ttlMs = LEASE_TTL_MS): Promise<Lease | null> {
  const now = new Date()
  const owner = randomUUID()
  let rows: LeaseRow[]
  try {
    rows = await listByKey(svc, key)
  } catch (err) {
    throw new LockUnavailableError(key, err)
  }
  const held = rows[0]
  if (held) {
    if (leaseIsLive(held.value, now)) return null
    /* Its holder died: delete exactly that row. A racer doing the same deletes nothing more. */
    try {
      await svc.deleteBaseLinkerSettings([held.id])
    } catch (err) {
      throw new LockUnavailableError(key, err)
    }
  }
  try {
    const row = (await svc.createBaseLinkerSettings({
      key,
      demo: svc.isDemo(),
      value: { owner, until: new Date(now.getTime() + ttlMs).toISOString(), since: now.toISOString(), host: host() },
    } as never)) as unknown as LeaseRow
    return { key, id: row.id, owner }
  } catch (err) {
    /* The unique index: another process created the row first. Anything else is a failing store. */
    let again: LeaseRow[]
    try {
      again = await listByKey(svc, key)
    } catch (readErr) {
      throw new LockUnavailableError(key, readErr)
    }
    if (again.length > 0) return null
    throw new LockUnavailableError(key, err)
  }
}

/** Moves the end of the lease on. False when the row is gone (another process took the lease over). */
export async function renewLease(svc: BaseLinkerModuleService, lease: Lease, ttlMs = LEASE_TTL_MS): Promise<boolean> {
  try {
    const rows = (await svc.listBaseLinkerSettings({ id: lease.id } as never, { take: 1 } as never)) as unknown as LeaseRow[]
    const row = rows[0]
    if (!row || row.value?.owner !== lease.owner) return false
    await svc.updateBaseLinkerSettings({ id: lease.id, value: { ...row.value, until: new Date(Date.now() + ttlMs).toISOString() } } as never)
    return true
  } catch {
    return false
  }
}

/** Gives the lease back. Never throws: a lease that could not be deleted runs out by itself. */
export async function releaseLease(svc: BaseLinkerModuleService, lease: Lease): Promise<void> {
  try {
    await svc.deleteBaseLinkerSettings([lease.id])
  } catch {
    /* expires by itself */
  }
}

/**
 * Runs `fn` holding the lease, renewing it while `fn` works. Null when a
 * live holder has it. LockUnavailableError when the store fails.
 */
export async function withLease<T>(svc: BaseLinkerModuleService, key: string, fn: () => Promise<T>): Promise<T | null> {
  const lease = await takeLease(svc, key)
  if (!lease) return null
  let warned = false
  const timer = setInterval(() => {
    void renewLease(svc, lease).then((ok) => {
      if (!ok && !warned) {
        warned = true
        svc.getLogger().warn(`[baselinker] The lease ${key} could not be renewed; another process may take it over when it runs out.`)
      }
    })
  }, LEASE_RENEW_MS)
  ;(timer as { unref?: () => void }).unref?.()
  try {
    return await fn()
  } finally {
    clearInterval(timer)
    await releaseLease(svc, lease)
  }
}

/** Keys from the list whose lease is live right now, in the current mode. */
export async function liveLeases(svc: BaseLinkerModuleService, keys: readonly string[]): Promise<string[]> {
  if (keys.length === 0) return []
  const rows = (await svc.listBaseLinkerSettings({ key: [...keys], demo: svc.isDemo() } as never, {
    take: keys.length * 2,
  } as never)) as unknown as LeaseRow[]
  const now = new Date()
  return [...new Set(rows.filter((r) => leaseIsLive(r.value, now)).map((r) => r.key))].sort()
}
