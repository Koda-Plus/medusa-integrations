/**
 * THE PDF OF A DOCUMENT, FOR EVERY CALLER: the admin, the storefront route of
 * a logged-in customer, and other plugins through the module service
 * (`downloadPdf`). One code path, so the rules are the same everywhere:
 *
 *   demo      a generated PDF of the simulated document (`lib/pdf.ts`), never
 *             a request; a demo id asked for in live mode gets one too (a row
 *             left from an evaluation), because it never existed in Fakturownia
 *   live      `GET /invoices/{id}.json` limited to the number (for the file
 *             name, unless the caller knows it), then `GET /invoices/{id}.pdf`;
 *             the token stays in the Authorization header of the server
 *
 * Fakturownia renders a PDF a moment after the document is created, and on a
 * KSeF account the VAT invoice only once its KSeF number is there: until then
 * the client throws `FakturowniaApiError` with code `PDF_NOT_READY`
 * (transient). Callers try again later.
 */

import { assertDocumentId, type FakturowniaClient } from "./client"
import { FakturowniaApiError } from "./errors"
import type { ResolvedFakturowniaOptions } from "./options"
import { buildDemoPdf, pdfFileName } from "./pdf"

export interface PdfDownload {
  filename: string
  contentType: "application/pdf"
  data: Buffer
}

export interface FetchPdfArgs {
  options: Pick<ResolvedFakturowniaOptions, "demo">
  /** Built only when Fakturownia is asked (live mode). */
  client: () => FakturowniaClient
  externalId: string
  demo: boolean
  /** Known to the caller (a database row): saves the read of the number. */
  number?: string | null
  kind?: string | null
  issueDate?: string | null
  total?: string | null
}

export async function fetchDocumentPdf(args: FetchPdfArgs): Promise<PdfDownload> {
  const externalId = assertDocumentId(String(args.externalId ?? "").trim())
  if (args.demo) {
    const file = buildDemoPdf({ externalId, number: args.number, kind: args.kind, issueDate: args.issueDate, total: args.total })
    return { filename: file.filename, contentType: "application/pdf", data: file.data }
  }
  if (args.options.demo) {
    throw new FakturowniaApiError({
      code: "DEMO_MODE",
      operation: "pdf",
      message: "This store runs the simulated Fakturownia account (demo mode): a document of a real account cannot be downloaded.",
      transient: false,
      refused: true,
    })
  }
  const client = args.client()
  let number = args.number ?? null
  if (!number) {
    const doc = await client.getInvoice(externalId, ["id", "number"])
    number = typeof doc.number === "string" && doc.number.trim() ? doc.number.trim() : null
  }
  const file = await client.downloadPdf(externalId)
  return { filename: pdfFileName(number, `document-${externalId}`), contentType: "application/pdf", data: Buffer.from(file.bytes) }
}
