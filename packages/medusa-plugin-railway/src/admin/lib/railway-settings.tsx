import { useTranslation } from "react-i18next"
import { Container, Heading, InlineTip, Text } from "@medusajs/ui"
import type { StatusResponse } from "../../modules/railway/lib/contract"

export const SETTINGS_TABS = ["options", "access"] as const
export type SettingsTabId = (typeof SETTINGS_TABS)[number]

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-1 px-6 py-3 md:grid-cols-[240px_1fr]">
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text size="small" className={mono ? "break-all font-mono text-ui-fg-base" : "text-ui-fg-base"}>
        {value}
      </Text>
    </div>
  )
}

/** The options in use, as medusa-config.ts set them. Never the token. */
export function OptionsTab({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("railway")
  const o = status.options
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("settings.tab.options")}</Heading>
      </div>
      <Row label={t("settings.options.project")} value={o.projectId ?? t("settings.options.fromToken")} mono={Boolean(o.projectId)} />
      <Row label={t("settings.options.environment")} value={o.environmentId ?? t("settings.options.fromToken")} mono={Boolean(o.environmentId)} />
      <Row label={t("settings.options.tokenEnv")} value={status.tokenEnv} mono />
      <Row label={t("settings.options.tokenKind")} value={t(`settings.options.kind.${o.tokenKind}`)} />
      <Row label={t("settings.options.dashboard")} value={o.dashboardUrl} mono />
      <Row label={t("settings.options.cache")} value={t("settings.options.cacheValue", { seconds: o.cacheSeconds })} />
      <Row label={t("settings.options.perSecond")} value={String(o.requestsPerSecond)} />
      <Row label={t("settings.options.perHour")} value={String(o.requestsPerHour)} />
      <Row label={t("settings.options.timeout")} value={t("settings.options.timeoutValue", { seconds: Math.round(o.timeoutMs / 1000) })} />
    </Container>
  )
}

/** Which token is in use, how many requests went out, and why the plugin only sends queries. */
export function AccessTab({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("railway")
  const rl = status.rateLimit
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("settings.tab.access")}</Heading>
      </div>
      <Row label={t("settings.access.kind")} value={t(`settings.access.kindValue.${status.tokenKind ?? "none"}`)} />
      <Row label={t("settings.access.used")} value={t("settings.access.usedValue", { used: status.usedThisHour, limit: status.options.requestsPerHour })} />
      <Row
        label={t("settings.access.railway")}
        value={rl && rl.remaining !== null && rl.limit !== null ? t("settings.access.railwayValue", { remaining: rl.remaining, limit: rl.limit }) : t("settings.access.railwayNone")}
      />
      <div className="flex flex-col gap-3 px-6 py-4">
        <InlineTip variant="warning" label={t("settings.access.readOnly")}>
          {t("settings.access.readOnlyText")}
        </InlineTip>
        <InlineTip variant="info" label={t("mode.readOnly")}>
          {t("settings.access.never")}
        </InlineTip>
      </div>
    </Container>
  )
}
