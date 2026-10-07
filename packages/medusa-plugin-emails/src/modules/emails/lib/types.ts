/**
 * PUBLIC TYPES of the templates: what a template receives and returns, and
 * the data of the built-in templates. Type-only imports, so the file costs
 * nothing at run time.
 */

import type { EmailLocale } from "./constants"
import type * as Kit from "./kit"
import type { EmailDocument } from "./kit"

export type { EmailLocale }
export type { EmailDocument }

/** A text in both languages, or one text for both. */
export type LocalizedText = string | { en?: string; pl?: string }

/** An amount: a number in major units (as Medusa returns it, formatted with the currency) or a ready string. */
export type Money = number | string

/** A message given as finished HTML (your own markup). The text part is made from the HTML when missing. */
export interface EmailContent {
  subject: string
  html: string
  text?: string
  preheader?: string
}

/** The kit as a template sees it: the blocks and the inline helpers of `kit.ts`. */
export type EmailKit = typeof Kit

/** Formatting in the language of the message and the store's time zone. */
export interface EmailFormat {
  /** 1234.5 with "pln" as "1 234,50 zł" (Polish) or "PLN 1,234.50" (English). A string is returned as it is. */
  money(value: Money | null | undefined, currency?: string | null): string
  /** "6 października 2026" / "6 October 2026"; `withTime` adds ", 14:32". */
  date(value: unknown, withTime?: boolean): string
  /** "6 paź" / "6 Oct", for narrow places; `withTime` adds ", 14:32". */
  shortDate(value: unknown, withTime?: boolean): string
  number(value: unknown): string
  /** Polish has three forms (1 pozycja, 2 pozycje, 5 pozycji), English two. */
  plural(n: number, forms: { one: string; few: string; many: string }): string
  /** 10/2026 */
  monthYear(value: unknown): string
}

/** Links of the store, from the `storefrontUrl` and `links` options. Null when not configured. */
export interface EmailLinks {
  store(): string | null
  account(): string | null
  order(input: { id?: string | null; displayId?: string | number | null; country?: string | null }): string | null
  cart(input: { id?: string | null; country?: string | null }): string | null
  negotiation(input: { id?: string | null; ref?: string | null }): string | null
}

/** What the store looks like in the message, read only. */
export interface EmailBrandInfo {
  /** Null when no store name is set: write sentences that work without it. */
  name: string | null
  storeUrl: string | null
  supportEmail: string | null
}

export interface EmailTemplateContext<D> {
  data: D
  locale: EmailLocale
  kit: EmailKit
  format: EmailFormat
  links: EmailLinks
  brand: EmailBrandInfo
}

export interface EmailTemplateDefinition<D = Record<string, unknown>> {
  /** The name in the admin. */
  label?: LocalizedText
  /** When it is sent, in the admin: "A company account is approved". */
  description?: LocalizedText
  /** What sends it, shown in the admin. */
  trigger?: { kind: "event" | "job" | "manual"; name?: string }
  /** Default true. False: off until a person turns it on in the admin (or `templates: { key: true }`). */
  enabledByDefault?: boolean
  /** Data for the admin preview and test sends, one set for both languages or per language. */
  sample?: D | ((locale: EmailLocale) => D)
  /**
   * Fields of the data that carry a secret, such as a link with a token
   * (`["reset_url"]` for the built-in password reset). Such a message never
   * passes through Medusa's notification table (the plugin hands it straight
   * to its provider), and the simulated outbox of demo mode keeps it with
   * these fields hidden.
   */
  sensitive?: readonly string[]
  /**
   * Renders the message. Keep it pure (the same input, the same output): a
   * retry must produce the same message, or Resend refuses the idempotency key.
   * Return a document built with the kit (recommended: the look, dark mode and
   * the text part come with it) or finished HTML.
   */
  render(ctx: EmailTemplateContext<D>): EmailDocument | EmailContent
}

/* ------------------------------------------------------------------ */
/* Data of the built-in templates                                      */
/* ------------------------------------------------------------------ */

/** A product line as the templates take it. */
export interface EmailItem {
  title: string
  /** Shown after the title when it says more than the title: "Black, XL". */
  variant?: string | null
  sku?: string | null
  quantity: number
  unit_price?: Money | null
  /** The line value; unit_price times quantity when missing. */
  total?: Money | null
}

interface WithLocale {
  /** A BCP 47 tag or a language ("pl-PL", "en"); the `defaultLocale` option when missing. */
  locale?: string | null
}

export interface OrderEmailData extends WithLocale {
  order_id?: string | null
  /** What the customer sees: the display id (1042) or a custom one. */
  order_number?: string | number | null
  /** ISO date. */
  order_date?: string | null
  currency_code?: string | null
  customer_name?: string | null
  company_name?: string | null
  items?: EmailItem[]
  /** Items after discounts, with taxes as the store shows them. */
  items_total?: Money | null
  shipping_total?: Money | null
  discount_total?: Money | null
  tax_total?: Money | null
  total?: Money | null
  shipping_method?: string | null
  payment_method?: string | null
  shipping_address?: string[] | null
  /** Lower-case country code of the shipping address, for links with {country}. */
  country_code?: string | null
  order_url?: string | null
}

export interface ShipmentEmailData extends OrderEmailData {
  shipped_at?: string | null
  /** Some products follow in another parcel. */
  partial?: boolean
  tracking?: Array<{ number: string; url?: string | null; carrier?: string | null }>
  /** The products in this parcel; the whole order when missing. */
  shipped_items?: EmailItem[]
}

export interface CanceledEmailData extends OrderEmailData {
  canceled_at?: string | null
}

export interface WelcomeEmailData extends WithLocale {
  customer_name?: string | null
  company_name?: string | null
  /** ISO date the account was created. */
  customer_since?: string | null
  account_url?: string | null
}

export interface PasswordResetEmailData extends WithLocale {
  /** The address the reset was asked for. */
  email: string
  reset_url: string
  /** "customer" (the storefront account) or "user" (the admin). */
  actor?: "customer" | "user" | null
  customer_name?: string | null
  expires_minutes?: number | null
}

export interface CartEmailData extends WithLocale {
  cart_id?: string | null
  currency_code?: string | null
  customer_name?: string | null
  items?: EmailItem[]
  cart_total?: Money | null
  country_code?: string | null
  cart_url?: string | null
}

export interface NegotiationEmailData extends WithLocale {
  negotiation_id?: string | null
  ref?: string | null
  status?: string | null
  /** "cart" when the price is for the whole cart; "product" or "variant" (or nothing) for a price per unit. */
  subject?: "product" | "variant" | "cart" | null
  customer_name?: string | null
  product_title?: string | null
  variant_title?: string | null
  sku?: string | null
  quantity?: number | null
  /** The price on the table, in major units (469 for 469.00). */
  price?: Money | null
  currency_code?: string | null
  /** When the offer lapses if nobody answers (ISO 8601). */
  expires_at?: string | null
  negotiation_url?: string | null
}
