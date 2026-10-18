# Changelog

## 0.2.0 (unreleased)

The first release on npm: the newsletter of a Medusa v2 store on the Kit list (kit.com, formerly ConvertKit). Version 0.1.0 lived only in the repository and was never published. Run `npx medusa db:migrate` after installing: one migration (`Migration20261011100000`) adds the subscription log and the settings tables.

### Storefront

- `POST /store/kit/subscribe` `{ email, first_name?, source? }`: the newsletter form. The e-mail becomes a Kit subscriber (an upsert by address), gets the tags of the settings, and with double opt-in on is created `inactive` and added to the double opt-in form, so Kit sends the confirmation e-mail. Answers `{ ok, configured, status: "subscribed" | "confirmation_sent", already }`.
- Exactly once by construction: Kit's create is an upsert by e-mail and tagging answers 200 when the tag is already there, so a repeated sign-up changes nothing on the list. One tag or the form failing never loses the subscription.
- Public, with Medusa's publishable key, rate limited in memory to 5 sign-ups per 10 minutes per client IP, and polite while the key is missing (`ok: false, configured: false`, no error).
- Tags by sign-up source: the storefront sends a `source` (for example `drop` for a "notify me about the next drop" button); a source configured in the admin adds its own tags to the general ones.

### Orders

- Tags for buyers on `order.placed`: an address that is ALREADY an active subscriber gets the buyer tags and, when switched on, one tag per bought product (`<prefix><product title>`, created in Kit when missing, prefix `Bought: ` by default and set in the admin). An order never subscribes anyone, and an address that waits for confirmation is left alone. A canceled order, a missing key or Kit being down never fail the order: the log row and the server log say so.

### Admin

- The Kit page (`/app/kit`) with a Panel and a Setup guide: the counters of the subscription log (subscribers from the store, failed sign-ups, sign-ups in the last 7 days), the connection check (the account, its tags and forms), the list in numbers (active subscribers, new and unsubscribed in 30 days, net change and open and click rates over 90 days), the newest broadcasts with recipients, opens, clicks and unsubscribes, the list settings (tags, double opt-in, the form), tags by source and for buyers, and the subscription log with every attempt.
- The Kit numbers are read only and cached for ten minutes per process (`?fresh=1` asks Kit again).
- Settings are key and value rows in the plugin's own table, over the options: the options give the defaults, the admin overrides them. Every tag and form id is checked against the account before it is saved.
- Admin routes: `GET /admin/kit`, `GET /admin/kit/check`, `GET /admin/kit/tags`, `GET /admin/kit/forms`, `GET` and `POST /admin/kit/settings` (`tags`, `form_id`, `double_opt_in`, `source_tags`, `buyer_tags`, `product_tags`, `product_tag_prefix`), `GET /admin/kit/subscribers`, `GET /admin/kit/overview`, `GET /admin/kit/broadcasts`.
- Admin in English and Polish.

### Contract and house rules

- The koda.integration/1 contract: the manifest, the customer summary (the subscriber's state in Kit, looked up by the customer's e-mail) and the board counter of failed sign-ups in the last 7 days.
- One HTTP client for the Kit API v4, the key only in the `X-Kit-Api-Key` header, masked in every log, error and admin screen (`***` and the last 4 characters); a self-imposed limit of 90 requests a minute under Kit's 120.
- Missing options never break the boot; without a key the plugin says "Not configured" and sends nothing. There is no demo mode.
- Writes under `/admin/kit` take a JSON body or the `x-koda-request` header; every GET route only reads.
