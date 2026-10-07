# The shared kit

`kit/` is the only source of the code every package has in common. `npm run kit:sync` writes a copy into each package (with the namespace in the file name, so the `vendor` script and the "zero runtime dependencies" rule keep working); `npm run kit:check` fails when a copy differs. Never edit a generated copy: every one starts with `// GENERATED from kit/...`.

| Kit file | Copy in a package | What it is |
| --- | --- | --- |
| `contract.ts` | `src/modules/<mod>/lib/kit-contract.ts` | koda.integration/1: types, `TONE_OF`, link checks, `STATE_TEXTS`. Zero imports, used by the server and the admin. |
| `server/routes.ts` | `src/modules/<mod>/lib/kit-routes.ts` | `integrationRoutes(definition)`: the manifest, summary and attention handlers with validation, `lang` and `tz`, fallback sentences, link checks, ETag and the contract header. |
| `server/guards.ts` | `src/modules/<mod>/lib/kit-guards.ts` | `writeGuard()` (CSRF: writes need JSON or `x-koda-request`) and `reservedMetadataGuard(prefixes, keys)` for the store routes. |
| `admin/kit.tsx` | `src/admin/lib/<ns>-kit.tsx` | `kitFetch` and `kitRequestInit` (backend URL, session or JWT, the write header), the integration registry, `hostable`, `WidgetFrame`. |
| `admin/guide.tsx` | `src/admin/lib/<ns>-guide.tsx` | The page kit: header, badges, references, setup guide, the setup prompt (pinned version), help on Discord (`https://koda.plus/discord`). |
| `admin/community.ts` | `src/admin/lib/<ns>-kit-community.ts` | The `community` block of both dictionaries. |
| `test/conformance.ts` | `test/kit-conformance.ts` | `conformance({ routes, scope, entity, knownIds, writes })`: the contract checks, run from the package's own test. |
| (generated) | `src/admin/lib/<ns>-kit-meta.ts`, `src/modules/<mod>/lib/kit-meta.ts` | `KIT_META`: namespace, package, version, kit version, brand, from `package.json`. |
| `host/host.tsx` | in an app: `src/admin/lib/koda-host.tsx` (by `npm run vendor`) | The host side: `claimZones`, `useHostedTabs`, `useFacts`, `useAttention`. |

`package.json` of every package has a `koda` block (`ns`, `moduleDir`, `brand`, `title`, `kind`, `catalog`); every script reads the list of packages from there (`scripts/lib/packages.mjs`).

## The contract in one package (InPost is the worked example)

1. `npm run kit:sync` (from the root) writes the kit files.
2. `src/modules/<mod>/lib/integration-texts.ts`: `integrationEn` and `integrationPl`, plain objects, each starting with `...STATE_TEXTS.en` / `...STATE_TEXTS.pl`. Keys: `order.*`, `product.*`, `customer.*` for summary lines, `fact.*`, `attention.<counter key>`, `problem.*`. Polish may add plural forms (`_few`, `_many`) next to `_one` and `_other`. End the file with `const samePolishKeys: typeof integrationEn = integrationPl`.
3. Mount them in the admin dictionaries: `integration: integrationEn` in `en.ts`, `integration: integrationPl` in `pl.ts`.
4. `src/modules/<mod>/lib/integration.ts`: pure functions from the plugin's own rows to `SummaryDraft` and `CounterDraft` (testable without a database). Rules: the worst record speaks (red, orange, blue, green); facts never come from `order.metadata` or `cart.metadata`; links are admin paths of the plugin page with a filter or a search (`/inpost?q=1042`) or https links on `externalHosts`.
5. `src/workflows/<mod>/integration.ts`: `export const <ns>Integration = integrationRoutes({ ns: KIT_META.ns, package: KIT_META.pkg, version: KIT_META.version, name: KIT_META.name, kind, adminPath, entities, attention, widgets, texts, externalHosts, status, summarize, count })`. `summarize` reads all ids in one query per table (batch of up to 50), `count` uses grouped counts. Reads only: no demo seeding, no outside call other than the plugin's own cache, no write.
6. Three route files: `src/api/admin/<ns>/integration/route.ts` (`export const GET = <ns>Integration.manifest`), `integration/summary/route.ts`, `integration/attention/route.ts`.
7. `src/api/middlewares.ts`: `{ matcher: "/admin/<ns>*", middlewares: [writeGuard()] }` and, when the plugin reads metadata keys, `reservedMetadataGuard` on `STORE_METADATA_MATCHERS`.
8. The plugin's own fetch helper spreads `kitRequestInit({ method, body })` (or calls `kitFetch`), so JWT admins and the write guard work.
9. Each widget: the card component takes `embedded?: boolean`, draws its frame with `WidgetFrame` (no header when embedded), shows a line instead of `null` while loading and when empty if embedded; the default export is `hostable({ id: "<ns>.<entity>", ns, zone, name, order, Icon, hideWhenNone? }, Card)`. `config.zone` stays as it is.
10. Deep links: the plugin page reads `?filter=` and `?q=` (or its own names) from the URL, so counter and fact links open the right list.
11. `test/integration.test.ts`: `conformance({ ... })` on sample rows, plus the plugin's own rules (worst record wins, metadata changes nothing, counters).
12. README: a "Works with Koda Plus hosts" section (the three routes, the widget ids, the counters), Public API, Security, Uninstall, Compatibility.

Zones: `order.details`, `product.details`, `customer.details`, `inventory_item.details`, and the list zones `order.list`, `product.list`, `customer.list`, `inventory_item.list`. Widget ids: `<ns>.<entity>` (`stripe.order`), list cards `<ns>.<entity>s` (`negotiations.orders`). Tab order: payment 10, documents 20 to 30, delivery 40, marketplaces 50 to 60, ERP 70, e-mails 80, our modules 90 and up.

## Changing the kit

Edit `kit/`, bump `kit/VERSION` (minor for additions, major for a change a host must follow), run `npm run kit:sync`, run `npm run check`. Within contract version 1 only additions are allowed: new optional fields, states, slots, counters and scopes (hosts ignore unknown fields and read an unknown state as `unavailable`).
