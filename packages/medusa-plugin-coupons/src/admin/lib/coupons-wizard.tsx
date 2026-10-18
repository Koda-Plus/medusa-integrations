import { Fragment, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Bolt, Buildings, Cash, CheckCircleSolid, CheckMini, ChevronRight, ExclamationCircle, Key, ReceiptPercent, Sparkles, Tag, TruckFast, User, Users } from "@medusajs/icons"
import { Badge, Button, Checkbox, FocusModal, Heading, InlineTip, Input, Label, Text, clx, toast } from "@medusajs/ui"
import type { CouponDto, NameMaps, WizardInput } from "../../modules/coupons/lib/contract"
import { checkWizard, cleanCode, endOfMonth, suggestCode, wizardWarnings } from "../../modules/coupons/lib/wizard"
import { CouponsRequestError, errorMessage, useCreateCoupon, useCustomerSearch, useLookups } from "./coupons-api"
import { couponSentence, wizardCoupon } from "./coupons-sentence"
import { useFormat } from "./coupons-ui"

/**
 * THE CREATOR, full screen: the steps on the left (each with what was
 * picked and whether it is complete), the step in the middle, and on the
 * right a live preview: the coupon the way the customer sees it, the plain
 * sentence, the key facts, readiness and the warnings. One button saves an
 * ordinary Medusa promotion. The checks and warnings are the same functions the
 * server runs again before it writes.
 */

type Step = 1 | 2 | 3

const START: WizardInput = {
  kind: "percent_order",
  value: 15,
  categoryIds: [],
  audience: "everyone",
  groupIds: [],
  customerId: null,
  mode: "code",
  code: "",
  validity: "30d",
  startsAt: null,
  endsAt: null,
  limit: null,
  minimum: null,
}

const PERCENTS = [10, 15, 20, 30]
const AMOUNTS = [30, 50, 100]

