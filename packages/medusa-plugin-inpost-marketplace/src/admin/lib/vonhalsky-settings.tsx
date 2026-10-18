import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Button, InlineTip, Input, Switch, Text, toast } from "@medusajs/ui"
import type { StatusResponse, VonHalskySettings } from "../../modules/vonhalsky/lib/contract"
import { errorMessage, useSaveSettings } from "./vonhalsky-api"
import { Fact, Section, fmtMoney } from "./vonhalsky-ui"

const TYPES = ["APM", "COURIER"] as const
const SELECT = "w-full max-w-md rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm text-ui-fg-base"

/** The channel price of 100.00, as the plugin computes it (the admin preview of the markup). */
function example(markup: number, s: StatusResponse): number {
  const includes = s.options.pricesIncludeTaxNow
  const gross = includes ? 100 : 100 * (1 + s.options.vatRate / 100)
  return Math.round(gross * (1 + markup / 100) * 100) / 100
}

/** Settings, Pricing: the channel markup. */
export function PricingSection({ status: s, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const save = useSaveSettings()
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? String(s.settings.pricing.markupPercent)
  const n = Number(value.replace(",", "."))
  const valid = Number.isFinite(n) && n >= -50 && n <= 300
  const onSave = async () => {
    try {
      await save.mutateAsync({ pricing: { markupPercent: n } })
      setDraft(null)
      toast.success(t("toast.saved"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Section title={t("pricing.title")} subtitle={t("pricing.subtitle")}>
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <label className="flex max-w-xs flex-col gap-y-1">
          <Text size="small" weight="plus">
            {t("pricing.markup")}
          </Text>
          <Input size="small" value={value} onChange={(e) => setDraft(e.target.value)} />
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("pricing.markupHint")}
          </Text>
        </label>
        <Text size="small" className="text-ui-fg-subtle">
          {t("pricing.vat", { rate: s.options.vatRate })}
        </Text>
        <Text size="small" className="text-ui-fg-subtle">
          {t("pricing.taxIncluded", { value: `${s.options.pricesIncludeTaxNow ? t("pricing.yes") : t("pricing.no")}${s.options.pricesIncludeTax === null ? ` (${t("pricing.taxAuto")})` : ""}` })}
        </Text>
        {valid ? (
          <Text size="small" className="text-ui-fg-subtle">
            {t("pricing.example", { price: fmtMoney(example(n, s), "pln", lang) })}
          </Text>
        ) : null}
        <div>
          <Button size="small" variant="primary" isLoading={save.isPending} disabled={draft === null || !valid} onClick={() => void onSave()}>
            {t("actions.save")}
          </Button>
        </div>
      </div>
    </Section>
  )
}

/** Settings, Orders: the sales channel, the region, the automatic import. */
export function OrderSettingsSection({ status: s }: { status: StatusResponse }) {
  const { t } = useTranslation("vonhalsky")
  const save = useSaveSettings()
  const [draft, setDraft] = useState<VonHalskySettings["orders"] | null>(null)
  const v = draft ?? s.settings.orders
  const pln = s.regions.filter((r) => r.currency === "pln")
  const onSave = async () => {
    try {
      await save.mutateAsync({ orders: v })
      setDraft(null)
      toast.success(t("toast.saved"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Section title={t("orderSettings.title")} subtitle={t("orderSettings.subtitle")}>
      <div className="flex flex-col gap-y-4 px-6 py-4">
        <label className="flex flex-col gap-y-1">
          <Text size="small" weight="plus">
            {t("orderSettings.channel")}
          </Text>
          <select className={SELECT} value={v.salesChannelId ?? ""} onChange={(e) => setDraft({ ...v, salesChannelId: e.target.value || null })}>
            <option value="">{t("orderSettings.automatic")}</option>
            {s.salesChannels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-y-1">
          <Text size="small" weight="plus">
            {t("orderSettings.region")}
          </Text>
          <select className={SELECT} value={v.regionId ?? ""} onChange={(e) => setDraft({ ...v, regionId: e.target.value || null })}>
            <option value="">{t("orderSettings.automatic")}</option>
            {pln.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("orderSettings.now", { channel: s.target.salesChannel?.name ?? t("orderSettings.none"), region: s.target.region?.name ?? t("orderSettings.none") })}
        </Text>
        <label className="flex items-start justify-between gap-3 md:max-w-xl">
          <span className="flex flex-col">
            <Text size="small">{t("orderSettings.autoImport")}</Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("orderSettings.autoImportHint")}
            </Text>
          </span>
          <Switch checked={v.autoImport} onCheckedChange={(on) => setDraft({ ...v, autoImport: on })} />
        </label>
        <div>
          <Button size="small" variant="primary" isLoading={save.isPending} disabled={!draft} onClick={() => void onSave()}>
            {t("actions.save")}
          </Button>
        </div>
      </div>
    </Section>
  )
}

/** Settings, Shipping: the Medusa shipping option of each marketplace delivery type. */
export function ShippingSection({ status: s }: { status: StatusResponse }) {
  const { t } = useTranslation("vonhalsky")
  const save = useSaveSettings()
  const [draft, setDraft] = useState<VonHalskySettings["shipping"] | null>(null)
  const mapping = draft ?? s.settings.shipping
  const onSave = async () => {
    try {
      await save.mutateAsync({ shipping: mapping })
      setDraft(null)
      toast.success(t("toast.saved"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Section title={t("shipping.title")} subtitle={t("shipping.subtitle")}>
      {s.shippingOptions.length === 0 ? (
        <Text size="small" className="px-6 py-4 text-ui-fg-subtle">
          {t("shipping.noOptions")}
        </Text>
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
                <select className={SELECT} value={mapping[type] ?? ""} onChange={(e) => setDraft({ ...mapping, [type]: e.target.value || null })}>
                  <option value="">{t("shipping.none")}</option>
                  {s.shippingOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {o.provider_id ? ` (${o.provider_id})` : ""}
                    </option>
                  ))}
                </select>
                <Text size="xsmall" className="max-w-xl text-ui-fg-muted">
                  {t(`shipping.hint.${type}`)}
                </Text>
              </div>
            </div>
          ))}
          <div>
            <Button size="small" variant="primary" isLoading={save.isPending} disabled={!draft} onClick={() => void onSave()}>
              {t("actions.save")}
            </Button>
          </div>
        </div>
      )}
    </Section>
  )
}

/** Settings, Account: the credentials in use (the token masked), the writer, the matching keys, the compliance plugin. */
export function AccountSection({ status: s }: { status: StatusResponse }) {
  const { t } = useTranslation("vonhalsky")
  const value = (v: string) => (v ? <span className="font-mono">{v}</span> : <span className="text-ui-fg-muted">{t("account.notSet")}</span>)
  return (
    <Section title={t("account.title")} subtitle={t("account.subtitle")}>
      {s.apiPending ? (
        <div className="px-6 py-4">
          <InlineTip variant="info" label={t("account.pendingTitle")}>
            {t("account.pendingText")}
          </InlineTip>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-2">
        <Fact label={t("account.environment")}>
          <Badge size="2xsmall" color={s.environment === "live" ? "green" : "blue"}>
            {t(`mode.${s.environment}`)}
          </Badge>
        </Fact>
        <Fact label={t("account.apiUrl")} mono>
          {value(s.options.apiUrl)}
        </Fact>
        <Fact label={t("account.organizationId")}>{value(s.options.organizationId)}</Fact>
        <Fact label={t("account.accessToken")}>{value(s.options.accessToken)}</Fact>
        <Fact label={t("account.tracking")}>{s.options.sendTracking ? t("account.trackingOn") : t("account.trackingOff")}</Fact>
        <Fact label={t("account.keys")}>
          <span className="font-mono">
            {s.options.brandKey}, {s.options.mpnKey}, {s.options.eanKey}
          </span>
        </Fact>
        <Fact label={t("account.compliance")}>{s.compliance ? t("account.complianceOn") : t("account.complianceOff")}</Fact>
      </div>
    </Section>
  )
}
