import { test } from "node:test"
import assert from "node:assert/strict"
import { buildDemoStory, storyKey, type DemoCustomer, type DemoVariant } from "../src/modules/negotiations/lib/demo.ts"
import { DEMO_ID_PREFIX } from "../src/modules/negotiations/lib/constants.ts"
import { normalizeThread } from "../src/modules/negotiations/lib/thread.ts"
import type { ThreadRow } from "../src/modules/negotiations/lib/rows.ts"

const now = new Date("2026-10-07T12:00:00Z")

const variants: DemoVariant[] = [
  { variantId: "variant_c", productId: "prod_c", sku: "KS-ELN-18V", productTitle: "Wiertarko-wkrętarka 18V", variantTitle: "Default variant", amount: 54900 },
  { variantId: "variant_a", productId: "prod_a", sku: "KS-BHP-KSK", productTitle: "Kask ochronny", variantTitle: "Biały", amount: 4500 },
  { variantId: "variant_b", productId: "prod_b", sku: "KS-BHP-RKW", productTitle: "Rękawice powlekane", variantTitle: null, amount: 8200 },
  { variantId: "variant_d", productId: "prod_d", sku: "KS-TSM-5M", productTitle: "Taśma miernicza 5 m", variantTitle: null, amount: 2600 },
  { variantId: "variant_x", productId: "prod_x", sku: "", productTitle: "No SKU", variantTitle: null, amount: 1000 },
]
const customers: DemoCustomer[] = [
  { id: "cus_2", email: "b@example.com", company: null, name: "Ben" },
  { id: "cus_1", email: "z@example.com", company: "Instal Test", name: "Zoe" },
]

test("the story: nine threads in every state, all demo, ids and references fixed", () => {
  const story = buildDemoStory({ variants, customers, currency: "PLN", now })
  assert.equal(story.threads.length, 9)
  assert.deepEqual(
    story.threads.map((t) => t.status),
    ["open", "open", "open", "counter_offered", "open", "accepted", "rejected", "expired", "open"],
  )
  assert.deepEqual(story.threads.map((t) => t.id).slice(0, 2), [`${DEMO_ID_PREFIX}01`, `${DEMO_ID_PREFIX}02`])
  assert.deepEqual(story.threads.map((t) => t.ref).slice(0, 2), ["NEG-2026-9001", "NEG-2026-9002"])
  for (const t of story.threads) {
    assert.equal(t.demo, true)
    assert.equal(t.source, "demo")
    assert.equal(t.currency_code, "pln")
  }
  for (const m of story.messages) assert.ok(story.threads.some((t) => t.id === m.negotiation_id))
})

test("deterministic: the same catalog gives the same story; only the build time moves the clocks", () => {
  const a = buildDemoStory({ variants, customers, currency: "pln", now })
  const b = buildDemoStory({ variants: [...variants].reverse(), customers: [...customers].reverse(), currency: "pln", now })
  assert.deepEqual(a, b, "input order does not matter")
  const later = buildDemoStory({ variants, customers, currency: "pln", now: new Date(now.getTime() + 3_600_000) })
  assert.deepEqual(
    later.threads.map((t) => [t.id, t.ref, t.requested_amount, t.offered_amount, t.agreed_amount]),
    a.threads.map((t) => [t.id, t.ref, t.requested_amount, t.offered_amount, t.agreed_amount]),
  )
  assert.equal(later.threads[0].created_at.getTime() - a.threads[0].created_at.getTime(), 3_600_000)
  assert.equal(storyKey({ variants, customers, currency: "pln", now }), a.key)
  assert.notEqual(storyKey({ variants: variants.slice(1), customers, currency: "pln", now }), a.key, "a catalog change rebuilds the story")
})

