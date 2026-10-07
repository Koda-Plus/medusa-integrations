# OLX by Koda Plus

Connect an OLX seller account to Medusa and keep both sides honest. The plugin reads your OLX adverts, links every advert to the right product variant by SKU, and shows in the Medusa admin where OLX and the store disagree: adverts live while the variant is sold out or the product unpublished, stock that is not live on OLX, products never listed. It reads advert statistics and unread conversations, and gives your storefront live advert links.

Writes are opt-in. Three writers, off until you allow them in the options and arm them in the admin, can end adverts that sold out and bring them back, keep advert prices in line with Medusa, and publish products as new adverts. Each one plans first, shows a dry run, applies a capped number of changes per run and looks the advert up on OLX before every write.

![OLX page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-olx/docs/admin-olx.png)

**Live demo:** Medusa admin [medusa.koda.plus/app/olx](https://medusa.koda.plus/app/olx?demo=en), signed in to a public demo account by the link itself, and the storefront [demo.koda.plus](https://demo.koda.plus). The demo runs the plugin in demo mode: a simulated OLX account built from the store catalog, with alerts, statistics, conversations and all three writers acting on the simulation.

## What it syncs

- **Seller account** (OAuth 2.0): OLX to Medusa, when you click **Connect OLX account**. Scope `read v2`, plus `write` only when a writer is allowed in the options.
- **Adverts** (id, title, URL, status, price, category, `external_id`, the SKU from the description): OLX to Medusa, every hour at minute 30 and on **Sync now**.
- **Advert to variant links**, one primary advert per variant: inside Medusa, on every sync.
- **Alerts**: Medusa stock, prices and product status against the advert snapshot, every 15 minutes.
- **Statistics** (views, phone views, observers): OLX to Medusa, every hour at minute 45, oldest first.
- **Message threads** (unread and total counts per conversation): OLX to Medusa, every 15 minutes.
- **Advert lifecycle, prices, new adverts**: Medusa to OLX, only from an armed writer.
- **Live advert links** for an "Also on OLX" button: Medusa to your storefront through `GET /store/olx/products/:id`.

## Features

- **OLX page in the admin** with two views switched in the header: **Panel** and **Setup guide** (also as `?view=guide`, so a link can open the guide directly).
- **Counters** for adverts (live, over the package limit, ended, products live on OLX, live adverts without a product, adverts without SKU), alerts, statistics totals and unread messages.
- **Alerts** in four kinds, with filters and search: live on OLX but sold out in the store, live but not published, in stock but not live on OLX, in stock and never on OLX.
- **Advert lifecycle writer**: ends live adverts whose variant sold out or whose product is no longer published, finishes sold out adverts over the package limit, and brings back the adverts it ended itself when the stock returns.
- **Price writer**: sets live advert prices to the variant's base price in the market currency; changes above a limit wait for your approval.
- **Publishing**: one advert per variant, built from the product (title, description, price, images), the category mapping and the category's required attributes read from OLX. The publish plan shows the exact request, or what is missing.
- **Statistics** per advert in the advert table and the product widget, totals in the counters.
- **Messages**: unread conversations linked to adverts and products, with links to the advert and the OLX chat inbox. Counts only, no message text.
- **Product widget** on every product page: its adverts with status, price, statistics and unread messages, its alerts and its publish state, or how to link an advert.
- **Setup guide** in the admin: the rollout from zero to production with live step states, a diagram, a go-live checklist and troubleshooting, in English and Polish.
- **Running in production**: stores that use the plugin, from the `references` option, on the Panel and in the guide.
- **SKU matching** by `external_id` first (what feeds, BaseLinker and this plugin fill in), then by a configurable SKU line in the description such as `Kod produktu: KS-ELN-18V`. Case-insensitive, never by title.
- **Safe incomplete reads**: an incomplete read adds and updates but removes nothing, and plans nothing new.
- **Demo mode**: a simulated OLX account from your own catalog runs through the same parsers, plans and writers. Evaluate everything without an OLX developer account.
- **Admin in English and Polish** through the Medusa admin translations.
- **Workflows included** for the sync, the plan cycle, every writer, statistics and threads.

![Adverts linked to products](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-olx/docs/admin-olx-adverts.png)

## Write safety

- **Two switches per writer.** The option (`lifecycleWriter`, `priceWriter`, `publishWriter`) is the hard one: `false` wins and the admin cannot override it. The switch in the admin is the runtime one, stored with who flipped it and when. In live mode the OLX token must also carry the `write` scope. Demo toggles and live toggles are separate.
- **Plan first.** Every 15 minutes a plan says what each writer would change, from what to what. The admin shows it, and **Dry run** lists the exact requests a run would send. Nothing is planned from an incomplete read or when Medusa stock could not be read, and an advert missing from a read is never treated as ended.
- **Look before you write.** Every item is read on OLX right before its write. Already done: adopted, nothing sent. No longer applicable (a person ended the advert, the price changed on OLX meanwhile): skipped, and the snapshot learns the fresh fact.
- **One write per item per run, a cap per run** (`maxLifecycleActionsPerRun`, `maxPriceUpdatesPerRun`, `maxPublishPerRun`) and **quarantine** after three rejections in a row, until a person releases the item.
- **Unclear answers are never retried blindly.** A timeout or a 5xx after a write leaves the item `unknown`; the next run reads the advert first and decides.
- **Publishing exactly once per variant**: a unique row per variant before anything goes out, an atomic claim with a lease, a lookup of the SKU in `external_id` before every create, a second lookup after an unclear answer, and a new create only when a lookup a quarter of an hour later still finds nothing.
- **Mass guard.** A lifecycle plan that would end more than max(10, 25 %) of the live linked adverts looks like a broken stock import: scheduled runs end nothing until a person runs it deliberately.
- **Only what the plugin was meant to do.** A write barrier lets through GET and HEAD, the OAuth token exchange, and three writes only for the writer armed for the call: advert commands `activate`, `deactivate` and `finish`, an advert update, a new advert. Deleting adverts, buying packets or paid features, the `extend` command and messages are refused by the code.
- **Reactivates only its own pauses.** The lifecycle writer brings back only adverts it ended itself, never one a person ended.

## Requirements

- Medusa 2.12 or newer (tested on 2.15.3) and Node.js 20+.
- For a real account: an application registered and accepted in the OLX developer portal of your market (for Poland [developer.olx.pl](https://developer.olx.pl)), with your callback URL. OLX reviews applications, and the API terms are for business use.

## Installation

```bash
npm install @koda-plus/medusa-plugin-olx
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-olx` or `pnpm add @koda-plus/medusa-plugin-olx`.

## Configuration

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-olx",
      options: {
        clientId: process.env.OLX_CLIENT_ID,
        clientSecret: process.env.OLX_CLIENT_SECRET,
        encryptionKey: process.env.OLX_ENCRYPTION_KEY,
        redirectUri: "https://api.your-store.com/olx/callback",
        market: "pl",
        // Writers: off unless allowed here AND armed in the admin.
        lifecycleWriter: process.env.OLX_LIFECYCLE_WRITER === "true",
        priceWriter: process.env.OLX_PRICE_WRITER === "true",
        publishWriter: process.env.OLX_PUBLISH_WRITER === "true",
        // demo: true, // a simulated OLX account from your catalog, no OLX account needed
      },
    },
  ],
})
```

Set the credentials in `.env`. Generate the encryption key with `openssl rand -base64 32`:

```bash
OLX_CLIENT_ID=your-client-id
OLX_CLIENT_SECRET=your-client-secret
OLX_ENCRYPTION_KEY=base64-encoded-32-bytes
```

Run the migrations, then open **OLX** in the admin sidebar:

```bash
npx medusa db:migrate
```

### Options

Connection:

- `clientId`: OLX application client id.
- `clientSecret`: OLX application client secret.
- `encryptionKey`: 32 random bytes in base64. Encrypts OLX tokens at rest with AES-256-GCM.
- `redirectUri`: must equal a callback URL registered in the OLX application. The plugin serves it at `/olx/callback`.
- `market` (default `pl`): `pl`, `ro`, `pt`, `bg`, `ua`, `kz` or `uz`.
- `demo` (default `false`): a simulated OLX account generated from your catalog. Nothing is sent to OLX.

Reading:

- `skuPatterns` (default: lines starting with `Kod produktu`, `Product code` or `SKU`): regex sources with one capture group that find the SKU in descriptions.
- `syncEnabled` (default `true`): the hourly sync and the 15 minute plan.
- `salesChannelId` (default: every stock location): count stock only at the stock locations of this sales channel.
- `statsEnabled` (default `true`): the hourly statistics refresh.
- `statsPerRun` (default `200`): adverts whose statistics one run refreshes; each advert at most every six hours.
- `messagesEnabled` (default `true`): the 15 minute read of message threads.
- `requestsPerMinute` (default `200`): self-imposed rate limit. OLX blocks an IP for 30 minutes after 4 500 requests in 5 minutes.
- `timeoutMs` (default `20000`): timeout of one OLX request.

Writers (all off by default in live mode; in demo mode they default to on and act on the simulation only):

- `lifecycleWriter` (default `false`): allows the advert lifecycle writer.
- `priceWriter` (default `false`): allows the price writer.
- `publishWriter` (default `false`): allows publishing.
- `maxLifecycleActionsPerRun` (default `20`), `maxPriceUpdatesPerRun` (default `20`), `maxPublishPerRun` (default `5`): caps of one run.
- `maxPriceChangePercent` (default `50`): larger price changes wait for your approval in the admin.
- `deactivateAsSold` (default `false`): the `is_success` flag sent with `deactivate` (whether the item sold through OLX). The plugin cannot know where an item sold, so it says no unless you choose otherwise.

Publishing (`publish`):

- `publish.categories`: `[{ medusaCategory, olxCategoryId, attributes? }]`. `medusaCategory` is a Medusa product category id or handle, `olxCategoryId` a leaf OLX category, `attributes` default values for it, such as `{ state: "new" }`.
- `publish.attributes`: attribute values for every category.
- `publish.location`: `{ cityId, districtId?, latitude?, longitude? }`, city id from `GET /cities` or `GET /locations` of the Partner API.
- `publish.contact`: `{ name, phone? }` shown on the advert.
- `publish.advertiserType` (default `business`).
- `publish.descriptionFooter`: appended to every description, for example delivery and returns.
- Per product, in Medusa metadata: `olx_title`, `olx_category_id` and `olx_attributes` (an object of attribute codes and values; on a variant it wins over the product).

Presentation:

- `references`: stores running the plugin, shown as "Running in production". Each entry: `name`, `url` (https), and optionally `description` (a string, or `{ en, pl }`), `metrics` (`[{ label, value }]`) and `links` (`[{ label, url }]`). A store that starts on Medusa soon gets `soon: true`: it is shown with a "Soon" badge and no link, and its `url` is optional. Entries without a name, or live entries without an https URL, are dropped; nothing here can break the boot.

Missing options never break the boot: the module registers, the admin lists what is missing and the jobs wait.

### Connecting the account

1. In the OLX developer portal, register an application and put your callback URL into its "Adres powrotu" field, for example `https://api.your-store.com/olx/callback`.
2. In the Medusa admin open **OLX** and click **Connect OLX account**. A consent page of OLX opens, valid for 15 minutes.
3. The seller, logged in to OLX, approves access. OLX redirects to `/olx/callback`, the plugin exchanges the code (valid 10 minutes) for tokens and starts the first sync.

