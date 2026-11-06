/**
 * THE GEOWIDGET TOKEN of the storefront map (Geowidget v5). Zero imports.
 *
 * The token is PUBLIC: InPost Manager generates it for the storefront's
 * domain, and the storefront puts it in the page. The plugin never needs it
 * to ship; it keeps it so the admin can say what the storefront map runs on
 * and the storefront can read it from `GET /store/inpost/geowidget` instead of
 * keeping its own copy. It is a JWT whose payload carries the environment
 * (`iss`, the sandbox login host has "sandbox" in it), the domains it works
 * on (`allowed_referrers`) and the expiry (`exp`). The signature is not
 * checked here (InPost checks it); a token that is no JWT is kept and shown
 * as unreadable.
 */

export type GeowidgetEnvironment = "sandbox" | "production"

export interface GeowidgetInfo {
  /** A token is set. */
  set: boolean
  /** The payload could be read. */
  readable: boolean
  environment: GeowidgetEnvironment | null
  /** The domains the token works on (`allowed_referrers`), lower case. */
  domains: string[]
  /** ISO time, or null when the token has no expiry. */
  expiresAt: string | null
  expired: boolean
  /** The start and the end of the token, for recognising it; never the whole token in the admin. */
  preview: string | null
}

const EMPTY: GeowidgetInfo = { set: false, readable: false, environment: null, domains: [], expiresAt: null, expired: false, preview: null }

function base64UrlJson(part: string): Record<string, unknown> | null {
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
    const text = typeof atob === "function" ? decodeURIComponent(escape(atob(padded))) : Buffer.from(padded, "base64").toString("utf8")
    const v = JSON.parse(text) as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The domains of `allowed_referrers`: a string (comma or space separated) or a list. */
function domainsOf(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[\s,;]+/) : []
  const out: string[] = []
  for (const d of raw) {
    const host = d
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
    if (host && !out.includes(host)) out.push(host)
  }
  return out
}

/** Reads a Geowidget token. Never throws; `now` for tests. */
export function readGeowidgetToken(token: string | null | undefined, now: Date = new Date()): GeowidgetInfo {
  const t = typeof token === "string" ? token.trim() : ""
  if (!t) return EMPTY
  const preview = t.length > 16 ? `${t.slice(0, 6)}...${t.slice(-6)}` : null
  const parts = t.split(".")
  const payload = parts.length === 3 ? base64UrlJson(parts[1]) : null
  if (!payload) return { ...EMPTY, set: true, preview }
  const iss = typeof payload.iss === "string" ? payload.iss.toLowerCase() : ""
  const exp = typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : null
  return {
    set: true,
    readable: true,
    environment: iss ? (iss.includes("sandbox") ? "sandbox" : "production") : null,
    domains: domainsOf(payload.allowed_referrers),
    expiresAt: exp !== null ? new Date(exp * 1000).toISOString() : null,
    expired: exp !== null && exp * 1000 <= now.getTime(),
    preview,
  }
}

/** The Geowidget script host of an environment (Geowidget v5). */
export function geowidgetHost(environment: GeowidgetEnvironment | null, sandbox: boolean): string {
  const env = environment ?? (sandbox ? "sandbox" : "production")
  return env === "sandbox" ? "https://sandbox-easy-geowidget-sdk.easypack24.net" : "https://geowidget.inpost.pl"
}
