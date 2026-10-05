import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ALLEGRO_MODULE } from "../modules/allegro/lib/constants"
import { parseAttachRequested } from "../modules/allegro/lib/invoices"
import type AllegroModuleService from "../modules/allegro/service"
import { enqueueInvoiceUrl, runInvoices } from "../workflows/allegro/run-invoices"

/**
 * `allegro.invoice.attach.requested` with `{ order_id, filename, url, number? }`:
 * for stores that invoice with another tool. The PDF is fetched from the
 * https address and attached to the Allegro order once. Never throws.
 */
export default async function allegroInvoiceAttachRequested({ event: { data }, container }: SubscriberArgs<Record<string, unknown>>): Promise<void> {
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  const req = parseAttachRequested(data)
  if (!req) {
    svc.getLogger().warn("[allegro] allegro.invoice.attach.requested without order_id or an https url; ignored.")
    return
  }
  try {
    if ((await enqueueInvoiceUrl(container, req)) === "queued") void runInvoices(container, { trigger: "event" }).catch(() => undefined)
  } catch (err) {
    svc.getLogger().error(`[allegro] invoice for ${req.orderId}: ${svc.mask(err instanceof Error ? err.message : String(err))}`)
  }
}

export const config: SubscriberConfig = {
  event: "allegro.invoice.attach.requested",
  context: { subscriberId: "allegro-invoice-attach-requested" },
}
