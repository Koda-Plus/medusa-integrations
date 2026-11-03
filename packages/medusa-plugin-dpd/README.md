# DPD by Koda Plus

Ship with DPD Polska from Medusa: the DPD courier and DPD Pickup points, both also with cash on delivery, on the DPD Polska web services.

**Work in progress.** This version creates DPD courier shipments within Poland and DPD Pickup shipments to points in Poland, with or without cash on delivery, gets their labels, and hands them over to the DPD courier (the protocol and the courier order, within Poland only). Tracking, marking fulfillments shipped and delivered, returns and shipments abroad come in the next versions; until then the plan of such a fulfillment says so and nothing is sent to DPD. The full README comes with the first npm release.

## What it does

- **Checkout**: five fulfillment options, `dpd-courier`, `dpd-courier-cod`, `dpd-pickup`, `dpd-pickup-cod` and `dpd-return` (the return option, used only for returns, claims and exchanges). A courier option needs a complete address in a country of the store; a Pickup option needs a point id of the right shape and a phone or an e-mail of the recipient; cash on delivery needs a currency the options allow for the destination.
- **Fulfillment**: creating a fulfillment records the option and the choice of the customer, and builds its plan. With `autoCreate` and the shipment writer armed, a plan without problems is sent to DPD at once; otherwise the shipment waits for a person.
- **Courier shipments in Poland** (`dpd-courier`, `dpd-courier-cod`): a person opens the plan of a fulfillment, reads the receiver (read from the order at that moment), the sender, the boxes, the cash on delivery and the exact request to DPD, and confirms it. One click creates the shipment in DPD (`generatePackagesNumbers`) and gets its label (`generateSpedLabels`). The create carries the hash of the plan that was read: when the order, the settings or the boxes changed since, it is refused and the new plan is shown. A plan with problems sends nothing.
- **DPD Pickup shipments in Poland** (`dpd-pickup`, `dpd-pickup-cod`): the checkout checks the point the customer chose and keeps a public snapshot of it (name, address, kind of point) with the shipping method. The plan reads the point again, fresh, and sends it as the `PUDO` of the `DPD_PICKUP` service, with the cash on delivery next to it for `dpd-pickup-cod`; the person who collects is read from the order and needs a phone or an e-mail. DPD takes one box of at most 20 kg (20 kg itself goes). When the point was confirmed and the box has all three sides, the box is also checked against the size limits of its kind of point (a locker and a Żabka take smaller boxes). A point that is inactive, hands out no parcels, takes no cash on delivery for a `dpd-pickup-cod` shipment or lies outside Poland is a problem of the plan, and nothing is sent.
- **Boxes**: by default one box with the weight of the variants (`weightUnit`), or `defaultBox` when the variants have no weight. The plan can set 1 to 100 boxes by hand, each with its weight and sides, and go back to the automatic ones.
- **Cash on delivery**: the amount is what is still due (the order total minus the captured payments), sent with two decimals, in a currency `codCountries` allows. One shipment of the order carries it; further shipments of the same order go without it. An order paid online (`codPaymentProviders`) gets no cash on delivery at all.
- **Labels**: A4 or `LBL_PRINTER`, chosen when creating the shipment (the default is `labelPage`). The label PDF is stored with the shipment and served from the database, so opening it again never asks DPD again. A shipment created without its label (a timeout, an error of DPD) keeps its waybills and the label can be asked for again. Stored labels are removed after `documentRetentionDays`.
- **Unclear answers**: a create that gets no clear answer from DPD (a timeout, a network error, a 5xx, an answer that does not parse) is never sent again blindly. The shipment goes to `unknown`, and two minutes later it is looked up in DPD by its reference, either by the shipment pass or by the Check in DPD button. Found, its waybills and label are taken over; not found, it goes back to waiting and can be created again with the same reference. When what DPD has does not match what was sent (another number of waybills), the shipment is `ambiguous` and a person accepts DPD's waybills or marks it as handled outside the plugin.
- **Handover to the courier**: a person selects labeled shipments of one sender and gets one DPD protocol for them; then, optionally, orders the DPD courier for that handover. See Handover to the courier below.
- **The shipment pass**, every 5 minutes: removes old labels, takes back claims that ran out, looks up unclear shipments and, with `autoCreate`, creates the new shipments and asks again for labels that did not come. It never takes a backlog: only fulfillments recorded after the writer was armed and within `autoCreateMaxAgeHours`. It also takes back the claims of handovers that ran out, but it never prints a protocol and never orders a courier.
- **Admin page** under DPD in the sidebar, with the shipment lists and their actions, the plan drawer, Settings and the writers, and an order card with the shipments of the order and their actions.
- **Demo mode** (`demo: true`): the same code paths with a simulated DPD. Sample shipments are built from the store's own orders, labels and protocols are sample PDFs and the courier order is simulated; nothing is sent to DPD.

