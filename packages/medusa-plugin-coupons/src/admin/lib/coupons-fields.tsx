import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { User, XMark } from "@medusajs/icons"
import { Badge, Checkbox, Input, Label, Select, Text, Textarea, clx } from "@medusajs/ui"
import type { CouponDto, StoreLookups } from "../../modules/coupons/lib/contract"
import { useCustomerSearch } from "./coupons-api"

/**
 * The fields the creator and the edit form share, so a coupon is built and
 * changed with the same words and the same controls. All at module level:
 * defined inside a component they would remount on every keystroke.
 */

export function Field({ label, hint, n, children, aside }: { label: string; hint?: string; n?: number; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-3 rounded-xl border border-ui-border-base bg-ui-bg-base p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-x-2.5">
          {n ? <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-ui-bg-component txt-compact-xsmall-plus text-ui-fg-subtle shadow-borders-base">{n}</span> : null}
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
        </div>
        {aside}
      </div>
      {children}
    </div>
  )
}

/** A part of a form with its own heading ("1. What it gives"). */
export function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-y-3">
      <div className="flex items-baseline gap-x-2">
        <span className="txt-compact-small-plus text-ui-fg-interactive">{n}.</span>
        <div>
          <Text size="base" weight="plus">
            {title}
          </Text>
          {hint ? (
            <Text size="xsmall" className="text-ui-fg-subtle">
              {hint}
            </Text>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  )
}

export function BigCard({ on, icon, title, hint, onClick, disabled }: { on: boolean; icon: ReactNode; title: string; hint: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={clx(
        "flex items-start gap-x-3 rounded-xl border p-4 text-left transition-fg",
        on ? "border-ui-border-interactive bg-ui-bg-highlight shadow-borders-interactive-with-active" : "border-ui-border-base bg-ui-bg-base hover:bg-ui-bg-base-hover",
        disabled && !on && "cursor-not-allowed opacity-50 hover:bg-ui-bg-base",
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

export function Chips<T extends string | number>({ value, options, onChange }: { value: T | null; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
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

/** A number field with its unit inside ("%", "PLN", "szt."). */
export function NumberInput({ value, onChange, unit, min = 0, step = 1, className, placeholder }: { value: number | string | null | undefined; onChange: (v: number | null) => void; unit?: string; min?: number; step?: number; className?: string; placeholder?: string }) {
  return (
    <div className={clx("relative", className ?? "w-32")}>
      <Input
        size="small"
        type="number"
        min={min}
        step={step}
        placeholder={placeholder}
        className={unit ? "pr-12" : undefined}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value.replace(",", ".")))}
      />
      {unit ? <span className="txt-compact-small pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ui-fg-muted">{unit}</span> : null}
    </div>
  )
}

/** A searchable list to tick: categories, the store's pools, customer groups. */
export function PickList({ items, selected, onChange, search, empty }: { items: Array<{ id: string; name: string; badge?: string | null }>; selected: string[]; onChange: (ids: string[]) => void; search?: string; empty?: string }) {
  const [q, setQ] = useState("")
  const shown = items.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase())).slice(0, 120)
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  return (
    <div className="flex flex-col gap-y-2">
      {search && items.length > 8 ? <Input size="small" placeholder={search} value={q} onChange={(e) => setQ(e.target.value)} /> : null}
      <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
        {shown.map((i) => (
          <label key={i.id} className={clx("flex cursor-pointer items-center gap-x-2 rounded-md border px-2.5 py-1.5", selected.includes(i.id) ? "border-ui-border-interactive bg-ui-bg-highlight" : "border-transparent hover:bg-ui-bg-base-hover")}>
            <Checkbox checked={selected.includes(i.id)} onCheckedChange={() => toggle(i.id)} />
            <Text size="small">{i.name}</Text>
            {i.badge ? (
              <Badge size="2xsmall" color="orange">
                {i.badge}
              </Badge>
            ) : null}
          </label>
        ))}
        {shown.length === 0 && empty ? (
          <Text size="small" className="text-ui-fg-subtle">
            {empty}
          </Text>
        ) : null}
      </div>
    </div>
  )
}

/** One or more customers: the picked ones as chips, a search to add more. */
export function CustomerPicker({ selected, names, nobody, onChange, onName }: { selected: string[]; names: Record<string, string>; nobody?: string | null; onChange: (ids: string[]) => void; onName: (id: string, name: string) => void }) {
  const { t } = useTranslation("coupons")
  const [q, setQ] = useState("")
  const customers = useCustomerSearch(q)
  const real = selected.filter((id) => id !== nobody)
  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex flex-wrap gap-2">
        {real.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            {selected.length ? t("fields.nobodyLeft") : t("fields.noCustomers")}
          </Text>
        ) : (
          real.map((id) => (
            <span key={id} className="flex items-center gap-x-1 rounded-full border border-ui-border-base bg-ui-bg-component py-0.5 pl-2.5 pr-1">
              <User className="text-ui-fg-muted" />
              <Text size="small">{names[id] ?? id}</Text>
              <button type="button" aria-label={t("fields.remove")} className="rounded-full p-0.5 text-ui-fg-muted hover:bg-ui-bg-base-hover" onClick={() => onChange(selected.filter((x) => x !== id))}>
                <XMark />
              </button>
            </span>
          ))
        )}
      </div>
      <Input size="small" placeholder={t("wizard.customerSearch")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex flex-col gap-y-1">
        {(customers.data?.customers ?? []).map((c) => {
          const on = selected.includes(c.id)
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onName(c.id, c.name ?? c.email)
                /* A real customer replaces the store's "nobody" marker. */
                const base = selected.filter((x) => x !== nobody)
                onChange(on ? base.filter((x) => x !== c.id) : [...base, c.id])
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
                {on ? t("fields.picked") : c.email}
              </Text>
            </button>
          )
        })}
        {q.trim().length >= 2 && customers.data && customers.data.customers.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            {t("wizard.noCustomers")}
          </Text>
        ) : null}
      </div>
    </div>
  )
}

