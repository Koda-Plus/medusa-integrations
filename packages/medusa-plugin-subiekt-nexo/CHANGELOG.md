# Changelog

## 0.3.0 (2026-11-11)

No migration and no change to the bridge contract: everything reads tables the plugin already has and `GET /v1/orders/{id}` from contract 1.0.

### Added

- Safety net job `subiekt-catch-up`, every 10 minutes: recent orders (by default older than 10 minutes and younger than 7 days) with neither an `order.create` task nor a ZK get their task, through the same function as the `order.placed` subscriber (same payment rule: prepaid waits for the capture). A task waiting for a payment whose `payment.captured` never arrived is released when the order is paid. Never looks before the first ZK task of the database, so configuring the plugin late does not send old orders. Failed or canceled tasks are never touched. One run at a time across processes (transaction-scoped advisory lock) and per process; the unique index of `subiekt_task` keeps one row per order. Runs that queued something are in the history as "Safety net". Options `catchUpEnabled` (default `true`), `catchUpMinAgeMinutes` (`10`), `catchUpMaxAgeDays` (`7`); `POST /admin/subiekt/sync` takes `"catchup"`.
- **Check in Subiekt** on the order widget (`POST /admin/subiekt/orders/:id/check`): the documents the bridge reports for the order against the plugin tables, each one `missing` (only in Subiekt), `status_differs` (Subiekt realized or canceled it), `same` or `only_local` (the bridge no longer reports it). **Link** (`POST /admin/subiekt/orders/:id/link`) records a document only Subiekt has, from a fresh bridge answer, and settles the `order.create` (ZK) or `order.document` (FS, PA) task waiting for it, so no second document is created; on a known document it records the status Subiekt shows. A linked ZK or WZ queues the sales document like one from the bridge. New document source `linked`.
- Products column (the kit's order products cell) in the queue and documents lists of the admin page.

### Changed

- The order widget shows each document's kind in words, its warehouse, the document it came from, and "Realized in Subiekt" for a completed ZK.
- The `order.placed` subscriber queues through `queueOrderCreate` (exported from `src/workflows/subiekt/catch-up.ts`), shared with the safety net.

### Fixed

- The parcel locker of an order reaches the Subiekt document. The InPost plugin of Koda Plus, InPost Pay and the InPost geowidget store the locker as `machine_id` (with `machine_name` and `machine_address`), a key the order reader did not read, so `shipping.pickup_point` stayed empty for their orders. `machine_id` is now read first, with its name and its address in one line, and `locker_code`, `locker` and `point` are read too. A nested point gives its code before its display name.

### Not covered

- The contract has no way to ask the bridge for orders it knows by date, so the safety net only finds orders Medusa has and the plugin lacks, not documents created in Subiekt by hand for an order the plugin never queued; **Check in Subiekt** on the order covers those one by one.
- A document the plugin stored and the bridge no longer reports (deleted in Subiekt) is shown as "Only in Medusa" and never changed automatically.

### Removed

- The `references` option, the "Running in N stores" badge, the store cards at the end of the setup guide and the "Add your store" button. A `references` key left in the options is ignored.

## 0.2.2 (2026-10-18)

No change to the sync, the bridge contract or the tables: the shared admin kit moves from 1.0.1 to 1.0.9.

### Changed

- White label for host apps: with `window.__KODA_KIT__ = { whiteLabel: true }` in the admin's HTML, the page header shows no "by Koda Plus", no setup prompt and Discord help, and no references or "Add your store"; everything else stays.
- The kit's order products cell is available to the admin (`src/admin/lib/subiekt-order-products.tsx`): the thumbnails of an order's line items under a "View" link that opens a dialog with every line, and an amount breakdown (products, shipping, discount with codes), read from Medusa's `GET /admin/orders`, one request per list page. The page does not use it yet.
- The kit's loaders (a loading line, placeholder rows, a thin bar while newer data arrives) and page slots (`addToSlot` and `KitHostSlot`, where a host app adds its own sections) are available to the admin.
- README: Uninstall, Compatibility, Development, Commercial support and a separate Trademarks section.

## 0.2.1 (2026-10-07)

### Fixed

- Admin pages work when the plugin is installed from npm: the admin libraries are optional peers, so the app keeps the copies of Medusa's dashboard instead of a second, newer copy.

### Changed

- The admin page runs on the shared Koda Plus kit 1.0.1: the setup prompt pins this exact version, checks the package signatures (`npm audit signatures`) and shows the note before saving it; the prompt is copied only with its Copy button.
- The setup prompt turns demo mode on only when `SUBIEKT_DEMO` is `"true"`, never because the bridge address is missing (the plugin itself already needed `demo: true`).
- `prepublishOnly` runs the typecheck too.
- The package ships its type declarations (`.d.ts`), so TypeScript projects get types for the module, the workflows and the admin helpers.
- README links are absolute, so they work on npm and medusajs.com.
- README describes this plugin only: the section comparing it with other integrations is gone.
- References: stores that start soon (`soon: true`, shown with a Soon badge and no link); the since date is no longer shown.

## 0.2.0 (2026-10-06)

Needs no bridge update to keep working: every new feature is detected from the bridge `capabilities`. Bridge 0.2.0 (contract 1.1.0) unlocks them.

- Contract 1.1.0, additive: `capabilities`, bridge and nexo SDK versions, database version, Sfera licence state, last event, queue sizes and server time in `GET /v1/health`; `GET /v1/products` (paged from one snapshot, price levels); the optional `buyer` block of `POST /v1/orders`; `POST /v1/orders/{orderId}/documents` (FS or PA, idempotent); `ksef_number` on documents; the `document.updated` event. New examples: `products.response.json`, `order-create-b2b.request.json`, `document-create.request.json`, `document-create.response.json`.
- Products and prices from Subiekt, plan first: hourly job `subiekt-sync-products`, EAN then SKU matching (no suffix stripping), `priceLevel`, `priceType`, `priceCurrency`, `priceTarget` (variant prices or `priceListId`), `priceWriter` and `createMissingProducts` hard switches, `maxPriceChangesPerRun` (200) and `maxProductsPerRun` (20), re-read before every write, stale items skipped, quarantine after three failed runs with release in the admin. An incomplete read plans nothing.
- Contractors by NIP: `nipSources` with checksum validation, `createContractors` hard switch; an invalid NIP sends the ZK to the retail buyer with a warning on the task.
- Sales documents: `salesDocument` (`none` default, `fs`, `pa`, `auto`) and `salesDocumentAfter` (`wz` default, `zk`). Exactly once: one `order.document` task per order, atomic claim, `unknown` status for unclear answers, reconciled with `GET /v1/orders/{id}` before any new attempt. KSeF numbers in the order metadata (`subiekt_ksef_number`), the documents view and the order widget; `subiekt.document_updated` event.
- Writers: `subiekt_writer` table, `POST /admin/subiekt/writers`; every new write needs its option and a person arming it, recorded with who and when.
- Admin: "Panel" | "Setup guide" switch (`?view=guide`), bridge diagnostics (versions, licence, round trip, clock skew, signature result, last event, webhook, capabilities and what is missing with the reason), writers, products and prices plan, FS and PA with KSeF, "Answer unclear" tasks, buyer and warnings on tasks, issue FS or PA from the order widget, "Running in production" from the new `references` option.
- Setup guide in English and Polish with live step states, a go-live checklist and troubleshooting; also `docs/guide-en.md` and `docs/guide-pl.md`. Verified facts in `docs/subiekt-nexo-api-notes.md`.
- Demo bridge: products with two price levels and EAN conflicts from the store catalog, contractors by NIP, FS and PA numbers, KSeF numbers two minutes after an FS, health with every capability and a 1.4 s clock skew.
- Migration `Migration20261006120000`: `subiekt_writer`, `subiekt_catalog_change`, `subiekt_catalog_quarantine`, new columns on connection, document and task.

### Admin page (the same in all five Koda Plus integrations)

- One header: the name with the state badges, the description, then a toolbar with the view tabs (Panel, Setup guide, Settings, each with its name) and the page's actions, one main button and the others beside it or under More actions.
- The panel shows the business (counters, lists next to the Medusa product or order); Settings hold the technical parts (account, writers, plans, history).
- "Running in N stores" from the `references` option, with the rating and its source (`review`), and "Add your store", a request to Koda Plus by e-mail.
- "Copy prompt": a prompt for an AI coding agent (Claude Code, Cursor) that installs the plugin in another Medusa project the way the setup guide shows, with every writer off, and leaves notes for the next session.
- "Help on Discord": the Koda Plus server.
- Polish copy typeset: no one-letter word or short conjunction left at the end of a line.

## 0.1.0 (2026-10-05)

First release, built on what Koda Plus learned running a Subiekt nexo bridge in production for a Polish cosmetics brand since 2026.

- Bridge contract `contract/openapi.yaml` 1.0.0: health, orders (ZK), cancel, fulfillments (WZ), stock pages from one snapshot, cursor-based event feed with `head_id`, signed webhook. Examples and cross-language signature vectors.
- Request signatures in both directions: HMAC-SHA256 over timestamp, method, path and raw body; secret rotation; 5 minute window.
- Orders to ZK on `order.placed`; prepaid providers wait for `payment.captured`; cancels on `order.canceled`; optional WZ from Medusa fulfillments.
- Outbox task queue with backoff (14 attempts, about 2.5 days), stale task recovery, non-retryable errors parked for a person.
- Event feed reader: WZ from the warehouse into order metadata, `subiekt.document_issued`, optional `fulfillOnWz`; restarts from 0 when the bridge feed was reset.
- Stock sync into inventory levels: EAN first, then SKU, conflicts never written, missing products never zeroed, kit components by their own SKU, dry run.
- Admin: Subiekt nexo page (connection, queue, documents, stock plan with unmatched SKUs, history) and an order widget, in English and Polish.
- Workflows for custom code: send, cancel, WZ, stock, events, health, queue.
- Demo bridge inside Medusa: ZK in seconds, WZ three minutes later, stock from the catalog.
