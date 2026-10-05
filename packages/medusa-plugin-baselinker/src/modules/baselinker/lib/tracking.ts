/**
 * TRACKING LINKS FROM BASELINKER COURIER CODES. Zero imports.
 *
 * BaseLinker names the carrier of a parcel by its module code in
 * `delivery_package_module` ("dpd", "gls", "inpost", "dhl"...), not by a
 * trade name, and the parcel number sits in `delivery_package_nr`. The link
 * is built here, ported from production.
 *
 * AN UNKNOWN CARRIER GIVES `null`, NOT A GUESSED URL. A link that leads
 * nowhere is worse than the bare number: a number can be pasted into a search
 * box, a dead link looks like a broken store.
 */

const CARRIERS: Array<{ match: string[]; name: string; url: (n: string) => string }> = [
  { match: ["dpd"], name: "DPD", url: (n) => `https://tracktrace.dpd.com.pl/parcelDetails?p1=${n}` },
  { match: ["gls"], name: "GLS", url: (n) => `https://gls-group.com/PL/pl/sledzenie-paczek?match=${n}` },
  { match: ["inpost", "paczkomat"], name: "InPost", url: (n) => `https://inpost.pl/sledzenie-przesylek?number=${n}` },
  { match: ["dhl"], name: "DHL", url: (n) => `https://www.dhl.com/pl-pl/home/tracking.html?tracking-id=${n}` },
  { match: ["ups"], name: "UPS", url: (n) => `https://www.ups.com/track?tracknum=${n}` },
  { match: ["fedex"], name: "FedEx", url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}` },
  { match: ["poczta", "pocztex"], name: "Poczta Polska", url: (n) => `https://emonitoring.poczta-polska.pl/?numer=${n}` },
]

function find(module: string | null | undefined) {
  const code = String(module ?? "").trim().toLowerCase()
  if (!code) return null
  return CARRIERS.find((c) => c.match.some((m) => code.includes(m))) ?? null
}

/** Tracking page of the parcel at its carrier, or null for an unknown carrier or no number. */
export function trackingUrl(module: string | null | undefined, number: string | null | undefined): string | null {
  const n = String(number ?? "").trim()
  if (!n) return null
  const carrier = find(module)
  return carrier ? carrier.url(encodeURIComponent(n)) : null
}

/** Readable carrier name; an unknown module code is returned as is. */
export function carrierName(module: string | null | undefined): string | null {
  const code = String(module ?? "").trim()
  if (!code) return null
  return find(code)?.name ?? code
}
