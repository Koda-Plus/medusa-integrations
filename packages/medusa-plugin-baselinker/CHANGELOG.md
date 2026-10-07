# Changelog

## 0.3.0 (unreleased)

### Fixed

- Demo mode writes only its own rows. The store's orders no longer get a simulated BaseLinker number, status or parcel in their metadata, and no event goes out for them; invoice number events in demo mode only for orders the demo created; a demo plan or card snapshot never replaces what a real account read.
- Reads never write: `GET /admin/baselinker` no longer builds the demo snapshot and sends orders, and the order list and the order widget no longer move the simulated statuses. The `baselinker-demo` job (every minute, demo mode only) and `POST /admin/baselinker/demo/prepare` do that work.
- One run of each job and one worker per store order, marketplace order and invoice document across every process (a server and a worker, or several instances): leases in `baselinker_setting`, renewed while their holder works and expiring 5 minutes after a process died. A manual run from the admin takes the same lease as the scheduled job. Before this, the guard held only inside one process, so two processes could create the same card or the same fulfillment twice.
- A lock store or Locking provider that does not answer is an error in the run history and the log, never a quiet "busy".
- The queue, the import and the invoice numbers read a row again under its lease and leave it alone when another process sent, imported or leased it a moment ago.
- Orders whose totals Medusa cannot compute (a shipping method without a version) still reach BaseLinker: they are read without the totals, which are computed from the lines (`admin_comments` says so, `paid` only when the capture covers that sum and the payment collection). When even that read fails, the row waits with `totals_unavailable`.
- Order metadata a shopper can set decides nothing: an order counts as imported only by the plugin's import table; a marketplace reference counts only on an order created without a cart; a crash recovery adopts an order by its BaseLinker number only when it carries the row's id (`metadata.baselinker_import_id`) or has no cart.
- The status reads choose their 60 orders in the database (never checked first, then the oldest check, closed statuses left out) instead of reading every followed order.

### Changed

- Demo mode only with `demo: true`, never because a token is missing. The setup prompt and the README use `demo: process.env.BASELINKER_DEMO === "true"`. A warning goes to the log when demo mode runs in a production build.
- Simulated marketplace orders become Medusa orders only with the new option `demoCreatesOrders` (flagged `metadata.baselinker_demo`); without it they stay rows of the import list (`demo_no_orders`).
- Writes to `/admin/baselinker/*` take a JSON body or the `x-koda-request` header (415 otherwise).
- A shopper may not set `baselinker_*` metadata, `marketplace_order_ref` or the skip key through the Store API (400 `reserved_metadata_key`).
- Skipped orders carry a code: `canceled`, `skip_key`, `marketplace_order` or `imported`.
- Unexpected server errors answer a plain sentence; the details stay in the server log, masked.
- The page polls the light `GET /admin/baselinker/running` while a run is under way and the full status every 30 seconds, never while the tab is hidden. The order widget asks every 3 seconds only during the first two minutes of a send, then around the next attempt.
- The connection check result is stored, so every process shows the same one.
- The BaseLinker requests name the plugin version in their user agent.

### Added

- `GET /admin/baselinker/running` and `POST /admin/baselinker/demo/prepare`, the `baselinker-demo` job, `demo` in the status (whether the snapshot exists), `skipCode` in the order widget answer.
- `baselinker.order_status_changed` for imported orders too, with `imported: true`.
- `activeRunKinds` in `/workflows`: what runs right now in any process.
- README: running more than one process, metadata a buyer can write, the write guard.

## 0.2.1 (2026-10-07)

### Fixed

- Admin pages work when the plugin is installed from npm: the admin libraries are optional peers, so the app keeps the copies of Medusa's dashboard instead of a second, newer copy.

### Changed

- README describes this plugin only: the section comparing it with another BaseLinker integration is gone.
- The admin page runs on the shared Koda Plus kit 1.0.1: the setup prompt pins this exact version, checks the package signatures (`npm audit signatures`) and shows the note before saving it; the prompt is copied only with its Copy button.
- `prepublishOnly` runs the typecheck too.
- README links are absolute, so they work on npm and medusajs.com.
- References: stores that start soon (`soon: true`, shown with a Soon badge and no link); the since date is no longer shown.

## 0.2.0 (2026-10-06)

Both directions, every write plan first and armed by a person.

