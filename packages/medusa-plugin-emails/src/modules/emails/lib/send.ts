/**
 * DELIVERY OF ONE NOTIFICATION, as the provider does it. No Medusa imports:
 * the store, the settings, the Resend client and the logger are injected, so
 * the tests drive the whole path without a database or a network.
 *
 *   1. The key: `provider_data.emails.key`, else the notification's
 *      `idempotency_key`, else one per Medusa notification.
 *   2. The template: the registry (options, code, built-in), or finished
 *      `content`; its switch (a test send ignores it); the render.
 *   3. The mode:
 *        dev   no API key: logged and recorded as "not sent", never sent;
 *        demo  the simulated outbox: recorded with the rendered message,
 *              nothing leaves the server;
 *        live  claim the key, send through Resend with the key as
 *              Idempotency-Key, record the answer.
 *   4. A key that already went out answers with the first e-mail id and
 *      sends nothing. A key whose earlier attempt failed is not sent again
 *      by itself: a person retries it from the admin, with the Resend key
 *      rotated.
 *
 * Addresses are masked and secrets removed from everything that is logged
 * or stored. The fields a template marks `sensitive` (the password reset
 * link) reach only the message itself: the simulated outbox keeps them
 * hidden, and the plugin's own flows hand such messages to `deliver`
 * directly instead of through Medusa's notification table.
 */

import { randomUUID } from "node:crypto"
import { LEASE_MS, MAX_RETRY_WAIT_MS, MAX_STORED_BODY_CHARS, type EmailLocale } from "./constants"
import { cleanText } from "./html"
import { addressHash, cleanKey, customerIdOf, entityRef, notificationKey, resendKey, sha256 } from "./keys"
import type { ResolvedEmailsOptions } from "./options"
import { resolveTemplate, sensitiveFields } from "./registry"
import { messageLocale, renderContent, renderTemplate, type RenderedEmail } from "./render"
import type { ResendClient, ResendPayload, ResendResult } from "./resend"
import { addressList, isEmail, maskAll, maskEmail, parseSender, redactData } from "./security"
import { applyBrandOverrides, SettingsUnavailableError, templateState, type EffectiveSettings } from "./settings"
import { isMissingTable, type MessageKind, type MessagePatch, type MessageRow, type MessageStore, type NewMessage } from "./store"
import { COPY } from "./templates/copy"

export interface LoggerLike {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** The fields of a Medusa notification the provider reads (Medusa passes the whole row). */
export interface IncomingNotification {
  id?: string | null
  to: string
  from?: string | null
  channel?: string | null
  template?: string | null
  data?: Record<string, unknown> | null
  provider_data?: Record<string, unknown> | null
  content?: { subject?: string; html?: string; text?: string } | null
  attachments?: Array<{ content: string; filename: string; content_type?: string }> | null
  idempotency_key?: string | null
  trigger_type?: string | null
  resource_type?: string | null
  resource_id?: string | null
  /** Who the message is for in Medusa; a customer id (`cus_...`) is kept with the row. */
  receiver_id?: string | null
}

/** What this plugin's own callers put in `provider_data.emails`. */
export interface EmailsMeta {
  key?: string
  kind?: MessageKind
  requestedBy?: string | null
  /** A person's retry from the admin: take over the failed row, rotate the Resend key. */
  retry?: boolean
  orderId?: string | null
  /** The Medusa customer (`cus_...`) the message is about, for the customer's page. */
  customerId?: string | null
  /** At most this many messages of the template to one address in an hour (password resets). */
  limitPerHour?: number
}

export interface DeliverDeps {
  options: ResolvedEmailsOptions
  store: MessageStore | null
  loadSettings: () => Promise<EffectiveSettings>
  client: () => ResendClient
  logger: LoggerLike
  now?: () => Date
  newToken?: () => string
}

export class DeliveryError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "DeliveryError"
    this.code = code
  }
}

export interface DeliveryResult {
  id?: string
  /** What happened, for the callers of this plugin (the admin test send). */
  outcome: "sent" | "simulated" | "logged" | "skipped" | "duplicate"
  key: string
  /** Why it was skipped: `TEMPLATE_OFF`, `THROTTLED`. */
  code?: string
}

