import { useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { CheckCircle, CogSixTooth, EnvelopeSolid, Eye, Plus, ShoppingCart, Tag, Trash, XCircle } from "@medusajs/icons"
import { Button, IconButton, Input, Label, Select, Switch, Text, toast } from "@medusajs/ui"
import { saveSettings, type KitForm, type KitTag, type Status } from "./kit-api"
import { EmptyState, FilterButton, Section, ToneBadge } from "./kit-blocks"

/**
 * Settings of the Kit page (`?view=settings&tab=`): the list settings and the
 * tags by source, both saved per store through POST /admin/kit/settings, and
 * the options from medusa-config.ts, read only.
 */

export const SETTINGS_TABS = ["list", "routing", "options"] as const
export type SettingsTabId = (typeof SETTINGS_TABS)[number]

const NONE = "__none__"

/** The tags of the account as toggles: icon, name, subscriber count. */
function TagPicker({ tagList, picked, onToggle }: { tagList: KitTag[]; picked: number[]; onToggle: (id: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tagList.map((tg) => (
        <FilterButton key={tg.id} icon={<Tag />} label={tg.name} count={tg.subscriber_count ?? null} active={picked.includes(tg.id)} onClick={() => onToggle(tg.id)} />
      ))}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex flex-col gap-y-0.5">
        <Label size="small" weight="plus">
          {label}
        </Label>
        {hint ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {hint}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function SwitchField({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex max-w-xl items-start gap-x-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <label htmlFor={id} className="flex flex-col gap-y-0.5">
        <Text size="small" weight="plus">
          {label}
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          {hint}
        </Text>
      </label>
    </div>
  )
}

function useSave() {
  const { t } = useTranslation("kit")
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const run = async (body: Parameters<typeof saveSettings>[0]) => {
    setBusy(true)
    try {
      await saveSettings(body)
      toast.success(t("settings.saved"))
      void client.invalidateQueries({ queryKey: ["kit", "status"] })
    } catch (e: any) {
      toast.error(e?.message ?? "error")
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

function SaveBar({ busy, disabled, onSave }: { busy: boolean; disabled: boolean; onSave: () => void }) {
  const { t } = useTranslation("kit")
  return (
    <div className="flex flex-wrap items-center gap-3 px-6 py-3">
      <Button variant="primary" size="small" isLoading={busy} onClick={onSave} disabled={disabled}>
        {busy ? t("settings.saving") : t("settings.save")}
      </Button>
      {disabled && !busy ? (
        <ToneBadge tone="orange" dot>
          {t("settings.needsKey")}
        </ToneBadge>
      ) : null}
    </div>
  )
}

/** What every new subscriber gets: tags, the double opt-in form and the switch. */
export function ListTab({ status, tagList, formList }: { status: Status; tagList: KitTag[]; formList: KitForm[] }) {
  const { t } = useTranslation("kit")
  const save = useSave()
  const [pickedTags, setPickedTags] = useState<number[] | null>(null)
  const [formId, setFormId] = useState<string | null>(null)
  const [doubleOptIn, setDoubleOptIn] = useState<boolean | null>(null)

  const effective = {
    tags: pickedTags ?? status.settings.tags ?? [],
    formId: formId ?? (status.settings.form_id !== undefined && status.settings.form_id !== null ? String(status.settings.form_id) : ""),
    doubleOptIn: doubleOptIn ?? status.settings.double_opt_in ?? false,
  }
  const toggleTag = (id: number) => {
    const current = pickedTags ?? status.settings.tags ?? []
    setPickedTags(current.includes(id) ? current.filter((x) => x !== id) : [...current, id])
  }

  return (
    <Section
      icon={<EnvelopeSolid />}
      title={t("settings.listTitle")}
      points={[
        { icon: <Plus />, text: t("settings.points.every") },
        { icon: <CogSixTooth />, text: t("settings.points.store") },
      ]}
    >
      <div className="flex flex-col gap-y-5 px-6 py-4">
        <Field label={t("settings.tags")} hint={t("settings.tagsHint")}>
          {tagList.length === 0 ? <EmptyState compact icon={<Tag />} title={t("settings.tagsEmpty")} points={[{ icon: <Plus />, text: t("settings.tagsEmptyHint") }]} className="items-start px-0 text-left" /> : <TagPicker tagList={tagList} picked={effective.tags} onToggle={toggleTag} />}
        </Field>
        <Field label={t("settings.form")} hint={t("settings.formHint")}>
          <div className="max-w-sm">
            <Select size="small" value={effective.formId || NONE} onValueChange={(v) => setFormId(v === NONE ? "" : v)}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value={NONE}>{t("settings.formNone")}</Select.Item>
                {formList.map((f) => (
                  <Select.Item key={f.id} value={String(f.id)}>
                    {f.name ?? `#${f.id}`}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
        </Field>
        <SwitchField id="kit-double-opt-in" label={t("settings.doubleOptIn")} hint={t("settings.doubleOptInHint")} checked={effective.doubleOptIn} onChange={setDoubleOptIn} />
      </div>
      <SaveBar
        busy={save.busy}
        disabled={!status.configured}
        onSave={() =>
          void save.run({
            tags: pickedTags ?? undefined,
            form_id: formId === null ? undefined : formId === "" ? null : Number(formId),
            double_opt_in: doubleOptIn ?? undefined,
          })
        }
      />
    </Section>
  )
}

/** Extra tags by the sign-up source and for buyers. */
export function RoutingTab({ status, tagList }: { status: Status; tagList: KitTag[] }) {
  const { t } = useTranslation("kit")
  const save = useSave()
  const [sources, setSources] = useState<Array<{ key: string; tags: number[] }> | null>(null)
  const [buyerTags, setBuyerTags] = useState<number[] | null>(null)
  const [productTags, setProductTags] = useState<boolean | null>(null)
  const [prefix, setPrefix] = useState<string | null>(null)
  const [newSource, setNewSource] = useState("")

  const stored = status.settings
  const rows = sources ?? Object.entries(stored.source_tags ?? {}).map(([key, ids]) => ({ key, tags: ids }))
  const buyers = buyerTags ?? stored.buyer_tags ?? []
  const products = productTags ?? stored.product_tags ?? false
  const pre = prefix ?? stored.product_tag_prefix ?? ""

  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const addSource = () => {
    const key = newSource.trim().toLowerCase()
    if (!/^[a-z0-9_-]{1,40}$/.test(key) || rows.some((r) => r.key === key)) return
    setSources([...rows, { key, tags: [] }])
    setNewSource("")
  }

  return (
    <Section
      icon={<Tag />}
      title={t("routing.title")}
      points={[
        { icon: <Tag />, text: t("routing.points.source") },
        { icon: <ShoppingCart />, text: t("routing.points.buyers") },
        { icon: <XCircle />, text: t("routing.points.never") },
      ]}
    >
      <div className="flex flex-col gap-y-5 px-6 py-4">
        <Field label={t("routing.sources")} hint={t("routing.sourcesHint")}>
          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <div key={r.key} className="flex flex-col gap-y-2 rounded-lg border border-ui-border-base p-3">
                <div className="flex items-center justify-between gap-2">
                  <ToneBadge tone="blue" icon={<Tag />}>
                    {r.key}
                  </ToneBadge>
                  <IconButton size="small" variant="transparent" title={t("routing.remove")} aria-label={t("routing.remove")} className="text-ui-tag-red-icon" onClick={() => setSources(rows.filter((x) => x.key !== r.key))}>
                    <Trash />
                  </IconButton>
                </div>
                <TagPicker tagList={tagList} picked={r.tags} onToggle={(id) => setSources(rows.map((x) => (x.key === r.key ? { ...x, tags: toggle(x.tags, id) } : x)))} />
              </div>
            ))}
            <form
              className="flex max-w-sm gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                addSource()
              }}
            >
              <Input size="small" value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder={t("routing.sourceName")} />
              <Button type="submit" variant="secondary" size="small" className="shrink-0">
                <Plus />
                {t("routing.addSource")}
              </Button>
            </form>
          </div>
        </Field>
        <Field label={t("routing.buyers")} hint={t("routing.buyersHint")}>
          <TagPicker tagList={tagList} picked={buyers} onToggle={(id) => setBuyerTags(toggle(buyers, id))} />
        </Field>
        <SwitchField id="kit-product-tags" label={t("routing.productTags")} hint={t("routing.productTagsHint")} checked={products} onChange={setProductTags} />
        {products ? (
          <div className="flex max-w-sm flex-col gap-y-1">
            <Label size="xsmall">{t("routing.prefix")}</Label>
            <Input size="small" value={pre} onChange={(e) => setPrefix(e.target.value)} />
          </div>
        ) : null}
      </div>
      <SaveBar
        busy={save.busy}
        disabled={!status.configured}
        onSave={() =>
          void save.run({
            source_tags: sources ? Object.fromEntries(rows.filter((r) => r.tags.length).map((r) => [r.key, r.tags])) : undefined,
            buyer_tags: buyerTags ?? undefined,
            product_tags: productTags ?? undefined,
            product_tag_prefix: prefix ?? undefined,
          })
        }
      />
    </Section>
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

/** The options from medusa-config.ts, read only, with what is missing or ignored. */
export function OptionsTab({ status }: { status: Status }) {
  const { t } = useTranslation("kit")
  const none = <span className="text-ui-fg-muted">{t("settings.none")}</span>
  return (
    <Section
      icon={<CogSixTooth />}
      title={t("settings.tab.options")}
      points={[
        { icon: <Eye />, text: t("settings.points.readOnly"), tone: "blue" },
        { icon: <CogSixTooth />, text: t("settings.points.config") },
      ]}
    >
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label={t("settings.apiKey")}>
          {status.options.apiKey ? (
            <ToneBadge tone="green" icon={<CheckCircle />}>
              <span className="font-mono">{status.options.apiKey}</span>
            </ToneBadge>
          ) : (
            <ToneBadge tone="orange" icon={<XCircle />}>
              {t("mode.off")}
            </ToneBadge>
          )}
        </Fact>
        <Fact label={t("settings.source")}>{status.options.source || none}</Fact>
        <Fact label={t("settings.storefront")}>{status.options.storefrontUrl ? <span className="break-all">{status.options.storefrontUrl}</span> : none}</Fact>
        <Fact label={t("settings.demo")}>
          <ToneBadge tone={status.demo ? "blue" : "grey"}>{status.demo ? t("settings.on") : t("settings.off")}</ToneBadge>
        </Fact>
      </div>
      {status.missing.length || status.problems.length ? (
        <div className="flex flex-col gap-y-1 px-6 py-3">
          {status.missing.length ? (
            <Text size="small" className="text-ui-tag-orange-text">
              {t("status.missing", { what: status.missing.join(", ") })}
            </Text>
          ) : null}
          {status.problems.length ? (
            <Text size="small" className="text-ui-tag-orange-text">
              {t("status.problems", { what: status.problems.join(", ") })}
            </Text>
          ) : null}
        </div>
      ) : null}
    </Section>
  )
}
