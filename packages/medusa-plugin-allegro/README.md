# Allegro by Koda Plus

Connect an Allegro seller account to Medusa: link every offer to its product variant by signature, see where Allegro and Medusa disagree on stock before buyers do, import Allegro orders into Medusa exactly once, and send quantities, parcels, invoices, prices and draft offers back to Allegro.

Read only until you decide otherwise. Every writer (the order import included) is off until it is allowed in the plugin options AND armed by a person in the admin, and the HTTP client lets through only the exact requests of the writers that are armed.

![Allegro page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-allegro/docs/admin-allegro.png)

**Live demo:** Medusa admin [medusa.koda.plus/app/allegro](https://medusa.koda.plus/app/allegro?demo=en), signed in to a public demo account by the link itself. The demo runs the plugin in demo mode (`demo: true`): a simulated Allegro account built from the store's catalog, so every screen has data and every writer can be armed without touching Allegro.

## What it syncs

- **Seller account** (OAuth 2.0 device flow): the seller types a short code at allegro.pl. No redirect URI, no public callback route.
- **Offers** (id, name, status, price, quantity, signature): Allegro to Medusa, every hour at minute 45 and on **Sync now**.
- **Offer to variant links**, one primary offer per variant, and the **stock check**: inside Medusa, on every offer sync.
- **Order journal** (status, fulfillment status, lines, total; no buyer data): Allegro to Medusa, every ten minutes.
- **Orders** (writer `orders`): Allegro to Medusa, every two minutes from the Allegro order event journal, exactly once per checkout form.
- **Quantities** (writer `stock`): Medusa to Allegro, every 15 minutes, plan first.
- **Parcel numbers and seller status** (writer `shipping`): Medusa to Allegro, on every fulfillment and shipment and every five minutes.
- **Invoice PDFs** (writer `invoices`): Medusa to Allegro, when the Fakturownia plugin (or any invoicing tool) announces a document, and every five minutes.
- **Prices** (writer `prices`): Medusa to Allegro, every hour at minute 52, plan first, inside bounds from metadata.
- **Draft offers by EAN** (writer `publish`): Medusa to Allegro, every hour at minute 57, plan first, drafts only.
- **Customer returns, disputes, claims and unread messages**: Allegro to Medusa, read only, at minutes 20 and 50.
- **Live offer links** for an "Also on Allegro" button: Medusa to your storefront through `GET /store/allegro/products/:id`.

## Features

- **Allegro page in the admin sidebar**, not hidden under Settings, with a **Panel** and a **Setup guide** view (`?view=guide` opens the guide directly). The panel has counters, the account, the writers, the imported orders, the stock and price plans, the offers, the order journal, the parcels and invoices outbox, customer issues, draft offers and the history. Lists open on deep links (`?filter=`, `?q=`).
- **Cards on the product and the order page:** the Allegro offers of a product, and for an imported order what Allegro knows about it (payment, buyer login, delivery and pickup point, totals on both sides, parcels and invoices sent, returns and disputes), with "Mark as handled" and "Retry".
- **Two switches per writer:** `writes.<writer>` in the options (a hard switch: `false` cannot be overridden from the admin) and a toggle a person flips in the admin. The admin shows who armed it and when.
- **Plan first:** the stock, price and draft writers compute a plan (what would change, from what to what, and why the rest is left alone), the admin shows it, and only an armed writer applies it, with a per run cap and a quarantine for items that keep failing. An incomplete read plans nothing; offers missing from a read are never touched.
- **Circuit breaker:** a writer that fails `breakerThreshold` times in a row (default 5) disarms itself and says why. Failures of one item do not count.
- **Exactly once orders:** one row per checkout form before anything happens, an atomic claim with a lease, a lookup of `metadata.marketplace_order_ref` before every create, repeated inside the lock `marketplace-order-ref:<ref>` that the BaseLinker plugin takes too. Which orders are the plugin's own is decided by its import table, never by order metadata.
- **Orders that look like any order:** created as a draft and placed by Medusa's own `convertDraftOrderWorkflow` (stock reserved, `order.placed` emitted), with Allegro prices as tax inclusive lines, tax lines from the region, the delivery method and pickup point, a payment collection marked paid when Allegro holds the money, and no customer account.
- **Stock writer that cannot hurt:** decreases by default, ends sold out offers (Allegro cannot hold zero) and never activates an ended offer, re-reads every planned offer right before the command, and refuses a whole plan that looks like a broken read (most variants at zero, or a large share of live offers to end).
- **Parcels and statuses once each**, with the carrier from Allegro's own carrier list (or your `carriers` map), and a seller status that never moves backwards.
- **Invoices once each**, from the Fakturownia plugin of Koda Plus (VAT invoices and corrections) or from any tool through an event, with the 3 MB and real PDF checks before anything is sent, in their own outbox and sweep.
- **Customer issues at a glance:** open returns, disputes and claims, the ones waiting for your answer, due dates and unread message threads, with links to the right place in the seller panel. The plugin never answers for you.
- **Signature matching:** the offer `external.id` (the "sygnatura" sellers, feeds and BaseLinker fill with the SKU) against the variant SKU, case insensitive, never by offer name.
- **Production and sandbox:** `environment: "sandbox"` talks to allegro.pl.allegrosandbox.pl. Tokens of one environment are never used against the other.
- **Demo mode** (only with `demo: true`): a simulated Allegro account built from your catalog runs through the same parsers, planners and workflows as a real one. Evaluate everything without an Allegro developer account.
- **Events for your own alerts:** `allegro.writer.tripped`, `allegro.import.held` and `allegro.outbox.failed`.
- **Works with Koda Plus hosts** through the shared contract `koda.integration/1`: one line per imported order, product or variant, board counters and cards a host can embed.
- **References:** the stores running the integration, passed in the options, shown under the counters and at the end of the guide.
- **Admin in English and Polish** through the Medusa admin translations.
- **Zero dependencies** beyond Medusa itself.

## Requirements

- Medusa 2.12 to 2.21 and Node.js 20+ (see Compatibility).
- For a real account: an app registered at apps.developer.allegro.pl (or the sandbox portal) as an app **without access to a browser**, which is the device flow.
- For the order import: a region in PLN and a sales channel linked to the stock location that ships Allegro orders.
- For the price and draft writers: PLN prices that include tax (a tax inclusive price preference for PLN in Medusa, or `prices.taxInclusive: true`).

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
        appName: "MyShopAllegro", // the name of your app at Allegro
        docsUrl: "https://myshop.example/allegro",
        // writes: { orders: true, stock: true, shipping: true, invoices: true },
        demo: process.env.ALLEGRO_DEMO === "true", // a simulated account, only when switched on
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

Missing options never break the boot: the module registers, the admin lists what is missing and the scheduled jobs wait. Missing keys never switch on demo mode: it runs only when `demo` is `true`, so a production store without keys simply waits for its configuration.

### Options

Connection:

- `clientId`, `clientSecret`: the Allegro app credentials.
- `encryptionKey`: 32 random bytes in base64. Encrypts the tokens and the device code at rest with AES-256-GCM. A wrong key never deletes the stored tokens: the account reads as not connected and the status says why, until the right key is back.
- `previousEncryptionKeys` (default `[]`): keys used before `encryptionKey`, for a key rotation. Stored tokens are read with them and saved again under the current key on the next use; remove them once the account has refreshed its token.
- `environment` (default `production`): `production` or `sandbox`.
- `demo` (default `false`): the simulated account, only when this is `true` (`demo: process.env.ALLEGRO_DEMO === "true"` in the configuration above). Nothing is sent to Allegro. Do not switch it on in a production store: with the order import armed, demo orders are created in that store (see Demo mode).
- `appName` (default none): the name of your app at Allegro. Allegro asks for `AppName/Version (+DocsUrl)` as the User-Agent with the name of the registered app.
- `docsUrl` (default `https://koda.plus`): the https address in the User-Agent.
- `userAgent` (default built from `appName` and `docsUrl`): the whole User-Agent, when you need to set it yourself.
- `requestsPerMinute` (default `300`): a self-imposed limit. Allegro allows 9 000 requests per minute per client id and blocks the client id for a minute above it.
- `timeoutMs` (default `20000`): the timeout of one request.

Reading:

- `syncEnabled` (default `true`): the hourly offer sync.
- `ordersEnabled` (default `true`): the order journal.
- `stockLocationIds` (default: all locations): the stock locations whose quantities count in the stock check and the stock writer.

Writers (each one also needs a person to arm it in the admin):

- `writes.orders`, `writes.stock`, `writes.shipping`, `writes.invoices`, `writes.prices`, `writes.publish` (default `false` each; in demo mode a writer you do not mention is allowed, except `writes.orders`, which creates orders in your store and needs `true` in demo mode too; an explicit `false` always wins). The consent asks Allegro only for the scopes of the writers allowed here: `allegro:api:sale:offers:write` for stock, prices and drafts, `allegro:api:orders:write` for parcels and invoices. After changing `writes`, connect the account again; the admin says which scopes are missing.
- `breakerThreshold` (default `5`): consecutive failures after which a writer disarms itself.

Stock writer:

- `stockPush` (default `"decrease"`): `"decrease"` only lowers Allegro quantities to what Medusa has; `"mirror"` also raises them, and only while the order import is armed, has run successfully in the last 15 minutes and holds nothing.
- `stockPushCap` (default `50`): offers one run may change.
- `endOffersAtZero` (default `true`): end the offer of a variant that sold out in Medusa (Allegro cannot set a quantity to zero). `false` only reports it.

Order import:

- `orderImport.salesChannelId` (default: a sales channel named "Allegro", otherwise the store default with a warning; in demo mode an "Allegro (demo)" channel is created and linked to the default channel's stock locations, so the stock check sees your stock; nothing is reserved for demo orders).
- `orderImport.regionId` (default: the first region in PLN).
- `orderImport.shippingOptionId` (default none): a shipping option put on every imported order, so it can be fulfilled without picking one.
- `orderImport.shippingOptions` (default `{}`): per Allegro delivery method id or name, the Medusa shipping option to use.
- `orderImport.perRun` (default `25`): orders one run creates at most.

Parcels:

- `carriers` (default `{}`): Medusa fulfillment provider id (or its prefix) to an Allegro carrier id, for example `{ "manual_manual": "OTHER", "inpost": "INPOST" }`. Without a match the carrier is looked up in Allegro's carrier list by name, then sent as `OTHER` with the provider name.

Invoices:

- `invoiceKinds` (default `["vat", "correction"]`): the Fakturownia document kinds attached to Allegro orders (`vat`, `correction`, `receipt`, `proforma`).

Prices:

- `prices.priceListId` (default: the variant's default price): read the Medusa price from this price list.
- `prices.minKey` (default `allegro_price_min`) and `prices.maxKey` (default `allegro_price_max`): variant (or product) metadata keys with the lowest and highest allowed Allegro price.
- `prices.requireFloor` (default `true`): never change a price without a floor.
- `prices.maxChangePercent` (default `30`): a bigger change is refused, never clamped.
- `prices.cap` (default `20`): offers one run may change.
- `prices.taxInclusive` (default: read from Medusa): Allegro takes gross prices. Unset, the plugin reads the PLN price preference of Medusa, and while it says the prices exclude tax (Medusa's default) the price and draft plans are refused with `tax_exclusive_prices` and nothing is sent. `true`: your PLN prices include tax. `false`: they do not, and the plans stay refused.

Draft offers by EAN:

- `publish.shippingRatesId` (required to publish): the id or name of a shipping rates set from the seller panel.
- `publish.location` (required to publish): `{ city, postCode, province, countryCode }`; for Poland `province` is required (for example `MAZOWIECKIE`) and `postCode` is `XX-XXX`.
- `publish.invoice` (default `"VAT"`): `VAT`, `VAT_MARGIN`, `WITHOUT_VAT` or `NO_INVOICE`.
- `publish.cap` (default `5`): drafts one run may create.

Customer issues:

- `issues.returns` (default `true`): customer returns, with the orders scope.
- `issues.disputes` (default `false`, `true` in demo mode): disputes and claims. Needs `allegro:api:disputes`, which has no read-only variant.
- `issues.messages` (default `false`, `true` in demo mode): unread message threads. Needs `allegro:api:messaging`, which has no read-only variant.

References:

- `references` (default `[]`): stores running the integration, `{ name, url, description?, metrics?, links?, soon? }` where texts can be `{ en, pl }`. `soon: true` marks a store that starts on Medusa soon: it is shown with a "Soon" badge and no link, and its `url` is optional. Entries without a name, or live entries without an https address, are dropped, never thrown.

## Setup in brief

The admin has the full guide (**Allegro**, then **Setup guide**), with each step ticked from the live state of your store.

1. Register an app at apps.developer.allegro.pl as an app without access to a browser, name it without spaces and copy the client id and secret.
2. Optionally do it all first in the sandbox (apps.developer.allegro.pl.allegrosandbox.pl, `environment: "sandbox"`).
3. Generate the encryption key (`openssl rand -base64 32`) and keep it in the environment.
4. Add the plugin with `clientId`, `clientSecret`, `encryptionKey`, `appName` and `docsUrl`, run `npx medusa db:migrate` and restart.
5. Click **Connect Allegro account**; the seller types the code at allegro.pl/skojarz-aplikacje.
6. Run the first offer sync and check that History shows it as OK.
7. Review the offers without a product and without a signature; fix signatures or SKUs.
8. Read the stock check and run a dry run of the stock plan.
9. Allow only the writers you will use in `writes`, then **Connect again** so the seller grants the wider scopes.
10. Arm the order import first, after a dry run in **Imported orders**; bring older orders in with the **catch-up import**.
11. Arm the stock writer and watch its plan for a day.
12. Arm parcels and status; set `orderImport.shippingOptionId` or `carriers` when needed.
13. Arm invoices (with the Fakturownia plugin or your own event).
14. Turn on customer issues if you want disputes and messages counted.
15. Optionally arm prices, after putting floors in metadata.
16. Optionally plan drafts by EAN, after setting `publish.shippingRatesId` and `publish.location`.

Arm one writer at a time, each after its dry run, and go live when the checklist at the end of the guide is all ticked.

## How the order import works

1. The import reads the Allegro order event journal (`GET /order/events`) from its cursor and writes one row per checkout form in `allegro_order_import`. Event ids are opaque: they are never compared, the events are taken in the order Allegro returns them, and the cursor moves to the last event of a page only after the page's rows are written. A fresh install starts at the newest event, so history comes in only through the **catch-up import** (orders bought between two dates, up to 62 days at once, queued once each). Allegro keeps events for 60 days; a longer pause restarts at the newest event and says so.
2. Every due row is claimed atomically and looked up in Medusa by `metadata.marketplace_order_ref = "allegro:<checkout form id>"`. An order counts as the plugin's own only when its import row names it (or it is still a draft no cart placed): such an order from an earlier attempt is adopted and finished, never created again. An order another integration imported (the BaseLinker plugin of Koda Plus writes the same key) makes this plugin step back and say so; a shopper's cart metadata can never make an order look like an Allegro one.
3. The checkout form is read fresh and mapped: every line by its offer link first, then by its signature. A line that matches no variant holds the whole order with the reason; no product is ever invented. So do a missing address, a currency the region does not use and stock Medusa cannot cover.
4. Holding the lock `marketplace-order-ref:allegro:<checkout form id>` in the Medusa Locking module, the reference is looked up again and the order is created as a draft with `createOrderWorkflow`; its id is written on the row at once. The buyer e-mail goes on the draft (no customer is created), tax lines are computed where the region left none, and the draft is placed with `convertDraftOrderWorkflow`, which reserves the stock and emits `order.placed`. A payment collection for the total follows, marked paid (captured) when Allegro holds the money and left not paid for cash on delivery. Demo orders skip the placing and the payment (see Demo mode).
5. A cancellation on Allegro cancels the Medusa order only when nothing was fulfilled; otherwise the row asks a person to handle the return. Medusa's `cancelOrderWorkflow` refunds a captured payment and emits `order.canceled`, so plugins that react to refunds (an invoice correction, for example) see it.
6. When the buyer changes the delivery address, the pickup point or the invoice data on Allegro after the import, the row asks a person to compare (the Medusa order is never changed by itself). **Mark as handled** on the order card or in Imported orders clears it.
7. A held import emits `allegro.import.held`; a person retries it with **Retry**. When Allegro or the network is away for a moment (no answer, 5xx, 429), the next run tries again and the circuit breaker does not count it, so an outage never disarms the import.

**`order.placed` is emitted on purpose,** like the BaseLinker plugin does: invoicing (the Fakturownia plugin issues the invoice the invoices writer then attaches), the ERP (the Subiekt nexo plugin creates its document) and your own stock follow-ups see Allegro orders like any other. Imported orders carry `no_notification: true` and `metadata.marketplace_order_ref`. Allegro writes to its buyer itself, so make the subscriber that sends your order confirmation skip them:

```ts
// src/subscribers/order-placed.ts in your store
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"

export default async function orderPlaced({ event, container }: SubscriberArgs<{ id: string }>) {
  const order = await container.resolve(Modules.ORDER).retrieveOrder(event.data.id, { select: ["id", "metadata", "no_notification"] })
  /* Allegro and BaseLinker orders: the marketplace already wrote to the buyer. */
  if (order.metadata?.marketplace_order_ref || order.no_notification) return
  // ...send your confirmation e-mail
}

export const config: SubscriberConfig = { event: "order.placed" }
```

What each imported order carries in its metadata: `marketplace_order_ref`, `allegro_checkout_form_id`, `allegro_marketplace`, `allegro_payment_type`, `allegro_buyer_login`, `allegro_delivery_method`, `allegro_pickup_point_id`, `allegro_invoice_required` and `nip` when the buyer asked for an invoice; demo orders also `allegro_demo` and `koda_demo`. These keys are for people and other tools; the plugin itself decides from its import table. Every line keeps `allegro_line_item_id`, `allegro_offer_id` and `allegro_offer_name`.

## The other writers

- **Stock:** for every primary offer linked to a variant, the Allegro quantity against what Medusa has available (stocked minus reserved in the chosen locations; a kit counts its scarcest part). The plan says decrease, end, increase (mirror only) or why nothing happens, and the run sends one `offer-quantity-change-command` per target value (or an `END` publication command) for at most `stockPushCap` offers, after reading every planned offer again.
- **Parcels and status:** when an imported order gets a fulfillment with tracking numbers in Medusa, each number goes to the Allegro order once (`POST /order/checkout-forms/{id}/shipments`), the seller status becomes `READY_FOR_SHIPMENT`, and `SENT` when everything shipped. Every send is looked up on Allegro first; an unclear answer is checked on Allegro before anything is sent again.
- **Invoices:** the Fakturownia plugin of Koda Plus announces `fakturownia.document.issued` and `fakturownia.document.corrected` with `{ id, order_id, kind, number, external_id, demo }`; the PDF is read through the Fakturownia module (resolved at run time, never imported) and uploaded once with `POST /order/{orderId}/billing-documents/files`, after looking at the invoices already on the order. Any other tool can emit `allegro.invoice.attach.requested` with `{ order_id, filename, url, number }` (an https address).
- **Prices:** the Medusa price (or a price list) against the price of every live linked offer, inside the floor and ceiling from metadata; a price outside them, or a change bigger than `prices.maxChangePercent`, is refused and never clamped. Only gross prices go out (see `prices.taxInclusive`). Right before the command the offer is read again, and the price goes only while Allegro still shows the price the plan started from: a price somebody changed in the seller panel waits for the next plan.
- **Draft offers:** variants with a valid EAN and no offer are matched to exactly one Allegro catalog product (several matches are never guessed) and created as `INACTIVE` drafts with the SKU as signature, at the gross Medusa price. You review and activate them on Allegro.
- Parcels and invoices of orders fulfilled or invoiced before `writes.shipping` or `writes.invoices` was allowed are not sent later: those writers start from the events they see.

## Demo mode

`demo: true`, and only that, runs a simulated Allegro account built from your catalog through the same parsers, planners and workflows as a real account, with every row flagged `demo`:

- offers for your variants, with a few deliberate mismatches (an offer without a product, one without a signature, an ended offer still in stock);
- three to five checkout forms a day at fixed times, deterministic, with buyers at `@example.com` only: online payments, cash on delivery, a company invoice with a NIP, parcel lockers, a cancellation every other day and, every third day, an order whose line has no product;
- armed writers change the simulation: quantities, ended offers, prices, drafts, parcels (a simulated courier ships imported demo orders two hours after import) and invoices (the Fakturownia demo PDF when that plugin is present, a simulated one page PDF otherwise);
- customer returns, disputes, a claim and unread threads.

The sample data is built by the job `allegro-demo-seed` (every minute, demo mode only, until every kind exists) or at once with **Prepare now** on the page (`POST /admin/allegro/demo/seed`). Opening the page never builds anything.

The order import is the one writer that touches your store, so in demo mode too it needs `writes: { orders: true }`, and the arming dialog says so. A demo order is created in this Medusa store, in the "Allegro (demo)" sales channel, with `metadata.koda_demo: true`, and moved from draft to `pending` in the order module itself: it is never placed or paid, so no stock is reserved, no `order.placed` or `payment.captured` reaches invoicing, the ERP or e-mails, and a cancellation on the simulated account cancels it quietly (no `order.canceled`, no refund). Other plugins can skip such orders by `metadata.koda_demo`; the proof is `allegro_order_import.demo`.

Nothing is ever sent to Allegro in demo mode.

## Events

The plugin emits Medusa events with ids, codes and the mode, never buyer data, so you can wire a Discord ping or an e-mail without polling the admin:

- `allegro.writer.tripped` `{ writer, failures, message, demo }`: the circuit breaker disarmed a writer.
- `allegro.import.held` `{ import_id, checkout_form_id, reason_code, demo }`: an Allegro order is waiting for a person.
- `allegro.outbox.failed` `{ outbox_id, writer, checkout_form_id, order_id, demo }`: a parcel, status or invoice could not be sent.

```ts
// src/subscribers/allegro-alerts.ts in your store
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

export default async function allegroAlerts({ event }: SubscriberArgs<Record<string, unknown>>) {
  if (event.data.demo) return
  // post event.name and event.data to your channel
}

export const config: SubscriberConfig = { event: ["allegro.writer.tripped", "allegro.import.held", "allegro.outbox.failed"] }
```

## API routes

All admin routes need an admin session or token.

- `GET /admin/allegro`: status, counters, writers, plans, imports, outbox, issues, references, the last runs and, in demo mode, `demoSeed` (the sample data not built yet). Reads only.
- `POST /admin/allegro/demo/seed`: demo mode, build the missing sample data now (202).
- `POST /admin/allegro/connect` and `POST /admin/allegro/connect/poll`: the device login. `POST /admin/allegro/disconnect`: forget the tokens.
- `POST /admin/allegro/sync` with `{ "what": "offers" | "orders" | "all" }`: a sync in the background (202).
- `GET /admin/allegro/offers`: the snapshot, with `filter` (all, linked, unmatched, stock, ended_in_stock, ended, drafts, nokey), `q`, `limit`, `offset`.
- `GET /admin/allegro/orders`: the journal, with `filter` (all, open, sent, cancelled, unmatched, imported, held), `q`, `limit`, `offset`; every row carries its import and Medusa order.
- `POST /admin/allegro/writers/:key` with `{ "armed": true | false }`: arm or disarm `orders`, `stock`, `shipping`, `invoices`, `prices` or `publish` (409 with the reason when it cannot be armed).
- `GET /admin/allegro/plans?kind=stock|prices|publish`: a plan, with `filter`, `q`, `limit`, `offset`. `POST /admin/allegro/plans` with `{ kind, mode: "plan" | "apply" }`: a dry run now, or plan and apply in the background (409 when the writer is not armed). `POST /admin/allegro/plans/:id/release`: take an item out of quarantine.
- `GET /admin/allegro/imports`: the imported orders, with `filter` (all, imported, held, pending, attention, skipped, cancelled), `q`, `limit`, `offset`. `POST /admin/allegro/imports` with `{ mode: "plan" | "apply" }`: a preview of the next run, or a run now (409 when the writer is not armed). `POST /admin/allegro/imports/window` with `{ from, to }`: the catch-up import, queue the forms bought between two dates. `POST /admin/allegro/imports/:id/retry`: retry a held or skipped form. `POST /admin/allegro/imports/:id/handled`: a person checked an order that needed attention.
- `GET /admin/allegro/medusa-orders/:id`: what Allegro knows about one Medusa order (its import, parcels and invoices sent, returns and disputes), for the order card; `import: null` for an order the plugin did not import.
- `GET /admin/allegro/outbox?writer=shipping|invoices&status=`: parcels, statuses and invoices. `POST /admin/allegro/outbox` with `{ writer }`: send what is due now. `POST /admin/allegro/outbox/:id/retry`: retry a failed row.
- `GET /admin/allegro/issues`: returns, disputes and claims, with `filter` (open, needs_reply, returns, disputes, claims, all). `POST /admin/allegro/issues`: refresh now.
- `GET /admin/allegro/runs`: the history, optionally `kind` (offers, orders, stock, prices, import, shipping, invoices, issues, publish).
- `GET /admin/allegro/products/:id`: offers linked to a product.
- `GET /store/allegro/products/:id`: live offers of a product for the storefront.
- `GET /admin/allegro/integration`, `GET /admin/allegro/integration/summary`, `GET /admin/allegro/integration/attention`: the `koda.integration/1` contract (see below).

Writes need a JSON body (`Content-Type: application/json`) or the `x-koda-request` header. A server error answers a plain message; the details go to the server log, masked. No route uses DELETE.

## Works with Koda Plus hosts

An app that shows every Koda Plus plugin in one place (like [medusa.koda.plus](https://medusa.koda.plus/app/orders?demo=en)) reads Allegro through the shared contract `koda.integration/1` and never needs to know its tables:

- `GET /admin/allegro/integration`: the manifest (mode, configuration, writers armed, widgets, problems).
- `GET /admin/allegro/integration/summary?entity=order&id=order_...` (or `ids=`, up to 50; also `entity=product` and `entity=variant`): one line per record. An order has a line only when the plugin imported it, by its import row, never by order metadata: a changed or cancelled order after the import or a total that differs is red, a held import orange, an import under way blue, an imported order green. Its facts: `channel` (`Allegro`, code `allegro`, the buyer login, priority 80), `payment` (code `cod` for cash on delivery or `paid` when paid on Allegro, priority 70), `delivery` (the Allegro delivery method and pickup point, priority 60; InPost's own parcel fact at 80 wins in a host) and `buyer` (the login, priority 60). A product or variant speaks through its linked offers: a stock problem (Allegro sells more than Medusa has, or a sold out variant still live) is orange, a live offer green, drafts and ended offers grey, with a `listing` fact that links the offer on allegro.pl (the sandbox host in sandbox mode, the plugin page for demo offers).
- `GET /admin/allegro/integration/attention?scope=orders,products`: counters `imports_attention` (red), `imports_held`, `issues_open` and `offers_stock_problem` (orange), each with a link to its list (`/allegro?filter=attention`, `/allegro?filter=held`, `/allegro?filter=issues`, `/allegro?filter=stock`).
- The cards register as `allegro.order` for the zone `order.details` (hidden for orders without a line) and `allegro.product` for the zone `product.details`; a host that claims the zone shows them as a tab (`embedded`) and Medusa's own spot stays empty. Without a host nothing changes.
- The page opens on deep links: `?filter=` (offers: `all`, `linked`, `unmatched`, `stock`, `ended_in_stock`, `ended`, `drafts`, `nokey`; imports: `held`, `attention`, `pending`, `imported`, `skipped`, `cancelled`; orders: `open`, `sent`; issues: `issues`, `needs_reply`, `returns`, `disputes`, `claims`), `?q=` (a search in that list) and `?list=offers|orders|imports|issues` when a filter alone is ambiguous, for example `/allegro?filter=attention&q=<checkout form id>`.

## Public API

What other code may import: `@koda-plus/medusa-plugin-allegro/workflows` (the workflows and the functions below), `@koda-plus/medusa-plugin-allegro/modules/allegro` (the module and its options) and `/admin`. Type declarations ship with the package. Every other path is internal and may change in any release.

## Workflows and functions

From `@koda-plus/medusa-plugin-allegro/workflows`: `syncAllegroOffersWorkflow`, `syncAllegroOrdersWorkflow`, `importAllegroOrdersWorkflow`, `pushAllegroStockWorkflow`, `pushAllegroPricesWorkflow`, `pushAllegroShipmentsWorkflow`, `attachAllegroInvoicesWorkflow`, `syncAllegroIssuesWorkflow`, `publishAllegroOffersWorkflow`, and the functions behind them (`runOrderImport`, `queueCatchUpImport`, `retryImport`, `markImportHandled`, `runStockPush`, `runPricePush`, `runShipping`, `runInvoices`, `runIssues`, `runPublish`, `seedDemo`, `createAllegroDraft`, `completeAllegroOrder`), plus `allegroIntegration` (the contract routes as functions).

```ts
import { pushAllegroStockWorkflow } from "@koda-plus/medusa-plugin-allegro/workflows"

/* A dry run: the plan, nothing sent. */
const { result } = await pushAllegroStockWorkflow(container).run({
  input: { trigger: "manual", mode: "plan" },
})
```

## Security

- **Write allowlist:** every request to the Allegro REST API goes through a check that lets GET and HEAD through and, for anything else, only the exact method and path of a writer that is armed right now: `PUT /sale/offer-quantity-change-commands/{uuid}` and `PUT /sale/offer-publication-commands/{uuid}` with `END` only (stock), `PUT /sale/offer-price-change-commands/{uuid}` (prices), `POST /order/checkout-forms/{uuid}/shipments` and `PUT /order/checkout-forms/{uuid}/fulfillment` (parcels), `POST /order/{uuid}/billing-documents/files` (invoices), `POST /sale/product-offers` with an `INACTIVE` publication only (drafts). The bodies are checked too: a quantity must be a positive whole number, an offer is never activated. The only other POSTs go to the OAuth server.
- **Narrow scopes:** read scopes, plus the write scopes of the writers allowed in `writes`, plus disputes and messaging only when switched on.
- **Encrypted tokens:** AES-256-GCM with a random IV per write; the key lives in your environment, not in the database. A configuration mistake never costs the seller a new consent: a wrong key or a wrong client secret leaves the tokens in place, and only Allegro's `invalid_grant` (the consent itself is gone) disconnects the account. `previousEncryptionKeys` rotates the key.
- **Admin writes from the admin only:** every write to `/admin/allegro*` needs a JSON body or the `x-koda-request` header, which a form on another site cannot send, so a cross-site request cannot arm a writer or disconnect the account.
- **Reserved metadata:** the store routes (carts, line items, the customer) refuse `allegro_*`, `marketplace_order_ref` and `koda_demo` in shopper metadata (400 `reserved_metadata_key`). The plugin never trusts those keys anyway: its own tables are the record.
- **One refresh across processes:** a lease in the database serializes token refreshes between a server and a worker, because each refresh hands out a new refresh token and the previous one stops working about a minute later.
- **Leases and locks:** one stock, price or draft run at a time across processes; one importer per marketplace order through the shared lock.
- **Secrets stay on the server:** the client secret, the keys and the tokens never reach the admin or an answer. They and any long token-like string are masked in logs, stored errors and the admin; a server error answers a plain message without the exception text.
- **Rate limited**, with retries only for transient errors: network, 5xx and 429. A write that got no clear answer is never repeated blindly: it is looked up on Allegro first.

## Personal data

The plugin's own tables store ids, statuses, amounts, dates, reason codes and reasons, never a buyer's name, address, e-mail or phone, and never the text of a dispute or message. The import row of an order keeps the buyer's Allegro login, the delivery method and the pickup point (for the order card) and a short hash of the delivery and invoice data (to notice a change after the import), not the data itself. The order import needs the buyer's data to ship the order, so it puts it where any store order keeps it: in the Medusa order (the delivery and invoice addresses, the phone, Allegro's masked buyer e-mail, the buyer login and the NIP when an invoice was asked for). No customer account is created. In demo mode every buyer is fictional, at `@example.com`.

## Out of scope

- Writing offers from scratch (descriptions, photos, parameters): drafts by EAN reuse a product from the Allegro catalog, and a person activates them on Allegro.
- Offer content, renewals and reactivation of ended offers; promotions, price automation rules on Allegro, fees and campaigns.
- Talking to buyers: messages, disputes, claims, accepting returns and refunds stay in the seller panel, which the plugin links to.
- Instant stock pushes: the stock writer runs on its 15 minute schedule.
- Labels and courier orders (Allegro Delivery, Wysyłam z Allegro): the plugin sends the tracking numbers your fulfillment already has.
- Issuing invoices: the Fakturownia plugin or your own tool does it, the plugin attaches the PDF.
- More than one seller account per store, or an Allegro marketplace other than allegro.pl for the import.
- A run against a real Allegro account: the writers are tested against fakes and in demo mode on Medusa 2.15.3, and every call follows the official documentation (`docs/allegro-api-notes.md`). Start in the sandbox.

## Uninstall

1. Disarm every writer in **Settings**, then **Disconnect** the account. The consent stays on the Allegro side until the seller removes it in the account settings (Allegro, Moje Allegro, connected apps).
2. Remove the plugin from `medusa-config.ts` and the package from `package.json`.
3. The tables `allegro_*` stay with your data; drop them by hand when you no longer need the history. Imported orders stay in Medusa with their `allegro_*` metadata, as any order would.
4. After a demo: the demo orders (`metadata.koda_demo`, channel "Allegro (demo)") reserved nothing; cancel or archive them, then delete the "Allegro (demo)" sales channel.

## Compatibility

Medusa 2.12 to 2.21 (peer range `^2.12.0`) and Node.js 20+. The release of each version runs the smoke test on a fresh Medusa 2.12.6 and 2.21.2 app: migrations, build, start and the admin pages. Developing the plugin needs Node.js 22.6+ (the tests run the TypeScript sources directly).

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers the parsers, the matching, the stock check and both planners, the event journal with opaque ids (pages, restarts, repeats), the order import state machine (exactly once, the shared lock, drafts finished after a crash, ownership by the import row), demo orders that are never placed or paid, the outbox, carriers, invoices, issues, drafts, gross prices only, the write allowlist, the writers, the circuit breaker and its event, tokens kept on key and secret mistakes, the route guards, the store SQL, the encryption, the demo simulation and the `koda.integration/1` contract. To try the plugin in a Medusa app, run `npx medusa plugin:publish` here, then `npx medusa plugin:add @koda-plus/medusa-plugin-allegro` in the app.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. The device login, the offer read and the matching come from the Allegro integration we maintain for a tyre and wheel retailer with about 4 000 live offers, next to our OLX, BaseLinker, Subiekt nexo and Fakturownia integrations. Need a custom Allegro flow, an integration or a Medusa store? Write to kontakt@koda.plus.

## Trademarks

Allegro and the Allegro logo are trademarks of their owner, used here only to identify the marketplace this plugin connects to. This is an independent integration built on the public Allegro REST API, not affiliated with or endorsed by Allegro.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-allegro/LICENSE).

## Changelog

### 0.3.0 (unreleased)

Opaque event ids in the order import; demo mode only with `demo: true` and demo orders that are never placed or paid; gross prices only for prices and drafts; tokens kept on configuration mistakes; reads that never write; writes only from the admin or a server; the `koda.integration/1` contract with embeddable product and order cards and deep links; events for your alerts; type declarations. Full list in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-allegro/CHANGELOG.md).
