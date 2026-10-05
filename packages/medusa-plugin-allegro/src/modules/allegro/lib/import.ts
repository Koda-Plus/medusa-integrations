/**
 * ALLEGRO ORDERS INTO MEDUSA ORDERS. Pure decisions and the exactly-once
 * state machine; the Medusa and Allegro calls come in through ports, so the
 * whole flow runs in unit tests against fakes. Imports: the zero-import
 * helpers next to it only.
 *
 * EXACTLY ONCE PER CHECKOUT FORM:
 *   1. one row per form id (`allegro_order_import`, unique), written before
 *      anything else happens;
 *   2. an atomic claim with a lease: one process imports, the others walk
 *      away;
 *   3. a lookup in Medusa before every create: an order carrying
 *      `metadata.marketplace_order_ref = "allegro:<id>"` is adopted when we
 *      created it, and makes us step back when another integration did
 *      (BaseLinker writes the same key);
 *   4. the lookup is made AGAIN inside the lock `marketplace-order-ref:<ref>`
 *      of the Medusa Locking module, the key the BaseLinker plugin takes too:
 *      whoever comes second sees the order the first one created;
 *   5. the order is created as a draft and its id is written on the row at
 *      once; placing it (reservations, `order.placed`) and the payment come
 *      after, each step checked before it runs, so a retry finishes a draft
 *      an earlier attempt left and never repeats a finished step;
 *   6. a process that dies mid-import leaves the row `importing`; its lease
 *      runs out, the row becomes `unknown`, and the next attempt starts with
 *      the lookup again. Nothing is ever created blindly twice.
 *
 * NEVER INVENT A PRODUCT: a line that matches no variant (by the offer link,
 * then by the signature) holds the whole order with the reason. A person
 * fixes the catalog or the signature and retries.
 */

import { isPaid, type CheckoutForm, type Money } from "./checkout"
import { IMPORT_MAX_ATTEMPTS, NOT_READY_GIVE_UP_DAYS, marketplaceRef } from "./constants"
import type { EventIntent } from "./events"

export interface LineVariant {
  id: string
  productId: string
  sku: string
  productTitle: string | null
}

export interface MedusaAddressInput {
  first_name?: string
  last_name?: string
  company?: string
  address_1?: string
  address_2?: string
  city?: string
  postal_code?: string
  country_code?: string
  phone?: string
}

export interface MedusaLineInput {
  variant_id: string
  title: string
  quantity: number
  unit_price: number
  is_tax_inclusive: true
  is_discountable: false
  requires_shipping: true
  metadata: Record<string, unknown>
}

export interface MedusaShippingInput {
  name: string
  amount: number
  is_tax_inclusive: true
  shipping_option_id?: string
  data: Record<string, unknown>
}

export interface MedusaOrderInput {
  region_id: string
  sales_channel_id: string
  currency_code: string
  /** Created as a draft, then placed by `convertDraftOrderWorkflow` (reservations and `order.placed`). */
  status: "draft"
  is_draft_order: true
  no_notification: true
  shipping_address: MedusaAddressInput
  billing_address: MedusaAddressInput
  items: MedusaLineInput[]
  shipping_methods: MedusaShippingInput[]
  metadata: Record<string, unknown>
}

export interface ImportContext {
  regionId: string
  /** Region currency, lower case as Medusa keeps it. */
  currency: string
  salesChannelId: string
  byOffer: ReadonlyMap<string, LineVariant>
  bySku: ReadonlyMap<string, LineVariant>
  shippingOptionId: string | null
  /** Allegro delivery method id or name to a Medusa shipping option id. */
  shippingOptions: Readonly<Record<string, string>>
  demo: boolean
}

export type HoldCode =
  | "unmapped_lines"
  | "currency_mismatch"
  | "no_address"
  | "no_lines"
  | "bad_line"
  | "no_region"
  | "no_channel"
  | "stock"
  | "workflow_error"
  | "too_many_attempts"
  | "form_not_found"

export type ImportDecision =
  | {
      kind: "create"
      order: MedusaOrderInput
      email: string | null
      paid: boolean
      paymentType: string | null
      total: Money | null
      lines: Array<{ allegroLineId: string; variantId: string; quantity: number; sku: string }>
    }
  | { kind: "hold"; code: HoldCode; reason: string }
  | { kind: "skip"; code: "cancelled"; reason: string }
  | { kind: "wait"; code: "not_ready"; reason: string }

