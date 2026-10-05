# Changelog

## 0.1.0 (2026-10-05)

First public release, built on the Allegro integration Koda Plus maintains for a tyre and wheel retailer since September 2026.

- Device flow (OAuth 2.0, RFC 8628) to an Allegro seller account, production or sandbox, with encrypted tokens and device code, serialized refreshes inside Allegro's 60 second rotation window and an environment guard.
- Hourly read of all offers through `GET /sale/offers`, 1 000 per page, deduplicated by id, complete only when the count matches `totalCount`; incomplete reads never remove links.
- Signature matching (`external.id` against the variant SKU), one primary offer per variant.
- Stock check: Allegro quantity of every primary offer against the Medusa available quantity, labelled (oversell, sold out, under-listed, ended in stock), never written.
- Read-only order journal every ten minutes through `GET /order/checkout-forms` by `updatedAt`, lines linked to products, no buyer data stored.
- Write barrier: only GET and HEAD reach the REST API; the only POSTs go to the OAuth server.
- Admin: Allegro page (connection by code, counters, offers, orders, history) and a product widget, in English and Polish.
- Store route for "Also on Allegro" links, `syncAllegroOffersWorkflow` and `syncAllegroOrdersWorkflow` for custom code.
- Demo mode with sample offers and orders generated from the catalog.
