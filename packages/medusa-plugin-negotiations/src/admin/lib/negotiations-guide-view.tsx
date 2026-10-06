import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { StatusResponse } from "../../modules/negotiations/lib/contract"
import { GuideChecklist, GuideDiagram, GuideFaq, GuideIntro, GuideSteps, References, type GuideStep, type SetupPromptSpec, type StepState } from "./negotiations-guide"
import { fmtRating, referencesFor } from "./negotiations-ui"

/*
 * The "Setup guide" view: what the rollout takes, how the parts talk, the
 * steps with their live state, the go-live checklist, troubleshooting and the
 * stores running the plugin. Every sentence comes from the i18n files; the
 * code blocks are English, like the code they go into.
 */

const INSTALL = `npm install @koda-plus/medusa-plugin-negotiations
npx medusa db:migrate`

const CONFIG = `// medusa-config.ts
plugins: [
  {
    resolve: "@koda-plus/medusa-plugin-negotiations",
    options: {
      expiryDays: 14, // 0: threads never expire on their own
      // taxInclusive: false, // negotiated prices are net (B2B)
      // defaultCurrency: "pln", // default: the store's default currency
      // customerAccept: true, // customers may accept a counter offer
      // writers: { draftOrders: true }, // allow the draft order writer, then arm it in Settings
      // references: [], // stores running the plugin, shown on this page
    },
  },
],`

const ENV = `NEGOTIATIONS_DEMO=false   # true: sample threads from your catalog, for evaluation`

const OPEN = `// Product page: "Negotiate a price" (the customer is logged in)
const res = await fetch(\`\${MEDUSA_URL}/store/negotiations\`, {
  method: "POST",
  credentials: "include", // the session cookie, or an Authorization: Bearer header
  headers: {
    "Content-Type": "application/json",
    "x-publishable-api-key": PUBLISHABLE_KEY,
  },
  body: JSON.stringify({
    variant_id: variant.id, // or product_id, or cart_id for the whole cart
    quantity: 24,
    target_price: "469.00", // per unit; leave it out to ask for an offer
    message: "24 pcs for a new branch. Can you do 469?",
  }),
})
const answer = await res.json()
if (res.status === 409 && answer.code === "already_open") {
  // show answer.negotiation_id instead: one open thread per product and customer
}
// 201: answer.negotiation, with status, prices and the first message`

const ACCOUNT = `// Account page: the customer's negotiations and one conversation
const headers = { "x-publishable-api-key": PUBLISHABLE_KEY }
const list = await fetch(\`\${MEDUSA_URL}/store/negotiations\`, { credentials: "include", headers })
const { negotiations } = await list.json()

const one = await fetch(\`\${MEDUSA_URL}/store/negotiations/\${id}\`, { credentials: "include", headers })
const { negotiation } = await one.json() // messages, can_reply, can_accept, can_decline

const post = (path: string, body: object) =>
  fetch(\`\${MEDUSA_URL}/store/negotiations/\${id}/\${path}\`, {
    method: "POST",
    credentials: "include",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

await post("messages", { message: "Could we meet at 485?", target_price: "485.00" })
if (negotiation.can_accept) await post("accept", { price: negotiation.offered_price }) // 409 offer_changed if it changed
await post("decline", { message: "Not this time" })`

const EVENTS = `// src/subscribers/negotiation-mails.ts
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

type NegotiationEvent = { id: string; ref: string; status: string; customer_id: string | null; price: string | null; currency_code: string | null; actor: string; demo: boolean }

export default async function negotiationMails({ event }: SubscriberArgs<NegotiationEvent>) {
  if (event.data.demo) return // never mail about demo threads
  // event.name: "negotiation.countered", "negotiation.accepted"...
  // event.data.price is decimal text in major units, like "469.00"
}

export const config: SubscriberConfig = {
  event: ["negotiation.opened", "negotiation.message_added", "negotiation.countered", "negotiation.accepted", "negotiation.rejected", "negotiation.expired"],
}`

const WRITER = `writers: { draftOrders: true }, // allows it; a person arms it in Settings, Writers
draftOrders: {
  // regionId: "reg_...", // default: the first region in the thread's currency
  // salesChannelId: "sc_...", // default: the store's default sales channel
  maxPerRun: 10,
},`

/** What the store owner prepares, in the order of the guide. */
const NEEDS = ["medusa", "storefront", "accounts", "team"] as const