function key(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase()
}

function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== "") out[k] = v
  return out as T
}

export function planImport(form: CheckoutForm, ctx: ImportContext): ImportDecision {
  if (form.status === "CANCELLED") return { kind: "skip", code: "cancelled", reason: "The buyer or Allegro cancelled this purchase before it was imported." }
  if (form.status !== "READY_FOR_PROCESSING") {
    return { kind: "wait", code: "not_ready", reason: `Allegro status ${form.status}: the payment is not finished yet. Imported once the form is READY_FOR_PROCESSING.` }
  }
  if (form.lines.length === 0) return { kind: "hold", code: "no_lines", reason: "The checkout form has no lines." }

  const unmapped: string[] = []
  const lines: Array<{ allegroLineId: string; variant: LineVariant; quantity: number; price: Money; offerId: string; offerName: string }> = []
  for (const l of form.lines) {
    const variant = ctx.byOffer.get(l.offerId) ?? (l.externalId ? ctx.bySku.get(key(l.externalId)) : undefined)
    if (!variant) {
      unmapped.push(`offer ${l.offerId} "${l.offerName}"${l.externalId ? ` (signature ${l.externalId})` : " (no signature)"}`)
      continue
    }
    if (!l.price || l.quantity <= 0) {
      return { kind: "hold", code: "bad_line", reason: `Line ${l.id} has no price or no quantity.` }
    }
    lines.push({ allegroLineId: l.id, variant, quantity: l.quantity, price: l.price, offerId: l.offerId, offerName: l.offerName })
  }
  if (unmapped.length > 0) {
    return {
      kind: "hold",
      code: "unmapped_lines",
      reason: `No Medusa variant for ${unmapped.join("; ")}. Put the variant SKU in the offer signature or add the SKU to a variant, then retry. No product is ever invented.`,
    }
  }

  const currency = ctx.currency.toUpperCase()
  const currencies = new Set([...lines.map((l) => l.price.currency), ...(form.total ? [form.total.currency] : []), ...(form.delivery.cost ? [form.delivery.cost.currency] : [])])
  if ([...currencies].some((c) => c !== currency)) {
    return { kind: "hold", code: "currency_mismatch", reason: `The order is in ${[...currencies].join(", ")} and the region is in ${currency}. Set orderImport.regionId to a region in the order currency.` }
  }

  const ship = form.delivery.address
  if (!ship || !ship.street || !ship.city || !ship.zipCode || !ship.countryCode) {
    return { kind: "hold", code: "no_address", reason: "The checkout form has no complete delivery address." }
  }
  const pickup = form.delivery.pickupPoint
  /* "Paczkomat KRA01M" already names the point: the id is added only when the name lacks it. */
  const pickupLine = pickup
    ? pickup.name && pickup.id && pickup.name.toUpperCase().includes(pickup.id.toUpperCase())
      ? pickup.name
      : [pickup.name, pickup.id].filter(Boolean).join(", ") || null
    : null
  const shipping_address: MedusaAddressInput = clean({
    first_name: ship.firstName ?? undefined,
    last_name: ship.lastName ?? undefined,
    company: ship.companyName ?? undefined,
    address_1: ship.street,
    /* A parcel locker is not a company: its name and id go to the second
     * address line, where a label needs it. */
    address_2: pickupLine ?? undefined,
    city: ship.city,
    postal_code: ship.zipCode,
    country_code: ship.countryCode.toLowerCase(),
    phone: ship.phoneNumber ?? undefined,
  })

  const inv = form.invoice.address
  const billing_address: MedusaAddressInput =
    inv && inv.street && inv.city && inv.zipCode && inv.countryCode
      ? clean({
          first_name: inv.firstName ?? undefined,
          last_name: inv.lastName ?? undefined,
          company: inv.companyName ?? undefined,
          address_1: inv.street,
          city: inv.city,
          postal_code: inv.zipCode,
          country_code: inv.countryCode.toLowerCase(),
          phone: ship.phoneNumber ?? undefined,
        })
      : { ...shipping_address, address_2: undefined }
  if (!billing_address.address_2) delete billing_address.address_2

  const shippingOptionId =
    (form.delivery.methodId ? ctx.shippingOptions[form.delivery.methodId] : undefined) ??
    (form.delivery.methodName ? ctx.shippingOptions[form.delivery.methodName] : undefined) ??
    ctx.shippingOptionId ??
    undefined

  const order: MedusaOrderInput = {
    region_id: ctx.regionId,
    sales_channel_id: ctx.salesChannelId,
    currency_code: ctx.currency.toLowerCase(),
    status: "draft",
    is_draft_order: true,
    /* The marketplace talks to its buyer: Medusa sends nothing for this order. */
    no_notification: true,
    shipping_address,
    billing_address,
    items: lines.map((l) => ({
      variant_id: l.variant.id,
      title: l.variant.productTitle ?? l.offerName,
      quantity: l.quantity,
      unit_price: l.price.value,
      is_tax_inclusive: true,
      /* Allegro already applied its discounts; store promotions must not move the total. */
      is_discountable: false,
      requires_shipping: true,
      metadata: clean({ allegro_line_item_id: l.allegroLineId, allegro_offer_id: l.offerId, allegro_offer_name: l.offerName }),
    })),
    shipping_methods: [
      {
        name: form.delivery.methodName ?? "Allegro delivery",
        amount: form.delivery.cost?.value ?? 0,
        is_tax_inclusive: true,
        ...(shippingOptionId ? { shipping_option_id: shippingOptionId } : {}),
        data: clean({ allegro_delivery_method_id: form.delivery.methodId, allegro_pickup_point_id: pickup?.id ?? null }),
      },
    ],
    metadata: clean({
      marketplace_order_ref: marketplaceRef(form.id),
      allegro_checkout_form_id: form.id,
      allegro_marketplace: form.marketplace,
      allegro_payment_type: form.payment.type,
      allegro_buyer_login: form.buyer.login,
      allegro_delivery_method: form.delivery.methodName,
      allegro_pickup_point_id: pickup?.id ?? null,
      allegro_invoice_required: form.invoice.required || null,
      nip: inv?.nip ?? null,
      allegro_demo: ctx.demo || null,
    }),
  }

  return {
    kind: "create",
    order,
    email: form.buyer.email,
    paid: isPaid(form),
    paymentType: form.payment.type,
    total: form.total,
    lines: lines.map((l) => ({ allegroLineId: l.allegroLineId, variantId: l.variant.id, quantity: l.quantity, sku: l.variant.sku })),
  }
}

