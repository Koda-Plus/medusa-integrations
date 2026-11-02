import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { InlineTip } from "@medusajs/ui"
import { OPTION_SPECS } from "../../modules/dpd/lib/constants"
import type { StatusResponse } from "../../modules/dpd/lib/contract"
import { GuideChecklist, GuideDiagram, GuideFaq, GuideIntro, GuideSteps, type GuideStep, type SetupPromptSpec, type StepState } from "./dpd-guide"
import { KIT_META } from "./dpd-kit-meta"

/*
 * The "Setup guide" view: what the setup takes, how the parts talk, the
 * steps with their live state from GET /admin/dpd, the go-live checklist
 * and troubleshooting. Every sentence comes from the i18n files; the code
 * blocks are configuration, the same in both languages.
 */

/** What the store owner prepares, in the order of the guide. */
const NEEDS = ["contract", "credentials", "medusa", "sender"] as const

const FAQ_KEYS = ["fid", "sandbox", "writers", "missing"] as const

const ENV = `# .env
DPD_MODE=sandbox        # sandbox (the DPD demo host) or live
DPD_LOGIN=...           # DPDServices login from DPD
DPD_PASSWORD=...        # DPDServices password from DPD
DPD_MASTER_FID=...      # your FID (customer number) at DPD`

const CONFIG = `// medusa-config.ts
const dpd = {
  mode: process.env.DPD_MODE,
  login: process.env.DPD_LOGIN,
  password: process.env.DPD_PASSWORD,
  masterFid: process.env.DPD_MASTER_FID,
  sender: process.env.DPD_SENDER,
  // Writes: off unless allowed here AND armed in the admin (allowed by default in demo mode, simulated).
  // shipmentWriter: true,           // waybills and labels
  // pickupWriter: true,             // courier orders
  // fulfillmentStatusWriter: true,  // mark Medusa fulfillments shipped and delivered
}

module.exports = defineConfig({
  plugins: [{ resolve: "@koda-plus/medusa-plugin-dpd", options: dpd }],
  modules: [
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
          { resolve: "@koda-plus/medusa-plugin-dpd/providers/dpd", id: "dpd", options: dpd },
        ],
      },
    },
  ],
})`

const DEMO = `# .env
DPD_DEMO=true

// medusa-config.ts, in the dpd options
demo: process.env.DPD_DEMO === "true",`

const SANDBOX = `# .env, the test account DPD gives you
DPD_MODE=sandbox
DPD_LOGIN=...
DPD_PASSWORD=...
DPD_MASTER_FID=...`

const SENDER = `# .env, one line of JSON
DPD_SENDER={"company":"Example Store","name":"Jan Nowak","phone":"600100200","email":"shop@example.com","street":"ul. Prosta 1","city":"Warszawa","postalCode":"00-950","countryCode":"PL"}

// optional, in the dpd options: a sender per stock location
// senders: { "sloc_01": { ... } },`

/* The five fulfillment options, as the provider lists them when a shipping option is created. */
const OPTIONS = OPTION_SPECS.map((o) => `${o.id.padEnd(17)}${o.name}${o.kind === "return" ? " (return option)" : ""}`).join("\n")

/** The same setup as this guide, for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("dpd")
  return useMemo(
    () => ({
      service: "DPD",
      pkg: KIT_META.pkg,
      route: "/app/dpd",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `${ENV}\n\n${CONFIG}`,
      demo: 'demo: process.env.DPD_DEMO === "true",',
    }),
    [t],
  )
}

export function GuideView({ status: s }: { status: StatusResponse }) {
  const { t } = useTranslation("dpd")
  const demo = s.mode === "demo"
  const live = !demo
  const p = (key: string, options?: Record<string, unknown>) => <p>{t(key, options)}</p>
  const state = (done: boolean, otherwise: StepState = "todo"): StepState => (done ? "done" : otherwise)
  /* Rows outside demo mode come from real fulfillments of the provider: the provider and its options work. */
  const realRows = live && s.counts.all > 0
  const senderOk = live && s.senderProblems.length === 0

  const steps: GuideStep[] = [
    {
      id: "install",
      title: t("guide.step.install.title"),
      state: "done",
      body: p("guide.step.install.body"),
      code: "npm install @koda-plus/medusa-plugin-dpd",
      check: t("guide.step.install.check"),
    },
    {
      id: "register",
      title: t("guide.step.register.title"),
      state: state(realRows),
      body: (
        <>
          {p("guide.step.register.body1")}
          {p("guide.step.register.body2")}
        </>
      ),
      code: CONFIG,
      check: t("guide.step.register.check"),
    },
    {
      id: "env",
      title: t("guide.step.env.title"),
      state: state(live && s.configured),
      body: (
        <>
          {p("guide.step.env.body1")}
          {p("guide.step.env.body2")}
        </>
      ),
      code: ENV,
      check: t("guide.step.env.check"),
    },
    {
      id: "migrate",
      title: t("guide.step.migrate.title"),
      /* This page reads the plugin's tables, so they exist. */
      state: "done",
      body: p("guide.step.migrate.body"),
      code: "npx medusa db:migrate",
      check: t("guide.step.migrate.check"),
    },
    {
      id: "options",
      title: t("guide.step.options.title"),
      state: state(realRows),
      body: (
        <>
          {p("guide.step.options.body1")}
          {p("guide.step.options.body2")}
        </>
      ),
      code: OPTIONS,
      check: t("guide.step.options.check"),
    },
    {
      id: "demo",
      title: t("guide.step.demo.title"),
      state: state(demo, "optional"),
      body: p("guide.step.demo.body"),
      code: DEMO,
      check: t("guide.step.demo.check"),
    },
    {
      id: "sandbox",
      title: t("guide.step.sandbox.title"),
      state: state(live && s.mode === "sandbox" && s.configured, "optional"),
      body: (
        <>
          {p("guide.step.sandbox.body1")}
          {p("guide.step.sandbox.body2")}
        </>
      ),
      code: SANDBOX,
      check: t("guide.step.sandbox.check"),
    },
    {
      id: "sender",
      title: t("guide.step.sender.title"),
      state: state(senderOk),
      body: (
        <>
          {p("guide.step.sender.body1")}
          {p("guide.step.sender.body2")}
        </>
      ),
      code: SENDER,
      check: t("guide.step.sender.check"),
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
  ]

  const checklist = [
    { label: t("guide.checklist.connection"), done: live && s.configured },
    { label: t("guide.checklist.options"), done: s.optionProblems.length === 0 },
    { label: t("guide.checklist.sender"), done: senderOk },
    { label: t("guide.checklist.shipping"), done: realRows },
    { label: t("guide.checklist.armed"), done: live && s.writers.shipment.armed },
    { label: t("guide.checklist.live"), done: s.mode === "live" && s.configured, hint: t("guide.checklist.liveHint") },
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
          { title: t("guide.diagram.dpd"), caption: t("guide.diagram.dpdCaption") },
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
