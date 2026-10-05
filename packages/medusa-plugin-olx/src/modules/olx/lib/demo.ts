/**
 * DEMO MODE: A SIMULATED OLX ACCOUNT BUILT FROM THE STORE'S OWN CATALOG.
 * Zero imports.
 *
 * Lets anyone evaluate the plugin without an OLX developer account: the raw
 * objects below are shaped like Partner API answers and go through the SAME
 * parsers, planners and apply loops as real data. Nothing is sent to OLX in
 * demo mode, and every row is flagged `demo`.
 *
 * Deterministic: the same catalog gives the same account, so the hourly run
 * reports "no changes" instead of churning the tables.
 *
 * THE STORY, by the variants sorted by SKU (up to ten get an advert, up to
 * three are kept back for publishing):
 *
 *   advert 1   live, its OLX price is stale (the price writer has work)
 *   advert 2   live, but the variant is SOLD OUT in the simulation
 *   advert 3   over the package limit, and sold out (finish)
 *   advert 4   live, but the product is UNPUBLISHED in the simulation
 *   advert 5   removed earlier BY THE PLUGIN, the variant is back in stock
 *   the rest   live
 *   kept back  in stock and never on OLX: the publish plan, where the last
 *              one misses a required attribute
 *
 * plus an old ended duplicate, two live adverts whose codes are not in the
 * catalog and one live advert without any code, exactly as in real accounts.
 * The stock and the product status of the simulation never touch the real
 * catalog: they only change what the planners are told.
 */

export interface DemoVariant {
  sku: string
  productTitle: string
  price: { value: number; currency: string } | null
}

export interface DemoContext {
  market: string
  host: string
  now: Date
}

export interface DemoScenario {
  /** SKUs with a main advert, sorted. */
  advertised: string[]
  /** SKUs kept back for the publish plan. */
  candidates: string[]
  soldOut: string[]
  unpublished: string[]
  /** Deactivated by the plugin earlier (simulated history). */
  paused: string[]
  stalePrice: string[]
  /** A publish candidate without the value of a required attribute. */
  missingAttribute: string | null
}

/** OLX category and city of the simulation. Not real OLX ids. */
export const DEMO_CATEGORY_ID = 990001
export const DEMO_CITY_ID = 990001

const WORDS = {
  pl: {
    set: "zestaw",
    used: "używany",
    codeLabel: "Kod produktu",
    intro: "Przykładowe ogłoszenie wygenerowane z katalogu sklepu (tryb demo wtyczki OLX by Koda Plus).",
    noCode: "Opis bez kodu produktu, więc wtyczka nie ma po czym dopasować ogłoszenia.",
    category: "Narzędzia (symulacja)",
    state: "Stan",
    stateNew: "Nowe",
    stateUsed: "Używane",
    brand: "Marka",
    price: "Cena",
    delivery: "Przesyłka",
    contact: "Koda Supply (demo)",
  },
  en: {
    set: "set",
    used: "used",
    codeLabel: "SKU",
    intro: "Sample advert generated from the store catalog (demo mode of OLX by Koda Plus).",
    noCode: "Description without a product code, so the plugin has nothing to match on.",
    category: "Tools (simulation)",
    state: "Condition",
    stateNew: "New",
    stateUsed: "Used",
    brand: "Brand",
    price: "Price",
    delivery: "Delivery",
    contact: "Koda Supply (demo)",
  },
}

function words(market: string) {
  return market === "pl" ? WORDS.pl : WORDS.en
}

/** FNV-1a, 32 bit. Stable ids across runs. */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function advertId(seed: string, used: Set<string>): string {
  let n = 1_000_000_000 + (hash(seed) % 899_999_999)
  while (used.has(String(n))) n += 1
  used.add(String(n))
  return String(n)
}

function olxDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ")
}

