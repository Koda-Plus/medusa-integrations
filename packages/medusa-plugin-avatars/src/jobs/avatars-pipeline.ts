import type { MedusaContainer } from "@medusajs/framework/types"
import { avatarsSvc } from "../modules/avatars/lib/store"
import { runRender } from "../workflows/avatars/render"
import { runPipeline } from "../workflows/avatars/script"

/**
 * EVERY MINUTE: the transcription and the script (at most two presentations
 * a run, one step each), then the render (a few orders, the clips at Tavus,
 * the presentations whose clips are all in). Every paid call sits under a
 * lease written before it. Nothing runs without keys outside demo mode.
 */
export default async function avatarsPipelineJob(container: MedusaContainer): Promise<void> {
  const svc = avatarsSvc(container)
  const c = svc.configured()
  const demo = svc.isDemo()
  if (demo || c.claude || c.gemini) await runPipeline(container)
  if (demo || c.tavus) await runRender(container)
}

export const config = {
  name: "avatars-pipeline",
  schedule: "* * * * *",
}
