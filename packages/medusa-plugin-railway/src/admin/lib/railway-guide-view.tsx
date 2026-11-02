import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { StatusResponse } from "../../modules/railway/lib/contract"
import { GuideFaq, GuideIntro, GuideSteps, type GuideStep, type SetupPromptSpec } from "./railway-guide"

/*
 * THE SETUP GUIDE: a project token, one variable, the plugin entry. The
 * state of each step comes from the status of this backend. Every sentence
 * is in the i18n files; the configuration below is the same one "Copy
 * prompt" hands to an agent.
 */

const NEEDS = ["railway", "owner", "backend"] as const

export function envCode(tokenEnv = "RAILWAY_READ_TOKEN"): string {
  return `# Railway, the backend service: Variables
${tokenEnv}=<project token>   # Project Settings, Tokens; never commit it`
}

export function pluginCode(tokenEnv = "RAILWAY_READ_TOKEN"): string {
  return `plugins: [
  {
    resolve: "@koda-plus/medusa-plugin-railway",
    options: {
      token: process.env.${tokenEnv}, // a project token names its project and environment
      // projectId: "...",            // only with an account or workspace token
      // environmentId: "...",        // default: the token's (or "production")
      // cacheSeconds: 60,
      // requestsPerHour: 300,        // the plugin's own cap (Railway Hobby: 1 000 for the account)
    },
  },
],`
}

/** The same setup as the guide, for "Copy prompt" in the page header. */
export function usePromptSpec(status?: StatusResponse): SetupPromptSpec {
  const { t } = useTranslation("railway")
  const env = status?.tokenEnv ?? "RAILWAY_READ_TOKEN"
  return useMemo(
    () => ({
      service: "Railway",
      pkg: "@koda-plus/medusa-plugin-railway",
      route: "/app/railway",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `${envCode(env)}\n\n${pluginCode(env)}`,
      /* Only an explicit switch: a missing token shows the setup, never sample data. */
      demo: 'demo: process.env.RAILWAY_DEMO === "true",',
      readOnly: true,
      migrations: false,
    }),
    [t, env],
  )
}

export function GuideView({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("railway")
  const p = (key: string) => <p key={key}>{t(key)}</p>
  const configured = status.configured
  const steps: GuideStep[] = [
    {
      id: "token",
      title: t("guide.step.token.title"),
      state: configured ? "done" : "todo",
      body: [p("guide.step.token.body1"), p("guide.step.token.body2")],
      link: { label: t("guide.step.token.link"), href: "https://docs.railway.com/integrations/api#project-token" },
      check: t("guide.step.token.check"),
    },
    {
      id: "env",
      title: t("guide.step.env.title"),
      state: configured ? "done" : "todo",
      body: [p("guide.step.env.body1"), p("guide.step.env.body2")],
      code: envCode(status.tokenEnv),
      check: t("guide.step.env.check"),
    },
    {
      id: "config",
      title: t("guide.step.config.title"),
      state: "done",
      body: [p("guide.step.config.body1")],
      code: pluginCode(status.tokenEnv),
      check: t("guide.step.config.check"),
    },
    {
      id: "panel",
      title: t("guide.step.panel.title"),
      state: status.tokenKind ? "done" : "later",
      body: [p("guide.step.panel.body1")],
      check: t("guide.step.panel.check"),
    },
  ]
  return (
    <>
      <GuideIntro
        title={t("guide.intro.title")}
        text={t("guide.intro.text")}
        time={t("guide.intro.time")}
        timeLabel={t("guide.intro.timeLabel")}
        needs={NEEDS.map((k) => t(`guide.intro.needs.${k}`))}
        needsLabel={t("guide.intro.needsLabel")}
      />
      <GuideSteps
        title={t("guide.title")}
        steps={steps}
        stateLabels={{ done: t("guide.stateLabels.done"), todo: t("guide.stateLabels.todo"), optional: t("guide.stateLabels.optional"), later: t("guide.stateLabels.later") }}
        checkLabel={t("guide.check")}
        copyLabel={t("guide.copy")}
        copiedLabel={t("guide.copied")}
      />
      <GuideFaq
        title={t("guide.faq.title")}
        items={[
          { q: t("guide.faq.q1"), a: t("guide.faq.a1") },
          { q: t("guide.faq.q2"), a: t("guide.faq.a2") },
          { q: t("guide.faq.q3"), a: t("guide.faq.a3") },
        ]}
      />
    </>
  )
}
