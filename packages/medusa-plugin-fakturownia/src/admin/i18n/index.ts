import en from "./en"
import pl from "./pl"

/**
 * Admin translations of the plugin, in their own `fakturownia` namespace so
 * they never collide with the dashboard or other plugins. Medusa 2.12+ merges
 * them into the admin i18n; components read them with
 * `useTranslation("fakturownia")`.
 */
export default {
  en: { fakturownia: en },
  pl: { fakturownia: pl },
}