/** Totals the same to the grosz and in the same currency. */
export function sameTotal(a: Money | null, b: Money | null): boolean {
  if (!a || !b) return a === b
  return a.currency.toUpperCase() === b.currency.toUpperCase() && Math.round(a.value * 100) === Math.round(b.value * 100)
}

/* ------------------------------------------------------------------ */
/* The drain: what an event does to the row of its checkout form       */
/* ------------------------------------------------------------------ */

export type DrainAction =
  | { kind: "insert"; status: "pending" | "skipped"; reasonCode?: string; reason?: string }
  | { kind: "nudge" }
  | { kind: "cancel_before_import" }
  | { kind: "request_cancel" }
  | { kind: "request_refresh" }
  | { kind: "none" }

export function drainAction(existing: { status: string } | null, intent: EventIntent): DrainAction {
  const s = existing?.status ?? null
  if (intent === "import") {
    if (!s) return { kind: "insert", status: "pending" }
    return s === "pending" || s === "unknown" ? { kind: "nudge" } : { kind: "none" }
  }
  if (intent === "cancel") {
    if (!s) return { kind: "insert", status: "skipped", reasonCode: "cancelled", reason: "Cancelled on Allegro before it was imported." }
    if (s === "pending" || s === "unknown" || s === "held") return { kind: "cancel_before_import" }
    if (s === "importing" || s === "imported") return { kind: "request_cancel" }
    return { kind: "none" }
  }
  if (intent === "refresh") {
    if (s === "imported") return { kind: "request_refresh" }
    if (s === "pending" || s === "unknown") return { kind: "nudge" }
    return { kind: "none" }
  }
  return { kind: "none" }
}

/* ------------------------------------------------------------------ */
/* One attempt of one row                                              */
/* ------------------------------------------------------------------ */

export interface ImportRow {
  id: string
  checkout_form_id: string
  status: string
  attempts: number
  created_at?: Date | string | null
}

export interface CreatedOrder {
  orderId: string
  displayId: number | null
  total: Money | null
}