## DPD Pickup

**Where the points come from.** Live, from DPD's MyPudo API, with `pickupLogin` and `pickupPassword` (HTTP Basic) or `pickupApiKey`; the login and password win when both are set. In the sandbox, from a small test catalog, because MyPudo has no test host: `PL14509` is the only point that passes (the DPD demo host accepts no other), and `PL0SBX01` (inactive) and `PL0SBX02` (no parcels handed out) are there to be refused. In demo mode, from a sample catalog, `PL9DEMO01` to `PL9DEMO05` (a DPD point, a locker, a Żabka, a kiosk and a shop), plus `PL9DEMO06` (inactive) and `PL9DEMO07` (send only), which the search never shows. The sandbox and demo mode never call MyPudo. The admin Settings say how points are checked; a live store without MyPudo credentials gets a note there, because every point is then accepted unchecked.

**The checkout** checks the point fresh, within `pointsTimeoutMs`. A confirmed point passes with its snapshot. A point that is not there, inactive, handing out no parcels, without cash on delivery for a cash on delivery option, or outside Poland, is refused with a message for the customer. When the point cannot be checked (no MyPudo credentials, a timeout, a network error, an error status, an answer that does not parse, an error of MyPudo, a wrong key included), the checkout lets the point through without a check and logs a warning, so a MyPudo outage never stops the sales of DPD Pickup; an id outside Poland is refused even then. DPD still refuses a wrong point when the shipment is created, and the plan shows a warning for a point it could not check. In demo mode a point id of the right shape that is not in the sample catalog is accepted at the checkout without a check (a demo store may use real ids, from the PudoFinder widget); its plan then shows the point as not found, and the admin can change it.

**autoCreate never sends a DPD Pickup shipment to a point nobody could check.** Such a shipment stays pending, the shipment pass tries it again within `autoCreateMaxAgeHours`, and after that it waits for a person. A person who reads the plan with its warning can still create it by hand.

**Changing the point.** The plan drawer of a pending or failed Pickup shipment has a point search and changes the point. The new point is checked fresh and never accepted unchecked: when it cannot be checked, nothing changes and the admin can try again in a moment. A point that cannot take the shipment is refused with its problems; box problems are left to the plan. The change is written to the plugin's own row and history only, never to the order, the fulfillment or the customer: **tell the customer yourself** where to collect the parcel. The order card says when the point of the shipment is not the one the customer chose.

**The storefront** stores the id of the chosen point as `pudo_id` in the data of the shipping method, for example `{ "pudo_id": "PL14509" }` when adding the shipping method to the cart; the checkout keeps it as `dpd_pudo_id`. Two ways to let the customer choose:

- **The PudoFinder widget of DPD**: DPD's own map. It needs its own key, given by DPD's IT per domain (not the MyPudo key of the plugin), and it returns only the id of the point. The storefront then reads the point with `GET /store/dpd/points/:id` (to show its address and to know whether it takes cash on delivery) and stores its id as `pudo_id`.
- **Your own list or map** on the store routes below.

Only points in Poland in this version, in the routes and at the checkout.

### Store API

Both routes ask for the publishable API key, as every Medusa `/store` route does. They answer public point data only, with `Cache-Control: public, max-age=300`.

- `GET /store/dpd/points`: the points a parcel can go to now (active, handing out parcels, in Poland), up to 25. Search by `zip` (a Polish postal code, `02-495` or `02495`) with an optional `city` and `address`, or by `lat` and `lng` (nearest first; MyPudo searches within 5 km), not both. `country` may only be `PL`. `cod=true` keeps the points that take cash on delivery. `limit` is 1 to 25, 10 by default. Answers `{ points, source }`, where `source` is `live`, `sandbox` or `demo`.
- `GET /store/dpd/points/:id`: one point by its id, only when a parcel can go to it now; anything else answers 404 `point_not_found`. Answers `{ point, source }`; `point.cod` says whether it takes cash on delivery.

