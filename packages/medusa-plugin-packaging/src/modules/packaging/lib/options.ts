/**
 * Options of `@koda-plus/medusa-plugin-packaging`, passed in
 * `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-packaging", options: { ... } }]
 *
 * Every key is optional and nothing here can stop Medusa from starting.
 * Demo mode is only ever on with `demo: true`: sample ladders are seeded,
 * flagged `demo`.
 */
export interface PackagingPluginOptions {
  /** Demo mode: sample ladders, flagged demo. Default: false. */
  demo?: boolean
  /**
   * The GS1 company prefix the SSCC labels start with (without the leading
   * extension digit). Default: "590123456789" (a fictional prefix).
   */
  gs1Prefix?: string
}

export interface ResolvedPackagingOptions {
  demo: boolean
  gs1Prefix: string
}

function bool(value: unknown): boolean {
  return value === true || value === "true"
}

export function resolveOptions(o: PackagingPluginOptions | undefined | null): ResolvedPackagingOptions {
  const opts = o && typeof o === "object" ? o : {}
  const prefix = typeof opts.gs1Prefix === "string" ? opts.gs1Prefix.replace(/\D/g, "") : ""
  return {
    demo: bool(opts.demo),
    gs1Prefix: prefix.length >= 7 && prefix.length <= 10 ? prefix : "590123456789",
  }
}
