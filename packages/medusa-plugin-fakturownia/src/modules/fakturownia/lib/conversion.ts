/**
 * PROFORMA TO FINAL DOCUMENT. Pure: the proforma as `GET /invoices/{id}.json`
 * returns it in, the `invoice` of the VAT invoice (or receipt) out.
 *
 * `from_invoice_id` only LINKS the new document to the proforma ("Wykorzystana
 * w fakturze..."); it copies nothing. Measured in production: a payload of
 * only `kind` and `from_invoice_id` is refused with HTTP 422 (no seller, no
 * buyer, no positions). So the proforma is read and its content is written
 * into the final document:
 *
 *   - every position, field by field (never its `id`, which belongs to the
 *     proforma), with `discount_kind` and `show_discount` only when a copied
 *     position carries a discount;
 *   - the WHOLE buyer, including its type: `buyer_company`,
 *     `buyer_first_name` and `buyer_last_name`. The production integration
 *     this plugin generalizes copied the name and the address but not the
 *     type, so a person's proforma became a company invoice, which KSeF then
 *     treated as a company document;
 *   - order number, currency, language, seller department, category, place,
 *     payment type and the remarks.
 *
 * The dates are today's (the final document is issued after the goods left),
 * and the payment follows the order now: captured in full is paid, otherwise
 * a payment the proforma already carries is kept, otherwise the payment term.
 * A receipt drops the tax ID: a receipt never carries one.
 */

import { PayloadError } from "./errors"
import { apiKind, paymentFields, storedPositions, type BuiltDocument, type FinalKind } from "./document"
import { money, toNumber, toNumberOrNull } from "./numbers"

type RemoteRecord = Record<string, unknown>

/** Buyer fields copied from the proforma. */
export const COPIED_BUYER_FIELDS: readonly string[] = [
  "buyer_name",
  "buyer_company",
  "buyer_first_name",
  "buyer_last_name",
  "buyer_tax_no",
  "buyer_tax_no_kind",
  "buyer_email",
  "buyer_street",
  "buyer_post_code",
  "buyer_city",
  "buyer_country",
  "buyer_note",
]

/** Document fields copied from the proforma. */
export const COPIED_DOCUMENT_FIELDS: readonly string[] = ["oid", "currency", "lang", "department_id", "category_id", "place", "payment_type", "description"]

/** Position fields copied from the proforma. */
const POSITION_TEXT_FIELDS = ["name", "code", "quantity_unit", "additional_info", "gtu_code"] as const
const POSITION_NUMBER_FIELDS = ["quantity", "total_price_gross", "price_gross", "discount_percent", "discount"] as const

function present(v: unknown): boolean {
  return v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")
}

function copyPositions(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return []
  const out: Array<Record<string, unknown>> = []
  for (const p of raw) {
    if (!p || typeof p !== "object") continue
    const src = p as RemoteRecord
    const position: Record<string, unknown> = {}
    for (const f of POSITION_TEXT_FIELDS) if (present(src[f])) position[f] = String(src[f]).trim()
    for (const f of POSITION_NUMBER_FIELDS) {
      const n = toNumberOrNull(src[f])
      if (n !== null) position[f] = n
    }
    /* "23", 23, "zw", "np": the tax goes back exactly as Fakturownia gave it. */
    if (present(src.tax)) position.tax = typeof src.tax === "number" ? src.tax : String(src.tax).trim()
    if (!position.name || position.total_price_gross === undefined) continue
    out.push(position)
  }
  return out
}

export interface ConversionArgs {
  kind: FinalKind
  receiptKind: string
  /** `YYYY-MM-DD` in Poland. */
  today: string
  /** The order is captured in full now. */
  capturedInFull: boolean
  paymentTermDays: number
  /** Option values used when the proforma has none. */
  fallback: { issuePlace: string; lang: string }
}

export function buildFinalFromProforma(proforma: RemoteRecord, args: ConversionArgs): BuiltDocument {
  const proformaId = String(proforma.id ?? "").trim()
  if (!/^\d+$/.test(proformaId)) throw new PayloadError("proforma_unreadable", "The proforma answer has no id.")
  const positions = copyPositions(proforma.positions)
  if (positions.length === 0) {
    throw new PayloadError("proforma_empty", `Proforma ${String(proforma.number ?? proformaId)} has no positions to copy. Check it in Fakturownia.`)
  }

  const kind = apiKind(args.kind, args.receiptKind)
  const invoice: Record<string, unknown> = { kind, from_invoice_id: Number(proformaId), issue_date: args.today, sell_date: args.today }
  for (const f of COPIED_DOCUMENT_FIELDS) if (present(proforma[f])) invoice[f] = proforma[f]
  for (const f of COPIED_BUYER_FIELDS) if (present(proforma[f])) invoice[f] = proforma[f]
  if (!present(invoice.place) && args.fallback.issuePlace) invoice.place = args.fallback.issuePlace
  if (!present(invoice.lang)) invoice.lang = args.fallback.lang

  /* The type travels as a boolean, whatever shape the GET answer gave it ("1", true...). */
  const company = invoice.buyer_company === true || invoice.buyer_company === "true" || invoice.buyer_company === "1" || invoice.buyer_company === 1
  invoice.buyer_company = args.kind === "receipt" ? false : company
  if (args.kind === "receipt") {
    delete invoice.buyer_tax_no
    delete invoice.buyer_tax_no_kind
  }

  if (positions.some((p) => p.discount_percent !== undefined || p.discount !== undefined)) {
    invoice.discount_kind = present(proforma.discount_kind) ? proforma.discount_kind : "percent_unit"
    invoice.show_discount = true
  }

  const totalGross = money(positions.reduce((sum, p) => sum + toNumber(p.total_price_gross), 0))
  const proformaGross = toNumberOrNull(proforma.price_gross) ?? totalGross
  const proformaPaid = toNumber(proforma.paid)
  const paid = args.capturedInFull || (proformaGross > 0 && proformaPaid + 0.005 >= proformaGross)
  Object.assign(invoice, paymentFields({ paid, totalGross, today: args.today, termDays: args.paymentTermDays }))
  invoice.positions = positions

  return {
    invoice,
    summary: {
      kind: args.kind,
      apiKind: kind,
      oid: present(invoice.oid) ? String(invoice.oid) : null,
      issueDate: args.today,
      currency: present(invoice.currency) ? String(invoice.currency).toUpperCase() : "PLN",
      totalGross,
      positions: storedPositions(
        positions.map((p) => ({
          name: String(p.name),
          code: present(p.code) ? String(p.code) : undefined,
          quantity: toNumber(p.quantity),
          quantity_unit: present(p.quantity_unit) ? String(p.quantity_unit) : "",
          total_price_gross: toNumber(p.total_price_gross),
          tax: p.tax ?? "",
        })),
      ),
      buyerType: invoice.buyer_company === true ? "company" : "person",
      paid,
      paymentType: present(invoice.payment_type) ? String(invoice.payment_type) : "transfer",
      fromInvoiceId: proformaId,
      buyerWarning: null,
      orderVersion: null,
    },
  }
}
