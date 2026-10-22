import { useEffect, useMemo, useState, type ReactElement } from "react"
import { useTranslation } from "react-i18next"
import { ArrowUpRightOnBox, Bolt, Buildings, BuildingStorefront, Cash, Gift, Key, PauseSolid, PlaySolid, ReceiptPercent, SquareTwoStack, SquaresPlus, Tag, TruckFast, User, Users, XMark } from "@medusajs/icons"
import { Button, FocusModal, Heading, InlineTip, Input, Label, Text, clx, toast } from "@medusajs/ui"
import type { CouponDto, CouponKind, CouponPatch, NameMaps, StoreTerms } from "../../modules/coupons/lib/contract"
import { checkPatch, editWarnings, isPercent, targetsEditable, valueEditable, type NormalizedPatch } from "../../modules/coupons/lib/edit"
import { cleanCode, nextCode } from "../../modules/coupons/lib/wizard"
import { CouponsRequestError, errorMessage, useDuplicateCoupon, useLookups, useSetStatus, useUpdateCoupon } from "./coupons-api"
import { BigCard, Chips, CombinesPicker, CustomerPicker, Field, NoteField, NumberInput, PickList, PriceListSelect, Section, poolsWord } from "./coupons-fields"
import { couponSentence } from "./coupons-sentence"
import { StatusBadge, useFormat } from "./coupons-ui"
import { ToneBadge } from "./coupons-blocks"

/**
 * THE EDIT FORM, full screen, built like the creator: 1. what it gives (and
 * on what), 2. for whom, 3. how it works. On the right the coupon as the
 * customer sees it and in one plain sentence as it will be after saving,
 * what changes and the warnings. In the header: pause or turn on, and a
 * copy. The same form makes a copy (mode "copy"): the coupon's fields with
 * a new code, saved as a new coupon. What the form has no field for is kept
 * and named.
 */

type Audience = "everyone" | "members" | "retail" | "groups" | "customer"

type Form = {
  code: string
  mode: "code" | "automatic"
  value: number | null
  startsAt: string
  endsAt: string
  limit: number | null
  minimum: number | null
  audience: Audience
  groupIds: string[]
  customerIds: string[]
  excludedGroupIds: string[]
  categoryIds: string[]
  poolIds: string[]
  buyGet: { buy: number; free: number; freePrice: number | null } | null
  terms: StoreTerms
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "")
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))

function audienceOf(c: CouponDto, members: readonly string[]): Audience {
  const s = c.shape
  const excluded = s.excludedGroupIds ?? []
  if (s.customerIds.length) return "customer"
  if (members.length && excluded.length && sameSet(excluded, members) && !s.groupIds.length) return "retail"
  if (members.length && s.groupIds.length && sameSet(s.groupIds, members)) return "members"
  if (s.groupIds.length || excluded.length) return "groups"
  return "everyone"
}

function formOf(c: CouponDto, members: readonly string[], code?: string): Form {
  const bg = c.terms?.buyGet ?? (c.shape.buyGet ? { ...c.shape.buyGet, freePrice: null } : null)
  return {
    code: code ?? c.code ?? "",
    mode: c.automatic ? "automatic" : "code",
    value: c.shape.value,
    startsAt: day(c.startsAt),
    endsAt: day(c.endsAt),
    limit: c.limit,
    minimum: c.shape.minimum,
    audience: audienceOf(c, members),
    groupIds: [...c.shape.groupIds],
    customerIds: [...c.shape.customerIds],
    excludedGroupIds: [...(c.shape.excludedGroupIds ?? [])],
    categoryIds: [...c.shape.categoryIds],
    poolIds: [...(c.terms?.pools ?? [])],
    buyGet: bg,
    terms: { ...(c.terms ?? {}) },
  }
}

/** A day of the form as an exact moment in the browser's time zone (the server runs in UTC). */
const localDay = (d: string, time: string) => (d ? new Date(`${d}T${time}`).toISOString() : null)

