/**
 * E-MAILS OF A CODE: who can get it, the preview, the send. The plugin sends
 * nothing itself: the store's adapter (options sendCode, previewCode) does,
 * with its own templates and provider. The plugin picks the people who did
 * not get the code before, adds them to the coupon's customer rule first
 * (so the code works for them) and records each send in the promotion's
 * metadata (code_sent).
 */
import { randomUUID } from "node:crypto"
import { campaignIdOf, cleanIds, cleanMessage, cleanNote, cleanSendCoupons, codeSentOf, planMultiSend, sendBlockers, sentEntry, withSent } from "../../modules/coupons/lib/code-mail"
import { codeMailCampaigns, type CouponOrderFact } from "../../modules/coupons/lib/code-mail-stats"
import type { CodeMailDeliveryState, CodeMailInput, CodeMailPreviewResponse, CodeMailRecipientDto, CodeMailResponse, CodeMailSendResponse, CodeMailStatsResponse, CodeSentEntry, CouponDto } from "../../modules/coupons/lib/contract"
import type { CodeMailCoupon, CodeMailRecipient } from "../../modules/coupons/lib/options"
import { CouponInputError } from "./errors"
import { couponOrderFacts, customerLabel, readPromotions, toCoupons } from "./reads"
import { couponsService, customerModule, promotionModule, queryOf, str, type Scope } from "./runtime"
import { updateCoupon } from "./update"

async function couponOf(scope: Scope, id: string): Promise<CouponDto> {
  const [p] = await readPromotions(scope, { id }, 1)
  if (!p) throw new CouponInputError(404, ["not_found"], "No such coupon.")
  const [c] = await toCoupons(scope, [p])
  return c
}

function mailCoupon(c: CouponDto): CodeMailCoupon {
  return {
    id: c.id,
    code: c.code,
    kind: c.shape.kind,
    value: c.shape.value,
    currency: c.shape.currency,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    note: c.terms?.note ?? null,
  }
}

type CustomerRow = { id: string; email?: string | null; first_name?: string | null; last_name?: string | null; company_name?: string | null }

async function customersOf(scope: Scope, ids: string[]): Promise<Map<string, CustomerRow>> {
  const out = new Map<string, CustomerRow>()
  if (!ids.length) return out
  const rows = await customerModule(scope).listCustomers({ id: ids }, { take: ids.length, select: ["id", "email", "first_name", "last_name", "company_name"] })
  for (const r of rows) out.set(r.id, r)
  return out
}

function recipientOf(r: CustomerRow): CodeMailRecipient {
  return { customerId: r.id, email: String(r.email ?? ""), firstName: str(r.first_name), name: customerLabel(r as Record<string, unknown>) }
}

function ability(scope: Scope): { send: boolean; preview: boolean; link: boolean } {
  const o = couponsService(scope).getOptions()
  return { send: Boolean(o.sendCode), preview: Boolean(o.sendCode && o.previewCode), link: Boolean(o.sendCode && o.codeLink) }
}

/** The people of the coupon's customer rule and everyone who got the code before, with their e-mails. */
export async function codeMailState(scope: Scope, id: string): Promise<CodeMailResponse> {
  const c = await couponOf(scope, id)
  const nobody = couponsService(scope).getOptions().nobodyCustomerId
  const can = ability(scope)
  const sent = c.codeSent ?? []
  const ruleIds = c.shape.customerIds.filter((x) => x !== nobody)
  const ids = [...new Set([...ruleIds, ...sent.map((e) => e.customer_id)])]
  const rows = await customersOf(scope, ids)
  const sentAt = new Map(sent.map((e) => [e.customer_id, e.at]))
  const recipients: CodeMailRecipientDto[] = ids.map((cid) => {
    const r = rows.get(cid)
    const was = sent.find((e) => e.customer_id === cid)
    return {
      customerId: cid,
      email: r?.email ?? was?.email ?? null,
      name: r ? customerLabel(r as Record<string, unknown>) : null,
      sentAt: sentAt.get(cid) ?? null,
      inRule: ruleIds.includes(cid),
    }
  })
  return { ability: can, code: c.code, customerRule: c.shape.customerIds.length > 0, blockers: sendBlockers(c, can.send), recipients, sent }
}

