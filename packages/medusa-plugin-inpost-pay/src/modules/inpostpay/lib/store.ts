import { BASKET_STATUSES, INPOSTPAY_MODULE, MAX_EVENTS, SETTING_KEYS, type BasketStatus, type BindingPlace, type DeliveryType } from "./constants"
import type { BasketDto, BasketEventDto, InpostPaySettings, Placements } from "./contract"
import { fromMinor } from "./confirm"
import { EMPTY_MAPPING, isDeliveryType, normalizeMapping } from "./delivery"

/**
 * The plugin's own rows, read and written from outside the module service
 * (the service stays thin): the settings, the basket rows as DTOs, the
 * event history.
 */

export type Scope = { resolve: (key: string) => unknown }

export function inpostPaySvc(scope: Scope): any {
  return scope.resolve(INPOSTPAY_MODULE)
}

export const DEFAULT_PLACEMENTS: Placements = { product: true, cart: true, minicart: false, checkout: false, thank_you: true }

export function normalizePlacements(v: unknown): Placements {
  const out = { ...DEFAULT_PLACEMENTS }
  if (!v || typeof v !== "object" || Array.isArray(v)) return out
  for (const k of Object.keys(out) as Array<keyof Placements>) {
    const x = (v as Record<string, unknown>)[k]
    if (typeof x === "boolean") out[k] = x
  }
  return out
}

export async function readSettings(scope: Scope): Promise<InpostPaySettings> {
  try {
    const rows = ((await inpostPaySvc(scope).listInpostPaySettings({})) ?? []) as Array<{ key: string; value: unknown }>
    const byKey = new Map(rows.map((r) => [r.key, r.value]))
    return { delivery: normalizeMapping(byKey.get(SETTING_KEYS.delivery)), placements: normalizePlacements(byKey.get(SETTING_KEYS.placements)) }
  } catch {
    return { delivery: { ...EMPTY_MAPPING }, placements: { ...DEFAULT_PLACEMENTS } }
  }
}

export async function writeSetting(scope: Scope, key: string, value: unknown): Promise<void> {
  const svc = inpostPaySvc(scope)
  const rows = (await svc.listInpostPaySettings({ key })) ?? []
  if (Array.isArray(rows) && rows.length > 0) await svc.updateInpostPaySettings({ id: rows[0].id, value })
  else await svc.createInpostPaySettings({ key, value })
}

const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

export function eventsOf(v: unknown): BasketEventDto[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
    .map((e) => ({
      at: typeof e.at === "string" ? e.at : new Date(0).toISOString(),
      kind: typeof e.kind === "string" ? e.kind : "note",
      message: typeof e.message === "string" ? e.message : "",
      ...(e.demo === true ? { demo: true } : {}),
      ...(e.data && typeof e.data === "object" && !Array.isArray(e.data) ? { data: e.data as Record<string, unknown> } : {}),
    }))
}

/** The history with one more event, newest last, at most 50. */
export function withEvent(events: unknown, e: Omit<BasketEventDto, "at"> & { at?: string }): BasketEventDto[] {
  const list = eventsOf(events)
  list.push({ ...e, at: e.at ?? new Date().toISOString() })
  return list.slice(-MAX_EVENTS)
}

export function statusOf(v: unknown): BasketStatus {
  return typeof v === "string" && (BASKET_STATUSES as readonly string[]).includes(v) ? (v as BasketStatus) : "created"
}

export function toBasketDto(row: Record<string, any>, displayId: number | null = null): BasketDto {
  return {
    id: String(row.id),
    cart_id: String(row.cart_id ?? ""),
    status: statusOf(row.status),
    demo: row.demo === true,
    masked_phone: row.masked_phone ?? null,
    order_id: row.order_id ?? null,
    display_id: displayId,
    delivery_type: isDeliveryType(row.delivery_type) ? (row.delivery_type as DeliveryType) : null,
    delivery_point: row.delivery_point ?? null,
    payment_status: row.payment_status ?? null,
    payment_type: row.payment_type ?? null,
    order_status: row.order_status ?? null,
    currency_code: row.currency_code ?? null,
    total: fromMinor(typeof row.amount_minor === "number" ? row.amount_minor : null),
    binding_place: (row.binding_place as BindingPlace | null) ?? null,
    error: row.error ?? null,
    linked_at: iso(row.linked_at),
    ordered_at: iso(row.ordered_at),
    created_at: iso(row.created_at) ?? new Date(0).toISOString(),
    updated_at: iso(row.updated_at) ?? new Date(0).toISOString(),
    events: eventsOf(row.events),
  }
}

/** Payment statuses that need a person: the money did not come. */
export const PAYMENT_PROBLEMS = ["DECLINED", "CANCELLED", "ERROR"] as const

export function paymentProblem(status: unknown): boolean {
  return typeof status === "string" && (PAYMENT_PROBLEMS as readonly string[]).includes(status)
}
