# Changelog

## 0.2.0 (2026-10-06)

From a read-only view of OLX to a two-way tool, with every write off by default.

- Alerts every 15 minutes: adverts live on OLX while the variant is sold out or the product unpublished in Medusa, variants in stock whose adverts are not live, and variants in stock never listed on OLX. Counters, filters, search, alert badges in the advert table and in the product widget.
- Advert lifecycle writer (`lifecycleWriter`): deactivates live adverts of sold out or unpublished variants, finishes sold out adverts over the package limit and reactivates only the adverts it paused itself. Plan first, dry run, cap per run, quarantine after three rejections, a mass guard for plans that would end more than max(10, 25 %) of the live adverts.
- Price writer (`priceWriter`): advert prices from the variant's base price in the market currency. The advert is read, sent back whole with only the price changed, and changes above `maxPriceChangePercent` wait for approval.
- Publishing (`publishWriter`, `publish` options): one advert per variant from mapped Medusa categories, with the required category attributes read from OLX and validated, together with the OLX text rules, before sending. Exactly once: unique row per variant, atomic claim with a lease, lookup by `external_id` before every create, `unknown` state settled by a lookup.
- Two switches per writer: the option (hard, `false` wins) and the toggle in the admin (who and when). Demo and live toggles are separate. Live writes need a token with the `write` scope; the consent asks for it only when a writer is allowed.
- Advert statistics (views, phone views, observers), refreshed hourly with a cap and shown per advert, in totals and in the product widget. Never exposed by a store route.
- Message threads with unread counts, linked to adverts and products, with links to the OLX chat inbox. No message text and no buyer id are stored.
- Admin: Panel and Setup guide views (`?view=guide`), writer cards, plans and publish plan with the exact request, the setup guide with live step states, go-live checklist and troubleshooting, all in English and Polish.
- `references` option, shown as "Running in production" on the Panel and in the guide.
- Write barrier: GET, HEAD and the token exchange as before, plus three writes (advert commands `activate`, `deactivate` and `finish`, an advert update, a new advert), each only for the writer armed for the call. Deleting, packets, paid features, `extend` and messages stay refused.
- IP block detection (403 after 4 500 requests in 5 minutes) pauses every job for 30 minutes; `Retry-After` is honoured on 429.
- Demo mode simulates everything from the store catalog: alerts, statistics, threads, all three writers acting on the simulation, and a publish plan with one product missing a required attribute. Demo writes reset after a day, or with "Reset the simulation".
- One new migration: alerts, plan rows, publications, writer runs, threads and a state table; statistics and category columns on the advert snapshot.
- New jobs: `olx-plan` (every 15 minutes), `olx-refresh-stats` (hourly), `olx-sync-threads` (every 15 minutes). New workflows: `runOlxCycleWorkflow`, `runOlxWriterWorkflow`, `refreshOlxStatsWorkflow`, `syncOlxThreadsWorkflow`.

## 0.1.0 (2026-10-04)

First public release, extracted from the OLX integration Koda Plus runs in production since September 2026.

- OAuth 2.0 connection to an OLX seller account (authorization code, `state` nonce, encrypted tokens with rotation).
- Hourly sync of all adverts through the OLX Partner API v2, with a write barrier (read-only), rate limiting and retries.
- SKU matching by `external_id` and by a configurable description pattern; one primary advert per variant.
- Complete-read rule: incomplete reads never remove links.
- Admin: OLX page (status, counters, advert table, sync history) and a product widget, in English and Polish.
- Store route for "Also on OLX" links, `syncOlxAdvertsWorkflow` for custom code.
- Demo mode with sample adverts generated from the catalog.
