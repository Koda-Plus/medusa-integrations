/**
 * The public API for your own templates, without any Medusa import, so it
 * is safe in medusa-config.ts:
 *
 *   import { defineEmailTemplate } from "@koda-plus/medusa-plugin-emails/templates"
 *
 *   const companyApproved = defineEmailTemplate({
 *     label: { en: "B2B company approved", pl: "Firma B2B zatwierdzona" },
 *     render: ({ data, locale, kit, links }) => ({ subject: "...", title: "...", blocks: [...] }),
 *   })
 *
 * and then `templates: { "company.approved": companyApproved }` in the
 * options of the plugin and of its provider (the same object).
 */
export { defineEmailTemplate, registerEmailTemplate, unregisterEmailTemplate } from "./modules/emails/lib/registry"
export { renderEmailPreview } from "./modules/emails/lib/preview"
export * as emailKit from "./modules/emails/lib/kit"
export { TEMPLATES } from "./modules/emails/lib/constants"
export type { EmailLocale } from "./modules/emails/lib/constants"
export type { EmailsPluginOptions } from "./modules/emails/lib/options"
export type {
  EmailTemplateDefinition,
  EmailTemplateContext,
  EmailDocument,
  EmailContent,
  EmailFormat,
  EmailLinks,
  EmailBrandInfo,
  EmailItem,
  Money,
  LocalizedText,
  OrderEmailData,
  ShipmentEmailData,
  CanceledEmailData,
  WelcomeEmailData,
  PasswordResetEmailData,
  CartEmailData,
  NegotiationEmailData,
} from "./modules/emails/lib/types"
