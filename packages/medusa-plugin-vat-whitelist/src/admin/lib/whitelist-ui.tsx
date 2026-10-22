import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { CogSixTooth, Eye } from "@medusajs/icons"
import { Text } from "@medusajs/ui"
import type { StatusResponse } from "../../modules/whitelist/lib/contract"
import { SOURCES, type CheckState } from "../../modules/whitelist/lib/constants"
import { Section, ToneBadge, type Tone } from "./whitelist-blocks"

/** The settings tabs of the page (`?view=settings&tab=`). */
export const SETTINGS_TABS = ["options"] as const
export type SettingsTabId = (typeof SETTINGS_TABS)[number]

/** One meaning per colour: active green, exempt orange, not found and invalid red, no answer grey. */
export const STATE_TONE: Record<CheckState, Tone> = {
  active: "green",
  exempt: "orange",
  not_found: "red",
  invalid: "red",
  unavailable: "grey",
}

export function StateBadge({ state }: { state: CheckState }) {
  const { t } = useTranslation("whitelist")
  return <ToneBadge tone={STATE_TONE[state] ?? "grey"}>{t(`state.${state}`)}</ToneBadge>
}

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

/** The options in use, read only: they are set in medusa-config.ts. */
export function OptionsTab({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("whitelist")
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
        <Fact label={t("settings.staleHours")}>
          <span className="tabular-nums">{t("settings.hours", { count: status.staleHours })}</span>
        </Fact>
        <Fact label={t("settings.sources")}>
          {SOURCES.map((s) => (
            <ToneBadge key={s}>{t(`source.${s}`)}</ToneBadge>
          ))}
        </Fact>
        <Fact label={t("settings.demo")}>
          <ToneBadge tone={status.demo ? "blue" : "grey"}>{status.demo ? t("settings.on") : t("settings.off")}</ToneBadge>
        </Fact>
      </div>
    </Section>
  )
}
