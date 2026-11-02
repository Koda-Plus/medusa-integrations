# DPD by Koda Plus

Ship with DPD Polska from Medusa: the DPD courier and DPD Pickup points, both also with cash on delivery, on the DPD Polska web services.

**Work in progress.** This version creates DPD courier shipments within Poland, with or without cash on delivery, and gets their labels. DPD Pickup shipments, the handover to the courier (protocols and courier orders), tracking, returns and shipments abroad come in the next versions; until then the plan of such a fulfillment says so and nothing is sent to DPD. The full README comes with the first npm release.

## What it does

- **Checkout**: five fulfillment options, `dpd-courier`, `dpd-courier-cod`, `dpd-pickup`, `dpd-pickup-cod` and `dpd-return` (the return option, used only for returns, claims and exchanges). A courier option needs a complete address in a country of the store; a Pickup option needs a point id of the right shape and a phone or an e-mail of the recipient; cash on delivery needs a currency the options allow for the destination.
- **Fulfillment**: creating a fulfillment records the option and the choice of the customer, and builds its plan. With `autoCreate` and the shipment writer armed, a plan without problems is sent to DPD at once; otherwise the shipment waits for a person.
- **Courier shipments in Poland** (`dpd-courier`, `dpd-courier-cod`): a person opens the plan of a fulfillment, reads the receiver (read from the order at that moment), the sender, the boxes, the cash on delivery and the exact request to DPD, and confirms it. One click creates the shipment in DPD (`generatePackagesNumbers`) and gets its label (`generateSpedLabels`). The create carries the hash of the plan that was read: when the order, the settings or the boxes changed since, it is refused and the new plan is shown. A plan with problems sends nothing.
- **Boxes**: by default one box with the weight of the variants (`weightUnit`), or `defaultBox` when the variants have no weight. The plan can set 1 to 100 boxes by hand, each with its weight and sides, and go back to the automatic ones.
- **Cash on delivery**: the amount is what is still due (the order total minus the captured payments), sent with two decimals, in a currency `codCountries` allows. One shipment of the order carries it; further shipments of the same order go without it. An order paid online (`codPaymentProviders`) gets no cash on delivery at all.
- **Labels**: A4 or `LBL_PRINTER`, chosen when creating the shipment (the default is `labelPage`). The label PDF is stored with the shipment and served from the database, so opening it again never asks DPD again. A shipment created without its label (a timeout, an error of DPD) keeps its waybills and the label can be asked for again. Stored labels are removed after `documentRetentionDays`.
- **Unclear answers**: a create that gets no clear answer from DPD (a timeout, a network error, a 5xx, an answer that does not parse) is never sent again blindly. The shipment goes to `unknown`, and two minutes later it is looked up in DPD by its reference, either by the shipment pass or by the Check in DPD button. Found, its waybills and label are taken over; not found, it goes back to waiting and can be created again with the same reference. When what DPD has does not match what was sent (another number of waybills), the shipment is `ambiguous` and a person accepts DPD's waybills or marks it as handled outside the plugin.
- **The shipment pass**, every 5 minutes: removes old labels, takes back claims that ran out, looks up unclear shipments and, with `autoCreate`, creates the new shipments and asks again for labels that did not come. It never takes a backlog: only fulfillments recorded after the writer was armed and within `autoCreateMaxAgeHours`.
- **Admin page** under DPD in the sidebar, with the shipment lists and their actions, the plan drawer, Settings and the writers, and an order card with the shipments of the order and their actions.
- **Demo mode** (`demo: true`): the same code paths with a simulated DPD. Sample shipments are built from the store's own orders and labels are sample PDFs; nothing is sent to DPD.

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

Writes:

- `shipmentWriter` (default `false`; in demo mode `true`, acting on the simulation only): allows creating shipments, getting labels and looking up unclear shipments in DPD (a label and a lookup advise the parcels in DPD). It works only when a person also arms it in Settings.
- `autoCreate` (default `false`): with the shipment writer armed, create the shipment as soon as its fulfillment is created, from a plan without problems, and let the shipment pass create the ones it missed. Plans with problems wait for a person either way.
- `autoCreateMaxAgeHours` (default `24`, 1 to 720): the shipment pass creates only fulfillments recorded after the shipment writer was armed and within these hours.

Shipments:

