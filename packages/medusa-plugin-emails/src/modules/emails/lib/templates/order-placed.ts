import type { EmailDocument } from "../kit"
import type { EmailTemplateContext, EmailTemplateDefinition, OrderEmailData } from "../types"
import { COPY } from "./copy"
import { sampleOrder } from "./samples"
import { addressBlock, factNumber, firstName, kitItems, lineCount, money, orderNumber, text, totalsBlock } from "./shared"

/**
 * ORDER CONFIRMATION (`order.placed`): the order's road on the band, the
 * number, date, delivery and payment, the products with their amounts and
 * the totals, the delivery address, a link to the order.
 */
export function renderOrderPlaced({ data, locale, kit, format, links }: EmailTemplateContext<OrderEmailData>): EmailDocument {
  const c = COPY[locale]
  const nr = orderNumber(data)
  const name = firstName(data.customer_name)
  const items = kitItems(data.items, format, data.currency_code)
  const title = c.orderPlaced.title(name)
  const intro = c.orderPlaced.intro(nr)
  const orderUrl = data.order_url ?? links.order({ id: data.order_id ?? null, displayId: nr, country: data.country_code ?? null })
  const steps = c.orderPlaced.steps
  return {
    subject: c.orderPlaced.subject(nr),
    preheader: c.orderPlaced.preheader(lineCount(data.items), money(format, data.total, data.currency_code)),
    chip: c.common.orderChip(nr),
    eyebrow: c.orderPlaced.eyebrow,
    title: [title.before, kit.accent(title.accent), title.after],
    intro: intro.nr ? [intro.before, kit.nowrap(intro.nr), intro.after] : intro.before,
    band: kit.tracker([
      { label: steps[0], when: format.shortDate(data.order_date, true), state: "done" },
      { label: steps[1], when: c.orderPlaced.inProgress, state: "current" },
      { label: steps[2], state: "todo" },
      { label: steps[3], state: "todo" },
    ]),
    blocks: [
      kit.facts([
        [c.common.orderNumber, factNumber(nr, locale)],
        [c.common.date, format.date(data.order_date, true)],
        [c.common.delivery, text(data.shipping_method, 120)],
        [c.common.payment, text(data.payment_method, 120)],
      ]),
      items.length > 0 ? kit.section(c.orderPlaced.ordered, kit.items(items), totalsBlock(data, format, locale)) : totalsBlock(data, format, locale),
      kit.section(c.common.address, addressBlock(data.shipping_address)),
      kit.actions({ label: c.common.viewOrder, href: orderUrl }, { label: c.common.backToStore, href: links.store() }),
    ],
  }
}

export const orderPlacedTemplate: EmailTemplateDefinition<OrderEmailData> = {
  label: { en: COPY.en.orderPlaced.label, pl: COPY.pl.orderPlaced.label },
  description: { en: COPY.en.orderPlaced.description, pl: COPY.pl.orderPlaced.description },
  trigger: { kind: "event", name: "order.placed" },
  enabledByDefault: true,
  sample: (locale) => sampleOrder(locale),
  render: renderOrderPlaced,
}
