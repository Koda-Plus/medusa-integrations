# The shared kit

`kit/` is the only source of the code every package has in common. `npm run kit:sync` writes a copy into each package (with the namespace in the file name, so the `vendor` script and the "zero runtime dependencies" rule keep working); `npm run kit:check` fails when a copy differs. Never edit a generated copy: every one starts with `// GENERATED from kit/...`.

| Kit file | Copy in a package | What it is |
| --- | --- | --- |
| `contract.ts` | `src/modules/<mod>/lib/kit-contract.ts` | koda.integration/1: types, `TONE_OF`, link checks, `STATE_TEXTS`. Zero imports, used by the server and the admin. |
| `server/routes.ts` | `src/modules/<mod>/lib/kit-routes.ts` | `integrationRoutes(definition)`: the manifest, summary and attention handlers with validation, `lang` and `tz`, fallback sentences, link checks, ETag and the contract header. |
| `server/guards.ts` | `src/modules/<mod>/lib/kit-guards.ts` | `writeGuard()` (CSRF: writes need JSON or `x-koda-request`) and `reservedMetadataGuard(prefixes, keys)` for the store routes. |
| `admin/kit.tsx` | `src/admin/lib/<ns>-kit.tsx` | `kitFetch` and `kitRequestInit` (backend URL, session or JWT, the write header), the integration registry, `hostable`, `WidgetFrame`, page slots, page tabs (`hostPageTabs`, `addPageTab`, `hostedNavIcon`). |
| `admin/guide.tsx` | `src/admin/lib/<ns>-guide.tsx` | The page kit: header (with optional `points`, short phrases with icons), `KeyPoints`, badges, references, setup guide, the setup prompt (pinned version), help on Discord (`https://koda.plus/discord`), `KitTabbedPage` and `KitTabRoute`. |
| `admin/blocks.tsx` | `src/admin/lib/<ns>-blocks.tsx` | The blocks under the header: `Section`, `SubpageHeader`, `StatTiles`/`StatTile`, `FilterBar`/`FilterButton`/`FilterDivider`, `SearchInput`, `ToneBadge` (one palette of meaning), `RowActions`, `EmptyState`, `StagedLoader`. The rules and the rework checklist: `kit/STYLE.md`. |
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

## One menu entry for a family of plugins (page tabs)

Plugins of one family can share one sidebar entry and still be separate packages, each installable on its own. InPost is the worked example: `medusa-plugin-inpost` hosts the entry "InPost", `medusa-plugin-inpost-pay` and `medusa-plugin-inpost-marketplace` add their pages to it as tabs.

1. The host page file calls `hostPageTabs({ id: "inpost", path: "/inpost", name: "InPost" })` at module load, and its default export draws the page inside `<KitTabbedPage host="inpost" label={...} own={{ id: "shipping", label: t("tabs.shipping"), Icon }}>` (page kit). Without other tabs it is drawn exactly as before, without a bar.
2. A contributor page file calls `addPageTab({ host: "inpost", id: "pay", ns, name: "InPost Pay", order, Icon, Component: Page })` at module load, its default export is `<KitTabRoute host="inpost" tab="pay"><Page /></KitTabRoute>`, and its route config takes `icon: hostedNavIcon(Icon, { host: "inpost", tab: "pay" })`.
3. The tab is kept in `?service=<id>` (no parameter for the host's own tab), because `view`, `tab`, `section`, `filter` and `q` belong to the pages. A link to the contributor's own route (`/inpostpay?filter=failed`) redirects to the tab with every parameter kept, so manifests, counters and widget links need no change.

Medusa reads the sidebar from the route `config` in the source when the admin is built; an entry cannot be conditional. The one part of an entry drawn at runtime is its icon, so `hostedNavIcon` draws a hidden marker while the host shows the tab, and one CSS rule, added to the page only then, hides the sidebar link holding a marker (and Medusa's wrapper around exactly that link). Without the host nothing is added and the entry stays as it is; where the rule cannot apply (a browser without `:has()`, a changed sidebar), the entry stays too and leads to the tab. All three calls meet in one registry under a global symbol (`koda.page.tabs/1`), so no package imports another, and an older host or contributor without page tabs simply keeps its own entry.

## Changing the kit

Edit `kit/`, bump `kit/VERSION` (minor for additions, major for a change a host must follow), run `npm run kit:sync`, run `npm run check`. Within contract version 1 only additions are allowed: new optional fields, states, slots, counters and scopes (hosts ignore unknown fields and read an unknown state as `unavailable`).
