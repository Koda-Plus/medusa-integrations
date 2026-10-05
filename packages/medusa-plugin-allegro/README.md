# Allegro by Koda Plus

Connect an Allegro seller account to Medusa, link every offer to the right product variant by its signature, see where Allegro and Medusa disagree on stock before buyers do, and follow Allegro orders next to your store.

Read-only by design: the plugin never creates, edits or ends anything on Allegro.

![Allegro page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-allegro/docs/admin-allegro.png)

**Live demo:** Medusa admin [medusa.koda.plus/app/allegro](https://medusa.koda.plus/app/allegro?demo=en), signed in to a public demo account by the link itself. The demo runs the plugin in demo mode, so every screen has data.

## What it syncs

- **Seller account** (OAuth 2.0 device flow, read-only scopes): Allegro to Medusa, when the seller types a code at allegro.pl. No redirect URI, no public callback route.
- **Offers** (id, name, status, price, quantity, signature): Allegro to Medusa, every hour at minute 45 and on **Sync now**.
- **Offer to variant links**, one primary offer per variant: inside Medusa, on every offer sync.
- **Stock check**, the Allegro quantity of every primary offer against what Medusa has available: inside Medusa, on every offer sync. It labels, it never writes.
- **Order journal** (status, fulfillment status, lines, total; no buyer data): Allegro to Medusa, every ten minutes.
- **Live offer links** for an "Also on Allegro" button: Medusa to your storefront through `GET /store/allegro/products/:id`.

## Features

- **Allegro page in the admin** with counters (live offers, products live on Allegro, oversell risk, in stock but not on Allegro, live offers without a product, orders to ship), a searchable offer table with filters, the order journal and the sync history.
- **Product widget** on every product page: its Allegro offers, primary first, with status, price and the Allegro quantity next to the Medusa one.
- **Signature matching:** the offer `external.id` (the "sygnatura" sellers, feeds and BaseLinker fill with the SKU) against the variant SKU, case-insensitive, never by offer name.
- **Stock check with honest labels:** Allegro has more than Medusa, sold out in Medusa while live on Allegro, Allegro has less, ended on Allegro while still in stock. The plugin does not guess which side is right: a sale on Allegro that Medusa has not heard of yet looks exactly like an oversell.
- **Order journal without personal data:** lines linked to products by offer and by signature, so the team sees what sold on Allegro and which lines have no product in the catalog.
- **Device flow:** the seller types a short code at allegro.pl/skojarz-aplikacje. Nothing has to be reachable from the internet, which suits stores behind a firewall or a preview URL.
- **Production and sandbox:** `environment: "sandbox"` talks to allegro.pl.allegrosandbox.pl. Tokens of one environment are never used against the other.
- **Safe incomplete reads:** if a page of the offer list fails, or the list changes during the read, the plugin adds and updates what it read but removes nothing.
- **Demo mode:** sample offers and orders built from your own catalog run through the same parsers, matching and stock check. Evaluate the plugin without an Allegro developer account.
- **Admin in English and Polish** through the Medusa admin translations.
- **Workflows included:** `syncAllegroOffersWorkflow` and `syncAllegroOrdersWorkflow` run from the scheduled jobs, the admin and your own code.

## Requirements

- Medusa 2.12 or newer (tested on 2.15.3) and Node.js 20+.
- For a real account: an app registered in the Allegro developer portal (apps.developer.allegro.pl, or the sandbox portal) as an app **without access to a browser**, which is the device flow.

## Installation

```bash
npm install @koda-plus/medusa-plugin-allegro
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-allegro` or `pnpm add @koda-plus/medusa-plugin-allegro`.

## Configuration

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-allegro",
      options: {
        clientId: process.env.ALLEGRO_CLIENT_ID,
        clientSecret: process.env.ALLEGRO_CLIENT_SECRET,
        encryptionKey: process.env.ALLEGRO_ENCRYPTION_KEY,
        environment: "production", // or "sandbox"
        // demo: true, // sample offers and orders from your catalog, no Allegro account needed
      },
    },
  ],
})
```

Set the credentials in `.env`. Generate the encryption key with `openssl rand -base64 32`:

```bash
ALLEGRO_CLIENT_ID=your-client-id
ALLEGRO_CLIENT_SECRET=your-client-secret
ALLEGRO_ENCRYPTION_KEY=base64-encoded-32-bytes
```

Run the migrations, then open **Allegro** in the admin sidebar:

```bash
npx medusa db:migrate
```

### Options

- `clientId`: Allegro app client id.
- `clientSecret`: Allegro app client secret.
- `encryptionKey`: 32 random bytes in base64. Encrypts Allegro tokens at rest with AES-256-GCM.
- `environment` (default `production`): `production` or `sandbox`.
- `demo` (default `false`): sample offers and orders generated from your catalog. Nothing is sent to Allegro.
- `syncEnabled` (default `true`): the hourly offer sync.
- `ordersEnabled` (default `true`): the order journal. Off, the plugin does not ask for the orders scope at all.
- `stockLocationIds` (default: all locations): stock locations whose quantities count in the stock check.
- `requestsPerMinute` (default `300`): self-imposed rate limit. Allegro allows 9 000 requests per minute per client id.
- `timeoutMs` (default `20000`): timeout of one Allegro request.

Missing options never break the boot: the module registers, the admin lists what is missing and the scheduled jobs wait.

### Connecting the account

1. In the Allegro developer portal, register an app without access to a browser. No redirect URI is needed.
2. In the Medusa admin open **Allegro** and click **Connect Allegro account**. The page shows a short code and opens allegro.pl/skojarz-aplikacje.
3. The seller, logged in to Allegro, types the code and approves. The admin page notices it within seconds and starts the first sync. A seller who approves while nobody has the admin open is picked up by the next hourly run.

The access token lives 12 hours and the refresh token three months. Both refresh by themselves; refreshes are serialized because Allegro keeps the old refresh token alive for only 60 seconds after a rotation.

## How matching works

1. Every offer gets a key: its signature (`external.id`). Both the signature and the variant SKU are compared uppercased and trimmed.
2. A variant can have several offers (a re-listed item, an old ended one, a draft). The **primary** offer wins by status (live, then activating, then draft, then ended) and then by the newest offer id.
3. A complete read replaces the snapshot. An incomplete read (a failed page, fewer offers than Allegro announced, the page ceiling) only adds and updates.

The snapshot stores only what the matching, the stock check and the admin need. Images, descriptions, parameters and delivery settings of offers are not stored.

## How the stock check works

For every primary offer linked to a variant, the plugin compares the Allegro quantity (`stock.available`) with what Medusa has available: stocked minus reserved in the chosen stock locations. A kit has as many items as its scarcest part. The result is one of these labels:

- **Allegro has more:** live on Allegro with more items than Medusa has. The oversell risk.
- **Sold out in Medusa:** live on Allegro while Medusa has none left.
- **Allegro has less:** fewer items on Allegro than in Medusa. Lost sales, not a risk.
- **In stock, ended:** the offer ended while Medusa still has the item.
- **Matches**, **Not tracked** (the variant does not manage inventory) and **No quantity**.

The check never writes, on either side. Which number is right depends on where the last sale happened, and two numbers cannot tell that. The labels tell your team, or your listing tool, where to look.

## API routes

- `GET /admin/allegro`: status, counters and the last runs.
- `POST /admin/allegro/connect`: starts a device login and returns the code to show.
- `POST /admin/allegro/connect/poll`: one step of the device login.
- `POST /admin/allegro/disconnect`: forgets the tokens.
- `POST /admin/allegro/sync` with `{ "what": "offers" | "orders" | "all" }`: starts a sync (202, runs in the background).
- `GET /admin/allegro/offers`: the snapshot, with `filter` (all, linked, unmatched, stock, ended_in_stock, ended, drafts, nokey), `q`, `limit` and `offset`.
- `GET /admin/allegro/orders`: the journal, with `filter` (all, open, sent, cancelled, unmatched), `q`, `limit` and `offset`.
- `GET /admin/allegro/runs`: the sync history, optionally `kind=offers|orders`.
- `GET /admin/allegro/products/:id`: offers linked to a product.
- `GET /store/allegro/products/:id`: live offers of a product for the storefront.

Run a sync from your own code:

```ts
import { syncAllegroOffersWorkflow } from "@koda-plus/medusa-plugin-allegro/workflows"

