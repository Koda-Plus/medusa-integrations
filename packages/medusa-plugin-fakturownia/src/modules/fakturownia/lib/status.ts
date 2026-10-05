/**
 * KSeF STATUS, AS FAKTUROWNIA REPORTS IT. Zero imports.
 *
 * `gov_status` of a document (KSeF.md, "Możliwe statusy"): `ok` (accepted,
 * the document has its KSeF number `gov_id`), `processing`, `offline`
 * (issued in an offline mode, waiting to be sent), `not_applicable` (a
 * proforma, a receipt), `null` (not sent, or KSeF is not enabled on the
 * account), and the problems: `send_error`, `server_error`,
 * `status_check_error`, `offline_error`, `duplicate_error`,
 * `blocked_403_error`, `not_connected`. The KSeF test environment reports the
 * same values with a `demo_` prefix. The admin shows "Accepted" for `ok`.
 *
 * Only VAT invoices go to KSeF among the kinds this plugin issues.
 */

export type GovState = "none" | "processing" | "accepted" | "problem" | "not_applicable" | "offline"

export const GOV_PROBLEMS: readonly string[] = [
  "send_error",
  "server_error",
  "status_check_error",
  "offline_error",
  "duplicate_error",
  "blocked_403_error",
  "not_connected",
]

/** The raw value without the `demo_` prefix of the KSeF test environment. */
export function baseGovStatus(govStatus: string | null | undefined): string {
  const s = String(govStatus ?? "").trim().toLowerCase()
  return s.startsWith("demo_") ? s.slice(5) : s
}

export function govState(govStatus: string | null | undefined): GovState {
  const s = baseGovStatus(govStatus)
  if (!s || s === "null") return "none"
  if (s === "ok") return "accepted"
  if (s === "processing") return "processing"
  if (s === "offline") return "offline"
  if (s === "not_applicable") return "not_applicable"
  /* The listed problems, and any value this version does not know yet: a person should look. */
  return "problem"
}

/** After these the status no longer changes by itself: the refresh stops reading the document. */
export function isGovFinal(govStatus: string | null | undefined): boolean {
  const s = baseGovStatus(govStatus)
  return s === "ok" || s === "not_applicable"
}

/** Kinds Fakturownia sends to KSeF, of those the plugin issues. */
export function goesToKsef(kind: string): boolean {
  return kind === "vat"
}

/**
 * Whether Fakturownia refused an e-mail only because the KSeF number is not
 * there yet (documented: HTTP 200, `"Faktura nie może zostać wysłana - brak
 * numeru KSeF"`). Such an e-mail waits for the number.
 */
export function isWaitingForKsef(message: string | null | undefined): boolean {
  return /ksef/i.test(String(message ?? ""))
}
