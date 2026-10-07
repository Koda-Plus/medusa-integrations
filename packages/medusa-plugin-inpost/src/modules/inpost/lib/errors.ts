/**
 * SHIPX ERRORS. Zero imports.
 *
 * ShipX answers errors as `{ status, error, message, details }`, where
 * `details` names the fields: `{ receiver: { phone: ["invalid"] } }`. An
 * error carries:
 *
 *   status    the HTTP status, 0 when no answer came (network, timeout)
 *   code      ShipX `error` ("validation_failed", "invalid_action",
 *             "resource_not_found"...), or "timeout", "network", "http_502"
 *   unclear   the request may have reached ShipX (no answer, or a 5xx after
 *             a write): a create is then never sent again blindly, the
 *             shipment is looked up first
 */

export class InpostApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  readonly unclear: boolean

  constructor(status: number, code: string, message: string, details: unknown = null, unclear = false) {
    super(message)
    this.name = "InpostApiError"
    this.status = status
    this.code = code
    this.details = details
    this.unclear = unclear
  }
}

/** "receiver.phone: invalid" lines from a ShipX `details` object, at most `max`. */
export function flattenDetails(details: unknown, max = 6): string[] {
  const out: string[] = []
  const walk = (value: unknown, path: string[]): void => {
    if (out.length >= max || value === null || value === undefined) return
    if (Array.isArray(value)) {
      for (const v of value) walk(v, path)
      return
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, /^\d+$/.test(k) ? path : [...path, k])
      return
    }
    out.push(`${path.join(".") || "request"}: ${String(value)}`)
  }
  walk(details, [])
  return out
}

/** A readable message of any error, for logs, the database and the admin (mask it before storing). */
export function describeError(err: unknown): { code: string; message: string; status: number; unclear: boolean } {
  if (err instanceof InpostApiError) {
    const fields = flattenDetails(err.details)
    let message = err.message
    if (err.status === 401) message = "ShipX refused the token (401). Use the ShipX API token from InPost Manager, not the Geowidget token."
    else if (err.status === 403) message = "ShipX refused access to the organization (403). Check organizationId and the rights of the token."
    else if (err.code === "invalid_action") message = `ShipX does not allow this in the shipment's current status (invalid_action)${fields.length ? `: ${fields.join("; ")}` : ""}.`
    else if (fields.length > 0) message = `${err.message} (${fields.join("; ")})`
    return { code: err.code, message: message.slice(0, 1000), status: err.status, unclear: err.unclear }
  }
  const message = err instanceof Error ? err.message : String(err)
  return { code: "error", message: message.slice(0, 1000), status: 0, unclear: false }
}
