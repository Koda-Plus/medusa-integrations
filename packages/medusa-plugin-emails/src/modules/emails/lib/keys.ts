/**
 * IDEMPOTENCY KEYS. One event, one key, one e-mail at most.
 *
 * The same key works on three levels:
 *
 *   1. Medusa's notification module (`idempotency_key`): a second
 *      `createNotifications` with a key that already sent is ignored;
 *   2. the send log of this plugin: a unique row per key and mode, claimed
 *      atomically before anything is sent, so two processes that got the
 *      same event never both send;
 *   3. Resend (`Idempotency-Key` header, kept 24 hours): a retry after a
 *      timeout returns the first answer instead of sending again.
 *
 * Keys name the event and the resource, never a secret: a password reset key
 * carries a hash of the token, not the token.
 */

import { createHash, randomUUID } from "node:crypto"

/** Resend accepts 1 to 256 characters; the plugin keeps its keys shorter and printable. */
export const MAX_KEY_LENGTH = 200

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/**
 * A key as given by a caller, made safe: printable ASCII without spaces, at
 * most 200 characters. A longer key keeps its first part and a hash of the
 * whole, so two long keys never collapse into one. Null for nothing usable.
 */
export function cleanKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const s = raw.trim()
  if (!s) return null
  const printable = s.replace(/[^\x21-\x7E]/g, "_")
  if (printable.length <= MAX_KEY_LENGTH) return printable
  return `${printable.slice(0, 120)}~${sha256(s).slice(0, 40)}`
}

/** `emails:order.placed:order_01J...`: the key of a built-in event e-mail. */
export function eventKey(template: string, resourceId: string): string {
  return cleanKey(`emails:${template}:${resourceId}`) as string
}

/** The key of a password reset: a hash of the token, never the token itself. */
export function resetKey(token: string): string {
  return eventKey("password.reset", sha256(String(token ?? "")).slice(0, 32))
}

/**
 * A one-way hash of an address (trimmed, lower case), kept next to the
 * masked address in the send log: it finds the e-mails of one address (a
 * customer's guest orders, a search by the full address) and counts the
 * password resets per address, without the log holding the address itself.
 */
export function addressHash(email: string): string {
  return sha256(`koda-emails:address:${String(email ?? "").trim().toLowerCase()}`).slice(0, 40)
}

/** A Medusa customer id (`cus_...`), or null: `receiver_id` of a notification may name anything. */
export function customerIdOf(value: unknown): string | null {
  return typeof value === "string" && /^cus_[A-Za-z0-9]{1,60}$/.test(value) ? value : null
}

/** A test send from the admin: always new. */
export function testKey(): string {
  return `emails:test:${randomUUID()}`
}

/** A notification without any key (app code): one row per Medusa notification. */
export function notificationKey(notificationId: string | null | undefined): string {
  return notificationId ? (cleanKey(`emails:notification:${notificationId}`) as string) : `emails:adhoc:${randomUUID()}`
}

/**
 * The Resend key of a row. A person retrying a failed message from the admin
 * rotates it (`#r1`, `#r2`): Resend may hold the earlier answer, an error
 * included, for 24 hours under the old key.
 */
export function resendKey(key: string, rotation: number): string {
  const base = cleanKey(key) ?? key
  return rotation > 0 ? `${base}#r${rotation}` : base
}

/**
 * The key Medusa gets for a person's retry: new, so the notification module
 * creates a new notification instead of re-processing the failed one (in
 * Medusa 2.15 re-processing a failed notification sends but cannot record the
 * result). The send log still finds the original row by `provider_data`.
 */
export function retryNotificationKey(key: string, rotation: number): string {
  return cleanKey(`${key}:retry:${rotation}:${Date.now().toString(36)}`) as string
}

/** A stable header value per message (`X-Entity-Ref-ID`), so Gmail does not thread similar e-mails together. */
export function entityRef(key: string): string {
  return sha256(key).slice(0, 24)
}
