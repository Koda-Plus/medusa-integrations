import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Bolt, Buildings, CheckCircle, CogSixTooth, CreditCard, Eye, GlobeEurope, Key, ServerStack, XCircle } from "@medusajs/icons"
import { Button, Text } from "@medusajs/ui"
import type { Activity, RegistryModeDto, RegistryTestResponse, StatusResponse } from "../../modules/whitelist/lib/contract"
import type { CheckSource, CheckState } from "../../modules/whitelist/lib/constants"
import { Section, ToneBadge, type Tone } from "./whitelist-blocks"
import { useTestRegistry } from "./whitelist-api"

/** The settings tabs of the page (`?view=settings&tab=`). */
export const SETTINGS_TABS = ["registries", "options"] as const
export type SettingsTabId = (typeof SETTINGS_TABS)[number]

/** One meaning per colour: active green, exempt orange, not found, invalid and closed red, no answer grey. */
export const STATE_TONE: Record<CheckState, Tone> = {
  active: "green",
  exempt: "orange",
  inactive: "red",
  not_found: "red",
  invalid: "red",
  unavailable: "grey",
}

export function StateBadge({ state }: { state: CheckState }) {
  const { t } = useTranslation("whitelist")
  return <ToneBadge tone={STATE_TONE[state] ?? "grey"}>{t(`state.${state}`)}</ToneBadge>
}

const ACTIVITY_TONE: Record<Activity, Tone> = { active: "green", suspended: "orange", closed: "red" }

/** GUS: whether the business runs. */
export function ActivityBadge({ activity }: { activity: Activity }) {
  const { t } = useTranslation("whitelist")
  return <ToneBadge tone={ACTIVITY_TONE[activity]}>{t(`activity.${activity}`)}</ToneBadge>
}

/** One registry's answer in a check: its name and what it said. */
export function RegistryAnswer({ source, state, reason }: { source: CheckSource; state: CheckState; reason?: string | null }) {
  const { t } = useTranslation("whitelist")
  return (
    <ToneBadge tone={STATE_TONE[state] ?? "grey"} dot title={reason ? t("registries.reason", { reason }) : undefined}>
      {t(`source.${source}`)}: {t(`state.${state}`)}
    </ToneBadge>
  )
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

const MODE_TONE: Record<RegistryModeDto, Tone> = { live: "green", demo: "blue", missing_key: "orange", off: "grey" }

function ModeTag({ mode }: { mode: RegistryModeDto }) {
  const { t } = useTranslation("whitelist")
  return (
    <ToneBadge tone={MODE_TONE[mode]} dot>
      {t(`registries.mode.${mode}`)}
    </ToneBadge>
  )
}

type RegistryId = RegistryTestResponse["registry"]

/** One registry: what it gives, when it is asked, how it answers now and a connection test. */
function RegistryRow({ id, mode, icon, facts, order }: { id: RegistryId; mode: RegistryModeDto; icon: ReactNode; facts?: ReactNode; order: number | null }) {
  const { t } = useTranslation("whitelist")
  const test = useTestRegistry()
  const last = test.data && test.data.registry === id ? test.data : null
  return (
    <div className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-ui-border-base bg-ui-bg-subtle text-ui-fg-subtle">{icon}</span>
        <div className="flex min-w-0 flex-col gap-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Text size="small" weight="plus" className="text-ui-fg-base">
              {t(`registries.${id}.name`)}
            </Text>
            <ModeTag mode={mode} />
            {order !== null ? <ToneBadge>{t("registries.order", { n: order })}</ToneBadge> : null}
          </div>
          <Text size="small" className="text-ui-fg-subtle">
            {t(`registries.${id}.gives`)}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {t(`registries.${id}.when`)}
          </Text>
          {mode === "missing_key" ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              {t(`registries.${id}.missing`)}
            </Text>
          ) : null}
          {facts}
          {last ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <ToneBadge tone={last.ok ? "green" : "red"} icon={last.ok ? <CheckCircle /> : <XCircle />}>
                {last.ok ? t("registries.test.ok", { ms: last.ms }) : t("registries.test.fail")}
              </ToneBadge>
              {!last.ok ? (
                <Text size="xsmall" className="text-ui-fg-muted">
                  {t(`registries.test.messages.${last.message}`, { defaultValue: last.message })}
                </Text>
              ) : null}
            </div>
          ) : null}
          {test.isError ? (
            <Text size="xsmall" className="text-ui-fg-error">
              {test.error.message}
            </Text>
          ) : null}
        </div>
      </div>
      <Button size="small" variant="secondary" isLoading={test.isPending} disabled={mode === "off" || mode === "missing_key"} onClick={() => test.mutate(id)}>
        <Bolt />
        {t("registries.test.run")}
      </Button>
    </div>
  )
}

/** The registries: GUS, the MF whitelist and VIES, how each one answers now, with a connection test. */
export function RegistriesTab({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("whitelist")
  const r = status.registries
  const order = (id: "gus" | "whitelist" | "vies") => (r.pl.includes(id) ? r.pl.indexOf(id) + 1 : null)
  return (
    <Section
      icon={<ServerStack />}
      title={t("settings.tab.registries")}
      points={[
        { icon: <Buildings />, text: t("registries.points.pl") },
        { icon: <GlobeEurope />, text: t("registries.points.eu") },
        { icon: <Bolt />, text: t("registries.points.test") },
      ]}
      pointsLabel={t("registries.lead")}
    >
      <RegistryRow
        id="gus"
        mode={r.gus.mode}
        icon={<Buildings />}
        order={order("gus")}
        facts={
          <div className="flex flex-wrap gap-2 pt-1">
            <ToneBadge icon={<Key />}>{r.gus.key ? t("registries.gus.keySet") : t("registries.gus.keyMissing")}</ToneBadge>
            <ToneBadge>{t(`registries.gus.env.${r.gus.environment}`)}</ToneBadge>
          </div>
        }
      />
      <RegistryRow id="whitelist" mode={r.whitelist.mode} icon={<CreditCard />} order={order("whitelist")} />
      <RegistryRow id="vies" mode={r.vies.mode} icon={<GlobeEurope />} order={order("vies")} />
    </Section>
  )
}

/** The options in use, read only: they are set in medusa-config.ts. */
export function OptionsTab({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("whitelist")
  const r = status.registries
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
        <Fact label={t("settings.plRegistries")}>
          {r.pl.map((s, i) => (
            <ToneBadge key={s}>
              {i + 1}. {t(`source.${s}`)}
            </ToneBadge>
          ))}
        </Fact>
        <Fact label={t("settings.euRegistry")}>
          <ToneBadge>{t("source.vies")}</ToneBadge>
        </Fact>
        <Fact label={t("settings.demo")}>
          <ToneBadge tone={status.demo ? "blue" : "grey"}>{status.demo ? t("settings.on") : t("settings.off")}</ToneBadge>
        </Fact>
        <Fact label={t("settings.live")}>
          {status.demo && r.live.length > 0 ? r.live.map((s) => <ToneBadge key={s} tone="green">{t(`source.${s}`)}</ToneBadge>) : <span className="text-ui-fg-muted">-</span>}
        </Fact>
        <Fact label={t("settings.timeout")}>
          <span className="tabular-nums">{t("settings.seconds", { count: Math.round(r.timeoutMs / 100) / 10 })}</span>
        </Fact>
      </div>
    </Section>
  )
}
