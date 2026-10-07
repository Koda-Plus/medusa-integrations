# Changelog

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
