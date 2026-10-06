/**
 * WHAT A NEW THREAD IS ABOUT, CHECKED AGAINST THE STORE.
 *
 * A customer may negotiate only what the store sells to them: a published
 * product, in a sales channel of the publishable key of the request (when
 * the request carries one), or their own cart that is not completed. A
 * product, variant or cart that does not exist, is not published, is not in
 * the channel, or belongs to someone else answers the same 404, so the API
 * tells nothing about what it does not show.
 */

import { pickListPrice, cartSnapshot, threadTitle, type CartItemRecord, type PriceRecord } from "../../modules/negotiations/lib/catalog"
import type { Subject } from "../../modules/negotiations/lib/constants"
import { normalizeCurrency } from "../../modules/negotiations/lib/money"
import type { CartLine } from "../../modules/negotiations/lib/rows"
import { ActionError, graph, type Scope } from "./runtime"

export interface ResolvedSubject {
  subject: Subject
  productId: string | null
  variantId: string | null
  cartId: string | null
  sku: string | null
  title: string | null
  /** The cart's currency, for a cart thread. */
  cartCurrency: string | null
  /** The list price in a currency (unit price, or the cart's value), minor units. */
  listFor(currency: string, digits: number): number | null
  /** The cart's lines in the cart's currency. */
  itemsFor(digits: number): CartLine[] | null
}

interface VariantRecord {
  id: string
  sku?: string | null
  title?: string | null
  product_id?: string | null
  product?: { id?: string; title?: string | null; status?: string | null; sales_channels?: Array<{ id?: string } | null> | null } | null
  prices?: PriceRecord[] | null
}

interface ProductRecord {
  id: string
  title?: string | null
  status?: string | null
  sales_channels?: Array<{ id?: string } | null> | null
  variants?: Array<VariantRecord | null> | null
}

interface CartRecord {
  id: string
  customer_id?: string | null
  currency_code?: string | null
  completed_at?: string | Date | null
  items?: Array<CartItemRecord | null> | null
}

const PRICE_FIELDS = ["amount", "currency_code", "min_quantity", "max_quantity", "price_list_id", "rules_count"]

const notFound = (what: string) => new ActionError(404, `${what}_not_found`, `The ${what} was not found.`)

/** Published and, when the request names sales channels, in one of them. Unknown channel data does not block. */
function sellable(product: { status?: string | null; sales_channels?: Array<{ id?: string } | null> | null } | null | undefined, channels: readonly string[]): boolean {
  if (!product) return false
  if (product.status && product.status !== "published") return false
  if (channels.length > 0 && Array.isArray(product.sales_channels)) {
    const ids = product.sales_channels.map((c) => c?.id).filter(Boolean)
    if (!ids.some((id) => channels.includes(id as string))) return false
  }
  return true
}

async function variantById(scope: Scope, id: string): Promise<VariantRecord | null> {
  const full = await graph<VariantRecord>(scope, {
    entity: "product_variant",
    fields: [
      "id",
      "sku",
      "title",
      "product_id",
      "product.id",
      "product.title",
      "product.status",
      "product.sales_channels.id",
      ...PRICE_FIELDS.map((f) => `prices.${f}`),
    ],
    filters: { id },
  })
  if (full[0]) return full[0]
  /* An older Medusa may not know a price field: the essentials. */
  const basic = await graph<VariantRecord>(scope, {
    entity: "product_variant",
    fields: ["id", "sku", "title", "product_id", "product.id", "product.title", "product.status", "prices.amount", "prices.currency_code"],
    filters: { id },
  })
  return basic[0] ?? null
}

async function productById(scope: Scope, id: string): Promise<ProductRecord | null> {
  const full = await graph<ProductRecord>(scope, {
    entity: "product",
    fields: ["id", "title", "status", "sales_channels.id", "variants.id", "variants.sku", "variants.title", ...PRICE_FIELDS.map((f) => `variants.prices.${f}`)],
    filters: { id },
  })
  if (full[0]) return full[0]
  const basic = await graph<ProductRecord>(scope, {
    entity: "product",
    fields: ["id", "title", "status", "variants.id", "variants.sku", "variants.title", "variants.prices.amount", "variants.prices.currency_code"],
    filters: { id },
  })
  return basic[0] ?? null
}

async function cartById(scope: Scope, id: string): Promise<CartRecord | null> {
  const rows = await graph<CartRecord>(scope, {
    entity: "cart",
    fields: [
      "id",
      "customer_id",
      "currency_code",
      "completed_at",
      "items.id",
      "items.variant_id",
      "items.product_id",
      "items.variant_sku",
      "items.title",
      "items.product_title",
      "items.variant_title",
      "items.quantity",
      "items.unit_price",
    ],
    filters: { id },
  })
  return rows[0] ?? null
}

export async function resolveSubject(
  scope: Scope,
  args: { productId: string | null; variantId: string | null; cartId: string | null; customerId: string; qty: number; salesChannelIds: readonly string[] },
): Promise<ResolvedSubject> {
  if (args.cartId) {
    const cart = await cartById(scope, args.cartId)
    if (!cart || cart.customer_id !== args.customerId) throw notFound("cart")
    if (cart.completed_at) throw new ActionError(409, "cart_completed", "The cart is already an order.")
    const currency = normalizeCurrency(cart.currency_code)
    if (!currency) throw notFound("cart")
    const items = cart.items ?? []
    if (!items.some((i) => i && Number(i.quantity) > 0)) throw new ActionError(409, "cart_empty", "The cart is empty.")
    return {
      subject: "cart",
      productId: null,
      variantId: null,
      cartId: cart.id,
      sku: null,
      title: null,
      cartCurrency: currency,
      listFor: (_currency, digits) => cartSnapshot(items, digits).total,
      itemsFor: (digits) => cartSnapshot(items, digits).lines,
    }
  }

  if (args.variantId) {
    const variant = await variantById(scope, args.variantId)
    const productId = variant?.product?.id ?? variant?.product_id ?? null
    if (!variant || !productId || !sellable(variant.product, args.salesChannelIds)) throw notFound("variant")
    if (args.productId && args.productId !== productId) throw new ActionError(400, "variant_mismatch", "The variant is not a variant of that product.")
    return {
      subject: "variant",
      productId,
      variantId: variant.id,
      cartId: null,
      sku: variant.sku ?? null,
      title: threadTitle(variant.product?.title, variant.title),
      cartCurrency: null,
      listFor: (currency, digits) => pickListPrice(variant.prices, currency, args.qty, digits),
      itemsFor: () => null,
    }
  }

  const product = args.productId ? await productById(scope, args.productId) : null
  if (!product || !sellable(product, args.salesChannelIds)) throw notFound("product")
  const variants = (product.variants ?? []).filter((v): v is VariantRecord => Boolean(v?.id))
  if (variants.length === 1) {
    /* One variant: the thread is about it, and the draft order writer can use it. */
    const only = variants[0]
    return {
      subject: "variant",
      productId: product.id,
      variantId: only.id,
      cartId: null,
      sku: only.sku ?? null,
      title: threadTitle(product.title, only.title),
      cartCurrency: null,
      listFor: (currency, digits) => pickListPrice(only.prices, currency, args.qty, digits),
      itemsFor: () => null,
    }
  }
  return {
    subject: "product",
    productId: product.id,
    variantId: null,
    cartId: null,
    sku: null,
    title: product.title ?? null,
    cartCurrency: null,
    /* Several variants and none chosen: no single list price. */
    listFor: () => null,
    itemsFor: () => null,
  }
}
