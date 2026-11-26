/**
 * Constants of the AI Avatars module. ZERO IMPORTS on purpose: this file is
 * shared by the server and the admin bundle without a build step.
 */

/** Container key of the module service. */
export const AVATARS_MODULE = "avatars"

/* TABLE NAMES, namespaced. */
export const AVATAR_TABLE = "avatars_avatar"
export const PRESENTATION_TABLE = "avatars_presentation"
export const RENDER_JOB_TABLE = "avatars_render_job"

export const ID_PREFIX = {
  avatar: "avt",
  presentation: "avp",
  renderJob: "avr",
} as const

/* ------------------------------------------------------------------ */
/* Languages                                                           */
/* ------------------------------------------------------------------ */

export const LANGS = ["pl", "en", "de"] as const
export type Lang = (typeof LANGS)[number]

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ */
/* Consent                                                             */
/* ------------------------------------------------------------------ */

/**
 * The written consent of the person whose face and voice the avatar uses.
 * `none`: nothing on file, `signed`: a signed document is on file,
 * `revoked`: the person took it back. Only `signed` lets a render start.
 */
export const CONSENT_STATES = ["none", "signed", "revoked"] as const
export type ConsentState = (typeof CONSENT_STATES)[number]

export function isConsentState(value: unknown): value is ConsentState {
  return typeof value === "string" && (CONSENT_STATES as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ */
/* Presentations                                                       */
/* ------------------------------------------------------------------ */

/**
 * The life of a presentation, in order:
 *   draft         the source (a recording or a text) is in, nothing ran yet
 *   transcribing  the recording is being turned into text
 *   scripting     Claude writes the script, the slides and the quiz
 *   review        the script waits for edits and approval
 *   approved      the script is approved (its hash is stored)
 *   rendering     the avatar clips are being rendered
 *   ready         every clip is in, the presentation can be published
 *   published     visible to the host (e.g. a course page)
 *   failed        a step failed, the error says which
 */
export const PRESENTATION_STATES = ["draft", "transcribing", "scripting", "review", "approved", "rendering", "ready", "published", "failed"] as const
export type PresentationState = (typeof PRESENTATION_STATES)[number]

export function isPresentationState(value: unknown): value is PresentationState {
  return typeof value === "string" && (PRESENTATION_STATES as readonly string[]).includes(value)
}

/** States in which somebody has to act (edit, approve or retry). */
export const NEEDS_ACTION: readonly PresentationState[] = ["review", "failed"]

/** States in which a paid job is running. */
export const RUNNING: readonly PresentationState[] = ["transcribing", "scripting", "rendering"]
/** Presentations past the draft: their avatar cannot be deleted. */
export const AVATAR_LOCKING_STATES = ["approved", "transcribing", "scripting", "review", "rendering", "ready", "published"] as const satisfies readonly PresentationState[]

export const SOURCE_KINDS = ["recording", "text"] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === "string" && (SOURCE_KINDS as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ */
/* Render jobs                                                         */
/* ------------------------------------------------------------------ */

/**
 * One clip: `quoted` (its speech is ready and counted, nothing ordered),
 * `queued` (confirmed, waits for the order), `ordering` (the order is being
 * sent: a clip found here after a crash is never sent again), `rendering`
 * (ordered at Tavus), `ready` (the video is stored) or `failed` (the error
 * says why).
 */
export const RENDER_STATES = ["quoted", "queued", "ordering", "rendering", "ready", "failed"] as const
export type RenderState = (typeof RENDER_STATES)[number]

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const NAME_MAX = 120
export const TITLE_MAX = 160
export const URL_MAX = 2000
export const NOTE_MAX = 1000
/** About 60 minutes of speech: longer sources should be split into modules. */
export const SOURCE_TEXT_MAX = 60_000
export const LIST_MAX = 500