A point has its `id`, `name`, `type` (the kind of point as MyPudo gives it), `isLocker`, `partner`, `address` (`line1`, `line2`, `zip`, `city`, `country`), `lat` and `lng`, `active`, `services`, `delivery`, `cod`, the opening `hours` per day (1 is Monday), `distance` in metres for a search by place, and the `limits` of its kind (weight and box).

A wrong query answers 400 `invalid`. Searches are limited per client address (`pointsPerMinute`, then 429 `rate_limited` with `Retry-After`). Searches are cached for ten minutes and points for an hour, in the process; all the store routes of one process together call MyPudo at most 120 times a minute (then 503 `points_unavailable` with `Retry-After`). When MyPudo does not answer, the routes answer 502 `points_unavailable`, and 503 when it is not configured.

**Behind a proxy or a load balancer**, set Express `trust proxy` in your Medusa server, so that the limit counts each client and not the proxy: otherwise every customer of the store shares one limit.

## Handover to the courier

**Two steps.** Step one is the protocol: `generateProtocol` with the `DOMESTIC` session, as a PDF, under the `shipment` writer. Step two, optional, is the courier order, under the `pickup` writer. A store with a regular pickup by DPD stops at the protocol.

**Which shipments.** Outbound shipments with a label, within Poland, not in another handover, whose fulfillment Medusa has not canceled. One sender per handover: when the store ships from several stock locations with `senders`, the panel asks for one group. Up to 100 shipments. Courier, courier with cash on delivery and DPD Pickup shipments go together in one protocol.

**The protocol.** All or nothing: when DPD refuses one shipment, there is no protocol and no shipment changes its state. The protocol is stored with the handover and served from the database. "Print again" gives a new DPD document with a new number, so it is only a deliberate action, never a retry. The protocol prints the company and the address of the receivers; it is stored like a label and removed after `documentRetentionDays`. DPD fills the place of dispatch on the protocol from the account data of the paying FID.

**Cancel in Medusa after the handover.** Before calling DPD for the protocol, the flow writes `dpd_handed_over_at` and `dpd_dispatch_id` into the data of the fulfillment, and the provider then refuses to cancel the fulfillment (`NOT_ALLOWED`, HTTP 400 in the admin), so that Medusa does not put goods that have left back in stock. A first protocol that DPD refuses or does not answer clearly, a withdrawn shipment and a canceled handover clear the marker. Demo mode never writes it.

**Ordering the courier.** The plugin reads the availability for the sender's postal code (Poland only). The date is from today to 14 days ahead and the window lies wholly inside one of the ranges DPD offers, in Europe/Warsaw time. The box count and the weights come from the plan; a box over 50 kg blocks the courier order, not the protocol. When DPD does not answer about the availability, nothing is sent.

**Never ordered twice.** An unclear answer (a timeout, a network error, a 5xx, an answer without an order number) gives the state `unknown`; the plugin never orders again by itself, because a second courier costs money. A person checks in DPD and chooses "ordered" (optionally with the order number; without the `checkSum`, the order is then changed and canceled in DPD) or "not ordered". The same decision closes an order without a `checkSum` whose courier was called off in DPD, and an order whose change DPD refused as no longer valid. The admin shows the order number; the `checkSum` never leaves the server.

**Changing and canceling.** A new date or window; withdrawing a shipment (locally before the courier order, by changing the courier order after it, and by canceling the courier order for the last shipment); "Cancel courier" (the shipments stay handed over and another courier can be ordered); "Cancel handover" only without an active courier order. A protocol that lists a withdrawn shipment is marked out of date; "Print again" gives a current one. The plugin does not take a protocol back in DPD, because DPD has no such operation.

**Do not send.** A shipment with waybills that will not go leaves the candidates (`excluded`) and can come back. DPD cannot cancel a shipment through the API; with cash on delivery, the money will not come in.

**Sandbox and demo.** In the sandbox the protocol and the availability go to the DPD demo host, while the courier order, its change and its cancel are simulated in the process, because the demo host cannot order a courier. Settings and the drawer say so. A simulated order has the number `SBX` followed by 11 digits; after a restart of the process, changing or canceling it ends in an unclear result that a person resolves. In demo mode everything is simulated and the protocol is a sample PDF; demo mode does not write the marker into the fulfillment data, so canceling the fulfillment in Medusa works. Handovers of the sandbox and their markers belong to the sandbox: before switching the sandbox to another mode, cancel its open handovers (with an ordered courier, "Cancel courier" first), otherwise the fulfillments of these handovers cannot be canceled in Medusa until you go back to the sandbox and do it there.

