/**
 * DEMO MODE: the story of `lib/demo.ts` on the store's own catalog.
 *
 * Built on the first visit of the admin page in demo mode (and by the
 * product and customer widgets), then rebuilt once a day, when the
 * generator changes, or on "Reset demo data": the threads people answered,
 * accepted or rejected on a public demo come back as they were, with the
 * times counted back from the rebuild. The rebuild replaces only the story's
 * own rows (ids `neg_demo_*`); other demo threads, like the ones a
 * storefront opened in demo mode, stay. The demo toggle of the draft order
 * writer goes back to off with it.
 */

import { DEMO_GENERATOR_VERSION, DEMO_RESET_MS } from "../../modules/negotiations/lib/constants"
import type { RunTrigger } from "../../modules/negotiations/lib/contract"
import { pickListPrice, type PriceRecord } from "../../modules/negotiations/lib/catalog"
import { buildDemoStory, type DemoCustomer, type DemoVariant } from "../../modules/negotiations/lib/demo"
import { currencyDigits, normalizeCurrency } from "../../modules/negotiations/lib/money"
import { writerSettingKey } from "../../modules/negotiations/lib/writers"
import { envOf, graph, recordRun, storeDefaults, withLock, type Scope } from "./runtime"

export const DEMO_STORY_KEY = "demo:story"

interface StoryMarker {
  version?: string
  key?: string
  seededAt?: string
  threads?: number
}

interface VariantRecord {
  id: string
  sku?: string | null
  title?: string | null
  product_id?: string | null
  product?: { id?: string; title?: string | null; status?: string | null } | null
  prices?: PriceRecord[] | null
}

async function catalog(scope: Scope, currency: string): Promise<DemoVariant[]> {
  const digits = currencyDigits(currency)
  let rows = await graph<VariantRecord>(scope, {
    entity: "product_variant",
    fields: ["id", "sku", "title", "product_id", "product.id", "product.title", "product.status", "prices.amount", "prices.currency_code", "prices.price_list_id", "prices.min_quantity", "prices.max_quantity", "prices.rules_count"],
    pagination: { take: 300, order: { sku: "ASC" } },
  })
  if (rows.length === 0) {
    rows = await graph<VariantRecord>(scope, {
      entity: "product_variant",
      fields: ["id", "sku", "title", "product_id", "product.id", "product.title", "product.status", "prices.amount", "prices.currency_code"],
      pagination: { take: 300 },
    })
  }
  const out: DemoVariant[] = []
  for (const v of rows) {
    const productId = v.product?.id ?? v.product_id ?? null
    if (!productId || !v.sku || (v.product?.status && v.product.status !== "published")) continue
    const amount = pickListPrice(v.prices, currency, 1, digits)
    if (amount === null) continue
    out.push({ variantId: v.id, productId, sku: v.sku, productTitle: v.product?.title ?? v.sku, variantTitle: v.title ?? null, amount })
  }
  return out
}

async function customers(scope: Scope): Promise<DemoCustomer[]> {
  const rows = await graph<{ id: string; email?: string | null; company_name?: string | null; first_name?: string | null; last_name?: string | null; has_account?: boolean | null }>(scope, {
    entity: "customer",
    fields: ["id", "email", "company_name", "first_name", "last_name", "has_account"],
    pagination: { take: 50, order: { created_at: "ASC" } },
  })
  return rows
    .filter((c) => c.has_account !== false)
    .map((c) => ({ id: c.id, email: c.email ?? null, company: c.company_name ?? null, name: [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || null }))
}

/**
 * Makes sure the demo story is there and fresh. A no-op outside demo mode
 * and, in demo mode, a single settings read while the story is younger than
 * a day.
 */
export async function ensureDemoStory(scope: Scope, opts: { force?: boolean; trigger?: RunTrigger } = {}): Promise<boolean> {
  const env = await envOf(scope)
  if (!env.options.demo) return false
  const [marker] = await env.stores.settings.get([DEMO_STORY_KEY])
  const m = (marker?.value ?? null) as StoryMarker | null
  const seededAt = m?.seededAt ? new Date(m.seededAt).getTime() : 0
  const fresh = m?.version === DEMO_GENERATOR_VERSION && Number.isFinite(seededAt) && Date.now() - seededAt < DEMO_RESET_MS
  if (!opts.force && fresh) return false

  return withLock("demo-story", async () => {
    /* Another request of this process may have rebuilt it while this one waited. */
    if (!opts.force) {
      const [again] = await env.stores.settings.get([DEMO_STORY_KEY])
      const a = (again?.value ?? null) as StoryMarker | null
      const at = a?.seededAt ? new Date(a.seededAt).getTime() : 0
      if (a?.version === DEMO_GENERATOR_VERSION && Date.now() - at < DEMO_RESET_MS) return false
    }
    const started = new Date()
    const defaults = await storeDefaults(scope)
    const currency = normalizeCurrency(env.options.defaultCurrency) ?? defaults.currency ?? "eur"
    const story = buildDemoStory({ variants: await catalog(scope, currency), customers: await customers(scope), currency, now: started })
    await env.stores.threads.replaceDemoStory(story.threads, story.messages)
    await env.stores.settings.put(writerSettingKey("draftOrders", true), { on: false }, null, started)
    await env.stores.settings.put(DEMO_STORY_KEY, { version: DEMO_GENERATOR_VERSION, key: story.key, seededAt: started.toISOString(), threads: story.threads.length }, null, started)
    await recordRun(scope, true, {
      kind: "demo",
      trigger: opts.trigger ?? "auto",
      status: "ok",
      startedAt: started,
      counts: { threads: story.threads.length, messages: story.messages.length },
      message: story.threads.length === 0 ? "No published variant with a price in the demo currency: the story is empty until the catalog has one." : null,
    })
    return true
  })
}

/** The marker of the story for the status: when it was built and how many threads it has. */
export async function demoInfo(scope: Scope): Promise<{ seededAt: string | null; threads: number } | null> {
  const env = await envOf(scope)
  if (!env.options.demo) return null
  const [marker] = await env.stores.settings.get([DEMO_STORY_KEY])
  const m = (marker?.value ?? null) as StoryMarker | null
  return { seededAt: m?.seededAt ?? null, threads: typeof m?.threads === "number" ? m.threads : 0 }
}
