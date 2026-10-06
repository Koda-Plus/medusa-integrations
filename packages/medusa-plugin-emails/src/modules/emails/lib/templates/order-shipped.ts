import { safeUrl } from "../html"
import type { EmailDocument } from "../kit"
import type { EmailTemplateContext, EmailTemplateDefinition, ShipmentEmailData } from "../types"
import { COPY } from "./copy"
import { sampleShipment } from "./samples"
import { addressBlock, kitItems, orderNumber, text } from "./shared"

/**
 * ORDER SHIPPED (`order.shipped`, from Medusa's `shipment.created`): the
 * tracking numbers with their links, the products of this parcel, the
 * delivery address. A partial shipment says the rest follows.
 */
export function renderOrderShipped({ data, locale, kit, format, links }: EmailTemplateContext<ShipmentEmailData>): EmailDocument {
  const c = COPY[locale]
  const nr = orderNumber(data)
  const partial = data.partial === true
  const tracking = (Array.isArray(data.tracking) ? data.tracking : [])
    .map((t) => ({ number: text(t?.number, 80) ?? "", url: safeUrl(t?.url) ?? null, carrier: text(t?.carrier, 60) }))
    .filter((t) => t.number)
    .slice(0, 10)
  const shipped = kitItems(Array.isArray(data.shipped_items) && data.shipped_items.length > 0 ? data.shipped_items : data.items, format, data.currency_code)
  const title = c.orderShipped.title(partial)
  const steps = COPY[locale].orderPlaced.steps
  const orderUrl = data.order_url ?? links.order({ id: data.order_id ?? null, displayId: nr, country: data.country_code ?? null })
  return {
    subject: c.orderShipped.subject(nr, partial),
    preheader: c.orderShipped.preheader(tracking[0]?.number ?? null),
    chip: c.common.orderChip(nr),
    eyebrow: c.orderShipped.eyebrow(partial),
    title: [title.before, kit.accent(title.accent), title.after],
    intro: c.orderShipped.intro(partial, tracking.length > 0),
    band: kit.tracker([
      { label: steps[0], when: format.shortDate(data.order_date), state: "done" },
      { label: steps[1], when: "✓", state: "done" },
      { label: steps[2], when: format.shortDate(data.shipped_at, true) || c.orderShipped.onTheWay, state: "current" },
      { label: steps[3], state: "todo" },
    ]),
    blocks: [
      tracking.length > 0 ? kit.section(c.orderShipped.tracking, kit.tracking(tracking)) : null,
      shipped.length > 0 ? kit.section(partial ? c.orderShipped.inParcel : c.orderShipped.shipped, kit.items(shipped.map((i) => ({ ...i, unitPrice: null, total: null })))) : null,
      kit.section(c.common.address, addressBlock(data.shipping_address)),
      kit.actions({ label: c.common.viewOrder, href: orderUrl }, { label: c.common.backToStore, href: links.store() }),
    ],
  }
}

export const orderShippedTemplate: EmailTemplateDefinition<ShipmentEmailData> = {
  label: { en: COPY.en.orderShipped.label, pl: COPY.pl.orderShipped.label },
  description: { en: COPY.en.orderShipped.description, pl: COPY.pl.orderShipped.description },
  trigger: { kind: "event", name: "shipment.created" },
  enabledByDefault: true,
  sample: (locale) => sampleShipment(locale),
  render: renderOrderShipped,
}
