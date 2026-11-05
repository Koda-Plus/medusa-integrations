// Read-only probe of the InPost Von Halsky stage API through the plugin's own client.
// Run from this package: node --experimental-strip-types --no-warnings --import ./test/ts-resolve.mjs test/stage-probe.ts
// Credentials come from the environment (add --env-file=<file>, or use railway run): VH_CLIENT_ID, VH_CLIENT_SECRET, VH_ORG_ID.
// Every non-GET call to the API gateway throws before it is sent; the token POST is the only write-shaped call.
// Prints counts, statuses and which fields were filled, never values of buyer data.
import { createLiveClient } from "../src/modules/vonhalsky/lib/client.ts"

const API = process.env.VH_API_URL || "https://stage-api.inpost-group.com/inpsa"
const TOKEN = process.env.VH_TOKEN_URL || "https://stage-account.inpost-group.com/oauth2/token"
/* VH_* from a local file, or the plugin's own sandbox variables (railway run). */
const id = process.env.VH_CLIENT_ID || process.env.VONHALSKY_SANDBOX_CLIENT_ID || ""
const secret = process.env.VH_CLIENT_SECRET || process.env.VONHALSKY_SANDBOX_CLIENT_SECRET || ""
const org = process.env.VH_ORG_ID || process.env.VONHALSKY_SANDBOX_ORGANIZATION_ID || ""
if (!id || !secret) {
  console.log("missing: " + [!id && "VH_CLIENT_ID", !secret && "VH_CLIENT_SECRET"].filter(Boolean).join(", "))
  process.exit(2)
}
if (!API.includes("stage")) throw new Error("not a stage gateway: refusing")

const calls: string[] = []
const guarded: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
  const method = (init?.method ?? "GET").toUpperCase()
  if (url.startsWith(API) && method !== "GET") throw new Error(`blocked ${method} ${url.slice(API.length)}`)
  const res = await fetch(input, init)
  if (url.startsWith(TOKEN)) {
    /* The organization id may sit in the token claims: print claim names and org-like values, never the token. */
    const body = (await res.clone().json().catch(() => ({}))) as { access_token?: string; scope?: string }
    const part = body.access_token?.split(".")[1]
    if (part) {
      const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>
      console.log("token claims: " + Object.keys(claims).join(", "))
      for (const [k, v] of Object.entries(claims)) if (/org|merchant|tenant/i.test(k)) console.log(`  ${k} = ${JSON.stringify(v)}`)
    }
    if (body.scope) console.log("token scope: " + body.scope)
  }
  calls.push(`${method} ${url.startsWith(API) ? url.slice(API.length).split("?")[0] : "(token)"} ${res.status}`)
  return res
}

const client = createLiveClient({ mode: "sandbox", apiUrl: API, tokenUrl: TOKEN, clientId: id, clientSecret: secret, organizationId: org, timeoutMs: 30_000, fetch: guarded })

/** Which keys are filled (not null, not empty), with no values. */
const shape = (o: unknown): string => {
  if (!o || typeof o !== "object") return String(o === null ? "null" : typeof o)
  return Object.entries(o as Record<string, unknown>)
    .map(([k, v]) => `${k}${v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) ? "-" : Array.isArray(v) ? `[${v.length}]` : "+"}`)
    .join(" ")
}
const tally = (xs: Array<string | null | undefined>) => xs.reduce<Record<string, number>>((a, x) => ((a[x ?? "null"] = (a[x ?? "null"] ?? 0) + 1), a), {})

