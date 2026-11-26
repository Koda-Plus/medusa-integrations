import type { MedusaContainer } from "@medusajs/framework/types"
import { AVATAR_LOCKING_STATES, LIST_MAX } from "../../modules/avatars/lib/constants"
import { signConsent, type ConsentInput, type ConsentProblem } from "../../modules/avatars/lib/consent"
import { avatarsSvc, type Row } from "../../modules/avatars/lib/store"
import { avatarInput, type AvatarProblem } from "../../modules/avatars/lib/validation"

/**
 * The avatar flows: create, edit, record or revoke the consent, delete.
 * Each returns either the row or the problems the admin shows next to the
 * fields; nothing here calls an outside service.
 */

export type Result<T, P extends string> = { ok: true; row: T } | { ok: false; status: 400 | 404 | 409; problems: P[] }

async function findAvatar(container: MedusaContainer, id: string): Promise<Row | null> {
  const rows = await avatarsSvc(container).listAvatarsAvatars({ id }, { take: 1 })
  return rows[0] ?? null
}

export async function createAvatar(container: MedusaContainer, body: Record<string, unknown>): Promise<Result<Row, AvatarProblem>> {
  const svc = avatarsSvc(container)
  const input = avatarInput(body, svc.getOptions().defaultVoice)
  if (!input.ok) return { ok: false, status: 400, problems: input.problems }
  const [row] = await svc.createAvatarsAvatars([{ ...input.values, provider: "tavus", consent_state: "none", demo: false }])
  return { ok: true, row }
}

/**
 * Edits the name, the face or the voice. Changing the face or the voice of
 * an avatar with a signed consent resets the consent to `none`: the document
 * was signed for the old face and voice.
 */
export async function updateAvatar(container: MedusaContainer, id: string, body: Record<string, unknown>): Promise<Result<Row, AvatarProblem | "not_found">> {
  const svc = avatarsSvc(container)
  const current = await findAvatar(container, id)
  if (!current) return { ok: false, status: 404, problems: ["not_found"] }
  const input = avatarInput({ name: current.name, face_id: current.face_id, voice: current.voice, ...body }, svc.getOptions().defaultVoice)
  if (!input.ok) return { ok: false, status: 400, problems: input.problems }
  const changed = input.values.face_id !== current.face_id || input.values.voice !== current.voice
  const patch: Record<string, unknown> = { id, ...input.values }
  if (changed && current.consent_state === "signed") patch.consent_state = "none"
  const [row] = await svc.updateAvatarsAvatars([patch])
  return { ok: true, row }
}

export async function recordConsent(container: MedusaContainer, id: string, body: ConsentInput, actor: string | null, now = new Date()): Promise<Result<Row, ConsentProblem | "not_found">> {
  const current = await findAvatar(container, id)
  if (!current) return { ok: false, status: 404, problems: ["not_found"] }
  const signed = signConsent(body, actor, now)
  if (!signed.ok) return { ok: false, status: 400, problems: signed.problems }
  const [row] = await avatarsSvc(container).updateAvatarsAvatars([{ id, ...signed.patch }])
  return { ok: true, row }
}

/** Revoking keeps the file, the names and the dates; only the state changes, and renders stop. */
export async function revokeConsent(container: MedusaContainer, id: string, actor: string | null): Promise<Result<Row, "not_found">> {
  const current = await findAvatar(container, id)
  if (!current) return { ok: false, status: 404, problems: ["not_found"] }
  const [row] = await avatarsSvc(container).updateAvatarsAvatars([{ id, consent_state: "revoked", consent_recorded_by: actor }])
  return { ok: true, row }
}

/**
 * An avatar stays while a presentation past the draft uses it (approved,
 * running, ready or published): deleting it would orphan the script or the
 * videos. Drafts and failed presentations let it go and lose the link.
 */
export async function deleteAvatar(container: MedusaContainer, id: string): Promise<Result<{ id: string }, "not_found" | "in_use">> {
  const svc = avatarsSvc(container)
  const current = await findAvatar(container, id)
  if (!current) return { ok: false, status: 404, problems: ["not_found"] }
  const using = await svc.listAvatarsPresentations({ avatar_id: id, state: [...AVATAR_LOCKING_STATES] }, { take: 1 })
  if (using.length > 0) return { ok: false, status: 409, problems: ["in_use"] }
  const loose = await svc.listAvatarsPresentations({ avatar_id: id }, { take: LIST_MAX })
  if (loose.length > 0) await svc.updateAvatarsPresentations(loose.map((p) => ({ id: p.id, avatar_id: null })))
  await svc.softDeleteAvatarsAvatars([id])
  return { ok: true, row: { id } }
}
