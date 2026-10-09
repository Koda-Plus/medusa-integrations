# Loyalty by Koda Plus

Points for every order, right where the store is run: one point per unit of the order total, a reward ladder the customer redeems from, the redemption history and manual adjustments in the admin, and the customer's own points in the storefront.

A wholesaler keeps its customers close with points: every order earns, every reward brings the customer back. This plugin keeps the accounts, the ledger and the ladder in the Medusa admin, awards points on every placed order, and serves the customer their balance, their rewards and their history.

**Live demo:** Medusa admin [medusa.koda.plus/app/loyalty](https://medusa.koda.plus/app/loyalty?demo=en), signed in to a public demo account by the link itself. The demo storefront [demo.koda.plus](https://demo.koda.plus/pl-pl) shows the points, the reward ring and the redeemed rewards in the account panel.

![Loyalty page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-loyalty/docs/admin-loyalty.png)

![The setup guide of the Loyalty page](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-loyalty/docs/admin-loyalty-guide.png)

## What it does

- **Points per order**: an order placed by a customer awards the total times `pointsPerPln`, scaled by the customer's tier multiplier. Idempotent per order; marketplace imports are skipped.
- **A reward ladder**: the rewards in the options, from the cheapest; the panel and the storefront show which reward the customer can redeem next.
- **Redemption**: the customer redeems points for a reward or a discount at `redeemRate`; the redemption is recorded in the ledger and in the account's history.
- **Manual adjustments**: bonuses and corrections from the admin, with a reason.
- **The customer's own points**: the balance, the totals, the saved amount, the redeemed rewards and the latest transactions, through the store API.

## Features

- **One page in the admin**: the points accounts with their balances and tiers, the reward ladder, a manual adjustment with a customer search, and the latest transactions, in English and Polish.
- **The tier multiplier**: the account's multiplier scales the earning of a B2B tier; the flow falls back to 1 when it is unset.
- **Keeps the original tables**: `loyalty_account` and `loyalty_transaction` keep their names and shapes, so stores that ran the original app module carry their rows over; the migration only adds the `demo` flag.
- **Demo mode** (`demo: true`): accounts and transactions flagged `demo`.
- **The koda.integration/1 contract**: one line per customer with points on their page, and the board counter of customers ready for a reward.

## Requirements

- Medusa 2.12 to 2.21 and Node.js 20+ (see Compatibility).
- Postgres, as every Medusa store has.

## Installation

```bash
npm install @koda-plus/medusa-plugin-loyalty
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-loyalty` or `pnpm add @koda-plus/medusa-plugin-loyalty`.

## Configuration

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-loyalty",
      options: {
        // Everything is optional.
        pointsPerPln: 1,
        redeemRate: 0.05,
        rewards: [
          { at: 1500, name: { en: "50 off", pl: "Rabat 50 zł" } },
          { at: 3000, name: { en: "Free 18V drill", pl: "Wkrętarka 18V gratis" } },
        ],
        demo: process.env.LOYALTY_DEMO === "true",
      },
    },
  ],
})
```

Run the migrations, then open **Loyalty** in the admin sidebar:

```bash
npx medusa db:migrate
```

The migration creates the two tables when they are missing and adds the `demo` flag to existing ones, so the rows of the original app module carry over.

### Options

Every option has a default, so the plugin starts without any.

- **demo** (boolean, default `false`): demo mode. Accounts and transactions flagged `demo`.
- **pointsPerPln** (number, default `1`): the points awarded per 1.00 of the order total.
- **redeemRate** (number, default `0.05`): the value of one point (100 points = 5.00).
- **rewards** (list, default none): the reward ladder, each with `at` (the points it costs), `name` (`en`, `pl`) and an optional `discount` value.

## Admin API

- `GET /admin/loyalty` - the accounts, the latest transactions and the counters.
- `POST /admin/loyalty/adjust` - a manual adjustment (`{ customer_id, delta, reason }`).

## Store API

- `GET /store/loyalty` - the logged-in customer's points, rewards and history. Reads only.
- `POST /store/loyalty/redeem` - redeems points (`{ points, reward? }`), answers with the discount and the new balance.

## Compatibility

Medusa 2.12 through 2.21. The admin extension mounts through the Medusa admin SDK; the plugin's admin libraries are optional peers, so the app keeps the dashboard's own copies.

## License

[MIT](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-loyalty/LICENSE)
