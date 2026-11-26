import en from "./en"
import pl from "./pl"

/**
 * Admin translations of the plugin, in their own `avatars` namespace so
 * they never collide with the dashboard or other plugins. Medusa 2.12+ merges
 * them into the admin i18n; components read them with
 * `useTranslation("avatars")`.
 */
export default {
  en: { avatars: en },
  pl: { avatars: pl },
}
