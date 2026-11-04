import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { checkRegistries, parseNumber, withCountry } from "../../../../modules/whitelist/lib/check"
import { whitelistSvc } from "../../../../modules/whitelist/lib/store"
import { bodyOf, fail } from "../../../whitelist/helpers"

/**
 * POST /store/whitelist/preview
 *
 * The registration form's check: a number pulls the company card from the
 * registries BEFORE sign-up, without saving anything. A Polish NIP goes to
 * GUS and the whitelist (as `plRegistries` says), an EU VAT number to VIES.
 * Public, rate limited per address, answers cached for ten minutes.
 *
 * Body: { nip } or { vat_number, country_code }. With a country other than
 * PL, a number typed without its prefix gets the country's prefix.
 */

const WINDOW_MS = 60 * 1000
const MAX_PER_WINDOW = 10
const CACHE_MS = 10 * 60 * 1000
const hits = new Map<string, number[]>()

function limited(ip: string): boolean {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length >= MAX_PER_WINDOW) {
    hits.set(ip, list)
    return true
  }
  list.push(now)
  hits.set(ip, list)
  if (hits.size > 10_000) hits.clear()
  return false
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const ip = typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"].split(",")[0].trim() : String(req.headers["x-real-ip"] ?? "unknown")
  if (limited(ip)) {
    res.setHeader("Retry-After", "60")
    fail(res, 429, "rate_limited", "Too many checks. Try again in a minute.")
    return
  }
  const body = bodyOf(req)
  const raw = typeof body.vat_number === "string" ? body.vat_number : typeof body.nip === "string" ? body.nip : ""
  const country = typeof body.country_code === "string" ? body.country_code : null
  if (!raw.trim()) {
    fail(res, 400, "nip_required", "Enter a NIP or an EU VAT number.")
    return
  }
  const value = withCountry(raw, country)
  const parsed = parseNumber(value)
  if (parsed.kind === "invalid") {
    fail(res, 400, "invalid", parsed.country === "PL" ? "Enter a 10-digit Polish NIP." : "Enter a valid EU VAT number.")
    return
  }
  const options = whitelistSvc(req.scope).getOptions()
  const { card, answers } = await checkRegistries(value, options, { cacheMs: CACHE_MS })
  res.setHeader("Cache-Control", "private, no-store")
  res.json({
    preview: {
      nip: parsed.kind === "nip" ? parsed.nip : parsed.vat,
      vat_number: parsed.kind === "nip" ? `PL${parsed.nip}` : parsed.vat,
      country_code: card.country_code,
      source: card.source,
      state: card.state,
      status_vat: card.status_vat,
      name: card.name,
      address: card.address,
      bank_accounts: card.bank_accounts,
      regon: card.regon,
      krs: card.krs,
      legal_form: card.legal_form,
      activity: card.activity,
      started_at: card.details?.started_at ?? null,
      registries: answers.map((a) => ({ source: a.source, state: a.state })),
      demo: card.demo,
    },
  })
}
