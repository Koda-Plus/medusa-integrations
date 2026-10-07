# Changelog

## 0.3.0 (unreleased)

### Fixed

- Order import: Allegro event ids are opaque. The journal is read in the order Allegro returns it, the cursor moves to the last event of a page only after that page's rows are written, and only the cursor itself and repeats inside a page are left out. Ids used to be compared as text, and Allegro's own example id (a number in base64) does not sort that way, so events could be skipped and their orders never imported.
- Demo mode runs only with `demo: true`. The setup prompt writes `demo: process.env.ALLEGRO_DEMO === "true"` and no longer switches demo on when `ALLEGRO_CLIENT_ID` is missing.
- Demo orders are never placed or paid: they move from draft to `pending` in the order module, so no stock is reserved and no `order.placed` or `payment.captured` reaches invoicing, the ERP or e-mails; a cancellation on the simulated account cancels them without `order.canceled` or a refund. They carry `metadata.koda_demo`, and the arming dialog of the demo import says they land in this store.
- Prices and draft offers go to Allegro only as gross prices: with net PLN prices in Medusa (its default) both plans are refused with `tax_exclusive_prices` and the old plan is cleared.
- A price command goes only while Allegro still shows the price the plan started from; a price changed in the seller panel after the plan waits for the next one.
- A wrong encryption key or client secret no longer deletes the stored tokens: the account reads as not connected and the status says why. Only `invalid_grant` disconnects. `invalid_client` and `unauthorized_client` come with a hint.
- `GET /admin/allegro` no longer starts flows in demo mode; it only reads.
- Which orders are the plugin's own is decided by its import table, never by order metadata: cart metadata cannot make an order look like an Allegro order the import would adopt and mark paid, and a duplicate of another integration's order no longer goes into `order_id`.
- A change of the delivery address, the pickup point or the invoice data on Allegro after the import asks a person to compare (it only refreshed the status before).
- A server error answers a plain message; the exception text goes to the server log, masked.
- The User-Agent and the status report the package version (they said 0.2.0).
- A short Allegro or network outage no longer disarms the order import: no answer, 5xx and 429 are retried by the next run and do not count towards the circuit breaker.
- Held imports and plan counts of the other mode (demo or live) no longer block the mirror stock push or show in the plan summary.
- The log line of an armed or disarmed writer names the user id, not the person's name and e-mail.

### Changed

- The import window is now the catch-up import ("Catch-up import", "Import zaległych zamówień"), and the exported `queueImportWindow` is `queueCatchUpImport`. The route `POST /admin/allegro/imports/window` and the stored rows stay as they were.
- In demo mode `writes.orders` must be set explicitly; the other writers stay allowed by default in demo mode.
- Without `appName` the User-Agent starts with `KodaPlus-Allegro-Medusa`.
- Writes to `/admin/allegro*` need a JSON body or the `x-koda-request` header; the admin sends both and works for JWT admins too.
- The page polls the status every 5 seconds while something runs (it was every 2), and the product card keeps its data for 30 seconds.
- The product widget is the hostable card `allegro.product` with an `embedded` mode.
- The import row keeps the buyer login, the delivery method, the pickup point and a short hash of the delivery and invoice data in `details`, so the order card and the summaries never read order metadata.
- README: the demo option is explicit, new Events, Works with Koda Plus hosts, Public API, Uninstall and Compatibility sections, the Out of scope list reworded; a shorter package description; the unused `./providers/*` export is gone.

### Added

- The `koda.integration/1` contract: `GET /admin/allegro/integration`, `GET /admin/allegro/integration/summary` (orders, products and variants) and `GET /admin/allegro/integration/attention` (counters `imports_attention`, `imports_held`, `issues_open`, `offers_stock_problem`), with the facts `channel` (code `allegro`), `payment` (codes `cod` and `paid`), `delivery`, `buyer` and `listing`.
- The order card `allegro.order` (zone `order.details`) over `GET /admin/allegro/medusa-orders/:id`: the import, payment, buyer login, delivery, totals, parcels and invoices sent and the returns and disputes of an imported order.
- "Mark as handled" for an order that needs attention (`POST /admin/allegro/imports/:id/handled`), on the order card and in Imported orders.
- Deep links into the page: `?filter=`, `?q=` and `?list=`.
- Options `previousEncryptionKeys` (key rotation) and `prices.taxInclusive`.
- Demo data from the job `allegro-demo-seed` or `POST /admin/allegro/demo/seed`, with `demoSeed` in the status and a "Prepare now" button.
- Events `allegro.writer.tripped`, `allegro.import.held` and `allegro.outbox.failed`.
- The store routes refuse `allegro_*`, `marketplace_order_ref` and `koda_demo` in shopper metadata.
- Type declarations in the package.

## 0.2.1 (2026-10-07)

### Fixed

- Admin pages work when the plugin is installed from npm: the admin libraries are optional peers, so the app keeps the copies of Medusa's dashboard instead of a second, newer copy.

### Changed

- README describes this plugin only: the section comparing it with another Allegro integration is gone.
- The admin page runs on the shared Koda Plus kit 1.0.1: the setup prompt pins this exact version, checks the package signatures (`npm audit signatures`) and shows the note before saving it; the prompt is copied only with its Copy button.
- `prepublishOnly` runs the typecheck too.
- README links are absolute, so they work on npm and medusajs.com.
- References: stores that start soon (`soon: true`, shown with a Soon badge and no link); the since date is no longer shown.

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

### Admin page (the same in all five Koda Plus integrations)

- One header: the name with the state badges, the description, then a toolbar with the view tabs (Panel, Setup guide, Settings, each with its name) and the page's actions, one main button and the others beside it or under More actions.
- The panel shows the business (counters, lists next to the Medusa product or order); Settings hold the technical parts (account, writers, plans, history).
- "Running in N stores" from the `references` option, with the rating and its source (`review`), and "Add your store", a request to Koda Plus by e-mail.
- "Copy prompt": a prompt for an AI coding agent (Claude Code, Cursor) that installs the plugin in another Medusa project the way the setup guide shows, with every writer off, and leaves notes for the next session.
- "Help on Discord": the Koda Plus server.
- Polish copy typeset: no one-letter word or short conjunction left at the end of a line.

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
