/**
 * A fake MyPudoAPI behind `fetch` (this file is not a test itself). MyPudo
 * has no test host and was never called, so the shapes are the examples of
 * the PDF (test/fixtures/mypudo, put together by hand, spec DS12):
 *
 *   byaddress   the points with the asked zipCode
 *   bylonglat   every point, each with a distance (kept, or measured)
 *   details     the point with the asked pudoId, else error 601 (shape 1)
 *
 *   failNext(failure)  the next call times out, loses the network (the error
 *                      text holds the URL with the key, as undici's may), or
 *                      answers a given status and body
 *   calls, count       every fetch the client made, with its parameters
 *
 * Nothing here ever reaches a network: a URL outside the host fails the test.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { MYPUDO_PATHS, MYPUDO_URL } from "../src/modules/dpd/lib/constants.ts"
import { haversineM } from "../src/modules/dpd/lib/mypudo.ts"

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "mypudo")

/** One raw pudoItems entry, as MyPudo would send it. */
export type PointRawFixture = Record<string, unknown>

export type MyPudoFixture = { source: string; note?: string; request?: string; httpStatus: number; body: unknown }

/** A MyPudo fixture by its name ("details-ok", with or without ".json"). */
export function loadMyPudoFixture(name: string): MyPudoFixture {
  const file = join(FIXTURES, name.endsWith(".json") ? name : `${name}.json`)
  return JSON.parse(readFileSync(file, "utf8")) as MyPudoFixture
}

/** The pudoItems entries of a fixture. */
export function rawPointsOf(name: string): PointRawFixture[] {
  const body = loadMyPudoFixture(name).body
  const items = body !== null && typeof body === "object" ? (body as { pudoItems?: unknown }).pudoItems : undefined
  return Array.isArray(items) ? items.filter((i): i is PointRawFixture => i !== null && typeof i === "object") : []
}

export type FakeMyPudoFailure = "timeout" | "network" | { status: number; body?: unknown }

function abortError(): Error {
  const err = new Error("This operation was aborted")
  err.name = "AbortError"
  return err
}

const digits = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "").replace(/\D/g, "")

export class FakeMyPudo {
  readonly host: string
  points: PointRawFixture[]
  calls: Array<{ path: string; params: Record<string, string>; authorization: string | null }> = []
  private failures: FakeMyPudoFailure[] = []

  constructor(points: PointRawFixture[] = []) {
    this.host = new URL(MYPUDO_URL).host
    this.points = points
  }

  failNext(failure: FakeMyPudoFailure): void {
    this.failures.push(failure)
  }

  count(): number {
    return this.calls.length
  }

  /** Arrow property, pass as fetchImpl. */
  fetch: typeof fetch = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const url = new URL(href)
    if (url.host !== this.host || !href.startsWith(MYPUDO_URL)) throw new Error(`test: the client called a host outside the fake: ${url.host}`)
    if ((init?.method ?? "GET") !== "GET") throw new Error(`test: MyPudo is read with GET only, not ${init?.method}`)
    const path = href.slice(MYPUDO_URL.length).split("?")[0]
    const params: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      params[key] = value
    })
    const authorization = new Headers(init?.headers).get("authorization")
    this.calls.push({ path, params, authorization })

    const failure = this.failures.shift()
    if (failure === "timeout") throw abortError()
    if (failure === "network") throw new Error(`fetch failed (connect ECONNREFUSED ${href})`)
    if (failure && typeof failure === "object") {
      return new Response(failure.body === undefined ? "" : typeof failure.body === "string" ? failure.body : JSON.stringify(failure.body), {
        status: failure.status,
        headers: { "content-type": "application/json" },
      })
    }
    const requestID = params.requestID ?? ""
    if (path === MYPUDO_PATHS.byAddress) {
      const zip = digits(params.zipCode)
      return this.json(200, { quality: 1, requestID, pudoItems: this.points.filter((p) => digits(p.zipCode) === zip) })
    }
    if (path === MYPUDO_PATHS.byLongLat) {
      const from = { lat: Number(params.latitude), lng: Number(params.longitude) }
      const items = this.points.map((p) => {
        if (p.distance !== undefined) return p
        const lat = Number(p.latitude)
        const lng = Number(p.longitude)
        return Number.isFinite(lat) && Number.isFinite(lng) ? { ...p, distance: String(haversineM(from, { lat, lng })) } : p
      })
      return this.json(200, { requestID, pudoItems: items })
    }
    if (path === MYPUDO_PATHS.details) {
      const id = String(params.pudoId ?? "").toUpperCase()
      const hit = this.points.find((p) => String(p.pudoId ?? "").toUpperCase() === id)
      return hit ? this.json(200, { pudoItems: [hit] }) : this.json(200, { code: "601", message: `Nie znaleziono PUDO o identyfikatorze ${id}` })
    }
    throw new Error(`test: the client called an unknown path: ${path}`)
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }
}
