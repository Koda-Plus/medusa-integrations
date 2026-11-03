/**
 * ERRORS OF THE RAILWAY READS. No runtime imports beyond the pure helpers.
 *
 * Every message is masked before it is stored in the error (the token and
 * anything shaped like a secret), so an error can travel to a log or to the
 * admin as it is.
 */
import { maskSecrets } from "./security"

export type RailwayErrorKind =
  /** No usable token, or Railway refused it ("Not Authorized", 401, 403). */
  | "auth"
  /** The id does not exist for this token (another project, deleted). */
  | "not_found"
  /** Still 429 after the retries, or the plugin's own hourly budget is spent. */
  | "rate_limited"
  /** Railway answered 5xx, or the answer was not JSON. */
  | "railway"
  /** Timeout or no connection. */
  | "network"
  /** A GraphQL error that is none of the above (a field Railway changed). */
  | "invalid"
  /** The guard refused the document (never sent). */
  | "forbidden"

export class RailwayApiError extends Error {
  readonly kind: RailwayErrorKind
  readonly status: number | null

  constructor(args: { kind: RailwayErrorKind; message: string; status?: number | null; secrets?: readonly (string | null | undefined)[] }) {
    super(maskSecrets(args.message, args.secrets ?? []))
    this.name = "RailwayApiError"
    this.kind = args.kind
    this.status = args.status ?? null
  }
}

export function kindOfStatus(status: number): RailwayErrorKind {
  if (status === 401 || status === 403) return "auth"
  if (status === 404) return "not_found"
  if (status === 429) return "rate_limited"
  if (status >= 500) return "railway"
  return "invalid"
}

/** The kind of a GraphQL error message (Railway answers 200 with `errors`). */
export function kindOfGraphqlMessage(message: string): RailwayErrorKind {
  const m = message.toLowerCase()
  if (/not authori[sz]ed|unauthori[sz]ed|forbidden|invalid token|authentication/.test(m)) return "auth"
  if (/not found|does not exist|no .* with id/.test(m)) return "not_found"
  if (/rate limit|too many requests/.test(m)) return "rate_limited"
  return "invalid"
}

export function isRailwayError(err: unknown): err is RailwayApiError {
  return err instanceof RailwayApiError
}