**Nothing automatic.** `autoCreate` and the shipment pass never create a handover, never print a protocol and never order a courier.

## Requirements

- Medusa 2.12 or newer and Node.js 20+.
- A DPD Polska business account with access to the DPD web services (login, password and the FID of the account). Demo mode runs without it.

## Installation

```bash
npm install @koda-plus/medusa-plugin-dpd
```

## Configuration

The plugin is registered twice with the same options object: as a plugin (the data module, the admin page, the routes and the job) and as a provider of Medusa's fulfillment module. Keep the id `dpd`: the provider is then `dpd_dpd`.

```ts
import { defineConfig } from "@medusajs/framework/utils"

const dpd = {
  login: process.env.DPD_LOGIN,
  password: process.env.DPD_PASSWORD,
  masterFid: process.env.DPD_MASTER_FID,
  sender: process.env.DPD_SENDER, // JSON, see below
  // mode: "live",          // sandbox by default
  // shipmentWriter: true,  // allows creating shipments; arm it in Settings
  // demo: true,            // sample shipments from your orders, nothing sent to DPD
}

module.exports = defineConfig({
  // ...
  plugins: [{ resolve: "@koda-plus/medusa-plugin-dpd", options: dpd }],
  modules: [
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
          { resolve: "@koda-plus/medusa-plugin-dpd/providers/dpd", id: "dpd", options: dpd },
        ],
      },
    },
  ],
})
```

Run the migrations, then open DPD in the admin sidebar:

```bash
npx medusa db:migrate
```

Missing or broken options never stop the boot: they are listed in the admin. Demo mode runs only with `demo: true`.

### Options

Every option is optional. Numbers and booleans may come as strings from environment variables, lists as comma separated strings, objects as JSON; a value that cannot be read is ignored and listed in the admin.

Connection:

- `login`, `password` (default none): the DPD web services login and password (HTTP Basic). They never leave the server.
- `masterFid` (default none): the FID of the account, sent in the `x-dpd-fid` header. `payerFid` (default the master FID): the FID that pays for the shipments.
- `mode` (default `"sandbox"`): `"sandbox"` (the DPD demo host) or `"live"`.
- `demo` (default `false`): sample shipments built from the store's orders with a simulated DPD. Only `true` turns it on: missing credentials never do.
- `timeoutMs` (default `20000`, 5000 to 45000): how long one call to DPD may take. A create that runs out of time goes to `unknown` and is looked up, never sent again blindly.
- `requestsPerMinute` (default `60`, 10 to 600): calls to DPD per minute from one process. A call that would wait more than 15 seconds for its turn is not sent and the shipment can be tried again.

DPD Pickup points (live mode only; the sandbox and demo mode use their catalogs):

- `pickupLogin`, `pickupPassword` (default none): the MyPudo login and password (HTTP Basic). `pickupApiKey` (default none): the MyPudo key, used when the login and password are not both set. They never leave the server and are masked everywhere.
- `pointsTimeoutMs` (default `3000`, 1000 to 10000): how long one call to MyPudo may take. The checkout lets an unchecked point through, so this is also the longest a customer waits for the check.
- `pointsPerMinute` (default `30`, 5 to 600): point searches per minute from one client address on the store routes.

Writes:

- `shipmentWriter` (default `false`; in demo mode `true`, acting on the simulation only): allows creating shipments, getting labels, looking up unclear shipments in DPD (a label and a lookup advise the parcels in DPD), the protocols of the handover and "do not send". It works only when a person also arms it in Settings.
- `pickupWriter` (default `false`; in demo mode `true`, acting on the simulation only): allows ordering, changing and canceling the courier, and resolving `unknown` courier orders, orders that need a person and orders without a `checkSum`. It works only when a person also arms it in Settings. In the sandbox the courier order is simulated also with this writer armed.
- `autoCreate` (default `false`): with the shipment writer armed, create the shipment as soon as its fulfillment is created, from a plan without problems, and let the shipment pass create the ones it missed. Plans with problems wait for a person either way.
- `autoCreateMaxAgeHours` (default `24`, 1 to 720): the shipment pass creates only fulfillments recorded after the shipment writer was armed and within these hours.

Shipments:

