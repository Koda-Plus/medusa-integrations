import type { EmailDocument } from "../kit"
import type { EmailTemplateContext, EmailTemplateDefinition, NegotiationEmailData } from "../types"
import { COPY } from "./copy"
import { sampleNegotiation } from "./samples"
import { money, text } from "./shared"

/**
 * NEGOTIATIONS (`negotiation.countered`, `.accepted`, `.rejected`), for the
 * events of `@koda-plus/medusa-plugin-negotiations` when it is installed.
 * The plugins know each other by event name only. Off until turned on.
 *
 * The offer as a slip (reference, quantity, price, status), the product, a
 * link to the negotiation in the customer account.
 */
type Variant = "countered" | "accepted" | "rejected"

function render(variant: Variant) {
  return ({ data, locale, kit, format, links }: EmailTemplateContext<NegotiationEmailData>): EmailDocument => {
    const c = COPY[locale].negotiation
    const v = c[variant]
    const ref = text(data.ref, 40)
    const cart = data.subject === "cart"
    const quantity = !cart && typeof data.quantity === "number" && Number.isFinite(data.quantity) ? format.number(data.quantity) : null
    const price = money(format, data.price, data.currency_code)
    const priceLabel = cart ? c.priceCart : data.subject === "product" || data.subject === "variant" ? c.pricePerUnit : c.price
    const validUntil = variant === "countered" && data.expires_at ? format.date(data.expires_at) || null : null
    const url = data.negotiation_url ?? links.negotiation({ id: data.negotiation_id ?? null, ref })
    return {
      subject: v.subject(ref),
      preheader: v.preheader,
      chip: c.chip(ref),
      eyebrow: v.eyebrow,
      title: [v.title.before, kit.accent(v.title.accent), v.title.after],
      intro: v.intro,
      band: kit.slip({
        label: c.slipLabel,
        number: ref ?? "",
        status: { label: v.status, tone: variant === "rejected" ? "muted" : "accent" },
        cells: [
          { label: c.quantity, value: quantity },
          { label: priceLabel, value: price, big: true },
        ],
      }),
      blocks: [
        kit.facts([
          [c.product, text(data.product_title, 160)],
          [c.variant, text(data.variant_title, 80)],
          ["SKU", text(data.sku, 60)],
          [c.validUntil, validUntil],
        ]),
        kit.actions({ label: v.button, href: url }),
      ],
    }
  }
}

function definition(variant: Variant, status: "counter_offered" | "accepted" | "rejected"): EmailTemplateDefinition<NegotiationEmailData> {
  return {
    label: { en: COPY.en.negotiation.labels[variant], pl: COPY.pl.negotiation.labels[variant] },
    description: { en: COPY.en.negotiation.descriptions[variant], pl: COPY.pl.negotiation.descriptions[variant] },
    trigger: { kind: "event", name: `negotiation.${variant}` },
    enabledByDefault: false,
    sample: (locale) => sampleNegotiation(locale, status),
    render: render(variant),
  }
}

export const negotiationCounteredTemplate = definition("countered", "counter_offered")
export const negotiationAcceptedTemplate = definition("accepted", "accepted")
export const negotiationRejectedTemplate = definition("rejected", "rejected")
