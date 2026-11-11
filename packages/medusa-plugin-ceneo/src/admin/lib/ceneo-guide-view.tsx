import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { StatusResponse } from "../../modules/ceneo/lib/contract"
import { GuideChecklist, GuideFaq, GuideIntro, GuideSteps, type GuideStep, type SetupPromptSpec, type StepState } from "./ceneo-guide"
import { KIT_META } from "./ceneo-kit-meta"

/**
 * The setup guide of the Ceneo page: what it takes, the steps with the code
 * to paste (state read from the status), the go-live checklist and the FAQ.
 * The copy lives in the i18n dictionaries under `guide`.
 */

const INSTALL = `npm install @koda-plus/medusa-plugin-ceneo
npx medusa db:migrate`

const CONFIG = `module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-ceneo",
      options: {
        feed: {
          token: process.env.CENEO_FEED_TOKEN,
          productUrl: "https://shop.example.com/pl/products/{handle}?variant={variant_id}",
          // regionId: "reg_...",
          // salesChannelId: "sc_...",
        },
        demo: process.env.CENEO_DEMO === "true",
      },
    },
  ],
})`

const TOKEN = `# .env (never in the repository)
# openssl rand -hex 24
CENEO_FEED_TOKEN=paste-48-hex-characters-here`

const REGION = `feed: {
  // The region whose PLN prices go to Ceneo, and the channel of the products.
  regionId: "reg_...",
  salesChannelId: "sc_...",
}`

const NEEDS = ["medusa", "storefront", "panel"] as const
const CHECKS = ["address", "built", "problems", "demoOff"] as const
const FAQ = ["why", "ids", "secret"] as const

/** The same setup as this guide, for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("ceneo")
  return useMemo(
    () => ({
      service: "Ceneo",
      pkg: KIT_META.pkg,
      route: "/app/ceneo",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `${INSTALL}\n\n${TOKEN}\n\n${CONFIG}`,
      demo: 'demo: process.env.CENEO_DEMO === "true",',
    }),
    [t],
  )
}

export function GuideView({ status }: { status?: StatusResponse }) {
  const { t } = useTranslation("ceneo")
  const state = (done: boolean, otherwise: StepState = "todo"): StepState => (done ? "done" : otherwise)
  const step = (id: string, st: StepState, paras: string[], code?: string): GuideStep => ({
    id,
    title: t(`guide.steps.${id}.title`),
    state: st,
    body: paras.map((k) => <p key={k}>{t(`guide.steps.${id}.${k}`)}</p>),
    code,
    check: t(`guide.steps.${id}.check`),
  })
  const loaded = Boolean(status)
  const gaps = status?.feed.gaps ?? []
  const tokenOk = loaded && !gaps.includes("token") && !gaps.includes("token_rejected")
  const urlOk = loaded && !gaps.includes("product_url") && !gaps.includes("product_url_rejected")
  const built = Boolean(status?.feed.last)

  const steps: GuideStep[] = [
    step("install", state(loaded), ["p1", "p2"], INSTALL),
    step("config", state(loaded), ["p1"], CONFIG),
    step("token", state(tokenOk), ["p1", "p2"], TOKEN),
    step("productUrl", state(urlOk), ["p1"]),
    step("region", state(Boolean(status?.feed.regionId && status.feed.salesChannelId), "optional"), ["p1"], REGION),
    step("categories", state(Boolean(status && status.categories.mapped > 0), "optional"), ["p1", "p2"]),
    step("panel", built ? "todo" : "later", ["p1"]),
    step("demo", state(Boolean(status?.demo), "optional"), ["p1"]),
  ]

  const done: Record<(typeof CHECKS)[number], boolean> = {
    address: tokenOk && urlOk,
    built,
    problems: built && (status?.counts.error ?? 0) === 0,
    demoOff: loaded && !status?.demo,
  }
  const checklist = CHECKS.map((k) => ({ label: t(`guide.checklist.${k}`), done: done[k] }))

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
      <GuideFaq title={t("guide.faq.title")} items={FAQ.map((k) => ({ q: t(`guide.faq.${k}.q`), a: t(`guide.faq.${k}.a`) }))} />
    </div>
  )
}
