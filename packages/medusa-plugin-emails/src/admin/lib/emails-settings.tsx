import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Button, Container, Heading, InlineTip, Input, Label, Switch, Text, Textarea, toast, usePrompt } from "@medusajs/ui"
import type { BrandDto, StatusResponse, TemplateDto } from "../../modules/emails/lib/contract"
import { errorMessage, useEmailsPreview, useEmailsSettings } from "./emails-api"
import { CodeBlock } from "./emails-guide"
import { EmailFrame, Fact, OnOff, fmtDateTime, fmtNumber, modeState, templateDescription, templateLabel } from "./emails-ui"

/* ------------------------------------------------------------------ */
/* Branding                                                            */
/* ------------------------------------------------------------------ */

type BrandForm = {
  name: string
  logoText: string
  logoAccent: string
  logoSuffix: string
  logoItalic: boolean
  accentColor: string
  headerColor: string
  footerEn: string
  footerPl: string
  supportEmail: string
}

function formOf(b: BrandDto): BrandForm {
  return {
    name: b.name ?? "",
    logoText: b.logo.text ?? "",
    logoAccent: b.logo.accent ?? "",
    logoSuffix: b.logo.suffix ?? "",
    logoItalic: b.logo.italic,
    accentColor: b.accentColor ?? "",
    headerColor: b.headerColor ?? "",
    footerEn: b.footer?.en ?? "",
    footerPl: b.footer?.pl ?? "",
    supportEmail: b.supportEmail ?? "",
  }
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function ColorField({ id, label, value, placeholder, onChange, hint }: { id: string; label: string; value: string; placeholder: string; onChange: (v: string) => void; hint: string }) {
  const swatch = HEX.test(value) ? value : HEX.test(placeholder) ? placeholder : "#000000"
  return (
    <div className="flex flex-col gap-y-1.5">
      <Label size="small" weight="plus" htmlFor={id}>
        {label}
      </Label>
      <div className="flex items-center gap-x-2">
        <input
          type="color"
          aria-label={label}
          value={swatch.length === 4 ? `#${swatch[1]}${swatch[1]}${swatch[2]}${swatch[2]}${swatch[3]}${swatch[3]}` : swatch}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-ui-border-base bg-ui-bg-field p-0.5"
        />
        <Input id={id} size="small" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value.trim())} className="font-mono" />
      </div>
      <Text size="xsmall" className="text-ui-fg-muted">
        {hint}
      </Text>
    </div>
  )
}

function Field({ id, label, value, placeholder, onChange, hint, multiline = false, overridden }: { id: string; label: string; value: string; placeholder?: string; onChange: (v: string) => void; hint?: string; multiline?: boolean; overridden: boolean }) {
  const { t } = useTranslation("emails")
  return (
    <div className="flex flex-col gap-y-1.5">
      <span className="flex items-center gap-x-2">
        <Label size="small" weight="plus" htmlFor={id}>
          {label}
        </Label>
        {overridden ? (
          <Badge size="2xsmall" color="blue">
            {t("branding.overridden")}
          </Badge>
        ) : null}
      </span>
      {multiline ? (
        <Textarea id={id} rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} size="small" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {hint}
        </Text>
      ) : null}
    </div>
  )
}

