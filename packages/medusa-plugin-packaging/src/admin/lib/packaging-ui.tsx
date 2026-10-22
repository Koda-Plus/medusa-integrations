import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { CogSixTooth, Eye } from "@medusajs/icons"
import { Text } from "@medusajs/ui"
import type { StatusResponse } from "../../modules/packaging/lib/contract"
import { UNIT_NAMES } from "../../modules/packaging/lib/constants"
import { Section, ToneBadge } from "./packaging-blocks"

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

/** The options in use, read only: they are set in medusa-config.ts. */
export function OptionsTab({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("packaging")
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
        <Fact label={t("settings.gs1Prefix")}>{status.gs1Prefix ? <span className="font-mono tabular-nums">{status.gs1Prefix}</span> : <span className="text-ui-fg-muted">{t("settings.none")}</span>}</Fact>
        <Fact label={t("settings.units")}>
          {UNIT_NAMES.map((u) => (
            <ToneBadge key={u}>{u}</ToneBadge>
          ))}
        </Fact>
        <Fact label={t("settings.demo")}>
          <ToneBadge tone={status.demo ? "blue" : "grey"}>{status.demo ? t("settings.on") : t("settings.off")}</ToneBadge>
        </Fact>
      </div>
    </Section>
  )
}
