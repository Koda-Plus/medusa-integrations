import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import InpostPayPaymentProvider from "./service"

/**
 * The payment provider of InPost Pay by Koda Plus, for Medusa's payment
 * module, with the same options object as the plugin:
 *
 *   { resolve: "@koda-plus/medusa-plugin-inpost-pay/providers/inpostpay", id: "inpost-pay", options: inpostPay }
 *
 * The provider id is then `pp_inpost-pay_inpost-pay`; enable it in the
 * regions that sell with InPost Pay (PLN).
 */
export default ModuleProvider(Modules.PAYMENT, {
  services: [InpostPayPaymentProvider],
})
