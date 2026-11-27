/**
 * AI Avatars in the koda.integration/1 contract, the pure part: the board
 * counters from the plugin's own rows. Presentations have no order, product
 * or customer lines, so the plugin answers the `integration` scope only.
 */
import type { CounterDraft } from "./kit-routes"

export interface AvatarCounts {
  /** Presentations whose script waits for edits and approval. */
  review: number
  /** Presentations where a step failed. */
  failed: number
  /** Avatars a render could not use (no signed consent on record). */
  withoutConsent: number
}

/** One counter per thing to do; zero counters are left out. */
export function avatarsCounters(c: AvatarCounts): CounterDraft[] {
  const out: CounterDraft[] = []
  if (c.failed > 0) out.push({ key: "presentations_failed", scope: "integration", count: c.failed, tone: "red", link: { kind: "admin", href: "/avatars?filter=failed" } })
  if (c.review > 0) out.push({ key: "presentations_review", scope: "integration", count: c.review, tone: "orange", link: { kind: "admin", href: "/avatars?filter=review" } })
  if (c.withoutConsent > 0) out.push({ key: "avatars_without_consent", scope: "integration", count: c.withoutConsent, tone: "orange", link: { kind: "admin", href: "/avatars?view=panel&section=avatars" } })
  return out
}
