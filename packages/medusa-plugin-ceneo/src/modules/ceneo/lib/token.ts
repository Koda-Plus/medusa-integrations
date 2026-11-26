import { createHash, timingSafeEqual } from "node:crypto"

/**
 * THE FEED TOKEN IN THE ADDRESS. `/ceneo/feed/[token]` receives `abc.xml`,
 * so the suffix is cut first. The comparison runs on SHA-256 digests in
 * constant time: equal lengths for `timingSafeEqual`, and nothing about the
 * token leaks through the response time.
 */
export function feedTokenFromParam(param: unknown): string | null {
  if (typeof param !== "string") return null
  const token = param.endsWith(".xml") ? param.slice(0, -4) : param
  return token ? token : null
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest()
}

export function sameToken(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected))
}

export function feedHash(xml: string): string {
  return createHash("sha256").update(xml, "utf8").digest("hex")
}
