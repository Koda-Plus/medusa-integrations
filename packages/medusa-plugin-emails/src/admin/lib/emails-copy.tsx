import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowUturnLeft, PencilSquare } from "@medusajs/icons"
import { Button, Input, Label, Text, Textarea, clx, toast, usePrompt } from "@medusajs/ui"
import type { PreviewResponse, TemplateDto } from "../../modules/emails/lib/contract"
import { errorMessage, useEmailsSettings } from "./emails-api"

/**
 * THE WORDS OF A TEMPLATE, rewritten in the admin: the subject, the
 * preheader, the pill, the title, the intro and an extra note, per language.
 * Numbers, products, totals and buttons stay the template's. An empty field
 * keeps the template's own words, shown as the placeholder. The preview next
 * to it renders the draft as it is typed; nothing is saved until Save.
 */

export type CopyLang = "pl" | "en"
export type CopyDraft = { pl?: Record<string, string>; en?: Record<string, string> }

const FIELDS: Array<{ key: string; multiline?: boolean; max: number }> = [
  { key: "subject", max: 150 },
  { key: "preheader", max: 200 },
  { key: "eyebrow", max: 60 },
  { key: "title", max: 160 },
  { key: "intro", multiline: true, max: 600 },
  { key: "note", multiline: true, max: 600 },
]

/** The draft without empty fields and languages, as the API takes it; null when nothing is rewritten. */
export function cleanDraft(d: CopyDraft): CopyDraft | null {
  const out: CopyDraft = {}
  for (const lang of ["pl", "en"] as const) {
    const entries = Object.entries(d[lang] ?? {}).filter(([, v]) => v.trim())
    if (entries.length > 0) out[lang] = Object.fromEntries(entries.map(([k, v]) => [k, v.trim()]))
  }
  return out.pl || out.en ? out : null
}

export function CopyEditor({
  template,
  locale,
  draft,
  defaults,
  onChange,
  onClose,
}: {
  template: TemplateDto
  locale: CopyLang
  draft: CopyDraft
  defaults: PreviewResponse["defaults"] | undefined
  onChange: (next: CopyDraft) => void
  onClose: () => void
}) {
  const { t } = useTranslation("emails")
  const save = useEmailsSettings()
  const prompt = usePrompt()
  const refs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({})
  const [focused, setFocused] = useState<string>("subject")
  const texts = draft[locale] ?? {}
  const otherLang: CopyLang = locale === "pl" ? "en" : "pl"
  const otherEdited = Object.values(draft[otherLang] ?? {}).some((v) => v.trim())

  const set = (field: string, value: string) => onChange({ ...draft, [locale]: { ...texts, [field]: value } })

  /** A placeholder goes where the cursor is, in the field last focused. */
  const insert = (name: string) => {
    const el = refs.current[focused]
    const token = `{${name}}`
    const value = texts[focused] ?? ""
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    set(focused, value.slice(0, start) + token + value.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const submit = async (value: CopyDraft | null, done: string) => {
    try {
      await save.mutateAsync({ copy: { [template.key]: value } })
      toast.success(done)
      onClose()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const reset = async () => {
    const ok = await prompt({ title: t("copy.resetTitle"), description: t("copy.resetBody"), confirmText: t("copy.reset"), cancelText: t("copy.cancel") })
    if (ok) await submit(null, t("copy.resetDone"))
  }

  return (
    <div className="flex flex-col gap-y-4 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
      <div className="flex flex-col gap-y-1">
        <Text size="small" weight="plus" className="flex items-center gap-x-1.5">
          <PencilSquare className="text-ui-fg-subtle" />
          {t("copy.heading", { lang: t(`languages.${locale}`) })}
        </Text>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {t("copy.lead")}
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {FIELDS.map((f) => {
          const id = `koda-copy-${f.key}`
          const value = texts[f.key] ?? ""
          const fallback = f.key === "note" ? t("copy.notePlaceholder") : (defaults as Record<string, string> | null | undefined)?.[f.key] ?? ""
          const common = {
            id,
            value,
            maxLength: f.max,
            placeholder: fallback,
            onFocus: () => setFocused(f.key),
          }
          return (
            <div key={f.key} className={clx("flex flex-col gap-y-1.5", f.multiline && "md:col-span-2")}>
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={id} size="xsmall" weight="plus">
                  {t(`copy.fields.${f.key}`)}
                </Label>
                <Text size="xsmall" className="text-ui-fg-muted">
                  {value ? `${value.length}/${f.max}` : t("copy.default")}
                </Text>
              </div>
              {f.multiline ? (
                <Textarea
                  {...common}
                  ref={(el) => {
                    refs.current[f.key] = el
                  }}
                  rows={3}
                  className="resize-none"
                  onChange={(e) => set(f.key, e.target.value)}
                />
              ) : (
                <Input
                  {...common}
                  ref={(el) => {
                    refs.current[f.key] = el
                  }}
                  size="small"
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
              <Text size="xsmall" className="text-ui-fg-muted">
                {t(`copy.hints.${f.key}`)}
              </Text>
            </div>
          )
        })}
      </div>

      <div className="flex flex-col gap-y-2">
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
          {t("copy.placeholders", { field: t(`copy.fields.${focused}`) })}
        </Text>
        <div className="flex flex-wrap gap-1.5">
          {template.placeholders.map((p) => (
            <button
              key={p}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(p)}
              className="rounded-md border border-ui-border-base bg-ui-bg-base px-2 py-1 text-left transition-fg hover:bg-ui-bg-base-hover"
            >
              <span className="font-mono text-xs text-ui-fg-base">{`{${p}}`}</span>
              <span className="ml-1.5 text-xs text-ui-fg-subtle">{t(`copy.vars.${p}`)}</span>
            </button>
          ))}
        </div>
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("copy.accentHint")}
        </Text>
      </div>

      <div className="flex flex-col gap-3 border-t border-ui-border-base pt-4 md:flex-row md:items-center md:justify-between">
        <Text size="xsmall" className="text-ui-fg-muted">
          {otherEdited ? t("copy.otherEdited", { lang: t(`languages.${otherLang}`) }) : t("copy.otherDefault", { lang: t(`languages.${otherLang}`) })}
        </Text>
        <div className="flex flex-wrap items-center gap-2">
          {template.copy ? (
            <Button size="small" variant="transparent" onClick={reset} disabled={save.isPending}>
              <ArrowUturnLeft />
              {t("copy.reset")}
            </Button>
          ) : null}
          <Button size="small" variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t("copy.cancel")}
          </Button>
          <Button size="small" onClick={() => submit(cleanDraft(draft), t("copy.saved"))} isLoading={save.isPending}>
            {t("copy.save")}
          </Button>
        </div>
      </div>
    </div>
  )
}