const results: Array<{ step: string; ok: boolean; info: string }> = []
async function step(name: string, fn: () => Promise<string>) {
  const t = Date.now()
  try {
    const info = await fn()
    results.push({ step: name, ok: true, info })
    console.log(`ok   ${name} (${Date.now() - t} ms): ${info}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    results.push({ step: name, ok: false, info: msg })
    console.log(`FAIL ${name} (${Date.now() - t} ms): ${msg.replaceAll(secret, "***").slice(0, 600)}`)
  }
}

if (!org) {
  await client.check().catch(() => null)
  console.log("VH_ORG_ID not set: take the organization id from the claims above and add it to the file")
  process.exit(3)
}
await step("check (token, organization, one offer)", async () => {
  const r = await client.check()
  return `organization ${r.organization ? "named" : "null"}`
})
await step("limits", async () => JSON.stringify(client.limits()))
await step("dictionaries", async () => {
  const d = await client.dictionaries()
  return `refundReasons ${d.refundReasons.length}, returnRejectReasons ${d.returnRejectReasons.length}, claimTypes ${d.claimTypes.length}`
})
await step("depositTypes", async () => `${(await client.depositTypes()).length}`)
let firstOfferId: string | null = null
await step("listOffers", async () => {
  const r = await client.listOffers({ offset: 0, limit: 30 })
  firstOfferId = r.offers[0]?.id ?? null
  return `total ${r.total}, page ${r.offers.length}, statuses ${JSON.stringify(tally(r.offers.map((o) => o.status)))}${r.offers[0] ? `; first: ${shape(r.offers[0])}` : ""}`
})
if (firstOfferId) await step("getOffer (first)", async () => shape(await client.getOffer(firstOfferId!)))
await step("offerEvents", async () => {
  const e = await client.offerEvents({ limit: 20 })
  return `${e.length}; types ${JSON.stringify(tally(e.map((x) => x.type)))}`
})
let firstOrderId: string | null = null
await step("listOrders (last 90 days)", async () => {
  const r = await client.listOrders({ offset: 0, limit: 30, updatedSince: new Date(Date.now() - 90 * 864e5).toISOString() })
  firstOrderId = r.orders[0]?.id ?? null
  return `total ${r.total}, page ${r.orders.length}, statuses ${JSON.stringify(tally(r.orders.map((o) => o.status)))}${r.orders[0] ? `; first: ${shape(r.orders[0])}` : ""}`
})
if (firstOrderId) await step("getOrder (first)", async () => shape(await client.getOrder(firstOrderId!)))
await step("orderEvents", async () => {
  const e = await client.orderEvents({ limit: 20 })
  return `${e.length}; types ${JSON.stringify(tally(e.map((x) => x.type)))}`
})
await step("listReturns", async () => {
  const r = await client.listReturns({ offset: 0, limit: 30 })
  return `total ${r.total}, statuses ${JSON.stringify(tally(r.returns.map((x) => x.status)))}`
})
await step("listRefunds", async () => {
  const r = await client.listRefunds({ offset: 0, limit: 30 })
  return `total ${r.total}, statuses ${JSON.stringify(tally(r.refunds.map((x) => x.status)))}`
})
await step("listClaims", async () => {
  const r = await client.listClaims({ offset: 0, limit: 30 })
  return `total ${r.total}, statuses ${JSON.stringify(tally(r.claims.map((x) => x.state)))}`
})
let leaf: string | null = null
await step("categories (full tree, as the weekly sync)", async () => {
  const tree = await client.categories()
  const all: Array<{ id: string; leaf: boolean; children: unknown[] }> = []
  const walk = (ns: typeof tree, d: number, depth: number[]) => { for (const n of ns) { all.push(n); depth[d] = (depth[d] ?? 0) + 1; walk(n.children, d + 1, depth) } }
  const depth: number[] = []
  walk(tree, 0, depth)
  leaf = all.find((x) => x.leaf)?.id ?? null
  return `${all.length} nodes, ${all.filter((x) => x.leaf).length} leaves, per level ${JSON.stringify(depth)}`
})
if (leaf) await step("categoryAttributes (first leaf)", async () => {
  const a = await client.categoryAttributes(leaf!)
  return `${a.length} attributes, ${a.filter((x) => x.required).length} required`
})
await step("hints (sample EAN)", async () => `${(await client.hints({ ean: "5901234123457" })).length}`)

console.log("\ncalls: " + calls.length)
const byPath = tally(calls.map((c) => c.replace(/\/[0-9a-f-]{8,}(?=\/|\s)/gi, "/{id}")))
for (const [k, n] of Object.entries(byPath)) console.log(`  ${n}x ${k}`)
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} ok`)
process.exit(results.every((r) => r.ok) ? 0 : 1)
