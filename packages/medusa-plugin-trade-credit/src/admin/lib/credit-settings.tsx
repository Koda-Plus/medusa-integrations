import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Container, Heading, InlineTip, Text } from "@medusajs/ui"
import type { StatusResponse } from "../../modules/credit/lib/contract"

/**
 * Settings of the Credit page (`?view=settings&tab=`), read only: what the
 * status already says about the options in use. Nothing here writes; the
 * options are set in medusa-config.ts (or by the store in store mode).
 */

export const SETTINGS_TABS = ["options", "store"] as const
export type SettingsTabId = (typeof SETTINGS_TABS)[number]

const DEFAULT_CHOICES = [0, 14, 30, 60]

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

function OnOff({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return (
    <Badge size="2xsmall" color={on ? "green" : "grey"}>
      {on ? onLabel : offLabel}
    </Badge>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{title}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {subtitle}
        </Text>
      </div>
      {children}
    </Container>
  )
}

/** The options in use: mode, enforcement, demo, the payment terms and what the page may change. */
export function OptionsTab({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("credit")
  const store = status.mode === "store"
  const choices = status.netDayChoices?.length ? status.netDayChoices : DEFAULT_CHOICES
  const yes = t("settings.on")
  const no = t("settings.off")
  return (
    <Section title={t("settings.options.title")} subtitle={t("settings.options.subtitle")}>
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-3">
        <Fact label={t("settings.options.mode")}>
          <Badge size="2xsmall" color={store ? "blue" : "grey"}>
            {store ? t("settings.options.modeStore") : t("settings.options.modeOwn")}
          </Badge>
        </Fact>
        <Fact label={t("settings.options.enforce")}>
          <OnOff on={status.enforce} onLabel={yes} offLabel={no} />
        </Fact>
        <Fact label={t("settings.options.demo")}>
          <OnOff on={status.demo} onLabel={yes} offLabel={no} />
        </Fact>
        <Fact label={t("settings.options.terms")}>
          {choices.map((d) => (
            <Badge key={d} size="2xsmall" color="grey">
              {d === 0 ? t("set.immediate") : t("set.net", { days: d })}
            </Badge>
          ))}
        </Fact>
        <Fact label={t("settings.options.maxDays")}>{status.maxNetDays ? t("ui.days", { days: status.maxNetDays }) : t("settings.none")}</Fact>
        <Fact label={t("settings.options.capabilities")}>
          <OnOff on={status.capabilities?.block ?? true} onLabel={t("settings.options.block")} offLabel={t("settings.options.noBlock")} />
          <OnOff on={status.capabilities?.pause ?? true} onLabel={t("settings.options.pause")} offLabel={t("settings.options.noPause")} />
        </Fact>
      </div>
      {status.ruleText ? (
        <div className="px-6 py-4">
          <InlineTip variant="info" label={t("ui.rule")}>
            {status.ruleText}
          </InlineTip>
        </div>
      ) : null}
    </Section>
  )
}

/** Reminders and documents: what the store wires into the page (store mode). */
export function StoreTab({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("credit")
  const yes = t("settings.on")
  const no = t("settings.off")
  return (
    <Section title={t("settings.store.title")} subtitle={t("settings.store.subtitle")}>
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-3">
        <Fact label={t("settings.store.reminders")}>
          <OnOff on={Boolean(status.reminders?.send)} onLabel={yes} offLabel={no} />
        </Fact>
        <Fact label={t("settings.store.emailsLog")}>
          <OnOff on={Boolean(status.reminders?.emailsLogPath)} onLabel={yes} offLabel={no} />
        </Fact>
        <Fact label={t("settings.store.documents")}>{status.documentSource?.name ?? t("settings.none")}</Fact>
        <Fact label={t("settings.store.markPaid")}>
          <OnOff on={Boolean(status.markPaidPath)} onLabel={yes} offLabel={no} />
        </Fact>
        <Fact label={t("settings.store.hideOrder")}>
          <OnOff on={Boolean(status.canHideOrder)} onLabel={yes} offLabel={no} />
        </Fact>
      </div>
      {status.mode !== "store" ? (
        <div className="px-6 py-4">
          <InlineTip variant="info" label={t("settings.store.ownLabel")}>
            {t("settings.store.ownText")}
          </InlineTip>
        </div>
      ) : null}
    </Section>
  )
}
