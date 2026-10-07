import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { InlineTip } from "@medusajs/ui"
import type { CheckKey, StripeChecksResponse, StripeStatusResponse, Verdict } from "../../modules/stripe/lib/contract"
import { GuideChecklist, GuideDiagram, GuideFaq, GuideIntro, GuideSteps, References, type GuideStep, type SetupPromptSpec, type StepState } from "./stripe-guide"
import { fmtRating, referencesFor } from "./stripe-ui"

/*
 * THE SETUP GUIDE: a Polish store from a new Stripe account to production,
 * cards, BLIK, Przelewy24, Apple Pay and Google Pay through the official
 * provider, then the read key for this plugin. The state of each step comes
 * from the health checks of this store. Every sentence is in the i18n files;
 * the configuration below is the same one "Copy prompt" hands to an agent.
 */

/** What the store owner prepares, in the order of the guide. */
const NEEDS = ["account", "bank", "medusa", "storefront", "key"] as const

const ENV = `# .env
STRIPE_API_KEY=sk_live_...        # the official provider
STRIPE_WEBHOOK_SECRET=whsec_...   # the webhook endpoint's signing secret
STRIPE_READ_KEY=rk_live_...       # this plugin: a restricted key, read only`

/** The official provider, as the Polish stores of Koda Plus run it. */
export function providerCode(providerId = "stripe"): string {
  return `// medusa-config.ts
// When the Stripe provider is already registered here, keep its entry and its options
// as they are (capture included: it decides when card money is taken), and add only
// the plugin below with its read key. The plugin has no tables and no writes.
modules: [
  // The official provider stops the boot without a key: register it only with one.
  ...(process.env.STRIPE_API_KEY
    ? [
        {
          resolve: "@medusajs/medusa/payment",
          options: {
            providers: [
              {
                // One entry: pp_stripe_${providerId} (cards and the Payment Element),
                // pp_stripe-blik_${providerId}, pp_stripe-przelewy24_${providerId} and five more.
                resolve: "@medusajs/medusa/payment-stripe",
                id: "${providerId}",
                options: {
                  apiKey: process.env.STRIPE_API_KEY,
                  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
                  capture: true, // BLIK and Przelewy24 have no manual capture
                  automaticPaymentMethods: true, // the Dashboard decides what the checkout offers
                },
              },
            ],
          },
        },
      ]
    : []),
],`
}

export function pluginCode(providerId = "stripe"): string {
  return `plugins: [
  {
    resolve: "@koda-plus/medusa-plugin-stripe",
    options: {
      apiKey: process.env.STRIPE_READ_KEY, // rk_live_..., read only
${providerId === "stripe" ? '      // providerId: "stripe",              // the id of the provider entry above' : `      providerId: "${providerId}",`}
      // backendUrl: "https://api.example.pl", // when the admin runs on another address
      // storefrontDomains: ["example.pl", "www.example.pl"],
      // cacheSeconds: 300,
    },
  },
],`
}

const EVENTS = `payment_intent.succeeded
payment_intent.amount_capturable_updated   # while cards are captured by hand
payment_intent.payment_failed              # listed in Medusa's docs
payment_intent.partially_funded            # listed in Medusa's docs`

const STOREFRONT = `// 1. The Stripe payment session of the cart (Medusa JS SDK)
const { payment_collection } = await sdk.store.payment.initiatePaymentSession(cart, {
  provider_id: "pp_stripe_stripe",
})
const session = payment_collection.payment_sessions.find((s) => s.provider_id === "pp_stripe_stripe")

// 2. The Payment Element with the session's client secret (React)
<Elements stripe={stripePromise} options={{ clientSecret: session.data.client_secret, locale: "pl" }}>
  <PaymentElement />
</Elements>

// 3. Confirm: cards and BLIK finish here, Przelewy24 comes back to return_url
const { error } = await stripe.confirmPayment({
  elements,
  redirect: "if_required",
  confirmParams: { return_url: \`\${location.origin}/checkout/return\` },
})
if (!error) await sdk.store.cart.complete(cart.id)

// 4. On return_url: read the PaymentIntent, then complete the cart (the webhook does it otherwise)
const { paymentIntent } = await stripe.retrievePaymentIntent(params.get("payment_intent_client_secret"))
if (paymentIntent?.status === "succeeded") await sdk.store.cart.complete(cartId)`

/** The same setup as the guide (steps "provider" and "key"), for "Copy prompt" in the page header. */
export function usePromptSpec(status?: StripeStatusResponse): SetupPromptSpec {
  const { t } = useTranslation("stripe")
  const providerId = status?.options.providerId ?? "stripe"
  return useMemo(
    () => ({
      service: "Stripe",
      pkg: "@koda-plus/medusa-plugin-stripe",
      route: "/app/stripe",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `${ENV}\n\n${providerCode(providerId)}\n\n${pluginCode(providerId)}`,
      /* Only an explicit switch: a store whose read key is missing shows the setup, never sample data. */
      demo: 'demo: process.env.STRIPE_DEMO === "true",',
      readOnly: true,
      migrations: false,
    }),
    [t, providerId],
  )
}

function stepState(verdict: Verdict | undefined, otherwise: StepState = "todo"): StepState {
  if (verdict === "pass" || verdict === "info") return "done"
  if (verdict === "off") return "optional"
  return otherwise
}

