import type { MedusaContainer } from "@medusajs/framework/types"
import { RUNNING } from "../../modules/avatars/lib/constants"
import { avatarsSvc, type Row } from "../../modules/avatars/lib/store"
import { presentationInput, type PresentationProblem } from "../../modules/avatars/lib/validation"
import type { Result } from "./avatars"

/**
 * The presentation flows of this stage: create from a text or a recording,
 * read one with its render jobs, delete. Transcription, the script and the
 * render come in later steps and move the state forward from `draft`.
 */

export async function findPresentation(container: MedusaContainer, id: string): Promise<Row | null> {
  const rows = await avatarsSvc(container).listAvatarsPresentations({ id }, { take: 1 })
  return rows[0] ?? null
}

export async function createPresentation(container: MedusaContainer, body: Record<string, unknown>, actor: string | null): Promise<Result<Row, PresentationProblem | "avatar_not_found">> {
  const svc = avatarsSvc(container)
  const input = presentationInput(body, svc.getOptions().defaultLang)
  if (!input.ok) return { ok: false, status: 400, problems: input.problems }
  if (input.values.avatar_id) {
    const avatar = await svc.listAvatarsAvatars({ id: input.values.avatar_id }, { take: 1 })
    if (avatar.length === 0) return { ok: false, status: 400, problems: ["avatar_not_found"] }
  }
  const [row] = await svc.createAvatarsPresentations([{ ...input.values, state: "draft", created_by: actor, demo: false }])
  return { ok: true, row }
}

export async function readPresentation(container: MedusaContainer, id: string): Promise<{ row: Row; jobs: Row[] } | null> {
  const row = await findPresentation(container, id)
  if (!row) return null
  const jobs = await avatarsSvc(container).listAvatarsRenderJobs({ presentation_id: id }, { take: 200 })
  return { row, jobs }
}

/** A running job (transcription, script, render) has to finish or fail first: its result would land on a deleted row. */
export async function deletePresentation(container: MedusaContainer, id: string): Promise<Result<{ id: string }, "not_found" | "running">> {
  const svc = avatarsSvc(container)
  const row = await findPresentation(container, id)
  if (!row) return { ok: false, status: 404, problems: ["not_found"] }
  if ((RUNNING as readonly string[]).includes(String(row.state))) return { ok: false, status: 409, problems: ["running"] }
  const jobs = await svc.listAvatarsRenderJobs({ presentation_id: id }, { take: 500 })
  if (jobs.length > 0) await svc.softDeleteAvatarsRenderJobs(jobs.map((j) => j.id))
  await svc.softDeleteAvatarsPresentations([id])
  return { ok: true, row: { id } }
}
