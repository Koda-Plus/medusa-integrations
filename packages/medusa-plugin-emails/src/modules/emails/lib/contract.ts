/**
 * What the admin routes answer and accept. Types only: the admin page imports
 * them, the routes build them (`dto.ts`). Never a secret: the API key is
 * "set" or "missing", addresses are masked.
 */

import type { EmailLocale } from "./constants"

export type EmailsModeDto = "demo" | "dev" | "live"

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
  /** Enabled providers of the email channel in Medusa's database; null when it could not be read. */
  emailProviders: string[] | null
  /** The provider got the same options as the plugin; null when it is not loaded. */
  sameOptions: boolean | null
  differences: string[]
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
  counts: { sent24h: number; sent30d: number; attention30d: number; tests30d: number; skipped30d: number }
  abandonedCart: { afterHours: number; maxAgeHours: number; maxPerRun: number }
  limits: { testsPerUser: number; testWindowMinutes: number; testsPerHour: number }
  retentionDays: number
  references: ReferenceDto[]
  /** The send log could be read (the migrations ran). */
  logReady: boolean
}

export type MessageStatusDto = "sending" | "sent" | "failed" | "unknown" | "skipped"

export interface MessageDto {
  id: string
  template: string
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
}

export type MessageFilter = "all" | "sent" | "attention" | "skipped" | "test"

export interface MessagesResponse {
  messages: MessageDto[]
  count: number
  limit: number
  offset: number
}

export interface MessageDetailResponse {
  message: MessageDto
  /** The simulated message (demo mode only). */
  html: string | null
  text: string | null
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
