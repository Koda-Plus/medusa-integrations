import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { InlineTip } from "@medusajs/ui"
import type { StatusResponse } from "../../modules/inpost/lib/contract"
import { GuideChecklist, GuideDiagram, GuideFaq, GuideIntro, GuideSteps, References, type GuideStep, type SetupPromptSpec, type StepState } from "./inpost-guide"
import { fmtRating, kitReferences } from "./inpost-ui"

/*
 * The "Setup guide" view: what the rollout takes, how the parts talk, the
 * steps with their live state, the go-live checklist, troubleshooting and the
 * stores running the plugin. Every sentence comes from the i18n files.
 */

const DAY = 24 * 60 * 60 * 1000

function recent(iso: string | null | undefined, ms: number): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && Date.now() - t < ms
}

/** What the store owner prepares, in the order of the guide. */
const NEEDS = ["account", "token", "medusa", "storefront", "webhook"] as const

const FAQ_KEYS = ["token401", "org403", "prepaid", "cancel", "label", "locker", "phone", "address", "cod", "sandboxCourier", "webhook", "outside", "parcels", "returns"] as const

const ENV = `# .env
INPOST_API_TOKEN=...          # InPost Manager: My account, API, ShipX
INPOST_ORGANIZATION_ID=...    # shown next to the token
INPOST_WEBHOOK_SECRET=...     # openssl rand -hex 24`

const CONFIG = `// medusa-config.ts
const inpost = {
  apiToken: process.env.INPOST_API_TOKEN,
  organizationId: process.env.INPOST_ORGANIZATION_ID,
  webhookSecret: process.env.INPOST_WEBHOOK_SECRET,
  // sandbox: true,
  // Writes: off unless allowed here AND armed in the admin (allowed by default in demo mode, simulated).
  // shipmentWriter: true,           // create, pay a prepaid offer, order a pickup, cancel
  // fulfillmentStatusWriter: true,  // mark Medusa fulfillments shipped and delivered
}

module.exports = defineConfig({
  plugins: [{ resolve: "@koda-plus/medusa-plugin-inpost", options: inpost }],
  modules: [
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
          { resolve: "@koda-plus/medusa-plugin-inpost/providers/inpost", id: "inpost", options: inpost },
        ],
      },
    },
  ],
})`

const SANDBOX = `INPOST_API_TOKEN=...          # from sandbox-manager.paczkomaty.pl
INPOST_ORGANIZATION_ID=...

// medusa-config.ts, in the inpost options
sandbox: true,`

const GEOWIDGET = `<link rel="stylesheet" href="https://geowidget.inpost.pl/inpost-geowidget.css" />
<script src="https://geowidget.inpost.pl/inpost-geowidget.js" defer></script>

<inpost-geowidget token="YOUR_GEOWIDGET_TOKEN" language="pl"
  config="parcelCollect" onpoint="onInpostPoint"></inpost-geowidget>

<script>
  function onInpostPoint(point) {
    // point.name is the locker code, e.g. "KRA01M"
    const data = {
      machine_id: point.name,
      machine_name: point.name,
      machine_address: {
        line1: point.address.line1,
        line2: point.address.line2,
        city: point.address_details.city,
        post_code: point.address_details.post_code,
      },
    }
    // sdk.store.cart.addShippingMethod(cartId, { option_id, data })
  }
</script>`

const SETTINGS_CODE = `// optional, in the inpost options
defaultParcelSize: "medium",   // the default; "small" (A) or "large" (C)
labelFormat: "A6",             // the default; "A4" for office printers (lockers only)
autoCreate: false,             // the default; true creates on fulfillment once armed
// sendingMethod: { locker: "parcel_locker", courier: "dispatch_order" },  // default: your account's
// skipMetadataKeys: ["inpost_shipment"],  // default: none; orders another system ships`

