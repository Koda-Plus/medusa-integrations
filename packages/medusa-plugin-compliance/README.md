# EU Compliance by Koda Plus

The EU rules a store cannot skip, in one Medusa plugin: GPSR product safety, RODO / GDPR consent and data subject requests, and the Omnibus price transparency rule. One panel in the admin, a small store API for the storefront, and demo mode with sample data.

The store sells to people in the European Union, so its offers must name the manufacturer and the responsible person, its visitors must be able to say what happens to their data, and a price reduction must show the lowest price of the last 30 days. This plugin keeps all three where the store is run, without another tool to log in to.

**Live demo:** Medusa admin [medusa.koda.plus/app/compliance](https://medusa.koda.plus/app/compliance?demo=en), signed in to a public demo account by the link itself. The demo storefront [demo.koda.plus](https://demo.koda.plus/pl-pl) shows the product safety block on every product page and the data requests in the account panel.

![EU Compliance page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-compliance/docs/admin-compliance.png)

![The setup guide of the Compliance page](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-compliance/docs/admin-compliance-guide.png)

![The product safety block on a product page of the demo storefront](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-compliance/docs/store-gpsr.png)

## What it does

- **GPSR**: manufacturers and responsible persons in the EU, a safety record per product (who made it, who is responsible, warnings and safety information), and the completeness check the distance-sales offer reads from.
- **RODO**: consent records from the cookie banner, the account page and the checkout, and a data subject request queue (access, erasure, portability, restriction, objection, rectification) worked by the team in the panel.
- **Omnibus**: a daily snapshot of the catalog's base prices, so a price reduction can show the lowest price of the last 30 days. Medusa keeps no price history, so the snapshots are the history.

## Features

- **One panel, three sections** in the admin: GPSR, RODO and Omnibus, in English and Polish. Every section can be switched off in the options.
- **Economic operators** with a kind (manufacturer, responsible person, importer, authorised representative), name, address, e-mail and country. A product is GPSR-complete when it names its manufacturer and its EU responsible person.
- **Product records** with warnings (one per line) and safety information; the panel lists every catalog product with its state, links straight to the product in the dashboard, and edits the record in place.
- **Data subject requests** filed by logged-in customers through the store API, listed with the customer's address, moved to done or rejected.
- **Consent records** per purpose (necessary, functional, analytics, marketing), with the decision, the source and the version; the panel shows the summary per purpose.
- **Price windows** per SKU and currency: the current base price, the lowest of the last 30 days and the lowest before the current price, captured daily and on demand.
- **Demo mode** (`demo: true`): sample operators, product records and price history flagged `demo`, apart from the store's real rows.
- **Store API** for the storefront: the product safety info of an offer (public), recording a consent (public), the customer's own data requests (logged in) and the price window of a SKU (public).

## Requirements

- Medusa 2.12 to 2.21 and Node.js 20+ (see Compatibility).
- Postgres, as every Medusa store has.

## Installation

```bash
npm install @koda-plus/medusa-plugin-compliance
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-compliance` or `pnpm add @koda-plus/medusa-plugin-compliance`.

## Configuration

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-compliance",
      options: {
        // Everything is optional.
        demo: process.env.COMPLIANCE_DEMO === "true",
        sections: ["gpsr", "rodo", "omnibus"],
        consentPurposes: ["functional", "analytics", "marketing"],
      },
    },
  ],
})
```

Run the migrations, then open **Compliance** in the admin sidebar:

```bash
npx medusa db:migrate
```

The migration creates five tables of the module: `compliance_responsible_person`, `compliance_product`, `compliance_consent`, `compliance_dsr` and `compliance_price_snapshot`.

### Options

Every option has a default, so the plugin starts without any.

- **demo** (boolean, default `false`): demo mode. Sample operators, product records and price history, flagged `demo`. Only ever on with `demo: true`, never because a key is missing.
- **sections** (list, default all): the sections shown in the panel, any of `gpsr`, `rodo`, `omnibus`.
- **consentPurposes** (list, default none): the purposes of the storefront's own consent categories, shown in the panel.
- **cookieInventory** (list, default none): the cookies the storefront sets, one object per cookie (`name`, `purpose`, `description`), disclosed in the consent section.

## The admin panel

- **GPSR**: the economic operators with a create form, and every catalog product with its state (complete or incomplete), its manufacturer and its responsible person; a click on a product opens its record for editing, the SKU and title link to the product in the dashboard.
- **RODO**: the data subject request queue (each request links to the customer) and the consent summary per purpose.
- **Omnibus**: the price window per SKU and currency with a Capture now action; the daily job `compliance-price-snapshot` captures the rest.

The koda.integration/1 contract is on board: a line per product and per customer on their pages, and board counters for incomplete GPSR records and open data requests.

## Store API

- `GET /store/compliance/products/:id` - the product safety info of an offer: manufacturer, EU responsible person, warnings and safety information. Public.
- `POST /store/compliance/consent` - records one consent decision (`purpose`, `granted`, `version`, `source`). Public, so a visitor gives consent before logging in.
- `GET /store/compliance/dsr` - the logged-in customer's data requests.
- `POST /store/compliance/dsr` - files a data request (`type`, `note`). Logged in.
- `GET /store/compliance/prices/:sku` - the Omnibus price window of a SKU: the current price, the lowest of the last 30 days and the lowest before the current price, per currency. Public.

## Compatibility

Medusa 2.12 through 2.21. The admin extension mounts through the Medusa admin SDK; the plugin's admin libraries are optional peers, so the app keeps the dashboard's own copies.

## License

[MIT](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-compliance/LICENSE)
