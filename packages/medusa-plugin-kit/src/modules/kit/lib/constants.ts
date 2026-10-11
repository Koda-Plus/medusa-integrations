/** The module key in the container: `kit`. */
export const KIT_MODULE = "kit"

/** Every setting key stored in the `kit_setting` table. */
export const SETTING_KEYS = {
  tags: "tags",
  formId: "form_id",
  doubleOptIn: "double_opt_in",
} as const

/** The base URL of the Kit API v4. */
export const KIT_API = "https://api.kit.com"

/** Kit allows 120 requests per rolling 60 seconds per API key; we stay under it. */
export const DEFAULT_REQUESTS_PER_MINUTE = 90
export const DEFAULT_TIMEOUT_MS = 20_000

/** The states of a subscriber the API reports. */
export const SUBSCRIBER_STATES = ["active", "inactive", "cancelled", "bounced", "complained"] as const
