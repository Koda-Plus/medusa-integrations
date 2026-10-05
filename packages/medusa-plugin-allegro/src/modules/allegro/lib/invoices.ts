/**
 * INVOICES ON ALLEGRO ORDERS. Pure, zero imports.
 *
 * Two ways in:
 *   `fakturownia.document.issued` from the Fakturownia plugin of Koda Plus,
 *   `{ id, order_id, kind, number, external_id, demo }`; the PDF comes from
 *   `container.resolve("fakturownia").downloadPdf({ externalId, demo })`,
 *   resolved lazily, so this plugin never imports the other one;
 *   `allegro.invoice.attach.requested` for any other invoicing tool,
 *   `{ order_id, filename, url, number? }`, the PDF fetched from an https URL.
 *
 * One way out: `POST /order/{orderId}/billing-documents/files`, multipart
 * with the PDF and the invoice number. The older two-step calls (metadata,
 * then file) are deprecated in the official spec. There is no idempotency
 * key, so `GET /order/checkout-forms/{id}/invoices` is read before every
 * upload and a document with the same number (or file name) is adopted.
 */

import { INVOICE_MAX_BYTES } from "./constants"

export interface InvoiceIssued {
  documentId: string
  orderId: string
  kind: string
  number: string | null
  externalId: string | null
  demo: boolean
}

export interface InvoiceUrlRequest {
  orderId: string
  filename: string
  url: string
  number: string | null
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function str(v: unknown, max = 200): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

/**
 * `fakturownia.document.issued`. The 0.1 event of the Fakturownia plugin
 * (`fakturownia.document_issued`, `document_id` and `fakturownia_id`) is
 * read too, so a store that has not updated it yet still gets its invoices.
 */
export function parseInvoiceIssued(data: unknown): InvoiceIssued | null {
  const d = obj(data)
  const documentId = str(d.id) ?? str(d.document_id)
  const orderId = str(d.order_id)
  const kind = (str(d.kind, 40) ?? "").toLowerCase()
  if (!documentId || !orderId || !kind) return null
  return {
    documentId,
    orderId,
    kind,
    number: str(d.number, 100),
    externalId: str(d.external_id) ?? str(d.fakturownia_id),
    demo: d.demo === true,
  }
}

export function parseAttachRequested(data: unknown): InvoiceUrlRequest | null {
  const d = obj(data)
  const orderId = str(d.order_id)
  const url = str(d.url, 2000)
  if (!orderId || !url) return null
  try {
    if (new URL(url).protocol !== "https:") return null
  } catch {
    return null
  }
  return { orderId, url, filename: safeFilename(str(d.filename, 200), "invoice.pdf"), number: str(d.number, 100) }
}

export function shouldAttach(kind: string, kinds: readonly string[]): boolean {
  return kinds.includes(kind.toLowerCase())
}

/** A file name Allegro accepts and a buyer can read: letters, digits, dot, dash, underscore, `.pdf` at the end. */
export function safeFilename(name: string | null, fallback: string): string {
  const base = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 90)
  const stem = base.replace(/\.pdf$/i, "") || fallback.replace(/\.pdf$/i, "")
  return `${stem}.pdf`
}

/** The file name for a Fakturownia document: its number, made safe ("FV 12/10/2026" becomes "FV_12_10_2026.pdf"). */
export function invoiceFilename(number: string | null, documentId: string): string {
  return safeFilename(number, `invoice-${documentId}`)
}

export type PdfProblem = "empty" | "too_large" | "not_pdf"

/** Allegro accepts a PDF of at most 3 MB; checked before anything is registered. */
export function checkPdf(bytes: Uint8Array): PdfProblem | null {
  if (!bytes || bytes.byteLength === 0) return "empty"
  if (bytes.byteLength > INVOICE_MAX_BYTES) return "too_large"
  const head = String.fromCharCode(...bytes.slice(0, 5))
  return head === "%PDF-" ? null : "not_pdf"
}

/** `GET /order/checkout-forms/{id}/invoices`: invoices already on the order. */
export function invoicesFromApi(raw: unknown): Array<{ id: string; number: string | null; fileName: string | null }> {
  const out: Array<{ id: string; number: string | null; fileName: string | null }> = []
  for (const i of Array.isArray(obj(raw).invoices) ? (obj(raw).invoices as unknown[]) : []) {
    const o = obj(i)
    const id = str(o.id, 64)
    if (!id) continue
    out.push({ id, number: str(o.invoiceNumber, 100), fileName: str(obj(o.file).name, 200) })
  }
  return out
}

/** A document already on the order: same invoice number, or the same file name when there is no number. */
export function findExisting(
  existing: ReadonlyArray<{ id: string; number: string | null; fileName: string | null }>,
  number: string | null,
  fileName: string,
): { id: string } | null {
  const n = number?.trim().toUpperCase() ?? null
  const f = fileName.trim().toUpperCase()
  const hit = existing.find((e) => (n && e.number?.trim().toUpperCase() === n) || (!n && e.fileName?.trim().toUpperCase() === f))
  return hit ? { id: hit.id } : null
}

export function invoiceKey(checkoutFormId: string, source: string): string {
  return `invoice:${checkoutFormId}:${source}`
}

/**
 * A one page PDF saying it is a simulation, for demo mode: a demo writer
 * never calls the network, so an invoice requested by address is not
 * fetched there. ASCII only (the standard Helvetica of PDF has no Polish
 * letters), with a correct cross-reference table.
 */
export function demoPdf(title: string): Uint8Array {
  const text = (title || "Demo invoice")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[łŁ]/g, (c) => (c === "ł" ? "l" : "L"))
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[\\()]/g, (c) => `\\${c}`)
    .slice(0, 80)
  const stream = `BT /F1 18 Tf 72 760 Td (${text}) Tj 0 -28 Td /F1 11 Tf (Simulated document, not an invoice.) Tj ET`
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let out = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}
