import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowPath, Beaker, CheckCircle, Clock, CurrencyDollar, FloppyDisk, FolderOpen, Key, LockClosedSolid, MapPin, ShoppingCart, Tag, TruckFast } from "@medusajs/icons"
import { Button, InlineTip, Input, Switch, Table, Text, Textarea, toast } from "@medusajs/ui"
import type { CheckResponse, OfferDefaults, StatusResponse, VonHalskySettings } from "../../modules/vonhalsky/lib/contract"
import { SYNC_PARTS, errorMessage, useCheckConnection, useSaveSettings, useSyncCategories, useSyncNow, useVonHalskyCategoryMap, type SyncReport } from "./vonhalsky-api"
import { EmptyState, EmptyTableRow, SearchInput, Section, ToneBadge, useDebouncedValue } from "./vonhalsky-blocks"
import { CategoryPicker } from "./vonhalsky-category-picker"
import { KitFetchingBar, KitSkeletonRows } from "./vonhalsky-kit"
import { Fact, fmtDateTime, fmtMoney, fmtNumber } from "./vonhalsky-ui"

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
    <Section
      icon={<CurrencyDollar />}
      title={t("pricing.title")}
      pointsLabel={t("pricing.subtitle")}
      points={[
        { icon: <CurrencyDollar />, text: t("pricing.points.gross") },
        { icon: <Tag />, text: t("pricing.points.fixed") },
      ]}
      actions={
        <Button size="small" variant="primary" isLoading={save.isPending} disabled={draft === null || !valid} onClick={() => void onSave()}>
          <FloppyDisk />
          {t("actions.save")}
        </Button>
      }
    >
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
    <Section
      icon={<ShoppingCart />}
      title={t("orderSettings.title")}
      pointsLabel={t("orderSettings.subtitle")}
      points={[
        { icon: <ShoppingCart />, text: t("orderSettings.points.where") },
        { icon: <Clock />, text: t("orderSettings.points.auto") },
      ]}
      actions={
        <Button size="small" variant="primary" isLoading={save.isPending} disabled={!draft} onClick={() => void onSave()}>
          <FloppyDisk />
          {t("actions.save")}
        </Button>
      }
    >
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
        {s.target.channelNote ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {s.target.channelNote}
          </Text>
        ) : null}
        <label className="flex items-start justify-between gap-3 md:max-w-xl">
          <span className="flex flex-col">
            <Text size="small">{t("orderSettings.autoImport")}</Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("orderSettings.autoImportHint")}
            </Text>
          </span>
          <Switch checked={v.autoImport} onCheckedChange={(on) => setDraft({ ...v, autoImport: on })} />
        </label>
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
    <Section
      icon={<TruckFast />}
      title={t("shipping.title")}
      pointsLabel={t("shipping.subtitle")}
      points={[
        { icon: <TruckFast />, text: t("shipping.points.option") },
        { icon: <MapPin />, text: t("shipping.points.locker") },
        s.mode === "demo" && { icon: <Beaker />, text: t("shipping.points.demo"), tone: "blue" },
      ]}
      actions={
        s.shippingOptions.length > 0 ? (
          <Button size="small" variant="primary" isLoading={save.isPending} disabled={!draft} onClick={() => void onSave()}>
            <FloppyDisk />
            {t("actions.save")}
          </Button>
        ) : null
      }
    >
      {s.shippingOptions.length === 0 ? (
        <EmptyState icon={<TruckFast />} title={t("shipping.noOptions")} />
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
        </div>
      )}
    </Section>
  )
}

