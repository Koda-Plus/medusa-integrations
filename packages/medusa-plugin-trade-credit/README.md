# Trade Credit by Koda Plus

Credit limits and payment terms for B2B customers, right where the store is run: net 14, 30 or 60 days, the used amount from the customer's unpaid orders, due dates per order, an overdue check and a blocking toggle. The customer sees their own limit, the used amount and the open invoices in the storefront.

A wholesaler does not sell on prepayment alone: its customers buy on invoice with terms. This plugin keeps who may owe what, what is owed now and what is past due, in the Medusa admin, and reflects the same state to the customer's account. A store that already keeps trade credit in its own code can use the plugin as the page over it instead (store mode, below).

**Live demo:** Medusa admin [medusa.koda.plus/app/credit](https://medusa.koda.plus/app/credit?demo=en), signed in to a public demo account by the link itself. The demo storefront [demo.koda.plus](https://demo.koda.plus/pl-pl) shows the credit card in the account panel.

![Trade Credit page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-trade-credit/docs/admin-credit.png)

![The setup guide of the Credit page](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-trade-credit/docs/admin-credit-guide.png)

## What it does

- **Credit limits per customer**: how much a customer may owe, the used amount from their unpaid orders, and what is left.
- **Payment terms**: net 0 (immediate), 14, 30 or 60 days. An order placed by a customer with terms gets a due date.
- **Credit orders**: every order on a customer's account, with its due date and its state (open, overdue, paid). The daily job flips open orders past their due date to overdue and open orders whose payment was captured to paid.
- **Blocking and pausing**: a blocked customer is flagged everywhere and, with `enforce: true`, the store refuses to complete their cart.
- **The customer's own credit**: the limit, the used and remaining amounts, the terms and the open invoices, through the store API.
- **Store mode** (option `store`): the same page over the credit rules and the ledger a store already keeps, with payment reminders sent from the page.

## Features

- **One page in the admin**: set the terms of a customer (a search finds them by name or e-mail), the limits with their used and remaining amounts and a blocking toggle, and the open credit orders with their due dates, in English and Polish.
- **Products column**: the orders on credit show the thumbnails of their line items under a "View" link that opens a dialog with every line (thumbnail, title, variant, SKU, barcode, quantity, unit price, value). The items come from Medusa's `GET /admin/orders`, one request per page of the list.
- **Live used amounts**: the used amount is the sum of the customer's open and overdue credit orders, recomputed by the daily job and after every placed order.
- **Denormalized customer names**: the panel lists the customer's name and e-mail next to the limit, with a link to the customer.
- **Demo mode** (`demo: true`): the rows written while it is on are flagged `demo` and the page shows a Sample badge.
- **Enforcement** (`enforce: true`): the store's cart completion (`POST /store/carts/:id/complete`) answers 403 `credit_hold` with a `reason` (`blocked`, `paused`, `over_limit`) for a customer with credit terms who is blocked, paused or would pass the limit with this order. Off by default, so the store keeps selling and the panel shows the state.
- **Store mode** (`store`): tiles for customers on credit, used, overdue and used up limits, a customers tab and an orders tab with filters and a search, the store's own rule in its words, the document of each order with a link to the invoicing service, payment reminders with a preview before sending and their history, a link to mark an order paid, and test orders taken off the page.
- **The koda.integration/1 contract**: one line per customer with credit terms on their page, and the board counter of limits to check.

## Requirements

- Medusa 2.12 to 2.21 and Node.js 20+ (see Compatibility).
- Postgres, as every Medusa store has.

## Installation

```bash
npm install @koda-plus/medusa-plugin-trade-credit
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-trade-credit` or `pnpm add @koda-plus/medusa-plugin-trade-credit`.

## Setup in brief

The admin page has the full guide (Credit, then Setup guide, or `/app/credit?view=guide`).

1. **Install the plugin** with your package manager (above).
2. **Add it to `medusa-config.ts`** (below). Every option has a default, so the plugin starts without any.
3. **Run the migrations**: `npx medusa db:migrate` creates `credit_limit` and `credit_order`.
4. **Open Credit in the admin sidebar** and give the first customer a limit and a term (net 14, 30 or 60 days).
5. **Show the credit in the storefront** (optional): `GET /store/credit/me` returns the logged-in customer's limit, terms and open credit orders.
6. **Turn on `enforce`** only after a dry run, once the limits behave the way you want.

A store with its own credit rules skips steps 4 and 6 and passes a `store` adapter instead (Store mode, below).

## Configuration

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-trade-credit",
      options: {
        // Everything is optional.
        enforce: false,
        demo: process.env.CREDIT_DEMO === "true",
      },
    },
  ],
})
```

Run the migrations, then open **Credit** in the admin sidebar:

```bash
npx medusa db:migrate
```

The migration creates two tables of the module: `credit_limit` and `credit_order`.

### Options

Every option has a default, so the plugin starts without any.

- **demo** (boolean, default `false`): demo mode. The rows written while it is on are flagged `demo`. Ignored in store mode.
- **enforce** (boolean, default `false`): with `true`, the store refuses to complete a cart for a customer over their limit or blocked (403 `credit_hold`). Ignored in store mode.
- **store** (object, default none): a `CreditStoreAdapter` (below). With it the plugin runs in store mode. An object without the three functions `accounts`, `orders` and `update` is ignored, and the plugin keeps its own credit.

## Store mode

Use it when the store already keeps trade credit itself: its own limits and terms on the customer, its own rule of what is owed and from which date the term runs, its own checkout gate. Two ledgers would disagree, so in store mode the plugin keeps none:

- it keeps no limits and records no orders (the `order.placed` subscriber and the daily `credit-overdue` job do nothing, the tables stay empty);
- it gates nothing: `demo` and `enforce` are switched off, and the store's own gate stays the only one;
- it only shows the store's data: the Credit page, the integration lines and counters, and `GET /store/credit/me` read the store's accounts and orders through the adapter;
- a change made on the page (a limit, a term, a block or a pause) goes back through `update`, and the store validates, clamps and saves it.

On the page an account is addressed by its customer id, so `POST /admin/credit/limits/:id` takes a customer id in store mode. Amounts are shown in PLN and kept to two decimals; a limit of 0 sent from the page reaches the store as `null` (no limit, terms only).

### The adapter

The types live in [src/modules/credit/lib/store-adapter.ts](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-trade-credit/src/modules/credit/lib/store-adapter.ts); from the package, take the adapter type from the options, as the example does. Every function gets the Medusa container of the request (`scope`, typed `unknown`: resolve your own services from it).

Required:

- **accounts(scope)**: every account with credit terms, and any account the store counts debt on. Each account is a `StoreCreditAccount`: `customer_id`, `email`, `name`, `company?`, `limit_amount` (`null` for no limit), `net_days`, `used_amount`, `overdue_amount`, `oldest_overdue_days`, `open_orders`, `blocked?`, `paused?`, `note?` (a short line from the store).
- **orders(scope, customerIds?)**: the open orders on credit, for the given accounts or for all of them. Each is a `StoreCreditOrder`: `order_id`, `display_id`, `customer_id`, `total_amount`, `unpaid_amount`, `due_at` (`YYYY-MM-DD`, or `null` while there is no due date yet, for example no invoice; such an order still counts in the limit), `overdue_days` (above 0 means overdue), and the optional `document`, `document_url`, `payment_label`, `reminded_at`, `placed_by`, `reminders` (each `{ at, stage, ok, manual?, overdue? }`, oldest first), `next_reminder` (`{ at, stage }`) and `reminders_note` (why the store sends no reminders for the order).
- **update(scope, customerId, patch, actor)**: writes a change made on the page. The patch has any of `limit_amount`, `net_days`, `blocked`, `paused`; `actor.id` is the admin user who made it.

Optional:

- **capabilities**: `{ block?, pause? }`. The page hides the toggles the store does not support, and the routes never pass them.
- **netDayChoices**: the terms the page offers, in days (default 0, 14, 30 and 60).
- **maxNetDays**: the longest term the store accepts (default 365).
- **ruleText**: one or two sentences on the page, in the store's words, on how its rule works.
- **rulePoints**: the same rule as short phrases with an icon (`{ icon, text, tone? }`, icon one of `debt`, `calendar`, `warning`, `lock`, `cash`, `salon`, `info`, `check`). The page shows them instead of `ruleText`, which stays as their tooltip.
- **markPaidPath**: an admin path with `:id` where an order is marked paid, shown as a link next to each order.
- **reminder**: `{ preview(scope, orderId), send(scope, orderId, actor) }`. `preview` returns `{ to, subject, html, stage, warning? }`, shown before anything is sent; `send` renders and sends the store's own e-mail, records it so the store's schedule does not send the same stage again, and returns `{ stage }`. Without it the page sends no reminders.
- **emailsLogPath**: an admin path with `:order_id` to the e-mail log of an order, linked from the reminders.
- **documentSource**: `{ name, icon? }`, the service the documents live in, for the link next to the order (the icon as a data URI or an https URL).
- **hideOrder(scope, orderId, actor)**: takes an order off the credit page for good (a test order). The store marks it; the page asks first. Without it the page has no such button.

An error thrown by `preview`, `send` or `hideOrder` reaches the admin as a 400 with its message, so write messages a person can read and keep internal details out of them.

### Example

```ts
// src/lib/credit-store-adapter.ts in your Medusa app
import type { CreditPluginOptions } from "@koda-plus/medusa-plugin-trade-credit/modules/credit"

