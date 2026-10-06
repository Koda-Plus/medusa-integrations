import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { StatusResponse } from "../../modules/emails/lib/contract"
import { GuideChecklist, GuideDiagram, GuideFaq, GuideIntro, GuideSteps, References, type GuideStep, type SetupPromptSpec, type StepState } from "./emails-guide"
import { fmtRating, referencesFor } from "./emails-ui"

/**
 * THE SETUP GUIDE: from a Resend account to e-mails in production, with the
 * state of each step read from the module status (done, to do, optional,
 * go-live), the go-live checklist and the failures we met.
 */

const ENV = `RESEND_API_KEY=re_...        # Resend, API Keys, "Sending access"
EMAILS_FROM="Your Store <orders@mail.your-store.com>"`

const INSTALL = `npm install @koda-plus/medusa-plugin-emails
npx medusa db:migrate`

const CONFIG = `// medusa-config.ts
const emails = {
  apiKey: process.env.RESEND_API_KEY,
  from: process.env.EMAILS_FROM,
  replyTo: "support@your-store.com",
  defaultLocale: "pl", // or "en"
  timeZone: "Europe/Warsaw",
  storefrontUrl: "https://your-store.com",
  brand: { name: "Your Store", accentColor: "#26D07C" },
}

module.exports = defineConfig({
  // ...
  plugins: [{ resolve: "@koda-plus/medusa-plugin-emails", options: emails }],
  modules: [
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "@koda-plus/medusa-plugin-emails/providers/emails",
            id: "emails",
            options: { channels: ["email"], ...emails },
          },
        ],
      },
    },
  ],
})`

const DNS = `# Resend shows the exact records for your domain (Domains, your domain):
send.mail.your-store.com           MX    feedback-smtp.<region>.amazonses.com (priority 10)
send.mail.your-store.com           TXT   "v=spf1 include:amazonses.com ~all"
resend._domainkey.mail.your-store.com TXT "p=MIGfMA0GCSqGSIb3DQEB..."
# Recommended, on the main domain:
_dmarc.your-store.com              TXT   "v=DMARC1; p=none; rua=mailto:dmarc@your-store.com"`

const LINKS = `storefrontUrl: "https://your-store.com",
links: {
  order: "/{country}/account/orders/details/{order_id}",
  cart: "/{country}/cart",
  passwordReset: "/reset-password?token={token}&email={email}",
},`

const TEMPLATES = `templates: {
  "order.canceled": false,      // off for good, the admin cannot turn it on
  "cart.abandoned": true,       // optional ones start off
  "company.approved": companyApproved, // your own, see Custom templates
},`

/** What the store owner prepares, in the order of the guide. */
const NEEDS = ["resend", "domain", "dns", "medusa", "mailbox"] as const

