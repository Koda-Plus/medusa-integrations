/**
 * DEMO MODE: A STORY OF NINE NEGOTIATIONS BUILT FROM THE STORE'S OWN CATALOG.
 * Pure, tested with `node --test`.
 *
 * With `demo: true` the admin opens with threads in every state, on the
 * store's real products and prices and, when it has any, its real customers:
 *
 *   1  open, a customer asked minutes ago                      waiting for you
 *   2  open, a larger order two hours ago                      waiting for you
 *   3  open, the team asked a question back                    waiting for the customer
 *   4  counter offered, valid 14 days                          waiting for the customer
 *   5  countered, then a new target from the customer, with
 *      an internal note of the team                            waiting for you
 *   6  accepted: the customer took the counter offer in the store
 *   7  rejected: the target was below the purchase price
 *   8  expired: the counter offer ran out without an answer
 *   9  a whole cart, three lines, one price for all            waiting for you
 *
 * Prices are the variants' own, sorted by SKU; targets and offers are round
 * fractions of them. The texts come in English and Polish (message
 * `metadata.text`), the admin shows the one of its language.
 *
 * DETERMINISTIC: the same catalog and customers give the same ids, references,
 * amounts and texts, so a rebuild replaces the story in place. Only the
 * times move: they are counted back from the moment of the build, so
 * "two hours ago" stays two hours ago.
 *
 * NEVER MIXED WITH REAL DATA: every row is `demo: true`, the threads are
 * `source: "demo"` (the Store API never shows them to a customer, even one
 * the story borrows), they never expire on their own and emit no events.
 */

import { DEMO_GENERATOR_VERSION, DEMO_ID_PREFIX, DEMO_REF_START, type MessageKind, type NegotiationStatus, type WaitingFor } from "./constants"
import { currencyDigits, multiply, roundPrice } from "./money"
import type { CartLine, MessageInsert, ThreadInsert } from "./rows"
import { formatRef, hash } from "./text"

export interface DemoVariant {
  variantId: string
  productId: string
  sku: string
  productTitle: string
  variantTitle: string | null
  /** The variant's price in the demo currency, minor units. */
  amount: number
}

export interface DemoCustomer {
  id: string
  email: string | null
  company: string | null
  name: string | null
}

export interface DemoInput {
  variants: DemoVariant[]
  customers: DemoCustomer[]
  currency: string
  now: Date
}

export interface DemoStory {
  threads: ThreadInsert[]
  messages: MessageInsert[]
  /** Changes when the catalog, the customers or the generator change. */
  key: string
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

type Lang = "en" | "pl"
type Texts = Record<Lang, string>

function money(amount: number, currency: string, digits: number, lang: Lang): string {
  const major = amount / 10 ** digits
  try {
    return new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: digits, maximumFractionDigits: digits }).format(major)
  } catch {
    return `${major.toFixed(digits)} ${currency.toUpperCase()}`
  }
}

function quoted(title: string, lang: Lang): string {
  return lang === "pl" ? `„${title}”` : `"${title}"`
}

function linesWord(n: number, lang: Lang): string {
  if (lang === "en") return n === 1 ? "line" : "lines"
  if (n === 1) return "pozycja"
  const tens = n % 100
  const ones = n % 10
  return ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? "pozycje" : "pozycji"
}

function fill(template: Texts, values: Record<string, (lang: Lang) => string>): Texts {
  const out = {} as Texts
  for (const lang of ["en", "pl"] as const) {
    out[lang] = template[lang].replace(/\{(\w+)\}/g, (_, key: string) => (values[key] ? values[key](lang) : `{${key}}`))
  }
  return out
}

interface ScriptMessage {
  by: "customer" | "admin" | "system"
  kind: MessageKind
  /** Hours before the build. */
  h: number
  text: Texts
  /** Which price the message carries. */
  price?: "target" | "offer" | "mid"
  internal?: boolean
}

interface Script {
  status: NegotiationStatus
  qty: number
  target: number
  offer: number
  mid?: number
  floor?: number
  /** Days a counter offer stays valid, counted from the message that made it. */
  validDays?: number
  messages: ScriptMessage[]
}

