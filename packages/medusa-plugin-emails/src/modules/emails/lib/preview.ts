/**
 * RENDERING OUTSIDE MEDUSA: a template with its sample data (or yours) and
 * the plugin options, to HTML and text. For tests and previews in your own
 * code, e.g. a snapshot test of your app templates:
 *
 *   const { subject, html, text } = renderEmailPreview({ template: "company.approved", locale: "pl", options: emails })
 *
 * Nothing is sent and nothing is read from the database (admin overrides of
 * the branding do not apply here).
 */

import type { EmailLocale } from "./constants"
import { resolveOptions, type EmailsPluginOptions } from "./options"
import { resolveTemplate, sampleData } from "./registry"
import { renderTemplate, type PreviewTheme, type RenderedEmail } from "./render"

export function renderEmailPreview(input: {
  template: string
  data?: Record<string, unknown>
  locale?: EmailLocale
  options?: EmailsPluginOptions
  theme?: PreviewTheme
}): RenderedEmail {
  const options = resolveOptions(input.options)
  const template = resolveTemplate(input.template, options)
  if (!template) throw new Error(`No template "${input.template}" is registered.`)
  const locale = input.locale ?? options.defaultLocale
  const data = input.data ?? sampleData(template, locale)
  return renderTemplate(template, data, { locale, options, brand: options.brand, theme: input.theme ?? null })
}