/**
 * The coupons of a send and their sentences: the one of the address first.
 * Every one must be sendable now (a code, working, a sender); the keys of
 * what blocks another coupon are prefixed with "other_".
 */
async function sendItems(scope: Scope, id: string, input: Partial<CodeMailInput>, message: string, canSend: boolean): Promise<Array<{ coupon: CouponDto; sentence: string }>> {
  const picked = cleanSendCoupons(id, input.coupons, message)
  if (!picked.ok) throw new CouponInputError(400, picked.errors, "The coupons of this send are wrong: too many, or a sentence is empty or too long.")
  const out: Array<{ coupon: CouponDto; sentence: string }> = []
  for (const [i, item] of picked.items.entries()) {
    const coupon = await couponOf(scope, item.id)
    const blockers = sendBlockers(coupon, canSend)
    if (blockers.length) throw new CouponInputError(400, i === 0 ? blockers : blockers.map((b) => `other_${b}`), `The code of ${coupon.code || item.id} cannot be sent now: ${blockers.join(", ")}.`)
    out.push({ coupon, sentence: item.sentence })
  }
  return out
}

/** A link only when the store builds one (option codeLink); on unless the admin switched it off. */
const linkOf = (input: Partial<CodeMailInput>, codeLink: boolean) => codeLink && input.link !== false

/** The e-mail for the first person asked for (or the first on the coupon), rendered by the store, sent to nobody. */
export async function previewCodeMail(scope: Scope, id: string, input: Partial<CodeMailInput>): Promise<CodeMailPreviewResponse> {
  const o = couponsService(scope).getOptions()
  if (!o.previewCode) throw new CouponInputError(400, ["no_preview"], "The store renders no preview of this e-mail.")
  const message = cleanMessage(input.message)
  if (!message.ok) throw new CouponInputError(400, [message.error as string], "The instruction is empty or too long.")
  const senderNote = cleanNote(input.senderNote)
  if (!senderNote.ok) throw new CouponInputError(400, [senderNote.error as string], "The note is too long.")
  const picked = cleanSendCoupons(id, input.coupons, message.value)
  if (!picked.ok) throw new CouponInputError(400, picked.errors, "The coupons of this send are wrong: too many, or a sentence is empty or too long.")
  const items: Array<{ coupon: CouponDto; sentence: string }> = []
  for (const item of picked.items) items.push({ coupon: await couponOf(scope, item.id), sentence: item.sentence })
  const c = items[0].coupon
  const nobody = o.nobodyCustomerId
  const first = [...cleanIds(input.customerIds), ...c.shape.customerIds.filter((x) => x !== nobody)][0] ?? null
  const row = first ? (await customersOf(scope, [first])).get(first) ?? null : null
  const recipient: CodeMailRecipient = row ? recipientOf(row) : { customerId: "", email: "", firstName: null, name: null }
  const out = await o.previewCode(scope, {
    promotion: mailCoupon(c),
    recipient: { ...recipient, promotionIds: items.map((x) => x.coupon.id) },
    message: message.value,
    items: items.map((x) => ({ promotion: mailCoupon(x.coupon), sentence: x.sentence })),
    link: linkOf(input, o.codeLink),
    senderNote: senderNote.value,
  })
  return { subject: String(out?.subject ?? ""), html: String(out?.html ?? ""), to: recipient.email || null }
}

/**
 * Who sends: an admin user id (its e-mail is looked up), or a label the
 * caller names itself (another panel of the store, e.g. { label: "sales" }).
 */
export type CodeMailActor = string | { label: string } | null

async function actorLabel(scope: Scope, actor: CodeMailActor): Promise<string | null> {
  if (actor && typeof actor === "object") return str(actor.label?.trim()) ?? null
  const actorId = actor
  if (!actorId) return null
  try {
    const { data } = await queryOf(scope).graph({ entity: "user", fields: ["id", "email"], filters: { id: actorId } })
    return str((data?.[0] as { email?: unknown } | undefined)?.email) ?? actorId
  } catch {
    return actorId
  }
}

