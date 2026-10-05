# Changelog

## 0.1.0 (2026-10-04)

First public release, extracted from the OLX integration Koda Plus runs in production since September 2026.

- OAuth 2.0 connection to an OLX seller account (authorization code, `state` nonce, encrypted tokens with rotation).
- Hourly sync of all adverts through the OLX Partner API v2, with a write barrier (read-only), rate limiting and retries.
- SKU matching by `external_id` and by a configurable description pattern; one primary advert per variant.
- Complete-read rule: incomplete reads never remove links.
- Admin: OLX page (status, counters, advert table, sync history) and a product widget, in English and Polish.
- Store route for "Also on OLX" links, `syncOlxAdvertsWorkflow` for custom code.
- Demo mode with sample adverts generated from the catalog.
