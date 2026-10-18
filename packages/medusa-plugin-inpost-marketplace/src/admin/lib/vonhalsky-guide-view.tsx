import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { InlineTip } from "@medusajs/ui"
import type { StatusResponse } from "../../modules/vonhalsky/lib/contract"
import { GuideChecklist, GuideDiagram, GuideFaq, GuideIntro, GuideSteps, type GuideStep, type SetupPromptSpec, type StepState } from "./vonhalsky-guide"

/*
 * The "Setup guide" view: what the rollout takes, how the parts talk, the
 * steps with their live state, the go-live checklist and troubleshooting.
 * Every sentence comes from the i18n files.
 */

const NEEDS = ["agreement", "credentials", "catalog", "gpsr", "shipping"] as const
const FAQ_KEYS = ["pending", "blocked", "ean", "price", "held", "demo"] as const
const API_PORTAL = "https://inpsa-api-portal.inpost-group.com/"

const ENV = `# .env
VONHALSKY_DEMO=true                     # a simulation, nothing leaves the server
VONHALSKY_ENV=sandbox                   # sandbox or live
VONHALSKY_SANDBOX_API_URL=...           # from InPost, under the integrator agreement
VONHALSKY_SANDBOX_ORGANIZATION_ID=...
VONHALSKY_SANDBOX_TOKEN=...
VONHALSKY_LIVE_API_URL=...
VONHALSKY_LIVE_ORGANIZATION_ID=...
VONHALSKY_LIVE_TOKEN=...
VONHALSKY_MARKUP_PERCENT=10             # the channel markup, the admin setting wins`

const CONFIG = `// medusa-config.ts
module.exports = defineConfig({
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-inpost-marketplace",
      options: {
        demo: process.env.VONHALSKY_DEMO === "true",
        environment: process.env.VONHALSKY_ENV,
        sandbox: {
          apiUrl: process.env.VONHALSKY_SANDBOX_API_URL,
          organizationId: process.env.VONHALSKY_SANDBOX_ORGANIZATION_ID,
          accessToken: process.env.VONHALSKY_SANDBOX_TOKEN,
        },
        live: {
          apiUrl: process.env.VONHALSKY_LIVE_API_URL,
          organizationId: process.env.VONHALSKY_LIVE_ORGANIZATION_ID,
          accessToken: process.env.VONHALSKY_LIVE_TOKEN,
        },
        markupPercent: process.env.VONHALSKY_MARKUP_PERCENT,
        // sendTracking: true,   // writer: tracking numbers back to the marketplace
        // brandKey: "brand", mpnKey: "mpn",
      },
    },
  ],
})`