/** The form as a patch. Dates only when touched: the form keeps days, the coupon exact times. */
function patchOf(f: Form, c: CouponDto, datesTouched: boolean, storeFeatures: readonly string[]): CouponPatch {
  const storeBuyGet = Boolean(c.terms?.buyGet)
  const { pools: _pools, buyGet: _bg, ...terms } = f.terms
  void _pools
  void _bg
  return {
    code: f.code,
    mode: f.mode,
    ...(valueEditable(c) && f.value !== null ? { value: f.value } : {}),
    ...(datesTouched ? { startsAt: localDay(f.startsAt, "00:00:00"), endsAt: localDay(f.endsAt, "23:59:59.999") } : {}),
    limit: f.limit,
    minimum: f.minimum,
    groupIds: f.groupIds,
    customerIds: f.customerIds,
    excludedGroupIds: f.excludedGroupIds,
    ...(targetsEditable(c) ? { categoryIds: f.categoryIds } : {}),
    ...(targetsEditable(c) && storeFeatures.includes("pools") ? { poolIds: f.poolIds } : {}),
    ...(c.shape.kind === "buy_get" && !storeBuyGet && f.buyGet ? { buyGet: { buy: f.buyGet.buy, free: f.buyGet.free } } : {}),
    ...(storeFeatures.length ? { terms: { ...terms, ...(storeBuyGet && f.buyGet ? { buyGet: f.buyGet } : {}) } } : {}),
  }
}

/** The coupon as it will be, for the preview and the sentence on the right. */
function preview(c: CouponDto, p: NormalizedPatch | null): CouponDto {
  if (!p) return c
  const terms = p.terms ?? c.terms ?? null
  return {
    ...c,
    code: p.code ?? c.code,
    automatic: p.automatic ?? c.automatic,
    startsAt: p.dates ? (p.dates.startsAt ? p.dates.startsAt.toISOString() : null) : c.startsAt,
    endsAt: p.dates ? (p.dates.endsAt ? p.dates.endsAt.toISOString() : null) : c.endsAt,
    limit: p.limit !== undefined ? p.limit : c.limit,
    terms,
    shape: {
      ...c.shape,
      value: p.value ?? c.shape.value,
      minimum: p.minimum !== undefined ? p.minimum : c.shape.minimum,
      groupIds: p.groupIds ?? c.shape.groupIds,
      customerIds: p.customerIds ?? c.shape.customerIds,
      excludedGroupIds: p.excludedGroupIds ?? c.shape.excludedGroupIds,
      categoryIds: p.categoryIds ?? c.shape.categoryIds,
      /* New pools replace the tags they stand for. */
      tagIds: p.poolIds !== undefined ? [] : c.shape.tagIds,
      buyGet: p.buyGet ?? (terms?.buyGet ? { buy: terms.buyGet.buy, free: terms.buyGet.free } : c.shape.buyGet),
    },
  }
}

const KIND_ICON: Record<CouponKind, ReactElement> = {
  percent_order: <ReceiptPercent />,
  fixed_order: <Cash />,
  free_shipping: <TruckFast />,
  percent_shipping: <TruckFast />,
  fixed_shipping: <TruckFast />,
  percent_items: <Tag />,
  fixed_items: <Tag />,
  buy_get: <Gift />,
  other: <SquaresPlus />,
}

