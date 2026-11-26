import type { MedusaContainer } from "@medusajs/framework/types"
import { avatarsSvc } from "../../modules/avatars/lib/store"

/**
 * Demo data: one avatar with a sample consent and one presentation in review
 * with a short script, all flagged `demo`. Only in demo mode, only once
 * (a second call finds the rows and does nothing). Fictional names only.
 */

export const DEMO_SCRIPT = {
  title: "Workplace safety basics",
  slides: [
    {
      id: "s01",
      layout: "title",
      kicker: "Lesson 1",
      heading: "Workplace safety basics",
      lead: "What to do in the first minutes of an emergency at work.",
      narration: "Welcome to the first lesson. Today we look at the first minutes of an emergency at work: who to call, where to go and what to leave behind.",
    },
    {
      id: "s02",
      layout: "points",
      kicker: "Fire alarm",
      heading: "Three steps when the alarm sounds",
      points: ["Stop the work", "Take the nearest exit", "Meet at the assembly point"],
      narration: "When the alarm sounds, stop what you are doing, take the nearest marked exit and go straight to the assembly point, without your things.",
    },
  ],
  quiz: [
    {
      question: "Where do you go when the fire alarm sounds?",
      answers: ["Back to your desk", "The assembly point", "The lift"],
      correct: 1,
      explanation: "Everyone meets at the assembly point, so nobody is missing.",
    },
  ],
  shorts: [],
}

export async function seedDemo(container: MedusaContainer): Promise<{ created: boolean }> {
  const svc = avatarsSvc(container)
  if (!svc.isDemo()) return { created: false }
  const existing = await svc.listAvatarsAvatars({ demo: true }, { take: 1 })
  if (existing.length > 0) return { created: false }
  const [avatar] = await svc.createAvatarsAvatars([
    {
      name: "Demo presenter",
      provider: "tavus",
      face_id: "demo-face",
      voice: svc.getOptions().defaultVoice,
      consent_state: "signed",
      consent_file_url: "https://example.com/demo-consent.pdf",
      consent_signed_by: "Jane Example",
      consent_signed_at: new Date("2026-01-15T10:00:00Z"),
      consent_note: "Sample consent of the demo mode.",
      demo: true,
    },
  ])
  await svc.createAvatarsPresentations([
    {
      title: DEMO_SCRIPT.title,
      lang: "en",
      state: "review",
      source_kind: "text",
      source_text: "A short sample lecture about workplace safety, used by the demo mode.",
      target_minutes: 2,
      avatar_id: avatar.id,
      script: DEMO_SCRIPT,
      script_hash: "demo",
      demo: true,
    },
  ])
  return { created: true }
}
