# Changelog

## 0.1.0 (unreleased)

The first version: the InPost marketplace (InPost Von Halsky, also called InPost Buy) for Medusa v2. Run `npx medusa db:migrate` after installing: one migration (`Migration20261018150000_vonhalsky`) adds the offers, the marketplace orders, the sync log and the settings tables.

### Offers

- One offer row per Medusa variant: EAN (variant `ean` or `barcode`, then metadata), brand and manufacturer part number (metadata keys `brandKey`, `mpnKey`), the GPSR manufacturer (the EU Compliance plugin of Koda Plus first, product metadata second), the PLN price and the stock from Medusa inventory.
- What blocks a listing, per variant: no title, no EAN, a wrong EAN check digit, no brand, no GPSR manufacturer or one without an e-mail or an address, no PLN price, an unpublished product. Warnings that do not block: no manufacturer part number, no stock, no photo.
- Channel pricing: gross, VAT added to net Medusa prices, the markup in percent, a fixed price per offer.
- List selected, take off, back to draft; nothing is listed by itself. A full catalog read closes the offers of deleted variants; a partial read closes nothing.

### Orders

- A marketplace order (the shape of the public SDK's `Order` model, camelCase or snake_case) becomes a Medusa order: created as a draft with gross prices, placed (`convertDraftOrderWorkflow`), paid with `markPaymentCollectionAsPaid` when the marketplace collected the money, left not paid for cash on delivery. `no_notification`, `metadata.marketplace_order_ref = "vonhalsky:<id>"`.
- Exactly once per marketplace order id: the row is written first, under a lock per order; the Medusa order id is written the moment the draft exists, so a retry finishes it instead of creating a second one. A line that matches none of the offers holds the order with the reason.
- Shipping: the parcel locker and courier deliveries land on the mapped shipping options, the locker id on the second address line.
- Sales channel and PLN region from the settings, the options, a channel named "InPost Von Halsky" or the store default.

### Tracking

- `shipment.created` and `order.fulfillment_created`: new tracking numbers of an imported order go back (writer `sendTracking`, off by default; demo records them). Numbers already sent are not sent again; the panel resends.

### Admin

- `/app/vonhalsky`: counters, offers with photos and bulk actions, marketplace orders with their products and actions, the sync log, Setup guide with live step states, Settings (pricing, orders, shipping, account).
- The order widget `vonhalsky.order` (order details, side column, hostable).
- The koda.integration/1 contract: manifest, order and product summaries, counters `held_orders`, `tracking_failed`, `awaiting_shipment`, `blocked_offers`.

### Demo mode

- The option `demo` (only on explicit request, it wins over the credentials): offers listed in the plugin's tables, simulated orders from the listed offers imported as real Medusa orders in the "InPost Von Halsky (demo)" sales channel, a simulated shipment with a sample tracking number, nothing ever sent outside.

### Pending

- The live and sandbox seller API client refuses every call politely (`MarketplaceApiPendingError`, HTTP 501) until it is wired to InPost's official API documentation, which comes with the integrator agreement.