/**
 * Sends the code (or several codes in one e-mail, input.coupons) to the
 * people asked for. Per coupon, whoever got its code before does not get it
 * again; a person who has every code is skipped. New people go onto each
 * coupon's customer rule first (only a coupon with one: a coupon for
 * everyone or for groups is never narrowed). Nothing is sent when such a
 * change fails. Each send is recorded on each of its coupons, with a shared
 * campaign id when there are several.
 */
export async function sendCodeMail(scope: Scope, id: string, input: Partial<CodeMailInput>, actorId: CodeMailActor, now: Date = new Date()): Promise<CodeMailSendResponse> {
  const o = couponsService(scope).getOptions()
  const log = couponsService(scope).getLogger()
  const message = cleanMessage(input.message)
  if (!message.ok) throw new CouponInputError(400, [message.error as string], "The instruction is empty or too long.")
  const requested = cleanIds(input.customerIds)
  if (!requested.length) throw new CouponInputError(400, ["recipients"], "Pick at least one customer.")
  if (!o.sendCode) throw new CouponInputError(400, ["no_sender"], "The store sends no e-mails from here.")
  const senderNote = cleanNote(input.senderNote)
  if (!senderNote.ok) throw new CouponInputError(400, [senderNote.error as string], "The note is too long.")

  const items = await sendItems(scope, id, input, message.value, true)
  const multi = items.length > 1
  const plan = planMultiSend({ requested, coupons: items.map((x) => ({ id: x.coupon.id, sent: x.coupon.codeSent ?? [], ruleIds: x.coupon.shape.customerIds })), nobody: o.nobodyCustomerId })
  const rows = await customersOf(scope, plan.toSend)
  const failed: CodeMailSendResponse["failed"] = []
  const recipients: CodeMailRecipient[] = []
  for (const cid of plan.toSend) {
    const r = rows.get(cid)
    if (!r) failed.push({ customerId: cid, reason: "not_found" })
    else if (!r.email) failed.push({ customerId: cid, reason: "no_email" })
    else recipients.push({ ...recipientOf(r), promotionIds: plan.codesOf[cid] })
  }
  const coupons = items.map((x) => x.coupon)
  if (!recipients.length) return { sent: [], skipped: plan.skipped, failed, addedToRule: [], recorded: true, coupon: coupons[0], coupons, campaign: null }

  /* The codes have to work for them before they read them. */
  const sendable = new Set(recipients.map((r) => r.customerId))
  const added = new Set<string>()
  for (const [i, x] of items.entries()) {
    const p = plan.perCoupon[x.coupon.id]
    const addToRule = p.addToRule.filter((cid) => sendable.has(cid))
    if (!addToRule.length || !p.ruleAfter) continue
    const ruleAfter = p.ruleAfter.filter((cid) => !p.addToRule.includes(cid) || sendable.has(cid))
    coupons[i] = (await updateCoupon(scope, x.coupon.id, { customerIds: ruleAfter }, now)).coupon
    for (const cid of addToRule) added.add(cid)
  }

  const sentBy = await actorLabel(scope, actorId)
  const campaign = multi ? campaignIdOf(now, randomUUID()) : null
  const out = await o.sendCode(scope, {
    promotion: mailCoupon(coupons[0]),
    recipients,
    message: message.value,
    sentBy,
    items: items.map((x, i) => ({ promotion: mailCoupon(coupons[i]), sentence: x.sentence })),
    link: linkOf(input, o.codeLink),
    campaignId: campaign,
    senderNote: senderNote.value,
  })
  const sentIds = new Set((out?.sent ?? []).filter((cid) => sendable.has(cid)))
  for (const f of out?.failed ?? []) if (f && sendable.has(f.customerId) && !sentIds.has(f.customerId)) failed.push({ customerId: f.customerId, reason: String(f.reason ?? "failed") })
  for (const r of recipients) if (!sentIds.has(r.customerId) && !failed.some((f) => f.customerId === r.customerId)) failed.push({ customerId: r.customerId, reason: "failed" })

  let recorded = true
  const at = now.toISOString()
  const svc = promotionModule(scope)
  for (const [i, c] of coupons.entries()) {
    const got = recipients.filter((r) => sentIds.has(r.customerId) && (r.promotionIds ?? []).includes(c.id))
    if (!got.length) continue
    const entries: CodeSentEntry[] = got.map((r) => sentEntry(r, coupons, { at, by: sentBy, campaign }))
    try {
      const [fresh] = await svc.listPromotions({ id: c.id }, { select: ["id", "metadata"], take: 1 })
      await svc.updatePromotions({ id: c.id, metadata: withSent(fresh?.metadata ?? null, entries) })
      coupons[i] = { ...c, codeSent: [...codeSentOf({ code_sent: c.codeSent ?? [] }), ...entries] }
    } catch (err) {
      recorded = false
      log.error(`[coupons] The code of ${c.code} went to ${entries.length} customer(s) but the record was not saved: ${(err as Error)?.message ?? err}`)
    }
  }
  const codes = coupons.map((c) => c.code).join(" + ")
  log.info(`[coupons] Code ${codes} (${id}) e-mailed to ${sentIds.size}, skipped ${plan.skipped.length}, failed ${failed.length}${added.size ? `, ${added.size} added to a customer rule` : ""}${campaign ? `, campaign ${campaign}` : ""}, by ${sentBy ?? "?"}.`)
  return { sent: [...sentIds], skipped: plan.skipped, failed, addedToRule: [...added], recorded, coupon: coupons[0], coupons, campaign }
}

