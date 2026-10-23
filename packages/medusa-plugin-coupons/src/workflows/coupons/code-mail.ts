/**
 * E-MAILS OF A CODE: who can get it, the preview, the send. The plugin sends
 * nothing itself: the store's adapter (options sendCode, previewCode) does,
 * with its own templates and provider. The plugin picks the people who did
 * not get the code before, adds them to the coupon's customer rule first
 * (so the code works for them) and records each send in the promotion's
 * metadata (code_sent).
 */
import { cleanIds, cleanMessage, codeSentOf, planSend, sendBlockers, withSent } from "../../modules/coupons/lib/code-mail"
import type { CodeMailInput, CodeMailPreviewResponse, CodeMailRecipientDto, CodeMailResponse, CodeMailSendResponse, CodeSentEntry, CouponDto } from "../../modules/coupons/lib/contract"
import type { CodeMailCoupon, CodeMailRecipient } from "../../modules/coupons/lib/options"
import { CouponInputError } from "./errors"
import { customerLabel, readPromotions, toCoupons } from "./reads"
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

function ability(scope: Scope): { send: boolean; preview: boolean } {
  const o = couponsService(scope).getOptions()
  return { send: Boolean(o.sendCode), preview: Boolean(o.sendCode && o.previewCode) }
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

/** The e-mail for the first person asked for (or the first on the coupon), rendered by the store, sent to nobody. */
export async function previewCodeMail(scope: Scope, id: string, input: Partial<CodeMailInput>): Promise<CodeMailPreviewResponse> {
  const o = couponsService(scope).getOptions()
  if (!o.previewCode) throw new CouponInputError(400, ["no_preview"], "The store renders no preview of this e-mail.")
  const message = cleanMessage(input.message)
  if (!message.ok) throw new CouponInputError(400, [message.error as string], "The instruction is empty or too long.")
  const c = await couponOf(scope, id)
  const nobody = o.nobodyCustomerId
  const first = [...cleanIds(input.customerIds), ...c.shape.customerIds.filter((x) => x !== nobody)][0] ?? null
  const row = first ? (await customersOf(scope, [first])).get(first) ?? null : null
  const recipient: CodeMailRecipient = row ? recipientOf(row) : { customerId: "", email: "", firstName: null, name: null }
  const out = await o.previewCode(scope, { promotion: mailCoupon(c), recipient, message: message.value })
  return { subject: String(out?.subject ?? ""), html: String(out?.html ?? ""), to: recipient.email || null }
}

async function actorLabel(scope: Scope, actorId: string | null): Promise<string | null> {
  if (!actorId) return null
  try {
    const { data } = await queryOf(scope).graph({ entity: "user", fields: ["id", "email"], filters: { id: actorId } })
    return str((data?.[0] as { email?: unknown } | undefined)?.email) ?? actorId
  } catch {
    return actorId
  }
}

/**
 * Sends the code to the people asked for who did not get it before. New
 * people go onto the coupon's customer rule first (only when it has one: a
 * coupon for everyone or for groups is never narrowed). Nothing is sent when
 * that change fails. Each send is recorded on the coupon.
 */
export async function sendCodeMail(scope: Scope, id: string, input: Partial<CodeMailInput>, actorId: string | null, now: Date = new Date()): Promise<CodeMailSendResponse> {
  const o = couponsService(scope).getOptions()
  const log = couponsService(scope).getLogger()
  const message = cleanMessage(input.message)
  if (!message.ok) throw new CouponInputError(400, [message.error as string], "The instruction is empty or too long.")
  const requested = cleanIds(input.customerIds)
  if (!requested.length) throw new CouponInputError(400, ["recipients"], "Pick at least one customer.")

  let c = await couponOf(scope, id)
  const blockers = sendBlockers(c, Boolean(o.sendCode))
  if (blockers.length || !o.sendCode) throw new CouponInputError(400, blockers.length ? blockers : ["no_sender"], `The code of ${c.code || id} cannot be sent now: ${blockers.join(", ")}.`)

  const plan = planSend({ requested, sent: c.codeSent ?? [], ruleIds: c.shape.customerIds, nobody: o.nobodyCustomerId })
  const rows = await customersOf(scope, plan.toSend)
  const failed: CodeMailSendResponse["failed"] = []
  const recipients: CodeMailRecipient[] = []
  for (const cid of plan.toSend) {
    const r = rows.get(cid)
    if (!r) failed.push({ customerId: cid, reason: "not_found" })
    else if (!r.email) failed.push({ customerId: cid, reason: "no_email" })
    else recipients.push(recipientOf(r))
  }
  if (!recipients.length) return { sent: [], skipped: plan.skipped, failed, addedToRule: [], recorded: true, coupon: c }

  /* The code has to work for them before they read it. */
  const sendable = new Set(recipients.map((r) => r.customerId))
  const addToRule = plan.addToRule.filter((cid) => sendable.has(cid))
  if (addToRule.length && plan.ruleAfter) {
    const ruleAfter = plan.ruleAfter.filter((cid) => !plan.addToRule.includes(cid) || sendable.has(cid))
    c = (await updateCoupon(scope, id, { customerIds: ruleAfter }, now)).coupon
  }

  const sentBy = await actorLabel(scope, actorId)
  const out = await o.sendCode(scope, { promotion: mailCoupon(c), recipients, message: message.value, sentBy })
  const sentIds = new Set((out?.sent ?? []).filter((cid) => sendable.has(cid)))
  for (const f of out?.failed ?? []) if (f && sendable.has(f.customerId) && !sentIds.has(f.customerId)) failed.push({ customerId: f.customerId, reason: String(f.reason ?? "failed") })
  for (const r of recipients) if (!sentIds.has(r.customerId) && !failed.some((f) => f.customerId === r.customerId)) failed.push({ customerId: r.customerId, reason: "failed" })

  const entries: CodeSentEntry[] = recipients.filter((r) => sentIds.has(r.customerId)).map((r) => ({ customer_id: r.customerId, email: r.email, at: now.toISOString(), by: sentBy }))
  let recorded = true
  if (entries.length) {
    try {
      const svc = promotionModule(scope)
      const [fresh] = await svc.listPromotions({ id }, { select: ["id", "metadata"], take: 1 })
      await svc.updatePromotions({ id, metadata: withSent(fresh?.metadata ?? null, entries) })
    } catch (err) {
      recorded = false
      log.error(`[coupons] The code of ${c.code} went to ${entries.length} customer(s) but the record was not saved: ${(err as Error)?.message ?? err}`)
    }
  }
  log.info(`[coupons] Code ${c.code} (${id}) e-mailed to ${entries.length}, skipped ${plan.skipped.length}, failed ${failed.length}${addToRule.length ? `, ${addToRule.length} added to the customer rule` : ""}, by ${sentBy ?? "?"}.`)
  const coupon = entries.length && recorded ? { ...c, codeSent: [...codeSentOf({ code_sent: c.codeSent ?? [] }), ...entries] } : c
  return { sent: [...sentIds], skipped: plan.skipped, failed, addedToRule: addToRule, recorded, coupon }
}
