/**
 * What the admin routes answer and accept. Types and two lists of values,
 * zero imports at run time: the admin page imports them, the routes build
 * them (`dto.ts`). Never a secret: the API key is "set" or "missing",
 * addresses are masked.
 */

import type { EmailLocale } from "./constants"

export type EmailsModeDto = "demo" | "dev" | "live" | "app"

export interface LocalizedTextDto {
  en: string | null
  pl: string | null
}

export interface ReferenceDto {
  name: string
  /** https. Null only for a store that starts soon and has no address yet. */
  url: string | null
  /** The store starts on Medusa soon: a "Soon" badge, no link. */
  soon: boolean
  icon: string | null
  description: LocalizedTextDto | null
  metrics: Array<{ label: LocalizedTextDto; value: string }>
  links: Array<{ label: LocalizedTextDto; url: string }>
  review: {
    rating: number
    scale: number
    source: string
    url: string | null
    icon: string | null
    quote: LocalizedTextDto | null
    author: string | null
  } | null
}

export interface TemplateDto {
  key: string
  /** builtin, or added by your options or code (app); a built-in key replaced by your template is "app". */
  source: "builtin" | "app"
  label: LocalizedTextDto | null
  description: LocalizedTextDto | null
  trigger: { kind: "event" | "job" | "manual"; name: string | null }
  /** Off until turned on: abandoned carts, negotiations. */
  optional: boolean
  /** The options allow it (`templates: { key: false }` does not). */
  allowed: boolean
  on: boolean
  enabled: boolean
  updatedBy: string | null
  updatedAt: string | null
  /** Previews can use the store's latest order or cart. */
  latest: boolean
  stats: { sent: number; failed: number; skipped: number; lastAt: string | null }
}

export interface BrandDto {
  name: string | null
  logo: { text: string | null; accent: string | null; suffix: string | null; italic: boolean }
  accentColor: string | null
  headerColor: string | null
  footer: LocalizedTextDto | null
  supportEmail: string | null
}

export interface ProviderDto {
  /** The provider registered itself in this process. */
  loaded: boolean
  loadedAt: string | null
  channels: string[]
  /** The mode of the provider itself (what really happens to a message); null when it is not loaded. */
  mode: EmailsModeDto | null
  /** Enabled providers of the email channel in Medusa's database; null when it could not be read. */
  emailProviders: string[] | null
  /**
   * Enabled providers of the `feed` channel in Medusa's database; null when
   * it could not be read. Empty: product import and export and order export
   * fail, because their notifications have nowhere to go.
   */
  feedProviders: string[] | null
  /** The provider got the same options as the plugin; null when it is not loaded. */
  sameOptions: boolean | null
  differences: string[]
  /**
   * App mode: the store's own provider that sends (`appProvider`), and whether
   * it serves the email channel in Medusa's database (null when that could
   * not be read). Null outside app mode.
   */
  app: { id: string; serving: boolean | null } | null
}

export interface StatusResponse {
  version: string
  mode: EmailsModeDto
  /** demo, or an API key and a valid From. */
  configured: boolean
  missing: string[]
  recommended: string[]
  problems: string[]
  sender: { from: string | null; domain: string | null; replyTo: string[]; apiKeySet: boolean }
  /** The brand in use: options and the admin's overrides. */
  brand: BrandDto
  /** The brand from the options only. */
  brandOptions: BrandDto
  brandOverridden: string[]
  brandUpdatedBy: string | null
  brandUpdatedAt: string | null
  defaultLocale: EmailLocale
  timeZone: string
  storefrontUrl: string | null
  links: Record<string, string | null>
  provider: ProviderDto
  templates: TemplateDto[]
  counts: { sent24h: number; sent30d: number; attention30d: number; tests30d: number; testsSent30d: number; skipped30d: number; refused30d: number }
  /** Demo mode: when the outbox was seeded, and whether the page should ask for a new seed. Null outside demo mode. */
  demo: { seededAt: string | null; stale: boolean } | null
  abandonedCart: { afterHours: number; maxAgeHours: number; maxPerRun: number }
  limits: { testsPerUser: number; testWindowMinutes: number; testsPerHour: number; passwordResetsPerHour: number }
  retentionDays: number
  references: ReferenceDto[]
  /** The send log could be read (the migrations ran). */
  logReady: boolean
  /**
   * App mode: Medusa's own history of the store's provider (its notification
   * table), listed in the log next to the plugin's rows. Null in the other
   * modes or when it cannot be read.
   */
  history?: { total: number; firstAt: string | null } | null
  /** Full addresses in the log, searched by part (option showAddresses). */
  showAddresses?: boolean
  /** Delivery read from Resend (option deliveryKey): suppressed addresses. Null when not configured. */
  delivery?: { suppressed: number; error: string | null; readAt: string | null } | null
  /** Mailings outside the shop (option campaigns): their messages are rows of kind "campaign". */
  campaigns?: Array<{ key: string; label: string }>
  /** Named sets of templates for the log (option templateGroups). */
  templateGroups?: Array<{ key: string; label: string; templates: string[]; variantLabels: Record<string, string> | null; link: { label: string; path: string } | null }>
}

