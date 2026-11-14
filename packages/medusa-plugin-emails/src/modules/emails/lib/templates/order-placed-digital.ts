import type { EmailDocument } from "../kit"
import type { EmailTemplateContext, EmailTemplateDefinition, OrderEmailData } from "../types"
import { COPY } from "./copy"
import { sampleOrderDigital, sampleOrderMixed } from "./samples"
import { addressBlock, factNumber, firstName, kitItems, orderNumber, text, totalsBlock } from "./shared"

/**
 * ORDER CONFIRMATIONS WITH DIGITAL PRODUCTS (e-books, PDFs).
 *
 * `order.placed.digital`: only digital lines. Nothing ships, so no parcel
 * road, no delivery and no address: the files with their download links,
 * a line about the attachment and the account, the totals.
 *
 * `order.placed.mixed`: products to ship and digital ones. The parcel road
 * as in `order.placed`, the files first (they are ready now), then what is
 * being packed, the totals and the address.
 *
 * The plugin picks one of the three confirmations by the lines of the order
 * (`requires_shipping`), so each can have its own words in the admin.
 */

function filesBlock(ctx: EmailTemplateContext<OrderEmailData>, label: string) {
  const { data, kit, locale } = ctx
  const d = COPY[locale].downloads
  const list = (data.downloads ?? []).filter((x) => x && text(x.title, 160))
  if (list.length === 0) return null
  return kit.section(
    label,
    kit.steps(list.map((f) => ({ title: text(f.title, 160), body: f.url ? kit.link(f.url, kit.strong(d.download)) : d.inAccount }))),
  )
}

function filesNote(ctx: EmailTemplateContext<OrderEmailData>) {
  const { data, kit, locale } = ctx
  const d = COPY[locale].downloads
  const attached = Math.max(0, Math.round(Number(data.attached ?? 0)))
  return kit.note([attached > 0 ? `${d.attached(attached)} ` : "", d.account(data.has_account === true)])
}

export function renderOrderPlacedDigital(ctx: EmailTemplateContext<OrderEmailData>): EmailDocument {
  const { data, locale, kit, format, links } = ctx
  const c = COPY[locale].orderPlacedDigital
  const common = COPY[locale].common
  const d = COPY[locale].downloads
  const nr = orderNumber(data)
  const name = firstName(data.customer_name)
  const items = kitItems(data.items, format, data.currency_code)
  const title = c.title(name)
  const intro = c.intro(nr)
  const files = (data.downloads ?? []).length || (data.items ?? []).length
  const account = links.account()
  return {
    subject: c.subject(nr),
    preheader: c.preheader(files),
    chip: common.orderChip(nr),
    eyebrow: c.eyebrow,
    title: [title.before, kit.accent(title.accent), title.after],
    intro: intro.nr ? [intro.before, kit.nowrap(intro.nr), intro.after] : intro.before,
    band: kit.tracker([
      { label: c.steps[0], when: format.shortDate(data.order_date, true), state: "done" },
      { label: c.steps[1], state: "current" },
    ]),
    blocks: [
      filesBlock(ctx, c.files),
      filesNote(ctx),
      kit.facts([
        [common.orderNumber, factNumber(nr, locale)],
        [common.date, format.date(data.order_date, true)],
        [common.payment, text(data.payment_method, 120)],
      ]),
      items.length > 0 ? kit.section(c.ordered, kit.items(items), totalsBlock(data, format, locale)) : totalsBlock(data, format, locale),
      kit.actions(account ? { label: d.myFiles, href: account } : null, { label: common.backToStore, href: links.store() }),
    ],
  }
}

export function renderOrderPlacedMixed(ctx: EmailTemplateContext<OrderEmailData>): EmailDocument {
  const { data, locale, kit, format, links } = ctx
  const c = COPY[locale].orderPlacedMixed
  const placed = COPY[locale].orderPlaced
  const common = COPY[locale].common
  const nr = orderNumber(data)
  const name = firstName(data.customer_name)
  const toShip = kitItems((data.items ?? []).filter((i) => !i?.digital), format, data.currency_code)
  const title = c.title(name)
  const intro = c.intro(nr)
  const orderUrl = data.order_url ?? links.order({ id: data.order_id ?? null, displayId: nr, country: data.country_code ?? null })
  const steps = placed.steps
  return {
    subject: c.subject(nr),
    preheader: c.preheader((data.downloads ?? []).length),
    chip: common.orderChip(nr),
    eyebrow: c.eyebrow,
    title: [title.before, kit.accent(title.accent), title.after],
    intro: intro.nr ? [intro.before, kit.nowrap(intro.nr), intro.after] : intro.before,
    band: kit.tracker([
      { label: steps[0], when: format.shortDate(data.order_date, true), state: "done" },
      { label: steps[1], when: placed.inProgress, state: "current" },
      { label: steps[2], state: "todo" },
      { label: steps[3], state: "todo" },
    ]),
    blocks: [
      filesBlock(ctx, c.files),
      filesNote(ctx),
      kit.facts([
        [common.orderNumber, factNumber(nr, locale)],
        [common.date, format.date(data.order_date, true)],
        [common.delivery, text(data.shipping_method, 120)],
        [common.payment, text(data.payment_method, 120)],
      ]),
      toShip.length > 0 ? kit.section(c.toShip, kit.items(toShip), totalsBlock(data, format, locale)) : totalsBlock(data, format, locale),
      kit.section(common.address, addressBlock(data.shipping_address)),
      kit.actions({ label: common.viewOrder, href: orderUrl }, { label: common.backToStore, href: links.store() }),
    ],
  }
}

export const orderPlacedDigitalTemplate: EmailTemplateDefinition<OrderEmailData> = {
  label: { en: COPY.en.orderPlacedDigital.label, pl: COPY.pl.orderPlacedDigital.label },
  description: { en: COPY.en.orderPlacedDigital.description, pl: COPY.pl.orderPlacedDigital.description },
  trigger: { kind: "event", name: "order.placed" },
  enabledByDefault: true,
  sample: (locale) => sampleOrderDigital(locale),
  render: renderOrderPlacedDigital,
}

export const orderPlacedMixedTemplate: EmailTemplateDefinition<OrderEmailData> = {
  label: { en: COPY.en.orderPlacedMixed.label, pl: COPY.pl.orderPlacedMixed.label },
  description: { en: COPY.en.orderPlacedMixed.description, pl: COPY.pl.orderPlacedMixed.description },
  trigger: { kind: "event", name: "order.placed" },
  enabledByDefault: true,
  sample: (locale) => sampleOrderMixed(locale),
  render: renderOrderPlacedMixed,
}
