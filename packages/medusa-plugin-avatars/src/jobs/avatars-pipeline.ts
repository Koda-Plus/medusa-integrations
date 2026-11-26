import type { MedusaContainer } from "@medusajs/framework/types"
import { avatarsSvc } from "../modules/avatars/lib/store"
import { runPipeline } from "../workflows/avatars/script"

/**
 * TRANSCRIPTION AND SCRIPT, EVERY MINUTE: at most two presentations a run,
 * one step each, under a lease written before the paid call. Nothing runs
 * without keys outside demo mode.
 */
export default async function avatarsPipelineJob(container: MedusaContainer): Promise<void> {
  const svc = avatarsSvc(container)
  const c = svc.configured()
  if (!svc.isDemo() && !c.claude && !c.gemini) return
  await runPipeline(container)
}

export const config = {
  name: "avatars-pipeline",
  schedule: "* * * * *",
}
