import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { StatusResponse } from "../../modules/avatars/lib/contract"
import { GuideChecklist, GuideFaq, GuideIntro, GuideSteps, type GuideStep, type SetupPromptSpec, type StepState } from "./avatars-guide"
import { KIT_META } from "./avatars-kit-meta"

/**
 * The setup guide of the AI Avatars page: what it takes, the steps with the
 * code to paste (state read from the status), the go-live checklist and the
 * FAQ. The copy lives in the i18n dictionaries under `guide`.
 */

const INSTALL = `npm install @koda-plus/medusa-plugin-avatars
npx medusa db:migrate`

const CONFIG = `module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-avatars",
      options: {
        // Keys only from the environment, never in code.
        tavusApiKey: process.env.TAVUS_API_KEY,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        geminiApiKey: process.env.GEMINI_API_KEY,
        defaultVoice: "Kore",
        defaultLang: "en",
        demo: process.env.AVATARS_DEMO === "true",
      },
    },
  ],
})`

const NEEDS = ["medusa", "tavus", "claude", "gemini", "files"] as const
const CHECKS = ["keys", "consent", "avatar", "presentation"] as const
const FAQ = ["consent", "cost", "demo", "keys"] as const

/** The same setup as this guide, for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("avatars")
  return useMemo(
    () => ({
      service: "AI Avatars",
      pkg: KIT_META.pkg,
      route: "/app/avatars",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `${INSTALL}\n\n${CONFIG}`,
      demo: 'demo: process.env.AVATARS_DEMO === "true",',
    }),
    [t],
  )
}

export function GuideView({ status }: { status?: StatusResponse }) {
  const { t } = useTranslation("avatars")
  const state = (done: boolean, otherwise: StepState = "todo"): StepState => (done ? "done" : otherwise)
  const step = (id: string, st: StepState, paras: string[], code?: string): GuideStep => ({
    id,
    title: t(`guide.steps.${id}.title`),
    state: st,
    body: paras.map((k) => <p key={k}>{t(`guide.steps.${id}.${k}`)}</p>),
    code,
    check: t(`guide.steps.${id}.check`),
  })
  const c = status?.configured
  const keys = Boolean(c?.tavus && c?.claude && c?.gemini)
  const avatars = status?.avatars ?? []
  const signed = avatars.some((a) => a.can_render)

  const steps: GuideStep[] = [
    step("install", state(Boolean(status)), ["p1", "p2"], INSTALL),
    step("config", state(keys), ["p1", "p2"], CONFIG),
    step("demo", state(Boolean(status?.demo), "optional"), ["p1"]),
    step("avatar", state(avatars.length > 0), ["p1"]),
    step("consent", state(signed), ["p1", "p2"]),
    step("presentation", state((status?.counts.presentations ?? 0) > 0), ["p1"]),
    step("store", "later", ["p1"]),
  ]

  const done: Record<(typeof CHECKS)[number], boolean> = {
    keys,
    consent: avatars.length > 0 && avatars.every((a) => a.can_render),
    avatar: signed,
    presentation: (status?.counts.presentations ?? 0) > 0,
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
