import { test } from "node:test"
import assert from "node:assert/strict"
import { DeliveryReader, domainTypo } from "../src/modules/emails/lib/delivery.ts"

test("domain typos are corrected, good domains left alone", () => {
  assert.equal(domainTypo("jonik.agnieszka@gmial.com"), "jonik.agnieszka@gmail.com")
  assert.equal(domainTypo("a@wp.p"), "a@wp.pl")
  assert.equal(domainTypo("a@gmail.com"), null)
  assert.equal(domainTypo("brak"), null)
})

test("the reader pages suppressions, caches them, and reports a key without read access", async () => {
  const calls: string[] = []
  const pages = [
    { data: [{ id: "s1", email: "A@x.pl", origin: "bounce", source_id: "e1", created_at: "2026-10-01" }], has_more: true },
    { data: [{ id: "s2", email: "b@y.pl", origin: "complaint", source_id: null, created_at: "2026-10-02" }], has_more: false },
  ]
  const ok = (async (url: string) => {
    calls.push(String(url))
    return new Response(JSON.stringify(pages[calls.length - 1]), { status: 200 })
  }) as unknown as typeof fetch
  const r = new DeliveryReader("re_x", ok)
  const s = await r.suppressions()
  assert.deepEqual(s.list.map((x) => x.email), ["b@y.pl", "a@x.pl"])
  assert.ok(calls[1].includes("after=s1"))
  await r.suppressions()
  assert.equal(calls.length, 2, "second read comes from the cache")
  const denied = new DeliveryReader("re_send_only", (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch)
  const d = await denied.suppressions()
  assert.match(d.error ?? "", /full access/)
  assert.deepEqual(d.list, [])
})