/** A Medusa order found by its marketplace reference. */
export interface FoundOrder {
  id: string
  display_id: number | null
  /** Created by this plugin (it carries `allegro_checkout_form_id`). */
  ours: boolean
  /** Still a draft: an earlier attempt created it and did not get to place it. */
  draft: boolean
}

export interface ImportPorts {
  now(): Date
  token(): string
  claim(row: ImportRow, token: string): Promise<ImportRow | null>
  /** Writes on the row while the claim is held (the order id, the moment the order exists). False when the claim is gone. */
  progress(row: ImportRow, token: string, patch: Record<string, unknown>): Promise<boolean>
  finish(row: ImportRow, token: string, patch: Record<string, unknown>): Promise<boolean>
  findOrderByRef(ref: string): Promise<FoundOrder | null>
  /**
   * Runs `fn` holding `marketplace-order-ref:<ref>` in the Medusa Locking
   * module, the key every importer of this marketplace order takes. Null when
   * somebody else holds it right now.
   */
  withRefLock<T>(ref: string, fn: () => Promise<T>): Promise<T | null>
  fetchForm(checkoutFormId: string): Promise<CheckoutForm>
  context(form: CheckoutForm): Promise<ImportContext | { hold: { code: HoldCode; reason: string } }>
  /** A reason to hold the order when Medusa cannot reserve the stock, or null. */
  precheckStock(decision: Extract<ImportDecision, { kind: "create" }>, ctx: ImportContext): Promise<string | null>
  /** Creates the order as a draft (`createOrderWorkflow`): nothing is reserved or announced yet. */
  createDraft(decision: Extract<ImportDecision, { kind: "create" }>, ctx: ImportContext): Promise<{ orderId: string; displayId: number | null }>
  /**
   * Brings one of our orders to its final state, every step checked before
   * it runs: the e-mail and the tax lines on the draft, the draft placed
   * (`convertDraftOrderWorkflow`: reservations, then `order.placed`), one
   * payment collection, marked paid when Allegro holds the money.
   */
  complete(orderId: string, args: { email: string | null; paid: boolean }): Promise<CreatedOrder>
}

export type ImportOutcome =
  | { kind: "busy" }
  | { kind: "imported"; orderId: string; displayId: number | null; mismatch: boolean }
  | { kind: "adopted"; orderId: string }
  | { kind: "duplicate"; orderId: string }
  | { kind: "held"; code: HoldCode; reason: string }
  | { kind: "waiting"; reason: string }
  | { kind: "skipped"; reason: string }
  | { kind: "retry"; reason: string; transient: boolean }
  | { kind: "lost"; reason: string }

/** Errors Medusa raises for data it refuses: a person has to act, retrying changes nothing. */
export function isDataError(err: unknown): boolean {
  const e = err as { type?: unknown; name?: unknown } | null
  const type = String(e?.type ?? "")
  return type === "invalid_data" || type === "not_allowed" || type === "not_found" || type === "conflict"
}

function minutes(n: number): number {
  return n * 60 * 1000
}

/** Backoff of an unexpected failure: 2, 4, 8, 16 minutes. */
export function retryDelayMs(attempts: number): number {
  return minutes(Math.min(60, 2 ** Math.max(1, attempts)))
}

function message(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 800)
}

function duplicatePatch(found: FoundOrder): Record<string, unknown> {
  return {
    status: "skipped",
    order_id: found.id,
    display_id: found.display_id,
    reason_code: "duplicate_ref",
    reason: `Another integration already imported this Allegro order as Medusa order ${found.display_id ? `#${found.display_id}` : found.id}. Skipped, so it is not imported twice.`,
  }
}