- `sender` (default none; required outside demo mode): `{ company, name, phone, email, street, city, postalCode, countryCode }`, the sender of every shipment. `senders`: a sender per stock location id, for stores shipping from several warehouses. Ordering the courier needs a Polish postal code of the sender.
- `orderer` (default the sender): `{ name, fullName, phone }`, who orders the courier. `name` defaults to the sender's company, `fullName` to the sender's contact person, `phone` to the sender's phone.
- `labelPage` (default `"A4"`): `"A4"` or `"LBL_PRINTER"`, the label page the plan drawer offers first; the page is chosen when creating the shipment, and a stored label is not printed again in another format yet.
- `weightUnit` (default `"g"`): the unit of the variant weights, `"g"` or `"kg"`. `defaultBox` (default none): `{ weightKg, lengthCm, widthCm, heightCm }`, the box when the variants have no weight.
- `codCountries` (default `{ "PL": ["PLN"] }`): cash on delivery currencies per destination country. `codPaymentProviders` (default `["pp_system_default"]`): the payment providers that mean "pay at the door".
- `documentRetentionDays` (default `90`): days a stored label or protocol is kept.

The other options (`countries`, `trackingMode`, `infoLogin`, `infoPassword`, `infoChannel`, `statusMap`, `internationalReturns`, `fulfillmentStatusWriter`) are read and checked already, and are used by the next versions.

## Write safety

- **Two switches per writer.** The option (`shipmentWriter`, `pickupWriter`) is the hard one: `false` wins and the admin cannot override it. The switch in Settings is the runtime one, stored with who flipped it and when.
- **One shipment per fulfillment**: one row per fulfillment before anything goes out, an atomic claim with a lease, and a reference that never changes (the fulfillment id). DPD refuses a second shipment with the same reference, and the plugin reads that refusal as "it exists" and takes the shipment over.
- **Plan first**: a person confirms the plan of this moment (its hash); a plan with problems sends nothing.
- **One courier per handover, never sent twice**: DPD has no idempotency key for a courier order, so an unclear answer gives `unknown`, nothing is sent again, and a person says whether the courier was ordered.
- **The handover marker**: written into the fulfillment data before DPD is asked for the protocol and cleared when DPD refuses it; while it is there, Medusa may not cancel the fulfillment.
- **Nothing that cannot be undone is pretended**: DPD's web services cannot cancel a shipment. When a fulfillment is canceled after its shipment was created, the row stays as it is and the history says so; an unclear one is looked up to tell whether DPD has it.

## Security and data

- **Credentials stay on the server**: masked in logs, errors and the admin, which only knows whether they are set.
- **Personal data stays where it lives**: the receiver's name, phone, e-mail and address (and, for DPD Pickup, those of the person who collects) are read from the order when a plan is built and go only to DPD and to the plan answer (not cached). The address of a Pickup point is public data and is kept with the shipping method and the shipment. The plugin's tables keep ids, the option, the boxes, the cash on delivery amount, the reference, the waybills and the states; problems name what is wrong, never the value. Stored labels carry what DPD prints on them and are removed after `documentRetentionDays`. Protocols carry the company and the address of the receivers (not the name of a person); they are stored like labels, served only to the admin and without a cache, and removed after `documentRetentionDays`.
- **The `checkSum` of a courier order** (it allows changing and canceling the order) never goes to the logs, the history or an answer; the admin sees only the order number.
- **Admin routes** sit behind Medusa's admin authentication, and writes need a JSON body or the `x-koda-request` header.
- **Shopper metadata is not state**: a shopper may not set `dpd_*` keys on a cart or the account through the Store API, and the point snapshot is added only by the checkout after its check.
- **MyPudo credentials**: the key travels in the URLs of MyPudo, so every URL, error and log line of MyPudo is masked, and no MyPudo URL is stored or answered.

## What this plugin does not do (yet)

- It does not send shipments abroad, also not to DPD Pickup points outside Poland, and it does not create returns.
- It does not change a Pickup point by itself and does not tell the customer about a change.
- It does not filter the points by the weight of the cart, and it does not use the holiday filter of MyPudo: a point closed for a day within two weeks may not be listed.
- It does not hand over shipments abroad and does not order a courier abroad.
- It does not mark fulfillments shipped after the handover (the next version).
- It does not take a protocol back in DPD, does not order pallets or envelopes, and gives the protocol only as a PDF.
- It does not track shipments and does not mark Medusa fulfillments shipped or delivered.
- It does not print a label again in another format: DPD has not yet said whether that advises the parcels again.
- It does not calculate shipping prices from DPD's price list: the shipping options' own prices apply.