const MISSING_TABLE_WARNED = Symbol.for("koda.emails.missingTableWarned")

export function readMeta(providerData: unknown): EmailsMeta {
  const raw = providerData && typeof providerData === "object" ? (providerData as Record<string, unknown>).emails : null
  if (!raw || typeof raw !== "object") return {}
  const m = raw as Record<string, unknown>
  const kinds: MessageKind[] = ["event", "job", "test", "app", "seed"]
  return {
    key: typeof m.key === "string" ? m.key : undefined,
    kind: kinds.includes(m.kind as MessageKind) ? (m.kind as MessageKind) : undefined,
    requestedBy: typeof m.requestedBy === "string" ? m.requestedBy : null,
    retry: m.retry === true,
    orderId: typeof m.orderId === "string" ? m.orderId : null,
    customerId: customerIdOf(m.customerId),
    limitPerHour: typeof m.limitPerHour === "number" && Number.isInteger(m.limitPerHour) && m.limitPerHour > 0 ? Math.min(m.limitPerHour, 1000) : undefined,
  }
}

/** A Resend tag value: letters, digits, underscores and dashes. */
export function tagValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) || "none"
}

function attachmentsOf(list: IncomingNotification["attachments"]): ResendPayload["attachments"] | DeliveryError {
  if (!Array.isArray(list) || list.length === 0) return undefined
  if (list.length > 10) return new DeliveryError("ATTACHMENT_INVALID", "At most 10 attachments per message.")
  let size = 0
  const out: NonNullable<ResendPayload["attachments"]> = []
  for (const a of list) {
    const filename = cleanText(a?.filename, 200).replace(/[\\/]/g, "_")
    if (!filename || typeof a?.content !== "string" || !a.content) return new DeliveryError("ATTACHMENT_INVALID", "Every attachment needs a filename and its content (base64).")
    size += a.content.length
    out.push({ filename, content: a.content, ...(typeof a.content_type === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(a.content_type) ? { content_type: a.content_type } : {}) })
  }
  if (size > 30 * 1024 * 1024) return new DeliveryError("ATTACHMENT_INVALID", "Attachments above 30 MB in total are not sent.")
  return out
}

/** The request body for Resend. Built once per attempt series, so every retry sends the same payload. */
export function buildPayload(o: ResolvedEmailsOptions, n: IncomingNotification, rendered: RenderedEmail, key: string, to: string): ResendPayload | DeliveryError {
  const sender = o.sender as NonNullable<ResolvedEmailsOptions["sender"]>
  const asked = parseSender(n.from)
  const from = asked && asked.domain === sender.domain ? asked.value : sender.value
  const pd = (n.provider_data && typeof n.provider_data === "object" ? n.provider_data : {}) as Record<string, unknown>
  const replyTo = addressList(pd.reply_to, 5)
  const cc = addressList(pd.cc, 10)
  const bcc = addressList(pd.bcc, 10)
  const attachments = attachmentsOf(n.attachments)
  if (attachments instanceof DeliveryError) return attachments
  return {
    from,
    to: [to],
    subject: rendered.subject,
    ...(rendered.html ? { html: rendered.html } : {}),
    text: rendered.text,
    ...(replyTo.length ? { reply_to: replyTo } : o.replyTo.length ? { reply_to: o.replyTo } : {}),
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
    headers: { "X-Entity-Ref-ID": entityRef(key) },
    tags: [
      { name: "template", value: tagValue(rendered.template) },
      { name: "source", value: "medusa" },
    ],
    ...(attachments ? { attachments } : {}),
  }
}

function warnMissingTable(logger: LoggerLike): void {
  const holder = globalThis as typeof globalThis & { [MISSING_TABLE_WARNED]?: boolean }
  if (holder[MISSING_TABLE_WARNED]) return
  holder[MISSING_TABLE_WARNED] = true
  logger.warn("[emails] The send log table is missing (run npx medusa db:migrate). Messages are still sent, protected by Resend's idempotency key, but not logged.")
}