export async function processImport(row: ImportRow, ports: ImportPorts, mask: (s: string) => string = (s) => s): Promise<ImportOutcome> {
  const token = ports.token()
  const claimed = await ports.claim(row, token)
  if (!claimed) return { kind: "busy" }
  const now = ports.now()
  const done = async (patch: Record<string, unknown>, outcome: ImportOutcome): Promise<ImportOutcome> => {
    const ok = await ports.finish(claimed, token, patch)
    return ok ? outcome : { kind: "lost", reason: "The claim expired before the result was written; the next run looks the order up again." }
  }
  const busy = () =>
    done(
      { status: "pending", reason_code: "busy", reason: "Another process imports this Allegro order right now.", attempts: Math.max(0, claimed.attempts - 1), next_attempt_at: new Date(now.getTime() + 60_000) },
      { kind: "busy" },
    )

  /* 1. Lookup before anything: another integration's order makes us step back at once. */
  const ref = marketplaceRef(claimed.checkout_form_id)
  const existing = await ports.findOrderByRef(ref)
  if (existing && !existing.ours) return done(duplicatePatch(existing), { kind: "duplicate", orderId: existing.id })

  /* 2. The form, fresh. */
  let form: CheckoutForm
  try {
    form = await ports.fetchForm(claimed.checkout_form_id)
  } catch (err) {
    const status = Number((err as { status?: unknown })?.status)
    if (status === 404) {
      return done({ status: "held", reason_code: "form_not_found", reason: "Allegro does not know this checkout form (404)." }, { kind: "held", code: "form_not_found", reason: "404" })
    }
    const reason = mask(message(err))
    return done(
      { status: "pending", reason_code: "fetch_failed", reason: `Reading the form failed: ${reason}`, next_attempt_at: new Date(now.getTime() + retryDelayMs(claimed.attempts)) },
      { kind: "retry", reason, transient: true },
    )
  }

  const facts = {
    allegro_status: form.status,
    fulfillment_status: form.fulfillmentStatus,
    payment_type: form.payment.type,
    paid: isPaid(form),
    total: form.total,
    line_count: form.lines.length,
    bought_at: form.boughtAt ? new Date(form.boughtAt) : null,
  }
  const completion = { email: form.buyer.email, paid: isPaid(form) }

  /* A failure after the order exists keeps its id on the row: the next attempt finds the order and finishes it. */
  const failed = (err: unknown, orderId: string | null): Promise<ImportOutcome> => {
    const reason = mask(message(err))
    const keep = orderId ? { order_id: orderId } : {}
    if (isDataError(err)) {
      return done({ ...facts, ...keep, status: "held", reason_code: "workflow_error", reason: `Medusa refused the order: ${reason}` }, { kind: "held", code: "workflow_error", reason })
    }
    if (claimed.attempts >= IMPORT_MAX_ATTEMPTS) {
      return done(
        { ...facts, ...keep, status: "held", reason_code: "too_many_attempts", reason: `Failed ${claimed.attempts} times. Last error: ${reason}` },
        { kind: "held", code: "too_many_attempts", reason },
      )
    }
    return done(
      {
        ...facts,
        ...keep,
        status: "pending",
        reason_code: orderId ? "complete_failed" : "create_failed",
        reason: orderId ? `The order exists in Medusa, finishing it failed, retrying: ${reason}` : `Creating the order failed, retrying: ${reason}`,
        next_attempt_at: new Date(now.getTime() + retryDelayMs(claimed.attempts)),
      },
      { kind: "retry", reason, transient: false },
    )
  }

  /* Our own order from an earlier attempt: finished (placed and paid, each only once), never created again. */
  const adopt = async (found: FoundOrder): Promise<ImportOutcome> => {
    try {
      const finished = await ports.complete(found.id, completion)
      return done(
        {
          ...facts,
          status: "imported",
          order_id: finished.orderId,
          display_id: finished.displayId ?? found.display_id,
          medusa_total: finished.total,
          reason_code: "adopted",
          reason: found.draft
            ? "An earlier attempt created this order as a draft; it was placed now. Adopted, nothing created twice."
            : "This order was already in Medusa (an earlier attempt created it). Adopted, nothing created twice.",
          imported_at: now,
        },
        { kind: "adopted", orderId: found.id },
      )
    } catch (err) {
      return failed(err, found.id)
    }
  }

  if (existing) {
    const adopted = await ports.withRefLock(ref, () => adopt(existing))
    return adopted ?? busy()
  }

  /* 3. Where it lands. */
  const ctx = await ports.context(form)
  if ("hold" in ctx) {
    return done({ ...facts, status: "held", reason_code: ctx.hold.code, reason: ctx.hold.reason }, { kind: "held", code: ctx.hold.code, reason: ctx.hold.reason })
  }

  /* 4. The decision. */
  const decision = planImport(form, ctx)
  if (decision.kind === "skip") {
    return done({ ...facts, status: "skipped", reason_code: decision.code, reason: decision.reason }, { kind: "skipped", reason: decision.reason })
  }
  if (decision.kind === "wait") {
    const created = claimed.created_at ? new Date(claimed.created_at) : now
    if (now.getTime() - created.getTime() > NOT_READY_GIVE_UP_DAYS * 24 * 60 * 60 * 1000) {
      const reason = `Not ready for processing after ${NOT_READY_GIVE_UP_DAYS} days.`
      return done({ ...facts, status: "skipped", reason_code: "never_ready", reason }, { kind: "skipped", reason })
    }
    return done(
      { ...facts, status: "pending", reason_code: decision.code, reason: decision.reason, attempts: Math.max(0, claimed.attempts - 1), next_attempt_at: new Date(now.getTime() + minutes(15)) },
      { kind: "waiting", reason: decision.reason },
    )
  }
  if (decision.kind === "hold") {
    return done({ ...facts, status: "held", reason_code: decision.code, reason: decision.reason }, { kind: "held", code: decision.code, reason: decision.reason })
  }

  /* 5. Stock, before Medusa refuses it with a less helpful message. */
  const stock = await ports.precheckStock(decision, ctx)
  if (stock) return done({ ...facts, status: "held", reason_code: "stock", reason: stock }, { kind: "held", code: "stock", reason: stock })

  /* 6. Under the shared lock: the reference looked up again, then created as a draft and finished. */
  const locked = await ports.withRefLock(ref, async (): Promise<ImportOutcome> => {
    const late = await ports.findOrderByRef(ref)
    if (late && !late.ours) return done(duplicatePatch(late), { kind: "duplicate", orderId: late.id })
    if (late) return adopt(late)

    let orderId: string | null = null
    try {
      const draft = await ports.createDraft(decision, ctx)
      orderId = draft.orderId
      /* The id is on the row the moment the order exists: a retry finds it, never makes a second one. */
      if (!(await ports.progress(claimed, token, { order_id: draft.orderId, display_id: draft.displayId }))) {
        return { kind: "lost", reason: "The claim expired right after the draft was created; the next run finds the order and finishes it." }
      }
      const created = await ports.complete(draft.orderId, { email: decision.email, paid: decision.paid })
      const mismatch = !sameTotal(created.total, decision.total)
      return done(
        {
          ...facts,
          status: "imported",
          order_id: created.orderId,
          display_id: created.displayId ?? draft.displayId,
          medusa_total: created.total,
          total_mismatch: mismatch,
          reason_code: mismatch ? "total_mismatch" : null,
          reason: mismatch
            ? `Imported, but the Medusa total (${created.total ? `${created.total.value} ${created.total.currency}` : "none"}) differs from the Allegro total (${decision.total ? `${decision.total.value} ${decision.total.currency}` : "none"}). Check promotions and shipping taxes.`
            : null,
          imported_at: now,
        },
        { kind: "imported", orderId: created.orderId, displayId: created.displayId ?? draft.displayId, mismatch },
      )
    } catch (err) {
      return failed(err, orderId)
    }
  })
  return locked ?? busy()
}

