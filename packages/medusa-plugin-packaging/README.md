# Packaging by Koda Plus

The wholesale packaging ladder of the catalog, right where the store is run: the piece, the box and the pallet of every product, the minimum order quantity and the order step, the EAN codes and the SSCC labels for pallets. The product page shows the ladder to the customer.

A wholesaler sells in units, not pieces: twelve drills in a box, one hundred and twenty on a pallet, and nobody orders eleven. This plugin keeps the ladder, the minimum and the step per product in the Medusa admin, generates the GS1 check digit for SSCC labels, and serves the same ladder to the storefront.

**Live demo:** Medusa admin [medusa.koda.plus/app/packaging](https://medusa.koda.plus/app/packaging?demo=en), signed in to a public demo account by the link itself. The demo storefront [demo.koda.plus](https://demo.koda.plus/pl-pl) shows the ladder on the product pages.

## What it does

- **The ladder per product**: the piece, the box and the pallet, each with how many pieces fit into it, the box EAN and the pallet SSCC prefix.
- **The minimum order and the step**: the MOQ in pieces and the order step, so an order below or between rungs can be refused or rounded.
- **SSCC labels**: the 18-digit serial shipping container code of a pallet, with the GS1 check digit and the GS1-128 payload for the label, from the store's GS1 prefix and a serial.
- **The ladder on the product page**: the store API serves the ladder to the offer, next to the price.

## Features

- **One page in the admin**: every catalog product with its ladder, its minimum and its step, and an editor per product, in English and Polish.
- **The SSCC tool**: a serial makes the 18-digit SSCC, its human grouping and the GS1-128 payload, with the check digit computed by the GS1 rule.
- **Demo mode** (`demo: true`): sample ladders, flagged `demo`.
- **The koda.integration/1 contract**: one line per product with its ladder on the product page, and the board counter of products without one.

## Requirements

- Medusa 2.12 to 2.21 and Node.js 20+ (see Compatibility).
- Postgres, as every Medusa store has.

## Installation

```bash
npm install @koda-plus/medusa-plugin-packaging
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-packaging` or `pnpm add @koda-plus/medusa-plugin-packaging`.

## Configuration

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-packaging",
      options: {
        // Everything is optional.
        gs1Prefix: "590123456789",
        demo: process.env.PACKAGING_DEMO === "true",
      },
    },
  ],
})
```

Run the migrations, then open **Packaging** in the admin sidebar:

```bash
npx medusa db:migrate
```

The migration creates two tables of the module: `packaging_product` and `packaging_unit`.

### Options

Every option has a default, so the plugin starts without any.

- **demo** (boolean, default `false`): demo mode. Sample ladders, flagged `demo`.
- **gs1Prefix** (string, default `590123456789`): the GS1 company prefix the SSCC labels start with, 7 to 10 digits.

## Admin API

- `GET /admin/packaging` - every catalog product with its ladder and the counters.
- `POST /admin/packaging/products/:id` - upserts the packaging of a product (`{ moq, step, units }`).
- `GET /admin/packaging/sscc?serial=` - the SSCC label number of a pallet, pure, nothing written.

## Store API

- `GET /store/packaging/products/:id` - the ladder of a product for the offer. Public.

## Compatibility

Medusa 2.12 through 2.21. The admin extension mounts through the Medusa admin SDK; the plugin's admin libraries are optional peers, so the app keeps the dashboard's own copies.

## License

[MIT](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-packaging/LICENSE)
