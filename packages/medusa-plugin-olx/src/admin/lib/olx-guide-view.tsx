import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { InlineTip } from "@medusajs/ui"
import type { OlxStatusResponse, OlxWriterKey } from "../../modules/olx/lib/contract"
import { GuideChecklist, GuideDiagram, GuideFaq, GuideIntro, GuideSteps, References, type GuideStep, type SetupPromptSpec, type StepState } from "./olx-guide"
import { fmtRating, kitReferences } from "./olx-ui"

/*
 * The "Setup guide" view: what the rollout takes, how the parts talk, the
 * steps with their live state, the go-live checklist, troubleshooting and the
 * stores running the plugin. Every sentence comes from the i18n files.
 */

const HOUR = 60 * 60 * 1000

function recent(iso: string | null | undefined, ms: number): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && Date.now() - t < ms
}

const FAQ_KEYS = [
  "disconnected",
  "scope",
  "blocked",
  "throttled",
  "nosku",
  "unmatched",
  "plan",
  "moderated",
  "attributes",
  "text",
  "price",
  "unknown",
  "limited",
  "stats",
] as const

/** What the store owner prepares, in the order of the guide. */
const NEEDS = ["account", "portal", "backend", "sku", "key"] as const

/** .env and medusa-config.ts, as step "options" shows them (and the setup prompt hands to an agent). */
function setupCode(redirect: string, market: string): string {
  return [
    "# .env",
    "OLX_CLIENT_ID=...",
    "OLX_CLIENT_SECRET=...",
    "OLX_ENCRYPTION_KEY=...   # openssl rand -base64 32",
    "",
    "// medusa-config.ts",
    "plugins: [",
    "  {",
    '    resolve: "@koda-plus/medusa-plugin-olx",',
    "    options: {",
    "      clientId: process.env.OLX_CLIENT_ID,",
    "      clientSecret: process.env.OLX_CLIENT_SECRET,",
    "      encryptionKey: process.env.OLX_ENCRYPTION_KEY,",
    `      redirectUri: "${redirect}",`,
    `      market: "${market}",`,
    "      // Writers: off unless allowed here AND armed in the admin.",
    '      lifecycleWriter: process.env.OLX_LIFECYCLE_WRITER === "true",',
    '      priceWriter: process.env.OLX_PRICE_WRITER === "true",',
    '      publishWriter: process.env.OLX_PUBLISH_WRITER === "true",',
    "    },",
    "  },",
    "]",
  ].join("\n")
}

/** The same setup as this guide, for "Copy prompt" in the page header. The redirect is the other store's, so a placeholder. */
export function usePromptSpec(s: OlxStatusResponse | undefined): SetupPromptSpec {
  const { t } = useTranslation("olx")
  const market = s?.market ?? "pl"
  return useMemo(
    () => ({
      service: "OLX",
      pkg: "@koda-plus/medusa-plugin-olx",
      route: "/app/olx",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: setupCode(t("missing.redirectFallback"), market),
      demo: 'demo: process.env.OLX_DEMO === "true" || !process.env.OLX_CLIENT_ID,',
    }),
    [t, market],
  )
}

