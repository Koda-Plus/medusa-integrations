/**
 * WRITE BARRIER AND TOKEN MASKING. Zero imports, so the unit tests load it
 * without a build.
 *
 * The BaseLinker account on the other side runs the store's real warehouse
 * and marketplaces (Allegro, Amazon, eBay, OLX...). Instead of promising
 * that nobody calls a writing method, one place decides it, and the client
 * asks it BEFORE every request leaves the process.
 *
 * THE RULE IS ASYMMETRIC ON PURPOSE. Every `get*` method passes: BaseLinker
 * names all its reads that way. `addOrder` passes while `exportOrders` is on.
 * Four more writes exist since version 0.2, and each one passes ONLY with
 * the permit of its writer, which a job gets when that writer is armed:
 *
 *   addInventoryProduct            cards              (create or update a card)
 *   updateInventoryProductsStock   stockToBaseLinker  (absolute stock values)
 *   updateInventoryProductsPrices  prices             (one price group)
 *   setOrderFields                 invoiceNumbers     (one order field)
 *
 * Everything else (`delete*`, `setOrderStatus`, `setOrderPayment`,
 * `addInvoice`, `createPackage`, macros...) is blocked by name, with a clear
 * error. The pattern is positive: the list of BaseLinker writes can grow, the
 * `get` prefix of reads does not.
 *
 * Ported from the production integration Koda Plus runs for a Polish tyre
 * and wheel retailer, where the same barrier stands in front of a live
 * account with about 11 000 cards.
 */

export type Verdict = { ok: true } | { ok: false; reason: string }

/** BaseLinker reads: `getInventories`, `getOrders`, `getInventoryProductsList`... */
export const READ_METHOD = /^get[A-Z]/

/**
 * Methods that CREATE something on every call (`addOrder`, `addInventoryProduct`,
 * `createPackage`...). Repeating one is not "the same request again", it is a
 * second order on the seller's account, so the client never retries them blindly.
 */
export const CREATING_METHOD = /^(add|create)[A-Z]/

/** Writes behind a writer permit, and the permit each one needs. */
export const PERMITTED_WRITES: Readonly<Record<string, string>> = {
  addInventoryProduct: "cards",
  updateInventoryProductsStock: "stockToBaseLinker",
  updateInventoryProductsPrices: "prices",
  setOrderFields: "invoiceNumbers",
}

/** Every write version 0.2 can send, with or without a permit. */
export const ALLOWED_WRITES: readonly string[] = ["addOrder", ...Object.keys(PERMITTED_WRITES)]

export function isReadMethod(method: string): boolean {
  return READ_METHOD.test(method.trim())
}

export function isCreatingMethod(method: string): boolean {
  return CREATING_METHOD.test(method.trim())
}

/**
 * Whether a BaseLinker method may leave the process. `permits` are the
 * writers armed for the current run; without them every write except
 * `addOrder` is blocked.
 */
export function isCallAllowed(args: { method: string; exportOrders: boolean; permits?: ReadonlySet<string> }): Verdict {
  const method = args.method.trim()
  if (isReadMethod(method)) return { ok: true }
  if (method === "addOrder") {
    if (args.exportOrders) return { ok: true }
    return { ok: false, reason: "addOrder is blocked: exportOrders is off in the plugin options." }
  }
  const permit = Object.prototype.hasOwnProperty.call(PERMITTED_WRITES, method) ? PERMITTED_WRITES[method] : null
  if (permit) {
    if (args.permits?.has(permit)) return { ok: true }
    return { ok: false, reason: `${method} is blocked: the ${permit} writer is not armed for this run.` }
  }
  return {
    ok: false,
    reason:
      `${method || "(empty method)"} is blocked: the plugin reads from BaseLinker (get* methods), creates orders (addOrder) ` +
      "and, through armed writers only, cards, stock, prices and invoice numbers. It never deletes anything and never " +
      "changes statuses or payments in BaseLinker.",
  }
}

/**
 * A writing method was called against the barrier. A separate class, because
 * "we did not let it out" is a bug in our code, not a BaseLinker failure,
 * and retrying it would only repeat the bug.
 */
export class BaseLinkerWriteBlockedError extends Error {
  readonly method: string
  constructor(method: string, reason: string) {
    super(reason)
    this.name = "BaseLinkerWriteBlockedError"
    this.method = method
  }
}

/**
 * Masks secrets in text that goes to logs, the database or the admin.
 *
 * BaseLinker can echo request parameters in an error body, and errors land in
 * the run history, so the token must not leave in clear by ANY road. First
 * every known secret literally (split and join, no regex, so special
 * characters in a token cannot break a pattern), then every base64-like run
 * of 40 or more characters: a token pasted into the wrong place, one from
 * another account, one after a rotation. Medusa ids (`order_` plus 26
 * characters), SKUs, EANs and tracking numbers stay readable.
 */
export function maskSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = String(text ?? "")
  for (const s of secrets) {
    const secret = (s ?? "").trim()
    if (secret.length >= 8) out = out.split(secret).join("***")
  }
  /* Errors BaseLinker or Medusa send back may echo the buyer's e-mail or an international phone number:
     stored errors and logs never keep them. */
  return out
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "***")
    .replace(/[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g, "***@***")
    .replace(/\+\d[\d ()-]{7,}\d/g, "+***")
}
