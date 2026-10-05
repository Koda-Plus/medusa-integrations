import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { FAKTUROWNIA_DOCUMENT_ISSUED } from "../modules/baselinker/lib/constants"
import { processDueInvoices, recordInvoiceDocument } from "../workflows/baselinker/invoices"
import { baselinkerService } from "../workflows/baselinker/runtime"

/**
 * An invoice issued by the Fakturownia plugin of Koda Plus: its number goes
 * into the BaseLinker order (when the order is in BaseLinker and the
 * `invoiceNumbers` writer is armed), exactly once.
 *
 * A SOFT DEPENDENCY: the event is subscribed by name and the Fakturownia
 * package is never imported. Without that plugin this subscriber simply
 * never fires. It never fails the event: the row is written first, the write
 * itself runs in the background and in the 2-minute job.
 */
export default async function baselinkerFakturowniaDocument({ event: { data }, container }: SubscriberArgs<Record<string, unknown>>): Promise<void> {
  const svc = baselinkerService(container)
  try {
    const queued = await recordInvoiceDocument(container, data)
    if (queued !== "queued") return
    setImmediate(() => {
      processDueInvoices(container, "auto").catch((err: unknown) => {
        svc.getLogger().error(`[baselinker] invoice numbers: ${svc.mask((err as Error)?.message ?? String(err))}`)
      })
    })
  } catch (err) {
    svc.getLogger().error(`[baselinker] ${FAKTUROWNIA_DOCUMENT_ISSUED}: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

export const config: SubscriberConfig = {
  event: FAKTUROWNIA_DOCUMENT_ISSUED,
  context: { subscriberId: "baselinker-fakturownia-document" },
}