const SCRIPTS: Script[] = [
  {
    status: "open",
    qty: 150,
    target: 0.85,
    offer: 0.92,
    messages: [
      {
        by: "customer",
        kind: "message",
        h: 0.4,
        price: "target",
        text: {
          en: "Good morning, we are stocking up for the season and would take {qty} pcs of {product}. Is {target} per unit possible?",
          pl: "Dzień dobry, na start sezonu weźmiemy {qty} szt. produktu {product}. Czy {target} za sztukę jest możliwe?",
        },
      },
    ],
  },
  {
    status: "open",
    qty: 24,
    target: 0.85,
    offer: 0.92,
    messages: [
      {
        by: "customer",
        kind: "message",
        h: 2,
        price: "target",
        text: {
          en: "We are equipping a new branch and need {qty} pcs of {product}. At this volume we hope for {target} per unit instead of {list}. Can you do that?",
          pl: "Wyposażamy nowy oddział i potrzebujemy {qty} szt. produktu {product}. Przy takim wolumenie liczymy na {target} za sztukę zamiast {list}. Da się?",
        },
      },
    ],
  },
  {
    status: "open",
    qty: 10,
    target: 0.85,
    offer: 0.92,
    messages: [
      {
        by: "customer",
        kind: "message",
        h: 30,
        price: "target",
        text: {
          en: "{qty} pcs of {product} for our workshop. {target} per unit would work for us.",
          pl: "{qty} szt. produktu {product} do naszego warsztatu. Cena {target} za sztukę byłaby dla nas w porządku.",
        },
      },
      {
        by: "admin",
        kind: "message",
        h: 26,
        text: {
          en: "Do you also need the matching accessories? With a complete set I can go down to {offer} per unit.",
          pl: "Czy biorą Państwo też akcesoria? Przy komplecie zejdę do {offer} za sztukę.",
        },
      },
    ],
  },
  {
    status: "counter_offered",
    qty: 120,
    target: 0.8,
    offer: 0.9,
    validDays: 14,
    messages: [
      {
        by: "customer",
        kind: "message",
        h: 28,
        price: "target",
        text: {
          en: "We need {qty} pcs of {product} every month. Our target is {target} per unit.",
          pl: "Co miesiąc potrzebujemy {qty} szt. produktu {product}. Nasza cena docelowa to {target} za sztukę.",
        },
      },
      {
        by: "admin",
        kind: "counter",
        h: 21,
        price: "offer",
        text: {
          en: "For a standing monthly order of {qty} pcs I can offer {offer} per unit with free delivery.",
          pl: "Przy stałym zamówieniu {qty} szt. miesięcznie mogę zaproponować {offer} za sztukę z darmową dostawą.",
        },
      },
    ],
  },
  {
    status: "open",
    qty: 60,
    target: 0.82,
    offer: 0.92,
    mid: 0.87,
    floor: 0.85,
    messages: [
      {
        by: "customer",
        kind: "message",
        h: 60,
        price: "target",
        text: {
          en: "Price request for {qty} pcs of {product}: {target} per unit.",
          pl: "Zapytanie o {qty} szt. produktu {product}: {target} za sztukę.",
        },
      },
      {
        by: "admin",
        kind: "counter",
        h: 50,
        price: "offer",
        text: {
          en: "The best I can do for {qty} pcs is {offer} per unit.",
          pl: "Najlepsza cena przy {qty} szt. to {offer} za sztukę.",
        },
      },
      {
        by: "customer",
        kind: "message",
        h: 5,
        price: "mid",
        text: {
          en: "Thank you. Could we meet at {mid}? We would confirm the order today.",
          pl: "Dziękujemy. Czy możemy spotkać się na {mid}? Potwierdzilibyśmy zamówienie jeszcze dziś.",
        },
      },
      {
        by: "admin",
        kind: "note",
        h: 4,
        internal: true,
        text: {
          en: "Our floor at this volume is {floor}. {mid} is fine to accept.",
          pl: "Nasze minimum przy tym wolumenie to {floor}. {mid} możemy przyjąć.",
        },
      },
    ],
  },
  {
    status: "accepted",
    qty: 40,
    target: 0.84,
    offer: 0.88,
    messages: [
      {
        by: "customer",
        kind: "message",
        h: 98,
        price: "target",
        text: {
          en: "{qty} packs of {product}. Can we get {target} if we collect on Friday?",
          pl: "{qty} opakowań produktu {product}. Czy możemy dostać {target}, jeśli odbierzemy w piątek?",
        },
      },
      {
        by: "admin",
        kind: "counter",
        h: 74,
        price: "offer",
        text: {
          en: "With collection on Friday I can do {offer} per pack.",
          pl: "Przy odbiorze w piątek mogę dać {offer} za opakowanie.",
        },
      },
      {
        by: "customer",
        kind: "accepted",
        h: 72,
        price: "offer",
        text: {
          en: "Accepted, thank you. We will collect on Friday.",
          pl: "Akceptujemy, dziękujemy. Odbierzemy w piątek.",
        },
      },
    ],
  },
  {
    status: "rejected",
    qty: 200,
    target: 0.55,
    offer: 0.76,
    messages: [
      {
        by: "customer",
        kind: "message",
        h: 170,
        price: "target",
        text: {
          en: "{qty} pcs of {product} for our crews. We are aiming at {target} per unit.",
          pl: "{qty} szt. produktu {product} dla naszych ekip. Celujemy w {target} za sztukę.",
        },
      },
      {
        by: "admin",
        kind: "counter",
        h: 150,
        price: "offer",
        text: {
          en: "{target} is below our purchase price. The lowest I can go for {qty} pcs is {offer}.",
          pl: "{target} to poniżej naszej ceny zakupu. Najniżej mogę zejść do {offer} przy {qty} szt.",
        },
      },
      {
        by: "customer",
        kind: "message",
        h: 146,
        text: {
          en: "Unfortunately {offer} does not fit this project's budget.",
          pl: "Niestety {offer} nie mieści się w budżecie tego projektu.",
        },
      },
      {
        by: "admin",
        kind: "rejected",
        h: 145,
        text: {
          en: "Understood. If the budget changes, write to us and we will look again.",
          pl: "Rozumiemy. Gdyby budżet się zmienił, prosimy o wiadomość, wrócimy do tematu.",
        },
      },
    ],
  },
  {
    status: "expired",
    qty: 30,
    target: 0.8,
    offer: 0.9,
    validDays: 14,
    messages: [
      {
        by: "customer",
        kind: "message",
        h: 21 * 24,
        price: "target",
        text: {
          en: "Could you quote {qty} pcs of {product} at {target} per unit?",
          pl: "Czy możemy prosić o wycenę {qty} szt. produktu {product} po {target} za sztukę?",
        },
      },
      {
        by: "admin",
        kind: "counter",
        h: 20 * 24,
        price: "offer",
        text: {
          en: "{offer} per unit, valid for 14 days.",
          pl: "{offer} za sztukę, oferta ważna 14 dni.",
        },
      },
      {
        by: "system",
        kind: "expired",
        h: 6 * 24,
        text: {
          en: "The negotiation expired without an answer.",
          pl: "Negocjacja wygasła bez odpowiedzi.",
        },
      },
    ],
  },
]

