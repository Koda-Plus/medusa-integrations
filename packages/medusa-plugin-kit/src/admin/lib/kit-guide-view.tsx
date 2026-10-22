import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { Status } from "./kit-api"
import { GuideChecklist, GuideFaq, GuideIntro, GuideSteps, type GuideStep, type SetupPromptSpec, type StepState } from "./kit-guide"
import { KIT_META } from "./kit-kit-meta"

/**
 * The setup guide of the Kit page: what it takes, the steps with the code to
 * paste (state read from the status), the go-live checklist and the FAQ. The
 * copy lives in the i18n dictionaries under `guide`.
 */

const INSTALL = `npm install @koda-plus/medusa-plugin-kit
npx medusa db:migrate`

const ENV = `KIT_API_KEY=kit_...   # Kit, Settings, Developer, API keys (V4)`

const CONFIG = `module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-kit",
      options: {
        // Everything is optional.
        apiKey: process.env.KIT_API_KEY,
        source: "My Store",
        // A sample account in memory, Kit is never called:
        demo: process.env.KIT_DEMO === "true",
      },
    },
  ],
})`

const NEEDS = ["medusa", "kit", "key"] as const
const CHECKS = ["key", "tags", "optIn", "test"] as const
const FAQ = ["duplicate", "optIn", "noKey"] as const

/** The same setup as this guide, for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("kit")
  return useMemo(
    () => ({
      service: "Kit",
      pkg: KIT_META.pkg,
      route: "/app/kit",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `# .env\n${ENV}\n\n${INSTALL}\n\n${CONFIG}`,
      demo: 'demo: process.env.KIT_DEMO === "true",',
    }),
    [t],
  )
}

export function KitGuideView({ status }: { status?: Status }) {
  const { t } = useTranslation("kit")
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
  const configured = Boolean(status?.configured)
  const tags = (status?.settings.tags.length ?? 0) > 0
  const tested = (status?.counts.subscribed ?? 0) > 0

  const steps: GuideStep[] = [
    step("install", state(loaded), ["p1"], INSTALL),
    step("config", state(loaded), ["p1"], CONFIG),
    step("key", state(configured), ["p1", "p2"], ENV),
    step("list", state(tags), ["p1"]),
    step("store", state(tested, "later"), ["p1"]),
  ]

  const done: Record<(typeof CHECKS)[number], boolean> = {
    key: configured,
    tags,
    optIn: !status?.settings.double_opt_in || status.settings.form_id !== null,
    test: tested,
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
