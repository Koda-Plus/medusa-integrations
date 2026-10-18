import { isStoreAdapter, type CreditStoreAdapter } from "./store-adapter"

/**
 * Options of `@koda-plus/medusa-plugin-trade-credit`, passed in
 * `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-trade-credit", options: { ... } }]
 *
 * Every key is optional and nothing here can stop Medusa from starting.
 * Demo mode is only ever on with `demo: true`: new rows are flagged `demo`.
 */
export interface CreditPluginOptions {
  /** Demo mode: new limits and credit orders are flagged demo (sample data comes from the app's seed). Default: false. */
  demo?: boolean
  /**
   * With `enforce: true` the store refuses to complete a cart when the
   * customer is blocked or paused, or the order would take their used amount
   * over the limit (`POST /store/carts/:id/complete` answers 403
   * `credit_hold` with `reason`). Default: false, the panel shows the state and the store
   * keeps selling.
   */
  enforce?: boolean
  /**
   * Store mode: the store already keeps trade credit and the plugin is the
   * page over it (see store-adapter.ts). The plugin then keeps no limits of
   * its own, records no orders and gates nothing.
   */
  store?: CreditStoreAdapter
}

export interface ResolvedCreditOptions {
  demo: boolean
  enforce: boolean
  store: CreditStoreAdapter | null
}

function bool(value: unknown): boolean {
  return value === true || value === "true"
}

export function resolveOptions(o: CreditPluginOptions | undefined | null): ResolvedCreditOptions {
  const opts = o && typeof o === "object" ? o : {}
  const store = isStoreAdapter((opts as CreditPluginOptions).store) ? ((opts as CreditPluginOptions).store as CreditStoreAdapter) : null
  return { demo: bool(opts.demo) && !store, enforce: bool(opts.enforce) && !store, store }
}
