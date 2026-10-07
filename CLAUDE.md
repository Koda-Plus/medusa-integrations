# CLAUDE.md: medusa-integrations

Monorepo of the Koda Plus plugins for Medusa v2 (`Koda-Plus/medusa-integrations`). Ten npm packages, each published on its own. Eight integrate an outside service and belong in the medusajs.com/integrations catalog; Negotiations and Tasks are our own modules (the catalog lists only third-party services, so they do not carry `medusa-plugin-integration`).

| Package | Namespace | Module (container key) | Catalog |
| --- | --- | --- | --- |
| `packages/medusa-plugin-olx` | `olx` | `olx` | Other |
| `packages/medusa-plugin-allegro` | `allegro` | `allegro` | Other |
| `packages/medusa-plugin-baselinker` | `baselinker` | `baselinker` | ERP |
| `packages/medusa-plugin-subiekt-nexo` | `subiekt` | `subiekt_nexo` | ERP |
| `packages/medusa-plugin-fakturownia` | `fakturownia` | `fakturownia` | Other |
| `packages/medusa-plugin-inpost` | `inpost` | data module `inpost` and fulfillment provider `inpost` | Shipping |
| `packages/medusa-plugin-stripe` | `stripe` | next to the official Stripe provider | Payment |
| `packages/medusa-plugin-emails` | `emails` | `emails` and notification provider `emails` | Notification |
| `packages/medusa-plugin-negotiations` | `negotiations` | `negotiations` | outside the catalog |
| `packages/medusa-plugin-tasks` | `tasks` | see the package README | outside the catalog |

The list of packages lives in each `package.json` (`koda` block: `ns`, `moduleDir`, `brand`, `title`, `kind`, `catalog`); every script reads it from there (`scripts/lib/packages.mjs`). The Subiekt plugin talks to a separate bridge on the store's Windows machine; the contract in `packages/medusa-plugin-subiekt-nexo/contract/` is the source of truth for it.

The repository is PUBLIC: nothing about clients, machines, accounts, tokens or real stores goes here, only code, documentation and demo data.

## Conventions (the vendor script depends on them)

- Files outside the namespace folders carry the namespace prefix: `jobs/<ns>-*`, `subscribers/<ns>-*`, `admin/widgets/<ns>-*`, `admin/lib/<ns>-*`. Folders: `modules/<ns>`, `workflows/<ns>`, `api/admin/<ns>`, `api/store/<ns>`, `api/hooks/<ns>`, `api/<ns>`, `admin/routes/<ns>`.
- Admin i18n: `src/admin/i18n/{index,en,pl}.ts`, the namespace is the plugin namespace, components use `useTranslation("<ns>")`. `pl.ts` is typed by `en.ts` and ends with `export default typeset(pl)`; text outside the dictionaries goes through `nb()`.
- A THIN module service: the generated CRUD, the options, masking. Logic lives in `lib/*` and `workflows/*`, which call `svc.listX()` from outside (own service methods calling `this.listX()` break when the module runs as app code).
- Missing options never break the boot. Demo mode only with `demo: true`, never because a key is missing; demo rows carry a `demo` flag.
- Hand written migrations with `create table if not exists`. `model.bigNumber` needs a `raw_` column, so we use `number` or `json`.
- **A migration name (file and class) is unique across ALL packages.** Medusa records migrations by name in one shared table, so a second migration with the same name counts as done and its tables never appear. `node scripts/check-repo.mjs` checks it.
- Order and cart metadata are not state: a shopper sets them through the Store API. Facts and decisions come from the plugin's own tables; plugin keys are reserved on the store routes with the kit's `reservedMetadataGuard`.
- READMEs have no tables, and links are absolute (`https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/<dir>/...`), because npm and medusajs.com render them outside the repo. Images from `raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/<dir>/docs/`.
- Copy: English in code and README, Polish in `pl.ts` with full diacritics. No en dash, em dash or middle dot anywhere.

## The shared kit

`kit/` is the one source of what every package shares: the `koda.integration/1` contract (types, server routes for the manifest, record summaries and board counters), the guards (`writeGuard`, `reservedMetadataGuard`), the admin fetch (backend URL, session or JWT), the card registry (`hostable`, `WidgetFrame`), the page kit (`<ns>-guide.tsx`), the community strings and the conformance tests. `npm run kit:sync` writes the copies into the packages, `npm run kit:check` fails on drift. Never edit a generated copy. How to put a package on the contract: `kit/README.md`.

## Commands

- `npm run check`: kit check, then tests and types in every package (`--keep-going`, a summary at the end). `node scripts/check-repo.mjs` (add `--strict` before a release): the repository rules.
- `npm run build`: `medusa plugin:build` in each package.
- `npm run vendor`: copies every plugin into a Medusa app as app code (`../koda-plus-demo/medusa-backend`), plus the host side of the kit when the app asks for it in `koda-vendor.json`.
- `node scripts/smoke.mjs`: the packed tarballs in a fresh Medusa app (migrations, build, start, admin pages).
- Each package: `npm install` (lockfiles are per package), `npm test`, `npm run typecheck`, `npm run build`.

## Releasing

`npm run release -- --dry-run` shows what would go out and preflights all of it (tests, types, build, tarball contents). `npm run release -- --stamp` dates the CHANGELOG headings. `npm run release` publishes from a clean `main` equal to `origin/main`, tags each version and pushes the tags. Details in the header of `scripts/publish-all.mjs`.

The medusajs.com catalog picks packages from npm by the keywords `medusa-v2`, `medusa-plugin-integration` and a category (`medusa-plugin-other`, `medusa-plugin-erp`, `medusa-plugin-shipping`, `medusa-plugin-payment`, `medusa-plugin-notification`).
