/**
 * The script of a presentation: slides with the words the avatar says, a
 * quiz and short versions for campaigns. Claude writes it, the office edits
 * it slide by slide, the approval stores its hash.
 *
 * Two checks, on purpose apart:
 *   parseScript  the SHAPE (layouts, required fields, ids). A script that
 *                fails it is never stored.
 *   checkScript  the RULES (lengths, slide counts, characters a voice reads
 *                badly). A script that breaks them is stored with the issues
 *                listed, so a person can fix them; Claude gets them back
 *                once to correct itself.
 *
 * ZERO IMPORTS from the framework: the admin bundle shares the types.
 */

export const LAYOUTS = ["title", "question", "points", "cards", "compare"] as const
export type Layout = (typeof LAYOUTS)[number]

type Common = { id: string; kicker: string; heading: string; narration: string; source: string }

export type Slide =
  | (Common & { layout: "title"; lead: string })
  | (Common & { layout: "question"; quote: string; note?: string })
  | (Common & { layout: "points"; points: string[] })
  | (Common & { layout: "cards"; cards: Array<{ title: string; text: string }>; quote?: string })
  | (Common & { layout: "compare"; pairs: Array<{ before: string; after: string }>; note?: string })

export type QuizQuestion = { question: string; answers: string[]; correct: number; explanation: string }
export type Short = { id: string; title: string; narration: string; slide: string }

export type Script = {
  title: string
  slides: Slide[]
  quiz: QuizQuestion[]
  shorts: Short[]
  /** What the writer could not use or was unsure about, for the person who checks the facts. */
  notes: string[]
}

/** A finding of either check: a code the admin translates, where it is, and a number or text when it helps. */
export type ScriptIssue = { code: string; at: string; value?: number | string }

export type Targets = { words: number; slidesMin: number; slidesMax: number }

/** Words and slide counts for a target length at a speech rate. */
export function targetsFor(minutes: number, wordsPerMinute: number): Targets {
  const slidesMin = Math.max(5, Math.round(minutes * 0.7))
  const slidesMax = Math.min(20, Math.max(slidesMin + 2, Math.round(minutes * 1.3)))
  return { words: Math.round(minutes * wordsPerMinute), slidesMin, slidesMax }
}

export const words = (s: string): number => s.split(/\s+/).filter(Boolean).length

export const slideId = (i: number): string => `s${String(i + 1).padStart(2, "0")}`
export const shortId = (i: number): string => `k${String(i + 1).padStart(2, "0")}`

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const TEXT_MAX = 2000

/**
 * Reads untrusted JSON (Claude's answer, an edit from the admin) into a
 * Script: only known fields are kept, strings are trimmed. Returns every
 * shape problem at once.
 */
