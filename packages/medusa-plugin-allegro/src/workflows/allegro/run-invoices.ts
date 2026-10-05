/**
 * INVOICES ONTO ALLEGRO ORDERS, with their OWN sweep (they never ride the
 * order import: pausing the import does not stop invoices reaching buyers).
 *
 *   enqueue   `fakturownia.document.issued` (the Fakturownia plugin of Koda
 *             Plus) or `allegro.invoice.attach.requested` (any other tool)
 *             for an imported Allegro order becomes one outbox row per
 *             document, unique, while `writes.invoices` allows it;
 *   send      once the invoices writer is armed: the PDF (from Fakturownia
 *             through `container.resolve("fakturownia").downloadPdf(...)`,
 *             resolved lazily and never imported, or from an https URL) is
 *             checked (PDF, at most 3 MB) and uploaded with
 *             `POST /order/{id}/billing-documents/files`, after a lookup of
 *             the invoices already on the order.
 */

import { createHash, randomUUID } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import type AllegroModuleService from "../../modules/allegro/service"
import { getInvoices } from "../../modules/allegro/lib/api"
import { AllegroApiError } from "../../modules/allegro/lib/client"
import { apiSend } from "../../modules/allegro/lib/connection"
import { OUTBOX_LEASE_MS } from "../../modules/allegro/lib/constants"
import type { ImportRow, OutboxRow } from "../../modules/allegro/lib/dto"
import {
  checkPdf,
  demoPdf,
  findExisting,
  invoiceFilename,
  invoiceKey,
  invoicesFromApi,
  shouldAttach,
  type InvoiceIssued,
  type InvoiceUrlRequest,
} from "../../modules/allegro/lib/invoices"
import type { OutboxPorts } from "../../modules/allegro/lib/outbox"
import type { OutboxStore } from "../../modules/allegro/lib/store"
import { loadOverlay, updateOverlay } from "./demo-sim"
import { drainOutbox, type OutboxRunResult } from "./run-shipping"
import { allegroOf, exclusive, outboxStoreOf, recordRun } from "./runtime"
import { armedWriters, touchWriterRun } from "./writers"

/** A permanent problem with one invoice: a person has to look, retrying changes nothing. */
function permanent(message: string): Error {
  return Object.assign(new Error(message), { status: 422, transient: false })
}

async function importedOrder(svc: AllegroModuleService, orderId: string): Promise<ImportRow | null> {
  const rows = (await svc.listAllegroOrderImports({ order_id: orderId } as never, { take: 1 })) as unknown as ImportRow[]
  const row = rows[0]
  return row && (row.status === "imported" || row.status === "cancelled") ? row : null
}

/** `fakturownia.document.issued` for an imported Allegro order: one outbox row. */
export async function enqueueIssuedInvoice(container: MedusaContainer, doc: InvoiceIssued): Promise<"queued" | "known" | "ignored"> {
  const svc = allegroOf(container)
  const o = svc.getOptions()
  if (!o.writes.invoices) return "ignored"
  if (!shouldAttach(doc.kind, o.invoiceKinds)) return "ignored"
  /* Never a simulated document on a real Allegro order. */
  if (doc.demo && !o.demo) return "ignored"
  const imp = await importedOrder(svc, doc.orderId)
  if (!imp) return "ignored"
  const row = await outboxStoreOf(container).insertIgnore({
    writer: "invoices",
    dedupeKey: invoiceKey(imp.checkout_form_id, `fakturownia:${doc.documentId}`),
    checkout_form_id: imp.checkout_form_id,
    order_id: doc.orderId,
    payload: {
      kind: "invoice",
      source: "fakturownia",
      documentId: doc.documentId,
      externalId: doc.externalId,
      number: doc.number,
      documentKind: doc.kind,
      demo: doc.demo,
      filename: invoiceFilename(doc.number, doc.documentId),
    },
    demo: Boolean(imp.demo),
  })
  return row ? "queued" : "known"
}

/** `allegro.invoice.attach.requested` from any invoicing tool: one outbox row per URL. */
export async function enqueueInvoiceUrl(container: MedusaContainer, req: InvoiceUrlRequest): Promise<"queued" | "known" | "ignored"> {
  const svc = allegroOf(container)
  if (!svc.getOptions().writes.invoices) return "ignored"
  const imp = await importedOrder(svc, req.orderId)
  if (!imp) return "ignored"
  const digest = createHash("sha256").update(req.url).digest("hex").slice(0, 24)
  const row = await outboxStoreOf(container).insertIgnore({
    writer: "invoices",
    dedupeKey: invoiceKey(imp.checkout_form_id, `url:${digest}`),
    checkout_form_id: imp.checkout_form_id,
    order_id: req.orderId,
    payload: { kind: "invoice", source: "url", url: req.url, filename: req.filename, number: req.number },
    demo: Boolean(imp.demo),
  })
  return row ? "queued" : "known"
}

interface PdfFile {
  filename: string
  data: Uint8Array
}

type FakturowniaLike = { downloadPdf(args: { externalId: string; demo: boolean }): Promise<{ filename?: string; contentType?: string; data: Uint8Array }> }