/** The same setup as this guide, for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("inpost")
  return useMemo(
    () => ({
      service: "InPost",
      pkg: "@koda-plus/medusa-plugin-inpost",
      route: "/app/inpost",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `${ENV}\n\n${CONFIG}`,
      demo: 'demo: process.env.INPOST_DEMO === "true" || !process.env.INPOST_API_TOKEN,',
    }),
    [t],
  )
}

export function GuideView({ status: s, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("inpost")
  const demo = s.mode === "demo"
  const live = !demo
  const p = (key: string, options?: Record<string, unknown>) => <p>{t(key, options)}</p>
  const state = (done: boolean, otherwise: StepState = "todo"): StepState => (done ? "done" : otherwise)
  const options = s.shippingOptions ?? []
  const webhookUrl = s.webhook.url ?? t("guide.step.webhook.placeholder")
  const created = s.counts.all - s.counts.to_create - s.counts.skipped

  const steps: GuideStep[] = [
    {
      id: "token",
      title: t("guide.step.token.title"),
      state: state(live && s.tokenSet && Boolean(s.organizationId)),
      body: (
        <>
          {p("guide.step.token.body1")}
          {p("guide.step.token.body2")}
        </>
      ),
      link: { label: "manager.paczkomaty.pl", href: "https://manager.paczkomaty.pl" },
      check: t("guide.step.token.check"),
    },
    {
      id: "sandbox",
      title: t("guide.step.sandbox.title"),
      state: state(live && s.sandbox, "optional"),
      body: p("guide.step.sandbox.body"),
      code: SANDBOX,
      link: { label: "sandbox-manager.paczkomaty.pl", href: "https://sandbox-manager.paczkomaty.pl/auth/register" },
      check: t("guide.step.sandbox.check"),
    },
    {
      id: "install",
      title: t("guide.step.install.title"),
      state: state(live && s.configured),
      body: (
        <>
          {p("guide.step.install.body1")}
          {p("guide.step.install.body2")}
        </>
      ),
      code: `npm install @koda-plus/medusa-plugin-inpost\n\n${ENV}\n\n${CONFIG}`,
      check: t("guide.step.install.check"),
    },
    {
      id: "migrate",
      title: t("guide.step.migrate.title"),
      state: "done",
      body: p("guide.step.migrate.body"),
      code: "npx medusa db:migrate",
      check: t("guide.step.migrate.check"),
    },
    {
      id: "options",
      title: t("guide.step.options.title"),
      state: state(options.length > 0),
      body: (
        <>
          {p("guide.step.options.body1")}
          {p("guide.step.options.body2")}
          {options.length > 0 ? p("guide.step.options.found", { list: options.map((o) => `${o.name} (${o.optionId ?? "?"})`).join(", ") }) : null}
        </>
      ),
      check: t("guide.step.options.check"),
    },
    {
      id: "storefront",
      title: t("guide.step.storefront.title"),
      state: "optional",
      body: (
        <>
          {p("guide.step.storefront.body1")}
          {p("guide.step.storefront.body2")}
        </>
      ),
      code: GEOWIDGET,
      link: { label: t("guide.step.storefront.link"), href: "https://geowidget.inpost.pl/docs/" },
      check: t("guide.step.storefront.check"),
    },
    {
      id: "webhook",
      title: t("guide.step.webhook.title"),
      state: state(live && s.webhook.enabled && recent(s.webhook.lastAt, 7 * DAY)),
      body: (
        <>
          {p("guide.step.webhook.body1")}
          {p("guide.step.webhook.body2")}
        </>
      ),
      code: webhookUrl,
      check: t("guide.step.webhook.check"),
    },
    {
      id: "settings",
      title: t("guide.step.settings.title"),
      state: state(s.settings.source.sender !== "none" || s.settings.source.defaultParcelSize === "admin", "optional"),
      body: p("guide.step.settings.body"),
      code: SETTINGS_CODE,
      check: t("guide.step.settings.check"),
    },
    {
      id: "arm",
      title: t("guide.step.arm.title"),
      state: state(live && s.writers.shipment.armed, "later"),
      body: (
        <>
          {p("guide.step.arm.body1")}
          {p("guide.step.arm.body2")}
        </>
      ),
      check: t("guide.step.arm.check"),
    },
    {
      id: "status",
      title: t("guide.step.status.title"),
      state: state(live && s.writers.fulfillmentStatus.armed, "optional"),
      body: p("guide.step.status.body"),
      check: t("guide.step.status.check"),
    },
    {
      id: "live",
      title: t("guide.step.live.title"),
      state: "later",
      body: p("guide.step.live.body"),
    },
  ]

  const checklist = [
    { label: t("guide.checklist.connection"), done: live && Boolean(s.lastCheck?.ok) },
    { label: t("guide.checklist.options"), done: options.length > 0 },
    { label: t("guide.checklist.storefront"), done: options.some((o) => o.optionId?.startsWith("inpost-paczkomat")), hint: t("guide.checklist.storefrontHint") },
    { label: t("guide.checklist.webhook"), done: live && recent(s.webhook.lastAt, 7 * DAY) },
    { label: t("guide.checklist.firstShipment"), done: live && created > 0 },
    { label: t("guide.checklist.armed"), done: live && s.writers.shipment.armed },
    { label: t("guide.checklist.status"), done: live && s.writers.fulfillmentStatus.armed, hint: t("guide.checklist.optionalHint") },
    { label: t("guide.checklist.sandboxOff"), done: live && !s.sandbox },
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
          { title: t("guide.diagram.storefront"), caption: t("guide.diagram.storefrontCaption") },
          { title: t("guide.diagram.medusa"), caption: t("guide.diagram.medusaCaption") },
          { title: t("guide.diagram.plugin"), caption: t("guide.diagram.pluginCaption"), accent: true },
          { title: t("guide.diagram.shipx"), caption: t("guide.diagram.shipxCaption") },
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
      <References
        items={kitReferences(s.references, lang)}
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
