# Changelog

## 0.3.0 (unreleased)

- DPD Pickup shipments to points in Poland (`dpd-pickup`, `dpd-pickup-cod`): `DPD_PICKUP` with the point as `PUDO`, cash on delivery next to it, the person who collects as `pudoReceiver` (read live from the order, never stored), one box of at most 20 kg, and the box size against the limits of a confirmed point.
- The point source of each mode: MyPudo live (`pickupLogin` and `pickupPassword`, or `pickupApiKey`; GET only, the key masked everywhere), a test catalog in the sandbox (`PL14509` passes, the only point the DPD demo host takes), a sample catalog in demo mode. The sandbox and demo mode never call MyPudo.
- Checkout: the point is checked fresh and a public snapshot of it is kept with the shipping method; a point that is not there, inactive, handing out no parcels, without cash on delivery for a cash on delivery option or outside Poland is refused. When the point cannot be checked, it is let through without a check and logged. Demo mode accepts a point id outside its catalog without a check.
- The plan reads the point fresh, warns about a point it could not check, and DPD's answers about a Pickup package (a wrong point, two boxes, over 20 kg, no phone or e-mail) become the plan's own problems on the failed shipment.
- `autoCreate` and the shipment pass never send a Pickup shipment to a point nobody could check: it waits (`point_unchecked`) and is tried again within `autoCreateMaxAgeHours`.
- Store routes `GET /store/dpd/points` (by postal code or by place, `cod`, `limit`) and `GET /store/dpd/points/:id`, with a limit per client address, a cache and a budget of MyPudo calls per process.
- Admin: the point and the person who collects in the plan drawer, a point search and the point change of a pending or failed shipment (checked fresh, never unchecked, written to the history), a note on the order card when the shipment's point is not the customer's, a note in Settings when a live store has no MyPudo credentials. `GET /admin/dpd/points` and `POST /admin/dpd/shipments/:id/point`.
- New options `pointsTimeoutMs` and `pointsPerMinute`.
- Courier orders and protocols, tracking, returns and shipments abroad (also to Pickup points abroad) are not in this version.

## 0.2.0 (unreleased)

- DPD courier shipments in Poland (`dpd-courier`, `dpd-courier-cod`) on the DPDServices REST API: `generatePackagesNumbers`, then `generateSpedLabels` in the same click.
- The plan of a shipment: the receiver read live from the order (never stored), the sender, the boxes, the cash on delivery, the reference, the problems and warnings, the exact request and its hash; the create is refused when the plan changed since it was read.
- Boxes from the variant weights or `defaultBox`, or 1 to 100 boxes set by hand in the plan.
- Cash on delivery: the order total minus the captured payments, on one shipment of the order; none for an order paid online.
- Labels (A4 or `LBL_PRINTER`) stored with the shipment and served from the database; a label that did not come can be asked for again; stored labels are removed after `documentRetentionDays`.
- One shipment per fulfillment: an atomic claim with a lease, a reference that never changes, a duplicate refusal of DPD read as "it exists" and taken over, `unknown` after an unclear answer, resolved by a lookup in DPD by the reference (by the shipment pass or a button), `ambiguous` with accept and skip when DPD does not match what was sent.
- `autoCreate` on a new fulfillment and the shipment pass every 5 minutes (`dpd-sync-shipments`), never for a backlog (`autoCreateMaxAgeHours`).
- New options `timeoutMs`, `requestsPerMinute` and `autoCreateMaxAgeHours`.
- Admin: an actions column, the plan drawer with the box editor, label printing, and the actions on the order card. Demo mode runs the same flows with a simulated DPD.
- Pickup shipments, courier orders and protocols, tracking, returns and shipments abroad are not in this version: their plans say they come later and nothing is sent.

## 0.1.0 (unreleased)

- First version: the DPD Polska fulfillment provider with five options (courier, courier with cash on delivery, DPD Pickup, DPD Pickup with cash on delivery, return), the data module, options with sender checks, writers, the integration contract and the admin page in demo mode.
