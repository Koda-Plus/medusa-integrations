import { Module } from "@medusajs/framework/utils"
import FakturowniaModuleService from "./service"
import { FAKTUROWNIA_MODULE } from "./lib/constants"

/**
 * Fakturownia module: the document outbox (one row per order and kind, with
 * what Fakturownia made of it: number, payment, KSeF status) and the history
 * of background runs. Talks to Fakturownia only through `lib/client.ts`.
 */
export { FAKTUROWNIA_MODULE }
export type { FakturowniaPluginOptions } from "./lib/options"
/* The contract other plugins build on: the events and the PDF of a document. */
export { DOCUMENT_ISSUED_EVENT, DOCUMENT_CORRECTED_EVENT } from "./lib/events"
export type { FakturowniaDocumentEvent, FakturowniaEventKind } from "./lib/events"
export type { PdfDownload } from "./lib/files"
export { FakturowniaApiError } from "./lib/errors"

export default Module(FAKTUROWNIA_MODULE, {
  service: FakturowniaModuleService,
})
