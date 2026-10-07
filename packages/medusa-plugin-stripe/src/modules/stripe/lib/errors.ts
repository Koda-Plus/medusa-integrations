/**
 * ERRORS OF THE STRIPE READS. No runtime imports beyond the pure helpers.
 *
 * Every message is masked before it is stored in the error (the configured
 * key and anything shaped like a Stripe secret), so an error can travel to
 * a log or to the admin as it is.
 */
import { maskSecrets, permissionFrom } from "./security"

export type StripeErrorKind =
  /** No usable key: missing, publishable, or rejected by Stripe (401). */
  | "auth"
  /** A restricted key without the permission for this read (403). */
  | "permission"
  /** The object does not exist for this key: another account, or the other mode (404). */
  | "not_found"
  /** Still 429 after the retries. */
  | "rate_limited"
  /** Stripe answered 5xx, or the answer was not JSON. */
  | "stripe"
  /** Timeout or no connection. */
  | "network"
  /** Anything else Stripe refused (400). */
  | "invalid"

export class StripeApiError extends Error {
  readonly kind: StripeErrorKind
  readonly status: number | null
  readonly code: string | null
  readonly requestId: string | null
  /** The restricted key permission Stripe asked for, like `rak_charge_read`. */
  readonly permission: string | null

  constructor(args: { kind: StripeErrorKind; message: string; status?: number | null; code?: string | null; requestId?: string | null; secrets?: readonly (string | null | undefined)[] }) {
    const message = maskSecrets(args.message, args.secrets ?? [])
    super(message)
    this.name = "StripeApiError"
    this.kind = args.kind
    this.status = args.status ?? null
    this.code = args.code ?? null
    this.requestId = args.requestId ?? null
    this.permission = args.kind === "permission" ? permissionFrom(message) : null
  }
}

export function kindOfStatus(status: number): StripeErrorKind {
  if (status === 401) return "auth"
  if (status === 403) return "permission"
  if (status === 404) return "not_found"
  if (status === 429) return "rate_limited"
  if (status >= 500) return "stripe"
  return "invalid"
}

/** What a failed read leaves for the admin: a masked message, the status and the permission to add. */
export interface ReadFailure {
  error: string
  status: number | null
  kind: StripeErrorKind | "unknown"
  permission: string | null
}

export function toFailure(err: unknown, secrets: readonly (string | null | undefined)[] = []): ReadFailure {
  if (err instanceof StripeApiError) return { error: err.message, status: err.status, kind: err.kind, permission: err.permission }
  const message = err instanceof Error ? err.message : String(err)
  return { error: maskSecrets(message, secrets), status: null, kind: "unknown", permission: null }
}

export function isFailure(value: unknown): value is ReadFailure {
  return Boolean(value && typeof value === "object" && typeof (value as ReadFailure).error === "string" && "kind" in (value as object))
}
