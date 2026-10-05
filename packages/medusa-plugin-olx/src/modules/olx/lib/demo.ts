/**
 * DEMO MODE: SAMPLE ADVERTS BUILT FROM THE STORE'S OWN CATALOG. Zero imports.
 *
 * Lets anyone evaluate the plugin without an OLX developer account: the
 * adverts below go through the SAME parser and the SAME matching as real
 * Partner API data, so the admin shows exactly what a connected account
 * would. Nothing is sent to OLX in demo mode. Every row is flagged `demo`.
 *
 * Deterministic: the same catalog gives the same adverts, so the hourly run
 * reports "no changes" instead of churning the table.
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

const WORDS = {
  pl: {
    set: "zestaw",
    used: "używany",
    codeLabel: "Kod produktu",
    intro: "Przykładowe ogłoszenie wygenerowane z katalogu sklepu (tryb demo wtyczki OLX by Koda Plus).",
    noCode: "Opis bez kodu produktu, więc wtyczka nie ma po czym dopasować ogłoszenia.",
  },
  en: {
    set: "set",
    used: "used",
    codeLabel: "SKU",
    intro: "Sample advert generated from the store catalog (demo mode of OLX by Koda Plus).",
    noCode: "Description without a product code, so the plugin has nothing to match on.",
  },
}

/** FNV-1a, 32 bit. Stable advert ids across runs. */
function hash(text: string): number {
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

function searchUrl(ctx: DemoContext, title: string): string {
  if (ctx.market !== "pl") return `https://${ctx.host}/`
  const q = title.toLowerCase().replace(/["'/\\]+/g, " ").trim().replace(/\s+/g, "-")
  return `https://${ctx.host}/oferty/q-${encodeURIComponent(q)}/`
}

function scaled(price: DemoVariant["price"], factor: number): DemoVariant["price"] {
  if (!price) return null
  return { value: Math.round(price.value * factor), currency: price.currency }
}

/**
 * Raw objects shaped like Partner API `data[]` items. Feed them to
 * `advertsFromPartnerApi`, exactly like a page read from OLX.
 */
export function buildDemoRawAdverts(variants: readonly DemoVariant[], ctx: DemoContext): Record<string, unknown>[] {
  const w = ctx.market === "pl" ? WORDS.pl : WORDS.en
  const picked = [...variants]
    .filter((v) => v.sku && v.productTitle)
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0))
    .slice(0, 10)
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
    const description = [
      w.intro,
      args.descriptionCode ? `${w.codeLabel}: ${args.descriptionCode}` : w.noCode,
    ].join("<br>")
    out.push({
      id: Number(id),
      status: args.status,
      url: searchUrl(ctx, args.title),
      title: args.title,
      description,
      external_id: args.externalId,
      price: args.price ? { value: args.price.value, currency: args.price.currency } : null,
      created_at: olxDate(created),
      valid_to: olxDate(validTo),
    })
  }

  picked.forEach((v, i) => {
    /* Statuses the admin should demonstrate: one advert over the package
     * limit, one ended, the rest live. Keys alternate between the two sources. */
    const status = i === 2 ? "limited" : i === 5 ? "removed_by_user" : "active"
    const viaExternal = i % 2 === 0
    push({
      seed: `${v.sku}#main`,
      title: v.productTitle,
      status,
      externalId: viaExternal ? v.sku : null,
      descriptionCode: viaExternal ? null : v.sku,
      price: v.price,
      ageDays: 2 + i * 3,
    })
  })

  const first = picked[0]
  const second = picked[1]
  const fourth = picked[3]

  /* An older, ended advert of the first item: the live one must stay primary. */
  if (first) {
    push({
      seed: `${first.sku}#old`,
      title: first.productTitle,
      status: "outdated",
      externalId: first.sku,
      descriptionCode: null,
      price: first.price,
      ageDays: 75,
    })
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
