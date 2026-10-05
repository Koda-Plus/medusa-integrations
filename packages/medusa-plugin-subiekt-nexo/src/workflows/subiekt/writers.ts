/**
 * Writer toggles in the database (see `lib/writers.ts` for the rules). The
 * admin arms and disarms them; flows ask `writerActive` before they write.
 */

import type { WriterDto, WriterKey } from "../../modules/subiekt/lib/contract"
import { describeWriters, type WriterRow } from "../../modules/subiekt/lib/writers"
import { storedCapabilities, subiektService, type Scope } from "./runtime"

type Svc = ReturnType<typeof subiektService>

interface StoredWriter extends WriterRow {
  id: string
}

export async function writerRows(svc: Svc): Promise<StoredWriter[]> {
  return (await svc.listSubiektWriters({ demo: svc.isDemo() } as never, { take: 20 } as never)) as unknown as StoredWriter[]
}

export async function writersStatus(scope: Scope): Promise<WriterDto[]> {
  const svc = subiektService(scope)
  return describeWriters(svc.getOptions(), await writerRows(svc), await storedCapabilities(svc))
}

/** Allowed by its option, armed by a person, and the bridge can do it. */
export async function writerActive(scope: Scope, key: WriterKey): Promise<boolean> {
  return Boolean((await writersStatus(scope)).find((w) => w.key === key)?.active)
}

/** Arms or disarms a writer and records who did it. The option still wins: arming a writer it forbids changes nothing it does. */
export async function setWriter(scope: Scope, key: WriterKey, armed: boolean, actor: string | null): Promise<WriterDto[]> {
  const svc = subiektService(scope)
  const patch = { armed, changed_by: actor, changed_at: new Date() }
  const existing = (await writerRows(svc)).find((r) => r.key === key)
  if (existing) {
    await svc.updateSubiektWriters({ id: existing.id, ...patch } as never)
  } else {
    try {
      await svc.createSubiektWriters({ key, demo: svc.isDemo(), ...patch } as never)
    } catch {
      // Two clicks at once: the unique index kept one row, update it.
      const again = (await writerRows(svc)).find((r) => r.key === key)
      if (again) await svc.updateSubiektWriters({ id: again.id, ...patch } as never)
    }
  }
  svc.getLogger().info(`[subiekt] Writer ${key} ${armed ? "armed" : "disarmed"} by ${actor ?? "unknown"}.`)
  return writersStatus(scope)
}
