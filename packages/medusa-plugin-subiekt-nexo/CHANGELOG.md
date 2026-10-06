# Changelog

## 0.2.1 (2026-10-07)

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