/** The same setup as this guide (the install step), for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("emails")
  return useMemo(
    () => ({
      service: "Resend",
      pkg: "@koda-plus/medusa-plugin-emails",
      route: "/app/emails",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `# .env\n${ENV}\n\n${CONFIG}`,
      demo: 'demo: process.env.EMAILS_DEMO === "true" || !process.env.RESEND_API_KEY,',
    }),
    [t],
  )
}

export function GuideView({ status }: { status: StatusResponse }) {
  const { t, i18n } = useTranslation("emails")
  const lang = i18n.language || "en"
  const live = status.mode === "live"
  const c = status.counts
  const p = (key: string, values?: Record<string, unknown>) => <p key={key}>{t(key, values)}</p>
  const state = (done: boolean, otherwise: StepState = "todo"): StepState => (done ? "done" : otherwise)
  const optionalOn = status.templates.filter((x) => x.optional && x.enabled).length
  const switchesTouched = status.templates.some((x) => x.updatedAt)

  const steps: GuideStep[] = [
    {
      id: "account",
      title: t("guide.steps.account.title"),
      state: state(status.sender.apiKeySet),
      body: [p("guide.steps.account.p1"), p("guide.steps.account.p2")],
      link: { label: t("guide.steps.account.link"), href: "https://resend.com/signup" },
      check: t("guide.steps.account.check"),
    },
    {
      id: "domain",
      title: t("guide.steps.domain.title"),
      state: state(live && status.counts.sent30d > 0),
      body: [p("guide.steps.domain.p1"), p("guide.steps.domain.p2"), p("guide.steps.domain.p3")],
      code: DNS,
      link: { label: t("guide.steps.domain.link"), href: "https://resend.com/domains" },
      check: t("guide.steps.domain.check"),
    },
    {
      id: "key",
      title: t("guide.steps.key.title"),
      state: state(status.sender.apiKeySet),
      body: [p("guide.steps.key.p1"), p("guide.steps.key.p2")],
      code: ENV,
      link: { label: t("guide.steps.key.link"), href: "https://resend.com/api-keys" },
      check: t("guide.steps.key.check"),
    },
    {
      id: "install",
      title: t("guide.steps.install.title"),
      state: state(status.provider.loaded && status.logReady),
      body: [p("guide.steps.install.p1"), p("guide.steps.install.p2"), p("guide.steps.install.p3")],
      code: `${INSTALL}\n\n${CONFIG}`,
      check: t("guide.steps.install.check"),
    },
    {
      id: "brand",
      title: t("guide.steps.brand.title"),
      state: state(Boolean(status.brand.name)),
      body: [p("guide.steps.brand.p1"), p("guide.steps.brand.p2")],
      check: t("guide.steps.brand.check"),
    },
    {
      id: "links",
      title: t("guide.steps.links.title"),
      state: state(Boolean(status.storefrontUrl)),
      body: [p("guide.steps.links.p1"), p("guide.steps.links.p2")],
      code: LINKS,
      check: t("guide.steps.links.check"),
    },
    {
      id: "test",
      title: t("guide.steps.test.title"),
      state: state(live && c.tests30d > 0),
      body: [p("guide.steps.test.p1"), p("guide.steps.test.p2")],
      check: t("guide.steps.test.check"),
    },
    {
      id: "templates",
      title: t("guide.steps.templates.title"),
      state: switchesTouched || optionalOn > 0 ? "done" : "optional",
      body: [p("guide.steps.templates.p1"), p("guide.steps.templates.p2")],
      code: TEMPLATES,
      check: t("guide.steps.templates.check"),
    },
    {
      id: "live",
      title: t("guide.steps.live.title"),
      state: live && status.configured && c.sent30d > 0 ? "done" : "later",
      body: [p("guide.steps.live.p1"), p("guide.steps.live.p2")],
      check: t("guide.steps.live.check"),
    },
  ]

  const checklist = [
    { label: t("guide.checklist.live"), done: live, hint: live ? undefined : t("guide.checklist.liveHint") },
    { label: t("guide.checklist.provider"), done: status.provider.loaded && status.provider.sameOptions !== false },
    { label: t("guide.checklist.log"), done: status.logReady },
    { label: t("guide.checklist.from"), done: Boolean(status.sender.from) },
    { label: t("guide.checklist.replyTo"), done: status.sender.replyTo.length > 0 || Boolean(status.brand.supportEmail) },
    { label: t("guide.checklist.storefront"), done: Boolean(status.storefrontUrl) },
    { label: t("guide.checklist.timeZone"), done: status.timeZone !== "UTC" },
    { label: t("guide.checklist.test"), done: live && c.tests30d > 0 },
    { label: t("guide.checklist.attention"), done: c.attention30d === 0, hint: c.attention30d > 0 ? t("guide.checklist.attentionHint", { count: c.attention30d }) : undefined },
  ]

  const faq = ["notVerified", "ownAddress", "spam", "nothing", "twice", "reset", "quota", "unknown", "dark", "wording"].map((k) => ({
    q: t(`guide.faq.${k}.q`),
    a: [<p key="a1">{t(`guide.faq.${k}.a1`)}</p>, <p key="a2">{t(`guide.faq.${k}.a2`)}</p>],
  }))

  return (
    <div className="flex flex-col gap-y-3">
      <GuideIntro
        title={t("guide.intro.title")}
        text={t("guide.intro.text")}
        time={t("guide.intro.time")}
        timeLabel={t("guide.intro.timeLabel")}
        needsLabel={t("guide.intro.needsLabel")}
        needs={NEEDS.map((k) => t(`guide.intro.needs.${k}`))}
      />
      <GuideDiagram
        title={t("guide.diagram.title")}
        subtitle={t("guide.diagram.subtitle")}
        nodes={[
          { title: "Medusa", caption: t("guide.diagram.medusa") },
          { title: `${t("title")} ${t("by")}`, caption: t("guide.diagram.plugin"), accent: true },
          { title: "Resend", caption: t("guide.diagram.resend") },
          { title: t("guide.diagram.inboxTitle"), caption: t("guide.diagram.inbox") },
        ]}
        links={[t("guide.diagram.link1"), t("guide.diagram.link2"), t("guide.diagram.link3")]}
      />
      <GuideSteps
        title={t("guide.stepsTitle")}
        subtitle={t("guide.stepsSubtitle")}
        steps={steps}
        stateLabels={{ done: t("guide.state.done"), todo: t("guide.state.todo"), optional: t("guide.state.optional"), later: t("guide.state.later") }}
        checkLabel={t("guide.checkLabel")}
        copyLabel={t("guide.copy")}
        copiedLabel={t("guide.copied")}
      />
      <GuideChecklist title={t("guide.checklist.title")} subtitle={t("guide.checklist.subtitle")} items={checklist} />
      <GuideFaq title={t("guide.faq.title")} items={faq} />
      <References
        items={referencesFor(status.references, lang)}
        title={t("references.title")}
        subtitle={t("references.subtitle")}
        openLabel={t("references.open")}
        soonLabel={t("references.soon")}
        reviewLabel={t("references.review")}
        ratingLabel={(value) => fmtRating(value, lang)}
      />
    </div>
  )
}
