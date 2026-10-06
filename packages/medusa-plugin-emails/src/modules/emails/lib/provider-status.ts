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
 * Per process: on a split deployment (server and worker) each process has
 * its own note, and the admin shows the server's.
 */

import { optionsFingerprint, resolveOptions, type EmailsMode, type EmailsPluginOptions } from "./options"

const NOTE_KEY = Symbol.for("koda.emails.provider")

export interface ProviderNote {
  loadedAt: string
  channels: string[]
  mode: EmailsMode
  fingerprint: Record<string, string>
}

type Holder = typeof globalThis & { [NOTE_KEY]?: ProviderNote }

export function noteProvider(raw: EmailsPluginOptions | undefined | null): ProviderNote {
  const o = resolveOptions(raw)
  const note: ProviderNote = { loadedAt: new Date().toISOString(), channels: o.channels, mode: o.mode, fingerprint: optionsFingerprint(o) }
  ;(globalThis as Holder)[NOTE_KEY] = note
  return note
}

export function providerNote(): ProviderNote | null {
  return (globalThis as Holder)[NOTE_KEY] ?? null
}

/** For the tests. */
export function forgetProvider(): void {
  delete (globalThis as Holder)[NOTE_KEY]
}