/** The same setup as this guide, for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("vonhalsky")
  return useMemo(
    () => ({
      service: "InPost Von Halsky",
      pkg: "@koda-plus/medusa-plugin-inpost-marketplace",
      route: "/app/vonhalsky",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `${ENV}\n\n${CONFIG}`,
      demo: 'demo: process.env.VONHALSKY_DEMO === "true",',
    }),
    [t],
  )
}

export function GuideView({ status: s }: { status: StatusResponse }) {
  const { t } = useTranslation("vonhalsky")
  const demo = s.mode === "demo"
  const real = s.mode === "live" || s.mode === "sandbox"
  const p = (key: string, options?: Record<string, unknown>) => <p>{t(key, options)}</p>
  const state = (done: boolean, otherwise: StepState = "todo"): StepState => (done ? "done" : otherwise)
  const mapped = Boolean(s.settings.shipping.APM && s.settings.shipping.COURIER)
  const keys = { brandKey: s.options.brandKey, mpnKey: s.options.mpnKey }

  const steps: GuideStep[] = [
    {
      id: "agreement",
      title: t("guide.step.agreement.title"),
      state: state(real, demo ? "optional" : "todo"),
      body: (
        <>
          {p("guide.step.agreement.body1")}
          {p("guide.step.agreement.body2")}
        </>
      ),
      link: { label: t("guide.step.agreement.link"), href: API_PORTAL },
      check: t("guide.step.agreement.check"),
    },
    {
      id: "install",
      title: t("guide.step.install.title"),
      state: state(s.configured),
      body: (
        <>
          {p("guide.step.install.body1")}
          {p("guide.step.install.body2")}
        </>
      ),
      code: `npm install @koda-plus/medusa-plugin-inpost-marketplace\n\n${ENV}\n\n${CONFIG}\n\nnpx medusa db:migrate`,
      check: t("guide.step.install.check"),
    },
    {
      id: "catalog",
      title: t("guide.step.catalog.title"),
      state: state(s.counts.offers > 0 && s.counts.draft + s.counts.listed > 0),
      body: (
        <>
          {p("guide.step.catalog.body1", keys)}
          {p("guide.step.catalog.body2")}
        </>
      ),
      check: t("guide.step.catalog.check"),
    },
    {
      id: "pricing",
      title: t("guide.step.pricing.title"),
      state: state(s.settings.pricing.markupPercent !== 0, "optional"),
      body: p("guide.step.pricing.body"),
      check: t("guide.step.pricing.check"),
    },
    {
      id: "shipping",
      title: t("guide.step.shipping.title"),
      state: state(mapped, demo ? "optional" : "todo"),
      body: p("guide.step.shipping.body"),
      check: t("guide.step.shipping.check"),
    },
    {
      id: "list",
      title: t("guide.step.list.title"),
      state: state(s.counts.listed > 0),
      body: p("guide.step.list.body"),
      check: t("guide.step.list.check"),
    },
    {
      id: "orders",
      title: t("guide.step.orders.title"),
      state: state(s.counts.orders > 0, "later"),
      body: p("guide.step.orders.body"),
      check: t("guide.step.orders.check"),
    },
    {
      id: "tracking",
      title: t("guide.step.tracking.title"),
      state: state(s.counts.tracking_sent > 0, s.options.sendTracking || demo ? "later" : "optional"),
      body: p("guide.step.tracking.body"),
      code: "sendTracking: true,",
      check: t("guide.step.tracking.check"),
    },
    {
      id: "live",
      title: t("guide.step.live.title"),
      state: state(s.mode === "live", "later"),
      body: p("guide.step.live.body"),
      code: "VONHALSKY_ENV=live",
    },
  ]

  const checklist = [
    { label: t("guide.checklist.credentials"), done: real },
    { label: t("guide.checklist.gpsr"), done: s.counts.offers > 0 && s.counts.blocked < s.counts.offers },
    { label: t("guide.checklist.shipping"), done: mapped },
    { label: t("guide.checklist.channel"), done: Boolean(s.target.salesChannel && s.target.region) },
    { label: t("guide.checklist.listed"), done: s.counts.listed > 0 },
    { label: t("guide.checklist.firstOrder"), done: s.counts.orders > 0 },
    { label: t("guide.checklist.tracking"), done: s.options.sendTracking },
  ]

  return (
    <div className="flex flex-col gap-y-3">
      {demo ? (
        <InlineTip variant="info" label={t("demo.label")}>
          {t("guide.demoNote")}
        </InlineTip>
      ) : null}
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
          { title: t("guide.diagram.catalog"), caption: t("guide.diagram.catalogCaption") },
          { title: t("guide.diagram.plugin"), caption: t("guide.diagram.pluginCaption"), accent: true },
          { title: t("guide.diagram.marketplace"), caption: t("guide.diagram.marketplaceCaption") },
          { title: t("guide.diagram.medusa"), caption: t("guide.diagram.medusaCaption") },
        ]}
        links={[t("guide.diagram.link1"), t("guide.diagram.link2"), t("guide.diagram.link3")]}
      />
      <GuideSteps
        title={t("guide.stepsTitle")}
        subtitle={t("guide.stepsSubtitle")}
        steps={steps}
        stateLabels={{ done: t("guide.stateLabels.done"), todo: t("guide.stateLabels.todo"), optional: t("guide.stateLabels.optional"), later: t("guide.stateLabels.later") }}
        checkLabel={t("guide.checkLabel")}
        copyLabel={t("guide.copy")}
        copiedLabel={t("guide.copied")}
      />
      <GuideChecklist title={t("guide.checklist.title")} subtitle={t("guide.checklist.subtitle")} items={checklist} />
      <GuideFaq title={t("guide.faqTitle")} items={FAQ_KEYS.map((k) => ({ q: t(`guide.faq.${k}.q`), a: <p>{t(`guide.faq.${k}.a`)}</p> }))} />
    </div>
  )
}
