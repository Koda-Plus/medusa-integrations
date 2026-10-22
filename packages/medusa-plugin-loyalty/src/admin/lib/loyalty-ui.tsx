import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Cash, CogSixTooth, Eye, Gift, Star } from "@medusajs/icons"
import { Text } from "@medusajs/ui"
import type { StatusResponse } from "../../modules/loyalty/lib/contract"
import { Section, ToneBadge } from "./loyalty-blocks"

/** The settings tabs of the page (`?view=settings&tab=`). */
export const SETTINGS_TABS = ["options"] as const
export type SettingsTabId = (typeof SETTINGS_TABS)[number]

/** A number in the admin's language: 1 500, 0,05. */
export function fmtNumber(value: number, lang: string, digits = 0): string {
  try {
    return new Intl.NumberFormat(lang.startsWith("pl") ? "pl-PL" : "en-GB", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) }).format(value)
  } catch {
    return String(value)
  }
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
  const { t, i18n } = useTranslation("loyalty")
  const lang = i18n.language || "en"
  const pl = lang.startsWith("pl")
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
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label={t("settings.earn")}>
          <span className="inline-flex items-center gap-x-1.5 tabular-nums">
            <Star className="text-ui-fg-muted" />
            {fmtNumber(status.pointsPerPln, lang)}
          </span>
        </Fact>
        <Fact label={t("settings.worth")}>
          <span className="inline-flex items-center gap-x-1.5 tabular-nums">
            <Cash className="text-ui-fg-muted" />
            {fmtNumber(status.redeemRate, lang, 2)}
          </span>
        </Fact>
        <Fact label={t("settings.demo")}>
          <ToneBadge tone={status.demo ? "blue" : "grey"}>{status.demo ? t("settings.on") : t("settings.off")}</ToneBadge>
        </Fact>
        <Fact label={t("settings.rewards")}>
          {status.rewards.length ? (
            status.rewards.map((r, i) => (
              <ToneBadge key={i} tone="purple" icon={<Gift />}>
                {t("rewards.at", { count: r.at })} {pl ? r.name.pl : r.name.en}
              </ToneBadge>
            ))
          ) : (
            <span className="text-ui-fg-muted">{t("settings.rewardsNone")}</span>
          )}
        </Fact>
      </div>
    </Section>
  )
}
