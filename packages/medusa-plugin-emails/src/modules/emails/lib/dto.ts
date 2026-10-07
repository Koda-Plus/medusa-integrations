/**
 * Rows as the admin sees them. Zero Medusa imports.
 */

import type { BrandDto, LocalizedTextDto, MessageDto } from "./contract"
import type { ResolvedBrand } from "./options"
import { isBuiltInKey, listTemplates } from "./registry"
import type { MessageRow } from "./store"
import type { EmailTemplateDefinition, LocalizedText } from "./types"

/** A template's name or description as the admin takes it. */
export function localized(v: LocalizedText | undefined): LocalizedTextDto | null {
  if (v === undefined) return null
  return typeof v === "string" ? { en: v, pl: v } : { en: v.en ?? null, pl: v.pl ?? null }
}

/** The names of every template the options know, by key, for the rows of the log. */
export function templateLabels(o: { definitions: Record<string, EmailTemplateDefinition<any>> }): Record<string, LocalizedTextDto> {
  const out: Record<string, LocalizedTextDto> = {}
  for (const t of listTemplates(o)) {
    const label = localized(t.def.label)
    if (label) out[t.key] = label
  }
  return out
}

export function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/** Built-in templates that a person can retry: their data can be rebuilt from the resource. */
const RETRYABLE: Record<string, string> = {
  "order.placed": "order",
  "order.canceled": "order",
  "order.shipped": "fulfillment",
  "customer.welcome": "customer",
  "cart.abandoned": "cart",
}

export function canRetry(row: Pick<MessageRow, "template" | "status" | "resource_type" | "resource_id" | "kind">): boolean {
  if (!["failed", "unknown", "skipped"].includes(String(row.status))) return false
  if (row.kind === "test") return false
  const type = RETRYABLE[row.template]
  return Boolean(type && isBuiltInKey(row.template) && row.resource_type === type && row.resource_id)
}

export function toMessageDto(row: MessageRow, names: Record<string, string> = {}, labels: Record<string, LocalizedTextDto> = {}): MessageDto {
  return {
    id: row.id,
    template: row.template,
    label: labels[row.template] ?? null,
    locale: row.locale ?? null,
    demo: Boolean(row.demo),
    kind: String(row.kind ?? "event"),
    status: String(row.status),
    recipient: row.recipient ?? null,
    subject: row.subject ?? null,
    trigger: row.trigger ?? null,
    resourceType: row.resource_type ?? null,
    resourceId: row.resource_id ?? null,
    orderId: row.order_id ?? null,
    customerId: row.customer_id ?? null,
    externalId: row.external_id ?? null,
    attempts: Number(row.attempts ?? 0),
    rotation: Number(row.rotation ?? 0),
    errorCode: row.error_code ?? null,
    error: row.error ?? null,
    retryable: Boolean(row.retryable),
    canRetry: canRetry(row),
    sentAt: iso(row.sent_at),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    requestedBy: row.requested_by ? names[row.requested_by] ?? row.requested_by : null,
    hasBody: Boolean(row.body_html),
  }
}

export function toBrandDto(b: ResolvedBrand): BrandDto {
  return {
    name: b.name,
    logo: { ...b.logo },
    accentColor: b.accentColor,
    headerColor: b.headerColor,
    footer: b.footer ? { en: b.footer.en, pl: b.footer.pl } : null,
    supportEmail: b.supportEmail,
  }
}