## Admin API

Every route is behind Medusa's admin authentication. Creating, getting a label and looking up answer 409 while the shipment writer is not allowed and armed. The same goes for printing a protocol, canceling a handover, "do not send" and restoring. Ordering the courier, a new date, canceling the courier, resolving and withdrawing a shipment from an ordered courier answer 409 while the pickup writer is not allowed and armed. The availability needs a configured client, no writer.

- `GET /admin/dpd/shipments/:id`: a shipment with its stored documents (never their bytes) and its history.
- `GET /admin/dpd/shipments/:id/plan`: its plan with the hash, for a shipment not created yet.
- `POST /admin/dpd/shipments/:id/create` `{ planHash, page }`: creates the shipment from the plan that was read and gets its label.
- `POST /admin/dpd/shipments/:id/label` `{ page }`: gets the label of a shipment created without it. `GET /admin/dpd/shipments/:id/label?download=1`: the stored label PDF.
- `POST /admin/dpd/shipments/:id/boxes` `{ boxes }`: sets the boxes by hand, `null` goes back to the automatic ones.
- `POST /admin/dpd/shipments/:id/point` `{ pudoId }`: changes the point of a pending or failed Pickup shipment, checked fresh; it needs no armed writer, because nothing goes to DPD. `GET /admin/dpd/points`: the point search of the admin, the same query as the store route, without its limits.
- `POST /admin/dpd/shipments/:id/lookup`, `.../accept`, `.../skip`: look up an unclear shipment in DPD, accept DPD's waybills of a shipment that does not match, mark a shipment as handled outside the plugin.
- `POST /admin/dpd/dispatch-plan` `{ shipmentIds }`: the plan of a handover for the selected shipments, with its hash.
- `GET /admin/dpd/dispatches` (`filter`, `offset`, `limit`): the handovers. `POST /admin/dpd/dispatches` `{ shipmentIds, planHash, print }`: creates a handover from the plan that was read and, with `print`, prints its protocol.
- `GET /admin/dpd/dispatches/:id`: one handover with its shipments and protocols.
- `POST /admin/dpd/dispatches/:id/print`: prints the protocol, or prints it again as a new DPD document.
- `GET /admin/dpd/dispatches/:id/protocol` (`?download=1`, `?document=<id>`): a stored protocol PDF.
- `GET /admin/dpd/dispatches/:id/availability`: the courier availability for the sender of a handover. `POST /admin/dpd/courier-availability` `{ shipmentIds, groupKey }`: the same before the handover is created.
- `POST /admin/dpd/dispatches/:id/order` and `.../reschedule` `{ pickupDate, pickupTimeFrom, pickupTimeTo }`: orders the courier, or gives the order a new date or window.
- `POST /admin/dpd/dispatches/:id/cancel-courier`, `.../resolve` `{ outcome, orderNumber }`, `.../cancel`: cancels the courier order, resolves an order that needs a person, cancels the handover.
- `POST /admin/dpd/shipments/:id/exclude`, `.../restore`, `.../withdraw`: "do not send", its restore, and withdrawing a shipment from its handover.

## Trademarks

DPD and the DPD logo are trademarks of their owners, used here only to identify the service this plugin connects to. This is an independent integration, not affiliated with or endorsed by DPD.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-dpd/LICENSE).

## Changelog

### 0.4.0 (unreleased)

The handover to the courier within Poland: a protocol for up to 100 labeled shipments of one sender, then optionally the courier order, never sent twice, with a new date, withdrawing a shipment, canceling the courier and canceling the handover; "do not send"; the handover marker that stops Medusa from canceling a fulfillment that has left. Full list in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-dpd/CHANGELOG.md).

### 0.3.0 (unreleased)

DPD Pickup shipments to points in Poland, with or without cash on delivery: the point checked at the checkout (letting it through when MyPudo cannot answer), in the plan and when a person changes it in the admin; the store routes for a point search and one point; the test catalog of the sandbox and the sample catalog of demo mode. Full list in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-dpd/CHANGELOG.md).

### 0.2.0 (unreleased)

DPD courier shipments in Poland, with or without cash on delivery: the plan with its hash, the boxes, the labels, the unclear answers and their lookup, `autoCreate` and the shipment pass. Full list in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-dpd/CHANGELOG.md).

### 0.1.0 (unreleased)

The skeleton: the provider with five options, the data module, the options with sender checks, the writers, the integration contract and the admin page in demo mode.
