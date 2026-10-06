/**
 * THE TEMPLATE REGISTRY: the built-in templates, the ones defined in the
 * options, and the ones registered by code.
 *
 * A key is looked up in this order:
 *
 *   1. `templates` in the plugin options (`{ "company.approved": def }`):
 *      explicit configuration wins;
 *   2. `registerEmailTemplate(key, def)` from your code;
 *   3. the built-in set.
 *
 * So an app can add its own templates and also replace a built-in one (its
 * key, its sample, its words) without forking the plugin.
 *
 * The runtime registry lives on `globalThis` under a `Symbol.for` key: the
 * provider (inside Medusa's notification module) and the plugin's routes may
 * load this file through different paths, and both must see one registry.
 * The options are the safer place for app templates: they reach every
 * process (server and worker) the same way, whatever files that process loads.
 */

import { isTemplateKey, type EmailLocale } from "./constants"
import { BUILT_IN_TEMPLATES } from "./templates"
import type { EmailTemplateContext, EmailTemplateDefinition, EmailContent, EmailDocument } from "./types"

const REGISTRY_KEY = Symbol.for("koda.emails.templates")
type Holder = typeof globalThis & { [REGISTRY_KEY]?: Map<string, EmailTemplateDefinition<any>> }

function registry(): Map<string, EmailTemplateDefinition<any>> {
  const holder = globalThis as Holder
  if (!holder[REGISTRY_KEY]) holder[REGISTRY_KEY] = new Map()
  return holder[REGISTRY_KEY] as Map<string, EmailTemplateDefinition<any>>
}

/** Types a template definition; returns it unchanged. */
export function defineEmailTemplate<D = Record<string, unknown>>(definition: EmailTemplateDefinition<D>): EmailTemplateDefinition<D> {
  return definition
}

type RenderFn<D> = (ctx: EmailTemplateContext<D>) => EmailDocument | EmailContent

/**
 * Adds or replaces a template at run time. Call it at the top level of a
 * file Medusa loads in every process (a loader, a subscriber file), or
 * prefer the `templates` option. Throws a TypeError for a key that is not
 * letters, digits, dots, dashes and underscores, or a definition without
 * `render`: a mistake in your code should show at once.
 */
export function registerEmailTemplate<D = Record<string, unknown>>(key: string, definition: EmailTemplateDefinition<D> | RenderFn<D>): void {
  if (!isTemplateKey(key)) throw new TypeError(`registerEmailTemplate: "${String(key).slice(0, 64)}" is not a template key (letters, digits, dots, dashes, at most 64 characters).`)
  const def = typeof definition === "function" ? { render: definition } : definition
  if (!def || typeof def !== "object" || typeof def.render !== "function") {
    throw new TypeError(`registerEmailTemplate: the template "${key}" needs a render function.`)
  }
  registry().set(key, def as EmailTemplateDefinition<any>)
}

/** Removes a template registered by code. True when there was one. */
export function unregisterEmailTemplate(key: string): boolean {
  return registry().delete(key)
}

export type TemplateSource = "option" | "registry" | "builtin"

export interface ResolvedTemplate {
  key: string
  def: EmailTemplateDefinition<any>
  source: TemplateSource
  /** The key is one of the built-in keys (even when replaced). */
  builtIn: boolean
}

const BUILT_IN = new Map(BUILT_IN_TEMPLATES)

export function isBuiltInKey(key: string): boolean {
  return BUILT_IN.has(key)
}

export function builtInDefinition(key: string): EmailTemplateDefinition<any> | null {
  return BUILT_IN.get(key) ?? null
}

export function resolveTemplate(key: string, options: { definitions: Record<string, EmailTemplateDefinition<any>> }): ResolvedTemplate | null {
  if (!isTemplateKey(key)) return null
  const fromOptions = options.definitions[key]
  if (fromOptions) return { key, def: fromOptions, source: "option", builtIn: BUILT_IN.has(key) }
  const fromRegistry = registry().get(key)
  if (fromRegistry) return { key, def: fromRegistry, source: "registry", builtIn: BUILT_IN.has(key) }
  const builtIn = BUILT_IN.get(key)
  return builtIn ? { key, def: builtIn, source: "builtin", builtIn: true } : null
}

/** Every template: the built-in keys first, in their order, then the others by key. */
export function listTemplates(options: { definitions: Record<string, EmailTemplateDefinition<any>> }): ResolvedTemplate[] {
  const keys = [...BUILT_IN.keys()]
  const extra = new Set<string>([...Object.keys(options.definitions), ...registry().keys()])
  for (const k of keys) extra.delete(k)
  return [...keys, ...[...extra].sort()].map((k) => resolveTemplate(k, options)).filter((t): t is ResolvedTemplate => t !== null)
}

/** The sample data of a template in a language; an empty object when it has none or it throws. */
export function sampleData(template: ResolvedTemplate, locale: EmailLocale): Record<string, unknown> {
  const s = template.def.sample
  try {
    const value = typeof s === "function" ? (s as (l: EmailLocale) => unknown)(locale) : s
    return value && typeof value === "object" ? { ...(value as Record<string, unknown>), locale: (value as Record<string, unknown>).locale ?? locale } : { locale }
  } catch {
    return { locale }
  }
}
