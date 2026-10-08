import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { checkGus, checkNumber } from "../../../../modules/whitelist/lib/check"
import { whitelistSvc } from "../../../../modules/whitelist/lib/store"
import { kindOf } from "../../../../modules/whitelist/lib/whitelist"
import { bodyOf, fail } from "../../../whitelist/helpers"

/**
 * POST /store/whitelist/preview
 *
 * The registration form's check: a NIP pulls the company card from the
 * whitelist and the GUS registry BEFORE sign-up, without saving anything.
 * Public, rate limited per address; demo mode answers with simulated data.
 * Body: { nip }.
 */

const WINDOW_MS = 60 * 1000
const MAX_PER_WINDOW = 10
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
  const value = typeof body.nip === "string" ? body.nip.trim() : ""
  if (!value) {
    fail(res, 400, "nip_required", "Enter a NIP.")
    return
  }
  if (kindOf(value) !== "nip") {
    fail(res, 400, "nip_invalid", "Enter a 10-digit Polish NIP.")
    return
  }
  const options = whitelistSvc(req.scope).getOptions()
  const answer = await checkNumber(value, options)
  const gus = await checkGus(value, options)
  res.setHeader("Cache-Control", "private, no-store")
  res.json({
    preview: {
      nip: value.replace(/\D/g, ""),
      source: answer.source,
      state: answer.state,
      status_vat: answer.status_vat,
      name: answer.name,
      address: answer.address,
      bank_accounts: answer.bank_accounts,
      regon: gus?.regon ?? answer.regon,
      krs: answer.krs,
      legal_form: gus?.legal_form ?? null,
      demo: options.demo,
    },
  })
}