/** Settings, Offers: what every offer needs and Medusa does not keep (days to ship, return and complaint texts), and the price and stock writer. */
export function OfferDefaultsSection({ status: s }: { status: StatusResponse }) {
  const { t } = useTranslation("vonhalsky")
  const save = useSaveSettings()
  const [draft, setDraft] = useState<OfferDefaults | null>(null)
  const [daysText, setDaysText] = useState<string | null>(null)
  const v = draft ?? s.settings.offerDefaults
  const daysValue = daysText ?? String(v.daysToShip)
  const days = daysValue.trim() === "" ? Number.NaN : Number(daysValue)
  const valid = Number.isInteger(days) && days >= 0 && days <= 60
  const onSave = async () => {
    try {
      await save.mutateAsync({ offer_defaults: { ...v, daysToShip: days } })
      setDraft(null)
      setDaysText(null)
      toast.success(t("toast.saved"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Section
      icon={<Tag />}
      title={t("offerDefaults.title")}
      pointsLabel={t("offerDefaults.subtitle")}
      points={[
        { icon: <Clock />, text: t("offerDefaults.points.days") },
        { icon: <Tag />, text: t("offerDefaults.points.policies") },
        { icon: <ArrowPath />, text: v.syncPriceStock ? t("offerDefaults.points.syncOn") : t("offerDefaults.points.syncOff"), tone: v.syncPriceStock ? "green" : "grey" },
      ]}
      actions={
        <Button size="small" variant="primary" isLoading={save.isPending} disabled={!draft || !valid} onClick={() => void onSave()}>
          <FloppyDisk />
          {t("actions.save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-y-4 px-6 py-4">
        <label className="flex max-w-xs flex-col gap-y-1">
          <Text size="small" weight="plus">
            {t("offerDefaults.daysToShip")}
          </Text>
          <Input size="small" type="number" min={0} max={60} step={1} value={daysValue} onChange={(e) => (setDaysText(e.target.value), setDraft({ ...v }))} />
          <Text size="xsmall" className={valid ? "text-ui-fg-muted" : "text-ui-tag-red-text"}>
            {t("offerDefaults.daysHint")}
          </Text>
        </label>
        <label className="flex max-w-2xl flex-col gap-y-1">
          <Text size="small" weight="plus">
            {t("offerDefaults.returnPolicy")}
          </Text>
          <Textarea rows={4} value={v.returnPolicy} maxLength={5000} onChange={(e) => setDraft({ ...v, returnPolicy: e.target.value })} placeholder={t("offerDefaults.policyPlaceholder")} />
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("offerDefaults.returnHint")}
          </Text>
        </label>
        <label className="flex max-w-2xl flex-col gap-y-1">
          <Text size="small" weight="plus">
            {t("offerDefaults.complaintPolicy")}
          </Text>
          <Textarea rows={4} value={v.complaintPolicy} maxLength={5000} onChange={(e) => setDraft({ ...v, complaintPolicy: e.target.value })} placeholder={t("offerDefaults.policyPlaceholder")} />
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("offerDefaults.complaintHint")}
          </Text>
        </label>
        <label className="flex items-start justify-between gap-3 md:max-w-xl">
          <span className="flex flex-col">
            <Text size="small">{t("offerDefaults.syncPriceStock")}</Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("offerDefaults.syncHint")}
            </Text>
          </span>
          <Switch checked={v.syncPriceStock} onCheckedChange={(on) => setDraft({ ...v, syncPriceStock: on })} />
        </label>
      </div>
    </Section>
  )
}

/** Settings, Categories: each Medusa category to a marketplace leaf, so offers get a category without picking one by hand. */
export function CategoryMappingSection({ status: s, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const map = useVonHalskyCategoryMap()
  const save = useSaveSettings()
  const syncTree = useSyncCategories()
  const [input, setInput] = useState("")
  const q = useDebouncedValue(input.trim().toLowerCase())
  const [busy, setBusy] = useState<string | null>(null)
  const rows = (map.data?.medusa ?? []).filter((c) => !q || c.path.toLowerCase().includes(q) || (c.mapped?.path ?? "").toLowerCase().includes(q))
  const mappedCount = (map.data?.medusa ?? []).filter((c) => c.mapped).length
  const noTree = s.categories.count === 0

  const write = async (id: string, leaf: string | null) => {
    setBusy(id)
    try {
      await save.mutateAsync({ categories: { [id]: leaf } })
      toast.success(leaf ? t("toast.mapped") : t("toast.unmapped"))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  const onSyncTree = async () => {
    try {
      const r = await syncTree.mutateAsync()
      toast.success(t("toast.categoriesSynced", { count: r.count, leaves: r.leaves }))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Section
      icon={<FolderOpen />}
      title={t("categoryMap.title")}
      pointsLabel={t("categoryMap.subtitle")}
      points={[
        { icon: <FolderOpen />, text: t("categoryMap.points.leaf") },
        { icon: <Tag />, text: t("categoryMap.points.manualWins") },
        { icon: <CheckCircle />, text: t("categoryMap.points.mapped", { mapped: mappedCount, count: map.data?.medusa.length ?? 0 }), tone: mappedCount > 0 ? "green" : "grey" },
      ]}
      actions={
        <>
          <SearchInput value={input} onChange={setInput} placeholder={t("categoryMap.search")} className="sm:w-64" />
          <Button size="small" variant="secondary" isLoading={syncTree.isPending} disabled={s.mode === "off"} onClick={() => void onSyncTree()}>
            <ArrowPath />
            {t("actions.syncCategories")}
          </Button>
        </>
      }
    >
      <div className="px-6 py-3">
        <Text size="xsmall" className="text-ui-fg-muted">
          {noTree ? t("categoryMap.noTree") : t("categoryMap.tree", { count: s.categories.count, date: fmtDateTime(s.categories.syncedAt, lang) || t("account.never") })}
        </Text>
      </div>
      <KitFetchingBar active={map.isFetching && !map.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("categoryMap.medusa")}</Table.HeaderCell>
              <Table.HeaderCell>{t("categoryMap.marketplace")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {map.isLoading ? <KitSkeletonRows cols={2} rows={4} /> : null}
            {map.isError ? <EmptyTableRow cols={2} icon={<FolderOpen />} title={errorMessage(map.error)} /> : null}
            {!map.isLoading && !map.isError && rows.length === 0 ? <EmptyTableRow cols={2} icon={<FolderOpen />} title={q ? t("categoryMap.emptyFiltered") : t("categoryMap.empty")} /> : null}
            {rows.map((c) => (
              <Table.Row key={c.id} className="[&_td]:py-2.5 align-top">
                <Table.Cell>
                  <span className="flex flex-col">
                    <span className="txt-compact-small-plus text-ui-fg-base">{c.name}</span>
                    {c.path !== c.name ? <span className="txt-compact-xsmall text-ui-fg-muted">{c.path}</span> : null}
                  </span>
                </Table.Cell>
                <Table.Cell className="max-w-[420px]">
                  <CategoryPicker
                    value={c.mapped?.path ?? null}
                    placeholder={t("categoryMap.pick")}
                    disabled={noTree || busy === c.id}
                    onPick={(leaf) => void write(c.id, leaf.id)}
                    onClear={() => void write(c.id, null)}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

/** Settings, Account: the credentials in use (masked), the connection check, the sync and the category tree, the matching keys. */
export function AccountSection({ status: s, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const check = useCheckConnection()
  const sync = useSyncNow()
  const syncTree = useSyncCategories()
  const [checked, setChecked] = useState<CheckResponse | null>(null)
  const [report, setReport] = useState<SyncReport | null>(null)
  const off = s.mode === "off"
  const value = (v: string) => (v ? <span className="font-mono">{v}</span> : <span className="text-ui-fg-muted">{t("account.notSet")}</span>)
  const limits = s.limits

  const onCheck = async () => {
    try {
      setChecked(await check.mutateAsync())
    } catch (e) {
      setChecked({ ok: false, organization: null, message: errorMessage(e) })
    }
  }
  const onSync = async () => {
    try {
      const r = await sync.mutateAsync()
      setReport(r.report)
      const failed = Object.values(r.report).filter((p) => p && !p.ok).length
      if (failed > 0) toast.warning(t("toast.syncPartly", { count: failed }))
      else toast.success(t("toast.synced"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const onSyncTree = async () => {
    try {
      const r = await syncTree.mutateAsync()
      toast.success(t("toast.categoriesSynced", { count: r.count, leaves: r.leaves }))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <Section
        icon={<Key />}
        title={t("account.title")}
        pointsLabel={t("account.subtitle")}
        points={[
          { icon: <Key />, text: t("account.points.config") },
          { icon: <LockClosedSolid />, text: t("account.points.masked"), tone: "green" },
          { icon: <ArrowPath />, text: t("account.points.oauth") },
        ]}
        actions={
          <>
            <Button size="small" variant="secondary" isLoading={check.isPending} disabled={off} onClick={() => void onCheck()}>
              <CheckCircle />
              {t("actions.checkConnection")}
            </Button>
            <Button size="small" variant="primary" isLoading={sync.isPending} disabled={off} onClick={() => void onSync()}>
              <ArrowPath />
              {t("actions.syncNow")}
            </Button>
          </>
        }
      >
        {checked ? (
          <div className="px-6 py-4">
            <InlineTip variant={checked.ok ? "success" : "error"} label={checked.ok ? t("account.checkOk") : t("account.checkFailed")}>
              {checked.ok ? t("account.checkOkText", { organization: checked.organization ?? s.options.organizationId }) : checked.message ?? t("account.checkFailed")}
            </InlineTip>
          </div>
        ) : null}
        {report ? <SyncReportList report={report} /> : null}
        <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-2">
          <Fact label={t("account.environment")}>
            <ToneBadge tone={s.environment === "live" ? "green" : "orange"}>{t(`mode.${s.environment}`)}</ToneBadge>
          </Fact>
          <Fact label={t("account.organizationId")}>{value(s.options.organizationId)}</Fact>
          <Fact label={t("account.apiUrl")} mono>
            {value(s.options.apiUrl)}
          </Fact>
          <Fact label={t("account.tokenUrl")} mono>
            {value(s.options.tokenUrl)}
          </Fact>
          <Fact label={t("account.clientId")}>{value(s.options.clientId)}</Fact>
          <Fact label={t("account.clientSecret")}>{value(s.options.clientSecret)}</Fact>
          <Fact label={t("account.limits")}>
            {limits && limits.limit !== null ? (
              <span className="tabular-nums">
                {t("account.limitsValue", { remaining: fmtNumber(limits.remaining ?? 0, lang), limit: fmtNumber(limits.limit, lang) })}
                {limits.resetAt ? <span className="text-ui-fg-muted"> {t("account.limitsReset", { date: fmtDateTime(limits.resetAt, lang) })}</span> : null}
              </span>
            ) : (
              <span className="text-ui-fg-muted">{t("account.limitsNone")}</span>
            )}
          </Fact>
          <Fact label={t("account.lastSync")}>{s.lastSyncAt ? fmtDateTime(s.lastSyncAt, lang) : <span className="text-ui-fg-muted">{t("account.never")}</span>}</Fact>
          <Fact label={t("account.keys")}>
            <span className="font-mono">
              {s.options.brandKey}, {s.options.mpnKey}, {s.options.eanKey}
            </span>
          </Fact>
          <Fact label={t("account.units")}>
            <span className="font-mono">
              {s.options.dimensionUnit}, {s.options.weightUnit}
            </span>
          </Fact>
          <Fact label={t("account.compliance")}>{s.compliance ? t("account.complianceOn") : t("account.complianceOff")}</Fact>
        </div>
      </Section>
      <Section
        icon={<FolderOpen />}
        title={t("account.categoriesTitle")}
        pointsLabel={t("account.categoriesSubtitle")}
        points={[
          { icon: <FolderOpen />, text: t("account.categoriesCount", { count: s.categories.count }), tone: s.categories.count > 0 ? "green" : "orange" },
          { icon: <Clock />, text: s.categories.syncedAt ? t("account.categoriesSynced", { date: fmtDateTime(s.categories.syncedAt, lang) }) : t("account.categoriesNever") },
        ]}
        actions={
          <Button size="small" variant="secondary" isLoading={syncTree.isPending} disabled={off} onClick={() => void onSyncTree()}>
            <ArrowPath />
            {t("actions.syncCategories")}
          </Button>
        }
      />
    </>
  )
}

/** What each part of the sync did, as the server answered. */
function SyncReportList({ report }: { report: SyncReport }) {
  const { t } = useTranslation("vonhalsky")
  const parts = SYNC_PARTS.filter((p) => report[p])
  if (parts.length === 0) return null
  return (
    <ul className="flex flex-col gap-y-1.5 px-6 py-4">
      {parts.map((p) => {
        const r = report[p]
        if (!r) return null
        return (
          <li key={p} className="flex flex-wrap items-baseline gap-x-2">
            <ToneBadge tone={r.ok ? "green" : "red"}>{t(`syncPart.${p}`)}</ToneBadge>
            <Text size="xsmall" className={r.ok ? "text-ui-fg-subtle" : "text-ui-tag-red-text"}>
              {r.detail}
            </Text>
          </li>
        )
      })}
    </ul>
  )
}
