# VAT Whitelist by Koda Plus

Verify a Polish NIP against the Ministry of Finance whitelist (the biala lista), EU VAT numbers against VIES, and the REGON and legal form against the GUS Business Registry, right where the store is run. The VAT status, the bank accounts for split payment, the legal form, a counterparty list with re-checks, the check history and the registration form's preview, without another tool to log in to.

Every B2B store in Poland must check who it sells to: an active VAT payer on the whitelist, with a bank account that the registry confirms. This plugin keeps the checks, the answers and the audit trail in the Medusa admin, fills the registration form from the NIP, and shows the logged-in customer the status of their own company.

**Live demo:** Medusa admin [medusa.koda.plus/app/whitelist](https://medusa.koda.plus/app/whitelist?demo=en), signed in to a public demo account by the link itself. Demo mode answers with simulated registry data, so the public demo never calls the registries.

![VAT Whitelist page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-vat-whitelist/docs/admin-whitelist.png)

![The setup guide of the Whitelist page](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-vat-whitelist/docs/admin-whitelist-guide.png)

![The NIP check of the registration step in the B2B zone of the demo storefront](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-vat-whitelist/docs/store-b2b-nip.png)

## What it does

- **Polish NIP against the whitelist**: the VAT status (Czynny, Zwolniony, Niezarejestrowany), the taxpayer's name and address, and the bank accounts, from the Ministry of Finance API.
- **EU VAT numbers against VIES**: the validity, name and address of the business, through the VIES REST API.
- **The GUS Business Registry**: the REGON number and the legal form of the company, next to the whitelist answer. In demo mode the answer is simulated; in real mode it needs a free BIR 1.1 API key (`gusApiKey`).
- **Counterparties**: one row per number with the latest merged answer, refreshed by a re-check; the NIP links to the customer when the check was about their company.
- **Check history**: every run per registry kept as the audit trail, never changed.
- **The registration preview**: a public, rate limited route pulls the company card from the NIP before sign-up, so the registration form fills the company name by itself.
- **The customer's own status**: a logged-in customer sees and refreshes the status of their company NIP through the store API.

## Features

- **One page in the admin**: the check form with the full company card of the answer, the counterparties with their states and the check history, in English and Polish.
- **The format decides the registry**: a 10-digit Polish NIP goes to the whitelist (and GUS, when the key is set), anything that looks like an EU VAT number (two letters and a number) goes to VIES. Invalid numbers answer without a network call.
- **Caching and freshness**: an answer stays valid for `staleHours` (default 24), the panel marks stale counterparties and a re-check asks the registry again.
- **Split payment**: the registry's bank accounts are kept per counterparty, so an invoice can carry the account the whitelist confirms.
- **Demo mode** (`demo: true`): checks answer with simulated data, flagged `demo`, and nothing leaves the server. Only ever on with `demo: true`, never because a key is missing.
- **Store API** for the logged-in customer: `GET /store/whitelist/me` (their status, reads only) and `POST /store/whitelist/check` (a fresh check of their own NIP).

## Requirements

- Medusa 2.12 to 2.21 and Node.js 20+ (see Compatibility).
- Postgres, as every Medusa store has.
- Outbound HTTPS to the Ministry of Finance whitelist API and to VIES (nothing is needed in demo mode).

## Installation

```bash
npm install @koda-plus/medusa-plugin-vat-whitelist
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-vat-whitelist` or `pnpm add @koda-plus/medusa-plugin-vat-whitelist`.

## Configuration

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-vat-whitelist",
      options: {
        // Everything is optional.
        staleHours: 24,
        demo: process.env.WHITELIST_DEMO === "true",
      },
    },
  ],
})
```

Run the migrations, then open **Whitelist** in the admin sidebar:

```bash
npx medusa db:migrate
```

The migration creates two tables of the module: `whitelist_entity` and `whitelist_check`.

### Options

Every option has a default, so the plugin starts without any.

- **demo** (boolean, default `false`): demo mode. Checks answer with simulated registry data (including a simulated GUS answer), flagged `demo`.
- **baseUrl** (string, default `https://wl-api.mf.gov.pl`): the base URL of the whitelist API, for a proxy or a mirror.
- **staleHours** (number, default 24): a check of the same number is repeated after this many hours without asking the registry again. 0 always asks.
- **gusApiKey** (string, default none): the BIR 1.1 API key of the GUS Business Registry. Without it the GUS check is skipped in real mode.

## Admin API

- `GET /admin/whitelist` - the counterparties, the latest checks and the counters.
- `POST /admin/whitelist/check` - checks a number (`{ nip }`), asks the whitelist and GUS, creates or refreshes the counterparty and appends the checks.
- `POST /admin/whitelist/entities/:id/check` - re-checks a counterparty.

## Store API

- `GET /store/whitelist/me` - the logged-in customer's own counterparty, from the company NIP in their profile. Reads only.
- `POST /store/whitelist/check` - a fresh check of the customer's own NIP, linked to their account.
- `POST /store/whitelist/preview` - the registration form's check: the company card from the NIP, before sign-up, without saving. Public, rate limited per address.

## Compatibility

Medusa 2.12 through 2.21. The admin extension mounts through the Medusa admin SDK; the plugin's admin libraries are optional peers, so the app keeps the dashboard's own copies.

## License

[MIT](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-vat-whitelist/LICENSE)
