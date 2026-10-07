/**
 * WHAT THE PROVIDER TOLD THIS PROCESS ABOUT ITSELF. Zero Medusa imports.
 *
 * The notification provider lives inside Medusa's notification module, where
 * the admin routes of this plugin cannot reach it. At boot Medusa calls its
 * static `validateOptions` with the provider options, and the provider
 * leaves a note here: that it is registered, with which channels and with
 * what options (as a fingerprint, the API key only as a hash). The admin
 * reads the note to say "the provider is wired" and "it got the same options
 * as the plugin", or what differs.
 *
 * The provider's own options stay in this process too, apart from the note:
 * a message with a secret in its data (a password reset link) is handed
 * straight to the provider's delivery with them (`sendDirect`), so the
 * secret never lands in Medusa's notification table. They never reach the
 * admin: `providerNote()` holds no option values.
 *
 * Per process: on a split deployment (server and worker) each process has
 * its own note, and the admin shows the server's.
 */

import { optionsFingerprint, resolveOptions, type EmailsMode, type EmailsPluginOptions } from "./options"

const NOTE_KEY = Symbol.for("koda.emails.provider")
const OPTIONS_KEY = Symbol.for("koda.emails.providerOptions")

export interface ProviderNote {
  loadedAt: string
  channels: string[]
  mode: EmailsMode
  fingerprint: Record<string, string>
}

type Holder = typeof globalThis & { [NOTE_KEY]?: ProviderNote; [OPTIONS_KEY]?: EmailsPluginOptions }

export function noteProvider(raw: EmailsPluginOptions | undefined | null): ProviderNote {
  const o = resolveOptions(raw)
  const note: ProviderNote = { loadedAt: new Date().toISOString(), channels: o.channels, mode: o.mode, fingerprint: optionsFingerprint(o) }
  const holder = globalThis as Holder
  holder[NOTE_KEY] = note
  holder[OPTIONS_KEY] = raw && typeof raw === "object" ? raw : {}
  return note
}

export function providerNote(): ProviderNote | null {
  return (globalThis as Holder)[NOTE_KEY] ?? null
}

/** The options the provider of this process was registered with (server side only), or null when it is not registered here. */
export function providerOptions(): EmailsPluginOptions | null {
  return (globalThis as Holder)[OPTIONS_KEY] ?? null
}

/** For the tests. */
export function forgetProvider(): void {
  const holder = globalThis as Holder
  delete holder[NOTE_KEY]
  delete holder[OPTIONS_KEY]
}
