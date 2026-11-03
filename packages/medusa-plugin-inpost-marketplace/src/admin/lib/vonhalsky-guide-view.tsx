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

const NEEDS = ["account", "credentials", "catalog", "gpsr", "shipping", "shipx"] as const
const FAQ_KEYS = ["check", "pending", "blocked", "category", "ean", "price", "held", "tracking", "demo"] as const
const API_PORTAL = "https://inpsa-api-portal.inpost-group.com/"

const ENV = `# .env
VONHALSKY_DEMO=false                          # true: a simulation, nothing leaves the server
VONHALSKY_ENV=sandbox                         # sandbox or live
VONHALSKY_SANDBOX_CLIENT_ID=...               # Merchant Portal: Integrations, API, Create App
VONHALSKY_SANDBOX_CLIENT_SECRET=...           # shown once, when the app is created
VONHALSKY_SANDBOX_ORGANIZATION_ID=...
VONHALSKY_LIVE_CLIENT_ID=...
VONHALSKY_LIVE_CLIENT_SECRET=...
VONHALSKY_LIVE_ORGANIZATION_ID=...
VONHALSKY_MARKUP_PERCENT=10                   # the channel markup, the admin setting wins`

const CONFIG = `// medusa-config.ts
module.exports = defineConfig({
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-inpost-marketplace",
      options: {
        demo: process.env.VONHALSKY_DEMO === "true",
        environment: process.env.VONHALSKY_ENV,
        sandbox: {
          clientId: process.env.VONHALSKY_SANDBOX_CLIENT_ID,
          clientSecret: process.env.VONHALSKY_SANDBOX_CLIENT_SECRET,
          organizationId: process.env.VONHALSKY_SANDBOX_ORGANIZATION_ID,
        },
        live: {
          clientId: process.env.VONHALSKY_LIVE_CLIENT_ID,
          clientSecret: process.env.VONHALSKY_LIVE_CLIENT_SECRET,
          organizationId: process.env.VONHALSKY_LIVE_ORGANIZATION_ID,
        },
        markupPercent: process.env.VONHALSKY_MARKUP_PERCENT,
        // apiUrl and tokenUrl (inside sandbox or live): InPost's addresses by default
        // daysToShip: 2, syncPriceStock: true,   // the admin settings win
        // dimensionUnit: "mm", weightUnit: "g",   // the units of Medusa's variants
        // brandKey: "brand", mpnKey: "mpn", eanKey: "ean", vatKey: "vat_rate",
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
  /* A rate limit is kept after the first answer of the seller API: the credentials worked at least once. */
  const connected = real && s.limits !== null
  const categoriesMapped = Object.keys(s.settings.categories).length > 0
  const defaults = s.settings.offerDefaults
  const shipped = s.counts.orders > 0 && s.counts.awaiting_shipment === 0 && s.counts.tracking_waiting === 0

  const steps: GuideStep[] = [
    {
      id: "credentials",
      title: t("guide.step.credentials.title"),
      state: state(real, demo ? "optional" : "todo"),
      body: (
        <>
          {p("guide.step.credentials.body1")}
          {p("guide.step.credentials.body2")}
        </>
      ),
      link: { label: t("guide.step.credentials.link"), href: API_PORTAL },
      check: t("guide.step.credentials.check"),
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
      id: "check",
      title: t("guide.step.check.title"),
      state: state(connected, demo ? "optional" : "todo"),
      body: p("guide.step.check.body"),
      check: t("guide.step.check.check"),
    },
    {
      id: "categories",
      title: t("guide.step.categories.title"),
      state: state(s.categories.count > 0 && categoriesMapped),
      body: (
        <>
          {p("guide.step.categories.body1")}
          {p("guide.step.categories.body2")}
        </>
      ),
      check: t("guide.step.categories.check"),
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
      id: "defaults",
      title: t("guide.step.defaults.title"),
      state: state(Boolean(defaults.returnPolicy.trim() || defaults.complaintPolicy.trim()), "optional"),
      body: p("guide.step.defaults.body"),
      check: t("guide.step.defaults.check"),
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
      id: "shipx",
      title: t("guide.step.shipx.title"),
      state: state(shipped, "later"),
      body: (
        <>
          {p("guide.step.shipx.body1")}
          {p("guide.step.shipx.body2")}
        </>
      ),
      check: t("guide.step.shipx.check"),
    },
    {
      id: "afterSale",
      title: t("guide.step.afterSale.title"),
      state: "later",
      body: p("guide.step.afterSale.body"),
      check: t("guide.step.afterSale.check"),
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
    { label: t("guide.checklist.connection"), done: connected },
    { label: t("guide.checklist.categories"), done: s.categories.count > 0 && categoriesMapped },
    { label: t("guide.checklist.gpsr"), done: s.counts.offers > 0 && s.counts.blocked < s.counts.offers },
    { label: t("guide.checklist.defaults"), done: Boolean(defaults.returnPolicy.trim() && defaults.complaintPolicy.trim()) },
    { label: t("guide.checklist.shipping"), done: mapped },
    { label: t("guide.checklist.channel"), done: Boolean(s.target.salesChannel && s.target.region) },
    { label: t("guide.checklist.listed"), done: s.counts.listed > 0 },
    { label: t("guide.checklist.firstOrder"), done: s.counts.orders > 0 },
    { label: t("guide.checklist.shipx"), done: shipped },
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
