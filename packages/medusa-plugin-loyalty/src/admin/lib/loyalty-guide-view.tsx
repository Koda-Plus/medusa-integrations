import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { StatusResponse } from "../../modules/loyalty/lib/contract"
import { GuideChecklist, GuideFaq, GuideIntro, GuideSteps, type GuideStep, type SetupPromptSpec, type StepState } from "./loyalty-guide"
import { KIT_META } from "./loyalty-kit-meta"

/**
 * The setup guide of the Loyalty page: what it takes, the steps with the code
 * to paste (state read from the status), the go-live checklist and the FAQ.
 * The copy lives in the i18n dictionaries under `guide`.
 */

const INSTALL = `npm install @koda-plus/medusa-plugin-loyalty
npx medusa db:migrate`

const CONFIG = `module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-loyalty",
      options: {
        // Everything is optional.
        pointsPerPln: 1,
        redeemRate: 0.05,
        rewards: [
          { at: 1500, name: { en: "50 off", pl: "Rabat 50 zł" } },
          { at: 3000, name: { en: "Free hoodie", pl: "Bluza z kapturem gratis" } },
        ],
        demo: process.env.LOYALTY_DEMO === "true",
      },
    },
  ],
})`

const NEEDS = ["medusa", "ladder"] as const
const CHECKS = ["accrue", "account", "redeem", "adjust"] as const
const FAQ = ["when", "change", "demo"] as const

/** The same setup as this guide, for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("loyalty")
  return useMemo(
    () => ({
      service: "Loyalty",
      pkg: KIT_META.pkg,
      route: "/app/loyalty",
      summary: t("subtitle", { pointsPerPln: 1, redeemRate: 0.05 }),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `${INSTALL}\n\n${CONFIG}`,
      demo: 'demo: process.env.LOYALTY_DEMO === "true",',
    }),
    [t],
  )
}

export function GuideView({ status }: { status?: StatusResponse }) {
  const { t } = useTranslation("loyalty")
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

  const steps: GuideStep[] = [
    step("install", state(loaded), ["p1", "p2"], INSTALL),
    step("config", state(loaded), ["p1"], CONFIG),
    step("values", state(Boolean(status?.rewards.length), "optional"), ["p1", "p2"]),
    step("open", state((status?.counts.accounts ?? 0) > 0), ["p1"]),
    step("store", "later", ["p1"]),
  ]

  const done: Record<(typeof CHECKS)[number], boolean> = {
    accrue: (status?.counts.transactions ?? 0) > 0,
    account: false,
    redeem: (status?.counts.redeemed_total ?? 0) > 0,
    adjust: (status?.transactions ?? []).some((x) => x.kind === "adjust" || x.kind === "bonus"),
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
