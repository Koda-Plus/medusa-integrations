# Subiekt nexo by Koda Plus

Connect Medusa to **Subiekt nexo PRO** (InsERT), the most common ERP of Polish shops. Orders become ZK documents in Subiekt seconds after checkout, the WZ the warehouse issues comes back to the order, the invoice (FS) or receipt (PA) is issued in Subiekt with its KSeF number shown on the order, company buyers land on their own contractor by NIP, and stock and prices flow from Subiekt to Medusa. Your team keeps working in Subiekt; Medusa stays the storefront. Nothing new is written anywhere until a person allows it.

![Subiekt nexo page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-subiekt-nexo/docs/admin-subiekt.png)

**Live demo:** Medusa admin [medusa.koda.plus/app/subiekt](https://medusa.koda.plus/app/subiekt?demo=en), signed in to a public demo account by the link itself. The demo runs the plugin with its simulated bridge, so every screen has data, including the setup guide at `?view=guide`.

## How it works

Subiekt nexo has no web API. Its SDK, **Sfera**, is a Windows .NET library that runs next to the Subiekt database. So the integration has two parts that talk over one signed, documented HTTP contract:

```
 Medusa (anywhere)                         Windows machine next to Subiekt
 +----------------------------+  HTTPS    +----------------------------+  Sfera SDK  +------------------+
 | this plugin                | --------> | bridge (Windows service)   | ----------> | Subiekt nexo PRO |
 |  task queue, plans,        |  signed   |  contract/openapi.yaml     |             |  SQL Server      |
 |  writers, admin, guide     | <-------- |  event feed, WZ and KSeF   |             +------------------+
 +----------------------------+  webhook  |  watchers                  |
                                          +----------------------------+
```

- **This plugin** (MIT) is everything on the Medusa side: when to send an order, retries, plans, writers, the admin and the setup guide.
- **The bridge** implements [`contract/openapi.yaml`](contract/openapi.yaml) (version 1.1.0). Koda Plus builds and runs a production bridge on the Sfera SDK (commercial, see [The bridge](#the-bridge)); any bridge that follows the contract works, and the plugin ships a **demo bridge** so you can evaluate everything without Subiekt.

The bridge usually sits behind a Cloudflare Tunnel, so the Subiekt machine opens no inbound port. The plugin reads what the bridge can do from `capabilities` in `GET /v1/health` and uses only that, so you can update the plugin before the bridge: a contract 1.0 bridge keeps doing orders, WZ, stock and events, and the admin says what needs the update.

## What it syncs

- **Orders to ZK** (zamówienie od klienta): Medusa to Subiekt, on `order.placed`. Prepaid orders (card, BLIK, Przelewy24, PayU...) wait for the capture first, so the warehouse never packs an order that may still fail to pay. Lines are matched by EAN first, then SKU against the product symbol, with the gross price the customer paid.
- **Company buyers by NIP** (new in 0.2.0): the plugin finds the buyer's NIP where your checkout keeps it (`nipSources`), checks its checksum and sends it with the order. The bridge issues the ZK to the contractor with that NIP and, when allowed, creates a missing one, never a second one for the same NIP. An invalid NIP goes to the retail buyer with a warning in the admin.
- **Cancellations**: Medusa to Subiekt, on `order.canceled`. Refused once a WZ or a sales document exists. Sfera cannot set every ZK status, so the bridge marks what it can and the admin says honestly when someone must finish it in Subiekt.
- **WZ issued in the warehouse**: Subiekt to Medusa, through the bridge event feed. The WZ number lands in the order metadata, the plugin emits `subiekt.document_issued`, and with `fulfillOnWz` it creates the Medusa fulfillment.
- **WZ from Medusa fulfillments** (optional, `issueWzOnFulfillment`): Medusa to Subiekt.
- **Sales documents with KSeF** (new in 0.2.0, `salesDocument`): the FS or PA of each order, issued in Subiekt after the WZ (or right after the ZK), exactly once. The KSeF number appears on the order and in the admin as soon as Subiekt has sent the e-invoice.
- **Stock**: Subiekt to Medusa, every 10 minutes, into the inventory levels of one stock location.
- **Products and prices** (new in 0.2.0): Subiekt to Medusa, every hour, planned first. Prices of one Subiekt price level go to the variant prices or to a price list; Subiekt products meant for the online shop and missing in Medusa can become draft products.

## Features

- **Write safety.** Every write added in 0.2.0 (prices, new products, sales documents, new contractors) has two switches: its option in `medusa-config.ts` (false wins, the admin cannot override it) and a writer a person arms in the admin, recorded with who and when. All of them ship off.
- **Plan first.** Prices and new products are computed as a plan (what changes, from what to what) and shown in the admin before anything is written. An incomplete read from the bridge plans nothing. Each run applies at most `maxPriceChangesPerRun` prices and `maxProductsPerRun` products, reads every item again right before it writes, skips what changed meanwhile, and quarantines an item that failed three runs in a row until a person releases it.
- **Exactly once.** One task row per order and operation before anything goes to the network, claimed atomically. The bridge writes the order tag `[medusa:order_...]` into every document and looks for it before it creates one, under the order lock and again under the Sfera lock. An unclear answer (a timeout) becomes "Answer unclear" and the next attempt asks the bridge first.
- **Outbox with retries.** Every call to the bridge is a row first and a request second, retried with backoff for about two and a half days, so a bridge machine switched off over a weekend loses nothing. A task fails for good only on a non-retryable error, and then it waits in the admin with a **Send again** button.
- **Setup guide in the admin** ("Panel" | "Setup guide", `?view=guide`), in English and Polish: what you need, how the parts talk, twelve steps from an empty Windows machine to production with live states, a go-live checklist ticked from the live status, and troubleshooting from real failure modes. The same guide as Markdown: [docs/guide-en.md](docs/guide-en.md), [docs/guide-pl.md](docs/guide-pl.md).
- **Bridge diagnostics**: bridge, contract, nexo SDK and database versions, the Subiekt licence state, round trip, clock skew (signatures fail beyond five minutes, the admin warns from one), the result of the last signed request, the last event, what the bridge can do and what it cannot yet, with the reason and the setting to change.
- **Admin page** with the connection, the writers, the stock plan, the products and prices plan with filters and quarantine, the queue, documents (ZK, WZ, FS, PA with KSeF numbers) and the history of background runs. "Running in production" cards from the `references` option.
- **Order widget**: the ZK, WZ and FS or PA of the order with the KSeF number, the contractor Subiekt got, warnings, **Send to Subiekt now** and **Issue invoice** or **Issue receipt**.
- **Safe stock sync.** Ambiguous matches (one EAN on two products, one inventory item pulled two ways) are reported and never written. Products missing from a reading are never zeroed. Kit components are matched by their own SKU. `stockDryRun` records the plan without writing.
- **Signed both ways.** HMAC-SHA256 over timestamp, method, path and raw body, with secret rotation and a 5 minute window. Optional Cloudflare Access service token.
- **Demo mode.** A simulated bridge inside Medusa: ZK numbers in seconds, a WZ about three minutes later, FS or PA after it with a KSeF number two minutes later, contractors by NIP, stock and prices computed from your catalog (with price levels and a few EAN conflicts), health with every capability and a small clock skew. Writers armed in the demo only simulate.
- **Workflows included**, in the spirit of the [Medusa ERP recipe](https://docs.medusajs.com/resources/recipes/erp): `sendOrderToSubiektWorkflow`, `cancelOrderInSubiektWorkflow`, `createSubiektWzWorkflow`, `issueSubiektDocumentWorkflow`, `syncSubiektStockWorkflow`, `syncSubiektProductsWorkflow`, `pullSubiektEventsWorkflow`, `checkSubiektConnectionWorkflow`, `processSubiektTasksWorkflow`.

## Requirements

- Medusa 2.12 or newer (tested on 2.15.3), Node.js 20+.
- For a real Subiekt: Subiekt nexo PRO (it includes "Sfera dla Subiekta nexo"; the separate Sfera PRO+ module is not needed), the nexo SDK of the same version as your Subiekt database, and a Windows machine that runs all the time with access to the nexo SQL Server, .NET 8 SDK and the bridge. Contract 1.1 features need bridge 0.2.0 or newer.

## Installation

```bash
npm install @koda-plus/medusa-plugin-subiekt-nexo
```

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-subiekt-nexo",
      options: {
        bridgeUrl: process.env.SUBIEKT_BRIDGE_URL, // https://subiekt-bridge.your-shop.pl
        secret: process.env.SUBIEKT_SECRET, // the same value as Bridge:Secret
        stockDryRun: true, // plan stock first
        // demo: true, // simulated bridge, no Subiekt needed
      },
    },
  ],
})
```

Generate the shared secret with `openssl rand -hex 32` and put the same value in the bridge configuration. Then run the migrations and open **Subiekt nexo** in the admin sidebar:

```bash
npx medusa db:migrate
```

### Options

Connection:

- `bridgeUrl`: base URL of the bridge. Use an origin; a path prefix must reach the bridge unchanged.
- `secret`: shared HMAC secret, 16 characters at least, 64 hex characters recommended.
- `previousSecret`: accepted on incoming webhooks while you rotate the secret.
- `cfAccessClientId`, `cfAccessClientSecret`: Cloudflare Access service token, when the tunnel is protected by Access.
- `timeoutMs` (default `30000`): one bridge request.
- `demo` (default `false`): the simulated bridge.

Orders and WZ:

- `prepaidProviders` (default: Stripe, Przelewy24, PayU, Tpay, PayPal, Adyen, Mollie prefixes): payment providers whose orders wait for the capture. Prefix match on the provider id.
- `codProviders` (default `pp_cod`, `pp_cash`): providers meaning cash on delivery.
- `issueWzOnFulfillment` (default `false`): a Medusa fulfillment asks the bridge for a WZ.
- `fulfillOnWz` (default `false`): a WZ from Subiekt creates the Medusa fulfillment for the remaining items.
- `eventsEnabled` (default `true`): read the bridge event feed.
- `omitLinesWithoutCode` (default `false`): leave lines without EAN and SKU (services, gift cards) off the ZK instead of failing the order.
- `forwardMetadataKeys` (default none): order metadata passed to the bridge.

Buyers and sales documents (0.2.0):

- `nipSources` (default: `metadata.tax_id`, `metadata.nip`, `metadata.vat_id`, `metadata.invoice_nip`, `metadata.company_tax_id`, the same keys under `billing_address.metadata.`, then `billing_address.company`): where to look for the buyer's NIP, in this order. A NIP failing the checksum is reported, never sent.
- `taxIdMetadataKeys`: the 0.1.0 way to name the metadata keys; when set and `nipSources` is not, the sources are built from it.
- `createContractors` (default `false`, `true` in demo mode): hard switch of the contractors writer; lets the bridge create a contractor that does not exist yet. The bridge must allow it too (`Bridge:Subiekt:BuyerMode` `customer`, `Bridge:Subiekt:CreateContractors` `true`).
- `salesDocument` (default `"none"`, `"auto"` in demo mode): `"fs"` (always an invoice), `"pa"` (always a receipt), `"auto"` (FS with a valid NIP, PA otherwise) or `"none"`. The hard switch of the documents writer.
- `salesDocumentAfter` (default `"wz"`): issue the sales document after the WZ (the goods left) or right after the ZK (`"zk"`).

Stock:

- `stockSyncEnabled` (default `true`), `stockLocationId` (optional when the store has one location), `stockField` (`quantity`, physical, default, or `available`, minus ZK reservations), `stockDryRun` (default `false`).
- `stripSkuSuffixes` (default none): SKU suffixes removed before matching stock, for example `["-WH"]` for wholesale variants of one Subiekt product. Not used for prices.

Products and prices (0.2.0):

- `productSyncEnabled` (default `true`): read products and prices every hour and plan. Read only.
- `priceLevel` (default: the first level the bridge publishes): the Subiekt price level (symbol or name) the prices come from.
- `priceType` (default `"gross"`): `"gross"` or `"net"`.
- `priceCurrency` (default `"pln"`): the currency written; a level in another currency plans nothing.
- `priceTarget` (default `"variant"`): the variant's own price, or `"price_list"` with `priceListId` (`plist_...`).
- `priceWriter` (default `false`, `true` in demo mode): hard switch of the price writer.
- `maxPriceChangesPerRun` (default `200`).
- `createMissingProducts` (default `false`, `true` in demo mode): hard switch of the product creator. Subiekt products meant for the online shop ("Sklep internetowy"), with a price in the level and missing in Medusa become draft products with one variant.
- `maxProductsPerRun` (default `20`).

Admin:

- `references`: stores that run the integration in production, shown as cards under the counters and at the end of the guide: `[{ name, url, description?, since?: "2026-04", metrics?: [{ label, value }], links?: [{ label, url }] }]`, every text either a string or `{ en, pl }`. Entries without a name or an https URL are dropped.

Missing options never break the boot: the module registers, the admin lists what is missing, and nothing is queued until the plugin is configured, so a store configured a week after installing does not flood Subiekt with a week of old orders. In demo mode the 0.2.0 hard switches default to on, because the writers only touch the simulation there; nothing is armed until a person arms it, except the documents and contractors writers the demo arms once as "demo (automatic)".

## Setup in brief

The full guide with live states is in the admin (`/app/subiekt?view=guide`) and in [docs/guide-en.md](docs/guide-en.md).

1. **Subiekt nexo PRO**: an operator for the bridge, the warehouse for new ZK, the retail buyer and its NIP, the price level to publish; note the exact Subiekt version.
2. **nexo SDK and .NET 8** on a Windows machine that runs all the time next to the database; the SDK version must equal the database version.
3. **The bridge as a Windows service**: `deploy\install-service.ps1 -ServiceUser "SERWER\integracja"`, fill in `appsettings.Local.json`, run it again (it runs `--check` before it creates the service).
4. **Cloudflare Tunnel**: Networking, Tunnels, Create a tunnel; route a published application to `http://127.0.0.1:5280`.
5. **Cloudflare Access** (optional): a service token and a Service Auth policy; set `cfAccessClientId` and `cfAccessClientSecret`.
6. **The plugin**: `bridgeUrl`, `secret`, `stockDryRun: true`, every writer off; `npx medusa db:migrate`.
7. **Check connection**: versions, licence, signatures accepted, clock skew under a minute.
8. **Read stock and products**: review the stock plan, unmatched codes and the price plan.
9. **Test order**: the ZK in seconds, the WZ issued from it comes back.
10. **Invoices, receipts, contractors**: `salesDocument`, `nipSources`, `createContractors`, arm the writers.
11. **Prices and new products**: `priceWriter`, `createMissingProducts`, read the plan, arm the writers.
12. **Go live**: `stockDryRun: false`, the bridge webhook, alerts on `subiekt.task_failed`, the go-live checklist complete.