- `sender` (default none; required outside demo mode): `{ company, name, phone, email, street, city, postalCode, countryCode }`, the sender of every shipment. `senders`: a sender per stock location id, for stores shipping from several warehouses.
- `labelPage` (default `"A4"`): `"A4"` or `"LBL_PRINTER"`, the label page the plan drawer offers first; the page is chosen when creating the shipment, and a stored label is not printed again in another format yet.
- `weightUnit` (default `"g"`): the unit of the variant weights, `"g"` or `"kg"`. `defaultBox` (default none): `{ weightKg, lengthCm, widthCm, heightCm }`, the box when the variants have no weight.
- `codCountries` (default `{ "PL": ["PLN"] }`): cash on delivery currencies per destination country. `codPaymentProviders` (default `["pp_system_default"]`): the payment providers that mean "pay at the door".
- `documentRetentionDays` (default `90`): days a stored label is kept.

The other options (`countries`, `orderer`, `trackingMode`, `infoLogin`, `infoPassword`, `infoChannel`, `pickupLogin`, `pickupPassword`, `pickupApiKey`, `statusMap`, `internationalReturns`, `pickupWriter`, `fulfillmentStatusWriter`) are read and checked already, and are used by the next versions.

## Write safety

- **Two switches per writer.** The option (`shipmentWriter`) is the hard one: `false` wins and the admin cannot override it. The switch in Settings is the runtime one, stored with who flipped it and when.
- **One shipment per fulfillment**: one row per fulfillment before anything goes out, an atomic claim with a lease, and a reference that never changes (the fulfillment id). DPD refuses a second shipment with the same reference, and the plugin reads that refusal as "it exists" and takes the shipment over.
- **Plan first**: a person confirms the plan of this moment (its hash); a plan with problems sends nothing.
- **Nothing that cannot be undone is pretended**: DPD's web services cannot cancel a shipment. When a fulfillment is canceled after its shipment was created, the row stays as it is and the history says so; an unclear one is looked up to tell whether DPD has it.

## Security and data

- **Credentials stay on the server**: masked in logs, errors and the admin, which only knows whether they are set.
- **Personal data stays where it lives**: the receiver's name, phone, e-mail and address are read from the order when a plan is built and go only to DPD and to the plan answer (not cached). The plugin's tables keep ids, the option, the boxes, the cash on delivery amount, the reference, the waybills and the states; problems name what is wrong, never the value. Stored labels carry what DPD prints on them and are removed after `documentRetentionDays`.
- **Admin routes** sit behind Medusa's admin authentication, and writes need a JSON body or the `x-koda-request` header.
- **Shopper metadata is not state**: a shopper may not set `dpd_*` keys on a cart or the account through the Store API.

## What this plugin does not do (yet)

- It does not create DPD Pickup shipments: the plan of a `dpd-pickup` or `dpd-pickup-cod` fulfillment says it comes in a later version.
- It does not send shipments abroad, and it does not create returns.
- It does not hand shipments over to the courier: no protocols and no courier orders yet. Use DPD's own tools for that.
- It does not track shipments and does not mark Medusa fulfillments shipped or delivered.
- It does not print a label again in another format: DPD has not yet said whether that advises the parcels again.
- It does not calculate shipping prices from DPD's price list: the shipping options' own prices apply.

## Admin API

Every route is behind Medusa's admin authentication. Creating, getting a label and looking up answer 409 while the shipment writer is not allowed and armed.

- `GET /admin/dpd/shipments/:id`: a shipment with its stored documents (never their bytes) and its history.
- `GET /admin/dpd/shipments/:id/plan`: its plan with the hash, for a shipment not created yet.
- `POST /admin/dpd/shipments/:id/create` `{ planHash, page }`: creates the shipment from the plan that was read and gets its label.
- `POST /admin/dpd/shipments/:id/label` `{ page }`: gets the label of a shipment created without it. `GET /admin/dpd/shipments/:id/label?download=1`: the stored label PDF.
- `POST /admin/dpd/shipments/:id/boxes` `{ boxes }`: sets the boxes by hand, `null` goes back to the automatic ones.
- `POST /admin/dpd/shipments/:id/lookup`, `.../accept`, `.../skip`: look up an unclear shipment in DPD, accept DPD's waybills of a shipment that does not match, mark a shipment as handled outside the plugin.

## Trademarks

DPD and the DPD logo are trademarks of their owners, used here only to identify the service this plugin connects to. This is an independent integration, not affiliated with or endorsed by DPD.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-dpd/LICENSE).

## Changelog

### 0.2.0 (unreleased)

DPD courier shipments in Poland, with or without cash on delivery: the plan with its hash, the boxes, the labels, the unclear answers and their lookup, `autoCreate` and the shipment pass. Full list in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-dpd/CHANGELOG.md).

### 0.1.0 (unreleased)

The skeleton: the provider with five options, the data module, the options with sender checks, the writers, the integration contract and the admin page in demo mode.
