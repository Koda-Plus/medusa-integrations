import { Module } from "@medusajs/framework/utils"
import EmailsModuleService from "./service"
import { EMAILS_MODULE } from "./lib/constants"

/**
 * E-mails module: the send log and the settings of the e-mails plugin. The
 * sending itself is the notification provider in `src/providers/emails`,
 * registered in Medusa's notification module.
 *
 * Also the public API for your own templates:
 *
 *   import { defineEmailTemplate, registerEmailTemplate } from "@koda-plus/medusa-plugin-emails/modules/emails"
 */
export { EMAILS_MODULE }
export { PROVIDER_IDENTIFIER, TEMPLATES } from "./lib/constants"
export type { EmailLocale, BuiltInTemplateKey } from "./lib/constants"
export type { EmailsPluginOptions, EmailsBrandOptions, EmailsLinksOptions } from "./lib/options"
export { defineEmailTemplate, registerEmailTemplate, unregisterEmailTemplate } from "./lib/registry"
export { renderEmailPreview } from "./lib/preview"
export * as emailKit from "./lib/kit"
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
} from "./lib/types"

export default Module(EMAILS_MODULE, {
  service: EmailsModuleService,
})
