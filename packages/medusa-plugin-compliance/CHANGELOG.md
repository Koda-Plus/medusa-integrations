# Changelog

## 0.1.0 (2026-10-08)

### Added

- The first release: GPSR product safety (economic operators, product records and the completeness check of every offer), RODO consent records and the data subject request queue, and the Omnibus lowest-30-days price history.
- One panel in the admin with three sections (GPSR, RODO, Omnibus) in English and Polish, links from the product and customer lists to the dashboard, and demo mode with sample operators, product records and price history flagged `demo`.
- A store API for the storefront: the product safety info and the price window of a SKU (public), recording a consent (public) and the customer's own data requests (logged in).
- The daily `compliance-price-snapshot` job and the koda.integration/1 contract with one line per product and per customer and the board counters.
