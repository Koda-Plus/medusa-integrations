# Changelog

## 0.1.3 (2026-11-09)

- The setup guide marks "Connect the store" done once the storefront reads a GPSR record: GET /store/compliance/products/:id leaves `store_read_at` in the record metadata (at most once a day), the status counts `store_reads` and every product row carries `store_read_at`.

## 0.1.2 (2026-11-09)

- The GPSR record of a product opens in a drawer over the list instead of a form under the table, so the edit is in view whatever row it starts from.

## 0.1.1 (2026-10-18)

- The panel has a setup guide.
- The admin menu entry has a rank (5).
- README screenshots.
- Shared kit 1.0.9: white label support (a store can hide the Koda Plus byline, prompt, community links and references), the order products cell (thumbnails, a dialog with the order lines, products of carts without an order) and the amount breakdown component are available to the admin pages, and loaders, skeleton rows and the guide got small fixes.

## 0.1.0 (2026-10-08)

### Added

- The first release: GPSR product safety (economic operators, product records and the completeness check of every offer), RODO consent records and the data subject request queue, and the Omnibus lowest-30-days price history.
- One panel in the admin with three sections (GPSR, RODO, Omnibus) in English and Polish, links from the product and customer lists to the dashboard, and demo mode with sample operators, product records and price history flagged `demo`.
- A store API for the storefront: the product safety info and the price window of a SKU (public), recording a consent (public) and the customer's own data requests (logged in).
- The daily `compliance-price-snapshot` job and the koda.integration/1 contract with one line per product and per customer and the board counters.
