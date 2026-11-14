/**
 * DIGITAL PRODUCTS: e-books, PDFs, anything the customer downloads.
 *
 * A line is digital when Medusa says it needs no shipping
 * (`requires_shipping: false`: a product without a shipping profile and
 * without managed inventory). The order confirmation then gets a download
 * link per digital line, and the file itself as an attachment when it is
 * small enough.
 *
 * The link is signed, not stored: `{order_id}`, `{item_id}` and an HMAC of
 * both under the `downloads.secret` option. The store's own download route
 * checks it with `verifyDownloadToken` (same secret) and serves the file.
 * Nothing about the file's location reaches the customer.
 */
import { createHmac, timingSafeEqual } from "node:crypto"

/** The token of one digital line of one order: HMAC-SHA256, base64url, 32 characters. */
export function downloadToken(secret: string, orderId: string, itemId: string): string {
  return createHmac("sha256", secret).update(`download:${orderId}:${itemId}`).digest("base64url").slice(0, 32)
}

/** True when the token belongs to this order and line. Constant time. */
export function verifyDownloadToken(secret: string, orderId: string, itemId: string, token: unknown): boolean {
  if (!secret || typeof token !== "string" || token.length !== 32) return false
  const want = Buffer.from(downloadToken(secret, orderId, itemId))
  const got = Buffer.from(token)
  return want.length === got.length && timingSafeEqual(want, got)
}

/** The link of a digital line: the `downloads.url` template with {order_id}, {item_id} and {token} filled. */
export function downloadUrl(template: string, secret: string, orderId: string, itemId: string): string {
  return template
    .replace(/\{order_id\}/g, encodeURIComponent(orderId))
    .replace(/\{item_id\}/g, encodeURIComponent(itemId))
    .replace(/\{token\}/g, downloadToken(secret, orderId, itemId))
}

/** A line Medusa ships nothing for. */
export function isDigitalLine(line: { requires_shipping?: unknown } | null | undefined): boolean {
  return line?.requires_shipping === false
}

/** "physical" (nothing digital), "digital" (only digital lines) or "mixed". */
export type OrderKind = "physical" | "digital" | "mixed"

export function orderKind(lines: ReadonlyArray<{ requires_shipping?: unknown } | null | undefined> | null | undefined): OrderKind {
  const list = (lines ?? []).filter(Boolean)
  const digital = list.filter((l) => isDigitalLine(l)).length
  if (digital === 0) return "physical"
  return digital === list.length ? "digital" : "mixed"
}

/** A file name a mail client shows: letters, digits, dashes; ends in its extension. */
export function attachmentName(title: string, url: string): string {
  const ext = (/\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url)?.[1] ?? "pdf").toLowerCase()
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  return `${base || "plik"}.${ext}`
}
