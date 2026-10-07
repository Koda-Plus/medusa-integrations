# Medusa plugins by Koda Plus

Plugins for [Medusa](https://medusajs.com) v2 stores in Poland: the marketplaces, the multichannel hub, the ERP, the invoices, the parcels and the payments a Polish store has to talk to, plus transactional e-mails, B2B price negotiations and a task board for the team. Ten independent packages, one set of rules, all running in one public admin.

**Live demo:** [medusa.koda.plus/app](https://medusa.koda.plus/app/allegro?demo=en) signs you in to a public demo account by itself and opens the admin in English. Every plugin runs there in demo mode, so every screen has data and nothing leaves the server.

## The packages

Integrations with an outside service:

- **[OLX](packages/medusa-plugin-olx)** (`@koda-plus/medusa-plugin-olx`): links OLX adverts to variants by SKU, raises alerts when OLX and the catalog disagree, ends and brings back adverts with the stock, keeps prices in step and publishes new adverts from products. Library category: Other.
- **[Allegro](packages/medusa-plugin-allegro)** (`@koda-plus/medusa-plugin-allegro`): device login to an Allegro seller account, offers linked by signature, Allegro orders imported as Medusa orders with tax lines, stock, parcels, Fakturownia invoices and prices sent back, returns and disputes read. Library category: Other.
- **[BaseLinker](packages/medusa-plugin-baselinker)** (`@koda-plus/medusa-plugin-baselinker`): Medusa and BaseLinker (Base) in both directions: the catalog either way, stock and prices either way, store orders out exactly once, marketplace orders in exactly once, statuses, parcels, returns and invoice numbers back. Library category: ERP.
- **[Subiekt nexo](packages/medusa-plugin-subiekt-nexo)** (`@koda-plus/medusa-plugin-subiekt-nexo`): orders become ZK documents in Subiekt nexo PRO, the WZ comes back, invoices and receipts are issued in Subiekt with their KSeF number, company buyers are found by NIP, stock and prices come back as a plan. Talks to a bridge over an open, signed contract. Library category: ERP.
- **[Fakturownia](packages/medusa-plugin-fakturownia)** (`@koda-plus/medusa-plugin-fakturownia`): VAT invoices, proformas, receipts and corrections in Fakturownia for every order, exactly once, with payments, KSeF, e-mails and the documents in the customer account. Library category: Other.
- **[InPost](packages/medusa-plugin-inpost)** (`@koda-plus/medusa-plugin-inpost`): Paczkomat lockers and the InPost courier, cash on delivery included, as a fulfillment provider: parcels planned first, labels, tracking and status by webhook. Library category: Fulfillment.
- **[Stripe](packages/medusa-plugin-stripe)** (`@koda-plus/medusa-plugin-stripe`): installed next to Medusa's own Stripe provider, it shows what Stripe knows in the admin (payments by method with fees and net, disputes, refunds, balance and payouts) and checks the setup of a Polish store (BLIK, Przelewy24, webhook, wallet domains). Read only, it never moves money. Library category: Payment.
- **[E-mails](packages/medusa-plugin-emails)** (`@koda-plus/medusa-plugin-emails`): transactional e-mails through Resend, ready on install, in English and Polish, sent once per event, logged, previewed live in the admin. Library category: Notification.

Modules of our own, no outside service:

- **[Negotiations](packages/medusa-plugin-negotiations)** (`@koda-plus/medusa-plugin-negotiations`): B2B price talks between logged-in customers and the store team, from a product, a variant or a cart to an agreed price and, when allowed, a draft order.
- **[Tasks](packages/medusa-plugin-tasks)** (`@koda-plus/medusa-plugin-tasks`): a task board in the admin for the store team and its agency, linked to orders, products and customers, with a clean way for scripts and AI agents to report work.

Each package installs, versions and publishes on its own; pick the ones your store needs.

## One standard

Every package follows the same rules, so a merchant who installed one already knows the others:

- **Demo mode:** sample data built from your own catalog and orders, through the same code paths as real data. Evaluate without an account.
- **An admin page under Extensions** with its own mark, counters and tables, a setup guide with live step states and a settings view, plus widgets where the data belongs (product, order or customer page).
- **Admin in English and Polish**, one i18n namespace per package.
- **Writes only what the merchant switched on.** Every write into an outside system or into Medusa is a writer: allowed in the options, armed by a person in the admin, planned first, capped per run.
- **The complete-read rule:** an incomplete read adds and updates, it never removes a link or zeroes a quantity.
- **Secrets encrypted or signed, and masked** in logs, the database and the admin.
- **No duplicates on retry:** idempotent requests, outboxes with backoff, markers looked up before a write.
- **Workflows and events exported** for custom code, and missing options never break the boot.

## Development

Packages are independent: own `package.json`, own lockfile, own `node_modules`. The root scripts run a command in every package:

```bash
npm run install:all   # npm ci in every package
npm run check         # unit tests and strict TypeScript, every package
npm run build         # medusa plugin:build, every package
```

To work on one package, `cd packages/<name>` and use its own `npm test`, `npm run typecheck` and `npm run build`. Try a package in a Medusa app with `npx medusa plugin:publish` in the package and `npx medusa plugin:add <name>` in the app.

### The demo admin

The Koda Plus demo backend (`Koda-Plus/koda-plus-demo`, medusa.koda.plus) runs the packages as app code, copied by:

```bash
npm run vendor   # = node scripts/vendor-into-app.mjs ../koda-plus-demo/medusa-backend
```

The script copies each plugin by namespace (`modules/<ns>`, `providers/<ns>`, `workflows/<ns>`, `api/admin/<ns>`, `jobs/<ns>-*`, `admin/widgets/<ns>-*`...), removes its own older copies and generates the admin i18n entry point of the app. Never edit the copies.

## The Subiekt nexo bridge

Subiekt nexo has no web API; its SDK (Sfera) is a Windows .NET library. The plugin talks to a bridge over [an open contract](packages/medusa-plugin-subiekt-nexo/contract/openapi.yaml) with request signatures in both directions. Koda Plus runs a production bridge (.NET 8 Windows service, commercial, kontakt@koda.plus); any bridge that follows the contract works, and the plugin ships a demo bridge.

## License and trademarks

MIT, see the LICENSE file of each package. Built and maintained by [Koda Plus](https://koda.plus).

OLX, Allegro, BaseLinker, Base, Subiekt nexo, nexo PRO, Sfera, InsERT, Fakturownia, InPost, Paczkomat, Stripe, BLIK, Przelewy24 and Resend are trademarks of their owners, used only to identify the systems these plugins connect to. These are independent integrations, not affiliated with or endorsed by them.