type CreditStoreAdapter = NonNullable<CreditPluginOptions["store"]>

export const creditStore: CreditStoreAdapter = {
  async accounts(scope) {
    // Read your own ledger here, resolving your services from scope
    // (the Medusa container). Fake data for the example.
    return [
      {
        customer_id: "cus_01EXAMPLE",
        email: "buyer@example.com",
        name: "Anna Example",
        company: "Example Studio",
        limit_amount: 5000,
        net_days: 30,
        used_amount: 1250.5,
        overdue_amount: 0,
        oldest_overdue_days: 0,
        open_orders: 2,
      },
    ]
  },
  async orders(scope, customerIds) {
    const rows = [
      {
        order_id: "order_01EXAMPLE",
        display_id: 1001,
        customer_id: "cus_01EXAMPLE",
        total_amount: 750.5,
        unpaid_amount: 750.5,
        due_at: "2026-11-15",
        overdue_days: 0,
        document: "FV 1/10/2026",
        document_url: "https://invoices.example.com/1",
      },
    ]
    return customerIds ? rows.filter((o) => customerIds.includes(o.customer_id)) : rows
  },
  async update(scope, customerId, patch, actor) {
    // Validate, clamp and save on the customer, recording actor.id.
  },
  capabilities: { block: true },
  netDayChoices: [0, 14, 21],
  maxNetDays: 21,
  ruleText: "The term runs from the invoice date. A customer over the limit pays the missing amount first.",
  markPaidPath: "/orders/:id",
}
```

```ts
// medusa-config.ts
import { creditStore } from "./src/lib/credit-store-adapter"

