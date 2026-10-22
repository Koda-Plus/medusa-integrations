import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { StatusResponse } from "../../modules/whitelist/lib/contract"
import { GuideChecklist, GuideFaq, GuideIntro, GuideSteps, type GuideStep, type SetupPromptSpec, type StepState } from "./whitelist-guide"
import { KIT_META } from "./whitelist-kit-meta"

/**
 * The setup guide of the Whitelist page: what it takes, the steps with the
 * code to paste (state read from the status), the go-live checklist and the
 * FAQ. The copy lives in the i18n dictionaries under `guide`.
 */

const INSTALL = `npm install @koda-plus/medusa-plugin-vat-whitelist
npx medusa db:migrate`

const CONFIG = `module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-vat-whitelist",
      options: {
        // Everything is optional.
        staleHours: 24,
        demo: process.env.WHITELIST_DEMO === "true",
      },
    },
  ],
})`

const NEEDS = ["medusa", "gus"] as const
const CHECKS = ["preview", "status", "stale", "gus"] as const
const FAQ = ["eu", "often", "demo"] as const

/** The same setup as this guide, for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("whitelist")
  return useMemo(
    () => ({
      service: "VAT Whitelist",
      pkg: KIT_META.pkg,
      route: "/app/whitelist",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `${INSTALL}\n\n${CONFIG}`,
      demo: 'demo: process.env.WHITELIST_DEMO === "true",',
      readOnly: true,
    }),
    [t],
  )
}

export function GuideView({ status }: { status?: StatusResponse }) {
  const { t } = useTranslation("whitelist")
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
  const checked = (status?.counts.checks ?? 0) > 0

  const steps: GuideStep[] = [
    step("install", state(loaded), ["p1", "p2"], INSTALL),
    step("config", state(loaded), ["p1"], CONFIG),
    step("demo", state(Boolean(status?.demo), "optional"), ["p1", "p2"]),
    step("first", state(checked), ["p1"]),
    step("store", "later", ["p1"]),
  ]

  const done: Record<(typeof CHECKS)[number], boolean> = {
    preview: (status?.checks ?? []).some((c) => c.requested_by === "store"),
    status: (status?.entities ?? []).some((e) => Boolean(e.customer_id)),
    stale: checked,
    gus: false,
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
