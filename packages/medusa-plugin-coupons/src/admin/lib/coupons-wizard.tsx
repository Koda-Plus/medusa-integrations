import { Fragment, useMemo, useState, type ReactElement } from "react"
import { useTranslation } from "react-i18next"
import { Bolt, Buildings, BuildingStorefront, Calendar, Cash, CheckCircleSolid, CheckMini, ChevronRight, Eye, ExclamationCircle, Gift, Key, ReceiptPercent, Sparkles, SquaresPlus, Tag, TruckFast, User, Users } from "@medusajs/icons"
import { Button, FocusModal, Heading, InlineTip, Input, Label, Text, clx, toast } from "@medusajs/ui"
import type { CouponDto, NameMaps, WizardInput, WizardKind } from "../../modules/coupons/lib/contract"
import { checkWizard, cleanCode, endOfMonth, suggestCode, wizardWarnings } from "../../modules/coupons/lib/wizard"
import { CouponsRequestError, errorMessage, useCreateCoupon, useLookups, usePoolProducts } from "./coupons-api"
import { BigCard, Chips, CombinesPicker, CustomerPicker, Field, NoteField, NumberInput, PickList, PriceListSelect, poolsWord } from "./coupons-fields"
import { couponSentence, wizardCoupon } from "./coupons-sentence"
import { useFormat } from "./coupons-ui"
import { ToneBadge } from "./coupons-blocks"
import { KeyPoints, type KeyPointItem } from "./coupons-guide"
import { PoolPicker, variantNames } from "./coupons-pool-picker"

/**
 * THE CREATOR, full screen: the steps on the left (each with what was
 * picked and whether it is complete), the step in the middle, and on the
 * right a live preview: the coupon the way the customer sees it, the plain
 * sentence, the key facts, readiness and the warnings. One button saves an
 * ordinary Medusa promotion (and the store's own terms next to it). The
 * checks and warnings are the same functions the server runs again before
 * it writes.
 */

type Step = 1 | 2 | 3

const START: WizardInput = {
  kind: "percent_order",
  value: 15,
  categoryIds: [],
  poolIds: [],
  excludedVariantIds: [],
  buyGet: { buy: 6, free: 1, freePrice: null },
  audience: "everyone",
  groupIds: [],
  customerId: null,
  customerIds: [],
  terms: {},
  mode: "code",
  code: "",
  validity: "30d",
  startsAt: null,
  endsAt: null,
  limit: null,
  minimum: null,
}

const PERCENTS = [5, 10, 15, 20, 30]
const AMOUNTS = [30, 50, 100, 500]