const { result } = await syncAllegroOffersWorkflow(container).run({
  input: { trigger: "manual" },
})
```

## Security

- **Write barrier:** every request goes through a check that lets only GET and HEAD reach the Allegro REST API. The two POSTs allowed go to the OAuth server: the device code request and the token endpoint.
- **Read-only scopes:** `allegro:api:sale:offers:read`, plus `allegro:api:orders:read` when the journal is on. The plugin never asks for a scope that can change the account.
- **Encrypted tokens:** AES-256-GCM with a random IV per write. The key lives in your environment, not in the database. The device code is encrypted too.
- **No personal data:** the order journal stores no buyer, address, phone, e-mail or payment details.
- **Masked logs:** secrets and token-like strings are masked in logs, the database and the admin.
- **Rate limited**, with retries only for transient errors: network, 5xx and one 60 second wait on 429.

## What this plugin does not do

- It does not publish, edit, renew or end offers, and it does not change quantities or prices. Listing stays in Allegro or in your listing tool.
- It does not import Allegro orders as Medusa orders, and it does not change their status.
- It does not handle Allegro messages, disputes or returns.
- One Allegro seller account per Medusa store.

Writes (lowering an Allegro quantity to what Medusa has, behind an explicit option) are on the roadmap. If you need two-way Allegro sync with order import and price automation today, look at [@zanreal/medusa-allegro](https://www.npmjs.com/package/@zanreal/medusa-allegro): it takes the other route, and both can teach you something about Allegro.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers the offer and order parsers, the matching, the stock check, the write barrier, the encryption and the demo data. To try the plugin in a Medusa app, run `npx medusa plugin:publish` here, then `npx medusa plugin:add @koda-plus/medusa-plugin-allegro` in the app.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. The device login, the offer read and the matching come from the Allegro integration we maintain for a tyre and wheel retailer with about 4 000 live offers, next to our OLX, BaseLinker and InPost integrations. Need a custom Allegro flow, an integration or a Medusa store? Write to kontakt@koda.plus.

## Trademarks

Allegro and the Allegro logo are trademarks of their owner, used here only to identify the marketplace this plugin connects to. This is an independent integration built on the public Allegro REST API, not affiliated with or endorsed by Allegro.

## License

MIT, see [LICENSE](./LICENSE).
