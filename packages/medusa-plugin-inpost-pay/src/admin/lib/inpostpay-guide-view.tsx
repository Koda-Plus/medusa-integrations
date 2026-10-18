import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { InlineTip } from "@medusajs/ui"
import type { StatusResponse } from "../../modules/inpostpay/lib/contract"
import { GuideChecklist, GuideDiagram, GuideFaq, GuideIntro, GuideSteps, type GuideStep, type SetupPromptSpec, type StepState } from "./inpostpay-guide"

/*
 * The "Setup guide" view: what the rollout takes, how the parts talk, the
 * steps with their live state, the go-live checklist and troubleshooting.
 * Every sentence comes from the i18n files.
 */

const NEEDS = ["account", "keys", "backend", "region", "storefront"] as const
const FAQ_KEYS = ["signature", "notMapped", "provider", "price", "currency", "refund", "demo"] as const

const ENV = `# .env
INPOST_PAY_CLIENT_ID=...            # Basket App API (merchant portal; sandbox keys from InPost)
INPOST_PAY_CLIENT_SECRET=...
INPOST_PAY_MERCHANT_CLIENT_ID=...   # the widget's Merchant Client Id
INPOST_PAY_SANDBOX=true             # until InPost's audit passes
INPOST_PAY_DEMO=true                # a simulation, nothing goes to InPost`

const CONFIG = `// medusa-config.ts
const inpostPay = {
  clientId: process.env.INPOST_PAY_CLIENT_ID,
  clientSecret: process.env.INPOST_PAY_CLIENT_SECRET,
  merchantClientId: process.env.INPOST_PAY_MERCHANT_CLIENT_ID,
  sandbox: process.env.INPOST_PAY_SANDBOX === "true",
  demo: process.env.INPOST_PAY_DEMO === "true",
  // backendUrl: "https://api.example.com",   // the address InPost calls
  // storefrontUrl: "https://shop.example.com",
  // sendOrderEvents: true,                    // writer: cancel and parcel numbers to InPost
}

module.exports = defineConfig({
  plugins: [{ resolve: "@koda-plus/medusa-plugin-inpost-pay", options: inpostPay }],
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          { resolve: "@koda-plus/medusa-plugin-inpost-pay/providers/inpostpay", id: "inpost-pay", options: inpostPay },
        ],
      },
    },
  ],
})`

const STOREFRONT = `// 1. In live and sandbox: InPost's widget (official button, InPost's brand rules)
// <script src={config.widget_script_url}></script>
// <inpost-izi-button binding_place="PRODUCT_CARD" data-product-id={variantId}></inpost-izi-button>
InPostPayWidget.init({
  merchantClientId: config.merchant_client_id,
  unboundWidgetClicked: async () => {
    const r = await sdk.client.fetch("/store/inpostpay/baskets", { method: "POST", body: { cart_id: cart.id, binding_place: "PRODUCT_CARD" } })
    return r.widget.basket_binding_api_key
  },
})

// 2. In demo mode: no widget, a plain button marked as a demo
const r = await sdk.client.fetch("/store/inpostpay/baskets", { method: "POST", body: { cart_id: cart.id } })
const done = await sdk.client.fetch(\`/store/inpostpay/baskets/\${r.basket.id}/demo-confirm\`, { method: "POST", body: { phone } })
// done.order_id`

/** The same setup as this guide, for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("inpostpay")
  return useMemo(
    () => ({
      service: "InPost Pay",
      pkg: "@koda-plus/medusa-plugin-inpost-pay",
      route: "/app/inpostpay",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `${ENV}\n\n${CONFIG}`,
      demo: 'demo: process.env.INPOST_PAY_DEMO === "true",',
    }),
    [t],
  )
}

export function GuideView({ status: s }: { status: StatusResponse }) {
  const { t } = useTranslation("inpostpay")
  const demo = s.mode === "demo"
  const real = s.mode === "live" || s.mode === "sandbox"
  const p = (key: string, options?: Record<string, unknown>) => <p>{t(key, options)}</p>
  const state = (done: boolean, otherwise: StepState = "todo"): StepState => (done ? "done" : otherwise)
  const mapped = Object.values(s.settings.delivery).some(Boolean)
  const providerOk = s.provider.registered && s.provider.enabled

  const steps: GuideStep[] = [
    {
      id: "keys",
      title: t("guide.step.keys.title"),
      state: state(real),
      body: (
        <>
          {p("guide.step.keys.body1")}
          {p("guide.step.keys.body2")}
        </>
      ),
      code: ENV,
      link: { label: t("guide.step.storefront.link"), href: "https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/151355427/Scope+of+works+on+the+Merchant+s+side" },
      check: t("guide.step.keys.check"),
    },
    {
      id: "install",
      title: t("guide.step.install.title"),
      state: state(s.configured && s.provider.registered),
      body: (
        <>
          {p("guide.step.install.body1")}
          {p("guide.step.install.body2")}
        </>
      ),
      code: `npm install @koda-plus/medusa-plugin-inpost-pay\n\n${CONFIG}\n\nnpx medusa db:migrate`,
      check: t("guide.step.install.check"),
    },
    {
      id: "region",
      title: t("guide.step.region.title"),
      state: state(providerOk),
      body: p("guide.step.region.body", { id: s.provider.id }),
      check: t("guide.step.region.check"),
    },
    {
      id: "portal",
      title: t("guide.step.portal.title"),
      state: state(real && s.counts.linked > 0, demo ? "optional" : "todo"),
      body: p("guide.step.portal.body"),
      code: s.urls.merchantApi,
      check: t("guide.step.portal.check"),
    },
    {
      id: "delivery",
      title: t("guide.step.delivery.title"),
      state: state(mapped, demo ? "optional" : "todo"),
      body: p("guide.step.delivery.body"),
      check: t("guide.step.delivery.check"),
    },
    {
      id: "storefront",
      title: t("guide.step.storefront.title"),
      state: state(s.counts.baskets > 0),
      body: (
        <>
          {p("guide.step.storefront.body1")}
          {p("guide.step.storefront.body2")}
        </>
      ),
      code: STOREFRONT,
      link: { label: t("guide.step.storefront.link"), href: "https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/697008299" },
      check: t("guide.step.storefront.check"),
    },
    {
      id: "test",
      title: t("guide.step.test.title"),
      state: state(real && s.counts.orders > 0, "later"),
      body: p("guide.step.test.body"),
      check: t("guide.step.test.check"),
    },
    {
      id: "events",
      title: t("guide.step.events.title"),
      state: state(s.options.sendOrderEvents, "optional"),
      body: p("guide.step.events.body"),
      code: "sendOrderEvents: true,",
      check: t("guide.step.events.check"),
    },
    {
      id: "live",
      title: t("guide.step.live.title"),
      state: state(s.mode === "live", "later"),
      body: p("guide.step.live.body"),
    },
  ]

  const checklist = [
    { label: t("guide.checklist.keys"), done: real },
    { label: t("guide.checklist.provider"), done: providerOk },
    { label: t("guide.checklist.delivery"), done: Boolean(s.settings.delivery.APM) },
    { label: t("guide.checklist.firstBasket"), done: real && s.counts.baskets > 0 },
    { label: t("guide.checklist.linked"), done: real && s.counts.linked > 0 },
    { label: t("guide.checklist.firstOrder"), done: real && s.counts.orders > 0 },
    { label: t("guide.checklist.sandboxOff"), done: s.mode === "live" },
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
          { title: t("guide.diagram.plugin"), caption: t("guide.diagram.pluginCaption"), accent: true },
          { title: t("guide.diagram.app"), caption: t("guide.diagram.appCaption") },
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
