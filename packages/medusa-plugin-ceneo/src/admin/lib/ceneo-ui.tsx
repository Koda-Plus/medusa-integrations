import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { CogSixTooth, Eye, ServerStack } from "@medusajs/icons"
import { Text } from "@medusajs/ui"
import type { ApiMode, StatusResponse } from "../../modules/ceneo/lib/contract"
import { Section, ToneBadge, type Tone } from "./ceneo-blocks"

/** The settings tabs of the page (`?view=settings&tab=`). */
export const SETTINGS_TABS = ["feed", "connections"] as const
export type SettingsTabId = (typeof SETTINGS_TABS)[number]

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-y-1">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className="txt-small flex min-w-0 flex-wrap items-center gap-1.5 break-all text-ui-fg-base">{children}</div>
    </div>
  )
}

function Mono({ value }: { value: string | null }) {
  const { t } = useTranslation("ceneo")
  return value ? <span className="font-mono txt-compact-xsmall">{value}</span> : <span className="text-ui-fg-muted">{t("settings.defaultValue")}</span>
}

function OptionsSection({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation("ceneo")
  return (
    <Section
      icon={<CogSixTooth />}
      title={title}
      points={[
        { icon: <Eye />, text: t("settings.points.readOnly"), tone: "blue" },
        { icon: <CogSixTooth />, text: t("settings.points.config") },
      ]}
      pointsLabel={t("settings.subtitle")}
    >
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-3">{children}</div>
    </Section>
  )
}

/** The feed options in use, read only: they are set in medusa-config.ts. */
export function FeedTab({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("ceneo")
  const f = status.feed
  return (
    <OptionsSection title={t("settings.tab.feed")}>
      <Fact label={t("settings.productUrl")}>
        <Mono value={f.productUrl} />
      </Fact>
      <Fact label={t("settings.region")}>
        <Mono value={f.regionId} />
      </Fact>
      <Fact label={t("settings.salesChannel")}>
        <Mono value={f.salesChannelId} />
      </Fact>
      <Fact label={t("settings.offerId")}>
        <ToneBadge>{t(`settings.offerIdValue.${f.offerId}`)}</ToneBadge>
      </Fact>
      <Fact label={t("settings.inStock")}>
        <ToneBadge tone="green">{t(`avail.${f.inStockAvail}`)}</ToneBadge>
      </Fact>
      <Fact label={t("settings.backorder")}>
        <ToneBadge tone="orange">{t(`avail.${f.backorderAvail}`)}</ToneBadge>
      </Fact>
      <Fact label={t("settings.outOfStock")}>
        <ToneBadge>{t(`settings.outOfStockValue.${f.outOfStock}`)}</ToneBadge>
      </Fact>
      <Fact label={t("settings.unmapped")}>
        <ToneBadge>{t(f.includeUnmapped ? "settings.unmappedValue.include" : "settings.unmappedValue.exclude")}</ToneBadge>
      </Fact>
      <Fact label={t("settings.brand")}>
        {f.brand ? <ToneBadge>{t(`settings.brandValue.${f.brand.from}`, { key: f.brand.key ?? "" })}</ToneBadge> : <span className="text-ui-fg-muted">{t("settings.brandValue.off")}</span>}
      </Fact>
      <Fact label={t("settings.interval")}>
        <span className="tabular-nums">{t("settings.minutes", { count: f.intervalMinutes })}</span>
      </Fact>
      <Fact label={t("settings.demo")}>
        <ToneBadge tone={status.demo ? "blue" : "grey"}>{status.demo ? t("settings.on") : t("settings.off")}</ToneBadge>
      </Fact>
    </OptionsSection>
  )
}

const API_TONE: Record<ApiMode, Tone> = { live: "green", demo: "blue", missing_key: "orange" }

/** Zaufane Opinie and the Ceneo API: whether each one is set. */
export function ConnectionsTab({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("ceneo")
  const r = status.reviews
  const reviews = r.rejected ? "rejected" : r.configured ? "on" : "off"
  return (
    <Section icon={<ServerStack />} title={t("settings.tab.connections")} pointsLabel={t("settings.subtitle")}>
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-3">
        <Fact label={t("settings.reviews")}>
          <ToneBadge tone={reviews === "on" ? "green" : reviews === "rejected" ? "red" : "grey"} dot>
            {t(`settings.reviewsValue.${reviews}`)}
          </ToneBadge>
        </Fact>
        <Fact label={t("settings.workDays")}>
          <span className="tabular-nums">{r.workDays === null ? t("settings.workDaysCeneo") : r.workDays === 0 ? t("settings.workDaysNow") : t("settings.workDaysValue", { count: r.workDays })}</span>
        </Fact>
        <Fact label={t("settings.api")}>
          <ToneBadge tone={API_TONE[status.api.mode]} dot>
            {t(`settings.apiValue.${status.api.mode}`)}
          </ToneBadge>
        </Fact>
        <Fact label={t("settings.timeout")}>
          <span className="tabular-nums">{t("settings.seconds", { count: Math.round(status.api.timeoutMs / 100) / 10 })}</span>
        </Fact>
      </div>
    </Section>
  )
}
