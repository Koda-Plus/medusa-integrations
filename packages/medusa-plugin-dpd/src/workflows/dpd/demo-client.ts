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
 *   generateProtocol         a session other than DOMESTIC is refused
 *                            (INCORRECT_SESSION_TYPE, 11l), a pickup FID
 *                            other than DEMO_PAYER_FID too (ACCESS_DENIED_
 *                            FOR_FID, 11k); otherwise a sample protocol
 *                            that lists the references and waybills only
 *                            (never a name or an address) and a new
 *                            documentId on every call (demoDocumentId, 05c);
 *                            an unknown reference is not refused (seeded
 *                            rows have none)
 *   courierOrderAvailability a postal code that is not five digits is
 *                            refused (POSTAL_CODE_NOT_FOUND, 11b); otherwise
 *                            DEMO_COURIER_RANGES (11a)
 *   packagesPickupCall       POST, PATCH and DELETE from one courier
 *                            simulator per client (lib/courier-sim.ts) with
 *                            the payer FID DEMO_PAYER_FID: SBX order numbers
 */

import { DEMO_PAYER_FID, PICKUP_MAX_BOXES, PICKUP_MAX_KG, type LabelPage } from "../../modules/dpd/lib/constants"
import { createCourierSimulator } from "../../modules/dpd/lib/courier-sim"
import { DEMO_COURIER_RANGES, DEMO_POINT_CATALOG, demoDocumentId, demoWaybill } from "../../modules/dpd/lib/demo"
import type { AvailabilityOutcome, LabelsOutcome, NumbersOutcome, ProtocolOutcome } from "../../modules/dpd/lib/dpd-answers"
import type { CourierAvailabilityQuery, DpdServicesClient, GeneratePackagesNumbersRequest, GenerateProtocolRequest, GenerateSpedLabelsRequest } from "../../modules/dpd/lib/dpdservices"
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

/** References and waybills listed one by one before "... and <k> more". */
const PROTOCOL_REFERENCES_SHOWN = 30
const PROTOCOL_WAYBILLS_PER_LINE = 10

/** A sample protocol PDF as base64: the references and waybills only, never names or addresses (also not the sender's). */
export function demoProtocolBase64(p: { references: readonly string[]; waybills: readonly string[] }): string {
  const lines: LabelLine[] = [
    { text: "DPD by Koda Plus, sample handover protocol", size: 16, bold: true },
    { text: "Not a DPD protocol, nothing was sent to DPD" },
    { text: `Shipments: ${p.references.length}` },
    ...p.references.slice(0, PROTOCOL_REFERENCES_SHOWN).map((r) => ({ text: r })),
  ]
  if (p.references.length > PROTOCOL_REFERENCES_SHOWN) lines.push({ text: `... and ${p.references.length - PROTOCOL_REFERENCES_SHOWN} more` })
  lines.push({ text: `Waybills: ${p.waybills.length}` })
  for (let i = 0; i < p.waybills.length; i += PROTOCOL_WAYBILLS_PER_LINE) lines.push({ text: p.waybills.slice(i, i + PROTOCOL_WAYBILLS_PER_LINE).join(" ") })
  return Buffer.from(simpleLabelPdf(lines, "A4")).toString("base64")
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
  let protocols = 0
  const courier = createCourierSimulator({ payerFid: DEMO_PAYER_FID })

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

    async generateProtocol(body: GenerateProtocolRequest): Promise<ProtocolOutcome> {
      const params = body.protocolSearchParams
      if (params.session.type !== "DOMESTIC") {
        return {
          kind: "refused",
          code: "session_type",
          message: "DPD refused the protocol (INCORRECT_SESSION_TYPE): the session type does not match the packages.",
          problems: [],
          traceId: null,
          httpStatus: 400,
        }
      }
      if (params.pickupAddress.fid !== DEMO_PAYER_FID) {
        return {
          kind: "refused",
          code: "pickup_fid",
          message: "DPD refused the protocol (ACCESS_DENIED_FOR_FID): the pickup FID does not belong to this account.",
          problems: [{ code: "dpd_payer_fid" }],
          traceId: null,
          httpStatus: 400,
        }
      }
      protocols += 1
      const references = params.session.packages.map((p) => p.reference)
      const waybills = references.flatMap((r) => byReference.get(r)?.waybills ?? [])
      return {
        kind: "ok",
        pdfBase64: demoProtocolBase64({ references, waybills }),
        documentId: demoDocumentId(`${references.join(",")}#${protocols}`),
        references,
        traceId: null,
        httpStatus: 200,
      }
    },

    async courierOrderAvailability(query: CourierAvailabilityQuery): Promise<AvailabilityOutcome> {
      if (!/^\d{5}$/.test(query.zipCode)) {
        return {
          kind: "refused",
          code: "postal_code_not_found",
          message: "DPD does not know this postal code for a courier (POSTAL_CODE_NOT_FOUND).",
          problems: [],
          traceId: null,
          httpStatus: 404,
        }
      }
      return { kind: "ok", ranges: DEMO_COURIER_RANGES.map((r) => ({ ...r })), traceId: null, httpStatus: 200 }
    },

    pickupCallCreate: (body) => courier.pickupCallCreate(body),
    pickupCallUpdate: (body) => courier.pickupCallUpdate(body),
    pickupCallDelete: (query) => courier.pickupCallDelete(query),
  }
}