export function GuideView({ status: s, lang }: { status: OlxStatusResponse; lang: string }) {
  const { t } = useTranslation("olx")
  const demo = s.mode === "demo"
  const live = !demo
  const connected = live && s.connection.connected
  const writer = (w: OlxWriterKey) => s.writers.find((x) => x.writer === w)
  const anyAllowed = live && Object.values(s.settings.writersAllowed).some(Boolean)
  const redirect = s.redirectUri ?? t("missing.redirectFallback")

  const p = (key: string) => <p>{t(key)}</p>

  const optionsCode = setupCode(redirect, s.market)

  const writersCode = [
    "# allow one writer at a time, then restart and connect the account again",
    "OLX_LIFECYCLE_WRITER=true",
    "",
    "// optional limits (defaults shown)",
    "maxLifecycleActionsPerRun: 20,",
    "maxPriceUpdatesPerRun: 20,",
    "maxPublishPerRun: 5,",
    "maxPriceChangePercent: 50,",
    "deactivateAsSold: false,",
    '// salesChannelId: "sc_...",  // count stock of one sales channel only',
  ].join("\n")

  const publishCode = [
    "publish: {",
    "  categories: [",
    '    { medusaCategory: "pcat_...", olxCategoryId: 1234, attributes: { state: "new" } },',
    "  ],",
    "  location: { cityId: 5659 },   // GET /cities or GET /locations",
    '  contact: { name: "Your shop", phone: "500600700" },',
    '  descriptionFooter: "Shipping within 24 hours.",',
    "},",
    "",
    "// per product (Medusa metadata): olx_title, olx_category_id,",
    '// olx_attributes: { "brand": "Makita" }',
  ].join("\n")

  const state = (done: boolean, otherwise: StepState = "todo"): StepState => (done ? "done" : otherwise)

  const steps: GuideStep[] = [
    {
      id: "app",
      title: t("guide.step.app.title"),
      state: state(live && Boolean(s.clientIdPrefix)),
      body: (
        <>
          {p("guide.step.app.body1")}
          {p("guide.step.app.body2")}
        </>
      ),
      link: { label: t("guide.step.app.link"), href: "https://developer.olx.pl" },
      check: t("guide.step.app.check"),
    },
    {
      id: "redirect",
      title: t("guide.step.redirect.title"),
      state: state(live && Boolean(s.redirectUri) && !s.missing.includes("redirectUri")),
      body: p("guide.step.redirect.body"),
      code: redirect,
      check: t("guide.step.redirect.check"),
    },
    {
      id: "options",
      title: t("guide.step.options.title"),
      state: state(live && s.configured),
      body: p("guide.step.options.body"),
      code: optionsCode,
      check: t("guide.step.options.check"),
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
      id: "connect",
      title: t("guide.step.connect.title"),
      state: state(connected && (!anyAllowed || s.scope.writeGranted)),
      body: (
        <>
          {p("guide.step.connect.body1")}
          {p("guide.step.connect.body2")}
        </>
      ),
      check: t("guide.step.connect.check"),
    },
    {
      id: "first-read",
      title: t("guide.step.firstRead.title"),
      state: state(live && Boolean(s.lastCompleteSyncAt)),
      body: p("guide.step.firstRead.body"),
      check: t("guide.step.firstRead.check"),
    },
    {
      id: "sku",
      title: t("guide.step.sku.title"),
      state: state(live && s.counts.linked > 0),
      body: (
        <>
          {p("guide.step.sku.body1")}
          {p("guide.step.sku.body2")}
        </>
      ),
      code: "Kod produktu: KS-ELN-18V",
      check: t("guide.step.sku.check"),
    },
    {
      id: "alerts",
      title: t("guide.step.alerts.title"),
      state: state(live && Boolean(s.plan.plannedAt) && s.alerts.live_sold_out + s.alerts.live_unpublished === 0),
      body: p("guide.step.alerts.body"),
      check: t("guide.step.alerts.check"),
    },
    {
      id: "writers",
      title: t("guide.step.writers.title"),
      state: state(live && s.writers.some((w) => w.armed && w.writer !== "publish"), "later"),
      body: (
        <>
          {p("guide.step.writers.body1")}
          {p("guide.step.writers.body2")}
        </>
      ),
      code: writersCode,
      check: t("guide.step.writers.check"),
    },
    {
      id: "publish",
      title: t("guide.step.publish.title"),
      state: state(live && Boolean(writer("publish")?.armed), "optional"),
      body: (
        <>
          {p("guide.step.publish.body1")}
          {p("guide.step.publish.body2")}
        </>
      ),
      code: publishCode,
      link: {
        label: "GET /categories/{id}/attributes",
        href: "https://developer.olx.pl/api/doc#tag/Categories-and-attributes/paths/~1categories~1%7BcategoryId%7D~1attributes/get",
      },
      check: t("guide.step.publish.check"),
    },
    {
      id: "live",
      title: t("guide.step.live.title"),
      state: "later",
      body: p("guide.step.live.body"),
    },
  ]

  const armedAfterDryRun = (w: OlxWriterKey) => Boolean(writer(w)?.armed && writer(w)?.lastDryRun)
  const checklist = [
    { label: t("guide.checklist.connection"), done: connected && !s.connection.lastError },
    { label: t("guide.checklist.firstRead"), done: live && Boolean(s.lastCompleteSyncAt) },
    { label: t("guide.checklist.linked"), done: live && s.counts.linked > 0 },
    { label: t("guide.checklist.alerts"), done: Boolean(s.plan.plannedAt) && s.alerts.live_sold_out === 0 },
    { label: t("guide.checklist.scope"), done: live ? !anyAllowed || s.scope.writeGranted : true },
    { label: t("guide.checklist.stats"), done: recent(s.stats.lastRunAt, 2 * HOUR) },
    { label: t("guide.checklist.messages"), done: recent(s.messages.lastReadAt, HOUR) },
    { label: t("guide.checklist.lifecycle"), done: armedAfterDryRun("lifecycle") },
    { label: t("guide.checklist.price"), done: armedAfterDryRun("price"), hint: t("guide.checklist.optionalHint") },
    { label: t("guide.checklist.publish"), done: armedAfterDryRun("publish"), hint: t("guide.checklist.optionalHint") },
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
          { title: t("guide.diagram.medusa"), caption: t("guide.diagram.medusaCaption") },
          { title: t("guide.diagram.plugin"), caption: t("guide.diagram.pluginCaption"), accent: true },
          { title: t("guide.diagram.api"), caption: t("guide.diagram.apiCaption", { host: s.marketHost }) },
          { title: t("guide.diagram.account"), caption: t("guide.diagram.accountCaption") },
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
