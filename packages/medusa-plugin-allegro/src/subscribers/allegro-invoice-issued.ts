import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ALLEGRO_MODULE } from "../modules/allegro/lib/constants"
import { parseInvoiceIssued } from "../modules/allegro/lib/invoices"
import type AllegroModuleService from "../modules/allegro/service"
import { enqueueIssuedInvoice, runInvoices } from "../workflows/allegro/run-invoices"

/**
 * An invoice issued by the Fakturownia plugin of Koda Plus for an imported
 * Allegro order goes to the outbox, once. Fakturownia announces a VAT
 * invoice, a proforma or a receipt with `fakturownia.document.issued` and a
 * correction with `fakturownia.document.corrected` (same payload); the event
 * name of Fakturownia 0.1, `fakturownia.document_issued`, is read too.
 * Which kinds are attached is `invoiceKinds` (VAT and corrections by default). The PDF is fetched later,
 * through the Fakturownia module resolved lazily: this plugin never imports
 * it. A malformed payload is logged and dropped, never thrown.
 */
export default async function allegroInvoiceIssued({ event: { data }, container }: SubscriberArgs<Record<string, unknown>>): Promise<void> {
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  const doc = parseInvoiceIssued(data)
  if (!doc) {
    svc.getLogger().warn("[allegro] a Fakturownia document event without id, order_id or kind; ignored.")
    return
  }
  try {
    if ((await enqueueIssuedInvoice(container, doc)) === "queued") void runInvoices(container, { trigger: "event" }).catch(() => undefined)
  } catch (err) {
    svc.getLogger().error(`[allegro] invoice ${doc.documentId} for ${doc.orderId}: ${svc.mask(err instanceof Error ? err.message : String(err))}`)
  }
}

export const config: SubscriberConfig = {
  event: ["fakturownia.document.issued", "fakturownia.document.corrected", "fakturownia.document_issued"],
  context: { subscriberId: "allegro-invoice-issued" },
}
