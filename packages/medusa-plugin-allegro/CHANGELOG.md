# Changelog

## 0.2.0 (2026-10-06)

The writers. Every one of them is off until it is allowed in `writes` and armed by a person in the admin.

- Writer framework: two switches per writer (`writes.<writer>` in the options, a toggle in the admin with who and when), a circuit breaker after `breakerThreshold` consecutive failures (default 5) that says why, a write allowlist of exact methods, paths and bodies per armed writer, scopes asked only for allowed writers and a reconnect notice when the token lacks one.
- Order import (`orders`): the order event journal drained every two minutes into one row per checkout form; atomic claims with leases; the `marketplace_order_ref` lookup before every create, repeated inside the lock `marketplace-order-ref:<ref>` of the Medusa Locking module (the key the BaseLinker plugin takes); orders created as drafts with `createOrderWorkflow` and placed with `convertDraftOrderWorkflow` (reservations, `order.placed`); tax lines from the region (forced only where the core left none, never doubled); the buyer e-mail on the order without a customer; a payment collection marked paid when Allegro holds the money (not for cash on delivery); unmapped lines, addresses, currencies and stock held with the reason; cancellations that cancel only unfulfilled orders; an import window for history; dry runs that also read the events after the cursor.
- Stock writer (`stock`): plan first, decrease by default or mirror behind the import freshness guard, sold out offers ended (never activated again), per run cap, quarantine, a fresh re-read before every command and refusals of plans that look like a broken read.
- Parcels and seller status (`shipping`) and invoice PDFs (`invoices`, from `fakturownia.document.issued`, `fakturownia.document.corrected` or `allegro.invoice.attach.requested`) through an outbox: unique keys, a lookup on Allegro before every send, unclear answers reconciled before a resend, retries with backoff, an own sweep every five minutes.
- Price writer (`prices`, bounds from metadata, refused and never clamped) and drafts by EAN (`publish`, `INACTIVE` only).
- Customer returns, disputes, claims and unread message threads, read only, with links to the seller panel.
- Token refreshes serialized across processes by a database lease; the event cursor, the plan summaries and the EAN cache kept per mode.
- Admin: Panel and Setup guide views (`?view=guide`), writers, stock, price and draft plans, imported orders, outbox, customer issues and references, in English and Polish.
- Demo mode simulates every flow: three to five checkout forms a day with `@example.com` buyers, real Medusa orders in an "Allegro (demo)" sales channel, parcels, invoices, returns, disputes and messages.
- New migration `Migration20261006093000` (named to stay unique across the Koda Plus packages).

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
