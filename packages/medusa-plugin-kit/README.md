# Kit by Koda Plus

The newsletter of a Medusa v2 store on **Kit** (kit.com, the e-mail marketing service formerly called ConvertKit). The storefront form subscribes customers straight into the store's Kit account, with tags and double opt-in; buyers who are already on the list get tags for what they bought; and the Medusa admin shows the account, the list in numbers, the newest broadcasts, the list settings and a log of every sign-up. The Kit API key never reaches a browser.

The plugin does not send newsletters itself and keeps no copy of the list: Kit stays the list and the sender, Medusa adds the subscribers and the tags.

## What it does

- **The storefront form** (`POST /store/kit/subscribe`): an e-mail address, and optionally a first name and a source, becomes a Kit subscriber with the tags of the settings. Kit's create is an upsert by e-mail and tagging answers 200 when the tag is already there, so a repeated sign-up changes nothing on the list: exactly once by construction.
- **Double opt-in**: with the switch on, the subscriber is created in the `inactive` state and added to the chosen double opt-in form, and Kit sends the confirmation e-mail. Without it the subscriber is `active` at once.
- **Tags**: picked in the admin from the account's tags, applied to every new subscriber.
- **Tags by source**: the storefront sends a `source` with each sign-up (for example `drop` for a "notify me about the next drop" button); a source configured in the admin adds its own tags to the general ones.
- **Tags for buyers** (on `order.placed`): an address that is ALREADY an active subscriber gets the buyer tags and, when switched on, one tag per bought product (created in Kit when missing, with a prefix set in the admin). An order never subscribes anyone: buying is not a newsletter consent.
- **The admin page** (`/app/kit`): the connection check, the list in numbers (active subscribers, growth over 30 and 90 days, open and click rates), the newest broadcasts with recipients, opens, clicks and unsubscribes, the list settings, tags by source and for buyers, the subscription log with every attempt, and a setup guide. The Kit numbers are read only and cached for ten minutes per process.
- **Works with Koda Plus hosts** through the `koda.integration/1` contract: the manifest, the customer summary (the subscriber's state in Kit) and the counter of failed sign-ups.

## Requirements

- Medusa 2.12 or newer (peer range `^2.12.0`) and Node.js 20+.
- A Kit account and a Kit API v4 key (Kit: Settings, Developer, API keys).
- For double opt-in: a Kit embed form with double opt-in switched on. The plugin lists the account's embed forms.

## Installation

```bash
npm install @koda-plus/medusa-plugin-kit
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-kit` or `pnpm add @koda-plus/medusa-plugin-kit`.

## Configuration

Register the plugin in `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-kit",
      options: {
        apiKey: process.env.KIT_API_KEY,
        storefrontUrl: "https://shop.example.com",
        // The defaults of the list settings; the admin overrides them:
        // doubleOptIn: process.env.KIT_DOUBLE_OPT_IN === "true",
        // formId: process.env.KIT_FORM_ID, // the double opt-in form
        // tags: process.env.KIT_TAGS, // "123,456"
      },
    },
  ],
})
```

Run the migrations, then open **Kit** in the admin sidebar and click **Check connection**:

```bash
npx medusa db:migrate
```

The migration (`Migration20261011100000`) adds two tables: `kit_subscriber_log` (the subscription log) and `kit_setting` (the list settings chosen in the admin).

Set the key in `.env`:

```bash
KIT_API_KEY=your-kit-v4-api-key
# optional, if you read them in medusa-config.ts:
# KIT_DOUBLE_OPT_IN=true
# KIT_FORM_ID=1234567
# KIT_TAGS=123,456
```

Without `apiKey` the plugin registers, the admin says "Not configured", the store route answers `ok: false, configured: false` without an error and nothing reaches Kit. Missing or broken options never break the boot: broken values fall back to their defaults and the admin lists them as ignored.

### Options

Every option is optional. Numbers and switches may come as strings, as environment variables do.

- `apiKey` (default none): the Kit API v4 key. Sent only in the `X-Kit-Api-Key` header to `api.kit.com`, never to the admin (which sees `***` and the last 4 characters), masked in every log and error.
- `doubleOptIn` (default `false`, `true` or `"true"`): the default of the double opt-in switch. On, a new subscriber is created `inactive` and added to the double opt-in form, which makes Kit send the confirmation e-mail. The admin switch overrides it.
- `formId` (default none): the default double opt-in form, a Kit form id (a positive integer). Used only with double opt-in on; with double opt-in on and no form, the subscriber stays `inactive` and Kit sends no confirmation, so choose one. The admin choice overrides it.
- `tags` (default none): the default tags of every new subscriber, Kit tag ids as an array or a comma separated string (`"123,456"`). Values that are not positive integers are ignored and listed. The admin choice overrides it.
- `storefrontUrl` (default none): the public address of the storefront, an http(s) address. Sent to Kit as the referrer when a subscriber is added to the double opt-in form.
- `source` (default `"Medusa"`): a name for the store, shown in the admin with the options. This version does not send it to Kit; the source of a sign-up is the `source` the storefront sends.
- `requestsPerMinute` (default `90`, 1 to 120): a self-imposed limit on the requests to Kit from one process. Kit allows 120 requests per rolling 60 seconds per key.
- `timeoutMs` (default `20000`, 1000 to 60000): the timeout of one request to Kit.
- `demo` (default `false`, `true` or `"true"`): demo mode, see [Demo mode](https://github.com/Koda-Plus/medusa-integrations/tree/main/packages/medusa-plugin-kit#demo-mode). It wins over `apiKey`.

The tags by source, the buyer tags, the product tags and their prefix have no option: they are chosen in the admin (Panel, Tags by source and for buyers) and kept in `kit_setting`.

## Setup in brief

The admin page has the same steps (Kit, then Setup guide).

1. In Kit, open Settings, Developer, API keys, create a V4 API key and put it in `KIT_API_KEY` on the backend.
2. Create the tags for the store in Kit (Subscribers, Tags), for example `shop` and `newsletter`.
3. For double opt-in, create an embed form in Kit with double opt-in switched on.
4. Add the plugin to `medusa-config.ts`, run `npx medusa db:migrate`, open Kit in the admin and click Check connection.
5. In the list settings pick the tags and the form, switch double opt-in, save.
6. Optional: add tags by source (for each place of the storefront that sends a `source`) and tags for buyers.
7. Put the form on the storefront (below) and sign a test address up; watch the subscription log.

## The storefront form

```bash
curl -X POST https://api.example.com/store/kit/subscribe \
  -H "Content-Type: application/json" \
  -H "x-publishable-api-key: pk_..." \
  -d '{"email": "anna@example.com", "first_name": "Anna", "source": "footer"}'
```

- `email` (required): the address, lowercased before it is sent.
- `first_name` (optional): at most 80 characters.
- `source` (optional, default `form`): where the sign-up came from. It is written to the log, and when the admin has tags for this source (letters, digits, `-` and `_`, compared in lower case) they are added.

Answers:

- `200 { ok: true, configured: true, status: "subscribed", already }`: on the list and active; `already` is true when the address was already there.
- `200 { ok: true, configured: true, status: "confirmation_sent", already }`: created `inactive`, Kit sends the confirmation e-mail of the form.
- `200 { ok: false, configured: false, message }`: the plugin has no key yet; show a neutral message.
- `400`: not an e-mail address, or Kit refused it.
- `429`: more than 5 sign-ups from one client IP in 10 minutes, or Kit is busy.
- `502`: Kit could not be reached.

The `message` of the answers is in Polish, written for the shopper; show your own text by the status if your store speaks another language. A failing tag or form never loses the subscription: the subscriber is kept and the log says what Kit answered.

## Tags for buyers

After `order.placed` the plugin reads the order's e-mail and products and asks Kit for the subscriber with that address. Only an `active` subscriber is tagged: an address that is not on the list, or still waits for the confirmation, is left alone, and a canceled order is skipped. The buyer tags come from the admin; with product tags on, every product title becomes a tag `<prefix><title>` (at most 120 characters, the prefix `Bought: ` by default, at most 40 characters), created in Kit when missing. A repeated event changes nothing, since tagging an address twice is a no-op in Kit. The order never waits for Kit and never fails because of it: a failure is a warning in the server log and a failed row in the subscription log.

## Admin API

Every route needs an admin session or token. Writes take a JSON body or the `x-koda-request` header (415 otherwise).

- `GET /admin/kit`: the page in one read: whether the key is set, the ignored options, the options in use (the key masked), the account behind the key, the settings in effect and the counters of the subscription log.
- `GET /admin/kit/check`: the live connection check: the account, its tags and forms. 400 without a key, 401 for a key Kit refuses.
- `GET /admin/kit/tags`: the account's tags, for the settings.
- `GET /admin/kit/forms`: the account's embed forms, with whether each one is double opt-in.
- `GET /admin/kit/settings`: the list settings in effect: `tags`, `form_id`, `double_opt_in`, `source_tags`, `buyer_tags`, `product_tags`, `product_tag_prefix`.
- `POST /admin/kit/settings`: changes any of those fields; tag and form ids are checked against the account before they are saved (400 for an unknown id or a bad source name).
- `GET /admin/kit/subscribers?take=&offset=&status=failed`: the subscription log, newest first (`take` up to 100, default 25).
- `GET /admin/kit/overview?fresh=1`: the list in numbers: active subscribers, growth over 30 and 90 days, the e-mail stats of the last 90 days. Cached for ten minutes; `fresh=1` asks Kit again.
- `GET /admin/kit/broadcasts?take=&fresh=1`: the newest broadcasts (drafts included) with recipients, open and click rates and unsubscribes; `take` 1 to 20, default 10. Cached for ten minutes.
- `GET /admin/kit/integration`, `/integration/summary`, `/integration/attention`: the koda.integration/1 contract (below).

## Store API

- `POST /store/kit/subscribe`: the storefront form (see above). It needs Medusa's publishable API key, like every store route, and no customer login.

## What it calls in Kit

Kit API v4 at `https://api.kit.com`, nothing else: `GET /v4/account`, `/v4/tags`, `/v4/forms?type=embed`, `/v4/subscribers` (by e-mail, and the total count), `/v4/account/email_stats`, `/v4/account/growth_stats`, `/v4/broadcasts`, `/v4/broadcasts/{id}/stats`; `POST /v4/subscribers` (the upsert), `/v4/tags` (a product tag), `/v4/tags/{tag}/subscribers/{id}` (a tag) and `/v4/forms/{form}/subscribers/{id}` (the double opt-in form). Errors are mapped to stable kinds (`auth`, `invalid`, `rate`, `not_found`, `error`); nothing is retried on its own.

## Works with Koda Plus hosts

An app that shows every Koda Plus plugin in one place reads Kit through the shared contract `koda.integration/1`:

- `GET /admin/kit/integration`: the manifest (mode `demo` in demo mode, `live` with a key, `off` without, the problem "no API key", entity `customer`).
- `GET /admin/kit/integration/summary?entity=customer&id=cus_...`: one line for the customer: the subscriber's state in Kit, looked up by the customer's e-mail (active is green, waiting for the confirmation is orange, anything else grey; cancelled, bounced and complained count as failed).
- `GET /admin/kit/integration/attention?scope=customers`: the counter `failed_subscriptions` (orange) of the last 7 days, linked to the Kit page.

## Demo mode

Only on explicit request: `demo: process.env.KIT_DEMO === "true"`. The plugin then works on a sample Kit account kept in the memory of the process and never calls Kit, even with an `apiKey` set:

- the panel shows a **Demo** badge and a note, the connection check answers with the sample account, its tags and forms, and the list in numbers and the newest broadcasts are fixed sample values;
- the store route and the buyer tags on `order.placed` run the real flow against the in-memory list (an address signed up once is "already there" the next time), and the log rows are real rows in `kit_subscriber_log`;
- no e-mail goes out (Kit would send the double opt-in confirmation; the demo sends nothing), and the in-memory list is gone after a restart.

Without a key and without `demo` the plugin says "Not configured" and sends nothing.

## Security and data

- **The API key** travels only in the `X-Kit-Api-Key` header to `api.kit.com`, never reaches the admin (it sees `***` and the last 4 characters) and is masked in logs, stored errors and admin screens.
- **The public route** is rate limited per client IP (5 sign-ups in 10 minutes, in the memory of each process; the first address of `X-Forwarded-For` behind a proxy) and checks the address before anything reaches Kit.
- **Writes need the admin.** Writes under `/admin/kit` take a JSON body or the `x-koda-request` header and answer 415 otherwise, so a form on another site cannot post with Medusa's session cookie. Every GET route only reads.
- **Consent**: an order never subscribes anyone; buyer tags go only to addresses that are already active subscribers. With double opt-in on, nobody receives anything before confirming.
- **What the plugin keeps**: the subscription log (`kit_subscriber_log`) keeps, for every attempt, the e-mail address, the first name, the Kit subscriber id, the state, the tag ids, the source, the outcome and a masked error. The address is stored in full and the log has no automatic retention: delete rows by hand when a person asks to be forgotten (and remove them in Kit). The settings table keeps tag ids, the form id and the switches.
- The plugin changes nothing in Medusa: no customer, cart or order is written.

## What this plugin does not do

- It does not send newsletters or broadcasts: Kit does, from the Kit account.
- It does not import the existing customers of the store into Kit, and it does not sync unsubscribes back to Medusa.
- It does not subscribe anyone at checkout; a checkbox at checkout can call the store route.
- It does not manage tags, forms or sequences in Kit, except creating a product tag that is missing.

## Uninstall

1. Remove the plugin from `medusa-config.ts` and the package from `package.json`, and the form from the storefront.
2. The tables `kit_subscriber_log` and `kit_setting` stay with their data. Drop them by hand when you no longer need them, or run `npx medusa db:rollback kit` before removing the package. The subscribers stay in Kit.

## Compatibility

Medusa 2.12 or newer (peer range `^2.12.0`) and Node.js 20+. The tests and the build run on Medusa 2.15.3. The admin libraries (`@medusajs/ui`, `@medusajs/icons`, `@tanstack/react-query`, `react`, `react-i18next`, `react-router-dom`) are optional peers: the plugin uses the copies of Medusa's dashboard. Developing the plugin needs Node.js 22.6+ (the tests run the TypeScript sources directly).

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. Need the newsletter wired into your checkout, your customer accounts or another e-mail marketing service? Write to kontakt@koda.plus.

## Trademarks

Kit, ConvertKit and Medusa are trademarks of their owners, used here only to identify the service this plugin connects to and the platform it runs on. This is an independent integration built on the public Kit API, not affiliated with or endorsed by Kit or Medusa.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-kit/LICENSE).

## Changelog

Every release is in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-kit/CHANGELOG.md).

- 0.2.0 (unreleased): the first release on npm. The storefront form with tags, tags by source and double opt-in, tags for buyers on `order.placed`, the admin page with the list in numbers and the broadcasts, the subscription log, the koda.integration/1 contract. It needs `npx medusa db:migrate`.