export function GuideView({ status, checks, lang }: { status: StripeStatusResponse; checks: StripeChecksResponse | undefined; lang: string }) {
  const { t } = useTranslation("stripe")
  const verdict = (k: CheckKey): Verdict | undefined => checks?.results.find((r) => r.key === k)?.verdict
  const p = (key: string) => <p key={key}>{t(key)}</p>
  const providerId = status.options.providerId
  const dashboard = status.dashboardUrl
  const webhookUrl = status.webhookUrl ?? `https://your-backend${status.webhookPath}`

  const steps: GuideStep[] = [
    {
      id: "account",
      title: t("guide.step.account.title"),
      state: stepState(verdict("account")),
      body: [p("guide.step.account.body1"), p("guide.step.account.body2")],
      link: { label: t("guide.step.account.link"), href: "https://dashboard.stripe.com/settings/account" },
      check: t("guide.step.account.check"),
    },
    {
      id: "methods",
      title: t("guide.step.methods.title"),
      state: stepState(verdict("capabilities")),
      body: [p("guide.step.methods.body1"), p("guide.step.methods.body2")],
      link: { label: t("guide.step.methods.link"), href: `${dashboard}/settings/payment_methods` },
      check: t("guide.step.methods.check"),
    },
    {
      id: "provider",
      title: t("guide.step.provider.title"),
      state: stepState(verdict("provider")),
      body: [p("guide.step.provider.body1"), p("guide.step.provider.body2")],
      code: `${ENV}\n\n${providerCode(providerId)}`,
      link: { label: "Medusa: Stripe Module Provider", href: "https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider/stripe" },
      check: t("guide.step.provider.check"),
    },
    {
      id: "webhook",
      title: t("guide.step.webhook.title"),
      state: verdict("webhook") === "pass" && verdict("deliveries") !== "fail" ? "done" : stepState(verdict("webhook")),
      body: [p("guide.step.webhook.body1"), p("guide.step.webhook.body2")],
      code: `${webhookUrl}\n\n${EVENTS}`,
      link: { label: t("guide.step.webhook.link"), href: `${dashboard}/webhooks` },
      check: t("guide.step.webhook.check"),
    },
    {
      id: "regions",
      title: t("guide.step.regions.title"),
      state: stepState(verdict("regions")),
      body: [p("guide.step.regions.body1"), p("guide.step.regions.body2")],
      check: t("guide.step.regions.check"),
    },
    {
      id: "domains",
      title: t("guide.step.domains.title"),
      state: stepState(verdict("domains"), "todo"),
      body: [p("guide.step.domains.body1"), p("guide.step.domains.body2")],
      link: { label: t("guide.step.domains.link"), href: `${dashboard}/settings/payment_method_domains` },
      check: t("guide.step.domains.check"),
    },
    {
      id: "storefront",
      title: t("guide.step.storefront.title"),
      state: "optional",
      body: [p("guide.step.storefront.body1"), p("guide.step.storefront.body2")],
      code: STOREFRONT,
      link: { label: "Stripe: Payment Element", href: "https://docs.stripe.com/payments/payment-element" },
      check: t("guide.step.storefront.check"),
    },
    {
      id: "key",
      title: t("guide.step.key.title"),
      state: verdict("key") === "pass" ? "done" : "todo",
      body: [p("guide.step.key.body1"), p("guide.step.key.body2")],
      code: pluginCode(providerId),
      link: { label: "Stripe: restricted API keys", href: "https://docs.stripe.com/keys/restricted-api-keys" },
      check: t("guide.step.key.check"),
    },
    {
      id: "live",
      title: t("guide.step.live.title"),
      state: "later",
      body: p("guide.step.live.body"),
    },
  ]

  const CHECKLIST: CheckKey[] = ["provider", "key", "account", "capabilities", "webhook", "deliveries", "domains", "regions", "capture", "orphans"]
  const checklist = CHECKLIST.map((k) => ({ label: t(`guide.checklist.${k}`), done: verdict(k) === "pass" }))

  const faq = ["blik", "noOrder", "wallets", "permission", "mode", "p24", "fees", "refund", "dispute", "reads"].map((k) => ({
    q: t(`guide.faq.${k}.q`),
    a: <p>{t(`guide.faq.${k}.a`)}</p>,
  }))

  return (
    <div className="flex flex-col gap-y-3">
      {status.mode === "demo" ? (
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
          { title: t("guide.diagram.stripe"), caption: t("guide.diagram.stripeCaption") },
          { title: t("guide.diagram.plugin"), caption: t("guide.diagram.pluginCaption"), accent: true },
        ]}
        links={[t("guide.diagram.link1"), t("guide.diagram.link2"), t("guide.diagram.link3")]}
      />
      <GuideSteps
        title={t("guide.stepsTitle")}
        subtitle={t("guide.stepsSubtitle")}
        steps={steps}
        stateLabels={{
          done: t("guide.stateLabels.done"),
          todo: t("guide.stateLabels.todo"),
          optional: t("guide.stateLabels.optional"),
          later: t("guide.stateLabels.later"),
        }}
        checkLabel={t("guide.checkLabel")}
        copyLabel={t("guide.copy")}
        copiedLabel={t("guide.copied")}
      />
      <GuideChecklist title={t("guide.checklist.title")} subtitle={t("guide.checklist.subtitle")} items={checklist} />
      <GuideFaq title={t("guide.faqTitle")} items={faq} />
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
