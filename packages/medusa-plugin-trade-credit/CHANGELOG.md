# Changelog

## 0.2.0 (unreleased)

### Fixed

- `enforce: true` now really stops the checkout. 0.1.0 documented the option but nothing gated the cart: `POST /store/carts/:id/complete` answers 403 `credit_hold` with a `reason` (`blocked`, `paused` or `over_limit`), the remaining amount and the order amount when the customer has credit terms and is blocked, paused, or the order would take the used amount over the limit (a limit of 0 has no ceiling). Customers without terms, guest carts, store mode and `enforce: false` pass untouched, and a failed read never blocks a sale.

### Added

- Store mode (option `store`): the plugin becomes the page over the trade credit a store already keeps, through a `CreditStoreAdapter` with `accounts`, `orders` and `update` (types in `src/modules/credit/lib/store-adapter.ts`). The plugin then keeps no limits, records no orders (the `order.placed` subscriber and the `credit-overdue` job do nothing), switches `demo` and `enforce` off and gates nothing; the Credit page, `GET /store/credit/me` and the koda.integration/1 summary and counter read the store's accounts and orders, and a change on the page goes back through `update` with the admin user who made it. An account is addressed by its customer id; a limit of 0 reaches the store as `null` (terms without a limit); limits keep two decimals.
- Optional adapter members: `capabilities` (block, pause; the page hides what the store does not support), `netDayChoices`, `maxNetDays`, `ruleText` (the store's rule in its own words on the page), `markPaidPath` (a "Settle" link next to each order), `documentSource` and `emailsLogPath`.
- The store mode page: tiles for customers on credit, used, overdue and used up limits; a customers tab (used against the limit, overdue with the oldest overdue order, open orders, "no limit" for terms without a ceiling, the store's note) and an orders tab (unpaid of the total, due date or "no invoice yet", days late, who placed it), each with filters and a search.
- Payment reminders from the page (adapter `reminder`): `GET /admin/credit/orders/:id/reminder` previews the e-mail (to, subject, the rendered body in a sandboxed frame, the stage and a warning such as a reminder that went out today), `POST /admin/credit/orders/:id/reminder` sends it through the store, which records it so its own schedule does not send the same stage again. Each order shows a summary of its reminders (sent before and after the due date, the last one, the next one, failures) with the full history on a click, why the store sends none for it, and a link to its e-mail log.
- The document of an order (`document`, `document_url`): its number under the order, linked to the invoicing service with that service's icon (`documentSource`).
- Test orders: `POST /admin/credit/orders/:id/hide` (adapter `hideOrder`) takes an order off the credit page, the debt and the reminders for good after a confirmation; nothing is deleted.
- A Products column in the orders on credit: the thumbnails of the order's line items (one large picture, or a stack of overlapping cards) under a "View" link that opens a dialog with every line (thumbnail, title, variant, SKU, barcode, quantity, unit price, value). Lines priced at 0.05 or less fold into one group. The items come from Medusa's `GET /admin/orders`, one request per page of the list.
- Loaders: a loading line, placeholder rows and a thin bar while newer data arrives behind the shown one.

### Changed

- Writes to `/admin/credit/*` take a JSON body or the `x-koda-request` header and answer 415 `json_required` otherwise; the admin sends both and authenticates through the kit's request (session or JWT).
- Badges never wrap ("114 days late" no longer breaks out of its frame).
- The sidebar entry sits at rank 7, so host apps can place their own extensions after it, and its label is translated (`Credit` in the dictionaries).
- The admin kit is 1.0.9 (white label for host apps with `window.__KODA_KIT__ = { whiteLabel: true }`, loaders, page slots, the Products column).
- README: store mode and the adapter, the new routes, setup, demo mode, security, uninstall, development and commercial support.

## 0.1.0 (2026-10-08)

### Added

- The first release: per-customer credit limits and payment terms (net 0, 14, 30 or 60 days), the used amount from the customer's unpaid orders, and credit orders with due dates.
- One page in the admin with a customer search, the limits with their used and remaining amounts and the blocking and pausing toggles, and the open credit orders, in English and Polish.
- The `credit-overdue` daily job: open orders past their due date become overdue, orders with a captured payment become paid, and the used amounts are recomputed.
- A store API for the logged-in customer: their own limit, terms and open invoices.
- Demo mode with sample limits and credit orders, flagged `demo`, and the koda.integration/1 contract with one line per customer with terms and the board counter of limits to check.
