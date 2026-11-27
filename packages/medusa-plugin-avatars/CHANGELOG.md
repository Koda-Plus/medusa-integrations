# Changelog

## 0.3.0 (2026-11-27)

### Added

- The render: a quote that makes and measures the speech of every clip and shows the exact Tavus minutes, a confirmation of exactly that quote, and the background job that orders each clip once, follows it, stores the finished clip through the file provider and deletes the speech.
- A clip signature (text, face, voice, speech model, voice style): only changed clips are ordered again, rendered ones and made speech are kept across quotes.
- Safety before paying: the consent is checked at the quote, at the confirmation (its document must answer) and before every order; speech files must be public https; the minutes are capped by `maxRenderMinutes`.
- Publishing and the store API: `GET /store/avatars/presentations` and `/:id` with the slides, their clips, the quiz and the short versions of published presentations only.
- Paying twice is guarded: a clip goes to `ordering` before the order, a clip left there fails as `order_unknown` and is never sent again; a quote flags such clips as `risky` and the confirmation needs `acknowledge_risky`. The run and each quote hold a lock of the Locking Module; a unique index keeps one clip row per slide.
- Nothing waits forever: a deadline of 4 hours per clip, a stall rule for the generation only, a limit of failed downloads, and `POST /admin/avatars/presentations/:id/render/cancel`.
- Publishing needs every clip ready and a valid consent; the store API hides presentations whose avatar lost its consent and never sends the source of a slide.
- The video section of the presentation page: count the minutes, confirm (with the warning for risky clips), follow the clips, watch them, stop the render, publish or hide.

### Changed

- Deleting a presentation deletes its speech and clip files.
- Saving a script answers with the render jobs (it answered with none).
- Writing the script again is refused once it is approved: a failed render keeps the approval.

## 0.2.0 (2026-11-26)

### Added

- From a recording or a text to a script: the Gemini transcription (Files API, size capped, the file deleted afterwards) and the Claude script with slides, narration, a quiz and short versions, as structured output.
- Writing rules checked on every script (counts, order, layouts, dashes, digits in speech, words per narration); one correction round, then the script goes to review with what is left listed.
- The background job `avatars-pipeline`: one step at a time, a lease before any paid call, retries for busy answers, final failures with the reason.
- The presentation page in the admin: the slide editor per layout, the quiz and the short versions, listening to a narration in the avatar's voice, save, approve with the minutes shown.
- Options `scriptBrief`, `voiceStyle` and `maxSourceMb`.

### Changed

- The default transcription model is `gemini-3.5-transcribe`.
- `@anthropic-ai/sdk` is a peer dependency.

## 0.1.0 (2026-11-26)

### Added

- The first release: avatars (the name, the Tavus face, the voice) with the person's written consent on record, and presentations from a recording or a text in Polish, English or German.
- The consent rule: no render without a signed document, the signer and the date; revoking stops renders and keeps the record; a new face resets the consent.
- One page in the admin with the counters, the presentations and the avatars, the consent form with the document upload, a setup guide and the options in use, in English and Polish.
- The koda.integration/1 contract with the board counters of failed presentations, scripts waiting for approval and avatars without consent.
- Demo mode with a sample avatar and presentation, flagged `demo`.
