/**
 * SAMPLE DATA of the built-in templates, for the admin preview and test
 * sends. Fictional people, companies and addresses; a small home and office
 * catalog, so the preview looks real without any store data. With "Latest
 * order" the admin uses the store's own newest order instead (its products
 * and amounts; the person and the address stay these samples).
 */

import type { EmailLocale } from "../constants"
import type { CartEmailData, CanceledEmailData, NegotiationEmailData, OrderEmailData, PasswordResetEmailData, ShipmentEmailData, WelcomeEmailData } from "../types"

const HOUR = 3600 * 1000

function at(hoursAgo: number, now: Date): string {
  return new Date(now.getTime() - hoursAgo * HOUR).toISOString()
}

interface Catalog {
  lamp: { title: string; sku: string; price: number }
  mug: { title: string; sku: string; price: number }
  notebook: { title: string; sku: string; price: number }
  organiser: { title: string; sku: string; price: number }
  chair: { title: string; sku: string; price: number }
}

const CATALOG: Record<EmailLocale, Catalog> = {
  pl: {
    lamp: { title: "Lampka biurkowa LED", sku: "HO-LMP-10W", price: 189 },
    mug: { title: "Kubek termiczny 450 ml", sku: "HO-MUG-450", price: 79 },
    notebook: { title: "Notes A5 w kropki", sku: "HO-NTB-A5", price: 34.5 },
    organiser: { title: "Organizer na biurko", sku: "HO-ORG-03", price: 119 },
    chair: { title: "Krzesło biurowe ergonomiczne", sku: "HO-CHR-ERG", price: 899 },
  },
  en: {
    lamp: { title: "LED desk lamp", sku: "HO-LMP-10W", price: 39 },
    mug: { title: "Insulated travel mug 450 ml", sku: "HO-MUG-450", price: 18 },
    notebook: { title: "A5 dotted notebook", sku: "HO-NTB-A5", price: 7.5 },
    organiser: { title: "Desk organiser", sku: "HO-ORG-03", price: 26 },
    chair: { title: "Ergonomic office chair", sku: "HO-CHR-ERG", price: 199 },
  },
}

const PEOPLE = {
  pl: { name: "Anna", company: "Pracownia Nowak", address: ["Anna Nowak", "ul. Lipowa 12", "61-897 Poznań"], email: "anna.nowak@example.com", country: "pl", currency: "pln" },
  en: { name: "Emma", company: "Harper Studio", address: ["Emma Harper", "12 Linden Street", "Bristol BS1 4DJ"], email: "emma.harper@example.com", country: "gb", currency: "eur" },
}

function line(p: { title: string; sku: string; price: number }, quantity: number) {
  return { title: p.title, sku: p.sku, quantity, unit_price: p.price, total: Math.round(p.price * quantity * 100) / 100 }
}

function order(locale: EmailLocale, now: Date): OrderEmailData {
  const c = CATALOG[locale]
  const p = PEOPLE[locale]
  const items = [line(c.lamp, 2), line(c.mug, 3), line(c.notebook, 5)]
  const itemsTotal = items.reduce((s, i) => s + i.total, 0)
  const shipping = locale === "pl" ? 14.99 : 4.9
  const total = Math.round((itemsTotal + shipping) * 100) / 100
  const rate = locale === "pl" ? 0.23 : 0.21
  return {
    locale,
    order_id: "order_sample",
    order_number: 1042,
    order_date: at(2, now),
    currency_code: p.currency,
    customer_name: p.name,
    company_name: p.company,
    items,
    items_total: Math.round(itemsTotal * 100) / 100,
    shipping_total: shipping,
    tax_total: Math.round((total * rate) / (1 + rate) * 100) / 100,
    total,
    shipping_method: locale === "pl" ? "Kurier, 1 do 2 dni" : "Courier, 1 to 2 days",
    shipping_address: p.address,
    country_code: p.country,
  }
}

export function sampleOrder(locale: EmailLocale, now = new Date()): OrderEmailData {
  return order(locale, now)
}

export function sampleShipment(locale: EmailLocale, now = new Date()): ShipmentEmailData {
  const o = order(locale, now)
  return {
    ...o,
    order_date: at(30, now),
    shipped_at: at(1, now),
    partial: false,
    tracking: [{ number: "520001234567890123", url: "https://tracking.example.com/520001234567890123", carrier: locale === "pl" ? "Kurier" : "Courier" }],
    shipped_items: o.items,
  }
}

export function sampleCanceled(locale: EmailLocale, now = new Date()): CanceledEmailData {
  return { ...order(locale, now), order_date: at(26, now), canceled_at: at(1, now) }
}

export function sampleWelcome(locale: EmailLocale, now = new Date()): WelcomeEmailData {
  const p = PEOPLE[locale]
  return { locale, customer_name: p.name, company_name: p.company, customer_since: at(0.1, now) }
}

export function samplePasswordReset(locale: EmailLocale): PasswordResetEmailData {
  const p = PEOPLE[locale]
  return {
    locale,
    email: p.email,
    reset_url: `https://shop.example.com/reset-password?token=sample-token&email=${encodeURIComponent(p.email)}`,
    actor: "customer",
    customer_name: p.name,
  }
}

export function sampleCart(locale: EmailLocale): CartEmailData {
  const c = CATALOG[locale]
  const p = PEOPLE[locale]
  const items = [line(c.chair, 1), line(c.organiser, 2)]
  return {
    locale,
    cart_id: "cart_sample",
    currency_code: p.currency,
    customer_name: p.name,
    items,
    cart_total: Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100,
    country_code: p.country,
  }
}

export function sampleNegotiation(locale: EmailLocale, status: "counter_offered" | "accepted" | "rejected", now = new Date()): NegotiationEmailData {
  const c = CATALOG[locale]
  const p = PEOPLE[locale]
  return {
    locale,
    negotiation_id: "neg_sample",
    ref: "NEG-2026-1001",
    status,
    subject: "product",
    customer_name: p.name,
    product_title: c.chair.title,
    sku: c.chair.sku,
    quantity: 12,
    price: Math.round(c.chair.price * 0.86),
    currency_code: p.currency,
    expires_at: status === "counter_offered" ? at(-7 * 24, now) : null,
  }
}
