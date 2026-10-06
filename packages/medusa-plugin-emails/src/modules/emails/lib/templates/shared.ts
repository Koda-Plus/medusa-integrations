/**
 * Helpers shared by the built-in templates: names, order numbers, product
 * lines with their amounts, the totals block and addresses.
 */

import type { EmailLocale } from "../constants"
import { cleanText } from "../html"
import * as kit from "../kit"
import { toNumber } from "../locale"
import type { EmailFormat, EmailItem, Money, OrderEmailData } from "../types"
import { COPY } from "./copy"

/** The first word of a name, for "Anna, thank you": at most 40 characters, or null. */
export function firstName(value: unknown): string | null {
  const s = cleanText(value, 80)
  if (!s) return null
  const first = s.split(" ")[0]
  return first.length > 40 ? first.slice(0, 40) : first
}

export function text(value: unknown, max = 200): string | null {
  const s = cleanText(value, max)
  return s || null
}

/** The order number the customer knows: a custom one, or the display id. */
export function orderNumber(data: Pick<OrderEmailData, "order_number">): string | null {
  const v = data.order_number
  if (v === null || v === undefined) return null
  const s = cleanText(v, 40)
  return s || null
}

/** The number as a fact value: #1042 in English, 1042 in Polish, a custom number as it is. */
export function factNumber(nr: string | null, locale: EmailLocale): string | null {
  if (!nr) return null
  return locale === "en" && /^\d+$/.test(nr) ? `#${nr}` : nr
}

export function money(format: EmailFormat, value: Money | null | undefined, currency: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null
  const s = format.money(value, currency ?? null)
  return s || null
}

/** Whether an amount is above zero (for the tax and discount notes). */
export function positive(value: Money | null | undefined): boolean {
  const n = toNumber(value)
  return n !== null && n > 0.004
}

/** Product lines of the data as kit items, with the amounts formatted. The line value is unit price times quantity when missing. */
export function kitItems(list: readonly EmailItem[] | null | undefined, format: EmailFormat, currency: string | null | undefined): kit.KitItem[] {
  if (!Array.isArray(list)) return []
  const out: kit.KitItem[] = []
  for (const it of list) {
    if (!it || typeof it !== "object") continue
    const title = cleanText(it.title, 160)
    if (!title) continue
    const quantity = toNumber(it.quantity) ?? 1
    const unit = toNumber(it.unit_price)
    const total = it.total !== null && it.total !== undefined && it.total !== "" ? it.total : unit !== null ? Math.round(unit * quantity * 100) / 100 : null
    const variant = cleanText(it.variant, 80)
    out.push({
      title,
      variant: variant && variant.toLowerCase() !== title.toLowerCase() ? variant : null,
      sku: cleanText(it.sku, 60) || null,
      quantity: format.number(quantity) || String(quantity),
      unitPrice: quantity !== 1 ? money(format, it.unit_price ?? null, currency) : null,
      total: money(format, total, currency),
    })
  }
  return out
}

/** How many lines an order has, for "3 items". */
export function lineCount(list: readonly EmailItem[] | null | undefined): number {
  return Array.isArray(list) ? list.filter((i) => i && cleanText(i.title, 10)).length : 0
}

/** Items, delivery and the total, with the tax and the discount as notes under the total. */
export function totalsBlock(data: OrderEmailData, format: EmailFormat, locale: EmailLocale): kit.Block {
  const c = COPY[locale].common
  const cur = data.currency_code
  const notes: kit.Inline[] = []
  if (positive(data.tax_total)) notes.push(c.taxNote(money(format, data.tax_total, cur) ?? ""))
  if (positive(data.discount_total)) notes.push(c.discountNote(money(format, data.discount_total, cur) ?? ""))
  return kit.totals(
    [
      [c.products, money(format, data.items_total, cur)],
      [c.delivery, money(format, data.shipping_total, cur)],
    ],
    [c.total, money(format, data.total, cur)],
    notes,
  )
}

/** Address lines as one paragraph, a line break between lines. */
export function addressBlock(lines: readonly unknown[] | null | undefined): kit.Block | null {
  const clean = (Array.isArray(lines) ? lines : []).map((l) => cleanText(l, 120)).filter(Boolean)
  if (clean.length === 0) return null
  const parts: kit.Inline[] = []
  clean.forEach((l, i) => {
    if (i) parts.push(kit.br)
    parts.push(l)
  })
  return kit.paragraph(parts, { tone: "ink" })
}