export function EditCouponModal({
  coupon,
  names,
  currency,
  existing,
  memberGroupIds,
  mode = "edit",
  onOpenChange,
  onSaved,
  onDuplicate,
}: {
  coupon: CouponDto | null
  names: NameMaps
  currency: string
  existing: CouponDto[]
  memberGroupIds: string[]
  mode?: "edit" | "copy"
  onOpenChange: (v: boolean) => void
  onSaved?: (c: CouponDto) => void
  onDuplicate?: (c: CouponDto) => void
}) {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const open = Boolean(coupon)
  const lookups = useLookups(open)
  const update = useUpdateCoupon()
  const duplicate = useDuplicateCoupon()
  const setStatus = useSetStatus()
  const copying = mode === "copy"
  const startCode = (c: CouponDto) => (copying ? nextCode(c.code, existing.map((x) => x.code)) : undefined)
  const [form, setForm] = useState<Form | null>(coupon ? formOf(coupon, memberGroupIds, startCode(coupon)) : null)
  const [datesTouched, setDatesTouched] = useState(false)
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [serverMessage, setServerMessage] = useState<string | null>(null)
  const [medusaStatus, setMedusaStatus] = useState<string | null>(coupon?.medusaStatus ?? null)

  useEffect(() => {
    setForm(coupon ? formOf(coupon, memberGroupIds, startCode(coupon)) : null)
    setDatesTouched(false)
    setPicked({})
    setServerErrors([])
    setServerMessage(null)
    setMedusaStatus(coupon?.medusaStatus ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coupon?.id, mode])

  const store = lookups.data?.store ?? null
  const features = store?.features ?? []
  const has = (f: (typeof features)[number]) => features.includes(f)
  const poolsLabel = poolsWord(store, fmt.lang, t("fields.pools"))
  const nobody = names.nobody ?? null

  const check = useMemo(() => {
    if (!coupon || !form) return null
    const base = copying ? { ...coupon, used: 0 } : coupon
    const patch = patchOf(form, coupon, datesTouched, features)
    if (copying) delete patch.code
    return checkPatch(patch, base, { features, nobody })
  }, [coupon, form, datesTouched, features, copying, nobody])
  const codeOk = !copying || /^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(cleanCode(form?.code))
  const codeTaken = copying && existing.some((c) => c.code.toUpperCase() === cleanCode(form?.code))
  const changed = copying || Boolean(check?.ok && check.value && Object.keys(check.value).length)
  const warnings = coupon && check?.ok && check.value ? editWarnings(check.value, coupon).filter((w) => !copying || w !== "code_changed") : []
  const errors = [...new Set([...(check?.errors ?? []), ...(codeOk ? [] : ["code"]), ...(codeTaken ? ["code_taken"] : []), ...serverErrors])]
  const allNames: NameMaps = useMemo(
    () => ({
      ...names,
      customers: { ...(names.customers ?? {}), ...picked },
      groups: { ...(names.groups ?? {}), ...Object.fromEntries((lookups.data?.groups ?? []).map((g) => [g.id, g.name])) },
      categories: { ...(names.categories ?? {}), ...Object.fromEntries((lookups.data?.categories ?? []).map((c) => [c.id, c.name])) },
      pools: { ...(names.pools ?? {}), ...Object.fromEntries((store?.pools ?? []).map((p) => [p.id, p.name])) },
      priceLists: { ...(names.priceLists ?? {}), ...Object.fromEntries((store?.priceLists ?? []).map((p) => [p.id, p.name])) },
    }),
    [names, picked, lookups.data, store],
  )

  if (!coupon || !form) return null
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setServerErrors([])
    setServerMessage(null)
    setForm((f) => (f ? { ...f, [k]: v } : f))
  }
  const setTerm = <K extends keyof StoreTerms>(k: K, v: StoreTerms[K]) => setForm((f) => (f ? { ...f, terms: { ...f.terms, [k]: v } } : f))
  const setAudience = (a: Audience) =>
    setForm((f) => {
      if (!f) return f
      if (a === "everyone") return { ...f, audience: a, groupIds: [], excludedGroupIds: [], customerIds: [] }
      if (a === "members") return { ...f, audience: a, groupIds: [...memberGroupIds], excludedGroupIds: [], customerIds: [] }
      if (a === "retail") return { ...f, audience: a, groupIds: [], excludedGroupIds: [...memberGroupIds], customerIds: [] }
      if (a === "groups") return { ...f, audience: a, excludedGroupIds: [], customerIds: [] }
      return { ...f, audience: a, excludedGroupIds: [] }
    })

  const s = coupon.shape
  const storeBuyGet = Boolean(coupon.terms?.buyGet)
  const percent = isPercent(coupon)
  const kept = keptConditions(coupon, t)
  const after = preview(coupon, check?.ok ? check.value : null)
  const afterForSentence = copying ? { ...after, code: cleanCode(form.code) } : after
  const onItems = s.kind === "percent_items" || s.kind === "fixed_items"
  const showPools = targetsEditable(coupon) && has("pools") && (form.poolIds.length > 0 || (s.categoryIds.length === 0 && (s.kind !== "buy_get" || storeBuyGet)))
  const showCategories = targetsEditable(coupon) && (s.categoryIds.length > 0 || !showPools)
  const audiences: Audience[] = ["everyone", ...(memberGroupIds.length ? (["members", "retail"] as Audience[]) : []), "groups", "customer"]
  const AUDIENCE_ICON: Record<Audience, ReactElement> = { everyone: <Users />, members: <Buildings />, retail: <BuildingStorefront />, groups: <Tag />, customer: <User /> }
  const paused = medusaStatus === "inactive" || medusaStatus === "draft"
  const changes = check?.ok && check.value ? Object.keys(check.value) : []

  const toggleStatus = async () => {
    const next = paused ? "active" : "inactive"
    try {
      await setStatus.mutateAsync({ id: coupon.id, status: next })
      setMedusaStatus(next)
      toast.success(next === "active" ? t("detail.activated") : t("detail.paused"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const save = async () => {
    if (!check?.ok || !changed || !codeOk || codeTaken) return
    try {
      if (copying) {
        const patch = patchOf(form, coupon, datesTouched, features)
        delete patch.code
        const out = await duplicate.mutateAsync({ id: coupon.id, code: cleanCode(form.code), patch })
        toast.success(t("copy.saved", { code: out.coupon.code }))
        onSaved?.(out.coupon)
      } else {
        const out = await update.mutateAsync({ id: coupon.id, patch: patchOf(form, coupon, datesTouched, features) })
        toast.success(t("edit.saved", { code: out.coupon.code || t("list.noCode") }))
        onSaved?.(out.coupon)
      }
      onOpenChange(false)
    } catch (err) {
      if (err instanceof CouponsRequestError && err.errors.length) setServerErrors(err.errors)
      else setServerMessage(errorMessage(err))
    }
  }

  const kindLabel = s.kind === "percent_items" && (coupon.terms?.pools ?? []).length ? t("wizard.kind.percent_pools.labelOf", { pools: poolsLabel.toLowerCase() }) : t(`edit.kind.${s.kind}`)
  const bigValue =
    s.kind === "free_shipping"
      ? t("wizard.kind.free_shipping.label")
      : s.kind === "buy_get" && form.buyGet
        ? t("wizard.ui.buyGetBig", { buy: form.buyGet.buy, free: form.buyGet.free })
        : form.value === null
          ? kindLabel
          : percent
            ? `-${form.value}%`
            : `-${fmt.money(form.value, s.currency || currency)}`

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex w-full flex-wrap items-center justify-between gap-2 pr-2">
            <div className="flex items-center gap-x-2">
              <Heading level="h2">{copying ? t("copy.title") : t("edit.title")}</Heading>
              <span className="font-mono text-ui-fg-subtle">{coupon.code || t("list.noCode")}</span>
              {!copying ? <StatusBadge status={paused ? "paused" : coupon.status === "paused" ? "active" : coupon.status} /> : null}
            </div>
            {!copying ? (
              <div className="flex items-center gap-2">
                {coupon.status !== "expired" ? (
                  <Button size="small" variant="secondary" isLoading={setStatus.isPending} onClick={() => void toggleStatus()}>
                    {paused ? <PlaySolid /> : <PauseSolid />}
                    {paused ? t("detail.activate") : t("detail.pause")}
                  </Button>
                ) : null}
                {onDuplicate ? (
                  <Button size="small" variant="secondary" onClick={() => onDuplicate(coupon)}>
                    <SquareTwoStack />
                    {t("copy.action")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-1 overflow-hidden">
          <div className="flex w-full flex-col overflow-y-auto lg:flex-row">
            <div className="flex flex-1 flex-col gap-y-6 p-6 lg:overflow-y-auto lg:px-10 lg:py-8">
              {copying ? (
                <InlineTip variant="info" label={t("copy.title")}>
                  {t("copy.intro", { code: coupon.code })}
                </InlineTip>
              ) : paused ? (
                <InlineTip variant="warning" label={t("status.paused")}>
                  {t("edit.pausedInfo")}
                </InlineTip>
              ) : null}

              {/* 1. What it gives */}
              <Section n={1} title={t("edit.section.gives")} hint={t("edit.section.givesHint")}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <BigCard on icon={KIND_ICON[s.kind]} title={kindLabel} hint={t("edit.kindFixed")} />
                  {valueEditable(coupon) ? (
                    <Field label={percent ? t("wizard.value.percent") : t("wizard.value.amount")}>
                      <NumberInput value={form.value} onChange={(v) => set("value", v)} unit={percent ? "%" : (s.currency || currency).toUpperCase()} min={0} step={percent ? 1 : 0.01} />
                    </Field>
                  ) : s.kind === "buy_get" && form.buyGet ? (
                    <Field label={t("fields.buyGet")} hint={storeBuyGet ? t("fields.buyGetHintStore", { pools: poolsLabel.toLowerCase() }) : t("fields.buyGetHint")}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Text size="small">{t("fields.buyEvery")}</Text>
                        <NumberInput value={form.buyGet.buy} onChange={(v) => set("buyGet", { ...form.buyGet!, buy: Number(v) || 0 })} unit={t("fields.pcs")} min={1} className="w-24" />
                        <Text size="small">{t("fields.getFree")}</Text>
                        <NumberInput value={form.buyGet.free} onChange={(v) => set("buyGet", { ...form.buyGet!, free: Number(v) || 0 })} unit={t("fields.pcs")} min={1} className="w-24" />
                      </div>
                      {storeBuyGet ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Text size="small">{t("fields.freePrice")}</Text>
                          <NumberInput value={form.buyGet.freePrice} onChange={(v) => set("buyGet", { ...form.buyGet!, freePrice: v })} unit={currency.toUpperCase()} min={0} step={0.01} className="w-32" placeholder="0" />
                        </div>
                      ) : null}
                    </Field>
                  ) : (
                    <Field label={t("edit.value")} hint={t("edit.valueFixed")}>
                      <Text size="small">{couponSentence(coupon, allNames, t, fmt, currency)}</Text>
                    </Field>
                  )}
                </div>
                {showPools ? (
                  <Field label={poolsLabel} hint={form.poolIds.length ? t("wizard.ui.picked", { count: form.poolIds.length }) : t("fields.poolsAllHint")}>
                    <PickList items={store?.pools ?? []} selected={form.poolIds} onChange={(ids) => set("poolIds", ids)} search={t("fields.search")} />
                  </Field>
                ) : null}
                {showCategories ? (
                  <Field label={t("wizard.value.category")} hint={form.categoryIds.length ? t("wizard.ui.picked", { count: form.categoryIds.length }) : t("edit.categoriesNone")}>
                    <PickList items={lookups.data?.categories ?? []} selected={form.categoryIds} onChange={(ids) => set("categoryIds", ids)} search={t("wizard.ui.categorySearch")} />
                  </Field>
                ) : null}
                {(onItems || s.kind === "buy_get") && (has("minQuantity") || has("priceLists")) && !(s.kind === "buy_get" && !storeBuyGet) ? (
                  <Field label={t("fields.counting")} hint={t("fields.countingHint")}>
                    {has("minQuantity") && s.kind !== "buy_get" ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <Text size="small">{t("fields.fromPieces")}</Text>
                        <NumberInput value={form.terms.minQuantity ?? null} onChange={(v) => setTerm("minQuantity", v)} unit={t("fields.pcs")} min={1} className="w-28" placeholder="1" />
                        {form.terms.minQuantity && form.terms.minQuantity > 1 && has("pools") ? (
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
                            {s.kind === "buy_get" ? t("fields.freeFromPriceList") : t("fields.basePriceList")}
                          </Label>
                          <PriceListSelect value={form.terms.basePriceList} onChange={(v) => setTerm("basePriceList", v)} lists={store?.priceLists ?? []} none={t("fields.basePriceNone")} />
                        </div>
                        {s.kind !== "buy_get" ? (
                          <div className="flex flex-col gap-y-1">
                            <Label size="xsmall" weight="plus">
                              {t("fields.floorPriceList")}
                            </Label>
                            <PriceListSelect value={form.terms.floorPriceList} onChange={(v) => setTerm("floorPriceList", v)} lists={store?.priceLists ?? []} none={t("fields.floorNone")} />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </Field>
                ) : null}
                {has("threshold") && form.terms.threshold ? (
                  <Field label={t("fields.threshold")} hint={t("fields.thresholdHint")}>
                    <div className="flex flex-wrap items-center gap-3">
                      <NumberInput value={form.terms.threshold.value} onChange={(v) => setTerm("threshold", v ? { value: v, metric: form.terms.threshold?.metric ?? "net" } : null)} unit={currency.toUpperCase()} min={0} step={0.01} className="w-36" />
                      <Chips value={form.terms.threshold.metric} options={[{ value: "net", label: t("fields.net") }, { value: "gross", label: t("fields.gross") }]} onChange={(v) => setTerm("threshold", { value: form.terms.threshold?.value ?? 0, metric: v })} />
                    </div>
                  </Field>
                ) : null}
              </Section>

              {/* 2. For whom */}
              <Section n={2} title={t("edit.section.audience")} hint={t("edit.section.audienceHint")}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {audiences.map((a) => (
                    <BigCard key={a} on={form.audience === a} icon={AUDIENCE_ICON[a]} title={t(`wizard.audience.${a}.label`)} hint={t(`wizard.audience.${a}.hint`)} onClick={() => setAudience(a)} />
                  ))}
                </div>
                {form.audience === "members" ? (
                  <Text size="small" className="text-ui-fg-subtle">
                    {memberGroupIds.map((id) => allNames.groups[id] ?? id).join(", ")}
                  </Text>
                ) : null}
                {form.audience === "retail" ? (
                  <Text size="small" className="text-ui-fg-subtle">
                    {t("wizard.ui.retailInfo", { groups: memberGroupIds.map((id) => allNames.groups[id] ?? id).join(", ") })}
                  </Text>
                ) : null}
                {form.audience === "groups" ? (
                  <Field label={t("wizard.groups")} hint={form.excludedGroupIds.length ? t("edit.excludedKept", { groups: form.excludedGroupIds.map((id) => allNames.groups[id] ?? id).join(", ") }) : undefined}>
                    <PickList items={(lookups.data?.groups ?? []).map((g) => ({ id: g.id, name: g.name, badge: g.member ? t("wizard.member") : null }))} selected={form.groupIds} onChange={(ids) => set("groupIds", ids)} search={t("fields.search")} />
                  </Field>
                ) : null}
                {form.audience === "customer" ? (
                  <Field label={t("wizard.audience.customer.label")} hint={t("wizard.ui.customerHint")}>
                    <CustomerPicker selected={form.customerIds} names={allNames.customers} nobody={nobody} onChange={(ids) => set("customerIds", ids)} onName={(id, name) => setPicked((m) => ({ ...m, [id]: name }))} />
                    {form.groupIds.length ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-ui-bg-subtle px-3 py-2">
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {t("edit.alsoGroups", { groups: form.groupIds.map((id) => allNames.groups[id] ?? id).join(", ") })}
                        </Text>
                        <Button size="small" variant="transparent" onClick={() => set("groupIds", [])}>
                          <XMark />
                          {t("edit.dropGroups")}
                        </Button>
                      </div>
                    ) : null}
                  </Field>
                ) : null}
              </Section>

              {/* 3. How it works */}
              <Section n={3} title={t("edit.section.rules")} hint={t("edit.section.rulesHint")}>
                <Field label={copying ? t("copy.code") : t("edit.code")} hint={copying ? t("copy.codeHint") : t("edit.codeHint")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input size="small" className="w-56 font-mono uppercase" value={form.code} onChange={(e) => set("code", cleanCode(e.target.value))} />
                    <Chips value={form.mode} options={[{ value: "code", label: t("edit.modeCode") }, { value: "automatic", label: t("edit.modeAutomatic") }]} onChange={(v) => set("mode", v)} />
                  </div>
                  <Text size="xsmall" className="flex items-center gap-1 text-ui-fg-subtle">
                    {form.mode === "code" ? <Key /> : <Bolt />}
                    {form.mode === "code" ? t("wizard.ui.modeHint.code") : t("wizard.ui.modeHint.automatic")}
                  </Text>
                </Field>
                <Field label={t("edit.validity")} hint={coupon.campaign && !copying ? t("edit.validityCampaign", { name: coupon.campaign.name }) : t("edit.validityHint")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Text size="small">{t("edit.from")}</Text>
                    <Input size="small" type="date" className="w-40" value={form.startsAt} onChange={(e) => (setDatesTouched(true), set("startsAt", e.target.value))} />
                    <Text size="small">{t("edit.to")}</Text>
                    <Input size="small" type="date" className="w-40" value={form.endsAt} onChange={(e) => (setDatesTouched(true), set("endsAt", e.target.value))} />
                    {form.endsAt ? (
                      <Button size="small" variant="transparent" onClick={() => (setDatesTouched(true), set("endsAt", ""))}>
                        {t("edit.noEnd")}
                      </Button>
                    ) : null}
                  </div>
                </Field>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label={t("edit.limit")} hint={copying ? t("copy.limitHint") : t("edit.limitHint", { used: coupon.used })}>
                    <NumberInput value={form.limit} onChange={(v) => set("limit", v)} min={0} placeholder={t("edit.noLimit")} />
                  </Field>
                  <Field label={t("edit.minimum")} hint={t("edit.minimumHint")}>
                    <NumberInput value={form.minimum} onChange={(v) => set("minimum", v)} unit={currency.toUpperCase()} min={0} step={0.01} placeholder={t("edit.noMinimum")} className="w-40" />
                  </Field>
                </div>
                {has("perCustomerOrders") ? (
                  <Field label={t("fields.perCustomer")} hint={form.audience === "customer" ? t("fields.perCustomerHint") : t("fields.perCustomerOnlyCustomers")}>
                    <div className="flex flex-wrap items-center gap-3">
                      <Chips value={form.terms.perCustomerOrders ? "own" : "none"} options={[{ value: "none", label: t("fields.perCustomerNone") }, { value: "own", label: t("fields.perCustomerOwn") }]} onChange={(v) => setTerm("perCustomerOrders", v === "none" ? null : 1)} />
                      {form.terms.perCustomerOrders ? <NumberInput value={form.terms.perCustomerOrders} onChange={(v) => setTerm("perCustomerOrders", v)} unit={t("fields.ordersUnit")} min={1} className="w-36" /> : null}
                    </div>
                  </Field>
                ) : null}
                {has("combines") ? (
                  <Field label={t("fields.combines")} hint={t("fields.combinesHint")}>
                    <CombinesPicker value={form.terms.combines} onChange={(v) => setTerm("combines", v)} coupons={existing} selfCode={coupon.code} />
                  </Field>
                ) : null}
                {has("note") ? (
                  <Field label={t("fields.note")} hint={t("fields.noteHint")}>
                    <NoteField value={form.terms.note} onChange={(v) => setTerm("note", v)} />
                  </Field>
                ) : null}
              </Section>

              {kept.length ? (
                <InlineTip label={t("edit.keptTitle")}>
                  {t("edit.kept", { list: kept.join(", ") })}{" "}
                  <a className="text-ui-fg-interactive underline" href={`/app/promotions/${coupon.id}`}>
                    {t("detail.openInMedusa")}
                  </a>
                </InlineTip>
              ) : null}
            </div>

            <aside className="flex w-full flex-col gap-y-4 border-t border-ui-border-base bg-ui-bg-subtle p-6 lg:w-[380px] lg:overflow-y-auto lg:border-l lg:border-t-0">
              <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
                {t("wizard.ui.preview")}
              </Text>
              <div className="relative overflow-hidden rounded-xl border border-dashed border-ui-border-interactive bg-ui-bg-base p-4">
                <span className="absolute -left-2 top-1/2 size-4 -translate-y-1/2 rounded-full border border-ui-border-base bg-ui-bg-subtle" />
                <span className="absolute -right-2 top-1/2 size-4 -translate-y-1/2 rounded-full border border-ui-border-base bg-ui-bg-subtle" />
                <Text size="xlarge" weight="plus" className="text-ui-fg-interactive">
                  {bigValue}
                </Text>
                {form.terms.note ? (
                  <Text size="xsmall" className="mt-1 italic text-ui-fg-subtle">
                    {form.terms.note}
                  </Text>
                ) : null}
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-dashed border-ui-border-base pt-3">
                  {form.mode === "code" ? <span className="rounded-md bg-ui-bg-component px-2 py-1 font-mono txt-compact-small-plus">{cleanCode(form.code)}</span> : <ToneBadge tone="blue">{t("wizard.mode.automatic")}</ToneBadge>}
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {form.mode === "code" ? t("wizard.ui.previewCode") : t("wizard.ui.previewAutomatic")}
                  </Text>
                </div>
              </div>
              <div className="rounded-xl border border-ui-border-base bg-ui-bg-base p-4">
                <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
                  {copying ? t("copy.after") : t("edit.after")}
                </Text>
                <Text size="small" className="mt-1.5 leading-relaxed" weight="plus">
                  {couponSentence(afterForSentence, allNames, t, fmt, currency)}
                </Text>
              </div>
              {!copying && changes.length ? (
                <div className="rounded-xl border border-ui-border-base bg-ui-bg-base p-4">
                  <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
                    {t("edit.changesTitle")}
                  </Text>
                  <ul className="mt-1.5 flex flex-col gap-y-0.5">
                    {changes.map((k) => (
                      <li key={k} className={clx("txt-compact-small text-ui-fg-base")}>
                        {t(`edit.changed.${k}`, { defaultValue: k })}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {errors.length ? (
                <div className="flex flex-col gap-y-1">
                  {errors.map((k) => (
                    <Text key={k} size="small" className="text-ui-fg-error">
                      {t(`edit.error.${k}`, { defaultValue: t(`wizard.error.${k}`, { defaultValue: k }) })}
                    </Text>
                  ))}
                </div>
              ) : null}
              {serverMessage ? (
                <Text size="small" className="text-ui-fg-error">
                  {serverMessage}
                </Text>
              ) : null}
              {warnings.map((k) => (
                <InlineTip key={k} variant="warning" label={t("edit.warningLabel")}>
                  {t(`edit.warning.${k}`)}
                </InlineTip>
              ))}
              {!changed && !errors.length ? (
                <Text size="small" className="text-ui-fg-subtle">
                  {t("edit.unchanged")}
                </Text>
              ) : null}
            </aside>
          </div>
        </FocusModal.Body>
        <FocusModal.Footer>
          <div className="flex w-full items-center justify-between gap-2">
            <a href={`/app/promotions/${coupon.id}`}>
              <Button size="small" variant="transparent">
                <ArrowUpRightOnBox />
                {t("detail.openInMedusa")}
              </Button>
            </a>
            <div className="flex items-center gap-2">
              <FocusModal.Close asChild>
                <Button size="small" variant="secondary">
                  {t("edit.cancel")}
                </Button>
              </FocusModal.Close>
              <Button size="small" disabled={!changed || !check?.ok || !codeOk || codeTaken} isLoading={update.isPending || duplicate.isPending} onClick={() => void save()}>
                {copying ? t("copy.save") : t("edit.save")}
              </Button>
            </div>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}

/** The conditions the form does not edit, in words, so nobody thinks they vanished. */
function keptConditions(c: CouponDto, t: (k: string, o?: Record<string, unknown>) => string): string[] {
  const s = c.shape
  const out: string[] = []
  if (s.categoryIds.length && !targetsEditable(c)) out.push(t("edit.keptWhat.categories", { count: s.categoryIds.length }))
  if (s.productIds.length) out.push(t("edit.keptWhat.products", { count: s.productIds.length }))
  if (s.collectionIds.length) out.push(t("edit.keptWhat.collections", { count: s.collectionIds.length }))
  if ((s.tagIds ?? []).length && !(c.terms?.pools ?? []).length) out.push(t("edit.keptWhat.tags", { count: (s.tagIds ?? []).length }))
  if (s.shippingTypeIds.length || s.shippingOptionIds.length) out.push(t("edit.keptWhat.shipping"))
  if (s.salesChannelIds.length) out.push(t("edit.keptWhat.channels"))
  if (s.regionIds.length) out.push(t("edit.keptWhat.regions"))
  if (s.rules.length) out.push(t("edit.keptWhat.other", { count: s.rules.length }))
  return out
}
