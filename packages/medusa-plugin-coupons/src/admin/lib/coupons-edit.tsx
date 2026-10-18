import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowUpRightOnBox, User, XMark } from "@medusajs/icons"
import { Badge, Button, Checkbox, FocusModal, Heading, InlineTip, Input, Label, Text, clx, toast } from "@medusajs/ui"
import type { CouponDto, CouponPatch, NameMaps } from "../../modules/coupons/lib/contract"
import { checkPatch, editWarnings, isPercent, valueEditable, type NormalizedPatch } from "../../modules/coupons/lib/edit"
import { CouponsRequestError, errorMessage, useCustomerSearch, useLookups, useUpdateCoupon } from "./coupons-api"
import { couponSentence } from "./coupons-sentence"
import { StatusBadge, useFormat } from "./coupons-ui"

/**
 * THE EDIT FORM, full screen: the fields on the left, on the right the coupon
 * in one plain sentence as it will be after saving, and the warnings. Opened
 * from a row of the list and from a coupon's detail. Saves through Medusa's
 * own promotion workflows; what the form does not show is kept as it is.
 */

type Form = {
  code: string
  mode: "code" | "automatic"
  value: string
  startsAt: string
  endsAt: string
  limit: string
  minimum: string
  groupIds: string[]
  customerIds: string[]
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "")

function formOf(c: CouponDto): Form {
  return {
    code: c.code ?? "",
    mode: c.automatic ? "automatic" : "code",
    value: c.shape.value === null ? "" : String(c.shape.value),
    startsAt: day(c.startsAt),
    endsAt: day(c.endsAt),
    limit: c.limit === null ? "" : String(c.limit),
    minimum: c.shape.minimum === null ? "" : String(c.shape.minimum),
    groupIds: [...c.shape.groupIds],
    customerIds: [...c.shape.customerIds],
  }
}

/** A day of the form as an exact moment in the browser's time zone (the server runs in UTC). */
const localDay = (d: string, time: string) => (d ? new Date(`${d}T${time}`).toISOString() : null)

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")))

/** The form as a patch. Dates only when touched: the form keeps days, the coupon exact times. */
function patchOf(f: Form, datesTouched: boolean, valueOn: boolean): CouponPatch {
  return {
    code: f.code,
    mode: f.mode,
    ...(valueOn ? { value: num(f.value) } : {}),
    ...(datesTouched ? { startsAt: localDay(f.startsAt, "00:00:00"), endsAt: localDay(f.endsAt, "23:59:59.999") } : {}),
    limit: num(f.limit),
    minimum: num(f.minimum),
    groupIds: f.groupIds,
    customerIds: f.customerIds,
  }
}

/** The coupon as it will be, for the sentence on the right. */
function preview(c: CouponDto, p: NormalizedPatch | null): CouponDto {
  if (!p) return c
  return {
    ...c,
    code: p.code ?? c.code,
    automatic: p.automatic ?? c.automatic,
    startsAt: p.dates ? (p.dates.startsAt ? p.dates.startsAt.toISOString() : null) : c.startsAt,
    endsAt: p.dates ? (p.dates.endsAt ? p.dates.endsAt.toISOString() : null) : c.endsAt,
    limit: p.limit !== undefined ? p.limit : c.limit,
    shape: {
      ...c.shape,
      value: p.value ?? c.shape.value,
      minimum: p.minimum !== undefined ? p.minimum : c.shape.minimum,
      groupIds: p.groupIds ?? c.shape.groupIds,
      customerIds: p.customerIds ?? c.shape.customerIds,
    },
  }
}

