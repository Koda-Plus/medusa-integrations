/**
 * What the store sees of a published presentation: the slides (screen texts
 * and layout), the quiz, the short versions and the clip of each. Built
 * field by field on purpose: the source of a slide, the office notes and
 * who approved what never leave the admin, even when the script gains new
 * fields. The quiz keeps its correct answer and explanation: the lesson page
 * checks the answers itself.
 */
import type { StoreClipDto, StorePresentationDto } from "./contract"
import { isLang } from "./constants"
import { parseScript, type Slide } from "./script"
import { iso, num, str, type Row } from "./store"

const clipOf = (jobs: Row[], itemId: string): StoreClipDto | null => {
  const j = jobs.find((x) => x.item_id === itemId && x.state === "ready" && str(x.video_url))
  return j ? { item_id: itemId, video_url: str(j.video_url), duration_ms: typeof j.duration_ms === "number" ? j.duration_ms : null } : null
}

/** The screen of one slide, without its `source`. The narration stays: it is the transcript under the video. */
export function storeSlide(s: Slide): Record<string, unknown> & { id: string } {
  const base = { id: s.id, layout: s.layout, kicker: s.kicker, heading: s.heading, narration: s.narration }
  switch (s.layout) {
    case "title":
      return { ...base, lead: s.lead }
    case "question":
      return { ...base, quote: s.quote, ...(s.note ? { note: s.note } : {}) }
    case "points":
      return { ...base, points: [...s.points] }
    case "cards":
      return { ...base, cards: s.cards.map((c) => ({ title: c.title, text: c.text })), ...(s.quote ? { quote: s.quote } : {}) }
    case "compare":
      return { ...base, pairs: s.pairs.map((p) => ({ before: p.before, after: p.after })), ...(s.note ? { note: s.note } : {}) }
  }
}

export function toStorePresentation(row: Row, jobs: Row[]): StorePresentationDto | null {
  const parsed = parseScript(row.script)
  if (!parsed.ok) return null
  const s = parsed.script
  const ms = jobs.filter((j) => j.state === "ready" && s.slides.some((x) => x.id === j.item_id)).reduce((a, j) => a + num(j.duration_ms), 0)
  return {
    id: row.id,
    title: str(row.title) ?? s.title,
    lang: isLang(row.lang) ? row.lang : "pl",
    published_at: iso(row.published_at),
    minutes: Math.round(ms / 6000) / 10,
    slides: s.slides.map((slide) => ({ ...storeSlide(slide), clip: clipOf(jobs, slide.id) })),
    quiz: s.quiz.map((q) => ({ question: q.question, answers: [...q.answers], correct: q.correct, explanation: q.explanation })),
    shorts: s.shorts.map((k) => ({ id: k.id, title: k.title, clip: clipOf(jobs, k.id) })),
  }
}

export function toStoreListItem(row: Row): { id: string; title: string; lang: string; published_at: string | null } {
  return { id: row.id, title: str(row.title) ?? row.id, lang: isLang(row.lang) ? row.lang : "pl", published_at: iso(row.published_at) }
}