export function parseScript(raw: unknown): { ok: true; script: Script } | { ok: false; issues: ScriptIssue[] } {
  const issues: ScriptIssue[] = []
  const root = obj(raw)
  if (!root) return { ok: false, issues: [{ code: "not_object", at: "script" }] }

  const text = (o: Record<string, unknown>, key: string, at: string, optional = false): string => {
    const v = o[key]
    if (v === undefined || v === null || v === "") {
      if (!optional) issues.push({ code: "missing", at: `${at}.${key}` })
      return ""
    }
    if (typeof v !== "string") {
      issues.push({ code: "not_text", at: `${at}.${key}` })
      return ""
    }
    const t = v.trim()
    if (t.length > TEXT_MAX) issues.push({ code: "too_long", at: `${at}.${key}`, value: TEXT_MAX })
    if (!t && !optional) issues.push({ code: "missing", at: `${at}.${key}` })
    return t
  }
  const list = (o: Record<string, unknown>, key: string, at: string): unknown[] => {
    const v = o[key]
    if (v === undefined || v === null) return []
    if (!Array.isArray(v)) {
      issues.push({ code: "not_list", at: `${at}.${key}` })
      return []
    }
    return v
  }

  const title = text(root, "title", "script")
  const slides: Slide[] = []
  list(root, "slides", "script").forEach((s, i) => {
    const at = `slides[${i}]`
    const o = obj(s)
    if (!o) return issues.push({ code: "not_object", at })
    const layout = o.layout
    const common: Common = {
      id: text(o, "id", at),
      kicker: text(o, "kicker", at),
      heading: text(o, "heading", at),
      narration: text(o, "narration", at),
      source: text(o, "source", at, true),
    }
    if (layout === "title") slides.push({ ...common, layout, lead: text(o, "lead", at) })
    else if (layout === "question") {
      const note = text(o, "note", at, true)
      slides.push({ ...common, layout, quote: text(o, "quote", at), ...(note ? { note } : {}) })
    } else if (layout === "points") {
      const points = list(o, "points", at).map((p, j) => (typeof p === "string" ? p.trim() : (issues.push({ code: "not_text", at: `${at}.points[${j}]` }), "")))
      slides.push({ ...common, layout, points: points.filter(Boolean) })
    } else if (layout === "cards") {
      const cards = list(o, "cards", at).map((c, j) => {
        const co = obj(c) ?? {}
        return { title: text(co, "title", `${at}.cards[${j}]`), text: text(co, "text", `${at}.cards[${j}]`) }
      })
      const quote = text(o, "quote", at, true)
      slides.push({ ...common, layout, cards, ...(quote ? { quote } : {}) })
    } else if (layout === "compare") {
      const pairs = list(o, "pairs", at).map((c, j) => {
        const co = obj(c) ?? {}
        return { before: text(co, "before", `${at}.pairs[${j}]`), after: text(co, "after", `${at}.pairs[${j}]`) }
      })
      const note = text(o, "note", at, true)
      slides.push({ ...common, layout, pairs, ...(note ? { note } : {}) })
    } else issues.push({ code: "layout_unknown", at: `${at}.layout`, value: String(layout ?? "") })
  })
  if (slides.length === 0) issues.push({ code: "no_slides", at: "script.slides" })

  const quiz: QuizQuestion[] = list(root, "quiz", "script").map((q, i) => {
    const at = `quiz[${i}]`
    const o = obj(q) ?? {}
    /* Empty answers are refused, never dropped: dropping one would move the index of the right answer. */
    const answers = list(o, "answers", at).map((a, j) => {
      const v = typeof a === "string" ? a.trim() : ""
      if (!v) issues.push({ code: "missing", at: `${at}.answers[${j}]` })
      return v
    })
    const correct = typeof o.correct === "number" && Number.isInteger(o.correct) ? o.correct : -1
    if (correct < 0 || correct >= answers.length) issues.push({ code: "correct_invalid", at: `${at}.correct` })
    return { question: text(o, "question", at), answers, correct, explanation: text(o, "explanation", at) }
  })

  const shorts: Short[] = list(root, "shorts", "script").map((k, i) => {
    const at = `shorts[${i}]`
    const o = obj(k) ?? {}
    return { id: text(o, "id", at), title: text(o, "title", at), narration: text(o, "narration", at), slide: text(o, "slide", at) }
  })
  const notes = list(root, "notes", "script")
    .map((n) => (typeof n === "string" ? n.trim().slice(0, 500) : ""))
    .filter(Boolean)
    .slice(0, 20)

  if (issues.length) return { ok: false, issues }
  return { ok: true, script: { title, slides, quiz, shorts, notes } }
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

function screenTexts(s: Slide): string[] {
  const base = [s.kicker, s.heading, s.narration]
  switch (s.layout) {
    case "title":
      return [...base, s.lead]
    case "question":
      return [...base, s.quote, s.note ?? ""]
    case "points":
      return [...base, ...s.points]
    case "cards":
      return [...base, ...s.cards.flatMap((c) => [c.title, c.text]), s.quote ?? ""]
    case "compare":
      return [...base, ...s.pairs.flatMap((p) => [p.before, p.after]), s.note ?? ""]
  }
}

const COUNTS: Record<Layout, [string, number, number] | null> = {
  title: null,
  question: null,
  points: ["points", 2, 5],
  cards: ["cards", 2, 3],
  compare: ["pairs", 2, 4],
}

/** Dashes, ellipses and arrows look like machine text on a slide and break the voice's pauses. */
const BANNED: Array<[RegExp, string]> = [
  [new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]`), "dash"],
  [/\.\.\.|…/, "ellipsis"],
  [/→/, "arrow"],
]
/** A voice reads digits, percent signs, brackets, slashes and asterisks badly: the narration spells them out. */
const SPOKEN_BAD = /[\d%()/*]/

export function checkScript(script: Script, t: Targets): ScriptIssue[] {
  const issues: ScriptIssue[] = []
  const n = script.slides.length
  if (n < t.slidesMin || n > t.slidesMax) issues.push({ code: "slide_count", at: "slides", value: n })
  if (script.quiz.length < 4 || script.quiz.length > 8) issues.push({ code: "quiz_count", at: "quiz", value: script.quiz.length })
  if (script.shorts.length > 3) issues.push({ code: "shorts_count", at: "shorts", value: script.shorts.length })

  script.slides.forEach((s, i) => {
    if (s.id !== slideId(i)) issues.push({ code: "id_order", at: `slides[${i}].id`, value: slideId(i) })
    if (i === 0 && s.layout !== "title") issues.push({ code: "first_not_title", at: `slides[0].layout` })
    if (i > 0 && s.layout === "title") issues.push({ code: "title_not_first", at: `slides[${i}].layout` })
    const c = COUNTS[s.layout]
    if (c) {
      const len = ((s as Record<string, unknown>)[c[0]] as unknown[]).length
      if (len < c[1] || len > c[2]) issues.push({ code: "items_count", at: `slides[${i}].${c[0]}`, value: len })
    }
    if (i >= 2 && script.slides[i - 2].layout === s.layout && script.slides[i - 1].layout === s.layout) issues.push({ code: "layout_repeat", at: `slides[${i}].layout`, value: s.layout })
    for (const text of screenTexts(s)) for (const [re, code] of BANNED) if (re.test(text)) issues.push({ code, at: `slides[${i}]` })
    const bad = s.narration.match(SPOKEN_BAD)
    if (bad) issues.push({ code: "spoken_char", at: `slides[${i}].narration`, value: bad[0] })
    const w = words(s.narration)
    if (w < 40 || w > 220) issues.push({ code: "narration_words", at: `slides[${i}].narration`, value: w })
  })
  const total = script.slides.reduce((a, s) => a + words(s.narration), 0)
  if (total < t.words * 0.7 || total > t.words * 1.3) issues.push({ code: "total_words", at: "slides", value: total })

  const ids = new Set(script.slides.map((s) => s.id))
  script.shorts.forEach((k, i) => {
    if (!ids.has(k.slide)) issues.push({ code: "short_slide", at: `shorts[${i}].slide`, value: k.slide })
    const bad = k.narration.match(SPOKEN_BAD)
    if (bad) issues.push({ code: "spoken_char", at: `shorts[${i}].narration`, value: bad[0] })
    const w = words(k.narration)
    if (w < 40 || w > 100) issues.push({ code: "short_words", at: `shorts[${i}].narration`, value: w })
  })
  script.quiz.forEach((q, i) => {
    if (q.answers.length < 3 || q.answers.length > 4) issues.push({ code: "answers_count", at: `quiz[${i}].answers`, value: q.answers.length })
    for (const text of [q.question, ...q.answers, q.explanation]) for (const [re, code] of BANNED) if (re.test(text)) issues.push({ code, at: `quiz[${i}]` })
  })
  return issues
}

/** An issue as an English line, for Claude's correction round and for logs. */
export function issueText(i: ScriptIssue, t: Targets): string {
  const v = i.value === undefined ? "" : ` (${i.value})`
  const why: Record<string, string> = {
    slide_count: `needs ${t.slidesMin} to ${t.slidesMax} slides`,
    quiz_count: "needs 4 to 8 quiz questions",
    shorts_count: "at most 3 short versions",
    id_order: "slide ids go s01, s02, ... in order",
    first_not_title: "the first slide has the title layout",
    title_not_first: "the title layout only on the first slide",
    items_count: "points 2 to 5, cards 2 to 3, pairs 2 to 4",
    layout_repeat: "no three slides in a row with the same layout",
    dash: "no long or medium dashes",
    ellipsis: "no ellipsis",
    arrow: "no arrows",
    spoken_char: "spell out digits and symbols in the narration",
    narration_words: "a slide narration has 40 to 220 words",
    total_words: `the narrations add up to about ${t.words} words`,
    short_slide: "a short version points to an existing slide id",
    short_words: "a short version narration has 40 to 100 words",
    answers_count: "3 or 4 answers per question",
  }
  return `${i.at}: ${why[i.code] ?? i.code}${v}`
}

/* ------------------------------------------------------------------ */
/* JSON Schema for Claude's structured output                          */
/* ------------------------------------------------------------------ */

const S = { type: "string" } as const
const strings = { type: "array", items: S } as const
const closed = (properties: Record<string, unknown>, optional: string[] = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
})
const common = { id: S, kicker: S, heading: S, narration: S, source: S }

/**
 * The shape as JSON Schema. Counts and lengths are left to checkScript: the
 * structured output grammar does not take array or string bounds.
 */
export function scriptJsonSchema(): Record<string, unknown> {
  return closed({
    title: S,
    slides: {
      type: "array",
      items: {
        anyOf: [
          closed({ layout: { type: "string", enum: ["title"] }, ...common, lead: S }),
          closed({ layout: { type: "string", enum: ["question"] }, ...common, quote: S, note: S }, ["note"]),
          closed({ layout: { type: "string", enum: ["points"] }, ...common, points: strings }),
          closed({ layout: { type: "string", enum: ["cards"] }, ...common, cards: { type: "array", items: closed({ title: S, text: S }) }, quote: S }, ["quote"]),
          closed({ layout: { type: "string", enum: ["compare"] }, ...common, pairs: { type: "array", items: closed({ before: S, after: S }) }, note: S }, ["note"]),
        ],
      },
    },
    quiz: { type: "array", items: closed({ question: S, answers: strings, correct: { type: "integer" }, explanation: S }) },
    shorts: { type: "array", items: closed({ id: S, title: S, narration: S, slide: S }) },
    notes: strings,
  })
}

/* ------------------------------------------------------------------ */
/* Hash                                                                */
/* ------------------------------------------------------------------ */

/** Key-sorted JSON: the same script always gives the same text, whatever order the keys came in. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(v)
}
