/**
 * The public API for a store that keeps its OWN e-mail provider (app mode,
 * `appProvider` in the options): the provider reports what it sent, and the
 * plugin's page lists it.
 *
 *   import { recordAppEmail } from "@koda-plus/medusa-plugin-emails/app"
 *
 * See `recordAppEmail` for a provider that does it.
 */
export { recordAppEmail, appEmailRow } from "./modules/emails/lib/app-record"
export type { AppEmailReport } from "./modules/emails/lib/app-record"
