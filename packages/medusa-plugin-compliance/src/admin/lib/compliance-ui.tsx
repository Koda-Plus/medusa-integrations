import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { CogSixTooth, Eye } from "@medusajs/icons"
import { Text } from "@medusajs/ui"
import type { StatusResponse } from "../../modules/compliance/lib/contract"
import type { DsrStatus, OperatorKind } from "../../modules/compliance/lib/constants"
import { Section, ToneBadge, type Tone } from "./compliance-blocks"

/** The settings tabs of the page (`?view=settings&tab=`). */
export const SETTINGS_TABS = ["options"] as const
export type SettingsTabId = (typeof SETTINGS_TABS)[number]

/** A price in the store's units (the same units as `price.amount`, major units in the demo). */
export function fmtAmount(amount: number | null | undefined, currency: string | null | undefined, lang?: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "-"
  const code = (currency || "PLN").toUpperCase()
  try {
    return new Intl.NumberFormat((lang ?? "en").startsWith("pl") ? "pl-PL" : "en-GB", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${code}`
  }
}

/** The kind of an operator: a label, the manufacturer told apart in blue. */
export function KindBadge({ kind }: { kind: OperatorKind }) {
  const { t } = useTranslation("compliance")
  return <ToneBadge tone={kind === "manufacturer" ? "blue" : "grey"}>{t(`kind.${kind}`)}</ToneBadge>
}

const DSR_TONE: Record<DsrStatus, Tone> = {
  pending: "orange",
  in_progress: "blue",
  completed: "green",
  rejected: "grey",
}

/** A data request: waiting orange (something to do), in progress blue, done green, rejected grey. */
export function DsrStatusBadge({ status }: { status: DsrStatus }) {
  const { t } = useTranslation("compliance")
  return <ToneBadge tone={DSR_TONE[status] ?? "grey"}>{t(`status.${status}`)}</ToneBadge>
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
  const { t } = useTranslation("compliance")
  const sections = (["gpsr", "rodo", "omnibus"] as const).map((k) => ({ k, on: status.sections[k] !== false }))
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
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2">
        <Fact label={t("settings.sections")}>
          {sections.map(({ k, on }) => (
            <ToneBadge key={k} tone={on ? "green" : "grey"} title={on ? t("settings.on") : t("settings.off")}>
              {t(`tabs.${k}`)}
            </ToneBadge>
          ))}
        </Fact>
        <Fact label={t("settings.demo")}>
          <ToneBadge tone={status.demo ? "blue" : "grey"}>{status.demo ? t("settings.on") : t("settings.off")}</ToneBadge>
        </Fact>
      </div>
    </Section>
  )
}
