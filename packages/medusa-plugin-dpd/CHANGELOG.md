# Changelog

## 0.5.0 (2026-11-09)

- The icon is DPD's cube in white on DPD red, a rounded tile like the other Koda Plus integrations (was a generic truck), in the sidebar, the page header and the order card. The admin page has `rank: 100`, so DPD comes last among the extensions.

- Statuses from the DPD InfoServices (`getEventsForWaybillV1`, one call per waybill, the whole history, Polish descriptions) in their own job, `dpd-sync-statuses`, every 5 minutes: claimed rows (several server instances never take the same shipment), at most every 30 minutes after the handover and every 2 hours before it, up to 50 calls and 2 minutes per pass, for 30 days. The job runs without the DPDServices credentials and without the shipment writer.
- A built in map of DPD event codes to stages, `statusMap` on top of it; notifications never change the stage; an unknown code never writes to Medusa and gives "in transit" only to a waybill without a known code, never replacing a stage a known code set (after 030103 it stays preparing until `statusMap` maps it). The `ready` stage is set by the handover. In live mode `in_point` comes only from `statusMap` (DPD has not confirmed the code of the arrival at a Pickup point); the simulator gives it in the sandbox and demo mode.
- The stage of a shipment with several boxes: returned, then problem, then delivered only when every waybill is delivered, else the lowest stage; a waybill with no event yet counts as preparing (ready after the handover). Delivered and returned of a waybill stay after a later event. Each waybill keeps its own stage, last event and DPD description (`tracking`).
- New waybill numbers: a redirect (230402) or a return to the sender (230403, 230408) with exactly one new number swaps the waybill in place, asks the old one once more and updates `dpd_waybills` in the fulfillment data. A redirected parcel stays at least in transit. A parcel back at the shop is `returned`, never delivered in Medusa; on its way back it is in Problems, and once it is back (or 30 days after the handover) it moves to Returns, out of the attention count.
- The fulfillment status writer (`fulfillmentStatusWriter`, off by default): shipped only from an event that means DPD has the parcel, never from the handover or the courier window; delivered when every waybill is delivered (for DPD Pickup, collected from the point). The waybill goes into the labels of the fulfillment, the existing labels stay. Claimed on the row before Medusa's flow runs, released with the error when it fails, retried by the pass every 30 minutes for 30 days after the handover (also after delivery, without asking DPD), or at once by "Write the status to Medusa again". Armed later, it marks the shipments of the last 30 days. A claim left by a process that stopped (older than 15 minutes while Medusa has no shipped or delivered date) is released and written again.
- Events: `dpd.shipment.created`, `dpd.shipment.status_changed` and `dpd.shipment.delivered`, at most once each, with the new fields `previous_stage` and `event_id`.
- After DPD has the parcel, withdrawing it from a handover, "do not send" and canceling the handover are refused (`already_shipped`), and it no longer goes in a new handover (`shipment_picked_up`).
- Sandbox and demo mode: statuses are simulated in the process (DPD has no test host with events). In the sandbox an armed status writer writes to your development store, with `no_notification`, so no customer gets a "shipped" or "delivered" e-mail from a simulated status; in demo mode it writes only the history.
- `trackingMode: "queue"` gives a warning; statuses still go per waybill. The queue client is built and tested, but never called.
- Status events of shipments no longer followed are removed after 120 days.
- The DPDServices, MyPudo and InfoServices clients no longer follow HTTP redirects (a redirect would send the credentials to another address): a 3xx answer is unclear for DPDServices and InfoServices and a failed lookup for MyPudo.
- Admin: the stage, the DPD description and the waybills with their stages in the drawer and on the order card, "Refresh the status", "Write the status to Medusa again", a tile for failed status writes, the status source in Settings; the `fulfillmentStatus` writer is no longer "for later".
- Migration `Migration20261104120000_dpd_tracking` (new columns `tracking`, `status_at`, `status_writer_error` of `dpd_shipment`).
- The InfoServices queue, the DPD tracking link in the Medusa label, the tracking of returns and the dispatch events are not in this version.

## 0.4.0 (unreleased)

- The handover to the courier within Poland, in two steps on one dispatch: a protocol (`generateProtocol`, `DOMESTIC`, PDF) for up to 100 labeled shipments of one sender, courier, cash on delivery and DPD Pickup together; then, optionally, the courier order.
- The protocol is all or nothing: a protocol DPD refuses changes no shipment. It is stored with the dispatch and served from the database; printing it again is a deliberate action and gives a new DPD document.
- The handover marker: before the protocol is asked for, `dpd_handed_over_at` and `dpd_dispatch_id` are written into the fulfillment data, and Medusa then refuses to cancel the fulfillment (`NOT_ALLOWED`). A refused first protocol, a withdrawn shipment and a canceled dispatch clear it.
- The courier order (writer `pickup`): the availability for the sender's postal code, a date from today to 14 days ahead and a window inside an offered range (Europe/Warsaw), the box count and weights from the plan (a box over 50 kg blocks the order). Never sent twice: an unclear answer is `unknown`, and a person says whether the courier was ordered.
- A new date or window, withdrawing a shipment (locally before the courier order, by changing the courier order after it), canceling the courier and canceling the dispatch.
- "Do not send" (`excluded`) for a shipment with waybills that will not go, and its restore.
- Sandbox: protocols and availability on the DPD demo host; the courier order, its change and its cancel are simulated in the process, because the demo host cannot order a courier. Demo mode: sample protocols and a simulated courier.
- The shipment pass takes back dispatch claims that ran out; it never prints a protocol or orders a courier.
- Admin: shipments can be selected and handed over from a drawer with the plan; a Dispatches section with its actions and a tile for dispatches that need a person; the order card shows the dispatch of each shipment; the `pickup` writer is no longer "for later".
- Migration `Migration20261103120000_dpd_dispatch` (new columns of `dpd_dispatch`).
- Handovers abroad, marking fulfillments shipped after the handover, dispatch events, pallets and envelopes are not in this version.

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