export function CreateCouponModal({ open, onOpenChange, existing, memberGroupIds, codePrefix, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; existing: CouponDto[]; memberGroupIds: string[]; codePrefix: string | null; onCreated: (c: CouponDto) => void }) {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const lookups = useLookups(open)
  const create = useCreateCoupon()
  const [step, setStep] = useState<Step>(1)
  const [form, setForm] = useState<WizardInput>(START)
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const currency = form.currencyCode ?? lookups.data?.currencyCode ?? "pln"
  const store = lookups.data?.store ?? null
  const features = store?.features ?? []
  const has = (f: (typeof features)[number]) => features.includes(f)
  const storeBuyGet = has("buyGet")
  const poolsLabel = poolsWord(store, fmt.lang, t("fields.pools"))
  const set = <K extends keyof WizardInput>(k: K, v: WizardInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const setTerm = <K extends keyof NonNullable<WizardInput["terms"]>>(k: K, v: NonNullable<WizardInput["terms"]>[K]) => setForm((f) => ({ ...f, terms: { ...(f.terms ?? {}), [k]: v } }))

  const reset = () => {
    setStep(1)
    setForm(START)
    setCustomerNames({})
    setServerErrors([])
  }

  const now = new Date()
  const dates = useMemo(() => {
    if (form.validity === "month") return { startsAt: now.toISOString(), endsAt: endOfMonth(now).toISOString() }
    if (form.validity === "30d") return { startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString() }
    if (form.validity === "custom") return { startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : now.toISOString(), endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null }
    return { startsAt: null, endsAt: null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.validity, form.startsAt, form.endsAt])

  /* A discount on pools: the products of each picked pool, to leave single ones out. */
  const poolProducts = usePoolProducts(form.kind === "percent_pools" ? form.poolIds ?? [] : [], open && has("pools"))

  const names: NameMaps = useMemo(
    () => ({
      groups: Object.fromEntries((lookups.data?.groups ?? []).map((g) => [g.id, g.name])),
      categories: Object.fromEntries((lookups.data?.categories ?? []).map((c) => [c.id, c.name])),
      products: {},
      customers: customerNames,
      pools: Object.fromEntries((store?.pools ?? []).map((p) => [p.id, p.name])),
      priceLists: Object.fromEntries((store?.priceLists ?? []).map((p) => [p.id, p.name])),
      variants: variantNames(poolProducts.byPool),
    }),
    [lookups.data, customerNames, store, poolProducts.byPool],
  )

  const withCode = !form.code ? { ...form, code: suggestCode(form, codePrefix) } : form
  const check = checkWizard(withCode, { currencyCode: currency, memberGroupIds, features })
  const sentence = couponSentence(wizardCoupon(withCode, dates, { memberGroupIds, storeBuyGet }), names, t, fmt, currency)
  const warnings = wizardWarnings(withCode, { active: existing, memberGroupIds })
  const STEP_ERRORS: Record<Step, string[]> = {
    1: ["kind", "percent", "amount", "category", "pools", "buy_get", "free_price", "min_quantity"],
    2: ["audience", "groups", "customer", "members"],
    3: ["code", "dates", "validity", "limit", "minimum", "per_customer", "per_customer_audience", "threshold"],
  }
  const stepErrors = (s: Step) => check.errors.filter((e) => STEP_ERRORS[s].includes(e))

  const save = async () => {
    setServerErrors([])
    try {
      const r = await create.mutateAsync({ ...withCode, code: cleanCode(withCode.code), currencyCode: currency })
      toast.success(t("wizard.saved", { code: r.coupon.code }))
      onCreated(r.coupon)
      onOpenChange(false)
      reset()
    } catch (err) {
      if (err instanceof CouponsRequestError && err.errors.length) setServerErrors(err.errors)
      else toast.error(errorMessage(err))
    }
  }

  const KINDS: WizardKind[] = ["percent_order", "fixed_order", "free_shipping", "percent_category", ...(has("pools") ? (["percent_pools"] as WizardKind[]) : []), "buy_get"]
  const KIND_ICON: Record<WizardKind, ReactElement> = { percent_order: <ReceiptPercent />, fixed_order: <Cash />, free_shipping: <TruckFast />, percent_category: <Tag />, percent_pools: <SquaresPlus />, buy_get: <Gift /> }
  const AUDIENCES = (["everyone", ...(memberGroupIds.length ? ["members", "retail"] : []), "groups", "customer"] as const) as ReadonlyArray<WizardInput["audience"]>
  const AUDIENCE_ICON: Record<WizardInput["audience"], ReactElement> = { everyone: <Users />, members: <Buildings />, retail: <BuildingStorefront />, groups: <Tag />, customer: <User /> }
  const STEP_KEY = { 1: "kind", 2: "audience", 3: "rules" } as const
  const stepDone = (s: Step) => stepErrors(s).length === 0
  const isPercentKind = form.kind === "percent_order" || form.kind === "percent_category" || form.kind === "percent_pools"
  const onItems = form.kind === "percent_category" || form.kind === "percent_pools"
  const usesPools = form.kind === "percent_pools" || (form.kind === "buy_get" && storeBuyGet && has("pools"))
  const usesCategories = form.kind === "percent_category" || (form.kind === "buy_get" && !storeBuyGet)
  const customers = [...new Set([...(form.customerIds ?? []), ...(form.customerId ? [form.customerId] : [])])]

  /* What was picked in a step, in one short sentence under its name. */
  /* What each step decides, as short phrases; the full sentence stays as their tooltip. */
  const stepPoints = (s: Step): KeyPointItem[] =>
    s === 1
      ? [
          { icon: <ReceiptPercent />, text: t("wizard.ui.stepPoints.kind.pick") },
          { icon: <Eye />, text: t("wizard.ui.stepPoints.kind.preview") },
        ]
      : s === 2
        ? [
            { icon: <Users />, text: t("wizard.ui.stepPoints.audience.everyone") },
            { icon: <BuildingStorefront />, text: t("wizard.ui.stepPoints.audience.retail") },
            { icon: <User />, text: t("wizard.ui.stepPoints.audience.customers") },
          ]
        : [
            { icon: <Key />, text: t("wizard.ui.stepPoints.rules.mode") },
            { icon: <Calendar />, text: t("wizard.ui.stepPoints.rules.validity") },
            { icon: <Tag />, text: t("wizard.ui.stepPoints.rules.limits") },
          ]
  const stepSummary = (s: Step): string => {
    if (s === 1) {
      if (form.kind === "buy_get") return `${t("wizard.kind.buy_get.label")}, ${form.buyGet?.buy ?? 0} + ${form.buyGet?.free ?? 0}`
      return `${t(`wizard.kind.${form.kind}.label`)}${form.kind === "free_shipping" ? "" : form.value ? `, ${form.kind === "fixed_order" ? fmt.money(Number(form.value), currency) : `${form.value}%`}` : ""}`
    }
    if (s === 2) {
      if (form.audience === "groups") return `${t("wizard.audience.groups.label")}: ${(form.groupIds ?? []).length}`
      if (form.audience === "customer") return customers.length === 1 ? customerNames[customers[0]] ?? t("wizard.audience.customer.label") : t("wizard.ui.customersCount", { count: customers.length })
      return t(`wizard.audience.${form.audience}.label`)
    }
    return `${form.mode === "code" ? t("wizard.mode.code") : t("wizard.mode.automatic")}, ${t(`wizard.validity.${form.validity}`)}`
  }
  const bigValue =
    form.kind === "free_shipping"
      ? t("wizard.kind.free_shipping.label")
      : form.kind === "buy_get"
        ? t("wizard.ui.buyGetBig", { buy: form.buyGet?.buy ?? 0, free: form.buyGet?.free ?? 0 })
        : form.kind === "fixed_order"
          ? `-${fmt.money(Number(form.value ?? 0), currency)}`
          : `-${form.value ?? 0}%`
  const sample = 300
  const after = form.kind === "fixed_order" ? Math.max(0, sample - Number(form.value ?? 0)) : form.kind === "free_shipping" || form.kind === "buy_get" ? sample : sample * (1 - Number(form.value ?? 0) / 100)
  const validityText = dates.endsAt ? `${dates.startsAt ? fmt.date(dates.startsAt) : ""} - ${fmt.date(dates.endsAt)}` : t("wizard.validity.none")
  const excludedNames = form.kind === "percent_pools" ? (form.excludedVariantIds ?? []).map((id) => names.variants?.[id] ?? id) : []
  const targetNames = usesPools ? (form.poolIds ?? []).map((id) => names.pools?.[id]).filter(Boolean) : usesCategories ? (form.categoryIds ?? []).map((id) => names.categories[id]).filter(Boolean) : []

  return (
    <FocusModal
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center gap-x-2">
            <ReceiptPercent className="text-ui-fg-interactive" />
            <Text size="small" weight="plus">
              {t("wizard.title")}
            </Text>
            <Text size="small" className="text-ui-fg-muted">
              {t("wizard.ui.stepOf", { n: step })}
            </Text>
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-1 overflow-hidden">
          <div className="grid h-full w-full grid-cols-1 overflow-y-auto lg:grid-cols-[15rem_minmax(0,1fr)_22rem] lg:overflow-hidden">
            {/* Steps: the name, what was picked, ready or not. */}
            <nav className="flex gap-2 border-b border-ui-border-base p-4 lg:flex-col lg:border-b-0 lg:border-r lg:p-6">
              {([1, 2, 3] as Step[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStep(s)}
                  className={clx("flex flex-1 items-start gap-x-3 rounded-lg p-2.5 text-left transition-fg lg:flex-none", step === s ? "bg-ui-bg-base shadow-elevation-card-rest" : "hover:bg-ui-bg-base-hover")}
                >
                  <span
                    className={clx(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full txt-compact-xsmall-plus",
                      step === s ? "bg-ui-bg-interactive text-ui-fg-on-color" : stepDone(s) && s < step ? "bg-ui-tag-green-icon text-ui-fg-on-color" : "bg-ui-bg-component text-ui-fg-muted shadow-borders-base",
                    )}
                  >
                    {stepDone(s) && s < step ? <CheckMini /> : s}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <Text size="small" weight="plus">
                      {t(`wizard.step.${STEP_KEY[s]}`)}
                    </Text>
                    <Text size="xsmall" className="hidden text-ui-fg-subtle lg:block">
                      {t(`wizard.ui.stepHint.${STEP_KEY[s]}`)}
                    </Text>
                    <Text size="xsmall" className="truncate text-ui-fg-muted">
                      {stepSummary(s)}
                    </Text>
                  </span>
                </button>
              ))}
            </nav>

            {/* The step's form. */}
            <div className="flex flex-col gap-y-5 p-6 lg:overflow-y-auto lg:px-10 lg:py-8">
              <div>
                <Heading>{t(`wizard.step.${STEP_KEY[step]}`)}</Heading>
                <KeyPoints className="mt-1.5" label={t(`wizard.ui.stepIntro.${STEP_KEY[step]}`)} items={stepPoints(step)} />
              </div>

              {step === 1 ? (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {KINDS.map((k) => (
                      <BigCard
                        key={k}
                        on={form.kind === k}
                        icon={KIND_ICON[k]}
                        title={k === "percent_pools" ? t("wizard.kind.percent_pools.labelOf", { pools: poolsLabel.toLowerCase() }) : t(`wizard.kind.${k}.label`)}
                        hint={t(`wizard.kind.${k}.${k === "buy_get" && storeBuyGet ? "hintStore" : "hint"}`)}
                        onClick={() => setForm((f) => ({ ...f, kind: k, value: k === "fixed_order" ? (AMOUNTS.includes(Number(f.value)) ? f.value : 50) : k === "free_shipping" || k === "buy_get" ? null : PERCENTS.includes(Number(f.value)) ? f.value : 15 }))}
                      />
                    ))}
                  </div>
                  {form.kind !== "free_shipping" && form.kind !== "buy_get" ? (
                    <Field label={form.kind === "fixed_order" ? t("wizard.value.amount") : t("wizard.value.percent")} hint={t("wizard.ui.example", { order: fmt.money(sample, currency), after: fmt.money(after, currency) })}>
                      <div className="flex flex-wrap items-center gap-3">
                        <Chips
                          value={Number(form.value ?? 0)}
                          options={(form.kind === "fixed_order" ? AMOUNTS : PERCENTS).map((v) => ({ value: v, label: form.kind === "fixed_order" ? fmt.money(v, currency) : `${v}%` }))}
                          onChange={(v) => set("value", v)}
                        />
                        <div className="flex items-center gap-x-2">
                          <Text size="xsmall" className="text-ui-fg-muted">
                            {t("wizard.ui.custom")}
                          </Text>
                          <NumberInput value={form.value} onChange={(v) => set("value", v)} unit={form.kind === "fixed_order" ? currency.toUpperCase() : "%"} min={0} step={isPercentKind ? 1 : 0.01} className="w-28" />
                        </div>
                      </div>
                    </Field>
                  ) : null}
                  {form.kind === "free_shipping" ? (
                    <InlineTip variant="info" label={t("wizard.kind.free_shipping.label")}>
                      {t("wizard.ui.exampleShipping")}
                    </InlineTip>
                  ) : null}
                  {form.kind === "buy_get" ? (
                    <Field label={t("fields.buyGet")} hint={storeBuyGet ? t("fields.buyGetHintStore", { pools: poolsLabel.toLowerCase() }) : t("fields.buyGetHint")}>
                      <div className="flex flex-wrap items-center gap-3">
                        <Text size="small">{t("fields.buyEvery")}</Text>
                        <NumberInput value={form.buyGet?.buy} onChange={(v) => set("buyGet", { ...(form.buyGet ?? { buy: 6, free: 1 }), buy: Number(v) || 0 })} unit={t("fields.pcs")} min={1} className="w-28" />
                        <Text size="small">{t("fields.getFree")}</Text>
                        <NumberInput value={form.buyGet?.free} onChange={(v) => set("buyGet", { ...(form.buyGet ?? { buy: 6, free: 1 }), free: Number(v) || 0 })} unit={t("fields.pcs")} min={1} className="w-28" />
                      </div>
                      {storeBuyGet ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <Text size="small">{t("fields.freePrice")}</Text>
                          <NumberInput value={form.buyGet?.freePrice ?? null} onChange={(v) => set("buyGet", { ...(form.buyGet ?? { buy: 6, free: 1 }), freePrice: v })} unit={currency.toUpperCase()} min={0} step={0.01} className="w-32" placeholder="0" />
                          <Text size="xsmall" className="text-ui-fg-subtle">
                            {t("fields.freePriceHint")}
                          </Text>
                        </div>
                      ) : null}
                    </Field>
                  ) : null}
                  {usesPools ? (
                    <Field label={poolsLabel} hint={(form.poolIds ?? []).length ? t("wizard.ui.picked", { count: (form.poolIds ?? []).length }) : form.kind === "buy_get" ? t("fields.poolsAllHint") : t("fields.poolsPick")}>
                      <PoolPicker
                        pools={store?.pools ?? []}
                        selected={form.poolIds ?? []}
                        onChange={(ids) => set("poolIds", ids)}
                        search={t("fields.search")}
                        products={form.kind === "percent_pools" ? { byPool: poolProducts.byPool, excluded: form.excludedVariantIds ?? [], onExcluded: (ids) => set("excludedVariantIds", ids) } : undefined}
                      />
                    </Field>
                  ) : null}
                  {usesCategories ? (
                    <Field label={t("wizard.value.category")} hint={(form.categoryIds ?? []).length ? t("wizard.ui.picked", { count: (form.categoryIds ?? []).length }) : t("wizard.value.pickCategory")}>
                      <PickList items={lookups.data?.categories ?? []} selected={form.categoryIds ?? []} onChange={(ids) => set("categoryIds", ids)} search={t("wizard.ui.categorySearch")} />
                    </Field>
                  ) : null}
                  {onItems && (has("minQuantity") || has("priceLists")) ? (
                    <Field label={t("fields.counting")} hint={t("fields.countingHint")}>
                      {has("minQuantity") ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <Text size="small">{t("fields.fromPieces")}</Text>
                          <NumberInput value={form.terms?.minQuantity ?? null} onChange={(v) => setTerm("minQuantity", v)} unit={t("fields.pcs")} min={1} className="w-28" placeholder="1" />
                          {form.terms?.minQuantity && form.terms.minQuantity > 1 && has("pools") ? (
                            <Chips
                              value={form.terms.perPool ? "pool" : "all"}
                              options={[
                                { value: "pool", label: t("fields.perPool", { pools: poolsLabel.toLowerCase() }) },
                                { value: "all", label: t("fields.together") },
                              ]}
                              onChange={(v) => setTerm("perPool", v === "pool")}
                            />
                          ) : null}
                        </div>
                      ) : null}
                      {has("priceLists") && (store?.priceLists ?? []).length ? (
                        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                          <div className="flex flex-col gap-y-1">
                            <Label size="xsmall" weight="plus">
                              {t("fields.basePriceList")}
                            </Label>
                            <PriceListSelect value={form.terms?.basePriceList} onChange={(v) => setTerm("basePriceList", v)} lists={store?.priceLists ?? []} none={t("fields.basePriceNone")} />
                          </div>
                          <div className="flex flex-col gap-y-1">
                            <Label size="xsmall" weight="plus">
                              {t("fields.floorPriceList")}
                            </Label>
                            <PriceListSelect value={form.terms?.floorPriceList} onChange={(v) => setTerm("floorPriceList", v)} lists={store?.priceLists ?? []} none={t("fields.floorNone")} />
                          </div>
                        </div>
                      ) : null}
                    </Field>
                  ) : null}
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {AUDIENCES.map((a) => (
                      <BigCard key={a} on={form.audience === a} icon={AUDIENCE_ICON[a]} title={t(`wizard.audience.${a}.label`)} hint={t(`wizard.audience.${a}.hint`)} onClick={() => set("audience", a)} />
                    ))}
                  </div>
                  {form.audience === "members" ? (
                    <InlineTip variant="info" label={t("wizard.audience.members.label")}>
                      {memberGroupIds.map((id) => names.groups[id] ?? id).join(", ")}
                    </InlineTip>
                  ) : null}
                  {form.audience === "retail" ? (
                    <InlineTip variant="info" label={t("wizard.audience.retail.label")}>
                      {t("wizard.ui.retailInfo", { groups: memberGroupIds.map((id) => names.groups[id] ?? id).join(", ") })}
                    </InlineTip>
                  ) : null}
                  {form.audience === "groups" ? (
                    <Field label={t("wizard.groups")} hint={(form.groupIds ?? []).length ? t("wizard.ui.picked", { count: (form.groupIds ?? []).length }) : undefined}>
                      <PickList items={(lookups.data?.groups ?? []).map((g) => ({ id: g.id, name: g.name, badge: g.member ? t("wizard.member") : null }))} selected={form.groupIds ?? []} onChange={(ids) => set("groupIds", ids)} search={t("fields.search")} />
                    </Field>
                  ) : null}
                  {form.audience === "customer" ? (
                    <Field label={t("wizard.audience.customer.label")} hint={t("wizard.ui.customerHint")}>
                      <CustomerPicker
                        selected={customers}
                        names={customerNames}
                        onChange={(ids) => setForm((f) => ({ ...f, customerIds: ids, customerId: ids[0] ?? null }))}
                        onName={(id, name) => setCustomerNames((m) => ({ ...m, [id]: name }))}
                      />
                    </Field>
                  ) : null}
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <BigCard on={form.mode === "code"} icon={<Key />} title={t("wizard.mode.code")} hint={t("wizard.ui.modeHint.code")} onClick={() => set("mode", "code")} />
                    <BigCard on={form.mode === "automatic"} icon={<Bolt />} title={t("wizard.mode.automatic")} hint={t("wizard.ui.modeHint.automatic")} onClick={() => set("mode", "automatic")} />
                  </div>
                  {/* Medusa keeps a code on every promotion: an automatic one shows it as its name. */}
                  <Field label={form.mode === "code" ? t("wizard.code") : t("wizard.codeAutomatic")} hint={form.mode === "automatic" ? t("wizard.codeAutomaticHint") : undefined}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input size="small" className="w-72 font-mono uppercase" placeholder={suggestCode(form, codePrefix)} value={form.code ?? ""} onChange={(e) => set("code", cleanCode(e.target.value))} />
                      <Button size="small" variant="secondary" onClick={() => set("code", suggestCode(form, codePrefix))}>
                        <Sparkles />
                        {t("wizard.suggest")}
                      </Button>
                    </div>
                  </Field>
                  <Field label={t("wizard.validity.label")} hint={t("wizard.ui.validityHint")}>
                    <Chips value={form.validity} options={(["month", "30d", "none", "custom"] as const).map((v) => ({ value: v, label: t(`wizard.validity.${v}`) }))} onChange={(v) => set("validity", v)} />
                    {form.validity === "custom" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Label size="xsmall">{t("wizard.validity.from")}</Label>
                        {/* A day as a date: from its first second, to its last one. */}
                        <Input size="small" type="date" className="w-40" value={(form.startsAt ?? "").slice(0, 10)} onChange={(e) => set("startsAt", e.target.value ? `${e.target.value}T00:00:00` : null)} />
                        <Label size="xsmall">{t("wizard.validity.to")}</Label>
                        <Input size="small" type="date" className="w-40" value={(form.endsAt ?? "").slice(0, 10)} onChange={(e) => set("endsAt", e.target.value ? `${e.target.value}T23:59:59` : null)} />
                      </div>
                    ) : null}
                  </Field>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <Field label={t("wizard.limit.label")} hint={t("wizard.ui.limitHint")}>
                      <Chips
                        value={form.limit === 1 ? "once" : form.limit === 100 ? "hundred" : form.limit ? "own" : "none"}
                        options={[
                          { value: "once", label: t("wizard.limit.once") },
                          { value: "hundred", label: t("wizard.limit.hundred") },
                          { value: "none", label: t("wizard.limit.none") },
                          { value: "own", label: t("wizard.limit.own") },
                        ]}
                        onChange={(v) => set("limit", v === "once" ? 1 : v === "hundred" ? 100 : v === "none" ? null : 10)}
                      />
                      {form.limit && form.limit !== 1 && form.limit !== 100 ? <NumberInput value={form.limit} onChange={(v) => set("limit", v)} min={1} className="w-28" /> : null}
                    </Field>
                    <Field label={t("wizard.minimum.label")} hint={t("wizard.ui.minimumHint")}>
                      <Chips value={form.minimum ? "own" : "none"} options={[{ value: "none", label: t("wizard.minimum.none") }, { value: "own", label: t("wizard.minimum.own") }]} onChange={(v) => set("minimum", v === "none" ? null : 300)} />
                      {form.minimum ? <NumberInput value={form.minimum} onChange={(v) => set("minimum", v)} unit={currency.toUpperCase()} min={0} step={0.01} className="w-36" /> : null}
                    </Field>
                  </div>
                  {has("perCustomerOrders") ? (
                    <Field label={t("fields.perCustomer")} hint={form.audience === "customer" ? t("fields.perCustomerHint") : t("fields.perCustomerOnlyCustomers")}>
                      <div className="flex flex-wrap items-center gap-3">
                        <Chips value={form.terms?.perCustomerOrders ? "own" : "none"} options={[{ value: "none", label: t("fields.perCustomerNone") }, { value: "own", label: t("fields.perCustomerOwn") }]} onChange={(v) => setTerm("perCustomerOrders", v === "none" ? null : 1)} />
                        {form.terms?.perCustomerOrders ? <NumberInput value={form.terms.perCustomerOrders} onChange={(v) => setTerm("perCustomerOrders", v)} unit={t("fields.ordersUnit")} min={1} className="w-36" /> : null}
                      </div>
                    </Field>
                  ) : null}
                  {has("combines") ? (
                    <Field label={t("fields.combines")} hint={t("fields.combinesHint")}>
                      <CombinesPicker value={form.terms?.combines} onChange={(v) => setTerm("combines", v)} coupons={existing} selfCode={withCode.code ?? ""} />
                    </Field>
                  ) : null}
                  {has("note") ? (
                    <Field label={t("fields.note")} hint={t("fields.noteHint")}>
                      <NoteField value={form.terms?.note} onChange={(v) => setTerm("note", v)} />
                    </Field>
                  ) : null}
                </>
              ) : null}

              {stepErrors(step).length ? (
                <InlineTip variant="info" label={t(`wizard.step.${STEP_KEY[step]}`)}>
                  {stepErrors(step).map((e) => t(`wizard.error.${e}`)).join(" ")}
                </InlineTip>
              ) : null}
            </div>

            {/* Live preview: the coupon as the customer sees it, the sentence, the facts, the warnings, readiness. */}
            <aside className="flex flex-col gap-y-4 border-t border-ui-border-base bg-ui-bg-subtle p-6 lg:overflow-y-auto lg:border-l lg:border-t-0">
              <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
                {t("wizard.ui.preview")}
              </Text>
              <div className="relative overflow-hidden rounded-xl border border-dashed border-ui-border-interactive bg-ui-bg-base p-4">
                <span className="absolute -left-2 top-1/2 size-4 -translate-y-1/2 rounded-full border border-ui-border-base bg-ui-bg-subtle" />
                <span className="absolute -right-2 top-1/2 size-4 -translate-y-1/2 rounded-full border border-ui-border-base bg-ui-bg-subtle" />
                <Text size="xlarge" weight="plus" className="text-ui-fg-interactive">
                  {bigValue}
                </Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {targetNames.length ? targetNames.join(", ") : t(`wizard.kind.${form.kind}.${form.kind === "buy_get" && storeBuyGet ? "hintStore" : "hint"}`)}
                </Text>
                {excludedNames.length ? (
                  <Text size="xsmall" className="mt-1 text-ui-fg-muted">
                    {excludedNames.length <= 3 ? t("fields.poolProducts.without", { list: excludedNames.join(", ") }) : t("fields.poolProducts.withoutCount", { count: excludedNames.length })}
                  </Text>
                ) : null}
                {form.terms?.note ? (
                  <Text size="xsmall" className="mt-2 italic text-ui-fg-subtle">
                    {form.terms.note}
                  </Text>
                ) : null}
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-dashed border-ui-border-base pt-3">
                  {form.mode === "code" ? <span className="rounded-md bg-ui-bg-component px-2 py-1 font-mono txt-compact-small-plus">{withCode.code}</span> : <ToneBadge tone="blue">{t("wizard.mode.automatic")}</ToneBadge>}
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {form.mode === "code" ? t("wizard.ui.previewCode") : t("wizard.ui.previewAutomatic")}
                  </Text>
                </div>
              </div>

              <div className="rounded-xl border border-ui-border-base bg-ui-bg-base p-4">
                <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
                  {t("wizard.summary")}
                </Text>
                <Text size="small" className="mt-1.5 leading-relaxed" weight="plus">
                  {sentence}
                </Text>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-xl border border-ui-border-base bg-ui-bg-base p-4">
                {(
                  [
                    ["audience", stepSummary(2)],
                    ["mode", form.mode === "code" ? t("wizard.mode.code") : t("wizard.mode.automatic")],
                    ["validity", validityText],
                    ["limit", form.limit ? fmt.number(form.limit) : t("wizard.limit.none")],
                    ["minimum", form.minimum ? fmt.money(form.minimum, currency) : t("wizard.ui.none")],
                  ] as const
                ).map(([k, v]) => (
                  <Fragment key={k}>
                    <dt className="txt-compact-xsmall text-ui-fg-muted">{t(`wizard.ui.facts.${k}`)}</dt>
                    <dd className="txt-compact-small text-ui-fg-base">{v}</dd>
                  </Fragment>
                ))}
              </dl>

              <div className="flex flex-col gap-y-1.5">
                <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
                  {t("wizard.ui.ready")}
                </Text>
                {([1, 2, 3] as Step[]).map((s) => (
                  <button key={s} type="button" onClick={() => setStep(s)} className="flex items-center justify-between rounded-md px-2 py-1 text-left hover:bg-ui-bg-base-hover">
                    <span className="flex items-center gap-x-2">
                      {stepDone(s) ? <CheckCircleSolid className="text-ui-tag-green-icon" /> : <ExclamationCircle className="text-ui-tag-orange-icon" />}
                      <Text size="small">{t(`wizard.step.${STEP_KEY[s]}`)}</Text>
                    </span>
                    <Text size="xsmall" className={stepDone(s) ? "text-ui-fg-muted" : "text-ui-tag-orange-text"}>
                      {stepDone(s) ? t("wizard.ui.readyOk") : t("wizard.ui.readyTodo")}
                    </Text>
                  </button>
                ))}
              </div>

              {warnings.length ? (
                <div className="flex flex-col gap-y-2">
                  <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
                    {t("wizard.warningsTitle")}
                  </Text>
                  {warnings.map((w) => (
                    <InlineTip key={w} variant="warning" label="">
                      {t(`wizard.warning.${w}`)}
                    </InlineTip>
                  ))}
                </div>
              ) : null}
              {serverErrors.length ? (
                <InlineTip variant="error" label={t("wizard.title")}>
                  {serverErrors.map((e) => t(`wizard.error.${e}`, { defaultValue: e })).join(" ")}
                </InlineTip>
              ) : null}
            </aside>
          </div>
        </FocusModal.Body>
        <FocusModal.Footer>
          <div className="flex w-full items-center justify-between gap-2">
            <Text size="small" className="text-ui-fg-muted">
              {t("wizard.ui.stepOf", { n: step })}
            </Text>
            <div className="flex items-center gap-2">
              <FocusModal.Close asChild>
                <Button size="small" variant="secondary">
                  {t("wizard.cancel")}
                </Button>
              </FocusModal.Close>
              {step > 1 ? (
                <Button size="small" variant="secondary" onClick={() => setStep((s) => (s - 1) as Step)}>
                  {t("wizard.back")}
                </Button>
              ) : null}
              {step < 3 ? (
                <Button size="small" onClick={() => setStep((s) => (s + 1) as Step)} disabled={stepErrors(step).length > 0}>
                  {t("wizard.next")}
                  <ChevronRight />
                </Button>
              ) : (
                <Button size="small" onClick={() => void save()} isLoading={create.isPending} disabled={!check.ok}>
                  {t("wizard.save")}
                </Button>
              )}
            </div>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}