The access token lives 24 hours and the refresh token one month. Both are renewed by the hourly sync. If you allow a writer later, connect the account again so the token carries the `write` scope.

## Setup in brief

The admin has the full guide (**OLX**, **Setup guide**), with the state of every step taken from your store.

1. Register an application in the OLX developer portal and wait for the acceptance e-mail.
2. Set the callback URL of the application to your `/olx/callback` address.
3. Add the plugin options and the environment variables, then restart.
4. Run `npx medusa db:migrate`.
5. Connect the OLX account from the admin.
6. Run the first read with **Sync now**.
7. Make sure the adverts carry the SKU: `external_id`, or a `Kod produktu: SKU` line in the description.
8. Read the alerts and fix what they show.
9. Allow one writer in the options, connect again for the write scope, run **Dry run**, read every line, then arm it. One writer at a time.
10. For publishing, map categories, set the location and the contact, and check the publish plan.
11. Walk the go-live checklist; from then on the jobs run by themselves.

## How matching works

1. Every advert gets a key: its `external_id`, or, when that is empty, the SKU found in the description by `skuPatterns`. Both sides are compared uppercased and trimmed.
2. The key is looked up among variant SKUs. A variant can have several adverts (a re-listed item, an old ended one); the **primary** advert wins by status (live, then over the limit, then ended) and then by the newest advert id.
3. A complete read replaces the snapshot. An incomplete read (a failed page, the 5 000 advert ceiling) only adds and updates.