## The order lifecycle

1. `order.placed`: the order gets an `order.create` task. Due at once for cash on delivery, bank transfer, trade credit and manual payments; **waiting** for prepaid providers until `payment.captured`.
2. The queue sends it right away (the scheduled job every minute is the safety net and the retry clock). The bridge matches the lines, finds or creates the contractor for a company buyer, and creates the ZK; the plugin stores it, writes `subiekt_zk_number` into the order metadata and emits `subiekt.document_issued`.
3. The warehouse issues the WZ from the ZK in Subiekt. The bridge watcher announces it in the event feed (and nudges Medusa through `POST /hooks/subiekt`); the plugin writes `subiekt_wz_number` and, with `fulfillOnWz`, fulfills the order.
4. With `salesDocument` set and the documents writer armed, the WZ (or the ZK, with `salesDocumentAfter: "zk"`) queues the `order.document` task: the bridge issues the FS or PA realizing the WZ (or the ZK), the plugin writes `subiekt_sales_document_number` and `subiekt_sales_document_kind`. When Subiekt has sent the e-invoice, the bridge publishes `document.updated` with the KSeF number; the plugin writes `subiekt_ksef_number` and emits `subiekt.document_updated`.
5. `order.canceled`: if the ZK was never attempted, the queued create is simply canceled; otherwise the bridge cancels the ZK, or refuses with `document_locked` once a WZ or a sales document exists.

