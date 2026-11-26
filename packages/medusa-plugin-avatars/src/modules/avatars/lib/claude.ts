/**
 * The script writer: one Claude call with the source text and the rules,
 * answered as JSON in the script's schema (structured output), streamed so
 * a long answer never hits the request timeout.
 *
 * A refused request falls back server side to the model Anthropic picks for
 * that kind of refusal; a refusal of the whole chain, a cut answer or JSON
 * that does not parse fail with a code the pipeline stores.
 */
import Anthropic from "@anthropic-ai/sdk"
import { maskSecrets } from "./options"
import { issueText, scriptJsonSchema, type ScriptIssue, type Targets } from "./script"

export class ClaudeError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "ClaudeError"
    this.code = code
  }
}

const LANG_NAME: Record<string, string> = { pl: "Polish", en: "English", de: "German" }

export type WriteInput = {
  title: string
  lang: string
  source: string
  minutes: number
  wordsPerMinute: number
  targets: Targets
  brief: string
  /** A previous answer and what was wrong with it, for the one correction round. */
  previous?: { raw: unknown; issues: ScriptIssue[] }
}

/** The writer's instructions. Store specific wishes come in through the brief, never hard coded here. */
export function systemPrompt(i: WriteInput): string {
  const lang = LANG_NAME[i.lang] ?? "the language of the source"
  return `You turn a lecture into a video lesson that an AI avatar presents: the avatar speaks a narration over slides, then the viewer takes a short quiz. The source is a transcript of a recording or a text written by the lecturer. A transcript comes from speech recognition: expect repetitions, digressions, technical chatter and misheard words.

You answer only with JSON in the given schema.

## The lesson
- Every text in ${lang}.
- Narration in total about ${i.targets.words} words (about ${i.minutes} minutes at ${i.wordsPerMinute} words a minute), ${i.targets.slidesMin} to ${i.targets.slidesMax} slides.
- One narration has 40 to 220 words. 4 to 8 quiz questions with 3 or 4 answers, \`correct\` is the index of the right one. 1 to 3 short versions of 40 to 100 words, each built on one slide (its id in \`slide\`), for a social media clip.

## Content
- Only facts from the source. No numbers, studies, names or advice that are not there. When something is unclear or looks misheard, leave it out and add a short line to \`notes\`.
- Keep the lecturer's own examples and images: they carry the lesson.
- Leave out organisation, technical chatter, private matters, names of participants and sales talk.
- The lesson has an arc: a problem from practice, the mechanisms in a logical order, one thought to remember at the end.
- In \`source\` of every slide, say briefly which part of the source it rests on (a paraphrase or a quote under 25 words), so a person can check it.

## Narration (what the avatar says)
- First person of the presenter, who does not pretend to be the lecturer and gives no name.
- Every sentence ends with a full stop, a question mark or an exclamation mark. Mostly short and medium sentences.
- No digits, percent signs, brackets, slashes or asterisks: write numbers, units and abbreviations the way they are spoken. No ellipsis, no long or medium dashes.
- The narration does not read the slide out: the slide shows the key words, the narration explains them.
- The first slide opens with one short greeting. Later slides do not greet again or announce the next slide. The last slide ends with one sentence of goodbye or an invitation to the quiz.

## Slides
- \`title\`: only the first slide. Kicker, the lesson title as heading, a lead of one or two sentences.
- \`question\`: a question or a thesis as heading, a highlighted quote, an optional note.
- \`points\`: 2 to 5 short points.
- \`cards\`: 2 or 3 cards with a title and a short text, an optional quote.
- \`compare\`: 2 to 4 pairs of before and after.
- Slide ids s01, s02 and so on in order, short version ids k01, k02. Never three slides in a row with the same layout.
- On slides: short words that fit a screen, never full narration sentences.${i.brief ? `\n\n## About this store and its audience\n${i.brief}` : ""}`
}

export function userMessage(i: WriteInput): string {
  const head = `Working title: ${i.title}\n\nSOURCE (${i.source.split(/\s+/).filter(Boolean).length} words):\n\n${i.source}`
  if (!i.previous) return head
  return `${head}\n\n---\nYour previous answer:\n${JSON.stringify(i.previous.raw)}\n\nIt breaks these rules. Fix them and return the whole script again:\n- ${i.previous.issues.map((x) => issueText(x, i.targets)).join("\n- ")}`
}

export type WriteResult = { raw: unknown; model: string; usage: { input_tokens: number; output_tokens: number } }

export async function writeScript(apiKey: string, model: string, input: WriteInput, client?: Anthropic): Promise<WriteResult> {
  const c = client ?? new Anthropic({ apiKey, maxRetries: 2, timeout: 20 * 60_000 })
  let message: Anthropic.Beta.BetaMessage
  try {
    message = await c.beta.messages
      .stream({
        model,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: scriptJsonSchema() } },
        system: systemPrompt(input),
        messages: [{ role: "user", content: userMessage(input) }],
      })
      .finalMessage()
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new ClaudeError(`http_${e.status ?? "error"}`, maskSecrets(e.message, [apiKey]))
    throw new ClaudeError("unavailable", maskSecrets(e instanceof Error ? e.message : String(e), [apiKey]))
  }
  if (message.stop_reason === "refusal") throw new ClaudeError("refused", "Claude declined to write this script")
  if (message.stop_reason === "max_tokens") throw new ClaudeError("truncated", "The script was cut at the output limit")
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("")
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ClaudeError("not_json", "The answer is not JSON")
  }
  return { raw, model: message.model, usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens } }
}
