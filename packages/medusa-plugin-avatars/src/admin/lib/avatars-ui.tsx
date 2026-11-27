import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { CogSixTooth, Eye } from "@medusajs/icons"
import { Text } from "@medusajs/ui"
import type { StatusResponse } from "../../modules/avatars/lib/contract"
import { Section, ToneBadge } from "./avatars-blocks"

/** The settings tabs of the page (`?view=settings&tab=`). */
export const SETTINGS_TABS = ["options"] as const
export type SettingsTabId = (typeof SETTINGS_TABS)[number]

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-1">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className="txt-small flex flex-wrap items-center gap-1.5 text-ui-fg-base">{children}</div>
    </div>
  )
}

/** The options in use, read only: they are set in medusa-config.ts, the keys in the environment. */
export function OptionsTab({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("avatars")
  const o = status.options
  const key = (on: boolean) => <ToneBadge tone={on ? "green" : "orange"} dot>{on ? t("settings.keySet") : t("settings.keyMissing")}</ToneBadge>
  const mono = (v: string | number) => <span className="font-mono tabular-nums">{v}</span>
  return (
    <Section
      icon={<CogSixTooth />}
      title={t("settings.tab.options")}
      points={[
        { icon: <Eye />, text: t("settings.points.readOnly"), tone: "blue" },
        { icon: <CogSixTooth />, text: t("settings.points.config") },
      ]}
      pointsLabel={t("settings.subtitle")}
    >
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-3">
        <Fact label={t("settings.tavus")}>{key(status.configured.tavus)}</Fact>
        <Fact label={t("settings.claude")}>{key(status.configured.claude)}</Fact>
        <Fact label={t("settings.gemini")}>{key(status.configured.gemini)}</Fact>
        <Fact label={t("settings.claudeModel")}>{mono(o.claudeModel)}</Fact>
        <Fact label={t("settings.ttsModel")}>{mono(o.ttsModel)}</Fact>
        <Fact label={t("settings.transcribeModel")}>{mono(o.transcribeModel)}</Fact>
        <Fact label={t("settings.voice")}>{mono(o.defaultVoice)}</Fact>
        <Fact label={t("settings.lang")}>{mono(o.defaultLang.toUpperCase())}</Fact>
        <Fact label={t("settings.wpm")}>{mono(o.wordsPerMinute)}</Fact>
        <Fact label={t("settings.maxMinutes")}>{mono(o.maxRenderMinutes)}</Fact>
        <Fact label={t("settings.prefix")}>{mono(o.filePrefix)}</Fact>
        <Fact label={t("settings.maxSourceMb")}>{mono(o.maxSourceMb)}</Fact>
        <Fact label={t("settings.scriptBrief")}>{key(o.scriptBrief)}</Fact>
        <Fact label={t("settings.voiceStyle")}>{key(o.voiceStyle)}</Fact>
        <Fact label={t("settings.demo")}>
          <ToneBadge tone={status.demo ? "blue" : "grey"}>{status.demo ? t("settings.on") : t("settings.off")}</ToneBadge>
        </Fact>
      </div>
    </Section>
  )
}
