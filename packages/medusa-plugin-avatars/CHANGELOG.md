# Changelog

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
