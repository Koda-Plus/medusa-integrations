import en from "./en"
import pl from "./pl"

/**
 * Admin translations of the plugin, in their own `credit` namespace so they
 * never collide with the dashboard or other plugins. Medusa 2.12+ merges them
 * into the admin i18n; components read them with `useTranslation("credit")`.
 */
export default {
  en: { credit: en },
  pl: { credit: pl },
}
