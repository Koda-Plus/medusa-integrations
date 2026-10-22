import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Beaker, CursorArrowRays, ExclamationCircle, EyeSlash, FloppyDisk, Key, LockClosedSolid, ShieldCheck, TruckFast } from "@medusajs/icons"
import { Button, Copy, Switch, Text, toast } from "@medusajs/ui"
import type { DeliveryMapping, Placements, StatusResponse } from "../../modules/inpostpay/lib/contract"
import { errorMessage, useInpostPayCheck, useInpostPaySettings } from "./inpostpay-api"
import { EmptyState, Section, ToneBadge } from "./inpostpay-blocks"
import { Fact } from "./inpostpay-ui"

const TYPES = ["APM", "COURIER", "DIGITAL"] as const
const PLACES: Array<keyof Placements> = ["product", "cart", "minicart", "checkout", "thank_you"]

/** Settings, Delivery: the shipping option of each InPost Pay delivery type. */
export function DeliverySection({ status: s }: { status: StatusResponse }) {
  const { t } = useTranslation("inpostpay")
  const save = useInpostPaySettings()
  const [draft, setDraft] = useState<DeliveryMapping | null>(null)
  const mapping = draft ?? s.settings.delivery
  const onSave = async () => {
    try {
      await save.mutateAsync({ delivery: mapping })
      setDraft(null)
      toast.success(t("delivery_settings.saved"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Section
      icon={<TruckFast />}
      title={t("delivery_settings.title")}
      pointsLabel={t("delivery_settings.subtitle")}
      points={[
        { icon: <TruckFast />, text: t("delivery_settings.points.option") },
        { icon: <ExclamationCircle />, text: t("delivery_settings.points.refused"), tone: "orange" },
        s.mode === "demo" && { icon: <Beaker />, text: t("delivery_settings.points.demo"), tone: "blue" },
      ]}
      actions={
        s.shippingOptions.length > 0 ? (
          <Button size="small" variant="primary" isLoading={save.isPending} disabled={!draft} onClick={() => void onSave()}>
            <FloppyDisk />
            {t("delivery_settings.save")}
          </Button>
        ) : null
      }
    >
      {s.shippingOptions.length === 0 ? (
        <EmptyState icon={<TruckFast />} title={t("delivery_settings.noOptions")} points={[{ icon: <TruckFast />, text: t("delivery_settings.noOptionsHint") }]} />
      ) : (
        <div className="flex flex-col gap-y-4 px-6 py-4">
          {TYPES.map((type) => (
            <div key={type} className="grid grid-cols-1 gap-2 md:grid-cols-[220px_1fr] md:items-start">
              <div className="flex flex-col">
                <Text size="small" weight="plus">
                  {t(`delivery.${type}`)}
                </Text>
                <Text size="xsmall" className="font-mono text-ui-fg-muted">
                  {type}
                </Text>
              </div>
              <div className="flex flex-col gap-y-1">
                <select
                  value={mapping[type] ?? ""}
                  aria-label={t(`delivery.${type}`)}
                  onChange={(e) => setDraft({ ...mapping, [type]: e.target.value || null })}
                  className="w-full max-w-md rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm text-ui-fg-base"
                >
                  <option value="">{t("delivery_settings.none")}</option>
                  {s.shippingOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {o.provider_id ? ` (${o.provider_id})` : ""}
                    </option>
                  ))}
                </select>
                <Text size="xsmall" className="max-w-xl text-ui-fg-muted">
                  {t(`delivery_settings.hint.${type}`)}
                </Text>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

/** Settings, Button: the places the storefront shows the button. */
export function ButtonSection({ status: s }: { status: StatusResponse }) {
  const { t } = useTranslation("inpostpay")
  const save = useInpostPaySettings()
  const [draft, setDraft] = useState<Placements | null>(null)
  const placements = draft ?? s.settings.placements
  const onSave = async () => {
    try {
      await save.mutateAsync({ placements })
      setDraft(null)
      toast.success(t("button_settings.saved"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Section
      icon={<CursorArrowRays />}
      title={t("button_settings.title")}
      pointsLabel={t("button_settings.subtitle")}
      points={[
        { icon: <CursorArrowRays />, text: t("button_settings.points.config") },
        { icon: <ExclamationCircle />, text: t("button_settings.points.required"), tone: "orange" },
        { icon: <EyeSlash />, text: t("button_settings.points.audit") },
      ]}
      actions={
        <Button size="small" variant="primary" isLoading={save.isPending} disabled={!draft} onClick={() => void onSave()}>
          <FloppyDisk />
          {t("button_settings.save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-y-3 px-6 py-4">
        {PLACES.map((p) => (
          <label key={p} className="flex items-center justify-between gap-3 md:max-w-md">
            <Text size="small">{t(`button_settings.${p}`)}</Text>
            <Switch checked={placements[p]} onCheckedChange={(on) => setDraft({ ...placements, [p]: on })} />
          </label>
        ))}
      </div>
    </Section>
  )
}

/** Settings, InPost account: the keys (masked), the addresses for the merchant portal, the provider, the connection check. */
export function AccountSection({ status: s }: { status: StatusResponse }) {
  const { t } = useTranslation("inpostpay")
  const check = useInpostPayCheck()
  const value = (v: string) => (v ? <span className="font-mono">{v}</span> : <span className="text-ui-fg-muted">{t("account.notSet")}</span>)
  const onCheck = async () => {
    try {
      await check.mutateAsync()
      toast.success(s.mode === "demo" ? t("account.checkDemo") : t("account.checkOk"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Section
      icon={<Key />}
      title={t("account.title")}
      pointsLabel={t("account.subtitle")}
      points={[
        { icon: <Key />, text: t("account.points.keys") },
        { icon: <LockClosedSolid />, text: t("account.points.masked"), tone: "green" },
      ]}
      actions={
        <Button size="small" variant="secondary" isLoading={check.isPending} disabled={!s.configured} onClick={() => void onCheck()}>
          <ShieldCheck />
          {check.isPending ? t("account.checking") : t("account.check")}
        </Button>
      }
    >
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Text size="small" weight="plus">
          {t("account.merchantApi")}
        </Text>
        <div className="flex items-center gap-x-2 rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
          <span className="txt-compact-small break-all font-mono text-ui-fg-base">{s.urls.merchantApi}</span>
          <Copy content={s.urls.merchantApi} className="text-ui-fg-muted" />
        </div>
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("account.merchantApiHint", { example: `${s.urls.merchantApi}/v1/izi/basket/{basket_id}` })}
        </Text>
      </div>
      <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-2">
        <Fact label={t("account.clientId")}>{value(s.options.clientId)}</Fact>
        <Fact label={t("account.clientSecret")}>{value(s.options.clientSecret)}</Fact>
        <Fact label={t("account.merchantClientId")}>{value(s.options.merchantClientId)}</Fact>
        <Fact label={t("account.posId")}>{value(s.options.posId)}</Fact>
        <Fact label={t("account.api")} mono>
          {s.urls.api}
        </Fact>
        <Fact label={t("account.widget")} mono>
          {s.urls.widget}
        </Fact>
        <Fact label={t("account.provider")}>
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{s.provider.id}</span>
            <ToneBadge tone={s.provider.registered && s.provider.enabled ? "green" : s.provider.registered ? "orange" : "red"}>
              {s.provider.registered ? (s.provider.enabled ? t("account.providerOk") : t("account.providerOff")) : t("account.providerMissing")}
            </ToneBadge>
          </span>
        </Fact>
        <Fact label={t("account.events")}>{s.options.sendOrderEvents ? t("account.eventsOn") : t("account.eventsOff")}</Fact>
        <Fact label={t("account.ttl")}>{t("account.ttlValue", { count: s.options.basketTtlHours })}</Fact>
      </div>
    </Section>
  )
}