/** The PDF of the document: Fakturownia lazily, or the https address. */
async function pdfOf(container: MedusaContainer, payload: Record<string, unknown>, demo: boolean): Promise<PdfFile> {
  if (payload.source === "fakturownia") {
    let fakturownia: FakturowniaLike | null = null
    try {
      fakturownia = container.resolve("fakturownia") as unknown as FakturowniaLike
    } catch {
      fakturownia = null
    }
    if (!fakturownia || typeof fakturownia.downloadPdf !== "function") {
      throw permanent("The Fakturownia module (container key fakturownia, version 0.2 or newer) is not available, so the PDF cannot be read.")
    }
    const externalId = String(payload.externalId ?? "")
    if (!externalId) throw permanent("The Fakturownia event had no external id of the document.")
    const file = await fakturownia.downloadPdf({ externalId, demo: payload.demo === true })
    return { filename: String(payload.filename ?? file.filename ?? "invoice.pdf"), data: new Uint8Array(file.data) }
  }
  const url = String(payload.url ?? "")
  if (!url.startsWith("https://")) throw permanent("Only https addresses are fetched.")
  /* Demo writers never call the network: the address is not fetched, a simulated page stands in. */
  if (demo) return { filename: String(payload.filename ?? "invoice.pdf"), data: demoPdf(`Demo invoice ${String(payload.number ?? "")}`.trim()) }
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw Object.assign(new Error(`Fetching the invoice PDF answered HTTP ${res.status}.`), { status: res.status >= 500 ? 503 : 422, transient: res.status >= 500 })
  const data = new Uint8Array(await res.arrayBuffer())
  return { filename: String(payload.filename ?? "invoice.pdf"), data }
}

function invoicePorts(container: MedusaContainer, svc: AllegroModuleService, store: OutboxStore): OutboxPorts {
  const demo = svc.isDemo()
  const existing = async (form: string) =>
    demo ? ((await loadOverlay(svc)).invoices[form] ?? []).map((i) => ({ id: i.id, number: i.number, fileName: i.fileName })) : invoicesFromApi(await getInvoices(svc, form))
  return {
    now: () => new Date(),
    token: () => randomUUID(),
    claim: async (item, token) => {
      const now = new Date()
      return (await store.claim(item.id, { now, leaseUntil: new Date(now.getTime() + OUTBOX_LEASE_MS), token })) as never
    },
    finish: (item, token, patch) => store.finish(item.id, token, patch),
    lookup: async (item) => {
      const p = item.payload ?? {}
      const form = String((item as unknown as OutboxRow).checkout_form_id)
      const hit = findExisting(await existing(form), (p.number as string | null) ?? null, String(p.filename ?? "invoice.pdf"))
      return hit ? { found: true, result: { invoiceId: hit.id } } : { found: false }
    },
    send: async (item) => {
      const p = item.payload ?? {}
      const form = String((item as unknown as OutboxRow).checkout_form_id)
      const armed = await armedWriters(svc)
      if (!armed.has("invoices")) throw Object.assign(new Error("The invoices writer was disarmed."), { status: 0, transient: true })
      const pdf = await pdfOf(container, p, demo)
      const problem = checkPdf(pdf.data)
      if (problem === "too_large") throw permanent(`The PDF has ${Math.round(pdf.data.byteLength / 1024)} KB; Allegro accepts at most 3 MB.`)
      if (problem === "empty") throw permanent("The PDF is empty.")
      if (problem === "not_pdf") throw permanent("The file is not a PDF.")
      const number = (p.number as string | null) ?? null
      if (demo) {
        const id = randomUUID()
        await updateOverlay(svc, (o) => {
          o.invoices[form] = [...(o.invoices[form] ?? []), { id, number, fileName: pdf.filename, bytes: pdf.data.byteLength, createdAt: new Date().toISOString() }]
        })
        return { kind: "sent", result: { invoiceId: id, bytes: pdf.data.byteLength, simulated: true } }
      }
      const body = new FormData()
      body.append("file", new Blob([new Uint8Array(pdf.data)], { type: "application/pdf" }), pdf.filename)
      if (number) body.append("invoiceNumber", number)
      try {
        const res = await apiSend<{ id?: string }>(svc, {
          method: "POST",
          path: `/order/${encodeURIComponent(form)}/billing-documents/files`,
          form: body,
          idempotent: false,
          writer: "invoices",
          armed,
        })
        return { kind: "sent", result: { invoiceId: res.data?.id ?? null, bytes: pdf.data.byteLength } }
      } catch (err) {
        /* 409: "already has an invoice with the same file name, or an invoice file has already been uploaded". */
        if (err instanceof AllegroApiError && err.status === 409) {
          const hit = findExisting(await existing(form), number, pdf.filename)
          if (hit) return { kind: "sent", result: { invoiceId: hit.id, adopted: true } }
        }
        throw err
      }
    },
  }
}

export async function runInvoices(container: MedusaContainer, input: { trigger?: string } = {}): Promise<OutboxRunResult> {
  const result = await exclusive("invoices", async (): Promise<OutboxRunResult> => {
    const svc = allegroOf(container)
    const startedAt = new Date()
    const armed = await armedWriters(svc)
    if (!armed.has("invoices")) return { skipped: "not_armed", counts: {}, message: "The invoices writer is not armed." }
    await touchWriterRun(svc, "invoices")
    const store = outboxStoreOf(container)
    const { counts, message } = await drainOutbox(container, svc, "invoices", invoicePorts(container, svc, store), store)
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    if (total > 0) {
      await recordRun(svc, {
        kind: "invoices",
        source: svc.isDemo() ? "demo" : "api",
        trigger: input.trigger ?? "manual",
        status: (counts.failed ?? 0) > 0 ? "partial" : "ok",
        items: total,
        created: counts.done ?? 0,
        issues: counts.failed ?? 0,
        statuses: counts,
        message,
        startedAt,
      })
    }
    return { skipped: null, counts, message }
  })
  return result ?? { skipped: "running", counts: {}, message: null }
}
