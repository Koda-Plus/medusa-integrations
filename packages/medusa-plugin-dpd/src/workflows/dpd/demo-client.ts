/**
 * THE SIMULATED DPDSERVICES OF DEMO MODE. The flows of demo mode run the
 * same code as sandbox and live (the plan, the claim, the store, the stored
 * label); only this client answers instead of DPD. It never calls `fetch`
 * and keeps what it "created" in memory (one per service instance, so a
 * restart forgets it: a later lookup of such a row finds nothing and the row
 * goes back to pending, as a real lookup of a shipment DPD never made).
 *
 *   generatePackagesNumbers  a courier receiver postal code that is not
 *                            all digits is refused (INCORRECT_RECEIVER_
 *                            POSTAL_CODE, as the DPD demo host does); a
 *                            DPD Pickup package is refused as the demo host
 *                            refuses it (more than one box, a box over
 *                            20 kg, no phone and no e-mail, a point outside
 *                            the sample catalog); a reference seen before
 *                            answers as a duplicate; otherwise invented
 *                            waybills (demoWaybill) and a session
 *   generateSpedLabels       by the package reference or a waybill; a waybill
 *                            in the shape of demoWaybill counts as known (the
 *                            seeded rows); the label is a sample PDF that
 *                            says it is not a DPD label
 */

import { PICKUP_MAX_BOXES, PICKUP_MAX_KG, type LabelPage } from "../../modules/dpd/lib/constants"
import { DEMO_POINT_CATALOG, demoWaybill } from "../../modules/dpd/lib/demo"
import type { LabelsOutcome, NumbersOutcome } from "../../modules/dpd/lib/dpd-answers"
import type { DpdServicesClient, GeneratePackagesNumbersRequest, GenerateSpedLabelsRequest } from "../../modules/dpd/lib/dpdservices"
import { simpleLabelPdf, type LabelLine } from "../../modules/dpd/lib/pdf"

/** The host the demo client says it talks to (nothing is called). */
export const DEMO_HOST = "demo"

/** A waybill of demoWaybill: 99, eleven digits, "D". */
const DEMO_WAYBILL = /^99\d{11}D$/

type DemoPackage = { reference: string; sessionId: string; waybills: string[]; cod: string | null }

function codText(pkg: GeneratePackagesNumbersRequest["packages"][0]): string | null {
  const cod = (pkg.services ?? []).find((s) => s.code === "COD")
  if (!cod) return null
  const amount = cod.attributes.find((a) => a.code === "AMOUNT")?.value ?? null
  const currency = cod.attributes.find((a) => a.code === "CURRENCY")?.value ?? ""
  return amount ? `${amount} ${currency}`.trim() : null
}

function labelLines(p: { reference: string | null; waybills: string[]; cod: string | null }, page: LabelPage): LabelLine[] {
  return [
    { text: "DPD by Koda Plus, sample label", size: 16, bold: true },
    { text: "Not a DPD label, nothing was sent to DPD" },
    { text: `Reference: ${p.reference ?? "none"}` },
    ...p.waybills.map((w, i) => ({ text: `Box ${i + 1}: ${w}` })),
    { text: p.cod ? `Cash on delivery: ${p.cod}` : "No cash on delivery" },
    { text: `Page: ${page}` },
  ]
}

/** A sample label PDF as base64 (also what GET label builds on the fly for a seeded demo row). */
export function demoLabelBase64(p: { reference: string | null; waybills: string[]; cod: string | null }, page: LabelPage): string {
  return Buffer.from(simpleLabelPdf(labelLines(p, page), page)).toString("base64")
}

type DemoRefusal = Extract<NumbersOutcome, { kind: "refused" }>