module.exports = defineConfig({
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-trade-credit",
      options: { store: creditStore },
    },
  ],
})
```

## Demo mode

Only with `demo: true` (for example `demo: process.env.CREDIT_DEMO === "true"`). The plugin calls no outside service in any mode; in demo mode every limit and credit order it writes carries the `demo` flag, the page shows a Sample badge and the integration manifest says `demo`. The plugin seeds no rows itself: give a few customers limits on the page, or seed them from a script of your app. Demo mode is off in store mode.

## Admin API

- `GET /admin/credit`: the limits, the open credit orders and the counters. In store mode also `mode: "store"`, the capabilities, the term choices, the rule text and what the page may link and send.
- `POST /admin/credit/limits`: creates or updates the terms of a customer (`{ customer_id, limit_amount, net_days, currency_code? }`). In store mode it goes to the adapter's `update`.
- `POST /admin/credit/limits/:id`: changes the amount, the terms, the blocking toggle or the status (`{ limit_amount?, net_days?, blocked?, status? }`). In store mode `:id` is the customer id.
- `GET /admin/credit/orders/:id/reminder`: store mode, the payment reminder of an order before it is sent (`{ to, subject, html, stage, warning }`, never cached). 404 `not_supported` without `reminder` in the adapter.
- `POST /admin/credit/orders/:id/reminder`: store mode, sends it (`{ sent: true, stage }`).
- `POST /admin/credit/orders/:id/hide`: store mode, takes a test order off the credit page (`{ hidden: true }`). 404 `not_supported` without `hideOrder` in the adapter. Nothing is deleted.
- `GET /admin/credit/integration`: the koda.integration/1 manifest.
- `GET /admin/credit/integration/summary?entity=customer&id=` (or `ids=`, up to 50): one line per customer with credit terms.
- `GET /admin/credit/integration/attention?scope=customers`: the board counter of limits to check (blocked or used up, and in store mode also overdue).

Every write takes a JSON body or the `x-koda-request` header and answers 415 `json_required` otherwise. The plugin's admin sends both.

## Store API

- `GET /store/credit/me`: the logged-in customer's own limit and open credit orders, 404 `no_limit` without terms. Reads only. In store mode it reads the adapter.

## Security

- **Writes from the admin or a server only:** writes to `/admin/credit/*` take a JSON body or the `x-koda-request` header and answer 415 otherwise (Medusa's session cookie is `SameSite=None` in production, so a form on another site could otherwise post with it).
- **The customer's own data only:** `/store/credit/*` needs a logged-in customer (session or bearer) and reads by the customer id of the session, never by an id or an e-mail in the request.
- **Order ids are checked** before they reach the adapter (letters, digits and underscores, up to 80 characters).
- **The reminder preview is sandboxed:** the store's e-mail is shown in an `iframe` with an empty `sandbox`, so its scripts and forms never run in the admin. A reminder goes only after a person clicks Send.
- **The adapter is your server code:** the plugin trusts what it returns. Return `https` links in `document_url`, keep secrets out of error messages, and check in `update` what an admin may change.
- **No outside calls:** the plugin itself calls no outside service; amounts and names stay in your database. In store mode only your adapter does what it does.

## Uninstall

1. Turn `enforce` off first if it was on, then remove the plugin from `medusa-config.ts` and the package from `package.json`.
2. The tables `credit_limit` and `credit_order` stay with your data (in store mode they are empty). Drop them by hand when you no longer need them, or run the `down` of the migration, which drops both.
3. In store mode nothing of the store's own ledger is touched: the adapter stays in your code until you remove it.

## Compatibility

Medusa 2.12 to 2.21 (peer range `^2.12.0`) and Node.js 20+. The release of each version runs the smoke test on a fresh Medusa 2.12.6 and 2.21.2 app: migrations, build, start and the admin pages. The admin extension mounts through the Medusa admin SDK; the plugin's admin libraries (`@medusajs/ui`, `@medusajs/icons`, `@tanstack/react-query`, `react`, `react-i18next`, `react-router-dom`) are optional peers, so the app keeps the dashboard's own copies. The Credit entry sits at rank 7 of the sidebar, so a host app can place its own extensions after it.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers the options, the limits and the used amounts, the store helpers, store mode (the mapping of accounts and orders, the status, demo and enforce off) and the koda.integration/1 contract, without a network or a build. Running the tests needs Node.js 22.6+ (they load the TypeScript sources directly).

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. Store mode comes from the trade credit we run in production for a Polish B2B wholesaler, next to our Fakturownia, Subiekt nexo and BaseLinker integrations. Need your own credit rules on the page? Write to kontakt@koda.plus.

## License

[MIT](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-trade-credit/LICENSE)

## Changelog

### 0.2.0 (unreleased)

Store mode: the page over the trade credit a store already keeps, through a `CreditStoreAdapter` (`store` option), with payment reminders previewed and sent from the page, a link to the document of each order, test orders taken off the page and the store's own rule in its words. A Products column in the orders on credit, badges that never wrap, the write guard on the admin routes, the sidebar entry at rank 7 and the admin kit 1.0.9. Full list in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-trade-credit/CHANGELOG.md).

### 0.1.0 (2026-10-08)

First release: per-customer limits and payment terms, credit orders with due dates, the daily overdue job, the admin page in English and Polish, the store API, demo mode and the koda.integration/1 contract.