export function CreateCouponModal({ open, onOpenChange, existing, memberGroupIds, codePrefix, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; existing: CouponDto[]; memberGroupIds: string[]; codePrefix: string | null; onCreated: (c: CouponDto) => void }) {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const lookups = useLookups(open)
  const create = useCreateCoupon()
  const [step, setStep] = useState<Step>(1)
  const [form, setForm] = useState<WizardInput>(START)
  const [customerQ, setCustomerQ] = useState("")
  const [customerName, setCustomerName] = useState<string | null>(null)
  const [categoryQ, setCategoryQ] = useState("")
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const customers = useCustomerSearch(form.audience === "customer" ? customerQ : "")
  const currency = form.currencyCode ?? lookups.data?.currencyCode ?? "pln"
  const set = <K extends keyof WizardInput>(k: K, v: WizardInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const reset = () => {
    setStep(1)
    setForm(START)
    setCustomerQ("")
    setCustomerName(null)
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

  const names: NameMaps = useMemo(
    () => ({
      groups: Object.fromEntries((lookups.data?.groups ?? []).map((g) => [g.id, g.name])),
      categories: Object.fromEntries((lookups.data?.categories ?? []).map((c) => [c.id, c.name])),
      products: {},
      customers: form.customerId && customerName ? { [form.customerId]: customerName } : {},
    }),
    [lookups.data, form.customerId, customerName],
  )

  const withCode = !form.code ? { ...form, code: suggestCode(form, codePrefix) } : form
  const check = checkWizard(withCode, { currencyCode: currency })
  const sentence = couponSentence(wizardCoupon(withCode, dates), names, t, fmt, currency)
  const warnings = wizardWarnings(withCode, { active: existing, memberGroupIds })
  const stepErrors = (s: Step) =>
    check.errors.filter((e) => (s === 1 ? ["kind", "percent", "amount", "category"] : s === 2 ? ["audience", "groups", "customer"] : ["code", "dates", "validity", "limit", "minimum"]).includes(e))

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

  const categories = (lookups.data?.categories ?? []).filter((c) => !categoryQ || c.name.toLowerCase().includes(categoryQ.toLowerCase())).slice(0, 60)
  const toggle = (list: string[] | undefined, id: string) => (list ?? []).includes(id) ? (list ?? []).filter((x) => x !== id) : [...(list ?? []), id]

  const STEP_KEY = { 1: "kind", 2: "audience", 3: "rules" } as const
  const KIND_ICON = { percent_order: <ReceiptPercent />, fixed_order: <Cash />, free_shipping: <TruckFast />, percent_category: <Tag /> } as const
  const AUDIENCE_ICON = { everyone: <Users />, groups: <Buildings />, customer: <User /> } as const
  const stepDone = (s: Step) => stepErrors(s).length === 0
  /* Co wybrano w kroku, jednym krótkim zdaniem pod jego nazwą. */
  const stepSummary = (s: Step): string => {
    if (s === 1) return `${t(`wizard.kind.${form.kind}.label`)}${form.kind === "free_shipping" ? "" : form.value ? `, ${form.kind === "fixed_order" ? fmt.money(Number(form.value), currency) : `${form.value}%`}` : ""}`
    if (s === 2) return form.audience === "groups" ? `${t("wizard.audience.groups.label")}: ${(form.groupIds ?? []).length}` : form.audience === "customer" ? customerName ?? t("wizard.audience.customer.label") : t("wizard.audience.everyone.label")
    return `${form.mode === "code" ? t("wizard.mode.code") : t("wizard.mode.automatic")}, ${t(`wizard.validity.${form.validity}`)}`
  }
  const bigValue = form.kind === "free_shipping" ? t("wizard.kind.free_shipping.label") : form.kind === "fixed_order" ? `-${fmt.money(Number(form.value ?? 0), currency)}` : `-${form.value ?? 0}%`
  const sample = 300
  const after = form.kind === "fixed_order" ? Math.max(0, sample - Number(form.value ?? 0)) : form.kind === "free_shipping" ? sample : sample * (1 - Number(form.value ?? 0) / 100)
  const validityText = dates.endsAt ? `${dates.startsAt ? fmt.date(dates.startsAt) : ""} - ${fmt.date(dates.endsAt)}` : t("wizard.validity.none")

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
            {/* Kroki: nazwa, co w nim wybrano, czy gotowy. */}
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

            {/* Formularz kroku. */}
            <div className="flex flex-col gap-y-5 p-6 lg:overflow-y-auto lg:px-10 lg:py-8">
              <div>
                <Heading>{t(`wizard.step.${STEP_KEY[step]}`)}</Heading>
                <Text size="small" className="max-w-xl text-ui-fg-subtle">
                  {t(`wizard.ui.stepIntro.${STEP_KEY[step]}`)}
                </Text>
              </div>

              {step === 1 ? (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {(["percent_order", "fixed_order", "free_shipping", "percent_category"] as const).map((k) => (
                      <BigCard
                        key={k}
                        on={form.kind === k}
                        icon={KIND_ICON[k]}
                        title={t(`wizard.kind.${k}.label`)}
                        hint={t(`wizard.kind.${k}.hint`)}
                        onClick={() => setForm((f) => ({ ...f, kind: k, value: k === "fixed_order" ? (AMOUNTS.includes(Number(f.value)) ? f.value : 50) : k === "free_shipping" ? null : PERCENTS.includes(Number(f.value)) ? f.value : 15 }))}
                      />
                    ))}
                  </div>
                  {form.kind !== "free_shipping" ? (
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
                          <div className="relative">
                            <Input size="small" type="number" min={1} className="w-28 pr-8" value={form.value ?? ""} onChange={(e) => set("value", e.target.value === "" ? null : Number(e.target.value))} />
                            <span className="txt-compact-small pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ui-fg-muted">{form.kind === "fixed_order" ? currency.toUpperCase() : "%"}</span>
                          </div>
                        </div>
                      </div>
                    </Field>
                  ) : (
                    <InlineTip variant="info" label={t("wizard.kind.free_shipping.label")}>
                      {t("wizard.ui.exampleShipping")}
                    </InlineTip>
                  )}
                  {form.kind === "percent_category" ? (
                    <Field label={t("wizard.value.category")} hint={(form.categoryIds ?? []).length ? t("wizard.ui.picked", { count: (form.categoryIds ?? []).length }) : t("wizard.value.pickCategory")}>
                      <Input size="small" placeholder={t("wizard.ui.categorySearch")} value={categoryQ} onChange={(e) => setCategoryQ(e.target.value)} />
                      <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                        {categories.map((c) => (
                          <label key={c.id} className={clx("flex cursor-pointer items-center gap-x-2 rounded-md border px-2.5 py-1.5", (form.categoryIds ?? []).includes(c.id) ? "border-ui-border-interactive bg-ui-bg-highlight" : "border-transparent hover:bg-ui-bg-base-hover")}>
                            <Checkbox checked={(form.categoryIds ?? []).includes(c.id)} onCheckedChange={() => set("categoryIds", toggle(form.categoryIds, c.id))} />
                            <Text size="small">{c.name}</Text>
                          </label>
                        ))}
                      </div>
                    </Field>
                  ) : null}
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {(["everyone", "groups", "customer"] as const).map((a) => (
                      <BigCard key={a} on={form.audience === a} icon={AUDIENCE_ICON[a]} title={t(`wizard.audience.${a}.label`)} hint={t(`wizard.audience.${a}.hint`)} onClick={() => set("audience", a)} />
                    ))}
                  </div>
                  {form.audience === "groups" ? (
                    <Field label={t("wizard.groups")} hint={(form.groupIds ?? []).length ? t("wizard.ui.picked", { count: (form.groupIds ?? []).length }) : undefined}>
                      <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                        {(lookups.data?.groups ?? []).map((g) => (
                          <label key={g.id} className={clx("flex cursor-pointer items-center gap-x-2 rounded-md border px-2.5 py-1.5", (form.groupIds ?? []).includes(g.id) ? "border-ui-border-interactive bg-ui-bg-highlight" : "border-transparent hover:bg-ui-bg-base-hover")}>
                            <Checkbox checked={(form.groupIds ?? []).includes(g.id)} onCheckedChange={() => set("groupIds", toggle(form.groupIds, g.id))} />
                            <Text size="small">{g.name}</Text>
                            {g.member ? (
                              <Badge size="2xsmall" color="orange">
                                {t("wizard.member")}
                              </Badge>
                            ) : null}
                          </label>
                        ))}
                      </div>
                    </Field>
                  ) : null}
                  {form.audience === "customer" ? (
                    <Field label={t("wizard.audience.customer.label")} hint={form.customerId && customerName ? t("wizard.customerPicked", { name: customerName }) : undefined}>
                      <Input size="small" placeholder={t("wizard.customerSearch")} value={customerQ} onChange={(e) => setCustomerQ(e.target.value)} />
                      <div className="flex flex-col gap-y-1">
                        {(customers.data?.customers ?? []).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              set("customerId", c.id)
                              setCustomerName(c.name ?? c.email)
                            }}
                            className={clx("flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left", form.customerId === c.id ? "border-ui-border-interactive bg-ui-bg-highlight" : "border-ui-border-base hover:bg-ui-bg-base-hover")}
                          >
                            <span className="flex items-center gap-x-2">
                              <User className="text-ui-fg-muted" />
                              <Text size="small" weight="plus">
                                {c.name ?? c.email}
                              </Text>
                            </span>
                            <Text size="xsmall" className="text-ui-fg-subtle">
                              {c.email}
                            </Text>
                          </button>
                        ))}
                        {customerQ.trim().length >= 2 && customers.data && customers.data.customers.length === 0 ? (
                          <Text size="small" className="text-ui-fg-subtle">
                            {t("wizard.noCustomers")}
                          </Text>
                        ) : null}
                      </div>
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
                      {form.limit && form.limit !== 1 && form.limit !== 100 ? <Input size="small" type="number" min={1} className="w-28" value={form.limit} onChange={(e) => set("limit", e.target.value ? Number(e.target.value) : null)} /> : null}
                    </Field>
                    <Field label={t("wizard.minimum.label")} hint={t("wizard.ui.minimumHint")}>
                      <Chips value={form.minimum ? "own" : "none"} options={[{ value: "none", label: t("wizard.minimum.none") }, { value: "own", label: t("wizard.minimum.own") }]} onChange={(v) => set("minimum", v === "none" ? null : 300)} />
                      {form.minimum ? (
                        <div className="relative w-36">
                          <Input size="small" type="number" min={0} className="pr-12" value={form.minimum} onChange={(e) => set("minimum", e.target.value ? Number(e.target.value) : null)} />
                          <span className="txt-compact-small pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ui-fg-muted">{currency.toUpperCase()}</span>
                        </div>
                      ) : null}
                    </Field>
                  </div>
                </>
              ) : null}

              {stepErrors(step).length ? (
                <InlineTip variant="info" label={t(`wizard.step.${STEP_KEY[step]}`)}>
                  {stepErrors(step).map((e) => t(`wizard.error.${e}`)).join(" ")}
                </InlineTip>
              ) : null}
            </div>

            {/* Podgląd na żywo: kupon jak u klienta, zdanie, fakty, ostrzeżenia, gotowość. */}
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
                  {form.kind === "percent_category" && (form.categoryIds ?? []).length
                    ? (form.categoryIds ?? []).map((id) => names.categories[id]).filter(Boolean).join(", ")
                    : t(`wizard.kind.${form.kind}.hint`)}
                </Text>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-dashed border-ui-border-base pt-3">
                  {form.mode === "code" ? <span className="rounded-md bg-ui-bg-component px-2 py-1 font-mono txt-compact-small-plus">{withCode.code}</span> : <Badge size="2xsmall" color="blue">{t("wizard.mode.automatic")}</Badge>}
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

/* The creator's fields live at module level: defined inside the component they would remount on every keystroke (the input loses focus). */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-2 rounded-xl border border-ui-border-base bg-ui-bg-base p-4">
      <div>
        <Label size="small" weight="plus">
          {label}
        </Label>
        {hint ? (
          <Text size="xsmall" className="text-ui-fg-subtle">
            {hint}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function BigCard({ on, icon, title, hint, onClick }: { on: boolean; icon: ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={clx(
        "flex items-start gap-x-3 rounded-xl border p-4 text-left transition-fg",
        on ? "border-ui-border-interactive bg-ui-bg-highlight shadow-borders-interactive-with-active" : "border-ui-border-base bg-ui-bg-base hover:bg-ui-bg-base-hover",
      )}
    >
      <span className={clx("flex size-9 shrink-0 items-center justify-center rounded-lg", on ? "bg-ui-bg-interactive text-ui-fg-on-color" : "bg-ui-bg-component text-ui-fg-subtle")}>{icon}</span>
      <span className="flex flex-col gap-y-0.5">
        <Text size="small" weight="plus">
          {title}
        </Text>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {hint}
        </Text>
      </span>
    </button>
  )
}

function Chips<T extends string | number>({ value, options, onChange }: { value: T | null; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={clx(
            "txt-compact-small-plus min-w-[4.5rem] rounded-lg border px-3 py-2 transition-fg",
            value === o.value ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color" : "border-ui-border-base bg-ui-bg-base text-ui-fg-base hover:bg-ui-bg-base-hover",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