![The order page widget: ZK and WZ of the order](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-subiekt-nexo/docs/admin-order-widget.png)

There is deliberately **no compensation that deletes a document**. The ERP recipe compensates a remote create by deleting the remote record; here the bridge is idempotent per order, so a retry after a local failure gets the same document back, while a deleted ZK or invoice would leave a hole in the number series and might already be on the warehouse's desk or in KSeF.

## Products and prices from Subiekt

1. Every hour (or on **Read products**) the plugin reads `GET /v1/products` page by page from one bridge snapshot. A read that did not reach the last page plans nothing.
2. Each Medusa variant finds its Subiekt product by EAN (`ean`, `barcode` or `upc`), then by SKU equal to the symbol, case-insensitive. SKU suffixes are not stripped here: a wholesale `-WH` variant keeps its own price. One EAN on two Subiekt products is a conflict and never guessed.
3. The price of the configured level (net or gross, in `priceCurrency`) is compared with the current one in the target (the variant's plain price without rules or quantities, or the price list price). Equal amounts are left alone.
4. The plan is stored and shown in the admin. Only an armed price writer applies it, through `upsertVariantPricesWorkflow` (sending back every existing price of the variant, so other currencies and region prices stay intact) or `batchPriceListPricesWorkflow`.
5. Subiekt products with the "Sklep internetowy" flag, a price in the level, not a kit, and no match in Medusa become creation candidates. An armed product creator makes them draft products with one variant (SKU = symbol, EAN, weight); a person adds images and a sales channel and publishes.

## The bridge

[`contract/openapi.yaml`](contract/openapi.yaml) (1.1.0) is the whole contract: `GET /v1/health` (with `capabilities`, versions, licence, last event, queue sizes and server time), `POST /v1/orders` (optional `buyer` block), `GET /v1/orders/{id}`, `POST /v1/orders/{id}/cancel`, `POST /v1/orders/{id}/fulfillments`, `POST /v1/orders/{id}/documents` (FS or PA, idempotent), `GET /v1/stock`, `GET /v1/products`, `GET /v1/events`, and the webhook `POST /hooks/subiekt`. Version 1.1 is additive: a 1.0 bridge keeps working with this plugin. Request and response examples and cross-language signature test vectors live in [`contract/examples`](contract/examples).

Koda Plus provides a production bridge for Subiekt nexo PRO: a Windows service on .NET 8 and the Sfera SDK, with a dedicated Sfera thread (no desktop heap exhaustion after days of uptime), incremental WZ and KSeF watchers, a SQLite event feed, install, upgrade and uninstall scripts, a read-only `--check` and a local status page. It is available commercially from Koda Plus, write to **kontakt@koda.plus**. You can also build your own bridge from the contract.

## Stock matching

1. Each Subiekt product is indexed by EAN (digits only, 8 to 14) and by symbol (case-insensitive).
2. A variant that manages inventory with exactly one inventory item finds its product by EAN (`ean`, `barcode` or `upc` of the variant), then by SKU against the symbol, after removing `stripSkuSuffixes`.
3. Inventory items of kits get a second chance by their own SKU.
4. A duplicated EAN in Subiekt, or one inventory item matched to two products with different stock, is a conflict: reported in the admin, never written.
5. Only matched items are written, through Medusa's `batchInventoryItemLevelsWorkflow`. Negative Subiekt stock becomes 0.

![Stock plan: changes, products only in Subiekt, conflicts](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-subiekt-nexo/docs/admin-subiekt-stock.png)

## Admin API

- `GET /admin/subiekt`: connection, bridge diagnostics, writers, counters, the last run of each kind, references. Reads the database only.
- `POST /admin/subiekt/check`: `GET /v1/health` now.
- `POST /admin/subiekt/sync` with `{ "what": "stock" | "events" | "tasks" | "products" }`: run a job now (202, background).
- `POST /admin/subiekt/writers` with `{ "writer": "prices" | "products" | "documents" | "contractors", "armed": true | false }`: arm or disarm a writer (recorded with the admin user).
- `GET /admin/subiekt/products?kind=price|create&status=&q=`: the product and price plan; `POST /admin/subiekt/products/release` with `{ "id" }`: release a quarantined item.
- `GET /admin/subiekt/tasks?filter=attention|open|done|all&q=`, `POST /admin/subiekt/tasks/:id/retry`.
- `GET /admin/subiekt/documents?kind=ZK|WZ|FS|PA&q=`, `GET /admin/subiekt/runs?kind=`.
- `GET /admin/subiekt/orders/:id`, `POST /admin/subiekt/orders/:id/send`, `POST /admin/subiekt/orders/:id/documents` with `{ "kind"?: "fs" | "pa" }` (needs `salesDocument` other than `none`).
- `POST /hooks/subiekt`: the bridge webhook. Public, signed.

There is no DELETE route: nothing in the admin removes data.

## Use it from your code

```ts
import { sendOrderToSubiektWorkflow, issueSubiektDocumentWorkflow } from "@koda-plus/medusa-plugin-subiekt-nexo/workflows"

const { result } = await sendOrderToSubiektWorkflow(container).run({
  input: { order_id: "order_01J..." },
})
// result.document.number === "ZK 128/MAG/2026"

await issueSubiektDocumentWorkflow(container).run({
  input: { order_id: "order_01J...", kind: "fs", reconcile: true },
})
```

Subscribe to `subiekt.document_issued` (`{ order_id, kind, number, status, source }`) to react to a WZ or an invoice, for example to send the shipping e-mail, to `subiekt.document_updated` for the KSeF number, and to `subiekt.task_failed` to alert your team.

## How this maps to the Medusa ERP recipe

- **ERP module with a client**: the `subiekt_nexo` module, `HttpBridgeClient`, `DemoBridge`.
- **Sync orders to the ERP on `order.placed`**: the `subiekt-order-placed` subscriber, the outbox, `sendOrderToSubiektWorkflow`.
- **Restrict purchase by ERP data**: stock into inventory levels; Medusa's own inventory checks do the rest.
- **Sync from the ERP via webhook**: the signed `POST /hooks/subiekt` plus the cursor-based event feed.
- **Scheduled product sync job**: `subiekt-sync-stock` (stock, every 10 minutes) and `subiekt-sync-products` (prices and missing products, hourly, plan first).

## Compared with the Base.com route

Shops often connect Subiekt through Base.com (BaseLinker): Medusa to Base with one integration, Base to Subiekt with another. Base's own page says its ERP integrations, Subiekt nexo PRO included, "are provided by external companies", and lists what such integrators do: import orders from Base into Subiekt, create contractors, export products, prices and stock from Subiekt to Base, post sales documents as PDF ([base.com, Subiekt nexo PRO integration](https://base.com/en-US/integrations/subiekt_nexo_pro/)). That route fits shops that already run their marketplaces through Base. This plugin connects Medusa to Subiekt directly: no third system in between, the order state, documents and KSeF numbers in the Medusa admin, and every write behind a plan, a cap and a person's switch. Its cost is the bridge machine you host next to Subiekt.

## What this plugin does not do

- **No payments on sales documents.** The FS or PA takes its payment method and term from Subiekt (the document defaults, or what it copies from the WZ or ZK); the online payment is not booked as a settlement in Subiekt. The ZK notes describe the payment in words.
- **No fiscalization and no KSeF sending.** Subiekt prints receipts on its fiscal printer and sends e-invoices to KSeF; the bridge only reads the KSeF number back.
- **No partial WZ and no corrections.** A WZ from Medusa releases the whole ZK; returns, corrections (KWZ, FSK) and partial shipments are handled in Subiekt.
- **No full product sync.** Prices of one level go to one target; new products are minimal drafts (title, SKU, EAN, weight, price). Descriptions, images, categories, attributes and customer group prices stay in Medusa. Nothing goes from Medusa to the Subiekt product catalog.
- **No unattended contractor changes.** The bridge creates a contractor only when none has the NIP and both switches allow it; it never edits or merges existing contractors.
- **No Unieważnione status.** Sfera cannot set it; the bridge marks the ZK and a person sets the status.
- **No bridge without Windows.** Sfera is a Windows .NET library; the bridge needs a Windows machine with access to the nexo SQL Server, and one bridge serves one Subiekt company database.

## Security and data

- Every request is signed in both directions; a captured request cannot be replayed against another endpoint or after five minutes.
- Secrets live only in the plugin options and are masked in every stored error.
- The admin never calls the bridge while rendering; network calls sit behind explicit actions and jobs.
- Stored data: documents, tasks, plans and counters; about buyers only the order id and number, and for company buyers the NIP and the name of the Subiekt contractor that got the ZK (shown in the queue and on the order). The buyer block sent to the bridge (NIP, company, address, e-mail, phone) is used to find or create the contractor and is not stored by the plugin. The writers record the admin user who armed them.

## Roadmap

- Partial WZ and corrections (KWZ) for returns.
- Payments on sales documents (settlement of online payments).
- Customer group prices from further Subiekt price levels.

## License

MIT, see [LICENSE](LICENSE). Built and maintained by [Koda Plus](https://koda.plus).

Subiekt nexo, nexo PRO and Sfera are trademarks of InsERT S.A. This project is independent and not affiliated with InsERT.

## Changelog

### 0.2.0 (2026-10-06)

- Contract 1.1.0, additive: `capabilities` and versions in `/v1/health`, `GET /v1/products`, the `buyer` block of an order, `POST /v1/orders/{id}/documents` (FS or PA, idempotent), `ksef_number` on documents and the `document.updated` event. The plugin feature-detects every one of them.
- Products and prices from Subiekt, plan first: EAN then SKU matching, price level, net or gross, variant prices or a price list, optional draft products, per-run caps, re-read before write, quarantine after three failed runs.
- Contractors by NIP: `nipSources`, checksum validation, existing contractor or (allowed) a new one, invalid NIP to the retail buyer with a warning.
- Sales documents: `salesDocument` (`none`, `fs`, `pa`, `auto`) and `salesDocumentAfter`, exactly once with an atomic claim and reconciliation of unclear answers; KSeF numbers on the order, in the documents view and in the order metadata.
- Writers: every new write has an option (hard switch) and an admin toggle recorded with who and when; all off by default.
- Admin: "Panel" | "Setup guide" switch, the bridge diagnostics section, writers, the products and prices plan, FS and PA with KSeF in the documents view and the order widget, "Running in production" references (`references` option).
- Setup guide in English and Polish, in the admin with live states and as [docs/guide-en.md](docs/guide-en.md) and [docs/guide-pl.md](docs/guide-pl.md).
- Demo bridge simulates all of it from the store catalog.
- Bridge fix worth knowing: bridge 0.1.0 ignored `address_1` and `address_2` of the order addresses (it expected `address1`), so ZK notes lacked the street; bridge 0.2.0 reads the contract names.

### 0.1.0 (2026-10-05)

First release: contract 1.0.0, orders to ZK, cancels, WZ both ways, stock sync with dry run, signed webhook, the outbox queue, the admin page and order widget in English and Polish, the demo bridge. See [CHANGELOG.md](CHANGELOG.md).