![OLX adverts on the product page](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-olx/docs/admin-olx-widget.png)

## Alerts

Recomputed every 15 minutes from the last complete read and the current Medusa catalog:

- **Live, sold out**: the advert is live while its variant has no stock.
- **Live, not published**: the advert is live while the product is a draft, proposed or rejected.
- **In stock, not live**: the variant has stock and adverts, but none of them is live (ended, over the package limit, removed). Adverts in moderation count as on their way.
- **In stock, not on OLX**: published, in stock, with a SKU, and never on OLX.

Stock must be a fact: a variant that tracks inventory but has no inventory item raises nothing, and nothing is acted on. Variants that do not manage inventory, or allow backorders, count as in stock.

## Writers

**Advert lifecycle** (`POST /adverts/{id}/commands`): `deactivate` for live adverts of sold out or unpublished variants, `finish` for sold out adverts over the package limit, `activate` for adverts this plugin deactivated once their variant is back in stock and published. Adverts a person ended are never reactivated. Bringing an advert back uses your OLX package like a manual reactivation; an advert over the limit stays limited, and the plugin never buys packets.

**Prices** (`PUT /adverts/{id}`): the OLX update replaces the whole advert, so the writer reads the advert and sends every documented field back unchanged, only the price differs. The target is the variant's base price in the market currency (no price list, no rules, no quantity tier). A variant without one is skipped, never priced at zero. If the price on OLX changed after the plan, the item is skipped and planned again from the new price.