export function demoSearchUrl(market: string, host: string, title: string): string {
  if (market !== "pl") return `https://${host}/`
  const q = title.toLowerCase().replace(/["'/\\]+/g, " ").trim().replace(/\s+/g, "-")
  return `https://${host}/oferty/q-${encodeURIComponent(q)}/`
}

function scaled(price: DemoVariant["price"], factor: number): DemoVariant["price"] {
  if (!price) return null
  return { value: Math.round(price.value * factor), currency: price.currency }
}

function sortedSkus(skus: readonly string[]): string[] {
  return [...new Set(skus.map((s) => s.trim()).filter(Boolean))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

export function demoScenario(skus: readonly string[]): DemoScenario {
  const sorted = sortedSkus(skus)
  const n = sorted.length
  const keep = n >= 4 ? Math.min(3, n - 3) : 0
  const advertisedCount = Math.min(10, n - keep)
  const advertised = sorted.slice(0, advertisedCount)
  const candidates = sorted.slice(advertisedCount, advertisedCount + keep)
  const at = (i: number): string[] => (advertised[i] ? [advertised[i]] : [])
  return {
    advertised,
    candidates,
    soldOut: [...at(1), ...at(2)],
    unpublished: at(3),
    paused: at(4),
    stalePrice: at(0),
    missingAttribute: candidates.length >= 2 ? candidates[candidates.length - 1] : null,
  }
}

/** Status of the main advert of the i-th advertised variant. */
function mainStatus(i: number): string {
  if (i === 2) return "limited"
  if (i === 4) return "removed_by_user"
  return "active"
}

/**
 * Raw objects shaped like Partner API `data[]` items. Feed them to
 * `advertsFromPartnerApi`, exactly like a page read from OLX.
 */
export function buildDemoRawAdverts(variants: readonly DemoVariant[], ctx: DemoContext): Record<string, unknown>[] {
  const w = words(ctx.market)
  const bySku = new Map<string, DemoVariant>()
  for (const v of variants) if (v.sku && v.productTitle && !bySku.has(v.sku)) bySku.set(v.sku, v)
  const scenario = demoScenario([...bySku.keys()])
  const picked = scenario.advertised.map((sku) => bySku.get(sku) as DemoVariant)
  const usedIds = new Set<string>()
  const day = 24 * 60 * 60 * 1000
  const out: Record<string, unknown>[] = []

  const push = (args: {
    seed: string
    title: string
    status: string
    externalId: string | null
    descriptionCode: string | null
    price: DemoVariant["price"]
    ageDays: number
    validDays?: number
  }): void => {
    const created = new Date(ctx.now.getTime() - args.ageDays * day)
    const validTo = new Date(created.getTime() + (args.validDays ?? 30) * day)
    const id = advertId(args.seed, usedIds)
    const description = [w.intro, args.descriptionCode ? `${w.codeLabel}: ${args.descriptionCode}` : w.noCode].join("<br>")
    out.push({
      id: Number(id),
      status: args.status,
      url: demoSearchUrl(ctx.market, ctx.host, args.title),
      title: args.title,
      description,
      category_id: DEMO_CATEGORY_ID,
      external_id: args.externalId,
      price: args.price ? { value: args.price.value, currency: args.price.currency } : null,
      created_at: olxDate(created),
      valid_to: olxDate(validTo),
    })
  }

  picked.forEach((v, i) => {
    const viaExternal = i % 2 === 0
    push({
      seed: `${v.sku}#main`,
      title: v.productTitle,
      status: mainStatus(i),
      externalId: viaExternal ? v.sku : null,
      descriptionCode: viaExternal ? null : v.sku,
      price: scenario.stalePrice.includes(v.sku) ? scaled(v.price, 0.9) : v.price,
      ageDays: 2 + i * 3,
    })
  })

  const first = picked[0]
  const second = picked[1]
  const fourth = picked[3]

  /* An older, ended advert of the first item: the live one must stay primary. */
  if (first) {
    push({ seed: `${first.sku}#old`, title: first.productTitle, status: "outdated", externalId: first.sku, descriptionCode: null, price: first.price, ageDays: 75 })
  }
  /* Two live adverts whose keys are not in the catalog: "live without product". */
  if (first) {
    push({
      seed: `${first.sku}#set`,
      title: `${first.productTitle} (${w.set})`,
      status: "active",
      externalId: null,
      descriptionCode: `${first.sku}-SET`,
      price: scaled(first.price, 2),
      ageDays: 4,
    })
  }
  if (second) {
    push({
      seed: `${second.sku}#used`,
      title: `${second.productTitle} (${w.used})`,
      status: "active",
      externalId: `${second.sku}-U`,
      descriptionCode: null,
      price: scaled(second.price, 0.7),
      ageDays: 6,
    })
  }
  /* A live advert without any code: nothing to match on. */
  if (fourth) {
    push({
      seed: `${fourth.sku}#nocode`,
      title: `${fourth.productTitle} (${w.used})`,
      status: "active",
      externalId: null,
      descriptionCode: null,
      price: scaled(fourth.price, 0.6),
      ageDays: 9,
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Writes of the demo writers, replayed onto the simulated account     */
/* ------------------------------------------------------------------ */

export type DemoWrite =
  | { kind: "lifecycle"; olxId: string; command: "deactivate" | "activate" | "finish" }
  | { kind: "price"; olxId: string; price: { value: number; currency: string } }
  | {
      kind: "publish"
      olxId: string
      title: string
      url: string
      externalId: string
      price: { value: number; currency: string } | null
      createdAt: Date
    }

/** Status a lifecycle command leaves in the simulation (`finish` ends as outdated there). */
export const DEMO_COMMAND_STATUS: Record<"deactivate" | "activate" | "finish", string> = {
  deactivate: "removed_by_user",
  activate: "active",
  finish: "outdated",
}

/**
 * The account as the demo writers left it: published adverts added (live,
 * moderation done), then lifecycle commands and prices applied.
 */
export function applyDemoWrites(raw: readonly Record<string, unknown>[], writes: readonly DemoWrite[], ctx: DemoContext): Record<string, unknown>[] {
  const w = words(ctx.market)
  const out = raw.map((r) => ({ ...r }))
  const byId = new Map(out.map((r) => [String(r.id), r]))
  for (const write of writes) {
    if (write.kind !== "publish" || byId.has(write.olxId)) continue
    const created = write.createdAt
    const advert: Record<string, unknown> = {
      id: Number(write.olxId),
      status: "active",
      url: write.url,
      title: write.title,
      description: `${w.intro}<br>${w.codeLabel}: ${write.externalId}`,
      category_id: DEMO_CATEGORY_ID,
      external_id: write.externalId,
      price: write.price,
      created_at: olxDate(created),
      valid_to: olxDate(new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000)),
    }
    out.push(advert)
    byId.set(write.olxId, advert)
  }
  for (const write of writes) {
    const target = byId.get(write.olxId)
    if (!target) continue
    if (write.kind === "lifecycle") target.status = DEMO_COMMAND_STATUS[write.command]
    if (write.kind === "price") target.price = { value: write.price.value, currency: write.price.currency }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Statistics, threads and the publish category of the simulation      */
/* ------------------------------------------------------------------ */

/** Raw answer of `GET /adverts/{id}/statistics`, growing with the age of the advert. */
export function demoStatisticsRaw(olxId: string, createdAt: Date | string | null, now: Date): Record<string, number> {
  const h = hash(`${olxId}#stats`)
  const created = createdAt ? new Date(createdAt).getTime() : now.getTime()
  const days = Math.max(1, Math.round((now.getTime() - (Number.isFinite(created) ? created : now.getTime())) / 86_400_000))
  const views = 40 + (h % 60) + days * (6 + (h % 9))
  return {
    advert_views: views,
    phone_views: Math.round(views * (0.04 + ((h >> 4) % 6) / 100)),
    users_observing: 1 + ((h >> 8) % 7) + Math.floor(days / 3),
  }
}

function uuidFrom(seed: string): string {
  const hex = [hash(`${seed}#a`), hash(`${seed}#b`), hash(`${seed}#c`), hash(`${seed}#d`)].map((n) => n.toString(16).padStart(8, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Raw answer of `GET /threads`: conversations about the live adverts, some of them unread. */
export function demoThreadsRaw(adverts: ReadonlyArray<{ olxId: string; status: string; createdAt: Date | string | null }>, now: Date): Record<string, unknown>[] {
  const live = [...adverts].filter((a) => a.status === "active").sort((a, b) => a.olxId.localeCompare(b.olxId))
  const out: Record<string, unknown>[] = []
  live.forEach((a, i) => {
    const h = hash(`${a.olxId}#threads`)
    const count = i === 0 ? 2 : h % 3
    for (let t = 0; t < count; t += 1) {
      const seed = `${a.olxId}#thread${t}`
      const th = hash(seed)
      const unread = i === 0 && t === 0 ? 2 : (th >> 3) % 3 === 0 ? 1 + (th % 2) : 0
      const created = new Date(now.getTime() - (1 + (th % 72)) * 60 * 60 * 1000)
      out.push({
        id: 100_000 + (th % 900_000),
        uuid: uuidFrom(seed),
        advert_id: Number(a.olxId),
        interlocutor_id: 1_000_000 + (th % 1_000_000),
        total_count: unread + 1 + (th % 4),
        unread_count: unread,
        created_at: created.toISOString().slice(0, 19).replace("T", " "),
        is_favourite: th % 5 === 0,
      })
    }
  })
  return out
}

/** Raw answers of `GET /categories/{id}` and `GET /categories/{id}/attributes` for the simulated category. */
export function demoCategoryRaw(market: string): { category: Record<string, unknown>; attributes: Record<string, unknown>[] } {
  const w = words(market)
  return {
    category: { data: { id: DEMO_CATEGORY_ID, name: w.category, parent_id: 628, photos_limit: 8, is_leaf: true } },
    attributes: [
      {
        code: "state",
        label: w.state,
        unit: null,
        validation: { type: "attribute", required: true, numeric: false, min: null, max: null, allow_multiple_values: false },
        values: [
          { code: "new", label: w.stateNew },
          { code: "used", label: w.stateUsed },
        ],
      },
      {
        code: "brand",
        label: w.brand,
        unit: null,
        validation: { type: "attribute", required: true, numeric: false, min: null, max: null, allow_multiple_values: false },
        values: [],
      },
      {
        code: "price",
        label: w.price,
        unit: null,
        validation: { type: "price", required: true, numeric: true, min: null, max: null, allow_multiple_values: false },
        values: [],
      },
      {
        code: "delivery",
        label: w.delivery,
        unit: null,
        validation: { type: "package", required: false, numeric: false, allow_multiple_values: true },
        values: [{ code: "123", label: "InPost M" }],
      },
    ],
  }
}

/** Publish options of the simulation, used where the app set none. */
export function demoPublishDefaults(market: string): {
  location: { cityId: number; districtId: null; latitude: null; longitude: null }
  contact: { name: string; phone: null }
  attributes: Record<string, string>
} {
  return {
    location: { cityId: DEMO_CITY_ID, districtId: null, latitude: null, longitude: null },
    contact: { name: words(market).contact, phone: null },
    attributes: { state: "new" },
  }
}

/** Product metadata of the simulation: the demo category and a brand, except for the one candidate that misses it. */
export function demoCandidateMetadata(sku: string, scenario: DemoScenario): Record<string, unknown> {
  const attributes: Record<string, string> = {}
  if (scenario.missingAttribute !== sku) attributes.brand = "Koda Supply"
  return { olx_category_id: DEMO_CATEGORY_ID, olx_attributes: attributes }
}
