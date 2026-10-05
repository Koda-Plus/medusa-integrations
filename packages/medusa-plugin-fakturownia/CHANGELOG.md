# Changelog

## 0.1.0 (2026-10-05)

First public release, generalized from the Fakturownia integration Koda Plus runs in production for a Polish cosmetics wholesaler.

- Documents for Medusa orders: the final document at the trigger (`payment_captured` or `order_placed`), or a proforma at the trigger and the final document after the first fulfillment; a receipt instead of a VAT invoice for consumers on request (`receiptKind` configurable).
- Exactly once: one row per order and kind enforced by unique indexes (and one final document per order), an atomic claim with a token and a lease, a lookup by order number (`?oid=`) and by proforma (`?from_invoice_id=`) before every create, a create request never repeated blindly, unknown results reconciled after a grace period, `oid_unique` on top, conflicts left to a person.
- State in the plugin's own tables, not in order metadata, and no buyer data at rest: kind, number, order number, amounts, positions, payment, KSeF status, errors.
- Buyer: company with a tax ID (cleaned, PL prefix stripped, EU numbers kept), person otherwise, `buyer_company` always sent; address from billing, then shipping; street from both address lines.
- Positions from Medusa totals: the tax rate from the line's tax lines (the default rate only without them), "zw" and "np" codes, gross totals after discounts, one position per shipping method also at 0.00, quantities from `items.detail`.
- Proforma to VAT: positions and the whole buyer copied from the proforma, including `buyer_company`, `buyer_first_name` and `buyer_last_name`, linked with `from_invoice_id`.
- Payments: unpaid documents set paid after a capture, with an amount check; payments recorded in Fakturownia picked up.
- KSeF: `gov_status`, the KSeF number and errors of VAT invoices read every 15 minutes; documents dated in Poland's time zone.
- E-mail to the buyer on request, waiting for the KSeF number on KSeF accounts.
- Canceled orders: proformas rejected, VAT invoices and receipts flagged for a correction, queued documents canceled.
- One HTTP client: Bearer token in a header only, no redirects, a process-wide rate limiter, retries for reads, a single shot for the create, the token masked everywhere.
- Admin: Fakturownia page (connection check, counters, documents with filters, search and actions, history) and an order widget with the PDF streamed by the backend, in English and Polish.
- Workflows for custom code and the events `fakturownia.document_issued`, `fakturownia.document_failed`, `fakturownia.document_needs_attention`.
- Demo mode: a simulated Fakturownia account, documents for the newest orders, numbers per kind, payments, KSeF acceptance after a few minutes, one refused document.