**Publishing** (`POST /adverts`): candidates are published, in-stock variants with a SKU and no advert, in a mapped category. Title, description (plain text, a SKU line and your footer), price, https images up to the category limit, location, contact and the required attributes from `GET /categories/{id}/attributes` are checked against the OLX rules before anything is sent: title 16 to 150 characters, description 80 to 9 000, no e-mail addresses, web addresses or phone numbers, at most half capital letters. The SKU goes into `external_id`, so the next sync links the new advert to its variant.

Every run is recorded with its items, and the last dry run and the last applied run show on the writer card.

## Statistics and messages

Statistics come from `GET /adverts/{id}/statistics`, one request per advert, at most `statsPerRun` adverts an hour and each advert at most every six hours. The OLX API terms forbid presenting account statistics to others without OLX's permission, so they stay in the admin: no store route returns them.

Messages come from `GET /threads`. The plugin stores the thread key, the advert, the number of messages and of unread messages, the date and the favourite flag. It keeps no message text and no buyer id; conversations are read and answered on OLX.

## API routes

- `GET /admin/olx`: status, counters, alerts, statistics and message totals, writers, the last plan and the last run.
- `POST /admin/olx/connect`: starts connecting and returns the OLX consent URL.
- `POST /admin/olx/disconnect`: forgets the tokens.
- `POST /admin/olx/sync`: starts a sync, then the plan and the armed writers (202, in the background).
- `GET /admin/olx/adverts`: the snapshot, with `filter` (all, linked, unmatched, limited, ended, nokey), `q`, `limit` and `offset`.
- `GET /admin/olx/alerts`: alerts, with `kind`, `q`, `limit` and `offset`.
- `GET /admin/olx/plan`: plan rows of the lifecycle or price writer, with `writer` and `view` (open, held, quarantined, done, all).
- `GET /admin/olx/publications`: the publish plan and published adverts, with `view` (plan, ready, blocked, problems, published, all) and `q`.
- `GET /admin/olx/threads`: message threads, with `filter` (unread, all).
- `GET /admin/olx/runs`: the sync history.
- `GET /admin/olx/writer-runs`: dry and applied runs, with `writer`.
- `GET /admin/olx/products/:id`: adverts, alerts and publications of a product.
- `POST /admin/olx/writers/:writer`: `{ armed: boolean }`, the runtime switch of `lifecycle`, `price` or `publish`.
- `POST /admin/olx/writers/:writer/run`: `{ dryRun?: boolean, overrideGuard?: boolean }`. A dry run answers right away; an applied run needs the writer armed and runs in the background.
- `POST /admin/olx/writers/:writer/items/:id/release`: releases a quarantined item, approves a held price change, or lets a failed publication go again.
- `POST /admin/olx/stats/refresh` and `POST /admin/olx/threads/sync`: refresh now (202).
- `POST /admin/olx/demo/reset`: demo mode only, starts the simulation over.
- `GET /store/olx/products/:id`: live adverts of a product for the storefront (real adverts only, never statistics).
- `GET /olx/callback`: the OAuth redirect URI. Public, and it only acts during a connection attempt.

No route deletes anything.

## Jobs

- `olx-sync-adverts`, every hour at :30: the sync, then the plan and the armed writers.
- `olx-plan`, every 15 minutes (:05, :20, :35, :50): alerts, plans and the armed writers, without reading the advert list.
- `olx-refresh-stats`, every hour at :45: statistics.
- `olx-sync-threads`, every 15 minutes (:10, :25, :40, :55): message threads.

## Workflows

```ts
import {
  syncOlxAdvertsWorkflow,
  runOlxCycleWorkflow,
  runOlxWriterWorkflow,
  refreshOlxStatsWorkflow,
  syncOlxThreadsWorkflow,
} from "@koda-plus/medusa-plugin-olx/workflows"

await syncOlxAdvertsWorkflow(container).run({ input: { trigger: "manual" } })
await runOlxCycleWorkflow(container).run({ input: { trigger: "manual" } })
const { result } = await runOlxWriterWorkflow(container).run({
  input: { writer: "lifecycle", dryRun: true },
})
```