/**
 * How long a claim holds its row: every try the options allow (the timeout
 * of each request and the longest wait between two), plus a minute, and
 * never less than `LEASE_MS`. Housekeeping turns a row past its lease into
 * `unknown`; a lease shorter than a slow send would do that mid-send.
 */
export function leaseMs(o: Pick<ResolvedEmailsOptions, "timeoutMs" | "maxRetries">): number {
  return Math.max(LEASE_MS, (o.maxRetries + 1) * (o.timeoutMs + MAX_RETRY_WAIT_MS) + 60_000)
}

/** Errors of Resend that refuse the recipient's address: logged as `INVALID_RECIPIENT`, counted as refused addresses. */
function refusesAddress(f: { code: string; status: number | null; message: string }): boolean {
  if (f.status !== 400 && f.status !== 422) return false
  if (!["validation_error", "invalid_parameter", "invalid_to_address"].includes(f.code)) return false
  return /`to`|"to"|\bto field\b|invalid_to/i.test(f.message)
}

export async function deliver(deps: DeliverDeps, n: IncomingNotification): Promise<DeliveryResult> {
  const o = deps.options
  const now = deps.now ?? (() => new Date())
  const newToken = deps.newToken ?? (() => randomUUID())
  const mask = (text: unknown) => maskAll(text, [o.apiKey])
  const meta = readMeta(n.provider_data)
  const to = String(n.to ?? "").trim()
  const key = cleanKey(meta.key) ?? cleanKey(n.idempotency_key) ?? notificationKey(n.id ?? null)
  const kind: MessageKind = meta.kind ?? (typeof n.idempotency_key === "string" && n.idempotency_key.startsWith("emails:") ? "event" : "app")
  const data = (n.data && typeof n.data === "object" ? n.data : {}) as Record<string, unknown>
  const templateKey = cleanText(n.template, 64) || "content"
  /* The store of the log; the one given, even after a failed claim, to write the outcome afterwards. */
  const givenStore = deps.store
  let store = deps.store

  const base: NewMessage = {
    key,
    template: templateKey,
    locale: null,
    demo: o.demo,
    kind,
    recipient: isEmail(to) ? maskEmail(to) : null,
    subject: null,
    trigger: cleanText(n.trigger_type, 80) || null,
    resource_type: cleanText(n.resource_type, 40) || null,
    resource_id: cleanText(n.resource_id, 80) || null,
    order_id: meta.orderId ?? (n.resource_type === "order" ? cleanText(n.resource_id, 80) || null : null),
    notification_id: cleanText(n.id, 80) || null,
    requested_by: meta.requestedBy ?? null,
    customer_id: meta.customerId ?? customerIdOf(n.receiver_id),
    recipient_hash: isEmail(to) ? addressHash(to) : null,
  }

  /** Writes a finished row; a missing table never stops the caller. */
  const record = async (status: "sent" | "failed" | "unknown" | "skipped", patch: MessagePatch, into: MessageStore | null = store): Promise<MessageRow | null> => {
    if (!into) return null
    try {
      return await into.record({ ...base, ...patch, status })
    } catch (err) {
      if (isMissingTable(err)) {
        warnMissingTable(deps.logger)
        if (into === store) store = null
        return null
      }
      deps.logger.warn(`[emails] Could not write the send log for ${key}: ${mask((err as Error)?.message ?? err)}`)
      return null
    }
  }
  const fail = async (code: string, message: string, opts: { status?: "failed" | "skipped"; retryable?: boolean } = {}): Promise<never> => {
    const masked = mask(message).slice(0, 1000)
    if (!meta.retry) await record(opts.status ?? "failed", { error_code: code, error: masked, retryable: opts.retryable ?? false })
    deps.logger.warn(`[emails] ${templateKey} to ${base.recipient ?? "***"} not sent: ${code}: ${masked}`)
    throw new DeliveryError(code, masked)
  }

  if (!isEmail(to)) return fail("INVALID_RECIPIENT", "The recipient is not an e-mail address.")

  /* The switches: when they cannot be read, nothing goes out (a template a person switched off must stay off). */
  let settings: EffectiveSettings
  try {
    settings = await deps.loadSettings()
  } catch (err) {
    if (err instanceof SettingsUnavailableError) return fail(err.code, err.message, { retryable: true })
    throw err
  }

  /* The template, or finished content */
  const locale: EmailLocale = messageLocale(null, data, o.defaultLocale)
  const resolved = n.template ? resolveTemplate(templateKey, o) : null
  const secrets = resolved ? sensitiveFields(resolved) : []
  const renderInput = {
    locale,
    options: o,
    brand: applyBrandOverrides(o.brand, settings.brand),
    subjectPrefix: kind === "test" ? COPY[locale].testPrefix : "",
  }
  let rendered: RenderedEmail
  if (resolved) {
    if (kind !== "test") {
      const state = templateState(resolved.key, resolved.def.enabledByDefault !== false, o, settings)
      if (!state.enabled) {
        if (meta.retry) throw new DeliveryError("TEMPLATE_OFF", `The template ${resolved.key} is turned off.`)
        await record("skipped", { error_code: "TEMPLATE_OFF", error: `The template ${resolved.key} is turned off.`, retryable: false })
        deps.logger.info(`[emails] ${resolved.key} to ${base.recipient}: skipped, the template is turned off.`)
        return { outcome: "skipped", key, code: "TEMPLATE_OFF" }
      }
    }
    try {
      rendered = renderTemplate(resolved, data, renderInput)
    } catch (err) {
      return fail("RENDER_ERROR", (err as Error)?.message ?? String(err))
    }
  } else {
    const content = renderContent(templateKey, n.content ?? {}, locale)
    if (!content) return fail("UNKNOWN_TEMPLATE", `No template "${templateKey}" is registered and the notification has no content to send.`)
    rendered = content
  }
  base.subject = rendered.subject.slice(0, 300)
  base.locale = rendered.locale

  /* dev: no API key, nothing is sent */
  if (o.mode === "dev") {
    await record("skipped", { error_code: "NO_API_KEY", error: "No Resend API key: the message was logged, not sent.", retryable: true })
    deps.logger.info(`[emails] dev mode, not sent: ${rendered.template} to ${base.recipient}: "${mask(rendered.subject)}"`)
    return { outcome: "logged", key }
  }
  if (o.mode === "live" && !o.sender) return fail("MISSING_FROM", "The from option is missing or not an e-mail address.")

  /* Claim the key (within the limit per address, when the caller set one) */
  const token = newToken()
  const leaseUntil = new Date(now().getTime() + leaseMs(o))
  let row: MessageRow | null = null
  let claimFailed = false
  if (store) {
    try {
      if (meta.retry) {
        row = await store.claimRetry(key, o.demo, { token, leaseUntil, notificationId: base.notification_id, requestedBy: base.requested_by })
      } else if (meta.limitPerHour) {
        const claimed = await store.claimLimited(base, { token, leaseUntil, resendKey: resendKey(key, 0) }, { max: meta.limitPerHour, since: new Date(now().getTime() - 3600 * 1000) })
        if (claimed.throttled) {
          const why = `At most ${meta.limitPerHour} ${templateKey} e-mails to one address in an hour; this one was not sent.`
          await record("skipped", { error_code: "THROTTLED", error: why, retryable: false })
          deps.logger.warn(`[emails] ${templateKey} to ${base.recipient}: skipped, ${why}`)
          return { outcome: "skipped", key, code: "THROTTLED" }
        }
        row = claimed.row
      } else {
        row = await store.claimNew(base, { token, leaseUntil, resendKey: resendKey(key, 0) })
      }
    } catch (err) {
      if (isMissingTable(err)) {
        warnMissingTable(deps.logger)
      } else {
        claimFailed = true
        deps.logger.error(`[emails] Could not claim ${key} in the send log, sending under Resend's idempotency key only: ${mask((err as Error)?.message ?? err)}`)
      }
      store = null
    }
    if (store && !row) {
      const existing = await store.find(key, o.demo).catch(() => null)
      if (existing?.status === "sent") {
        deps.logger.info(`[emails] ${rendered.template} to ${base.recipient}: already sent under ${key}, not sent again.`)
        return { id: existing.external_id ?? undefined, outcome: "duplicate", key }
      }
      if (existing?.status === "sending") {
        deps.logger.info(`[emails] ${rendered.template} to ${base.recipient}: being sent by another process under ${key}.`)
        return { outcome: "duplicate", key }
      }
      throw new DeliveryError(
        "NOT_RETRIED",
        meta.retry
          ? `The message ${key} cannot be retried now (${existing?.status ?? "missing"}).`
          : `Not sent again: an earlier attempt of ${key} ended ${existing?.status ?? "unknown"}${existing?.error_code ? ` (${existing.error_code})` : ""}. Retry it from the admin.`,
      )
    }
  }

  /** The outcome on the claimed row; after a failed claim, a new row with it (the log still tells what went out). */
  const finish = async (patch: MessagePatch & { status: "sent" | "failed" | "unknown" }): Promise<void> => {
    if (claimFailed && !meta.retry) {
      const written = await record(patch.status, patch, givenStore)
      if (!written) deps.logger.error(`[emails] The outcome of ${key} (${patch.status}) could not be written to the send log.`)
      return
    }
    if (!store || !row) return
    try {
      const done = await store.finish(row.id, token, patch)
      if (!done) deps.logger.error(`[emails] The outcome of ${key} (${patch.status}) was not written: its claim was taken over (the lease ran out). See the E-mails page.`)
    } catch (err) {
      deps.logger.error(`[emails] Could not record the result of ${key}: ${mask((err as Error)?.message ?? err)}`)
    }
  }

  /* demo: the simulated outbox, with secret fields hidden */
  if (o.demo) {
    let kept = rendered
    if (resolved && secrets.length > 0) {
      try {
        kept = renderTemplate(resolved, redactData(data, secrets), renderInput)
      } catch {
        kept = { ...rendered, html: "", text: "" }
      }
    }
    const id = `demo_${sha256(`${key}#${row?.rotation ?? 0}`).slice(0, 20)}`
    await finish({
      status: "sent",
      external_id: id,
      sent_at: now(),
      subject: base.subject,
      locale: base.locale,
      error_code: null,
      error: null,
      body_html: kept.html && kept.html.length <= MAX_STORED_BODY_CHARS ? kept.html : null,
      body_text: kept.text && kept.text.length <= MAX_STORED_BODY_CHARS ? kept.text : null,
    })
    deps.logger.info(`[emails] demo mode, simulated: ${rendered.template} to ${base.recipient}`)
    return { id, outcome: "simulated", key }
  }

  /* live: Resend */
  const payload = buildPayload(o, n, rendered, key, to)
  if (payload instanceof DeliveryError) {
    await finish({ status: "failed", error_code: payload.code, error: payload.message, retryable: false })
    throw payload
  }
  const rkey = row?.resend_key ?? resendKey(key, 0)
  let result: ResendResult
  try {
    result = await deps.client().send(payload, rkey)
  } catch (err) {
    result = { ok: false, attempts: 1, error: { code: "CLIENT_ERROR", status: null, message: (err as Error)?.message ?? String(err), temporary: true, maybeSent: true } }
  }
  if (result.ok) {
    await finish({ status: "sent", external_id: result.id, sent_at: now(), subject: base.subject, locale: base.locale, error_code: null, error: null, retryable: false })
    deps.logger.info(`[emails] ${rendered.template} to ${base.recipient}: sent (${result.id})`)
    return { id: result.id, outcome: "sent", key }
  }
  const f = result.error
  const message = mask(f.message).slice(0, 1000)
  const status = f.maybeSent ? "unknown" : "failed"
  const code = !f.maybeSent && refusesAddress(f) ? "INVALID_RECIPIENT" : f.code
  await finish({ status, error_code: code, error: code === f.code ? message : `${f.code}: ${message}`, retryable: f.temporary })
  deps.logger.warn(`[emails] ${rendered.template} to ${base.recipient}: ${status} after ${result.attempts} ${result.attempts === 1 ? "try" : "tries"}: ${f.code}: ${message}`)
  throw new DeliveryError(code, `${f.code}: ${message}`)
}
