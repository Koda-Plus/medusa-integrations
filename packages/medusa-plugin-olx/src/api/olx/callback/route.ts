import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelConnecting, completeConnecting, getConnectionRow } from "../../../modules/olx/lib/connection"
import { OLX_MODULE } from "../../../modules/olx/lib/constants"
import type OlxModuleService from "../../../modules/olx/service"
import { syncOlxAdvertsWorkflow } from "../../../workflows/olx/sync-olx-adverts"
import { runOlxCycleWorkflow } from "../../../workflows/olx/workflows"

/**
 * GET /olx/callback?code=...&state=...
 *
 * OAUTH REDIRECT URI, PUBLIC, NO LOGIN. OLX sends the SELLER's browser here
 * after the consent, so it cannot live under /admin: the seller may have no
 * account in the store admin. Register this exact URL in the OLX app.
 *
 * Only while a connection attempt is in progress (15 minutes after clicking
 * "Connect" in the admin) does this URL do anything. Every other visit, a
 * scanner or an old link, gets one sentence and writes nothing, so foreign
 * visits never show up as our errors. The page never echoes the code, a
 * token or the account name. The admin learns about the connection by itself
 * (it polls the status while connecting).
 */

const TEXT = {
  pl: {
    demoTitle: "Tryb demo",
    demoBody: "Ten sklep działa w trybie demo wtyczki OLX, więc nie łączy prawdziwego konta OLX.",
    idleTitle: "Nie trwa żadne łączenie",
    idleBody: "Ten adres działa tylko przez 15 minut po kliknięciu „Połącz konto OLX” w panelu sklepu. Zacznij od panelu.",
    refusedTitle: "Zgoda nie została udzielona",
    refusedBody: "Sklep nie dostał dostępu do konta OLX. Jeśli to pomyłka, zacznij od nowa w panelu sklepu.",
    okTitle: "Konto OLX połączone",
    okBody: "Sklep ma już dostęp do konta OLX. Tę kartę można zamknąć.",
    failTitle: "Nie udało się połączyć konta OLX",
  },
  en: {
    demoTitle: "Demo mode",
    demoBody: "This store runs the OLX plugin in demo mode, so it does not connect a real OLX account.",
    idleTitle: "No connection in progress",
    idleBody: "This address only works for 15 minutes after clicking “Connect OLX account” in the store admin. Start from the admin.",
    refusedTitle: "Consent was not granted",
    refusedBody: "The store did not get access to the OLX account. If this was a mistake, start again from the store admin.",
    okTitle: "OLX account connected",
    okBody: "The store now has access to the OLX account. You can close this tab.",
    failTitle: "Could not connect the OLX account",
  },
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = req.scope.resolve<OlxModuleService>(OLX_MODULE)
  const o = svc.getOptions()
  const t = o.market === "pl" ? TEXT.pl : TEXT.en
  const lang = o.market === "pl" ? "pl" : "en"
  const q = req.query as Record<string, unknown>
  const code = typeof q.code === "string" ? q.code : ""
  const state = typeof q.state === "string" ? q.state : ""
  const refused = typeof q.error === "string" ? q.error : ""

  if (o.demo) {
    page(res, 400, lang, t.demoTitle, t.demoBody)
    return
  }

  const row = await getConnectionRow(svc)
  const inProgress = Boolean(row?.state && row.state_expires_at && new Date(row.state_expires_at).getTime() > Date.now())
  if (!inProgress) {
    page(res, 400, lang, t.idleTitle, t.idleBody)
    return
  }

  if (refused) {
    await cancelConnecting(svc, `The seller did not grant consent on OLX (${svc.mask(refused).slice(0, 80)}).`)
    page(res, 200, lang, t.refusedTitle, t.refusedBody)
    return
  }

  try {
    await completeConnecting(svc, code, state)
    /* First snapshot right away, so the admin shows adverts within a minute. */
    void syncOlxAdvertsWorkflow(req.scope)
      .run({ input: { trigger: "auto" } })
      .then(() => runOlxCycleWorkflow(req.scope).run({ input: { trigger: "auto" } }))
      .catch((err: unknown) => svc.getLogger().error(`[olx] first sync: ${svc.mask(String(err))}`))
    page(res, 200, lang, t.okTitle, t.okBody)
  } catch (err) {
    page(res, 400, lang, t.failTitle, svc.mask(err instanceof Error ? err.message : String(err)))
  }
}

/** One page: no scripts, no links, no data. */
function page(res: MedusaResponse, status: number, lang: string, title: string, body: string): void {
  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  res
    .status(status)
    .type("html")
    .send(
      `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<meta name="robots" content="noindex"><title>${esc(title)}</title>` +
        `<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;background:#f4f4f5;color:#18181b;display:flex;align-items:center;justify-content:center;padding:24px}` +
        `main{background:#fff;border-radius:12px;padding:32px;max-width:520px;box-shadow:0 1px 3px rgba(0,0,0,.1)}h1{font-size:20px;margin:0 0 12px}p{margin:0;line-height:1.5}` +
        `small{display:block;margin-top:20px;color:#71717a}</style></head>` +
        `<body><main><h1>${esc(title)}</h1><p>${esc(body)}</p><small>OLX by Koda Plus</small></main></body></html>`,
    )
}
