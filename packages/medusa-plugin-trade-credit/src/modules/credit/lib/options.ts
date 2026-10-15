import { isStoreAdapter, type CreditStoreAdapter } from "./store-adapter"

/**
 * Options of `@koda-plus/medusa-plugin-trade-credit`, passed in
 * `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-trade-credit", options: { ... } }]
 *
 * Every key is optional and nothing here can stop Medusa from starting.
 * Demo mode is only ever on with `demo: true`: sample limits are seeded,
 * flagged `demo`.
 */
export interface CreditPluginOptions {
  /** Demo mode: sample limits and credit orders, flagged demo. Default: false. */
  demo?: boolean
  /**
   * With `enforce: true` the store refuses to complete a cart when the
   * customer's used amount would pass their limit or when they are blocked
   * (`POST /store/carts/:id/complete` and the store credit route answer 403
   * `credit_hold`). Default: false, the panel shows the state and the store
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