const CART_SCRIPT: { quantities: number[]; target: number; h: number; text: Texts } = {
  quantities: [10, 5, 20],
  target: 0.88,
  h: 3,
  text: {
    en: "This is our monthly restock ({lines} {linesWord}, {list} at your prices). We would like to close the whole cart at {target}.",
    pl: "To nasze comiesięczne uzupełnienie stanów ({lines} {linesWord}, {list} według cennika). Chcielibyśmy zamknąć cały koszyk za {target}.",
  },
}

/** Placeholder names when the store has no customers yet. */
function sampleCustomer(n: number): Texts {
  return { en: `Sample customer ${n}`, pl: `Przykładowy klient ${n}` }
}

function sortVariants(variants: DemoVariant[]): DemoVariant[] {
  const seen = new Set<string>()
  return [...variants]
    .filter((v) => v.amount > 0 && v.sku.trim() !== "" && !seen.has(v.variantId) && (seen.add(v.variantId), true))
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : a.variantId < b.variantId ? -1 : 1))
}

function sortCustomers(customers: DemoCustomer[]): DemoCustomer[] {
  const key = (c: DemoCustomer) => `${c.company ? 0 : 1}|${(c.email ?? "").toLowerCase()}|${c.id}`
  return [...customers].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).slice(0, 4)
}