export function BrandingSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("emails")
  const save = useEmailsSettings()
  const prompt = usePrompt()
  const initial = useMemo(() => formOf(status.brand), [status.brand])
  const options = useMemo(() => formOf(status.brandOptions), [status.brandOptions])
  const [form, setForm] = useState<BrandForm>(initial)
  useEffect(() => setForm(initial), [initial])
  const preview = useEmailsPreview("customer.welcome", /^pl/i.test(lang) ? "pl" : "en", "light", "sample")
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const over = new Set(status.brandOverridden)
  const set = (k: keyof BrandForm) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  const onSave = async () => {
    const changed: Record<string, unknown> = {}
    for (const k of Object.keys(form) as Array<keyof BrandForm>) {
      if (form[k] === initial[k]) continue
      changed[k] = form[k] === options[k] ? null : form[k]
    }
    try {
      await save.mutateAsync({ brand: changed })
      toast.success(t("branding.saved"))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  const onReset = async () => {
    const ok = await prompt({ title: t("branding.resetTitle"), description: t("branding.resetText"), confirmText: t("branding.reset"), cancelText: t("actions.cancel"), variant: "confirmation" })
    if (!ok) return
    try {
      await save.mutateAsync({ brand: null })
      toast.success(t("branding.resetDone"))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-3xl flex-col gap-1">
          <Heading level="h2">{t("branding.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {status.mode === "demo" ? t("branding.demoSubtitle") : t("branding.subtitle")}
          </Text>
          {status.brandUpdatedAt ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("branding.changedBy", { who: status.brandUpdatedBy ?? "-", time: fmtDateTime(status.brandUpdatedAt, lang) })}
            </Text>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="small" variant="secondary" disabled={status.brandOverridden.length === 0 || save.isPending} onClick={() => void onReset()}>
            {t("branding.reset")}
          </Button>
          <Button size="small" variant="primary" disabled={!dirty} isLoading={save.isPending} onClick={() => void onSave()}>
            {t("actions.save")}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 px-6 py-5 xl:grid-cols-[1fr_420px]">
        <div className="grid grid-cols-1 content-start gap-4 md:grid-cols-2">
          <Field id="emails-brand-name" label={t("branding.name")} value={form.name} placeholder={options.name || t("branding.namePlaceholder")} onChange={set("name")} hint={t("branding.nameHint")} overridden={over.has("name")} />
          <Field id="emails-brand-support" label={t("branding.supportEmail")} value={form.supportEmail} placeholder={options.supportEmail} onChange={set("supportEmail")} hint={t("branding.supportHint")} overridden={over.has("supportEmail")} />
          <Field id="emails-brand-logo" label={t("branding.logoText")} value={form.logoText} placeholder={options.logoText || form.name} onChange={set("logoText")} hint={t("branding.logoHint")} overridden={over.has("logoText")} />
          <div className="grid grid-cols-2 gap-3">
            <Field id="emails-brand-accentpart" label={t("branding.logoAccent")} value={form.logoAccent} placeholder={options.logoAccent || "+"} onChange={set("logoAccent")} overridden={over.has("logoAccent")} />
            <Field id="emails-brand-suffix" label={t("branding.logoSuffix")} value={form.logoSuffix} placeholder={options.logoSuffix} onChange={set("logoSuffix")} overridden={over.has("logoSuffix")} />
          </div>
          <ColorField id="emails-brand-accent" label={t("branding.accent")} value={form.accentColor} placeholder={options.accentColor || "#26D07C"} onChange={set("accentColor")} hint={t("branding.accentHint")} />
          <ColorField id="emails-brand-header" label={t("branding.header")} value={form.headerColor} placeholder={options.headerColor || "#212721"} onChange={set("headerColor")} hint={t("branding.headerHint")} />
          <div className="flex items-center gap-x-3 md:col-span-2">
            <Switch id="emails-brand-italic" checked={form.logoItalic} onCheckedChange={(v) => set("logoItalic")(v === true)} />
            <Label size="small" htmlFor="emails-brand-italic">
              {t("branding.italic")}
            </Label>
          </div>
          <Field id="emails-brand-footer-pl" label={t("branding.footerPl")} value={form.footerPl} placeholder={options.footerPl} onChange={set("footerPl")} multiline overridden={over.has("footerPl")} />
          <Field id="emails-brand-footer-en" label={t("branding.footerEn")} value={form.footerEn} placeholder={options.footerEn} onChange={set("footerEn")} multiline overridden={over.has("footerEn")} hint={t("branding.footerHint")} />
        </div>
        <div className="flex flex-col gap-y-2">
          <Text size="xsmall" className="text-ui-fg-muted">
            {dirty ? t("branding.previewUnsaved") : t("branding.preview")}
          </Text>
          <div className="flex justify-center overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3">
            {preview.data ? <EmailFrame html={preview.data.html} title={t("branding.preview")} width="mobile" minHeight={480} /> : null}
          </div>
        </div>
      </div>
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Templates on and off                                                */
/* ------------------------------------------------------------------ */

export function TemplatesSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("emails")
  const save = useEmailsSettings()
  const flip = async (x: TemplateDto, on: boolean) => {
    try {
      await save.mutateAsync({ templates: { [x.key]: on } })
      toast.success(t(on ? "templates.turnedOn" : "templates.turnedOff", { name: templateLabel(x, lang) }))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("templates.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("templates.subtitle")}
        </Text>
      </div>
      {status.templates.map((x) => (
        <div key={x.key} className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex max-w-3xl flex-col gap-y-1">
            <span className="flex flex-wrap items-center gap-2">
              <Text size="small" weight="plus" className="text-ui-fg-base">
                {templateLabel(x, lang)}
              </Text>
              <OnOff on={x.enabled} labels={[t("templates.on"), x.allowed ? t("templates.off") : t("templates.blocked")]} />
              {x.optional ? (
                <Badge size="2xsmall" color="grey">
                  {t("templates.optional")}
                </Badge>
              ) : null}
              {x.source === "app" ? (
                <Badge size="2xsmall" color="orange">
                  {t("templates.app")}
                </Badge>
              ) : null}
            </span>
            <Text size="small" className="text-ui-fg-subtle">
              {templateDescription(x, lang)}
            </Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              <span className="font-mono">{x.key}</span>
              {x.trigger.name ? (
                <>
                  {" "}
                  {t(`templates.trigger.${x.trigger.kind}`, { name: x.trigger.name })}
                </>
              ) : null}
            </Text>
            {x.key === "cart.abandoned" ? (
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("templates.abandoned", { after: status.abandonedCart.afterHours, max: status.abandonedCart.maxAgeHours, per: status.abandonedCart.maxPerRun })}
              </Text>
            ) : null}
            {x.key.startsWith("negotiation.") ? (
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("templates.negotiations")}
              </Text>
            ) : null}
            <Text size="xsmall" className="text-ui-fg-muted">
              {!x.allowed
                ? t("templates.blockedHint", { key: x.key })
                : x.updatedAt
                  ? t(x.on ? "templates.onBy" : "templates.offBy", { who: x.updatedBy ?? "-", time: fmtDateTime(x.updatedAt, lang) })
                  : x.optional
                    ? t("templates.optionalHint")
                    : t("templates.defaultOn")}
            </Text>
          </div>
          <span className="flex shrink-0 items-center gap-x-3">
            <Text size="xsmall" className="tabular-nums text-ui-fg-muted">
              {t("templates.stats", { sent: fmtNumber(x.stats.sent, lang), failed: fmtNumber(x.stats.failed, lang) })}
            </Text>
            <Switch
              checked={x.enabled}
              disabled={!x.allowed || save.isPending}
              onCheckedChange={(v) => void flip(x, v === true)}
              aria-label={templateLabel(x, lang)}
            />
          </span>
        </div>
      ))}
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* The provider and the options in use                                */
/* ------------------------------------------------------------------ */

export const PROVIDER_SNIPPET = `// medusa-config.ts
modules: [
  {
    resolve: "@medusajs/medusa/notification",
    options: {
      providers: [
        {
          resolve: "@koda-plus/medusa-plugin-emails/providers/emails",
          id: "emails",
          options: { channels: ["email"], ...emails }, // the same object as the plugin options
        },
        {
          // keep Medusa's own provider on the feed channel: product import and export need it
          resolve: "@medusajs/medusa/notification-local",
          id: "local",
          options: { name: "Local Notification Provider", channels: ["feed"] },
        },
      ],
    },
  },
],`

export function ProviderSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("emails")
  const p = status.provider
  const yes = t("provider.yes")
  const no = t("provider.no")
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("provider.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("provider.subtitle")}
        </Text>
      </div>
      {!p.loaded || (p.feedProviders && p.feedProviders.length === 0) ? (
        <div className="flex flex-col gap-y-3 px-6 py-4">
          {!p.loaded ? (
            <InlineTip variant="error" label={t("provider.notLoaded.label")}>
              {t("provider.notLoaded.text")}
            </InlineTip>
          ) : (
            <InlineTip variant="error" label={t("provider.noFeedLabel")}>
              {t("provider.noFeedText")}
            </InlineTip>
          )}
          <CodeBlock code={PROVIDER_SNIPPET} copyLabel={t("guide.copy")} copiedLabel={t("guide.copied")} />
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-3">
        <Fact label={t("provider.mode")}>{t(`mode.${modeState(status).key}`)}</Fact>
        <Fact label={t("provider.apiKey")}>{status.sender.apiKeySet ? t("provider.set") : <span className="text-ui-tag-red-text">{t("provider.missing")}</span>}</Fact>
        <Fact label={t("provider.from")} mono>
          {status.sender.from ?? <span className="font-sans text-ui-tag-red-text">{t("provider.missing")}</span>}
        </Fact>
        <Fact label={t("provider.domain")} mono>
          {status.sender.domain ?? "-"}
        </Fact>
        <Fact label={t("provider.replyTo")} mono>
          {status.sender.replyTo.length > 0 ? status.sender.replyTo.join(", ") : <span className="font-sans">{t("provider.none")}</span>}
        </Fact>
        <Fact label={t("provider.loaded")}>
          <OnOff on={p.loaded} labels={[yes, no]} />
          {p.loadedAt ? <span className="text-ui-fg-subtle"> {fmtDateTime(p.loadedAt, lang)}</span> : null}
        </Fact>
        <Fact label={t("provider.channels")} mono>
          {p.channels.length > 0 ? p.channels.join(", ") : "-"}
        </Fact>
        <Fact label={t("provider.emailProviders")} mono>
          {p.emailProviders === null ? <span className="font-sans">{t("provider.unknown")}</span> : p.emailProviders.length > 0 ? p.emailProviders.join(", ") : t("provider.none")}
        </Fact>
        <Fact label={t("provider.feedProviders")} mono>
          {p.feedProviders === null ? (
            <span className="font-sans">{t("provider.unknown")}</span>
          ) : p.feedProviders.length > 0 ? (
            p.feedProviders.join(", ")
          ) : (
            <span className="font-sans text-ui-tag-red-text">{t("provider.none")}</span>
          )}
        </Fact>
        <Fact label={t("provider.sameOptions")}>
          {p.sameOptions === null ? "-" : p.sameOptions ? yes : <span className="text-ui-tag-orange-text">{t("provider.differs", { list: p.differences.join(", ") })}</span>}
        </Fact>
        <Fact label={t("provider.defaultLocale")}>{t(`languages.${status.defaultLocale}`)}</Fact>
        <Fact label={t("provider.timeZone")} mono>
          {status.timeZone}
        </Fact>
        <Fact label={t("provider.storefront")} mono>
          {status.storefrontUrl ?? <span className="font-sans text-ui-tag-orange-text">{t("provider.missing")}</span>}
        </Fact>
        <Fact label={t("provider.retention")}>{status.retentionDays > 0 ? t("provider.days", { count: status.retentionDays }) : t("provider.keepAll")}</Fact>
        <Fact label={t("provider.version")} mono>
          {status.version}
        </Fact>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Text size="small" weight="plus">
          {t("provider.links")}
        </Text>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Object.entries(status.links).map(([key, value]) => (
            <Fact key={key} label={t(`provider.link.${key}`, { defaultValue: key })} mono>
              <span className="txt-compact-xsmall">{value ?? "-"}</span>
            </Fact>
          ))}
        </div>
      </div>
      {status.problems.length > 0 ? (
        <div className="px-6 py-4">
          <InlineTip variant="warning" label={t("provider.problems")}>
            {status.problems.join("; ")}
          </InlineTip>
        </div>
      ) : null}
    </Container>
  )
}