## Security and data

- **Write barrier** (see Write safety): reads, the token exchange and three narrow writes, each only for the writer armed for the call.
- **Encrypted tokens:** AES-256-GCM with a random IV per write. The key lives in your environment, not in the database.
- **OAuth `state` nonce:** one-time, valid 15 minutes and compared literally, so nobody can attach a foreign OLX account through the public callback.
- **Masked logs:** secrets and token-like strings are masked in logs, the database and the admin.
- **Rate limited**, with retries only for transient errors on reads (network, 5xx, 429 with the server's wait), and a 30 minute pause of every job when OLX blocks the IP.
- **No buyer personal data at rest.** The snapshot keeps no contact data, locations or images of adverts; threads keep counts only.

## What this plugin does not do

- It does not reply to messages or mark them as read; conversations stay on OLX.
- It does not delete adverts, buy packets, buy paid features or extend adverts.
- It does not change advert titles, descriptions, images or attributes after publishing; only the price writer edits a live advert, and only its price.
- It does not publish job adverts (salary categories), set OLX Delivery options or send product safety (GPSR) data; categories that require them reject the advert and the plan shows OLX's message.
- It does not handle OLX Delivery shipments or orders placed on OLX.
- It does not move stock from OLX to Medusa: Medusa is the source of truth.
- One OLX seller account and one market per Medusa store.

## Markets

The same logic runs in production on OLX.pl. The other OLX markets on the same Partner API (olx.ro, olx.pt, olx.bg, olx.ua, olx.kz and olx.uz) are supported by the `market` option and not yet verified in production. Reports are welcome.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers the matching, the parsers, alerts, the three planners, the publish validation, the apply loops with their exactly-once rules, the SQL of the atomic claims, the client's answer handling, the write barrier, the encryption and the whole demo story. What the plugin relies on from the OLX documentation is in [docs/olx-api-notes.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-olx/docs/olx-api-notes.md). To try the plugin in a Medusa app, run `npx medusa plugin:publish` here, then `npx medusa plugin:add @koda-plus/medusa-plugin-olx` in the app.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. The same OLX logic runs in production for a tyre and wheel retailer with about 1 900 live OLX adverts, next to our Allegro, BaseLinker and InPost integrations. Need a custom integration or a Medusa store? Write to kontakt@koda.plus.

## Trademarks

OLX and the OLX logo are trademarks of their owner, used here only to identify the marketplace this plugin connects to. This is an independent integration built on the public OLX Partner API, not affiliated with or endorsed by OLX.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-olx/LICENSE).

## Changelog

### 0.2.1 (2026-10-07)

- References: stores that start soon on Medusa can be listed with `soon: true` (a Soon badge, no link, `url` optional); the since date is no longer shown, and an old `since` in the options is ignored.

### 0.2.0 (2026-10-06)

- Alerts: live on OLX while sold out or unpublished in Medusa, in stock but not live, in stock and never on OLX. Counters, filters, search and the product widget.
- Advert lifecycle writer: deactivate, finish and reactivate by stock and product status, plan first, dry run, cap, quarantine, mass guard, reactivation of its own pauses only.
- Price writer: advert prices from the Medusa base price, the whole advert sent back with only the price changed, approval above `maxPriceChangePercent`.
- Publishing: one advert per variant from mapped categories, required attributes read from OLX and validated before sending, exactly once (unique row, claim, lookup by `external_id`, unknown state).
- Writers have two switches (option and admin toggle with who and when), separate for demo and live.
- Statistics (views, phone views, observers) per advert and in totals; message threads with unread counts.
- Setup guide view with live step states, checklist and troubleshooting; `references` option shown as "Running in production".
- Write barrier extended from read-only to three narrow writes; IP block detection with a 30 minute pause; `Retry-After` on 429.
- Demo mode simulates the whole story: alerts, statistics, threads, all three writers and a publish plan with one product missing a required attribute.
- New tables (one migration): alerts, plan rows, publications, writer runs, threads, state; statistics and category columns on the advert snapshot.

### 0.1.0 (2026-10-04)

First public release, extracted from the OLX integration Koda Plus runs in production since September 2026: OAuth 2.0 connection with encrypted tokens, hourly read-only sync through the OLX Partner API v2, SKU matching by `external_id` and description, the complete-read rule, the admin page and product widget in English and Polish, the store route for "Also on OLX" links and demo mode.
