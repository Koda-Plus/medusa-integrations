# OLX by Koda Plus

Connect an OLX seller account to Medusa, import its adverts and link every advert to the right product variant by SKU. Your team sees in the Medusa admin which products are live on OLX, which adverts went over the package limit or ended, and which live adverts have no product in the catalog.

Read-only by design: the plugin never creates, edits or ends anything on OLX.

![OLX page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-olx/docs/admin-olx.png)

**Live demo:** Medusa admin [medusa.koda.plus/app/olx](https://medusa.koda.plus/app/olx?demo=en), signed in to a public demo account by the link itself, and the storefront [demo.koda.plus](https://demo.koda.plus). The demo runs the plugin in demo mode, so every screen has data.

## What it syncs

- **Seller account** (OAuth 2.0, scope `read v2`): OLX to Medusa, when you click **Connect OLX account** in the admin.
- **Adverts** (id, title, URL, status, price, `external_id` and the SKU from the description): OLX to Medusa, every hour at minute 30 and on **Sync now**.
- **Advert to variant links**, one primary advert per variant: inside Medusa, on every sync.
- **Live advert links** for an "Also on OLX" button: Medusa to your storefront through `GET /store/olx/products/:id`.

## Features

- **OLX page in the admin** with counters (live, over the package limit, ended, products live on OLX, live adverts without a product, adverts without SKU), a searchable advert table with filters and the sync history.
- **Product widget** on every product page: its OLX adverts, primary first, with status and price, or how to link one.
- **SKU matching** by `external_id` first (what feeds and BaseLinker fill in), then by a configurable SKU line in the description such as `Kod produktu: KS-ELN-18V`. Case-insensitive, never by title.
- **Status aware:** `active` is live; `limited` (over the package limit, invisible to buyers) and ended statuses are reported separately, because they need different actions.
- **Safe incomplete reads:** if a page of the OLX list fails, the plugin adds and updates what it read but removes nothing, so a broken list never unlinks products that are listed right now.
- **Demo mode:** sample adverts built from your own catalog run through the same parser and matching. Evaluate the plugin without an OLX developer account.
- **Admin in English and Polish** through the Medusa admin translations.
- **Workflow included:** `syncOlxAdvertsWorkflow` runs from the scheduled job, the admin and your own code.

![Adverts linked to products](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-olx/docs/admin-olx-adverts.png)

## Requirements

- Medusa 2.12 or newer (tested on 2.15.3) and Node.js 20+.
- For a real account: an app registered in the OLX developer portal of your market (for Poland [developer.olx.pl](https://developer.olx.pl)) with your redirect URI.

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
        // demo: true, // sample adverts from your catalog, no OLX account needed
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

- `clientId`: OLX app client id.
- `clientSecret`: OLX app client secret.
- `encryptionKey`: 32 random bytes in base64. Encrypts OLX tokens at rest with AES-256-GCM.
- `redirectUri`: must equal the redirect URI registered in the OLX app. The plugin serves it at `/olx/callback`.
- `market` (default `pl`): `pl`, `ro`, `pt`, `bg`, `ua`, `kz` or `uz`.
- `demo` (default `false`): sample adverts generated from your catalog. Nothing is sent to OLX.
- `skuPatterns` (default: lines starting with `Kod produktu`, `Product code` or `SKU`): regex sources with one capture group that find the SKU in descriptions.
- `syncEnabled` (default `true`): the hourly scheduled sync.
- `requestsPerMinute` (default `200`): self-imposed rate limit. OLX allows 4 500 requests per 5 minutes per IP.
- `timeoutMs` (default `20000`): timeout of one OLX request.

Missing options never break the boot: the module registers, the admin lists what is missing and the scheduled sync waits.

### Connecting the account

1. In the OLX developer portal, create an app and register the redirect URI, for example `https://api.your-store.com/olx/callback`.
2. In the Medusa admin open **OLX** and click **Connect OLX account**. A consent page of OLX opens, valid for 15 minutes.
3. The seller, logged in to OLX, approves access. OLX redirects to `/olx/callback`, the plugin exchanges the code for tokens and starts the first sync.

The access token lives 24 hours and the refresh token 30 days. Both refresh by themselves on every sync.

## How matching works

1. Every advert gets a key: its `external_id`, or, when that is empty, the SKU found in the description by `skuPatterns`. Both sides are compared uppercased and trimmed.
2. The key is looked up among variant SKUs. A variant can have several adverts (a re-listed item, an old ended one); the **primary** advert wins by status (live, then over the limit, then ended) and then by the newest advert id.
3. A complete read replaces the snapshot. An incomplete read (a failed page, the 5 000 advert ceiling) only adds and updates.

The snapshot stores only what the matching and the admin need. Contact data, locations and images of adverts are not stored.

![OLX adverts on the product page](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-olx/docs/admin-olx-widget.png)

## API routes

- `GET /admin/olx`: status, counters and the last run.
- `POST /admin/olx/connect`: starts connecting and returns the OLX consent URL.
- `POST /admin/olx/disconnect`: forgets the tokens.
- `POST /admin/olx/sync`: starts a sync (202, runs in the background).
- `GET /admin/olx/adverts`: the snapshot, with `filter` (all, linked, unmatched, limited, ended, nokey), `q`, `limit` and `offset`.
- `GET /admin/olx/runs`: the sync history.
- `GET /admin/olx/products/:id`: adverts linked to a product.
- `GET /store/olx/products/:id`: live adverts of a product for the storefront.
- `GET /olx/callback`: the OAuth redirect URI. Public, and it only acts during a connection attempt.

Run a sync from your own code:

```ts
import { syncOlxAdvertsWorkflow } from "@koda-plus/medusa-plugin-olx/workflows"

const { result } = await syncOlxAdvertsWorkflow(container).run({
  input: { trigger: "manual" },
})
```

## Security

- **Write barrier:** every request goes through a check that lets only GET and HEAD reach the Partner API. The single POST allowed is the token exchange.
- **Encrypted tokens:** AES-256-GCM with a random IV per write. The key lives in your environment, not in the database.
- **OAuth `state` nonce:** one-time, valid 15 minutes and compared literally, so nobody can attach a foreign OLX account through the public callback.
- **Masked logs:** secrets and token-like strings are masked in logs, the database and the admin.
- **Rate limited**, with retries only for transient errors: network, 5xx and one 60 second wait on 429.

## What this plugin does not do

- It does not publish, edit, renew or end adverts. Listing stays in OLX or in your listing tool.
- It does not push stock or prices to OLX.
- It does not handle OLX messages, OLX Delivery or orders placed on OLX.
- One OLX seller account per Medusa store.

Two-way sync (publishing products as adverts, ending adverts when stock runs out) is on the roadmap, behind an explicit opt-in.

## Markets

The same logic runs in production on OLX.pl. The other OLX markets on the same Partner API (olx.ro, olx.pt, olx.bg, olx.ua, olx.kz and olx.uz) are supported by the `market` option and not yet verified in production. Reports are welcome.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers the matching, the advert parser, the write barrier, the encryption and the demo data. To try the plugin in a Medusa app, run `npx medusa plugin:publish` here, then `npx medusa plugin:add @koda-plus/medusa-plugin-olx` in the app.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. The same OLX logic runs in production for a tyre and wheel retailer with about 2 000 OLX adverts, next to our Allegro, BaseLinker and InPost integrations. Need two-way OLX sync, a custom integration or a Medusa store? Write to kontakt@koda.plus.

## Trademarks

OLX and the OLX logo are trademarks of their owner, used here only to identify the marketplace this plugin connects to. This is an independent integration built on the public OLX Partner API, not affiliated with or endorsed by OLX.

## License

MIT, see [LICENSE](./LICENSE).
