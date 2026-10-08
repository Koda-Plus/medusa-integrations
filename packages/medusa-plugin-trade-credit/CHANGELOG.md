# Changelog

## 0.1.0 (2026-10-08)

### Added

- The first release: per-customer credit limits and payment terms (net 0, 14, 30 or 60 days), the used amount from the customer's unpaid orders, and credit orders with due dates.
- One page in the admin with a customer search, the limits with their used and remaining amounts and the blocking and pausing toggles, and the open credit orders, in English and Polish.
- The `credit-overdue` daily job: open orders past their due date become overdue, orders with a captured payment become paid, and the used amounts are recomputed.
- A store API for the logged-in customer: their own limit, terms and open invoices.
- Demo mode with sample limits and credit orders, flagged `demo`, and the koda.integration/1 contract with one line per customer with terms and the board counter of limits to check.
