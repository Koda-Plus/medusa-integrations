# AI Avatars by Koda Plus

Lessons with an AI avatar, made and published from the Medusa admin. A recorded lecture or a text becomes a script with slides and a quiz; the script becomes a video in which an avatar speaks it. The office corrects the script slide by slide, approves it, watches the result and publishes it.

An avatar uses a real person's face and voice. The plugin keeps the person's written consent next to every avatar and refuses to render without it: the signed document, who signed it and when. Revoking the consent stops the renders at once and keeps the record.

This is the first release: the avatars with their consent, the presentations and the admin page. Transcription, the script, the render and the lesson page in the storefront come in the next versions.

## What it does

- **Avatars with consent**: the name, the Tavus face and the voice, with the signed consent document uploaded through the store's file provider. A new face resets the consent.
- **Presentations**: a recording or a text, the language (Polish, English, German) and the target length in minutes. Every presentation starts as a draft; nothing paid runs before approval.
- **The minutes first**: the script's length is estimated from its words and the configured speech rate, so the cost is visible before a render is confirmed.

## Features

- **One page in the admin**: the counters, the presentations with their state, the avatars with their consent, in English and Polish.
- **Demo mode** (`demo: true`): a sample avatar and presentation, flagged `demo`. Nothing is sent to Tavus, Anthropic or Gemini.
- **The koda.integration/1 contract**: the board counters of failed presentations, scripts waiting for approval and avatars without a signed consent.

## Requirements

- Medusa 2.12 to 2.21 and Node.js 20+ (see Compatibility).
- Postgres, as every Medusa store has, and a file provider (R2, S3 or local) for the consent documents and the recordings.
- For the later steps: a Tavus account, an Anthropic API key and a Gemini API key.

## Installation

```bash
npm install @koda-plus/medusa-plugin-avatars
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-avatars` or `pnpm add @koda-plus/medusa-plugin-avatars`.

## Configuration

Add the plugin to `medusa-config.ts`. The keys come from the environment only, never from code:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-avatars",
      options: {
        tavusApiKey: process.env.TAVUS_API_KEY,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        geminiApiKey: process.env.GEMINI_API_KEY,
        defaultVoice: "Kore",
        defaultLang: "en",
        demo: process.env.AVATARS_DEMO === "true",
      },
    },
  ],
})
```

Run the migrations, then open **AI Avatars** in the admin sidebar:

```bash
npx medusa db:migrate
```

The migration creates three tables of the module: `avatars_avatar`, `avatars_presentation` and `avatars_render_job`.

### Options

Every option has a default, so the plugin starts without any. A missing key turns off only the step that needs it.

- **demo** (boolean, default `false`): demo mode. A sample avatar and presentation, flagged `demo`.
- **tavusApiKey**, **anthropicApiKey**, **geminiApiKey** (string): the keys of the render, the script and the voice. The admin shows whether a key is set, never the key; errors are masked.
- **claudeModel** (string, default `claude-opus-5-5`): the model that writes the script.
- **ttsModel** (string, default `gemini-3.8-flash-tts`): the voice model.
- **transcribeModel** (string, default `gemini-3.8-flash`): the transcription model.
- **defaultVoice** (string, default `Kore`) and **defaultLang** (`pl`, `en` or `de`, default `pl`).
- **wordsPerMinute** (number, default `135`): the speech rate behind the minute estimate.
- **maxRenderMinutes** (number, default `30`): the most minutes one render may take.
- **filePrefix** (string, default `avatars/`): the prefix of the files the plugin stores.

## Admin API

- `GET /admin/avatars` - the keys set (never the keys), the options, the counters, the avatars and the presentations.
- `POST /admin/avatars/avatars` - a new avatar (`{ name, face_id, voice? }`), without consent.
- `POST /admin/avatars/avatars/:id` - changes an avatar; a new face resets the consent. `DELETE` refuses while a rendering or published presentation uses it.
- `POST /admin/avatars/avatars/:id/consent` - records the written consent (`{ file_url, signed_by, signed_at, note? }`). `DELETE` revokes it and keeps the record.
- `POST /admin/avatars/presentations` - a new presentation in `draft` (`{ title, lang?, source_kind, source_text? | source_file_url?, target_minutes?, avatar_id? }`).
- `GET /admin/avatars/presentations/:id` - the presentation with its source, script and render jobs. `DELETE` refuses while a job runs.
- `POST /admin/avatars/demo/seed` - the sample rows, only in demo mode.
- `GET /admin/avatars/integration`, `/integration/summary`, `/integration/attention` - the koda.integration/1 answers.

Writes need the `x-koda-request: 1` header, which the admin sends.

## Compatibility

Medusa 2.12 through 2.21. The admin extension mounts through the Medusa admin SDK; the plugin's admin libraries are optional peers, so the app keeps the dashboard's own copies.

## License

[MIT](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-avatars/LICENSE)
