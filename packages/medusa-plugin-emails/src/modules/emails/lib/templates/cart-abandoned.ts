import type { EmailDocument } from "../kit"
import type { CartEmailData, EmailTemplateContext, EmailTemplateDefinition } from "../types"
import { COPY } from "./copy"
import { sampleCart } from "./samples"
import { firstName, kitItems, lineCount, money } from "./shared"

/**
 * ABANDONED CART (`cart.abandoned`, from the hourly job, off until turned
 * on): the products of the cart as tiles on the band, the list with the cart
 * value, a note that nothing is reserved, and the way back to the cart.
 */
export function renderCartAbandoned({ data, locale, kit, format, links }: EmailTemplateContext<CartEmailData>): EmailDocument {
  const c = COPY[locale].cartAbandoned
  const common = COPY[locale].common
  const name = firstName(data.customer_name)
  const items = kitItems(data.items, format, data.currency_code)
  const value = money(format, data.cart_total, data.currency_code)
  const what = common.positions(lineCount(data.items))
  const title = c.title(name)
  const cartUrl = data.cart_url ?? links.cart({ id: data.cart_id ?? null, country: data.country_code ?? null })
  return {
    subject: c.subject(name),
    preheader: c.preheader(what),
    chip: c.chip,
    eyebrow: c.eyebrow,
    title: [title.before, kit.accent(title.accent), title.after],
    intro: c.intro(what),
    band: items.length > 0 ? kit.tiles(items, { label: c.value, amount: value }) : null,
    blocks: [
      items.length > 0 ? kit.section(c.inCart, kit.items(items), value ? kit.totals([], [c.value, value]) : null) : null,
      kit.note(c.note),
      kit.actions({ label: c.button, href: cartUrl }, { label: common.goToStore, href: links.store() }),
    ],
  }
}

export const cartAbandonedTemplate: EmailTemplateDefinition<CartEmailData> = {
  label: { en: COPY.en.cartAbandoned.label, pl: COPY.pl.cartAbandoned.label },
  description: { en: COPY.en.cartAbandoned.description, pl: COPY.pl.cartAbandoned.description },
  trigger: { kind: "job", name: "emails-abandoned-carts" },
  enabledByDefault: false,
  sample: (locale) => sampleCart(locale),
  render: renderCartAbandoned,
}