test("prices come from the catalog: targets below offers below the list price, per currency decimals", () => {
  const story = buildDemoStory({ variants, customers, currency: "pln", now })
  for (const t of story.threads) {
    if (t.subject === "cart") continue
    assert.ok(t.list_amount !== null && t.list_amount > 0)
    if (t.requested_amount !== null && t.offered_amount !== null && t.status !== "open") {
      assert.ok(t.offered_amount > (story.messages.find((m) => m.negotiation_id === t.id && m.author_type === "customer")?.amount ?? 0), `${t.ref}: the offer is above the first target`)
    }
    if (t.offered_amount !== null) assert.ok(t.offered_amount < (t.list_amount ?? 0), `${t.ref}: the offer is below the list price`)
  }
  /* Sorted by SKU: KS-BHP-KSK first; the variant without a SKU never shows. */
  assert.equal(story.threads[0].sku, "KS-BHP-KSK")
  assert.ok(!story.threads.some((t) => t.variant_id === "variant_x"))
  const accepted = story.threads.find((t) => t.status === "accepted")
  assert.ok(accepted && accepted.agreed_amount === accepted.offered_amount && accepted.closed_by === "customer")
  const cart = story.threads.find((t) => t.subject === "cart")
  assert.ok(cart && cart.items && cart.items.length === 3)
  assert.equal(cart?.list_amount, cart?.items?.reduce((sum, l) => sum + (l.unit_amount ?? 0) * l.quantity, 0))
  assert.ok(cart && cart.requested_amount !== null && cart.requested_amount < (cart.list_amount ?? 0))
})

test("turns, counts and the internal note", () => {
  const story = buildDemoStory({ variants, customers, currency: "pln", now })
  const t = (i: number) => story.threads[i]
  assert.deepEqual(story.threads.map((x) => x.waiting_for), ["team", "team", "customer", "customer", "team", null, null, null, "team"])
  for (const thread of story.threads) {
    const own = story.messages.filter((m) => m.negotiation_id === thread.id)
    assert.equal(thread.message_count, own.filter((m) => !m.internal).length, `${thread.ref}: public messages counted`)
  }
  const notes = story.messages.filter((m) => m.internal)
  assert.equal(notes.length, 1)
  assert.equal(notes[0].kind, "note")
  assert.equal(notes[0].negotiation_id, t(4).id)
  assert.equal(t(4).requested_amount, story.messages.filter((m) => m.negotiation_id === t(4).id && m.author_type === "customer").at(-1)?.amount, "the latest target is on the thread")
  const offer = t(3)
  assert.ok(offer.expires_at && offer.expires_at.getTime() > now.getTime(), "the open counter offer is still valid")
  const expired = t(7)
  assert.ok(expired.expires_at && expired.expires_at.getTime() < now.getTime())
  assert.equal(expired.closed_by, "system")
})

test("texts in English and Polish, with real Polish characters and no dashes or middle dots", () => {
  const story = buildDemoStory({ variants, customers, currency: "pln", now })
  const all = story.messages.flatMap((m) => {
    const text = (m.metadata as { text: { en: string; pl: string } }).text
    assert.equal(m.body, text.en)
    return [text.en, text.pl]
  })
  for (const s of all) {
    assert.ok(![0x2013, 0x2014, 0x00b7].some((c) => s.includes(String.fromCharCode(c))), `no en dash, em dash or middle dot: ${s}`)
    assert.ok(!/\{\w+\}/.test(s), `every placeholder filled: ${s}`)
  }
  assert.ok(all.some((s) => /zł/.test(s)), "Polish prices in złoty")
  assert.ok(all.some((s) => /[ąćęłńóśźż]/.test(s)))
  assert.ok(all.some((s) => /„Kask ochronny \/ Biały”/.test(s)), "product names in Polish quotes")
})

test("customers: the store's own (companies first), or labelled placeholders; an empty catalog gives no story", () => {
  const story = buildDemoStory({ variants, customers, currency: "pln", now })
  assert.equal(story.threads[0].customer_id, "cus_1", "the company first")
  assert.equal(story.threads[1].customer_id, "cus_2")
  const none = buildDemoStory({ variants, customers: [], currency: "pln", now })
  assert.equal(none.threads[0].customer_id, null)
  assert.deepEqual(none.threads[0].metadata, { demo_customer: { en: "Sample customer 1", pl: "Przykładowy klient 1" } })
  assert.equal(buildDemoStory({ variants: [], customers, currency: "pln", now }).threads.length, 0)
  const small = buildDemoStory({ variants: variants.slice(0, 1), customers, currency: "pln", now })
  assert.equal(small.threads.length, 9, "one product is enough for the whole story")
  assert.equal(small.threads.at(-1)?.items?.length, 1)
})

test("the story reads through the same normalization as real threads", () => {
  const story = buildDemoStory({ variants, customers, currency: "pln", now })
  for (const t of story.threads) {
    const n = normalizeThread(t as unknown as ThreadRow, { defaultCurrency: null, expiryDays: 14 })
    assert.equal(n.demoStory, true)
    assert.equal(n.legacy, false)
    assert.equal(n.price, t.price_amount)
  }
})
