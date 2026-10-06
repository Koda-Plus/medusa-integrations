import type { EmailDocument } from "../kit"
import type { CanceledEmailData, EmailTemplateContext, EmailTemplateDefinition } from "../types"
import { COPY } from "./copy"
import { sampleCanceled } from "./samples"
import { factNumber, kitItems, money, orderNumber, totalsBlock } from "./shared"

/**
 * ORDER CANCELLED (`order.canceled`): the order as a slip with its status,
 * the cancelled products and amounts, and where the money goes. Medusa's
 * cancel releases uncaptured payments and refunds captured ones.
 */
export function renderOrderCanceled({ data, locale, kit, format, links }: EmailTemplateContext<CanceledEmailData>): EmailDocument {
  const c = COPY[locale]
  const nr = orderNumber(data)
  const title = c.orderCanceled.title(nr)
  const items = kitItems(data.items, format, data.currency_code)
  return {
    subject: c.orderCanceled.subject(nr),
    preheader: c.orderCanceled.preheader,
    chip: c.common.orderChip(nr),
    eyebrow: c.orderCanceled.eyebrow,
    title: title.nr ? [title.before, kit.nowrap(title.nr), title.after] : title.before,
    intro: c.orderCanceled.intro,
    band: kit.slip({
      label: c.orderCanceled.slipLabel,
      number: factNumber(nr, locale) ?? "",
      status: { label: c.orderCanceled.status, tone: "muted" },
      cells: [
        { label: c.orderCanceled.placed, value: format.date(data.order_date) },
        { label: c.orderCanceled.canceled, value: format.date(data.canceled_at) },
        { label: c.orderCanceled.amount, value: money(format, data.total, data.currency_code), big: true },
      ],
    }),
    blocks: [
      items.length > 0 ? kit.section(c.orderCanceled.canceledItems, kit.items(items), totalsBlock(data, format, locale)) : null,
      kit.actions({ label: c.common.goToStore, href: links.store() }, { label: c.common.myAccount, href: links.account() }),
    ],
  }
}

export const orderCanceledTemplate: EmailTemplateDefinition<CanceledEmailData> = {
  label: { en: COPY.en.orderCanceled.label, pl: COPY.pl.orderCanceled.label },
  description: { en: COPY.en.orderCanceled.description, pl: COPY.pl.orderCanceled.description },
  trigger: { kind: "event", name: "order.canceled" },
  enabledByDefault: true,
  sample: (locale) => sampleCanceled(locale),
  render: renderOrderCanceled,
}