/** The refusals of the DPD demo host for a Pickup package (fixtures 10b, 10g, 10f, 10c), in that order; null when it passes or is no Pickup package. */
function pickupRefusal(pkg: GeneratePackagesNumbersRequest["packages"][0]): DemoRefusal | null {
  const service = (pkg.services ?? []).find((s) => s.code === "DPD_PICKUP")
  if (!pkg.pudoReceiver || !service) return null
  /* As the classifier gives them: the plan's code, source "dpd", DPD's sentence (or the limit) as the detail. */
  const validation = (code: string, detail: string): DemoRefusal => ({
    kind: "refused",
    code: "validation",
    message: `DPD refused the shipment (validation): services[0]: ${detail}.`,
    problems: [{ code, field: "services[0]", detail, source: "dpd" }],
    traceId: null,
    httpStatus: 400,
  })
  if (pkg.parcels.length > PICKUP_MAX_BOXES) return validation("multi_box_not_allowed", "Domestic DPD_PICKUP service is available only for single parcel shipments")
  if (pkg.parcels.some((p) => p.weight > PICKUP_MAX_KG)) return validation("pickup_over_limit", `${PICKUP_MAX_KG} kg`)
  if (!pkg.pudoReceiver.phone && !pkg.pudoReceiver.email) return validation("contact_missing", "Pudo receiver phone or email is needed with DPD_PICKUP service")
  const pudo = service.attributes.find((a) => a.code === "PUDO")?.value ?? ""
  if (!DEMO_POINT_CATALOG.some((p) => p.id === pudo)) {
    return {
      kind: "refused",
      code: "incorrect_data",
      message: `DPD refused the shipment (INCORRECT_DATA): INCORRECT_PUDO: ${pudo}.`,
      problems: [{ code: "pudo_not_found", field: "INCORRECT_PUDO", detail: pudo, source: "dpd" }],
      traceId: null,
      httpStatus: 400,
    }
  }
  return null
}

export function createDemoDpdServicesClient(): DpdServicesClient {
  const byReference = new Map<string, DemoPackage>()
  const byWaybill = new Map<string, DemoPackage>()
  let session = 1000

  return {
    host: DEMO_HOST,

    async generatePackagesNumbers(body: GeneratePackagesNumbersRequest): Promise<NumbersOutcome> {
      const pkg = body.packages[0]
      if (pkg.receiver && !/^\d+$/.test(String(pkg.receiver.postalCode ?? ""))) {
        return {
          kind: "refused",
          code: "incorrect_data",
          message: "DPD refused the shipment (INCORRECT_DATA): INCORRECT_RECEIVER_POSTAL_CODE Incorrect receiver postal code",
          problems: [{ code: "dpd_validation", field: "INCORRECT_RECEIVER_POSTAL_CODE", detail: "Incorrect receiver postal code" }],
          traceId: null,
          httpStatus: 200,
        }
      }
      const pickup = pickupRefusal(pkg)
      if (pickup) return pickup
      if (byReference.has(pkg.reference)) return { kind: "exists", status: "DUPLICATED_PACKAGE_REFERENCE", traceId: null, httpStatus: 200 }
      session += 1
      const waybills = pkg.parcels.map((_, n) => demoWaybill(`${pkg.reference}:${n}`))
      const stored: DemoPackage = { reference: pkg.reference, sessionId: String(session), waybills, cod: codText(pkg) }
      byReference.set(pkg.reference, stored)
      for (const w of waybills) byWaybill.set(w, stored)
      return {
        kind: "ok",
        sessionId: stored.sessionId,
        parcels: pkg.parcels.map((p, n) => ({ reference: p.reference, waybill: waybills[n] })),
        traceId: null,
        httpStatus: 200,
      }
    },

    async generateSpedLabels(body: GenerateSpedLabelsRequest): Promise<LabelsOutcome> {
      const searched: { reference?: string; parcels?: Array<{ waybill?: string }> } = body.labelSearchParams.session.packages[0] ?? {}
      let found: { reference: string | null; waybills: string[]; cod: string | null } | null = null
      if (searched.reference) {
        found = byReference.get(searched.reference) ?? null
      } else {
        const asked = (searched.parcels ?? []).map((p) => p.waybill).filter((w): w is string => typeof w === "string" && w.length > 0)
        const known = asked.map((w) => byWaybill.get(w)).find((p): p is DemoPackage => Boolean(p))
        if (known) found = known
        else if (asked.length > 0 && asked.every((w) => DEMO_WAYBILL.test(w))) found = { reference: null, waybills: asked, cod: null }
      }
      if (!found) return { kind: "not_found", traceId: null, httpStatus: 200 }
      return {
        kind: "ok",
        pdfBase64: demoLabelBase64(found, body.format),
        waybills: [...found.waybills],
        documentId: null,
        traceId: null,
        httpStatus: 200,
      }
    },
  }
}
