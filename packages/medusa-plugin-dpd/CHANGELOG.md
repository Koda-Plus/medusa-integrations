# Changelog

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
