import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ceneoSvc } from "../../../../modules/ceneo/lib/store"
import { feedTokenFromParam, sameToken } from "../../../../modules/ceneo/lib/token"

/**
 * GET /ceneo/feed/<token>.xml
 *
 * THE FILE CENEO READS, PUBLIC, NO LOGIN: Ceneo does not send credentials,
 * so the secret token in the address keeps the file from being guessed.
 * A wrong or missing token gets the same 404 as an unknown path.
 *
 * Only serves. The newest successful build is read from `ceneo_feed`, as it
 * was built: the same bytes until the next build, an ETag from its hash (a
 * 304 when Ceneo already has it) and no work on the catalog during the
 * request. Before the first build: 503 with Retry-After.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  const expected = svc.getOptions().feed.token
  const given = feedTokenFromParam(req.params.token)
  if (!expected || !given || !sameToken(given, expected)) {
    res.status(404).type("text/plain").send("Not found")
    return
  }

  /* Metadata first: a 304 never reads the file itself, which can be megabytes. */
  const [row] = await svc.listCeneoFeeds({ status: "built", xml: { $ne: null } }, { take: 1, order: { built_at: "DESC" }, select: ["id", "hash", "built_at"] })
  if (!row) {
    res.setHeader("Retry-After", "300")
    res.status(503).type("text/plain").send("The Ceneo feed has not been built yet.")
    return
  }

  const etag = typeof row.hash === "string" ? `"${row.hash}"` : null
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("X-Robots-Tag", "noindex, nofollow")
  if (etag) res.setHeader("ETag", etag)
  const builtAt = row.built_at instanceof Date ? row.built_at : typeof row.built_at === "string" ? new Date(row.built_at) : null
  if (builtAt && Number.isFinite(builtAt.getTime())) res.setHeader("Last-Modified", builtAt.toUTCString())

  const ifNoneMatch = req.headers["if-none-match"]
  if (etag && typeof ifNoneMatch === "string" && ifNoneMatch.split(",").some((t) => t.trim() === etag || t.trim() === `W/${etag}`)) {
    res.status(304).end()
    return
  }
  const [file] = await svc.listCeneoFeeds({ id: row.id }, { take: 1, select: ["id", "xml"] })
  if (typeof file?.xml !== "string") {
    /* Pruned between the two reads: the next request gets the newer build. */
    res.setHeader("Retry-After", "60")
    res.status(503).type("text/plain").send("The Ceneo feed is being replaced, try again shortly.")
    return
  }
  res.status(200).type("application/xml; charset=utf-8").send(file.xml)
}
