/**
 * THE CONTEXT OF THE KSeF WATCH (0.4.0): the options, the clock and two facts
 * about the account, read from the plugin's own rows (never from Fakturownia,
 * never from order metadata):
 *
 *   ksefActive      a document of this mode has a KSeF number
 *   emailsExpected  `sendByEmail` is on, or Fakturownia was seen e-mailing a
 *                   document of this mode (`remote_email_status` / `remote_sent_at`)
 *
 * A fact that is true stays true for the life of the process (cached per
 * service and mode); a false one is asked again each time, so the first
 * KSeF number or the first e-mail Fakturownia sends switches the rule on at
 * once. Two indexed reads of at most one row.
 */

import type { WatchContext } from "../../modules/fakturownia/lib/ksef-watch"
import { fakturowniaService, listDocuments, type Scope } from "./runtime"

const SEEN = new WeakMap<object, Set<string>>()

async function seen(svc: object, key: string, ask: () => Promise<boolean>): Promise<boolean> {
  const known = SEEN.get(svc) ?? new Set<string>()
  if (known.has(key)) return true
  const yes = await ask()
  if (yes) {
    known.add(key)
    SEEN.set(svc, known)
  }
  return yes
}

export async function watchContext(scope: Scope, now: Date = new Date()): Promise<WatchContext> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  const demo = svc.isDemo()
  const one = { take: 1, select: ["id"] }
  const ksefActive =
    o.ksefStuckAfterDays > 0 ? await seen(svc, `ksef:${demo}`, async () => (await listDocuments(svc, { demo, gov_id: { $ne: null } }, one)).length > 0) : false
  const emailsExpected =
    o.notEmailedAfterHours > 0
      ? o.sendByEmail ||
        (await seen(svc, `email:${demo}`, async () => (await listDocuments(svc, { demo, $or: [{ remote_email_status: "sent" }, { remote_sent_at: { $ne: null } }] }, one)).length > 0))
      : false
  return { now, ksefStuckAfterDays: o.ksefStuckAfterDays, notEmailedAfterHours: o.notEmailedAfterHours, ksefActive, emailsExpected }
}