export type MessageStatusDto = "sending" | "sent" | "failed" | "unknown" | "skipped"

export interface MessageDto {
  id: string
  template: string
  /** The name of the template in both languages, so a card needs no status read. */
  label: LocalizedTextDto | null
  locale: string | null
  demo: boolean
  kind: string
  status: MessageStatusDto | string
  /** Masked: a***@e***.com */
  recipient: string | null
  subject: string | null
  trigger: string | null
  resourceType: string | null
  resourceId: string | null
  orderId: string | null
  customerId: string | null
  externalId: string | null
  attempts: number
  rotation: number
  errorCode: string | null
  error: string | null
  retryable: boolean
  /** A person may retry it from the admin (a built-in event template with its resource). */
  canRetry: boolean
  sentAt: string | null
  createdAt: string
  requestedBy: string | null
  hasBody: boolean
  /** The stage of the message in its template group (option templateGroups variant), e.g. "overdue". */
  variant?: string | null
  /** App mode: "medusa" for a message read from Medusa's history, "plugin" for the plugin's own row. */
  source?: "plugin" | "medusa"
  /** What happened after the provider took it (Resend last_event), when the plugin can read it (option deliveryKey). */
  delivery?: string | null
}

/** GET /admin/emails/delivery: the addresses Resend no longer sends to, each with its last message here. */
export interface BouncesResponse {
  configured: boolean
  readAt: string | null
  error: string | null
  addresses: Array<{
    email: string
    origin: string
    since: string | null
    /** The address with a known domain typo corrected (gmial.com -> gmail.com), else null. */
    typo: string | null
    /** The subject of the message that caused the block (this store's, else read from Resend). */
    subject: string | null
    /** The mailing outside the shop that caused it (option campaigns), matched by its Resend tag. */
    campaign: { key: string; label: string } | null
    sourceId: string | null
    resendUrl: string | null
    lastMessage: MessageDto | null
  }>
}

/** `bounced`: refused for the recipient's address (`INVALID_RECIPIENT`), and with option deliveryKey also bounced or suppressed in Resend. */
export type MessageFilter = "all" | "sent" | "attention" | "skipped" | "test" | "bounced"

export const MESSAGE_FILTERS: readonly MessageFilter[] = ["all", "sent", "attention", "skipped", "test", "bounced"]

/** The time windows of the list (`since`): the board counters count the last 7 days. */
export type MessageWindow = "24h" | "7d" | "30d"

export const MESSAGE_WINDOWS: readonly MessageWindow[] = ["24h", "7d", "30d"]

export interface MessagesResponse {
  messages: MessageDto[]
  count: number
  limit: number
  offset: number
}

export interface MessageDetailResponse {
  message: MessageDto
  /** The simulated message (demo mode only), with secret fields hidden. */
  html: string | null
  text: string | null
}

export interface SeedResponse {
  /** Rows of the demo outbox written or refreshed; 0 when the seed was fresh. */
  written: number
  status: StatusResponse
}

export type PreviewSource = "sample" | "latest"

export interface PreviewResponse {
  template: string
  locale: EmailLocale
  theme: "light" | "dark" | null
  /** What the data came from: the sample, or the store's latest order or cart. */
  source: PreviewSource
  /** "#1042" or a cart id, when the store's data was used. */
  sourceRef: string | null
  subject: string
  preheader: string
  html: string
  text: string
  bytes: number
}

export interface TestRequest {
  template: string
  to: string
  locale?: EmailLocale
  source?: PreviewSource
}

export interface TestResponse {
  outcome: "sent" | "simulated" | "logged"
  id: string | null
  to: string
  template: string
}

export interface SettingsRequest {
  /** Overrides of the branding; a field set to null or "" goes back to the option; `null` resets all. */
  brand?: Record<string, unknown> | null
  /** Template switches. */
  templates?: Record<string, boolean>
}

export interface RetryResponse {
  outcome: string
  message: MessageDto | null
}