/** An order item or shipping method with its tax lines, as Query returns them. */
export interface TaxedRecord {
  id: string
  tax_lines?: Array<{ id?: string } | null> | null
}

/**
 * The ids that came out without a single tax line. Only these get the forced
 * tax calculation: Medusa adds tax lines, it does not replace them, so a
 * second calculation over taxed lines would double the VAT.
 */
export function untaxedIds(list: ReadonlyArray<TaxedRecord | null> | null | undefined): string[] {
  return (list ?? []).filter((x): x is TaxedRecord => Boolean(x) && (x?.tax_lines ?? []).filter(Boolean).length === 0).map((x) => x.id)
}

/* ------------------------------------------------------------------ */
/* Cancellation of an imported order                                   */
/* ------------------------------------------------------------------ */

export type CancelDecision = { kind: "cancel" } | { kind: "already" } | { kind: "attention"; reason: string } | { kind: "gone" }

/**
 * Allegro cancelled an order Medusa already has. Medusa cancels it only when
 * nothing was fulfilled; otherwise a person handles the return.
 */
export function cancelDecision(order: { status: string; activeFulfillments: number } | null): CancelDecision {
  if (!order) return { kind: "gone" }
  if (order.status === "canceled") return { kind: "already" }
  if (order.activeFulfillments > 0) {
    return { kind: "attention", reason: "Cancelled on Allegro after the order was fulfilled in Medusa. Handle the return or refund by hand; the Medusa order was left as it is." }
  }
  if (order.status === "completed") return { kind: "attention", reason: "Cancelled on Allegro after the Medusa order was completed. Handle it by hand." }
  return { kind: "cancel" }
}
