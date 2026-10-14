import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Button, Checkbox, FocusModal, Heading, InlineTip, Input, Label, Text, clx, toast } from "@medusajs/ui"
import type { CouponDto, NameMaps, WizardInput } from "../../modules/coupons/lib/contract"
import { checkWizard, cleanCode, endOfMonth, suggestCode, wizardWarnings } from "../../modules/coupons/lib/wizard"
import { CouponsRequestError, errorMessage, useCreateCoupon, useCustomerSearch, useLookups } from "./coupons-api"
import { couponSentence, wizardCoupon } from "./coupons-sentence"
import { OptionCard, Segment, useFormat } from "./coupons-ui"

/**
 * THE CREATOR: three steps (type, for whom, rules), the plain sentence and
 * the warnings live on the right, and one button that saves an ordinary
 * Medusa promotion. The checks and warnings are the same functions the
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
          <div className="flex items-center gap-2">
            {([1, 2, 3] as Step[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStep(s)}
                className={clx(
                  "txt-compact-small-plus flex items-center gap-x-1.5 rounded-full border px-2.5 py-1",
                  step === s ? "border-ui-border-interactive text-ui-fg-interactive" : "border-ui-border-base text-ui-fg-subtle",
                )}
              >
                <span className={clx("flex size-4 items-center justify-center rounded-full text-[10px]", step === s ? "bg-ui-bg-interactive text-ui-fg-on-color" : "bg-ui-bg-component")}>{s}</span>
                {t(`wizard.step.${s === 1 ? "kind" : s === 2 ? "audience" : "rules"}`)}
              </button>
            ))}
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-1 flex-col overflow-y-auto">
          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-y-6">
              <div>
                <Heading>{t("wizard.title")}</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  {t("wizard.subtitle")}
                </Text>
              </div>

              {step === 1 ? (
                <div className="flex flex-col gap-y-5">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(["percent_order", "fixed_order", "free_shipping", "percent_category"] as const).map((k) => (
                      <OptionCard
                        key={k}
                        on={form.kind === k}
                        title={t(`wizard.kind.${k}.label`)}
                        hint={t(`wizard.kind.${k}.hint`)}
                        onClick={() => setForm((f) => ({ ...f, kind: k, value: k === "fixed_order" ? (AMOUNTS.includes(Number(f.value)) ? f.value : 50) : k === "free_shipping" ? null : PERCENTS.includes(Number(f.value)) ? f.value : 15 }))}
                      />
                    ))}
                  </div>
                  {form.kind !== "free_shipping" ? (
                    <div className="flex flex-col gap-y-2">
                      <Label size="small">{form.kind === "fixed_order" ? t("wizard.value.amount") : t("wizard.value.percent")}</Label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Segment
                          value={String(form.value ?? "")}
                          options={(form.kind === "fixed_order" ? AMOUNTS : PERCENTS).map((v) => ({ value: String(v), label: form.kind === "fixed_order" ? fmt.money(v, currency) : `${v}%` }))}
                          onChange={(v) => set("value", Number(v))}
                        />
                        <Input size="small" type="number" min={1} className="w-28" value={form.value ?? ""} onChange={(e) => set("value", e.target.value === "" ? null : Number(e.target.value))} />
                      </div>
                    </div>
                  ) : null}
                  {form.kind === "percent_category" ? (
                    <div className="flex flex-col gap-y-2">
                      <Label size="small">{t("wizard.value.category")}</Label>
                      <Input size="small" placeholder={t("wizard.value.pickCategory")} value={categoryQ} onChange={(e) => setCategoryQ(e.target.value)} />
                      <div className="flex max-h-56 flex-col gap-y-1 overflow-y-auto rounded-md border border-ui-border-base p-2">
                        {categories.map((c) => (
                          <label key={c.id} className="flex cursor-pointer items-center gap-x-2 rounded px-1 py-0.5 hover:bg-ui-bg-base-hover">
                            <Checkbox checked={(form.categoryIds ?? []).includes(c.id)} onCheckedChange={() => set("categoryIds", toggle(form.categoryIds, c.id))} />
                            <Text size="small">{c.name}</Text>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {step === 2 ? (
                <div className="flex flex-col gap-y-5">
                  <div className="grid grid-cols-1 gap-2">
                    {(["everyone", "groups", "customer"] as const).map((a) => (
                      <OptionCard key={a} on={form.audience === a} title={t(`wizard.audience.${a}.label`)} hint={t(`wizard.audience.${a}.hint`)} onClick={() => set("audience", a)} />
                    ))}
                  </div>
                  {form.audience === "groups" ? (
                    <div className="flex flex-col gap-y-2">
                      <Label size="small">{t("wizard.groups")}</Label>
                      <div className="flex max-h-56 flex-col gap-y-1 overflow-y-auto rounded-md border border-ui-border-base p-2">
                        {(lookups.data?.groups ?? []).map((g) => (
                          <label key={g.id} className="flex cursor-pointer items-center gap-x-2 rounded px-1 py-0.5 hover:bg-ui-bg-base-hover">
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
                    </div>
                  ) : null}
                  {form.audience === "customer" ? (
                    <div className="flex flex-col gap-y-2">
                      <Input size="small" placeholder={t("wizard.customerSearch")} value={customerQ} onChange={(e) => setCustomerQ(e.target.value)} />
                      {form.customerId && customerName ? (
                        <Badge size="2xsmall" color="green">
                          {t("wizard.customerPicked", { name: customerName })}
                        </Badge>
                      ) : null}
                      <div className="flex flex-col gap-y-1">
                        {(customers.data?.customers ?? []).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              set("customerId", c.id)
                              setCustomerName(c.name ?? c.email)
                            }}
                            className={clx("flex items-center justify-between rounded-md border px-3 py-2 text-left", form.customerId === c.id ? "border-ui-border-interactive" : "border-ui-border-base hover:bg-ui-bg-base-hover")}
                          >
                            <Text size="small" weight="plus">
                              {c.name ?? c.email}
                            </Text>
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
                    </div>
                  ) : null}
                </div>
              ) : null}

              {step === 3 ? (
                <div className="flex flex-col gap-y-5">
                  <div className="flex flex-col gap-y-2">
                    <Label size="small">{t("wizard.mode.label")}</Label>
                    <Segment value={form.mode} options={[{ value: "code", label: t("wizard.mode.code") }, { value: "automatic", label: t("wizard.mode.automatic") }]} onChange={(v) => set("mode", v)} />
                  </div>
                  {/* Medusa keeps a code on every promotion: an automatic one shows it as its name. */}
                  <div className="flex flex-col gap-y-2">
                    <Label size="small">{form.mode === "code" ? t("wizard.code") : t("wizard.codeAutomatic")}</Label>
                    <div className="flex items-center gap-2">
                      <Input size="small" className="w-64 font-mono uppercase" placeholder={suggestCode(form, codePrefix)} value={form.code ?? ""} onChange={(e) => set("code", cleanCode(e.target.value))} />
                      <Button size="small" variant="secondary" onClick={() => set("code", suggestCode(form, codePrefix))}>
                        {t("wizard.suggest")}
                      </Button>
                    </div>
                    {form.mode === "automatic" ? (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {t("wizard.codeAutomaticHint")}
                      </Text>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-y-2">
                    <Label size="small">{t("wizard.validity.label")}</Label>
                    <Segment
                      value={form.validity}
                      options={(["month", "30d", "none", "custom"] as const).map((v) => ({ value: v, label: t(`wizard.validity.${v}`) }))}
                      onChange={(v) => set("validity", v)}
                    />
                    {form.validity === "custom" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Label size="xsmall">{t("wizard.validity.from")}</Label>
                        {/* A day as a date: from its first second, to its last one. */}
                        <Input size="small" type="date" className="w-40" value={(form.startsAt ?? "").slice(0, 10)} onChange={(e) => set("startsAt", e.target.value ? `${e.target.value}T00:00:00` : null)} />
                        <Label size="xsmall">{t("wizard.validity.to")}</Label>
                        <Input size="small" type="date" className="w-40" value={(form.endsAt ?? "").slice(0, 10)} onChange={(e) => set("endsAt", e.target.value ? `${e.target.value}T23:59:59` : null)} />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-y-2">
                    <Label size="small">{t("wizard.limit.label")}</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Segment
                        value={form.limit === 1 ? "once" : form.limit === 100 ? "hundred" : form.limit ? "own" : "none"}
                        options={[{ value: "once", label: t("wizard.limit.once") }, { value: "hundred", label: t("wizard.limit.hundred") }, { value: "none", label: t("wizard.limit.none") }, { value: "own", label: t("wizard.limit.own") }]}
                        onChange={(v) => set("limit", v === "once" ? 1 : v === "hundred" ? 100 : v === "none" ? null : 10)}
                      />
                      {form.limit && form.limit !== 1 && form.limit !== 100 ? <Input size="small" type="number" min={1} className="w-24" value={form.limit} onChange={(e) => set("limit", e.target.value ? Number(e.target.value) : null)} /> : null}
                    </div>
                  </div>
                  <div className="flex flex-col gap-y-2">
                    <Label size="small">{t("wizard.minimum.label")}</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Segment value={form.minimum ? "own" : "none"} options={[{ value: "none", label: t("wizard.minimum.none") }, { value: "own", label: t("wizard.minimum.own") }]} onChange={(v) => set("minimum", v === "none" ? null : 300)} />
                      {form.minimum ? <Input size="small" type="number" min={0} className="w-28" value={form.minimum} onChange={(e) => set("minimum", e.target.value ? Number(e.target.value) : null)} /> : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {stepErrors(step).length ? (
                <InlineTip variant="info" label={t(`wizard.step.${step === 1 ? "kind" : step === 2 ? "audience" : "rules"}`)}>
                  {stepErrors(step).map((e) => t(`wizard.error.${e}`)).join(" ")}
                </InlineTip>
              ) : null}
            </div>

            <div className="flex flex-col gap-y-4">
              <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
                <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
                  {t("wizard.summary")}
                </Text>
                <Text className="mt-2" weight="plus">
                  {sentence}
                </Text>
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
            </div>
          </div>
        </FocusModal.Body>
        <FocusModal.Footer>
          <div className="flex w-full items-center justify-end gap-2">
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
              </Button>
            ) : (
              <Button size="small" onClick={() => void save()} isLoading={create.isPending} disabled={!check.ok}>
                {t("wizard.save")}
              </Button>
            )}
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}
