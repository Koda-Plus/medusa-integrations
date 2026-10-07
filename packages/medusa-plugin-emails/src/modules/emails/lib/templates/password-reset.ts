import { DEFAULT_RESET_MINUTES } from "../constants"
import { cleanText, safeUrl } from "../html"
import type { EmailDocument } from "../kit"
import { toNumber } from "../locale"
import type { EmailTemplateContext, EmailTemplateDefinition, PasswordResetEmailData } from "../types"
import { COPY } from "./copy"
import { samplePasswordReset } from "./samples"

/**
 * PASSWORD RESET (`password.reset`, from Medusa's `auth.password_reset`):
 * one button to the reset page with the token, how long it works, what to do
 * if it was not you, and the address in plain text for when the button does
 * not work. The same message for customers (the storefront page) and admin
 * users (the admin page).
 */
export function renderPasswordReset({ data, locale, kit, brand }: EmailTemplateContext<PasswordResetEmailData>): EmailDocument {
  const c = COPY[locale].passwordReset
  const minutes = Math.max(1, Math.round(toNumber(data.expires_minutes) ?? DEFAULT_RESET_MINUTES))
  const span = c.minutes(minutes)
  const intro = c.intro(span)
  const email = cleanText(data.email, 254)
  const url = safeUrl(data.reset_url)
  return {
    subject: c.subject(brand.name, data.actor === "user"),
    preheader: c.preheader(span),
    chip: c.chip,
    eyebrow: c.eyebrow,
    title: [c.title.before, kit.accent(c.title.accent), c.title.after],
    intro: [intro.before, kit.nowrap(email), intro.after],
    blocks: [kit.actions({ label: c.button, href: url }), kit.note(c.notYou, "amber"), kit.linkFallback(url)],
  }
}

export const passwordResetTemplate: EmailTemplateDefinition<PasswordResetEmailData> = {
  label: { en: COPY.en.passwordReset.label, pl: COPY.pl.passwordReset.label },
  description: { en: COPY.en.passwordReset.description, pl: COPY.pl.passwordReset.description },
  trigger: { kind: "event", name: "auth.password_reset" },
  enabledByDefault: true,
  /* The link holds the reset token: never in Medusa's notification data, hidden in the demo outbox. */
  sensitive: ["reset_url"],
  sample: (locale) => samplePasswordReset(locale),
  render: renderPasswordReset,
}
