# Kit by Koda Plus

The newsletter of a Medusa v2 store on the Kit list (Kit, formerly ConvertKit): the storefront form subscribes customers straight into Kit, with tags and double opt-in, and the admin shows the account, the list settings and the subscription log.

- **The store form** (`POST /store/kit/subscribe`): an e-mail (and optionally a first name) becomes a subscriber. Kit's create is an upsert by e-mail and tagging answers 200 when the tag is already there, so a repeated sign-up changes nothing on the list - exactly once by construction. The route is public with a limit of 5 sign-ups per 10 minutes per address and answers politely while the key is missing.
- **Double opt-in**: with the switch on, the subscriber is created in the `inactive` state and added to the chosen form, which makes Kit send the confirmation e-mail.
- **Tags**: picked in the admin from the account's tags, applied to every new subscriber.
- **The panel** (`/app/kit`): the connection check, the list settings, the subscription log with every attempt and a setup guide.
- **The contract** (`koda.integration/1`): the manifest, the customer summary (the subscriber's state, looked up by the customer's e-mail) and the failed-sign-up counter.
- Missing options never break the boot, the key stays on the server and is masked in every log, error and admin screen, and demo rows never appear: without a key the plugin says "Not configured" and sends nothing.

## Install

```bash
npm install @koda-plus/medusa-plugin-kit
```

Register it in `medusa-config.ts`:

```ts
plugins: [
  {
    resolve: "@koda-plus/medusa-plugin-kit",
    options: {
      // Everything is optional.
      apiKey: process.env.KIT_API_KEY,
      source: "StonerChef",
    },
  },
]
```

Run the migrations, then open the panel. The API key is a Kit V4 API key (Kit: Settings, Developer, API keys); Kit allows 120 requests per rolling 60 seconds per key, the plugin stays under it.

## The store route

```bash
curl -X POST https://your-backend/store/kit/subscribe \
  -H "Content-Type: application/json" \
  -H "x-publishable-api-key: pk_..." \
  -d '{"email": "klient@example.com", "first_name": "Anna", "source": "form"}'
```

Answers: `{ ok, configured, status: "subscribed" | "confirmation_sent", already }`, with `ok: false` and `configured: false` while the key is missing, 400 for a bad e-mail, 429 past the limit.

## Security and the house rules

- One HTTP client, the Kit API v4 only, the key only in the `X-Kit-Api-Key` header; masked in logs, errors and the admin (the panel shows `***<last 4>`).
- Reads do not write: every GET route only reads, and writes under `/admin/kit` stand behind the write guard.
- The subscribe flow logs every attempt, so the team sees exactly what Kit answered, also when it was down.

## License

MIT, see [LICENSE](LICENSE). Built and maintained by [Koda Plus](https://koda.plus).

Kit, ConvertKit and Medusa are trademarks of their owners, used only to identify the systems this plugin connects to. This is an independent integration, not affiliated with or endorsed by them.
