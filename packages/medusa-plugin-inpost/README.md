# InPost by Koda Plus

Ship with InPost from Medusa: Paczkomat parcel lockers and the InPost courier, both also with cash on delivery, on InPost's ShipX API. A fulfillment provider with four shipping options checks the chosen locker at checkout and records it on every fulfillment. The plugin turns that fulfillment into a ShipX shipment from a plan a person reads first, prints the label through the backend, follows the parcel to the locker by webhook with a fallback status pass, and tells the rest of your store about it through events.

**Writes are off by default.** Without them the plugin already works: fulfillments record the locker and the service, plans show exactly what would be sent, labels and statuses of existing shipments are read. Creating, paying, ordering a courier and canceling in InPost happen only when you allow the writer in the options and arm it in the admin, and then either by a button on the plan or, if you choose, automatically.

![InPost page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-inpost/docs/admin-inpost.png)

**Live demo:** Medusa admin [medusa.koda.plus/app/inpost](https://medusa.koda.plus/app/inpost?demo=en), signed in to a public demo account by the link itself. The demo runs the plugin in demo mode: sample shipments built from the demo store's own orders, simulated labels, statuses and courier pickups, and zero requests to ShipX.

## What it does

- **Checkout**: four shipping options, Paczkomat, Paczkomat with cash on delivery, courier, courier with cash on delivery. A Paczkomat option needs a locker code of the right shape that exists in InPost's list; a courier option needs a Polish address with a building number; cash on delivery needs a cart in PLN. The storefront picks the locker with InPost's Geowidget or with the plugin's own locker search.
- **Fulfillment**: creating a fulfillment in Medusa records the option, the locker, the parcel size and the cash on delivery amount (the order's gross total, to the grosz). Nothing is sent to InPost at this moment, so a fulfillment works even when InPost is down.
- **Panel** in the admin, in the lists a warehouse works with: to create, waiting for pickup, in transit, in the locker, delivered, problems and returns (plus skipped and canceled), each shipment next to its order, with its locker or address, cash on delivery, status and tracking number.
- **Plan, then create**: the plan of a shipment shows the receiver (read from the order at that moment), the locker or the address, the size and the weight, cash on delivery with its insurance, the reference, the sending method, the sender and the exact ShipX request. **Create** sends that plan, once.
- **Prepaid accounts**: when InPost prepares offers instead of buying a shipment (`offers_prepared`), the plugin buys the offer of the shipment's service, as the plan announced, as soon as the webhook or the status pass sees it (with the shipment writer armed; **Pay the offer** does it by hand). Until then the Panel shows the shipment as waiting for payment.
- **Courier pickups** for shipments sent with the `dispatch_order` method: one dispatch order for all confirmed shipments, from the sender's address.
- **Labels**: PDF in A6 or A4 through the backend, so the ShipX token never reaches the browser.
- **Tracking**: statuses by webhook, with a status pass every 15 minutes as the fallback; the tracking link on inpost.pl; the names of all 53 ShipX statuses in English and Polish.
- **Medusa follows InPost** (optional writer): the fulfillment is marked shipped with the tracking number and link when InPost has the parcel, and delivered when it is delivered.
- **Order widget** on the order page: the customer's choice with the locker and a map link, each shipment with its status, tracking, cash on delivery, label, plan, actions and history.
- **Locker search** in the admin (to fix a wrong locker before sending) and for the storefront (`GET /store/inpost/points`).
- **Setup guide** and **Settings** in the admin: the InPost account and the webhook, the sender with the default parcel and label, the writers, the history.

## Features

- **The right ShipX hosts**: `https://api-shipx-pl.easypack24.net` and, with `sandbox: true`, `https://sandbox-api-shipx-pl.easypack24.net`.
- **Exact cash on delivery**: amounts are integer grosze end to end and go to ShipX as decimals with two places; the insurance equals the amount, as InPost requires for couriers. A cart in another currency cannot choose a cash on delivery option.
- **Parcel sizes** A (small, 8 x 38 x 64 cm), B (medium, 19 x 38 x 64 cm) and C (large, 41 x 38 x 64 cm): a default in the options or in Settings, changeable per shipment before it is sent. Lockers take one parcel up to 25 kg, couriers up to 30 kg; the weight comes from the variants, or `defaultWeightKg`.
- **Validation before InPost sees it**: locker codes, Polish phone numbers of nine digits (`+48` and spaces removed), e-mail, the street split from the building and flat number, postal codes like 00-950, the reference of 3 to 100 characters. Every problem is named in the plan with what to fix.
- **Created exactly once**: one row per fulfillment (unique index), an atomic claim with a lease before the request, and an unclear answer (a timeout, a 5xx) is never retried blindly: the shipment is looked up in ShipX by its receiver and reference first, and adopted when it exists.
- **No second parcel for orders shipped elsewhere**: `skipMetadataKeys` names the order metadata keys another system writes when it ships an order; such orders are skipped, and a key holding `{ shipment_id }` is tracked instead.
- **Webhook with a fallback**: the webhook only says which shipment changed; the plugin reads the shipment from ShipX itself. Every change is applied once (compare and set), whether the webhook or the status pass sees it first.
- **Events** other plugins build on: `inpost.shipment.created`, `inpost.shipment.status_changed`, `inpost.shipment.delivered`, a documented payload without personal data.
- **Never breaks the boot**: missing or broken options are listed in the admin; without a token the plugin runs in demo mode.
- **Demo mode** from the store's own orders, through the same plans, writers and events, with zero requests to InPost.
- **Admin in English and Polish**, with "Copy prompt" for an AI agent and help on the Koda Plus Discord.

## Requirements

- Medusa 2.12 or newer (tested on 2.15.3) and Node.js 20+.
- An InPost business account in InPost Manager with ShipX API access: the API token and the organization id. For tests, an account in the ShipX sandbox.
- Shipping to Poland. Cash on delivery needs orders in PLN and a payment method that does not take the money online (Medusa's manual provider, or one for payment on delivery).
- **Only one InPost plugin per store.** Do not install this plugin next to another InPost fulfillment plugin for Medusa: both would answer the same orders and could send two parcels for one. Remove the other one first. This plugin keeps its data in its own tables (`inpost_parcel`, `inpost_parcel_event`, `inpost_setting`) and never reads or writes the tables of another plugin.

## Installation

```bash
npm install @koda-plus/medusa-plugin-inpost
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-inpost` or `pnpm add @koda-plus/medusa-plugin-inpost`.

## Configuration

The plugin is registered twice with **the same options object**: as a plugin (its data module, the admin page, the routes, the jobs and subscribers) and as a provider of Medusa's fulfillment module (the shipping options and the checkout checks). Keep the object in one constant:

```ts
import { defineConfig } from "@medusajs/framework/utils"

const inpost = {
  apiToken: process.env.INPOST_API_TOKEN,
  organizationId: process.env.INPOST_ORGANIZATION_ID,
  webhookSecret: process.env.INPOST_WEBHOOK_SECRET,
  // sandbox: true,
  // Writes: off unless allowed here AND armed in the admin (allowed by default in demo mode, simulated).
  // shipmentWriter: true,           // create, pay a prepaid offer, order a pickup, cancel
  // fulfillmentStatusWriter: true,  // mark Medusa fulfillments shipped and delivered
  // demo: true, // sample shipments from your orders, nothing sent to InPost
}

module.exports = defineConfig({
  // ...
  plugins: [{ resolve: "@koda-plus/medusa-plugin-inpost", options: inpost }],
  modules: [
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
          { resolve: "@koda-plus/medusa-plugin-inpost/providers/inpost", id: "inpost", options: inpost },
        ],
      },
    },
  ],
})
```

Keep the id `inpost`: the provider is then `inpost_inpost`, the id the earlier InPost providers of Koda Plus used, so shipping options created with them keep working. If your `medusa-config.ts` already has the fulfillment module, add the provider to its `providers` instead of a second entry.

An app that carries the plugin's code in its own `src/` instead of the package registers the same two entries by path: `{ resolve: "./src/modules/inpost", options: inpost }` in `modules`, and `{ resolve: "./src/providers/inpost", id: "inpost", options: inpost }` among the fulfillment providers.

Set the variables in `.env`:

```bash
INPOST_API_TOKEN=...          # InPost Manager: My account, API, ShipX
INPOST_ORGANIZATION_ID=...    # shown next to the token
INPOST_WEBHOOK_SECRET=...     # openssl rand -hex 24
```

Run the migrations, then open **InPost** in the admin sidebar:

```bash
npx medusa db:migrate
```

Then create the shipping options: Settings, Locations and Shipping, the shipping zone of your location, Create option, the InPost provider and one of its four fulfillment options (ids `inpost-paczkomat`, `inpost-paczkomat-cod`, `inpost-kurier`, `inpost-kurier-cod`). The price is the shipping option's own: the provider does not calculate prices.

### Options

Every option is optional. Numbers and booleans may come as strings from environment variables, lists as comma separated strings; broken values fall back to the defaults and are listed in the admin. Missing options never break the boot.

Connection:

- `apiToken` (default none): the ShipX API token from InPost Manager (My account, API). Only in the `Authorization` header of the server's requests; masked in every log, error and admin screen. The Geowidget token of the same page is another, public token: ShipX answers it with 401.
- `organizationId` (default none): the organization id shown next to the token, digits only.
- `sandbox` (default `false`): the ShipX sandbox instead of production, for the API, the points and the Geowidget.
- `demo` (default `true` when `apiToken` is missing, else `false`): sample shipments built from the store's orders; nothing is sent to InPost. With `demo: false` and no token the plugin records fulfillments, says "Not configured" in the admin and sends nothing.

Writes:

- `shipmentWriter` (default `false`; in demo mode `true`, acting on the simulation only): allows the ShipX writes: create a shipment, buy the offer of a prepaid account, order a courier pickup, cancel a shipment ShipX still allows to cancel. The admin cannot arm it while this is not `true`.
- `fulfillmentStatusWriter` (default `false`; in demo mode `true`, simulated): allows marking Medusa fulfillments shipped and delivered.
- `autoCreate` (default `false`): with the shipment writer armed, create the shipment as soon as its fulfillment is created, from its plan, without a click, and let the status pass order the courier pickup of confirmed `dispatch_order` shipments. Plans with problems wait for a person either way.

Shipments:

- `defaultParcelSize` (default `"medium"`): `"small"`, `"medium"` or `"large"` (or `"A"`, `"B"`, `"C"`). A value saved in Settings wins over the option.
- `labelFormat` (default `"A6"`): `"A6"` or `"A4"`. Courier labels exist only as A6. Settings may override it.
- `sender` (default none): `{ companyName, firstName, lastName, email, phone, street, buildingNumber, flatNumber, city, postCode }`. Without it InPost uses your organization's data from InPost Manager, which InPost recommends. The sender goes into a shipment only with an e-mail and a phone; a courier pickup needs the full address. Settings may override it.
- `sendingMethod` (default: your account's own): ShipX `sending_method` per kind, like `{ locker: "parcel_locker", courier: "dispatch_order" }`. Values: `parcel_locker`, `pok`, `pop`, `courier_pok`, `branch`, `dispatch_order`, `any_point`.
- `dropoffPoint` (default none): the locker you drop parcels off at, sent with the `parcel_locker` sending method.
- `referenceTemplate` (default `"Order {display_id}"`): the shipment reference, with `{display_id}`, `{order_id}` and `{fulfillment_id}`. The second parcel of an order gets `/2`, the third `/3`. ShipX takes 3 to 100 characters.
- `weightUnit` (default `"g"`): the unit of variant weights in Medusa, `"g"` or `"kg"`.
- `defaultWeightKg` (default `1`): the parcel weight when the variants have none (the plan says it is estimated).
- `skipMetadataKeys` (default none): order metadata keys that mean "shipped outside Medusa". An order carrying any of them gets no shipment; when the key holds `{ shipment_id }` (or `{ shipment_ids }`), that ShipX shipment is tracked instead. A store whose order management system records its InPost shipments under `inpost_shipment` sets `["inpost_shipment"]`.

Checkout:

- `verifyLockers` (default `true`): check at checkout that the chosen locker exists, in InPost's public points list (cached; when the list does not answer, the checkout goes on).

Tracking and limits:

- `webhookSecret` (default none, so no webhook): the secret part of the webhook URL, at least 24 lowercase letters and digits (`openssl rand -hex 24`). A value of another shape keeps the webhook closed and is listed in the admin.
- `pollEnabled` (default `true`): the status pass every 15 minutes, the fallback of the webhook.
- `pollMaxAgeDays` (default `30`, from 1 to 365): shipments older than this are no longer read.
- `requestsPerMinute` (default `60`, at most 600): the plugin's own limit towards ShipX.
- `timeoutMs` (default `20000`, from 3000 to 120000): one ShipX request.
- `pointsPerMinute` (default `60`): searches one IP may send to `GET /store/inpost/points` per minute.

Presentation:

- `references` (default none): stores running the integration, shown in the admin ("Running in stores built by Koda Plus"): `[{ name, url, icon?, description?, soon? }]`, texts plain or `{ en, pl }`. `soon: true` marks a store that starts on Medusa soon: a "Soon" badge, no link, `url` optional. Entries without a name, or live entries without an https address, are dropped.

## Storefront

When the customer picks a Paczkomat option, show InPost's Geowidget (v5) and send the chosen point with the shipping method. Generate the Geowidget token in InPost Manager (My account, API, Geowidget) for your storefront's domain:

```html
<link rel="stylesheet" href="https://geowidget.inpost.pl/inpost-geowidget.css" />
<script src="https://geowidget.inpost.pl/inpost-geowidget.js" defer></script>

<!-- config="parcelCollectPayment" for the cash on delivery option -->
<inpost-geowidget token="YOUR_GEOWIDGET_TOKEN" language="pl" config="parcelCollect" onpoint="onInpostPoint"></inpost-geowidget>

<script>
  async function onInpostPoint(point) {
    await sdk.store.cart.addShippingMethod(cartId, {
      option_id: shippingOptionId,
      data: {
        machine_id: point.name, // the locker code, like "KRA01M"
        machine_name: point.name,
        machine_address: {
          line1: point.address.line1,
          line2: point.address.line2,
          city: point.address_details.city,
          post_code: point.address_details.post_code,
        },
      },
    })
  }
</script>
```

With `sandbox: true`, load the sandbox Geowidget from `https://sandbox-easy-geowidget-sdk.easypack24.net` with a sandbox token.

The shipping method data fields:

- `machine_id` (required for the Paczkomat options): the locker code. `target_point` and `locker_code` are accepted as well.
- `machine_name` (optional): what the storefront shows, kept on the order.
- `machine_address` (optional): `{ line1, line2, city, post_code }`, shown in the admin and the order widget.
- `inpost_parcel_size` (optional): `"small"`, `"medium"` or `"large"`, when the storefront knows better than the default.

The courier options need no data: the order's shipping address is the delivery address. At checkout the provider answers a Paczkomat option without a valid locker, a locker InPost does not list, a courier option without a full Polish address and cash on delivery outside PLN with a 400 and a message the storefront can show.

The provider stores the method data in one shape, with the earlier fields first (`type: "paczkomat" | "kurier"`, `cod`, `machine_id`, `machine_name`, `machine_address`), then `inpost_option`, `inpost_kind`, `inpost_service` and `inpost_parcel_size`. The shipping options' own data carries `id`, `name`, `kind`, `cod`, `service` and the earlier `type`, so a storefront can tell a locker option from a courier one.

## Store API

`GET /store/inpost/points` finds parcel lockers for a storefront without the Geowidget. Like every `/store` route it needs the publishable API key (`x-publishable-api-key`).

- `q`: a locker code (`KRA01M`), a postal code (`30-415`, nearest first) or a city (`Kraków`).
- `lat` and `lng` instead of `q`: the nearest lockers to a place in Poland.
- `cod=true`: only points that take card payments, for the cash on delivery options.
- `type=any`: every kind of point, not only parcel lockers.
- `limit` (default 10, at most 25).

The answer is `{ points, mode, demo }`. Each point has `code`, `name`, `type`, `status`, `address` (`line1`, `line2`, `street`, `building_number`, `city`, `post_code`, `province`), `location` (`lat`, `lng`), `description`, `opening_hours`, `is_24_7`, `payment_available` and `distance` in metres when the search had a place. Store the chosen one as `machine_id: code`, `machine_name: code`, `machine_address: { line1, line2, city, post_code }`.

Only InPost's public points data is returned. Answers are cached for ten minutes on the server and may be cached for five in the browser. Each IP may send `pointsPerMinute` searches a minute; above that the route answers 429 with `Retry-After`. A search that is neither a code, a postal code, a city nor a place in Poland answers 400; when InPost's list does not answer, 502. Demo mode answers with the demo lockers.

## Webhook

ShipX calls `https://<your backend>/hooks/inpost/<webhookSecret>`. Paste that URL in InPost Manager (My account, API, webhook); Settings in the admin shows it ready to copy. InPost checks the URL with a GET before saving it.

- **The secret in the path is the only key.** It is compared in constant time; a wrong secret, or no `webhookSecret` in the options, answers 404, as if the route did not exist. ShipX signs nothing, so the plugin trusts nothing else either.
- **The body is a doorbell.** A delivery is answered 200 at once; then the plugin reads the named shipment from ShipX with its own token and applies what ShipX says. A forged call changes nothing.
- **Once.** Each delivery is recorded under its own key (event, shipment, status, time), so a repeated delivery stops there; a status already applied by the status pass is not applied again, and its events are not emitted again.
- Events handled: `shipment_confirmed`, `shipment_status_changed` and `offers_prepared`; anything else is answered 200 and ignored. Deliveries for another organization and, in demo mode, all deliveries are ignored.
- InPost sends webhooks from `91.216.25.0/24`, if your firewall allows only known addresses.
- Medusa puts no authentication on `/hooks`, so no middleware is needed.

**The fallback**: the job `inpost-sync-shipments` runs every 15 minutes (minutes 7, 22, 37 and 52). It reads open shipments again (each at most every 25 minutes, younger than `pollMaxAgeDays`), looks up creates without a clear answer, buys prepaid offers and catches up the fulfillment status writer. A store without the webhook still gets every status, only later.

## Events

All three carry the same payload, `InpostShipmentEvent`. The shape is a contract: fields and events may be added, never changed.

- `inpost.shipment.created`: once per shipment, when ShipX accepts it, or when the plugin adopts a shipment it found after an unclear answer.
- `inpost.shipment.status_changed`: once per change of the ShipX status, from the webhook or the status pass.
- `inpost.shipment.delivered`: once, when the status becomes `delivered`, after its `status_changed`.

```ts
interface InpostShipmentEvent {
  id: string                    // the plugin's row (inpar_...)
  order_id: string
  fulfillment_id: string | null
  shipment_id: string           // the ShipX shipment id
  tracking_number: string | null
  tracking_url: string | null   // https://inpost.pl/sledzenie-przesylek?number=...
  status: string                // the ShipX status, like "ready_to_pickup"
  previous_status: string | null
  stage: "preparing" | "ready" | "in_transit" | "in_locker" | "delivered" | "problem" | "returned" | "canceled"
  service: "inpost_locker_standard" | "inpost_courier_standard"
  kind: "locker" | "courier"
  locker: { code: string; name: string | null; address: { line1, line2, city, post_code } | null } | null
  cod: { amount: string; currency: "PLN" } | null   // exact, like "199.99"
  demo: boolean                 // a simulated shipment of demo mode
}
```

The receiver's name, phone, e-mail and address are never in an event. A subscriber that writes to the outside world should skip `demo: true`:

```ts
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { InpostShipmentEvent } from "@koda-plus/medusa-plugin-inpost/modules/inpost"

export default async function parcelInLocker({ event, container }: SubscriberArgs<InpostShipmentEvent>) {
  const shipment = event.data
  if (shipment.demo || shipment.stage !== "in_locker") return
  // "Your parcel is waiting in Paczkomat " + shipment.locker?.code
}

export const config: SubscriberConfig = { event: "inpost.shipment.status_changed" }
```

With the fulfillment status writer armed, Medusa's own `shipment.created` follows when InPost has the parcel, so your "order shipped" e-mail carries the InPost tracking link.

## Setup in brief

The admin has the full guide (**InPost**, **Setup guide**, or `/app/inpost?view=guide`), each step with its state from your store.

1. **Get the ShipX token and the organization id** in InPost Manager (manager.paczkomaty.pl): complete the company and invoice data, then My account, API.
2. **Try the sandbox first** (sandbox-manager.paczkomaty.pl) with `sandbox: true`. Sandbox courier shipments reach `confirmed` but never show in WebTrucker, and public tracking does not work there.
3. **Install the plugin and its provider** as above, with the same options object and the id `inpost`.
4. **Run `npx medusa db:migrate`.**
5. **Create the shipping options** for the four fulfillment options and set their prices.
6. **Let the storefront send the chosen locker** (Geowidget or `GET /store/inpost/points`) as `machine_id`.
7. **Connect the webhook**: set `webhookSecret`, restart, paste the URL in InPost Manager.
8. **Settings**: the sender (or InPost's organization data), the default parcel size and the label size.
9. **Read a plan, then arm the shipment writer**: fulfill a test order, open its plan, read every line, allow `shipmentWriter`, arm it in Settings and create the first shipment. Turn on `autoCreate` later if you want shipments without a click.
10. **Optionally arm the fulfillment status writer**, so Medusa marks fulfillments shipped and delivered.
11. **Go live**: the production token, the sandbox off, the go-live checklist.

## Write safety

- **Two switches per writer.** The option (`shipmentWriter`, `fulfillmentStatusWriter`) is the hard one: `false` wins and the admin cannot override it. The switch in Settings is the runtime one, stored with who flipped it and when. Demo and live toggles are separate.
- **Plan first.** A person creates a shipment from its plan and sends the plan's hash with the click; when the order, the settings or the shipment changed since the plan was read, the create is refused and the new plan is shown. A plan with problems sends nothing.
- **Auto or button.** With `autoCreate`, an armed writer creates the shipment when its fulfillment is created, from a plan without problems, and the status pass orders the courier pickups; otherwise every shipment and every pickup waits for its button.
- **One shipment per fulfillment**: a unique row before anything goes out, an atomic claim with a lease, and the `unknown` state after an unclear answer, resolved by a lookup in ShipX (by the receiver and the reference) before anything is sent again. Only a lookup a quarter of an hour later that still finds nothing lets a person try again.
- **Cancel only while ShipX allows it**: the status is read first, and only `created`, `offers_prepared` and `offer_selected` can be canceled. Later, the admin says to cancel in InPost Manager (lockers) or WebTrucker (courier). Shipments the plugin did not create (linked, or found under `skipMetadataKeys`) are only tracked, never canceled or paid.
- **Prepaid offers once**: one purchase per shipment at a time (an atomic claim), whoever asks first, the webhook, the status pass or a person.
- **One courier pickup per shipment**: shipments are claimed before the dispatch order, so none is in two pickups.
- **Medusa marks once**: shipped and delivered are claimed on the row before Medusa's flow runs and released with the error if it fails; a fulfillment a person already marked is only noted.

## Security and data

- **The token stays on the server**: only in the `Authorization` header towards the ShipX host of the configured environment; masked in logs, errors, the history and the admin, which only knows whether it is set. Labels are fetched by the backend and streamed to the admin.
- **The webhook trusts only its secret**, compared in constant time, and re-reads every shipment from ShipX.
- **Personal data stays where it lives**: the receiver's name, phone, e-mail and address are read from the order when a plan is built and sent to ShipX only when a shipment is created. The plugin's tables keep the order and fulfillment ids, the option, the locker (public data), the parcel, the cash on delivery amount, the reference and the statuses; problems name what is wrong, never the value. Events carry no personal data.
- **Rate limited** towards ShipX (`requestsPerMinute`), with retries only for reads (network errors, 5xx, 429 with `Retry-After`); writes are sent once.
- **History**: status passes, webhook deliveries, actions and statuses are kept for 120 days.
- **Admin routes** sit behind Medusa's admin authentication. `GET /store/inpost/points` serves public locker data only, limited per IP.

## What this plugin does not do (yet)

- It does not create returns yet: self-service returns through InPost's Returns API (Szybkie Zwroty) and return labels are planned; until then use InPost Manager. A parcel returned to the sender shows under Problems and returns.
- It does not calculate shipping prices from InPost's price list: the shipping options' own prices apply.
- It does not send several parcels in one shipment: one shipment carries one parcel (split the items into more fulfillments for more parcels).
- It does not change a shipment after it is sent (the locker, the size, the receiver): InPost allows that only in InPost Manager.
- It uses two ShipX services, `inpost_locker_standard` and `inpost_courier_standard`: no express, weekend, Allegro or international services.
- It does not notify the customer itself: Medusa's `shipment.created` and the plugin's events let your e-mail plugin do that.

## Compared with other InPost plugins for Medusa

Other InPost plugins for Medusa exist; do not install two of them together. Where this one differs:

- Its ShipX logic is generalized from the order management system of a Polish cosmetics wholesaler, where it runs InPost shipping in production: plans, cash on delivery to the grosz, the guard against a second parcel, webhooks with a fallback status pass.
- Cash on delivery variants of both the Paczkomat and the courier option.
- Writes are off by default, and every shipment is created from a plan a person can read.
- The webhook is a doorbell: statuses come from ShipX itself, with a fallback status pass.
- Events with a documented contract, a setup guide in the admin, an order widget and a demo mode.

## Admin API

Every route is behind Medusa's admin authentication. Writes answer 409 while the shipment writer is not allowed and armed.

- `GET /admin/inpost`: the status (mode, configuration, counts, writers, settings, webhook, last pass). No call to ShipX.
- `GET /admin/inpost/parcels?filter=all|to_create|waiting|in_transit|in_locker|delivered|problems|canceled|skipped&q=&offset=0&limit=20`: the Panel lists.
- `GET /admin/inpost/parcels/:id`, `GET /admin/inpost/parcels/:id/plan`: a shipment with its history; its plan with the hash.
- `POST /admin/inpost/parcels/:id/create` `{ planHash }`: creates the shipment from the plan that was read.
- `POST /admin/inpost/parcels/:id/cancel`, `.../buy`, `.../refresh`, `.../lookup`: cancel while ShipX allows it, buy the prepaid offer, read the status, look up an unclear create.
- `POST /admin/inpost/parcels/:id/locker` `{ code }`, `.../size` `{ size }`, `.../retry`, `.../skip`, `.../link` `{ shipmentId }`: edits before sending, try a failed create again, mark as handled outside, link a shipment created elsewhere.
- `GET /admin/inpost/parcels/:id/label?size=A6|A4&download=1`: the label PDF.
- `POST /admin/inpost/pickup` `{ ids? }`: one courier pickup for the confirmed `dispatch_order` shipments.
- `GET /admin/inpost/orders/:orderId`: the order widget.
- `GET /admin/inpost/points?q=`: the locker search.
- `POST /admin/inpost/settings`: the sender, the default parcel size and the label size of the current mode.
- `POST /admin/inpost/writers` `{ writer: "shipment" | "fulfillmentStatus", on }`: arms or disarms a writer.
- `POST /admin/inpost/sync`: a status pass now (202). `POST /admin/inpost/check`: checks the token and the organization.
- `GET /admin/inpost/events`: the history. `POST /admin/inpost/demo/reset`: demo mode only, starts the simulation over.

## Workflows

```ts
import {
  createInpostShipmentWorkflow,
  refreshInpostShipmentWorkflow,
  syncInpostShipmentsWorkflow,
} from "@koda-plus/medusa-plugin-inpost/workflows"

await syncInpostShipmentsWorkflow(container).run({ input: { trigger: "manual" } })
```

The same rules as the admin: creating needs the shipment writer allowed and armed.

## Demo mode

`demo: true`, or no `apiToken`, builds 16 sample shipments from the store's newest orders: three to create (one without a locker), two waiting for pickup, one waiting for the payment of a prepaid offer, two in transit, two in the locker (one after a pickup reminder), three delivered, one not collected in time, one returned to the sender, and one skipped because another system shipped the order. The lockers are invented (KSP01M to KSP05G), tracking numbers start with 99 and never link to inpost.pl, labels say they are simulated. Arm the shipment writer in Settings and create a shipment from its plan: it moves along by itself, from the label to the locker. Demo rows never meet real ones, Medusa's fulfillments are never touched, and nothing is sent to InPost.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers the plan and the exact ShipX request for each option, cash on delivery in grosze, the address and locker parsing, the options and references, the ShipX client (hosts, retries of reads only, errors, masking), the points search, the SQL of the claims and the compare and set of statuses, the flows end to end against a fake Medusa and a scripted ShipX (create once, unclear answers, prepaid offers, pickups, cancel rules, the fulfillment status writer), the webhook, the demo generator and the house rules of the copy. With `INPOST_TEST_PG_URL=postgres://...` it also runs the migration (twice) and every SQL statement of the store on a real Postgres, in a scratch schema it drops afterwards. What the plugin relies on from InPost's documentation is in [docs/shipx-api-notes.md](./docs/shipx-api-notes.md). To try the plugin in a Medusa app, run `npx medusa plugin:publish` here, then `npx medusa plugin:add @koda-plus/medusa-plugin-inpost` in the app.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland, next to our Fakturownia, BaseLinker, Allegro, OLX, Subiekt nexo and Stripe integrations. Need a hand with shipping or a Medusa store? Write to kontakt@koda.plus.

## Trademarks

InPost, Paczkomat and the InPost logo are trademarks of InPost, used here only to identify the service this plugin connects to. This is an independent integration built on InPost's public ShipX API, not affiliated with or endorsed by InPost.

## License

MIT, see [LICENSE](./LICENSE).

## Changelog

### 0.1.0 (2026-10-07)

First public release: the fulfillment provider with four options (Paczkomat and courier, both with cash on delivery), checkout checks, shipments from a plan with two switches per writer, prepaid offers, courier pickups, labels, webhook with a fallback status pass, events, the Panel, the order widget, the setup guide, settings, demo mode, English and Polish. Full list in [CHANGELOG.md](./CHANGELOG.md).