- Directions: `catalogSource` (`medusa` or `baselinker`) and `stockSource` (`baselinker` or `medusa`), shown as a matrix in the admin.
- Writers: `catalogImport`, `cards`, `stockToMedusa`, `stockToBaseLinker`, `prices`, `orderImport`, `invoiceNumbers`. Each is off by default, with a hard switch in the options (`writers: { <name>: false }` wins) and an arm switch in the admin stored with who flipped it and when. The write barrier lets `addInventoryProduct`, `updateInventoryProductsStock`, `updateInventoryProductsPrices` and `setOrderFields` out only with the permit of an armed writer. Configurations of 0.1 with `stockSync: "write"` keep writing stock into Medusa until a person touches the switch.
- Plans for every write that changes data (`baselinker_plan_item`), a cap per run (`maxCatalogChangesPerRun`, `maxStockChangesPerRun`, `maxPriceChangesPerRun`) and per item quarantine after `quarantineAfter` failed runs, released by a person.
- Catalog import from BaseLinker: products and variants with the price of `priceGroupId`, SKU, EAN, weight, images, description, category by name (created only with `createMissingCategories`), manufacturer (metadata or tag); idempotent by the BaseLinker id; bundles, duplicated SKUs and EANs never imported; never a delete, a draft only with `draftRemovedProducts`.
- Cards from Medusa: new cards for variants without one (a lookup by SKU before every create, a second lookup after an unclear answer, the new card linked at once), name and EAN of linked cards kept in step; SKUs longer than 50 characters skipped.
- Stock from Medusa into a `bl_` warehouse (`updateInventoryProductsStock`), absolute values, decreases first, per card warnings.
- Prices into a BaseLinker price group (`updateInventoryProductsPrices`), net Medusa prices grossed up with the card's VAT rate; never into a derived group, a missing group or a group in another currency.
- Marketplace orders into Medusa (`orderImportSources`): discovery every 5 minutes, exactly once per BaseLinker order, lookups by `metadata.baselinker_order_id` and `metadata.marketplace_order_ref` (again under the shared lock `marketplace-order-ref:<ref>`), `createOrderWorkflow` as a draft and `convertDraftOrderWorkflow` (reservations, `order.placed`), payment collection marked paid when paid, loop guard in both directions, cancellation while nothing is fulfilled, a flag otherwise, fulfillment with `orderImportShippingOptionId`.
- Returns from the BaseLinker return manager, read only, without buyer data, linked to Medusa orders.
- Status pickup through the BaseLinker order journal (`journal: "auto"`), with the full read as a fallback.
- Invoice numbers from `fakturownia.document.issued` into a BaseLinker order field (`invoiceNumberField`), exactly once, never over another value; a soft dependency.
- Variant cards read with `include_variants`; main cards with variants are containers, never linked.
- Connection check lists price groups, warehouses (and which take stock), order sources, statuses, custom order fields and the journal state.
- Admin: Panel and Setup guide views (`?view=guide`), directions and writers, every plan, marketplace orders, returns, invoice numbers, references (`references` option), order widget for imported orders, product widget with the main card.
- Demo mode simulates every new feature: duplicated SKUs and EANs, price groups, both stock directions, deterministic Allegro and Amazon orders (at most 5 a day, `@example.com` buyers) that become Medusa orders, returns and invoice numbers.
- New events: `baselinker.order_imported`, `baselinker.order_import_failed`, `baselinker.plan_applied`, `baselinker.invoice_number_written`.
- New tables (run `npx medusa db:migrate`): `baselinker_setting`, `baselinker_plan_item`, `baselinker_quarantine`, `baselinker_import`, `baselinker_return`, `baselinker_invoice`.

### Admin page (the same in all five Koda Plus integrations)

- One header: the name with the state badges, the description, then a toolbar with the view tabs (Panel, Setup guide, Settings, each with its name) and the page's actions, one main button and the others beside it or under More actions.
- The panel shows the business (counters, lists next to the Medusa product or order); Settings hold the technical parts (account, writers, plans, history).
- "Running in N stores" from the `references` option, with the rating and its source (`review`), and "Add your store", a request to Koda Plus by e-mail.
- "Copy prompt": a prompt for an AI coding agent (Claude Code, Cursor) that installs the plugin in another Medusa project the way the setup guide shows, with every writer off, and leaves notes for the next session.
- "Help on Discord": the Koda Plus server.
- Polish copy typeset: no one-letter word or short conjunction left at the end of a line.

## 0.1.0 (2026-10-05)

First public release, generalized from the BaseLinker integration Koda Plus runs in production for a Polish tyre and wheel retailer since August 2026.

- One HTTP client for `connector.php` with a write barrier by method name: every `get*` passes, `addOrder` is the only write and only with `exportOrders`. Errors read from the response body, transient retries for reads, a single shot for `addOrder`, a process-wide rate limiter, the token masked everywhere.
- Card linking: the whole catalog through `getInventoryProductsList`, SKU then EAN, unique on both sides, duplicates and ambiguous keys reported and never linked, the complete-read rule (an incomplete read never unlinks), variants missing in BaseLinker counted.
- Stock planned before it is written: target stocked = max(0, BaseLinker) + reserved, negative stock clamped, kits skipped, never from an incomplete read, never zeroing items missing from a read; `stockSync` `off`, `plan` (default) or `write` through `batchInventoryItemLevelsWorkflow`, capped per run, decreases first.
- Orders exactly once: an outbox row on `order.placed`, a marker in `admin_comments`, a `getOrders` scan before every write and after an unknown result, backoff for about two and a half days, `failed` rows waiting for a person; no payload stored.
- `addOrder` payload: catalog lines for linked variants, free lines otherwise, unit price after discounts, highest tax rate, quantity from `items.detail`, shipping address, InPost lockers, invoice data on request, `paid` only when captured, cash on delivery by provider.
- The way back: status names, tracking numbers and carrier links (DPD, GLS, InPost, DHL, UPS, FedEx, Poczta Polska) into order metadata, batched by custom order source where possible; the Medusa fulfillment created once on `fulfillOnStatusIds`.
- Admin: BaseLinker page (connection check, stock plan, cards, orders, history), an order widget and a product widget, in English and Polish.
- Workflows for custom code and the events `baselinker.order_sent`, `baselinker.order_failed`, `baselinker.order_status_changed`.
- Demo mode: a simulated BaseLinker account built from the catalog, orders moving from "Nowe" to "Wysłane" with an InPost number, plan-only stock.
