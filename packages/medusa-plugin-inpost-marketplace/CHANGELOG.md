# Changelog

## 0.1.0 (unreleased)

- No "Add your store" button in the page header any more (kit 1.5.0).
- **Its own sidebar entry** (11 November 2026): "Von Halsky" at `/app/vonhalsky`, rank 3, next to InPost. It is no longer the "Von Halsky" tab of the InPost page: a marketplace is a sales channel of its own, not a way to ship.

Found on InPost's stage environment with a real merchant API application (6 November 2026):

- **Check connection** works for a merchant's Client Credentials application: `GET /v1/organizations` is for integrators and answers 401 or 403 to a merchant token, so the check goes on with the organization's offers (bad credentials still stop it).
- Pictures in formats the marketplace refuses (AVIF, HEIC, SVG, TIFF, BMP, ICO, JXL) are left out of the offer instead of failing it; JPEG, PNG, GIF and WebP go as before.
- The offer name has the variant title only when the product has more variants: a product with one "Standard" variant is listed under its own title.
- A bare 403 of InPost's gateway (no body; on stage the same call answers 200, 403, 200 within seconds) is asked again up to three times with a short wait, writes too, since the gateway refuses it before the API sees it. A 403 with problem details is the API's answer and is final.
- Two blocking reasons from InPost's own validation (merchant instructions 11/2026): `title_invalid` (the name needs 7 to 150 characters and at least two words) and `description_short` (fewer than 100 characters of text). The offer is fixed before it is sent, not held in PENDING after.
- Catalog rows made in demo mode that never reached a marketplace become real rows once the credentials are set.

From InPost's integration scope checklist (run `npx medusa db:migrate`: `Migration20261106160000_vonhalsky_overrides` adds `overrides` to `vonhalsky_offer`):