function titleOf(v: DemoVariant): string {
  return v.variantTitle && v.variantTitle !== v.productTitle && !/^default/i.test(v.variantTitle) ? `${v.productTitle} / ${v.variantTitle}` : v.productTitle
}

export function storyKey(input: DemoInput): string {
  const variants = sortVariants(input.variants).slice(0, SCRIPTS.length + 3)
  const customers = sortCustomers(input.customers)
  const text = [DEMO_GENERATOR_VERSION, input.currency, ...variants.map((v) => `${v.variantId}:${v.amount}`), ...customers.map((c) => c.id)].join("|")
  return `${DEMO_GENERATOR_VERSION}:${hash(text).toString(36)}`
}

export function buildDemoStory(input: DemoInput): DemoStory {
  const variants = sortVariants(input.variants)
  const customers = sortCustomers(input.customers)
  const currency = input.currency.toLowerCase()
  const digits = currencyDigits(currency)
  const now = input.now.getTime()
  const at = (h: number) => new Date(now - Math.round(h * HOUR))
  const year = input.now.getUTCFullYear()
  const threads: ThreadInsert[] = []
  const messages: MessageInsert[] = []
  const key = storyKey(input)
  if (variants.length === 0) return { threads, messages, key }

  const customerFor = (i: number): { id: string | null; label: Texts | null } => {
    if (customers.length > 0) return { id: customers[i % customers.length].id, label: null }
    return { id: null, label: sampleCustomer((i % 4) + 1) }
  }
  const fmt = (amount: number) => (lang: Lang) => money(amount, currency, digits, lang)

  for (const [i, script] of SCRIPTS.entries()) {
    const n = String(i + 1).padStart(2, "0")
    const id = `${DEMO_ID_PREFIX}${n}`
    const v = variants[i % variants.length]
    const list = v.amount
    const target = roundPrice(list, script.target, digits)
    const offer = roundPrice(list, script.offer, digits)
    const mid = script.mid ? roundPrice(list, script.mid, digits) : null
    const floor = script.floor ? roundPrice(list, script.floor, digits) : null
    const amounts: Record<"target" | "offer" | "mid", number | null> = { target, offer, mid }
    const values: Record<string, (lang: Lang) => string> = {
      qty: () => String(script.qty),
      product: (lang) => quoted(titleOf(v), lang),
      target: fmt(target),
      offer: fmt(offer),
      list: fmt(list),
      ...(mid ? { mid: fmt(mid) } : {}),
      ...(floor ? { floor: fmt(floor) } : {}),
    }
    const who = customerFor(i)

    let requested: number | null = null
    let offered: number | null = null
    let agreed: number | null = null
    let price: number | null = null
    let validUntil: Date | null = null
    let lastAuthor: ScriptMessage["by"] = "customer"
    let lastPublicAt: Date = at(script.messages[0].h)
    let closedAt: Date | null = null
    for (const [k, m] of script.messages.entries()) {
      const amount = m.price ? amounts[m.price] : null
      const created = at(m.h)
      if (amount !== null && !m.internal) {
        if (m.kind === "counter") {
          offered = amount
          validUntil = script.validDays ? new Date(created.getTime() + script.validDays * DAY) : null
        } else if (m.kind === "accepted") agreed = amount
        else if (m.by === "customer") {
          requested = amount
          validUntil = null
        }
        price = amount
      }
      if (!m.internal) {
        lastAuthor = m.by
        lastPublicAt = created
      }
      if (m.kind === "accepted" || m.kind === "rejected" || m.kind === "expired") closedAt = created
      const text = fill(m.text, values)
      messages.push({
        id: `negmsg_demo_${n}_${k + 1}`,
        negotiation_id: id,
        author_type: m.by,
        author_id: m.by === "customer" ? who.id : null,
        kind: m.kind,
        body: text.en,
        amount,
        internal: Boolean(m.internal),
        metadata: { text },
        created_at: created,
      })
    }

    const first = at(script.messages[0].h)
    const last = at(script.messages[script.messages.length - 1].h)
    const active = script.status === "open" || script.status === "counter_offered"
    const waitingFor: WaitingFor | null = active ? (lastAuthor === "customer" ? "team" : "customer") : null
    threads.push({
      id,
      ref: formatRef(year, DEMO_REF_START + i),
      status: script.status,
      demo: true,
      source: "demo",
      subject: "variant",
      customer_id: who.id,
      product_id: v.productId,
      variant_id: v.variantId,
      cart_id: null,
      sku: v.sku,
      title: titleOf(v),
      qty: script.qty,
      currency_code: currency,
      requested_amount: requested,
      offered_amount: offered,
      agreed_amount: agreed,
      price_amount: price,
      list_amount: list,
      items: null,
      waiting_for: waitingFor,
      last_activity_at: lastPublicAt,
      message_count: script.messages.filter((m) => !m.internal).length,
      expires_at: script.status === "counter_offered" || script.status === "expired" ? validUntil : null,
      closed_at: active ? null : closedAt,
      closed_by: script.status === "accepted" ? "customer" : script.status === "rejected" ? "admin" : script.status === "expired" ? "system" : null,
      assigned_to: null,
      metadata: who.label ? { demo_customer: who.label } : null,
      created_at: first,
      updated_at: last,
    })
  }

  /* The cart: the first three variants (fewer in a smaller catalog). */
  const cartVariants = variants.slice(0, Math.min(3, variants.length))
  const items: CartLine[] = cartVariants.map((v, k) => ({
    variant_id: v.variantId,
    product_id: v.productId,
    sku: v.sku,
    title: titleOf(v),
    quantity: CART_SCRIPT.quantities[k] ?? 1,
    unit_amount: v.amount,
  }))
  const cartList = items.reduce((sum, l) => sum + (multiply(l.unit_amount, l.quantity) ?? 0), 0)
  const cartTarget = roundPrice(cartList, CART_SCRIPT.target, digits)
  const i = SCRIPTS.length
  const n = String(i + 1).padStart(2, "0")
  const id = `${DEMO_ID_PREFIX}${n}`
  const created = at(CART_SCRIPT.h)
  const who = customerFor(i)
  const text = fill(CART_SCRIPT.text, {
    lines: () => String(items.length),
    linesWord: (lang) => linesWord(items.length, lang),
    list: fmt(cartList),
    target: fmt(cartTarget),
  })
  messages.push({
    id: `negmsg_demo_${n}_1`,
    negotiation_id: id,
    author_type: "customer",
    author_id: who.id,
    kind: "message",
    body: text.en,
    amount: cartTarget,
    internal: false,
    metadata: { text },
    created_at: created,
  })
  threads.push({
    id,
    ref: formatRef(year, DEMO_REF_START + i),
    status: "open",
    demo: true,
    source: "demo",
    subject: "cart",
    customer_id: who.id,
    product_id: null,
    variant_id: null,
    cart_id: null,
    sku: null,
    title: null,
    qty: 1,
    currency_code: currency,
    requested_amount: cartTarget,
    offered_amount: null,
    agreed_amount: null,
    price_amount: cartTarget,
    list_amount: cartList,
    items,
    waiting_for: "team",
    last_activity_at: created,
    message_count: 1,
    expires_at: null,
    closed_at: null,
    closed_by: null,
    assigned_to: null,
    metadata: who.label ? { demo_customer: who.label } : null,
    created_at: created,
    updated_at: created,
  })

  return { threads, messages, key }
}
