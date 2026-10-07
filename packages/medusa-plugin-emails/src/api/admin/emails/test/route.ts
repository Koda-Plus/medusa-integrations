import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TEST_LIMIT_PER_HOUR, TEST_LIMIT_PER_USER, TEST_WINDOW_MS } from "../../../../modules/emails/lib/constants"
import type { PreviewSource, TestRequest, TestResponse } from "../../../../modules/emails/lib/contract"
import { testKey } from "../../../../modules/emails/lib/keys"
import { normalizeLocale } from "../../../../modules/emails/lib/locale"
import { sharedLimiter } from "../../../../modules/emails/lib/rate-limit"
import { resolveTemplate } from "../../../../modules/emails/lib/registry"
import { isEmail, maskEmail } from "../../../../modules/emails/lib/security"
import { previewData } from "../../../../workflows/emails/preview"
import { storeFor } from "../../../../workflows/emails/runtime"
import { sendTemplate } from "../../../../workflows/emails/send-template"
import { actorOf, emailsService } from "../helpers"

/**
 * POST /admin/emails/test  { template, to, locale?, source? }
 *
 * Sends one template to one address the admin typed, through the same path
 * as every e-mail (the notification module, the provider, the send log), so
 * it also proves the wiring. The data is the sample, or the store's newest
 * order with the person replaced by the sample one: a test never carries a
 * customer's details. The subject starts with "[Test]".
 *
 *   demo mode   the message lands in the simulated outbox, nothing leaves
 *   no API key  the message is logged, not sent
 *   live        Resend sends it
 *
 * At most 5 tests per person in 10 minutes and 30 per hour for the store.
 * A test goes out even when its template is turned off, to check it first.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = emailsService(req.scope)
  const o = svc.getOptions()
  const input = (req.body ?? {}) as Partial<TestRequest>
  const template = resolveTemplate(String(input.template ?? ""), o)
  if (!template) {
    res.status(404).json({ message: "Choose one of the templates." })
    return
  }
  const to = String(input.to ?? "").trim()
  if (!isEmail(to)) {
    res.status(400).json({ message: "Type one valid e-mail address." })
    return
  }
  const actor = actorOf(req) ?? "unknown"
  const perUser = sharedLimiter("test:user", TEST_LIMIT_PER_USER, TEST_WINDOW_MS).hit(actor)
  if (!perUser.ok) {
    res.setHeader("Retry-After", String(perUser.retryAfterSeconds))
    res.status(429).json({ message: `Too many test e-mails: at most ${TEST_LIMIT_PER_USER} in ${Math.round(TEST_WINDOW_MS / 60000)} minutes. Try again in ${perUser.retryAfterSeconds} s.` })
    return
  }
  const perStore = sharedLimiter("test:store", TEST_LIMIT_PER_HOUR, 60 * 60 * 1000).hit("store")
  if (!perStore.ok) {
    res.setHeader("Retry-After", String(perStore.retryAfterSeconds))
    res.status(429).json({ message: `Too many test e-mails from this store: at most ${TEST_LIMIT_PER_HOUR} an hour. Try again in ${perStore.retryAfterSeconds} s.` })
    return
  }
  /* The same limits counted in the send log, so a restart or a second instance does not reset them. The memory is the first line. */
  try {
    const now = Date.now()
    const logged = await storeFor(req.scope).testCounts(svc.isDemo(), actor, new Date(now - TEST_WINDOW_MS), new Date(now - 60 * 60 * 1000))
    if (logged.mine >= TEST_LIMIT_PER_USER || logged.all >= TEST_LIMIT_PER_HOUR) {
      res.setHeader("Retry-After", "60")
      res.status(429).json({
        message:
          logged.mine >= TEST_LIMIT_PER_USER
            ? `Too many test e-mails: at most ${TEST_LIMIT_PER_USER} in ${Math.round(TEST_WINDOW_MS / 60000)} minutes.`
            : `Too many test e-mails from this store: at most ${TEST_LIMIT_PER_HOUR} an hour.`,
      })
      return
    }
  } catch {
    /* no log yet: the limits in memory stand */
  }
  const locale = normalizeLocale(input.locale) ?? o.defaultLocale
  const source: PreviewSource = input.source === "latest" ? "latest" : "sample"
  const prepared = await previewData(req.scope, template, locale, source)
  const outcome = await sendTemplate(req.scope, {
    template: template.key,
    to,
    data: { ...prepared.data, locale },
    key: testKey(),
    trigger: "test",
    kind: "test",
    requestedBy: actorOf(req),
    ignoreSwitch: true,
  })
  svc.getLogger().info(`[emails] Test of ${template.key} to ${maskEmail(to)} by ${actor}: ${outcome.status}`)
  if (outcome.status === "failed") {
    res.status(502).json({ message: outcome.error })
    return
  }
  if (outcome.status === "skipped") {
    res.status(409).json({ message: `The test was not sent: ${outcome.reason}.` })
    return
  }
  if (outcome.status !== "queued") {
    res.status(409).json({ message: "The provider of this plugin is not registered: register it in Medusa's notification module (see the Setup guide)." })
    return
  }
  const notification = outcome.notification ?? {}
  const body: TestResponse = {
    outcome: o.mode === "demo" ? "simulated" : o.mode === "dev" ? "logged" : "sent",
    id: typeof notification.external_id === "string" ? notification.external_id : null,
    to: maskEmail(to),
    template: template.key,
  }
  res.json(body)
}
