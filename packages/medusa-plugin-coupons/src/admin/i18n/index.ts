import en from "./en"
import pl from "./pl"

/**
 * Admin translations of the plugin, in their own `coupons` namespace so they
 * never collide with the dashboard or other plugins. Components read them
 * with `useTranslation("coupons")`.
 */
export default {
  en: { coupons: en },
  pl: { coupons: pl },
}
