import { companyName, personName } from "../html"
import type { EmailDocument } from "../kit"
import type { EmailTemplateContext, EmailTemplateDefinition, WelcomeEmailData } from "../types"
import { COPY } from "./copy"
import { sampleWelcome } from "./samples"
import { firstName } from "./shared"

/**
 * WELCOME (`customer.welcome`, from `customer.created` for registered
 * accounts only, never for guests): the customer card on the band and three
 * first steps.
 *
 * Anyone can register with any address, and Medusa does not confirm it, so
 * the welcome is the one message a stranger can make the store send to
 * someone else. What they typed shows only when it looks like a name or a
 * company (never a link, an address or a domain), and never in the subject.
 */
export function renderCustomerWelcome({ data, locale, kit, format, links, brand }: EmailTemplateContext<WelcomeEmailData>): EmailDocument {
  const c = COPY[locale].customerWelcome
  const common = COPY[locale].common
  const name = firstName(data.customer_name)
  const company = companyName(data.company_name, 80)
  const fullName = personName(data.customer_name, 80)
  const title = c.title(name)
  return {
    subject: c.subject(null, brand.name),
    preheader: c.preheader,
    chip: c.chip,
    eyebrow: c.eyebrow(brand.name),
    title: [title.before, kit.accent(title.accent), title.after],
    intro: c.intro(brand.name),
    band: kit.card({
      title: company ?? fullName ?? c.holderFallback,
      subtitle: company && fullName ? fullName : null,
      status: { label: c.status, tone: "accent" },
      pairs: [[c.since, format.monthYear(data.customer_since)]],
    }),
    blocks: [
      kit.section(c.startLabel, kit.steps(c.steps)),
      kit.actions({ label: common.goToStore, href: links.store() }, { label: common.myAccount, href: data.account_url ?? links.account() }),
    ],
  }
}

export const customerWelcomeTemplate: EmailTemplateDefinition<WelcomeEmailData> = {
  label: { en: COPY.en.customerWelcome.label, pl: COPY.pl.customerWelcome.label },
  description: { en: COPY.en.customerWelcome.description, pl: COPY.pl.customerWelcome.description },
  trigger: { kind: "event", name: "customer.created" },
  enabledByDefault: true,
  sample: (locale) => sampleWelcome(locale),
  render: renderCustomerWelcome,
}
