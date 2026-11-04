import { SHIPMENT_STAGES, SIM_IN_POINT, type ShipmentStage } from "./constants"

/**
 * THE INFOSERVICES EVENT CODES AND WHAT THEY MEAN FOR THE SHOP (6.3): the
 * stage, whether DPD has the parcel in hand (the only source of "shipped",
 * DS1), notifications that never move the stage, and the codes that move
 * the parcel to a new waybill (DS3).
 *
 * The codes the PDF describes are certain; the rest comes from the libraries
 * the spec cites and is [NZ] (DPD does not publish its code list). An exact
 * code wins over a prefix, the longest prefix over a shorter one, and
 * statusMap of the options changes only the stage (E16).
 */

/** One entry of the map (6.3). */
export type CodeEntry = {
  stage: ShipmentStage
  /** DPD has the parcel in hand (DS1): the only source of "shipped". */
  possession: boolean
  /** Never changes stage nor status (DS12). */
  notification?: true
  /** The event moves the parcel to a new waybill (DS3). */
  repin?: "redirect" | "return"
  source: "pdf" | "lib" | "sim"
}

/** A row of the table in 6.3: exact codes and prefixes sharing one entry. */
export type CodeRule = CodeEntry & { codes?: readonly string[]; prefixes?: readonly string[] }

/**
 * The rows of 6.3, in the order of the table. A test pins every row. The
 * delivery row (prefixes 1901, 1902) is two rules here: 190101 is described
 * in the PDF (source pdf), the rest of both prefixes comes from the
 * libraries. The notification row has no stage of its own: a notification
 * never changes the stage, so its `stage` is never read.
 */
export const BUILTIN_CODE_RULES: readonly CodeRule[] = [
  { codes: ["030103"], stage: "preparing", possession: false, source: "lib" },
  { codes: ["040101", "040102"], stage: "in_transit", possession: true, source: "lib" },
  /* A failed pickup at the sender: no possession, so no block of DS13 (E25) [NZ]. */
  { prefixes: ["0402", "0403", "0404", "0405", "0406"], stage: "problem", possession: false, source: "lib" },
  {
    codes: ["160101", "160103", "330135", "330137", "230101", "320201"],
    prefixes: ["0501", "1201", "1605"],
    stage: "in_transit",
    possession: true,
    source: "lib",
  },
  { codes: ["160102", "160202", "170205", "260403"], prefixes: ["2302"], stage: "problem", possession: true, source: "lib" },
  { codes: ["170101", "170102"], stage: "in_transit", possession: true, source: "pdf" },
  /* Notifications (170301 too, E8, E12) [NZ]; the exact 170302 below wins over this prefix. */
  { prefixes: ["1703"], stage: "in_transit", possession: false, notification: true, source: "lib" },
  { codes: ["170302", "110302", "150301", "250301", "320202"], stage: "in_transit", possession: true, source: "lib" },
  { codes: ["190101"], stage: "delivered", possession: true, source: "pdf" },
  /* Pickup: the collection from the point [NZ]. */
  { prefixes: ["1901", "1902"], stage: "delivered", possession: true, source: "lib" },
  { codes: ["200300", "200306", "200500", "200601", "200801"], prefixes: ["2002"], stage: "in_transit", possession: true, source: "lib" },
  { codes: ["200700"], prefixes: ["2003", "2004"], stage: "problem", possession: true, source: "lib" },
  { codes: ["230309", "230310"], stage: "problem", possession: true, source: "lib" },
  { codes: ["230402"], stage: "in_transit", possession: true, repin: "redirect", source: "pdf" },
  { codes: ["230403", "230408"], stage: "returned", possession: true, repin: "return", source: "pdf" },
  { codes: ["500500"], prefixes: ["5001", "5002"], stage: "in_transit", possession: true, source: "lib" },
  { prefixes: ["5006"], stage: "returned", possession: true, source: "lib" },
  { codes: [SIM_IN_POINT], stage: "in_point", possession: true, source: "sim" },
]

/** A code found in the map, and how. `option` = statusMap only (a code outside the built in map). */
export type ResolvedCode = CodeEntry & { code: string; match: "exact" | "prefix" | "option" }

export type CodeMap = {
  /** Exact code first, then the longest prefix; statusMap overrides the stage of an exact code (6.3). Null: unknown code. */
  lookup(code: string): ResolvedCode | null
}

/** The stages a statusMap code outside the built in map gets possession with. */
export const POSSESSION_STAGES: readonly ShipmentStage[] = ["in_transit", "in_point", "delivered"]

/**
 * The built in map under statusMap of the options. A statusMap code outside
 * the built in map (no exact code, no prefix) gets possession when its stage
 * is in_transit, in_point or delivered (POSSESSION_STAGES), source "lib" and
 * match "option". A statusMap code the built in map knows, exactly or only by
 * a prefix (190105 under 1901), takes the stage alone: possession,
 * notification, repin, source and match stay those of the built in rule
 * (E16). statusMap never changes notification nor repin. A statusMap stage
 * "canceled" is ignored (DS12: canceled has no code; the code stays as the
 * built in map or unknown).
 */
export function buildCodeMap(statusMap: Readonly<Record<string, ShipmentStage>>): CodeMap {
  const exact = new Map<string, CodeEntry>()
  const prefixes: Array<{ prefix: string; entry: CodeEntry }> = []
  for (const rule of BUILTIN_CODE_RULES) {
    const { codes, prefixes: own, ...entry } = rule
    /* The first rule of a code wins: the table holds every code once. */
    for (const code of codes ?? []) if (!exact.has(code)) exact.set(code, entry)
    for (const prefix of own ?? []) prefixes.push({ prefix, entry })
  }
  /* The longest prefix first; a stable sort keeps the table order between prefixes of one length. */
  prefixes.sort((a, b) => b.prefix.length - a.prefix.length)

  function builtin(code: string): ResolvedCode | null {
    const hit = exact.get(code)
    if (hit) return { ...hit, code, match: "exact" }
    const p = prefixes.find((x) => code.startsWith(x.prefix))
    return p ? { ...p.entry, code, match: "prefix" } : null
  }

  const own = new Map<string, ShipmentStage>()
  for (const [code, stage] of Object.entries(statusMap ?? {})) {
    /* canceled has no code (DS12): such a key is ignored, the code stays as the built in map knows it (E16). */
    if (stage === "canceled" || !(SHIPMENT_STAGES as readonly string[]).includes(stage)) continue
    own.set(code, stage)
  }

  return {
    lookup(code) {
      const c = String(code ?? "").trim()
      if (c === "") return null
      const known = builtin(c)
      const stage = own.get(c)
      if (stage === undefined) return known
      /* A code the built in map knows takes the stage alone (E16); a code outside it gets possession by its stage. */
      if (known) return { ...known, stage }
      return { stage, possession: POSSESSION_STAGES.includes(stage), source: "lib", code: c, match: "option" }
    },
  }
}
