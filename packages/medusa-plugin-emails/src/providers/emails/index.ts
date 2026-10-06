import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import EmailsNotificationProvider from "./service"

/**
 * The notification provider of E-mails by Koda Plus, for Medusa's
 * notification module:
 *
 *   resolve: "@koda-plus/medusa-plugin-emails/providers/emails"
 */
export default ModuleProvider(Modules.NOTIFICATION, {
  services: [EmailsNotificationProvider],
})