/** The same setup as this guide (steps "install" and "options"), for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("negotiations")
  return useMemo(
    () => ({
      service: "Negotiations",
      pkg: "@koda-plus/medusa-plugin-negotiations",
      route: "/app/negotiations",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `# .env\n${ENV}\n\n${CONFIG}`,
      demo: 'demo: process.env.NEGOTIATIONS_DEMO === "true",',
    }),
    [t],
  )
}

export function GuideView({ status }: { status: StatusResponse }) {
  const { t, i18n } = useTranslation("negotiations")
  const lang = i18n.language || "en"
  const live = status.mode === "live"
  const c = status.counts
  const o = status.options
  const writer = status.writers.draftOrders
  const writerDecided = !writer.allowed || writer.updatedAt !== null
  const answered = c.counter_offered + c.accepted + c.rejected > 0

  const state = (done: boolean, otherwise: StepState = "todo"): StepState => (done ? "done" : otherwise)
  const p = (key: string, values?: Record<string, unknown>) => <p key={key}>{t(key, values)}</p>

  const steps: GuideStep[] = [
    {
      id: "install",
      title: t("guide.steps.install.title"),
      state: state(live),
      body: [p("guide.steps.install.p1"), p("guide.steps.install.p2")],
      code: `${INSTALL}\n\n${CONFIG}`,
      check: t("guide.steps.install.check"),
    },
    {
      id: "open",
      title: t("guide.steps.open.title"),
      state: state(live && c.fromStore > 0),
      body: [p("guide.steps.open.p1"), p("guide.steps.open.p2")],
      code: OPEN,
      check: t("guide.steps.open.check"),
    },
    {
      id: "account",
      title: t("guide.steps.account.title"),
      state: state(live && c.fromStore > 0, "optional"),
      body: [p("guide.steps.account.p1"), p("guide.steps.account.p2")],
      code: ACCOUNT,
      check: t("guide.steps.account.check"),
    },
    {
      id: "answer",
      title: t("guide.steps.answer.title"),
      state: state(live && answered),
      body: [p("guide.steps.answer.p1"), p("guide.steps.answer.p2")],
      check: t("guide.steps.answer.check"),
    },
    {
      id: "expiry",
      title: t("guide.steps.expiry.title"),
      state: "optional",
      body: [p("guide.steps.expiry.p1"), p("guide.steps.expiry.p2", { count: o.expiryDays })],
      code: `expiryDays: 14, // the clock restarts with every move; a counter offer may set its own validity`,
      check: t("guide.steps.expiry.check"),
    },
    {
      id: "events",
      title: t("guide.steps.events.title"),
      state: "optional",
      body: [p("guide.steps.events.p1"), p("guide.steps.events.p2")],
      code: EVENTS,
      check: t("guide.steps.events.check"),
    },
    {
      id: "writer",
      title: t("guide.steps.writer.title"),
      state: writer.armed ? "done" : "later",
      body: [p("guide.steps.writer.p1"), p("guide.steps.writer.p2")],
      code: WRITER,
      check: t("guide.steps.writer.check"),
    },
    {
      id: "live",
      title: t("guide.steps.live.title"),
      state: state(live),
      body: [p("guide.steps.live.p1"), p("guide.steps.live.p2")],
      code: `# .env\n${ENV}`,
      check: t("guide.steps.live.check"),
    },
  ]

  const checklist = [
    { label: t("guide.checklist.live"), done: live, hint: live ? undefined : t("guide.checklist.liveHint") },
    { label: t("guide.checklist.storeApi"), done: o.storeApi },
    { label: t("guide.checklist.firstThread"), done: live && c.fromStore > 0 },
    { label: t("guide.checklist.answered"), done: live && answered },
    { label: t("guide.checklist.waiting"), done: c.waiting === 0, hint: c.waiting > 0 ? t("guide.checklist.waitingHint", { count: c.waiting }) : undefined },
    { label: t("guide.checklist.expiry"), done: o.expiryDays > 0 },
    { label: t("guide.checklist.writer"), done: writerDecided },
  ]

  const faq = ["unauthorized", "notFound", "alreadyOpen", "rateLimited", "currency", "netGross", "accept", "offerChanged", "expired", "demoGone", "emails", "draftBlocked", "oldThreads"].map((k) => ({
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
          { title: t("guide.diagram.storefrontTitle"), caption: t("guide.diagram.storefront") },
          { title: `${t("title")} ${t("by")}`, caption: t("guide.diagram.plugin"), accent: true },
          { title: t("guide.diagram.adminTitle"), caption: t("guide.diagram.admin") },
          { title: t("guide.diagram.subscribersTitle"), caption: t("guide.diagram.subscribers") },
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