/** A price list of the store, or none. */
export function PriceListSelect({ value, onChange, lists, none }: { value: string | null | undefined; onChange: (v: string | null) => void; lists: StoreLookups["priceLists"]; none: string }) {
  return (
    <Select value={value ?? "__none"} onValueChange={(v) => onChange(v === "__none" ? null : v)}>
      <Select.Trigger className="w-64">
        <Select.Value />
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="__none">{none}</Select.Item>
        {lists.map((l) => (
          <Select.Item key={l.id} value={l.id}>
            {l.name}
          </Select.Item>
        ))}
      </Select.Content>
    </Select>
  )
}

type Combine = "with" | "never" | "none"

/**
 * Which coupons this one adds up with: every other coupon with three
 * choices (adds up, never together, the store's rule), the active ones and
 * the ones already named first.
 */
export function CombinesPicker({ value, onChange, coupons, selfCode }: { value: { with: string[]; never: string[] } | null | undefined; onChange: (v: { with: string[]; never: string[] } | null) => void; coupons: readonly CouponDto[]; selfCode: string }) {
  const { t } = useTranslation("coupons")
  const [all, setAll] = useState(false)
  const w = value?.with ?? []
  const n = value?.never ?? []
  const named = new Set([...w, ...n])
  const codes = [...new Set(coupons.filter((c) => c.code && c.code.toUpperCase() !== selfCode.toUpperCase()).filter((c) => all || named.has(c.code) || c.status === "active" || c.status === "scheduled").map((c) => c.code))]
  const missing = [...named].filter((c) => !codes.includes(c))
  const stateOf = (code: string): Combine => (w.includes(code) ? "with" : n.includes(code) ? "never" : "none")
  const set = (code: string, s: Combine) => {
    const nw = w.filter((c) => c !== code)
    const nn = n.filter((c) => c !== code)
    if (s === "with") nw.push(code)
    if (s === "never") nn.push(code)
    onChange(nw.length || nn.length ? { with: nw, never: nn } : null)
  }
  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex max-h-72 flex-col divide-y overflow-y-auto rounded-lg border border-ui-border-base">
        {[...codes, ...missing].map((code) => (
          <div key={code} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
            <span className="font-mono txt-compact-small">{code}</span>
            <div className="flex gap-1">
              {(["with", "never", "none"] as Combine[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set(code, s)}
                  className={clx(
                    "txt-compact-xsmall-plus rounded-md border px-2 py-1",
                    stateOf(code) === s
                      ? s === "with"
                        ? "border-ui-tag-green-border bg-ui-tag-green-bg text-ui-tag-green-text"
                        : s === "never"
                          ? "border-ui-tag-red-border bg-ui-tag-red-bg text-ui-tag-red-text"
                          : "border-ui-border-interactive bg-ui-bg-highlight text-ui-fg-base"
                      : "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-base-hover",
                  )}
                >
                  {t(`fields.combine.${s}`)}
                </button>
              ))}
            </div>
          </div>
        ))}
        {codes.length + missing.length === 0 ? (
          <Text size="small" className="px-3 py-2 text-ui-fg-subtle">
            {t("fields.combine.empty")}
          </Text>
        ) : null}
      </div>
      <button type="button" className="self-start txt-compact-xsmall text-ui-fg-interactive hover:underline" onClick={() => setAll((v) => !v)}>
        {all ? t("fields.combine.onlyActive") : t("fields.combine.showAll")}
      </button>
    </div>
  )
}

export function NoteField({ value, onChange }: { value: string | null | undefined; onChange: (v: string | null) => void }) {
  const { t } = useTranslation("coupons")
  return <Textarea rows={3} maxLength={500} placeholder={t("fields.notePlaceholder")} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
}

/** The store's word for its pools, else the plugin's own. */
export function poolsWord(store: StoreLookups | null | undefined, lang: string, fallback: string): string {
  const l = store?.poolsLabel
  return (l && (l[lang] ?? l[lang.slice(0, 2)] ?? l.en)) || fallback
}
