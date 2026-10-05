# Medusa integrations by Koda Plus

Polish commerce integrations for [Medusa](https://medusajs.com) v2: the marketplaces, the multichannel hub and the ERP a store in Poland has to talk to. Four independent plugins, one set of rules, all running in one public admin.

**Live demo:** [medusa.koda.plus/app](https://medusa.koda.plus/app/allegro?demo=en) signs you in to a public demo account by itself and opens the admin in English. Every integration runs there in demo mode, so every screen has data.

## The packages

- **[OLX](packages/medusa-plugin-olx)** (`@koda-plus/medusa-plugin-olx`): connects an OLX seller account, imports its adverts and links each one to the right variant by SKU. Read-only. Library category: Other.
- **[Allegro](packages/medusa-plugin-allegro)** (`@koda-plus/medusa-plugin-allegro`): device login to an Allegro seller account, offers linked by signature, a stock check of Allegro quantities against Medusa availability, a journal of Allegro orders without buyer data. Read-only. Library category: Other.
- **[BaseLinker](packages/medusa-plugin-baselinker)** (`@koda-plus/medusa-plugin-baselinker`): for stores whose catalog lives in Medusa and whose warehouse and marketplaces run in BaseLinker. Links variants to existing cards, sends orders exactly once, brings status, tracking and stock back. Library category: ERP.
- **[Subiekt nexo](packages/medusa-plugin-subiekt-nexo)** (`@koda-plus/medusa-plugin-subiekt-nexo`): orders become ZK documents in Subiekt nexo PRO, the WZ issued in the warehouse comes back to the order, stock flows into inventory levels. Talks to a bridge next to Subiekt over an open, signed contract. Library category: ERP.

Each package installs, versions and publishes on its own; pick the ones your store needs.

## One standard

Every package follows the same rules, so a merchant who installed one already knows the others:

- **Demo mode:** sample data built from your own catalog, through the same parsing and matching as real data. Evaluate without an account.
- **An admin page under Extensions** with its own mark, counters, tables and the run history, plus a widget where the data belongs (product or order page).
- **Admin in English and Polish**, one i18n namespace per package.
- **Writes only what the merchant switched on.** OLX and Allegro never write to the marketplace; a write barrier in the HTTP client enforces it. BaseLinker writes orders, and stock only as an explicit option after a plan. Subiekt writes the documents it exists for.
- **The complete-read rule:** an incomplete read adds and updates, it never removes a link or zeroes a quantity.
- **Secrets encrypted or signed, and masked** in logs, the database and the admin.
- **No duplicates on retry:** idempotent requests, outboxes with backoff, markers searched before a write.
- **Workflows exported** for custom code, and missing options never break the boot.

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

The script copies each plugin by namespace (`modules/<ns>`, `workflows/<ns>`, `api/admin/<ns>`, `jobs/<ns>-*`, `admin/widgets/<ns>-*`...), removes its own older copies and generates the admin i18n entry point of the app. Never edit the copies.

## The Subiekt nexo bridge

Subiekt nexo has no web API; its SDK (Sfera) is a Windows .NET library. The plugin talks to a bridge over [an open contract](packages/medusa-plugin-subiekt-nexo/contract/openapi.yaml) with request signatures in both directions. Koda Plus runs a production bridge (.NET 8 Windows service, commercial, kontakt@koda.plus); any bridge that follows the contract works, and the plugin ships a demo bridge.

## License and trademarks

MIT, see the LICENSE file of each package. Built and maintained by [Koda Plus](https://koda.plus).

OLX, Allegro, BaseLinker, Base, Subiekt nexo, nexo PRO, Sfera and InsERT are trademarks of their owners, used only to identify the systems these integrations connect to. These are independent integrations, not affiliated with or endorsed by them.