- **Edit offer**: the name, the description, the photos (replace, remove, add, reorder), the package (length, width, height in mm, weight in g) and the days to ship of one offer, over Medusa's values; null goes back to Medusa. Checked against the marketplace's rules before it is kept (400 with the field's code). The edits win over Medusa in the blocking reasons (also `title_invalid` and `description_short`, and the photo format filter), in the proposal and in the offers list, which now shows `overrides`, `overridden`, `medusa` and `effective`. `POST /admin/vonhalsky/offers/:id/edit { overrides }`.
- An edit of an offer on the marketplace is sent as a merge patch and followed as a command. A PUBLISHED (or SOLDOUT) offer is closed first (`edit_close`), patched when the close is done (`edit_patch`) and reopened after it, one command per sync run, since InPost's FAQ says such a change may be refused on a published offer; a refused patch reopens the offer as it was, at zero stock the offer waits closed like any offer closed for no stock. The demo marketplace refuses a content change on a published offer the same way. New client call `updateOffer` (the PATCH answer read as a command, or as the offer).
- Bulk edits: `POST /admin/vonhalsky/offers/days-to-ship { ids, daysToShip }` and `POST /admin/vonhalsky/offers/attributes { ids, attributes }` (one category; a parameter without values is removed). The category parameters of an offer on the marketplace are now sent at once, single or bulk, instead of waiting for a listing that never comes for a listed offer.
- **Import from InPost**: `POST /admin/vonhalsky/offers/import` reads every offer on the marketplace and links the ones not linked yet to a variant by the external id, then the SKU, the EAN and the manufacturer part number (only one match counts; a variant is linked to one offer). Linked offers take the marketplace's status, prices and stock, and the price and stock sync takes them over. Offers that match nothing are reported (`unmatched`) and shown after the import, never created. The demo marketplace has one offer "of another tool" to show it.
- **Remove from panel only**: `POST /admin/vonhalsky/offers/detach { ids }` forgets the marketplace offer without calling InPost: the new status `detached` (filter and counter), never touched by the sync, never linked back by offer events, until listed again or imported. "Take off" is now "Close on InPost"; both ask before anything happens.
- **Connection alert**: a refused token, a 401 or a 403 with problem details on two sync runs in a row is recorded (setting `connection`), `GET /admin/vonhalsky` answers `connection { ok, since, message }`, the page shows a red banner, Settings, Account says since when, and the integration counter `connection_lost` (scope `integration`) is 1. The next run that reaches the marketplace or a working connection check clears it. The bare 403 of the gateway does not count.
- **Sync frequency**: the offers section and the settings say "Price and stock sync every 5 minutes, last run ..." (`GET /admin/vonhalsky` answers `sync { everyMinutes, priceStock, lastPushAt, lastRunAt }`), as InPost asks integrators to tell sellers.
- The marketplace's manufacturer part number of an offer is read (`RemoteOffer.mpn`); the integration texts know `title_invalid` and `description_short`.

The first version: the InPost marketplace (InPost Von Halsky, also called InPost Buy) for Medusa v2, on InPost's seller API (OpenAPI 1.7.6). Run `npx medusa db:migrate` after installing: `Migration20261018150000_vonhalsky` adds the offers, the marketplace orders, the sync log and the settings tables; `Migration20261102120000_vonhalsky_live` adds the seller API columns to the first two and the after sale, category and snapshot tables.

### Seller API client

- OAuth2 client credentials of an API application from the Merchant Portal (`clientId`, `clientSecret`, `organizationId` per environment; InPost's stage and production addresses by default). The access token (5 minutes) is kept in memory and taken again when it runs out or on a 401.
- The limits of the API: pages of 30, batches of 500 offers, 100 price or stock changes and 200 campaign declarations; a wait for `Retry-After` on 429, retries of reads on network errors and 5xx; the last rate limit headers for the admin. Errors keep InPost's problem details, with the secret masked.
- `POST /admin/vonhalsky/check`: signs in and reads the organization and one offer.

### Offers

- One offer row per Medusa variant: the EAN (variant `ean` or `barcode`, then metadata) or the brand with the manufacturer part number, the name, the description as plain text, up to 20 photos (the thumbnail first), the dimensions and weight in mm and g (`dimensionUnit`, `weightUnit`), the VAT rate (`vatRate`, `vatKey`), the GPSR manufacturer (the EU Compliance plugin of Koda Plus first, product metadata second; `gpsr_exempt` for products that need none; none for categories free of GPSR), the PLN price and the stock from Medusa inventory.
- Categories: the marketplace tree read weekly (three levels at a time, as InPost's own module does), Medusa categories mapped to marketplace leaves in the settings, a leaf chosen by hand per offer, the catalog hint for an EAN or part number (asked for up to 50 offers on each listing). The parameters of a leaf are kept for 7 days and edited per offer.
- What blocks a listing: no title, no EAN (and no brand with a part number), a wrong EAN check digit, no description, no photo, no category, missing required parameters, no GPSR manufacturer or one without a name or an e-mail, too large for a parcel, no PLN price, an unpublished product. Warnings: no part number, no stock, no dimensions, one photo only.
- Listing in batches, the marketplace commands followed until they finish, the offer read again after each one: PENDING, PUBLISHED, REJECTED with the validation messages, SOLDOUT, CLOSED. Close, reopen, promotion prices with dates, the price program (in or out).
- Price and stock sync (`syncPriceStock`, on by default): changed prices and stock levels in batches; at zero stock the offer is closed and reopened when stock comes back, as the integration guidelines ask. Offers of deleted variants are closed.
- Channel pricing: gross, VAT added to net Medusa prices, the markup in percent, a fixed price per offer.

### Orders

- Order events and the orders changed since the last run, every 5 minutes; an order the events name and the list missed is read on its own. New orders are imported when automatic import is on or a person presses "Import now"; held ones are retried; imported ones get their status, payment, parcels and dates refreshed.
- An ACCEPTED order becomes a Medusa order: created as a draft with gross prices, placed (`convertDraftOrderWorkflow`), paid with `markPaymentCollectionAsPaid` when the marketplace collected the money. A paid order still CREATED is accepted on the marketplace and read again (the buyer's data come with the acceptance); an order not paid or not accepted yet gets no row and is imported with its next change. "Import now" and automatic import also read the ACCEPTED orders changed since the last import (14 days at most), so orders that came while import was off are not lost. A marketplace cancellation after the import is a sync log warning. The line price is the final price (after a promotion and the price program); the order keeps the base total and both discounts.
- Exactly once per marketplace order id: the row is written first, under a lock per order; the Medusa order id is written the moment the draft exists, so a retry finishes it instead of creating a second one. A line that matches none of the offers holds the order with the reason.
- The Medusa order gets the buyer's InPost e-mail (`delivery.email`), so a ShipX shipment made with it is linked by InPost. The parcel locker and courier deliveries land on the mapped shipping options, validated by the provider of the option before the order is created (`validateFulfillmentData`), so the InPost plugin of Koda Plus records the shipment; otherwise the order keeps the `vonhalsky_*` keys alone and the sync log says why.
- Sales channel and PLN region from the settings, the options, a channel named "InPost Von Halsky" or the store default.

### Shipping

- The seller API takes no tracking number. When an imported order gets a fulfillment or a shipment, its tracking numbers are compared with the parcels of the marketplace order: `linked` when InPost shows them, `waiting` while it does not (ship in ShipX with the order's InPost e-mail).

### After sale

- Returns, claims and refunds read every 5 minutes into one table, counted per order (returns, claims, refunded amount).
- Decisions from the admin: accept a return (with an amount) or reject it with a marketplace reason, answer a claim, refund an order in part or in full, retry a declined refund. The buyer's contact data are read live for the detail and never stored.

### Statistics

- `GET /admin/vonhalsky/stats?days=7|30|90`: revenue, orders and average order value against every other Medusa sales channel, daily revenue, offers by status, sell-through and offers without a sale, the most common validation errors, top products with returns and claims, hours to ship and to deliver, late orders, the delivery, payment and buyer mix, promotion and price program discounts, return and claim rates and reasons, the daily offer history (snapshots). Views, click-through, ratings and payouts are not in the seller API and are listed as such.

### The sync

- The job `vonhalsky-sync` (every 5 minutes) and "Sync now" run commands, offers, price and stock, orders, after sale, categories (weekly) and the snapshot (daily), each on its own; a run in progress is joined, not doubled.

### Admin

- `/app/vonhalsky`: counters, offers with photos, categories, parameters, marketplace status and bulk actions, marketplace orders with their products, parcels and refunds, after sale, statistics, the sync log, Setup guide with live step states, Settings (pricing, orders, shipping, category mapping, offer defaults, the account with the connection check).
- The order widget `vonhalsky.order` (order details, side column, hostable).
- The koda.integration/1 contract: manifest, order and product summaries, counters `held_orders`, `tracking_waiting`, `open_cases`, `awaiting_shipment`, `blocked_offers`.
- One InPost menu (shared kit 1.1.0, page tabs): with the InPost plugin of Koda Plus in the same app, the page is the "Von Halsky" tab of its "InPost" entry (`/app/inpost?service=vonhalsky`), `/app/vonhalsky` redirects there with every parameter and the own sidebar entry steps aside. Without it the page and the entry stand alone.

### Demo mode

- The option `demo` (only on explicit request, it wins over the credentials): a simulated marketplace in the server with a sample category tree and parameters, offers that go from PENDING to PUBLISHED on the next sync (or stay PENDING with validation messages), price, stock, promotions and the price program, simulated orders from the published offers imported as real Medusa orders in the "InPost Von Halsky (demo)" sales channel, a simulated shipment linked like a ShipX parcel, simulated returns and claims, refunds. Nothing is ever sent outside.
