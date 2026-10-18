# InPost Von Halsky by Koda Plus

The **InPost marketplace** (InPost Von Halsky, also called InPost Marketplace or InPost Buy) for Medusa v2 stores in Poland. Your variants become marketplace offers matched by EAN, brand and manufacturer part number, with the GPSR manufacturer the marketplace asks for, a channel price (a percent markup, or a fixed price per offer) and the stock from Medusa inventory. Marketplace orders come in as real Medusa orders paid by the marketplace, exactly once each, and the tracking numbers of your shipments go back.

**The live seller API is pending in this version.** Access to the InPost Von Halsky seller API is limited to known integrators and its documentation comes with an agreement with InPost. This version ships the whole plugin around a clean client interface, with a demo mode that runs every step on your own catalog and orders; the live client refuses politely until it is wired to the official documentation (see [What is pending](#what-is-pending-the-official-seller-api)).

## What it does

- **Offers**: one row per Medusa variant with the matching keys found on it (the EAN from the variant's `ean` or `barcode`, the brand and the manufacturer part number from metadata), the GPSR manufacturer (from the [EU Compliance plugin](https://github.com/Koda-Plus/medusa-integrations/tree/main/packages/medusa-plugin-compliance) when it is installed, else from product metadata), the channel price and the quantity. What is missing is shown per variant as the reasons it cannot be listed (no EAN, a wrong EAN check digit, no brand, no GPSR manufacturer or one without an e-mail or an address, no PLN price, an unpublished product) and the warnings that do not block it (no manufacturer part number, no stock, no photo).
- **Listing**: a person selects ready offers and lists them, takes listed ones off, or brings closed ones back to draft. Nothing is ever listed by itself.
- **Channel pricing**: marketplace prices are gross. The channel price is the Medusa PLN price, with VAT added when Medusa keeps prices without tax, plus the markup in percent; a fixed price on one offer wins over both.
- **Orders**: a marketplace order becomes a Medusa order in the chosen sales channel and PLN region, created as a draft, then placed (reservations, `order.placed`) and paid with Medusa's system provider when the marketplace collected the money (left not paid for cash on delivery). The parcel locker or the courier lands on the shipping option you mapped, the locker id on the second address line. One row per marketplace order id, written before anything else: a second import of the same order creates nothing, and a line that matches none of your offers holds the order with the reason (no product is ever invented).
- **Tracking back**: when an imported order gets a fulfillment or a shipment with tracking numbers, the new numbers go back to the marketplace (a writer, off by default; demo records them locally). Numbers already sent are never sent twice; a person can resend.
- **The admin page** (`/app/vonhalsky`): the counters (offers listed, cannot be listed, orders imported, to ship, errors), the offers with product photos, reasons, price and stock and the bulk actions, the marketplace orders with their products, delivery, payment and tracking, the sync log, a setup guide with live step states and the settings (markup, sales channel and region, shipping mapping, automatic import, the account). An order widget shows the marketplace origin of an order.
- **Works with Koda Plus hosts** through the `koda.integration/1` contract: the manifest, an order and a product summary, and four board counters.

## Requirements

- Medusa 2.12 or newer (peer range `^2.12.0`) and Node.js 20+.
- For sandbox and live: an integrator agreement with InPost (it gives the API address, the organization id and the access token, separately for sandbox and production). Demo mode needs none of it.
- A region in PLN and shipping options for parcel lockers and the courier.

## Installation

```bash
npm install @koda-plus/medusa-plugin-inpost-marketplace
npx medusa db:migrate
```

One migration (`Migration20261018150000_vonhalsky`) adds four tables: `vonhalsky_offer`, `vonhalsky_order`, `vonhalsky_sync_log`, `vonhalsky_setting`.

## Configuration

```ts
// medusa-config.ts
module.exports = defineConfig({
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-inpost-marketplace",
      options: {
        demo: process.env.VONHALSKY_DEMO === "true",
        environment: process.env.VONHALSKY_ENV, // "sandbox" (default) or "live"
        sandbox: {
          apiUrl: process.env.VONHALSKY_SANDBOX_API_URL,
          organizationId: process.env.VONHALSKY_SANDBOX_ORGANIZATION_ID,
          accessToken: process.env.VONHALSKY_SANDBOX_TOKEN,
        },
        live: {
          apiUrl: process.env.VONHALSKY_LIVE_API_URL,
          organizationId: process.env.VONHALSKY_LIVE_ORGANIZATION_ID,
          accessToken: process.env.VONHALSKY_LIVE_TOKEN,
        },
        markupPercent: process.env.VONHALSKY_MARKUP_PERCENT,
        // sendTracking: true,          // writer: tracking numbers back to the marketplace
        // salesChannelId: "sc_...",   // the admin setting wins
        // brandKey: "brand", mpnKey: "mpn", eanKey: "ean",
      },
    },
  ],
})
```

```bash
# .env
VONHALSKY_DEMO=true                 # a simulation, nothing leaves the server
VONHALSKY_ENV=sandbox
VONHALSKY_SANDBOX_API_URL=...       # from InPost, under the integrator agreement
VONHALSKY_SANDBOX_ORGANIZATION_ID=...
VONHALSKY_SANDBOX_TOKEN=...
VONHALSKY_LIVE_API_URL=...
VONHALSKY_LIVE_ORGANIZATION_ID=...
VONHALSKY_LIVE_TOKEN=...
VONHALSKY_MARKUP_PERCENT=10
```

Missing options never break the boot: without credentials and without `demo` the plugin says "Not configured" and every route answers politely.

### Options

- `demo` (default false): demo mode, only on explicit request; it wins over the credentials.
- `environment` (default `sandbox`): which credentials are used. Sandbox credentials never serve live.
- `sandbox`, `live`: `{ apiUrl, organizationId, accessToken }`. The plugin ships no address of its own: `apiUrl` comes from InPost (https only).
- `markupPercent` (default 0, -50 to 300): the channel markup. The admin setting wins.
- `vatRate` (default 23): the VAT added to net Medusa prices.
- `pricesIncludeTax` (default: read from the PLN price preference): whether Medusa's PLN prices include tax.
- `salesChannelId`, `regionId`: where imported orders land. Default: a sales channel named "InPost Von Halsky", else the store default; the first PLN region. The admin settings win.
- `autoImport` (default false): import new orders every 15 minutes once the seller API is connected. The admin setting wins.
- `sendTracking` (default false): the writer of tracking numbers.
- `brandKey` (default `brand`), `mpnKey` (default `mpn`), `eanKey` (default `ean`): the metadata keys read on the variant, then the product.
- `stockLocationIds` (default every location): the locations whose stock counts.
- `untrackedStock` (default 0): the quantity offered for variants whose inventory Medusa does not manage.
- `timeoutMs` (default 15000): the timeout of one request, for the live client.

## Setup in brief

1. Get API access from InPost (an integrator agreement; sandbox and production credentials).
2. Install, configure and migrate (above).
3. Prepare the catalog: EAN, brand, PLN price, published products; the GPSR manufacturer in the EU Compliance plugin or in product metadata (`gpsr_manufacturer: { name, email, address, phone }`, or `manufacturer_name`, `manufacturer_email`, `manufacturer_address`).
4. Settings: the markup, the sales channel and region of orders, the shipping options of parcel lockers and the courier.
5. Refresh offers, list the first ones, import the first order, ship it with a tracking number.

The setup guide in the admin shows each step with its live state.

## Demo mode

Only on explicit request (`demo: true`). Nothing is ever sent outside, even with credentials set:

- the mode badge says **Demo (simulation)** and explains the flow;
- **Refresh offers** reads your real catalog; **List selected** marks ready offers listed in the plugin's table (with a local `demo-...` offer id and the status PUBLISHED, or SOLDOUT without stock);
- **Simulate an order** builds a sample marketplace order from the listed offers (one or two lines, a sample buyer `buyerN@example.com`, a sample street in Warsaw and a sample parcel locker `DEMO01M`, every fourth order cash on delivery) and imports it through the same path as a real one: a real Medusa order in the "InPost Von Halsky (demo)" sales channel (created on first use and linked to the stock locations of the default channel), with `metadata.koda_demo`, placed (it reserves stock) and paid with Medusa's system provider;
- **Ship (simulation)** on an imported demo order fulfils and ships it in Medusa with a sample tracking number (24 digits starting with 99, never a real parcel), so the subscribers record the tracking exactly as for a real shipment; fulfilling it yourself in Orders works the same;
- tracking numbers are recorded on the order row ("Recorded (demo)").

Simulated orders are real orders of your store: cancel them in Orders when you are done.

## What is pending: the official seller API

The live and sandbox client (`createLiveClient` in `src/modules/vonhalsky/lib/client.ts`) is **pending**: every method throws `MarketplaceApiPendingError` (HTTP 501 from the admin routes) with a polite message, and nothing is sent. In sandbox and live the admin says "Seller API pending", listing and imports answer the same, tracking numbers are kept as "Waits for the seller API" and everything is in the sync log.

Why: InPost publishes the API documentation on its [API portal](https://inpsa-api-portal.inpost-group.com/) for integrators under an agreement. A public [PHP SDK generated from InPost's OpenAPI file](https://github.com/InPost-VonHalsky/InPost-vonHalsky-api-sdk-php) names the operations and models, and this plugin is shaped after them: offers with product info (EAN, brand, manufacturer part number), stock, a gross `PriceTag` and `GpsrInfo` with a `Manufacturer` (name, e-mail, address); orders with `orderLines`, `delivery` (`deliveryType` APM or COURIER, `deliveryPoint`, parcels with tracking numbers), `customer`, `invoice`, `finalPrice` and `paymentDetails`; the offer statuses PENDING, REJECTED, PUBLISHED, CLOSED and SOLDOUT and the order statuses CREATED, ACCEPTED, REFUSED, REJECTED and CANCELED. The SDK lists the operations the client interface maps to (offer batch, update and close, order list, events and details, order accept); it does not show how shipment information is passed in detail, nor the limits, errors and production address. The plugin calls nothing until those are checked against the portal and a sandbox account.

What already works without the API: building and checking offers from the catalog, pricing, the settings, the import path from a marketplace order to a Medusa order (exercised in demo and in the tests with an order in the SDK's wire format), tracking from Medusa fulfillments, the admin, the contract.

## Admin API

Every route needs an admin session or token. Writes take a JSON body or the `x-koda-request` header.

- `GET /admin/vonhalsky`: the page in one read: the mode, the missing and ignored options, the options in use (the token masked), the settings, where orders land, the store's sales channels, PLN regions and shipping options, whether EU Compliance is installed, the counters.
- `GET /admin/vonhalsky/offers?filter=&q=&offset=&limit=`: the offers (`filter`: `draft`, `listed`, `blocked`, `closed`; `q`: a SKU, title, EAN, product, variant or offer id).
- `POST /admin/vonhalsky/offers/refresh`: reads the catalog again (lists nothing).
- `POST /admin/vonhalsky/offers/list`, `/unlist`, `/reopen` `{ ids }`: list, take off, back to draft.
- `POST /admin/vonhalsky/offers/:id/price { price_override }`: a fixed gross price ("129.99"), or null for the markup.
- `GET /admin/vonhalsky/orders?filter=&q=`: the marketplace orders (`filter`: `awaiting_shipment`, `tracking_sent`, `held`, `errors`).
- `POST /admin/vonhalsky/orders/import`: import now (501 while the API is pending).
- `POST /admin/vonhalsky/orders/:id/retry`: a held import again (never a second order).
- `POST /admin/vonhalsky/orders/:id/tracking`: send the tracking numbers again.
- `POST /admin/vonhalsky/orders/:id/ship`, `POST /admin/vonhalsky/demo/simulate-order`: demo mode only.
- `GET /admin/vonhalsky/medusa-orders/:id`: the marketplace origin of a Medusa order (the widget).
- `GET`, `POST /admin/vonhalsky/settings`: `pricing { markupPercent }`, `orders { salesChannelId, regionId, autoImport }`, `shipping { APM, COURIER }`.
- `GET /admin/vonhalsky/log?area=&outcome=`: the sync log (30 days).

The plugin has no store routes.

## Works with Koda Plus hosts

- `GET /admin/vonhalsky/integration`: the manifest (mode `demo`, `sandbox`, `live` or `off`, entities `order` and `product`, the widget `vonhalsky.order` in `order.details`, the tracking writer; in sandbox and live the problem "seller API pending").
- `GET /admin/vonhalsky/integration/summary?entity=order&id=order_...`: one line per imported order: to ship (blue), tracking sent or recorded (green), waiting for the seller API (orange), tracking failed (red); facts: the channel (code `vonhalsky`) with the marketplace order id, the payment (code `paid` or `cod`), the parcel locker or courier, the tracking numbers.
- `GET /admin/vonhalsky/integration/summary?entity=product&id=prod_...`: listed (green), ready (blue) or blocked with the first reason (orange).
- `GET /admin/vonhalsky/integration/attention?scope=orders,products`: `held_orders` and `tracking_failed` (red), `awaiting_shipment` (blue), `blocked_offers` (orange), linked to the filters of the page (`/vonhalsky?section=orders&filter=held`...).

## Security and data

- **The token** is never shown in full (the admin sees `***` and the last four characters) and is masked in logs and stored errors, as are bearer values.
- **Writes need the admin**: writes under `/admin/vonhalsky` take a JSON body or the `x-koda-request` header. A shopper may not set `vonhalsky_` metadata, `marketplace_order_ref` or `koda_demo` on carts or the account: the plugin never trusts order metadata, its own tables are the record.
- **What the plugin keeps**: per offer the variant and product ids, SKU, title, EAN, brand, MPN, the manufacturer name, the reasons, prices and stock; per marketplace order the ids, the delivery type and parcel locker, the payment type, the total, the lines (offer, variant, SKU, title, quantity, price), the tracking numbers and a short history. **No buyer name, address, e-mail or phone** is stored in the plugin's tables: they go only on the Medusa order. The sync log keeps ids, never personal data, and prunes itself after 30 days.
- **Writers**: nothing is listed, imported or sent by itself. Listing is a person's action; automatic import and the tracking writer are off by default.

## Branding

This plugin is an independent integration. It contains no InPost or Von Halsky logo, colours used as their brand, or imitation of their seller panel: the admin icon is a generic Koda Plus mark, and the demo texts say "demo" and "simulation".

## Uninstall

1. Remove the plugin from `medusa-config.ts` and the package from `package.json`.
2. The four `vonhalsky_*` tables stay with their data. Drop them by hand when you no longer need them, or run `npx medusa db:rollback vonhalsky` before removing the package. Imported orders stay in Medusa; the demo sales channel can be deleted in Settings.

## Compatibility

Medusa 2.12 or newer (peer range `^2.12.0`) and Node.js 20+. The tests and the build run on Medusa 2.15.3. The admin libraries (`@medusajs/ui`, `@medusajs/icons`, `@tanstack/react-query`, `react`, `react-i18next`, `react-router-dom`) are optional peers: the plugin uses the copies of Medusa's dashboard. Developing the plugin needs Node.js 22.6+ (the tests run the TypeScript sources directly).

## Public API

What other code may import: `@koda-plus/medusa-plugin-inpost-marketplace/workflows` (`refreshOffers`, `listOffers`, `unlistOffers`, `reopenOffers`, `setOverride`, `importMarketplaceOrder`, `importNewOrders`, `retryOrder`, `simulateOrder`, `resolveTarget`, `syncTracking`, `demoShip`, `parseMarketplaceOrder`, `planImport`, `vonHalskyIntegration`, the types), `@koda-plus/medusa-plugin-inpost-marketplace/modules/vonhalsky` (the module, its options, the client interface and the response types) and `/admin`. Every other path is internal and may change in any release.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. Want your store on the InPost marketplace, or the seller API wired once you have the agreement? Write to kontakt@koda.plus.

## Trademarks

InPost, InPost Von Halsky, InPost Buy, Paczkomat and Medusa are trademarks of their owners, used here only to identify the marketplace this plugin connects to and the platform it runs on. This is an independent integration, not affiliated with or endorsed by InPost or Medusa.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-inpost-marketplace/LICENSE).

## Changelog

Every release is in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-inpost-marketplace/CHANGELOG.md).

- 0.1.0 (unreleased): the first version. Offers from the catalog with eligibility, GPSR and channel pricing, order import into Medusa, tracking back, the admin page and the order widget, demo mode, the koda.integration/1 contract; the live seller API client is pending. It needs `npx medusa db:migrate`.
