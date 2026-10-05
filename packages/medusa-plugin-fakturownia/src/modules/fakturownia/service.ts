import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import FakturowniaDocument from "./models/fakturownia-document"
import FakturowniaSyncRun from "./models/fakturownia-sync-run"
import FakturowniaCorrection from "./models/fakturownia-correction"
import FakturowniaEmail from "./models/fakturownia-email"
import FakturowniaKsefEvent from "./models/fakturownia-ksef-event"
import FakturowniaSetting from "./models/fakturownia-setting"
import { FakturowniaClient } from "./lib/client"
import { fetchDocumentPdf, type PdfDownload } from "./lib/files"
import { missingOptions, resolveOptions, type FakturowniaPluginOptions, type ResolvedFakturowniaOptions } from "./lib/options"
import { maskSecrets } from "./lib/security"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Fakturownia module service: generated CRUD for the six tables (the
 * document outbox, the runs, the correction plans, the e-mail and KSeF
 * histories, the settings) plus the resolved options, masking and
 * `downloadPdf` (options and the API only). Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The work (the outbox, the lookups, the
 * payments, the KSeF status) lives in `src/workflows/fakturownia` and calls
 * the generated methods (`svc.listFakturowniaDocuments(...)`) from the
 * outside. A custom method here that calls `this.list*` breaks on our Medusa
 * demo with a `fork` error of the entity manager, and every flow outside is
 * reusable from your own workflows anyway.
 *
 * MISSING OPTIONS DO NOT BREAK THE BOOT. Without a token the module runs in
 * demo mode; with `demo: false` and no token it registers, the admin says
 * "not configured" and nothing is issued.
 */
class FakturowniaModuleService extends MedusaService({
  FakturowniaDocument,
  FakturowniaSyncRun,
  FakturowniaCorrection,
  FakturowniaEmail,
  FakturowniaKsefEvent,
  FakturowniaSetting,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedFakturowniaOptions

  constructor(deps: InjectedDependencies, options?: FakturowniaPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info(
        this.options_.demoReason === "no_token"
          ? "[fakturownia] Demo mode (no apiToken): a simulated Fakturownia account, nothing leaves Medusa."
          : "[fakturownia] Demo mode: a simulated Fakturownia account, nothing leaves Medusa.",
      )
    } else if (!this.isConfigured()) {
      this.logger_.info(`[fakturownia] Waiting for configuration, missing: ${this.missingOptions().join(", ")}.`)
    }
  }

  /** Resolved options WITH the token. Server side only, never send to the admin. */
  getOptions(): ResolvedFakturowniaOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }

  /** Documents can be issued: demo mode, or a token and a valid account. */
  isConfigured(): boolean {
    return missingOptions(this.options_).length === 0
  }

  missingOptions(): string[] {
    return missingOptions(this.options_)
  }

  /** Masks the API token and every token-like run of characters. */
  mask(text: string): string {
    return maskSecrets(text, [this.options_.apiToken])
  }

  private client_: FakturowniaClient | null = null

  /**
   * THE PDF OF A DOCUMENT, FOR OTHER PLUGINS. `externalId` is the Fakturownia
   * invoice id (`external_id` of the `fakturownia.document.issued` and
   * `.corrected` events), `demo` the event's `demo` flag. Reads only the
   * options and calls Fakturownia (no table of this module is read, so it is
   * safe to call from any workflow or subscriber):
   *
   *   demo: true   a small generated PDF of the simulated document, with its
   *                number; no request leaves Medusa
   *   demo: false  the document number, then the PDF, from Fakturownia
   *
   * Throws `FakturowniaApiError` (from this package; check `code`) with
   * `PDF_NOT_READY` while Fakturownia has not rendered the PDF yet (a new
   * document, or a KSeF number on its way: try again in a minute),
   * `DEMO_MODE` when a live document is asked for in demo mode, `BAD_ID` for
   * an id that is not a number, `HTTP_404` when the document is not there.
   */
  async downloadPdf(input: { externalId: string; demo: boolean }): Promise<PdfDownload> {
    return fetchDocumentPdf({
      options: this.options_,
      client: () => {
        if (!this.client_) {
          this.client_ = new FakturowniaClient({
            token: this.options_.apiToken,
            account: this.options_.account,
            requestsPerMinute: this.options_.requestsPerMinute,
            timeoutMs: this.options_.timeoutMs,
            logger: this.logger_,
          })
        }
        return this.client_
      },
      externalId: String(input?.externalId ?? ""),
      demo: input?.demo === true,
    })
  }
}

export default FakturowniaModuleService