/**
 * The results of the code's e-mails: per send the people, the delivery (when
 * the store reports it, option codeMailDelivery), who ordered with the code
 * afterwards, the orders, the revenue (option orderRevenue, else the order
 * total) and the conversion; and all orders with the code next to them.
 * Read only.
 */
export async function codeMailStats(scope: Scope, id: string): Promise<CodeMailStatsResponse> {
  const o = couponsService(scope).getOptions()
  const log = couponsService(scope).getLogger()
  const c = await couponOf(scope, id)
  const sent = c.codeSent ?? []
  const facts = await couponOrderFacts(scope, id)

  let revenueBasis: "net" | "gross" = "gross"
  let revenue: Record<string, number> | null = null
  if (o.orderRevenue && facts.length) {
    try {
      revenue = (await o.orderRevenue.read(scope, facts.map((f) => f.orderId))) ?? {}
      revenueBasis = o.orderRevenue.basis
    } catch (err) {
      log.warn(`[coupons] The store's revenue of the orders of ${c.code} could not be read, the order totals are shown: ${(err as Error)?.message ?? err}`)
    }
  } else if (o.orderRevenue) revenueBasis = o.orderRevenue.basis
  const orders: CouponOrderFact[] = facts.map((f) => {
    const own = revenue ? Number(revenue[f.orderId]) : NaN
    return { orderId: f.orderId, customerId: f.customerId, createdAt: f.createdAt, revenue: revenue ? (Number.isFinite(own) ? own : 0) : f.total }
  })

  let delivery: Record<string, CodeMailDeliveryState | null> | null = null
  if (o.codeMailDelivery && sent.length) {
    try {
      delivery = (await o.codeMailDelivery(scope, { promotionId: id, recipients: sent.map((e) => ({ customerId: e.customer_id, email: e.email, at: e.at })) })) ?? {}
    } catch (err) {
      log.warn(`[coupons] The delivery of the e-mails of ${c.code} could not be read: ${(err as Error)?.message ?? err}`)
    }
  }
  const { campaigns, totals } = codeMailCampaigns({ sent, orders, delivery, ownCode: c.code })
  return { code: c.code, currency: (c.shape.currency || o.currencyCode).toUpperCase(), revenueBasis, deliveryKnown: delivery !== null, campaigns, totals }
}
