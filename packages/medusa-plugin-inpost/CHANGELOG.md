# Changelog

## 0.4.0 (2026-11-11)

- InPost returns on the InPost Returns API (InPost Group developer portal, the current "Szybkie Zwroty"). The store creates the return of an order and InPost answers with a short drop-off code the customer types at any Paczkomat (nothing to print) or, without the code, a label. New options `returnsClientId`, `returnsClientSecret`, `returnsOrganizationId` (a UUID, not the ShipX organization id), `returnsEnvironment` (`stage` or `production`, `stage` by default with `sandbox: true`), `returnsWriter` (a hard switch, off by default, on in demo mode) and `returnExpirationDays` (7 to 90). A new writer, "Returns in InPost", armed per mode in Settings.
- A return is created from a plan a person reads (the customer as InPost's sender with the phone in E.164, the origin country, the order number for the label, a code or a label, the expiry, the exact request) and its hash, once: one row per order and Medusa return (unique index), an atomic claim with a lease, a second create answers 409. The Returns API has no idempotency key and no search, so an answer that never came leaves the return `unknown`; nothing sends it again by itself, a person checks InPost and tries again (`checked: true`) or marks it handled.
- The Returns API client: OAuth2 client credentials with Basic auth and the returns scopes, the token kept until shortly before it expires and renewed once after a 401, a create sent once, the label asked as `application/pdf;format=A4`, the secret and the token masked in every message.
- The provider takes returns: a fifth fulfillment option, `inpost-zwrot` ("InPost return (Paczkomat)", `is_return`), and `createReturnFulfillment` records a return on it with no request to InPost (a return on a delivery option is still refused, with a clear message). A Medusa return requested on it (`order.return_requested`) is recorded as a pending InPost return by a new subscriber.
- Admin: the InPost returns under the shipments on the InPost page (filters, search, the drop-off code, the tracking number, the expiry, the actions), an "InPost return" part on the order widget (the plan, the code shown big with a copy button, the tracking link, the label), a "InPost returns (Returns API)" card in Settings, InPost account, with "Test the connection" (it only gets a token), a guide step on getting the credentials from the InPost Integration Team, and the FAQ on returns rewritten. English and Polish.
- Admin routes: `GET/POST /admin/inpost/returns`, `GET /admin/inpost/returns/:id`, `POST .../refresh`, `.../retry`, `.../skip`, `GET .../label`, `GET /admin/inpost/orders/:orderId/return-plan`, `POST /admin/inpost/check/returns`; `no-store` answers.
- Demo mode simulates returns with no request (a 9 digit code, a tracking number of 24 digits from 6303, 14 days to send it, a label marked as simulated) and seeds three sample returns once, also on a demo seeded by an earlier version; the reset removes them.
- The storefront map in Settings: a new option `geowidgetToken` (the PUBLIC Geowidget token from InPost Manager). Settings, InPost account, show a "Storefront map (Geowidget)" card read from the token itself: set or not, sandbox or production, the domains it was issued for, the expiry, and a warning when the map's environment differs from the ShipX one. Never the whole token. `GET /store/inpost/geowidget` serves the token, its environment and the Geowidget script host, so a storefront reads it from Medusa instead of keeping a copy (404 `geowidget_not_configured` when missing or expired).
- A new table, `inpost_parcel_return` (migration `Migration20261106120000_inpost_returns`): run `npx medusa db:migrate`. No customer data in it.
- Removed: the `references` option, the "Running in N stores" badge, the store cards at the end of the setup guide and the "Add your store" button. A `references` key left in the options is ignored.

## 0.3.0 (unreleased)

- A fulfillment another system marks as shipped outside Medusa (`metadata.shipped_outside_medusa`, for example `"baselinker"`) is recorded as skipped (`shipped_outside_medusa:baselinker`) and never becomes a parcel, with no option to set. The BaseLinker plugin of Koda Plus marks the fulfillments it makes when BaseLinker reports an order shipped; before, such a fulfillment of an order on an InPost option became a second ShipX parcel with `autoCreate` on.
- One InPost menu: the page hosts the tabs of the other InPost plugins of Koda Plus. With InPost Pay or InPost Von Halsky in the same app, `/app/inpost` gets a tab bar: Shipping (this page, unchanged) first, then InPost Pay (`?service=pay`) and Von Halsky (`?service=vonhalsky`), each drawn by its own plugin; their own addresses redirect to the tabs and their sidebar entries step aside. Without them the page has no tab bar and nothing changes. No option, no new dependency.
- A courier pickup without a clear answer from ShipX (a timeout, a dropped connection, a 5xx) is `unknown`, not `failed`: the status pass never orders it again, so a pickup that reached ShipX is not ordered twice. A person orders it again by naming the shipments (`POST /admin/inpost/pickup` with `ids`) after checking InPost Manager.
- The lookup after an unclear create reads every page of ShipX's list (up to 200 shipments of the receiver), and a list cut short never makes a shipment "not created": the row stays `unknown` (`lookup_incomplete`) for a person to link or try again. Before, only the first 25 were read, so a shipment beyond them could be created a second time.
- Shared kit 1.1.0: page tabs (`hostPageTabs`, `addPageTab`, `hostedNavIcon`, `KitTabbedPage`, `KitTabRoute`), one sidebar entry for a family of plugins.

## 0.2.1 (2026-10-18)

- The admin menu entry has a rank (3).
- Shared kit 1.0.9: white label support (a store can hide the Koda Plus byline, prompt, community links and references), the order products cell (thumbnails, a dialog with the order lines, products of carts without an order) and the amount breakdown component are available to the admin pages, and loaders, skeleton rows and the guide got small fixes.

## 0.2.0 (2026-10-07)

First npm release.

### Fixed

- Admin pages work when the plugin is installed from npm: the admin libraries are optional peers, so the app keeps the copies of Medusa's dashboard instead of a second, newer copy (which ran the pages in another React context: "No QueryClient set").
- Cash on delivery is collected once per order: the amount still due (the order total minus what was captured) goes on the first live cash on delivery parcel, further parcels of the same order go without it (`cod_on_other_parcel`), and an order paid by any provider outside `codPaymentProviders` gets no cash on delivery (`cod_paid_online`).
- The status pass picks open shipments in the database (not in a final status, younger than `pollMaxAgeDays`, not read for 25 minutes, never read first): delivered parcels no longer fill its batch, so the fallback keeps reading after hundreds of parcels. `autoCreate` asks the database for pending rows without problems.
- `autoCreate` never takes a backlog: only fulfillments recorded after the shipment writer was armed and within `autoCreateMaxAgeHours` (default 48). A fulfillment Medusa already marks shipped or delivered gets no shipment (`fulfillment_shipped`, `fulfillment_delivered`).
- A prepaid offer is bought only for the shipment's own service; without it a person decides.
- A 429 on a write is a clear refusal, not an unclear answer: the shipment no longer waits a quarter of an hour in `unknown`.
- The storefront locker search limits by the client address Medusa resolved, not by a header the client sends.
- Demo events carry no inpost.pl tracking link.

### Changed

- Demo mode only with `demo: true`. Without a token the plugin records fulfillments, says "Not configured" and sends nothing; a missing variable on production never turns real fulfillments into sample rows.
- Writes to `/admin/inpost/*` take a JSON body or the `x-koda-request` header (415 otherwise).
- A shopper may not set `inpost_*` metadata or the keys of `skipMetadataKeys` through the Store API.
- Reads never write: `GET /admin/inpost` no longer builds the demo samples; `POST /admin/inpost/demo/seed` does, asked by the page.
- A return on the InPost provider is refused with a clear error instead of an empty success.
- Unexpected server errors answer a plain sentence; the details stay in the server log.

### Added

- The koda.integration/1 contract: `GET /admin/inpost/integration`, `/integration/summary` (one line per order with the delivery and cash on delivery facts) and `/integration/attention` (board counters with links to filtered lists).
- The order card can be embedded by a host (`embedded`): no header of its own, a line while loading and when the order does not go with InPost.
- Deep links into the page: `?filter=` and `?q=`.
- Options `autoCreateMaxAgeHours` and `codPaymentProviders`.
- The admin works with Medusa's JWT auth (`__AUTH_TYPE__ = "jwt"`), through the shared kit.
- Type declarations in the package; the setup prompt installs this exact version.

## 0.1.0 (2026-10-07)

First public release: InPost Paczkomat lockers and the InPost courier for Medusa, both with cash on delivery, on the ShipX API, with every write off by default.

### Fulfillment provider

- Identifier `inpost`; registered with `id: "inpost"` it is `inpost_inpost`, the id of the earlier InPost providers of Koda Plus, so their shipping options keep working.
- Four fulfillment options: `inpost-paczkomat`, `inpost-paczkomat-cod`, `inpost-kurier`, `inpost-kurier-cod` (services `inpost_locker_standard` and `inpost_courier_standard`), with the earlier `type` and `cod` fields in their data. Flat prices, the shipping options' own.
- Checkout checks: a locker code of the right shape that exists in InPost's public points list (`verifyLockers`, cached, failing open), a Polish courier address with a building number, cash on delivery in PLN only. Messages a storefront can show.
- The method data in one shape: `machine_id`, `machine_name`, `machine_address` (with `target_point` and `locker_code` accepted), the option, the kind, the service and an optional parcel size.
- Creating a fulfillment records the choice and the exact cash on delivery amount and never calls ShipX. The label is available to custom code through `retrieveDocuments(data, "label")`.

### Shipments

- One row per fulfillment in the plugin's own tables (`inpost_parcel`, `inpost_parcel_event`, `inpost_setting`; migration `Migration20261007120000`), recorded by a subscriber of `order.fulfillment_created`, canceled with `order.fulfillment_canceled` while not sent.
- The plan of each shipment: the receiver read from the order, the locker or the address, the size (A, B, C) and the weight, cash on delivery with insurance of the same amount, the reference (`referenceTemplate`, `/2` for a second parcel), the sending method, the drop-off locker, the sender or the organization's data, the courier pickup, the problems and the exact ShipX request, with a hash a person confirms.
- Two writers with two switches each (an option and a toggle in Settings with who and when, separate for demo and live): `shipmentWriter` (create, buy a prepaid offer, order a courier pickup, cancel) and `fulfillmentStatusWriter` (Medusa fulfillment shipped with the tracking link, then delivered, through Medusa's own flows).
- Created exactly once: unique row, atomic claim with a lease, `unknown` after an unclear answer, resolved by a lookup in ShipX by the receiver and the reference before anything is sent again.
- `autoCreate`: with the writer armed, shipments are created when their fulfillment is, and courier pickups are ordered by the status pass.
- Prepaid accounts: `offers_prepared` is shown as waiting for payment, and the offer of the shipment's service is bought once when the writer is armed (or by a button).
- Courier pickups (`dispatch_order`): one dispatch order for all confirmed shipments, from the sender's full address, never two pickups for one shipment.
- Cancel only in `created`, `offers_prepared` or `offer_selected`, after reading the status; later the admin points to InPost Manager or WebTrucker.
- Labels A6 or A4 (`labelFormat`, Settings) through the backend; courier labels A6.
- `skipMetadataKeys`: orders shipped by another system get no second parcel; a key holding `{ shipment_id }` is tracked instead.
- Locker change, size change, retry, skip and linking a shipment created elsewhere, all before anything is sent.

### Tracking

- Webhook at `/hooks/inpost/<webhookSecret>`: the secret compared in constant time, 404 otherwise, 200 at once, the shipment re-read from ShipX, each delivery and each status change applied once.
- Status pass every 15 minutes (`inpost-sync-shipments`) as the fallback, at most 100 shipments a pass, each at most every 25 minutes, up to `pollMaxAgeDays`.
- Events `inpost.shipment.created`, `inpost.shipment.status_changed`, `inpost.shipment.delivered` with a documented payload and no personal data.
- The tracking link on inpost.pl and English and Polish names of all 53 ShipX statuses, grouped into the stages of a parcel.

### Locker search

- `GET /store/inpost/points` by code, postal code, city or place, public data only, cached, limited per IP (`pointsPerMinute`); the same search in the admin.
- The Geowidget v5 snippet and the shipping method data documented in the README.

### Admin

- The InPost page: Panel (to create, waiting for pickup, in transit, in the locker, delivered, problems and returns, skipped, canceled; search; the plan, details, history and actions of each shipment), Setup guide (steps with live states, diagram, go-live checklist, troubleshooting) and Settings (the InPost account and the webhook, the sender with the default parcel and label, the writers, the history).
- The order widget: the customer's choice with the locker and a map link, each shipment with its status, tracking, cash on delivery, label, plan, actions and history.
- The Koda Plus header: mode and writers badges, the stores running the integration (`references`), "Add your store", "Copy prompt" and help on Discord. English and Polish.
- Demo mode: 16 sample shipments from the store's newest orders in every list, invented lockers, simulated labels, statuses, offers and pickups, zero requests to InPost.
