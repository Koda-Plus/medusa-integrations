import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { subscribeToKit } from "../../../../modules/kit/lib/subscribe"
import { clientOf, EMAIL_RE, optionsOf, settingsOf } from "../../../kit/helpers"
import type { KitApiError } from "../../../../modules/kit/lib/client"

/**
 * POST /store/kit/subscribe - the storefront newsletter form.
 * Public: Medusa only requires the publishable key header. The route answers
 * politely when the integration is not configured yet, so the form never
 * shows a red error for a missing key.
 *
 * Rate limited per address (in memory): 5 signs-up per 10 minutes.
 */
const MAX = 5
const WINDOW_MS = 10 * 60 * 1000
const hits = new Map<string, number[]>()

function prune(now: number): void {
  for (const [ip, stamps] of hits) {
    const alive = stamps.filter((t) => now - t < WINDOW_MS)
    if (alive.length) hits.set(ip, alive)
    else hits.delete(ip)
  }
}

function limited(ip: string): boolean {
  const now = Date.now()
  if (hits.size > 1000) prune(now)
  const stamps = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  if (stamps.length >= MAX) {
    hits.set(ip, stamps)
    return true
  }
  stamps.push(now)
  hits.set(ip, stamps)
  return false
}

function clientIp(req: MedusaRequest): string {
  const fwd = req.headers["x-forwarded-for"]
  const raw = Array.isArray(fwd) ? fwd[0] : fwd
  return String(raw ?? "").split(",")[0]?.trim() || (req as any).ip || "unknown"
}

type Body = { email?: unknown; first_name?: unknown; source?: unknown }

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const body = req.body as Body
  const email = String(body?.email ?? "").trim()
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, configured: true, message: "Podaj poprawny adres e-mail." })
  }
  if (limited(clientIp(req))) {
    return res.status(429).json({ ok: false, configured: true, message: "Za dużo prób zapisu. Spróbuj ponownie za kilka minut." })
  }

  const o = optionsOf(req.scope)
  if (!o.apiKey) {
    return res.json({ ok: false, configured: false, message: "Newsletter nie jest jeszcze podłączony do wysyłki." })
  }

  const first_name = typeof body?.first_name === "string" ? body.first_name : undefined
  const source = typeof body?.source === "string" ? body.source : "form"

  try {
    const result = await subscribeToKit({
      scope: req.scope,
      options: o,
      settings: await settingsOf(req.scope),
      client: clientOf(req.scope),
      input: { email, first_name, source },
    })
    return res.json(result)
  } catch (e) {
    const err = e as KitApiError
    if (err.kind === "invalid") {
      return res.status(400).json({ ok: false, configured: true, message: "Ten adres nie może zostać zapisany." })
    }
    if (err.kind === "rate") {
      return res.status(429).json({ ok: false, configured: true, message: "Newsletter jest chwilowo zajęty. Spróbuj ponownie za moment." })
    }
    return res.status(502).json({ ok: false, configured: true, message: "Nie udało się teraz zapisać adresu. Spróbuj ponownie za chwilę." })
  }
}