export function EditCouponModal({ coupon, names, currency, onOpenChange, onSaved }: { coupon: CouponDto | null; names: NameMaps; currency: string; onOpenChange: (v: boolean) => void; onSaved?: (c: CouponDto) => void }) {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const open = Boolean(coupon)
  const lookups = useLookups(open)
  const update = useUpdateCoupon()
  const [form, setForm] = useState<Form | null>(coupon ? formOf(coupon) : null)
  const [datesTouched, setDatesTouched] = useState(false)
  const [customerQ, setCustomerQ] = useState("")
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [serverMessage, setServerMessage] = useState<string | null>(null)
  const customers = useCustomerSearch(customerQ)

  useEffect(() => {
    setForm(coupon ? formOf(coupon) : null)
    setDatesTouched(false)
    setCustomerQ("")
    setPicked({})
    setServerErrors([])
    setServerMessage(null)
  }, [coupon?.id])

  const check = useMemo(() => (coupon && form ? checkPatch(patchOf(form, datesTouched, valueEditable(coupon)), coupon) : null), [coupon, form, datesTouched])
  const changed = Boolean(check?.ok && check.value && Object.keys(check.value).length)
  const warnings = coupon && check?.ok && check.value ? editWarnings(check.value, coupon) : []
  const errors = [...new Set([...(check?.errors ?? []), ...serverErrors])]
  const allNames: NameMaps = useMemo(() => ({ ...names, customers: { ...(names.customers ?? {}), ...picked } }), [names, picked])

  if (!coupon || !form) return null
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setServerErrors([])
    setServerMessage(null)
    setForm((f) => (f ? { ...f, [k]: v } : f))
  }
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const kept = keptConditions(coupon, t)
  const percent = isPercent(coupon)

  const save = async () => {
    if (!check?.ok || !changed) return
    try {
      const out = await update.mutateAsync({ id: coupon.id, patch: patchOf(form, datesTouched, valueEditable(coupon)) })
      toast.success(t("edit.saved", { code: out.coupon.code || t("list.noCode") }))
      onSaved?.(out.coupon)
      onOpenChange(false)
    } catch (err) {
      if (err instanceof CouponsRequestError && err.errors.length) setServerErrors(err.errors)
      else setServerMessage(errorMessage(err))
    }
  }

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center gap-x-2">
            <Heading level="h2">{t("edit.title")}</Heading>
            <span className="font-mono text-ui-fg-subtle">{coupon.code || t("list.noCode")}</span>
            <StatusBadge status={coupon.status} />
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-1 overflow-hidden">
          <div className="flex w-full flex-col overflow-y-auto lg:flex-row">
            <div className="flex flex-1 flex-col gap-y-4 p-6">
              <Field label={t("edit.code")} hint={t("edit.codeHint")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Input size="small" className="w-56 font-mono" value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} />
                  <Chips value={form.mode} options={[{ value: "code", label: t("edit.modeCode") }, { value: "automatic", label: t("edit.modeAutomatic") }]} onChange={(v) => set("mode", v)} />
                </div>
              </Field>

              <Field label={t("edit.value")} hint={valueEditable(coupon) ? undefined : t("edit.valueFixed")}>
                {valueEditable(coupon) ? (
                  <div className="flex items-center gap-2">
                    <Input size="small" type="number" min={0} step={percent ? 1 : 0.01} className="w-32" value={form.value} onChange={(e) => set("value", e.target.value)} />
                    <Text size="small" className="text-ui-fg-subtle">
                      {percent ? "%" : (coupon.shape.currency || currency).toUpperCase()}
                    </Text>
                  </div>
                ) : (
                  <Text size="small">{couponSentence(coupon, names, t, fmt, currency)}</Text>
                )}
              </Field>

              <Field label={t("edit.validity")} hint={coupon.campaign ? t("edit.validityCampaign", { name: coupon.campaign.name }) : t("edit.validityHint")}>
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

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label={t("edit.limit")} hint={t("edit.limitHint", { used: coupon.used })}>
                  <Input size="small" type="number" min={0} step={1} placeholder={t("edit.noLimit")} value={form.limit} onChange={(e) => set("limit", e.target.value)} />
                </Field>
                <Field label={t("edit.minimum")} hint={t("edit.minimumHint")}>
                  <div className="flex items-center gap-2">
                    <Input size="small" type="number" min={0} step={0.01} placeholder={t("edit.noMinimum")} value={form.minimum} onChange={(e) => set("minimum", e.target.value)} />
                    <Text size="small" className="text-ui-fg-subtle">
                      {currency.toUpperCase()}
                    </Text>
                  </div>
                </Field>
              </div>

              <Field label={t("edit.audience")} hint={form.groupIds.length + form.customerIds.length ? t("edit.audienceSome") : t("edit.audienceEveryone")}>
                <Label size="xsmall" weight="plus" className="text-ui-fg-subtle">
                  {t("edit.groups")}
                </Label>
                <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                  {(lookups.data?.groups ?? []).map((g) => (
                    <label key={g.id} className={clx("flex cursor-pointer items-center gap-x-2 rounded-md border px-2.5 py-1.5", form.groupIds.includes(g.id) ? "border-ui-border-interactive bg-ui-bg-highlight" : "border-transparent hover:bg-ui-bg-base-hover")}>
                      <Checkbox checked={form.groupIds.includes(g.id)} onCheckedChange={() => set("groupIds", toggle(form.groupIds, g.id))} />
                      <Text size="small">{g.name}</Text>
                      {g.member ? (
                        <Badge size="2xsmall" color="orange">
                          {t("wizard.member")}
                        </Badge>
                      ) : null}
                    </label>
                  ))}
                </div>
                <Label size="xsmall" weight="plus" className="mt-2 text-ui-fg-subtle">
                  {t("edit.customers")}
                </Label>
                <div className="flex flex-wrap gap-2">
                  {form.customerIds.length === 0 ? (
                    <Text size="small" className="text-ui-fg-subtle">
                      {t("edit.noCustomers")}
                    </Text>
                  ) : (
                    form.customerIds.map((id) => (
                      <span key={id} className="flex items-center gap-x-1 rounded-full border border-ui-border-base bg-ui-bg-component py-0.5 pl-2.5 pr-1">
                        <Text size="small">{allNames.customers?.[id] ?? id}</Text>
                        <button type="button" aria-label={t("edit.removeCustomer")} className="rounded-full p-0.5 text-ui-fg-muted hover:bg-ui-bg-base-hover" onClick={() => set("customerIds", form.customerIds.filter((x) => x !== id))}>
                          <XMark />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <Input size="small" placeholder={t("wizard.customerSearch")} value={customerQ} onChange={(e) => setCustomerQ(e.target.value)} />
                <div className="flex flex-col gap-y-1">
                  {(customers.data?.customers ?? []).map((c) => {
                    const on = form.customerIds.includes(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setPicked((m) => ({ ...m, [c.id]: c.name ?? c.email }))
                          set("customerIds", toggle(form.customerIds, c.id))
                        }}
                        className={clx("flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left", on ? "border-ui-border-interactive bg-ui-bg-highlight" : "border-ui-border-base hover:bg-ui-bg-base-hover")}
                      >
                        <span className="flex items-center gap-x-2">
                          <User className="text-ui-fg-muted" />
                          <Text size="small" weight="plus">
                            {c.name ?? c.email}
                          </Text>
                        </span>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {on ? t("edit.customerOn") : c.email}
                        </Text>
                      </button>
                    )
                  })}
                  {customerQ.trim().length >= 2 && customers.data && customers.data.customers.length === 0 ? (
                    <Text size="small" className="text-ui-fg-subtle">
                      {t("wizard.noCustomers")}
                    </Text>
                  ) : null}
                </div>
              </Field>

              {kept.length ? (
                <InlineTip label={t("edit.keptTitle")}>
                  {t("edit.kept", { list: kept.join(", ") })}{" "}
                  <a className="text-ui-fg-interactive underline" href={`/app/promotions/${coupon.id}`}>
                    {t("detail.openInMedusa")}
                  </a>
                </InlineTip>
              ) : null}
            </div>

            <aside className="flex w-full flex-col gap-y-4 border-t border-ui-border-base bg-ui-bg-subtle p-6 lg:w-[380px] lg:border-l lg:border-t-0">
              <Label size="small" weight="plus">
                {t("edit.after")}
              </Label>
              <Text size="small">{couponSentence(preview(coupon, check?.ok ? check.value : null), allNames, t, fmt, currency)}</Text>
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
              <Button size="small" disabled={!changed || !check?.ok} isLoading={update.isPending} onClick={() => void save()}>
                {t("edit.save")}
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
  if (s.categoryIds.length) out.push(t("edit.keptWhat.categories", { count: s.categoryIds.length }))
  if (s.productIds.length) out.push(t("edit.keptWhat.products", { count: s.productIds.length }))
  if (s.collectionIds.length) out.push(t("edit.keptWhat.collections", { count: s.collectionIds.length }))
  if (s.shippingTypeIds.length || s.shippingOptionIds.length) out.push(t("edit.keptWhat.shipping"))
  if (s.salesChannelIds.length) out.push(t("edit.keptWhat.channels"))
  if (s.regionIds.length) out.push(t("edit.keptWhat.regions"))
  if (s.kind === "buy_get") out.push(t("edit.keptWhat.buyGet"))
  if (s.rules.length) out.push(t("edit.keptWhat.other", { count: s.rules.length }))
  return out
}

/* At module level: defined inside the component they would remount on every keystroke. */
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

function Chips<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={clx(
            "txt-compact-small-plus rounded-lg border px-3 py-1.5 transition-fg",
            value === o.value ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color" : "border-ui-border-base bg-ui-bg-base text-ui-fg-base hover:bg-ui-bg-base-hover",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
