import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { GeowidgetStoreResponse } from "../../../../modules/inpost/lib/contract"
import { geowidgetHost, readGeowidgetToken } from "../../../../modules/inpost/lib/geowidget"
import { inpostService } from "../../../../workflows/inpost/runtime"

/**
 * GET /store/inpost/geowidget  ->  GeowidgetStoreResponse | 404 geowidget_not_configured
 *
 * The public Geowidget token of the storefront map (option `geowidgetToken`)
 * with its environment and the script host, so a storefront reads it from
 * Medusa instead of keeping its own copy. The token is public by design
 * (InPost Manager issues it for the storefront's domain and the page shows
 * it), so the answer is cacheable for five minutes. An expired token answers
 * 404 like a missing one: the map would refuse it anyway.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const o = inpostService(req.scope).getOptions()
  const g = readGeowidgetToken(o.geowidgetToken)
  if (!g.set || g.expired) {
    res.setHeader("Cache-Control", "public, max-age=60")
    res.status(404).json({ code: "geowidget_not_configured", message: g.expired ? "The Geowidget token has expired." : "No Geowidget token is set (option geowidgetToken)." })
    return
  }
  const environment = g.environment ?? (o.sandbox ? "sandbox" : "production")
  const body: GeowidgetStoreResponse = { token: o.geowidgetToken, environment, host: geowidgetHost(environment, o.sandbox) }
  res.setHeader("Cache-Control", "public, max-age=300")
  res.json(body)
}
