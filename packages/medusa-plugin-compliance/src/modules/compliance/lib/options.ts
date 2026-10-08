import { CONSENT_PURPOSES, type ConsentPurpose } from "./constants"

/**
 * Options of `@koda-plus/medusa-plugin-compliance`, passed in `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-compliance", options: { ... } }]
 *
 * Every key is optional and nothing here can stop Medusa from starting. Demo
 * mode is only ever on with `demo: true`, never because a key is missing.
 */
export interface CompliancePluginOptions {
  /**
   * Demo mode: sample responsible persons, product compliance and price
   * snapshots are seeded (flagged `demo`) apart from the store's real rows.
   * Default: false.
   */
  demo?: boolean
  /** Sections shown in the panel: `gpsr`, `rodo`, `omnibus`. Default: all. */
  sections?: string[] | string
  /**
   * The cookies the storefront sets, one object per cookie, for the consent
   * panel to disclose: `{ name, purpose, description }`. Default: none.
   */
  cookieInventory?: Array<{ name: string; purpose: ConsentPurpose; description: string }>
  /** Purpose labels of the storefront's own consent categories, shown in the panel. Default: none. */
  consentPurposes?: string[] | string
}

export interface ResolvedComplianceOptions {
  demo: boolean
  sections: { gpsr: boolean; rodo: boolean; omnibus: boolean }
  cookieInventory: Array<{ name: string; purpose: ConsentPurpose; description: string }>
  consentPurposes: string[]
}

const LIST_MAX = 200

function entries(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\s]+/) : []
  return raw.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase()).filter(Boolean)
}

function bool(value: unknown): boolean {
  return value === true || value === "true"
}

export function resolveOptions(o: CompliancePluginOptions | undefined | null): ResolvedComplianceOptions {
  const opts = o && typeof o === "object" ? o : {}
  const sections = entries(opts.sections)
  const has = (n: string) => sections.length === 0 || sections.includes(n)
  const purposes = (opts.consentPurposes ? entries(opts.consentPurposes) : []).filter((p) => (CONSENT_PURPOSES as readonly string[]).includes(p))
  const inventory = Array.isArray(opts.cookieInventory)
    ? opts.cookieInventory
        .filter((c) => c && typeof c.name === "string" && c.name.trim())
        .slice(0, LIST_MAX)
        .map((c) => ({
          name: c.name.trim(),
          purpose: (CONSENT_PURPOSES as readonly string[]).includes(c.purpose) ? c.purpose : ("functional" as ConsentPurpose),
          description: typeof c.description === "string" ? c.description.trim() : "",
        }))
    : []
  return {
    demo: bool(opts.demo),
    sections: { gpsr: has("gpsr"), rodo: has("rodo"), omnibus: has("omnibus") },
    cookieInventory: inventory,
    consentPurposes: purposes,
  }
}
