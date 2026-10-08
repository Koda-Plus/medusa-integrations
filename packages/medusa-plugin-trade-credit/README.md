# Trade Credit by Koda Plus

Credit limits and payment terms for B2B customers, right where the store is run: net 14, 30 or 60 days, the used amount from the customer's unpaid orders, due dates per order, an overdue check and a blocking toggle. The customer sees their own limit, the used amount and the open invoices in the storefront.

A wholesaler does not sell on prepayment alone: its customers buy on invoice with terms. This plugin keeps who may owe what, what is owed now and what is past due, in the Medusa admin, and reflects the same state to the customer's account.

**Live demo:** Medusa admin [medusa.koda.plus/app/credit](https://medusa.koda.plus/app/credit?demo=en), signed in to a public demo account by the link itself. The demo storefront [demo.koda.plus](https://demo.koda.plus/pl-pl) shows the credit card in the account panel.

## What it does

- **Credit limits per customer**: how much a customer may owe, the used amount from their unpaid orders, and what is left.
- **Payment terms**: net 0 (immediate), 14, 30 or 60 days. An order placed by a customer with terms gets a due date.
- **Credit orders**: every order on a customer's account, with its due date and its state (open, overdue, paid). The daily job flips open orders past their due date to overdue and open orders whose payment was captured to paid.
- **Blocking and pausing**: a blocked customer is flagged everywhere and, with `enforce: true`, the store refuses to complete their cart.
- **The customer's own credit**: the limit, the used and remaining amounts, the terms and the open invoices, through the store API.

## Features

- **One page in the admin**: set the terms of a customer (a search finds them by name or e-mail), the limits with their used and remaining amounts and a blocking toggle, and the open credit orders with their due dates, in English and Polish.
- **Live used amounts**: the used amount is the sum of the customer's open and overdue credit orders, recomputed by the daily job and after every placed order.
- **Denormalized customer names**: the panel lists the customer's name and e-mail next to the limit, with a link to the customer.
- **Demo mode** (`demo: true`): sample limits and credit orders, flagged `demo`.
- **Enforcement** (`enforce: true`): the store's cart completion answers 403 `credit_hold` for a customer over their limit or blocked. Off by default, so the store keeps selling and the panel shows the state.
- **The koda.integration/1 contract**: one line per customer with credit terms on their page, and the board counter of limits to check.

## Requirements

- Medusa 2.12 to 2.21 and Node.js 20+ (see Compatibility).
- Postgres, as every Medusa store has.

## Installation

```bash
npm install @koda-plus/medusa-plugin-trade-credit
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-trade-credit` or `pnpm add @koda-plus/medusa-plugin-trade-credit`.

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

- **demo** (boolean, default `false`): demo mode. Sample limits and credit orders, flagged `demo`.
- **enforce** (boolean, default `false`): with `true`, the store refuses to complete a cart for a customer over their limit or blocked (403 `credit_hold`).

## Admin API

- `GET /admin/credit` - the limits, the open credit orders and the counters.
- `POST /admin/credit/limits` - creates or updates the terms of a customer (`{ customer_id, limit_amount, net_days, currency_code? }`).
- `POST /admin/credit/limits/:id` - changes the amount, the terms, the blocking toggle or the status.

## Store API

- `GET /store/credit/me` - the logged-in customer's own limit and open credit orders. Reads only.

## Compatibility

Medusa 2.12 through 2.21. The admin extension mounts through the Medusa admin SDK; the plugin's admin libraries are optional peers, so the app keeps the dashboard's own copies.

## License

[MIT](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-trade-credit/LICENSE)
