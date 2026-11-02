# DPD by Koda Plus

Ship with DPD Polska from Medusa: the DPD courier and DPD Pickup points, both also with cash on delivery, on the DPD Polska web services.

**Work in progress.** This version is the skeleton of the plugin: the fulfillment provider with its five options, the data module, the options with the sender checks, the writers, the admin page and a demo mode. It does not talk to DPD yet: shipments, labels, the handover to the courier, tracking and returns come in the next versions. The full README comes with the first npm release.

## What it does

- **Checkout**: five fulfillment options, `dpd-courier`, `dpd-courier-cod`, `dpd-pickup`, `dpd-pickup-cod` and `dpd-return` (the return option, used only for returns, claims and exchanges). A courier option needs a complete address in a country of the store; a Pickup option needs a point id of the right shape and a phone or an e-mail of the recipient; cash on delivery needs a currency the options allow for the destination.
- **Fulfillment**: creating a fulfillment records the option and the choice of the customer. Nothing is sent to DPD.
- **Admin page** under DPD in the sidebar, with Settings and the writers, and an order card. In demo mode it shows sample shipments built from the store's own orders.

## Requirements

- Medusa 2.12 or newer and Node.js 20+.
- A DPD Polska business account with access to the DPD web services (login, password and the FID of the account) for the next versions; the skeleton runs without it in demo mode.

## Installation

```bash
npm install @koda-plus/medusa-plugin-dpd
```

## Configuration

The plugin is registered twice with the same options object: as a plugin (the data module, the admin page, the routes) and as a provider of Medusa's fulfillment module. Keep the id `dpd`: the provider is then `dpd_dpd`.

```ts
import { defineConfig } from "@medusajs/framework/utils"

const dpd = {
  login: process.env.DPD_LOGIN,
  password: process.env.DPD_PASSWORD,
  masterFid: process.env.DPD_MASTER_FID,
  // mode: "live", // sandbox by default
  // demo: true,   // sample shipments from your orders, nothing sent to DPD
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

## Security and data

- **Credentials stay on the server**: masked in logs, errors and the admin, which only knows whether they are set.
- **Writes are off by default**: a writer works only when the options allow it and a person arms it in the admin.
- **Admin routes** sit behind Medusa's admin authentication, and writes need a JSON body or the `x-koda-request` header.
- **Shopper metadata is not state**: a shopper may not set `dpd_*` keys on a cart or the account through the Store API.

## Trademarks

DPD and the DPD logo are trademarks of their owners, used here only to identify the service this plugin connects to. This is an independent integration, not affiliated with or endorsed by DPD.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-dpd/LICENSE).

## Changelog

### 0.1.0 (unreleased)

The skeleton: the provider with five options, the data module, the options with sender checks, the writers, the integration contract and the admin page in demo mode. Full list in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-dpd/CHANGELOG.md).
