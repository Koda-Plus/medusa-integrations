# Changelog

## 0.2.0 (2026-10-06)

Corrections, e-mails, KSeF in depth, documents in the customer account and B2B buyer data, with a contract other plugins can build on. Every new write to Fakturownia ships off.

### Admin page (the same in all five Koda Plus integrations)

- One header: the name with the state badges, the description, then a toolbar with the view tabs (Panel, Setup guide, Settings, each with its name) and the page's actions, one main button and the others beside it or under More actions.
- The panel shows the business (counters, lists next to the Medusa product or order); Settings hold the technical parts (account, writers, plans, history).
- "Running in N stores" from the `references` option, with the rating and its source (`review`), and "Add your store", a request to Koda Plus by e-mail.
- "Copy prompt": a prompt for an AI coding agent (Claude Code, Cursor) that installs the plugin in another Medusa project the way the setup guide shows, with every writer off, and leaves notes for the next session.
- "Help on Discord": the Koda Plus server.
- Polish copy typeset: no one-letter word or short conjunction left at the end of a line.

### Contract for other plugins

- Events `fakturownia.document.issued` (VAT invoice, proforma, receipt) and `fakturownia.document.corrected` (correction invoice), both with `{ id, order_id, kind, number, external_id, demo }`, emitted once when a document becomes issued: a create, an adoption after a lost answer, the reconciliation of an `unknown` row, a person marking it issued with its Fakturownia id.
- `downloadPdf({ externalId, demo })` on the module service: reads only the options and calls Fakturownia, so any workflow or subscriber may call it. Demo mode returns a generated PDF with the document's number and makes no request. Errors are a `FakturowniaApiError` with the codes `PDF_NOT_READY`, `DEMO_MODE`, `BAD_ID` and `HTTP_404`.
- The module exports the event names, the event type and `FakturowniaApiError`.

### Corrections

- Option `corrections` (`plan` by default, or `off` for the behaviour of 0.1.0).
- Plans from `order.return_received`, `payment.refunded`, `order-edit.confirmed` and `order.canceled`, from a scan every 30 minutes (job `fakturownia-plan-corrections`) and from "Check for corrections" on the order page.
- A plan is the difference between what the documents say (positions plus every correction already decided) and what the order says now: quantities after edits, minus received and damaged returns, a refund beyond the returned goods spread over the positions, nothing for a canceled order. Positions are matched by SKU or name and tax rate, so a refund that pays back a return is not corrected twice.
- One open plan per document with a revision; Approve takes the revision the person saw and the reason (at most 256 characters, the KSeF limit); Dismiss and Done close a plan for good.
- Issued exactly once: a unique key per order, source and mode, the claim with a lease, a marker in the private note (`internal_note`), a lookup among the corrections of the corrected invoice before every create. The corrected invoice is read before sending; when someone changed it in Fakturownia, nothing is sent and the plan says why. The buyer, the department and the order number are copied from it.
- A canceled order gets a correction to zero for approval. Receipts get a manual plan with the amounts for the register of returns; claims and exchanges get a manual plan too.
- Corrections are not canceled with their order and are not marked paid.

### Writes to Fakturownia

- Issuing corrections, sending e-mails from the admin and re-sending to KSeF ship off. The option `writers.<name>` is the hard switch (`false` wins); the runtime toggle in the admin is stored with who flipped it and when, apart for demo and live mode.

### E-mails

- "Send by e-mail" from the admin and the order widget, to the buyer or to up to five other addresses (`email_to`), with the PDF attached on request (`email_pdf`, option `emailPdf`).
- Payment reminders for unpaid proformas and VAT invoices issued at least `reminderAfterDays` days ago (default 7), at most once a day per document. The API has no reminder call, so a reminder is the document e-mailed again with the account's template.
- A history per document and an E-mails section: who asked, when, the masked address, Fakturownia's answer. A request without an answer is never repeated by the plugin.

### KSeF

- New fields read and kept: the send date, the verification link, the KSeF link, the corrected KSeF number and the list of errors.
- A KSeF history per document, the UPO and the KSeF XML fetched by the backend (`attachment?kind=gov_upo|gov`, the redirect followed by hand, the token sent only to the account host).
- "Send to KSeF again" (`send_to_ksef=yes`) where it is safe, once per five minutes per document.
- Counters of accepted, processing and rejected documents; corrections are read like VAT invoices.

### Storefront

- `GET /store/fakturownia/orders/:orderId/documents` and `GET /store/fakturownia/documents/:id/pdf` for the logged-in customer (session or bearer token), ownership by the order's customer id, 30 lists and 10 PDFs a minute per customer. The plugin's middlewares authenticate them.

### B2B buyer data

- Option `nipSources`: order metadata keys, billing address metadata, `billing_address.tax_id`, a NIP typed into the company name, a company module of the store read with Query.
- The NIP checksum and the shape of EU VAT numbers are checked; an invalid or missing NIP gives a consumer document and a warning on the row instead of a refusal (422) from Fakturownia. The NIP itself is not stored.
- Option `departmentsBySalesChannel`: the seller department per sales channel; "Check connection" names the department of every mapped channel.

### Monthly summary

- `GET /admin/fakturownia/summary`: the last 12 months, documents and gross value per kind and currency, the unpaid amount, the share KSeF accepted.

### Admin

- A Panel and a Setup guide (`?view=guide`): 13 steps with their state read from the store, a go-live checklist, an FAQ.
- "Running in production" from the option `references`, on the Panel and at the end of the guide.
- New sections: Writes to Fakturownia, Corrections, Unpaid documents, E-mails, Monthly summary; a detail drawer per document (KSeF, e-mails, corrections); the order widget shows the plans and "Check for corrections".

### Database

- Migration `Migration20261006092000`: new columns on `fakturownia_document`; the unique index per order and kind leaves out corrections, which get a unique index per correction key; new tables `fakturownia_correction`, `fakturownia_email`, `fakturownia_ksef_event` and `fakturownia_setting`.

### Demo mode

- Simulates all of the above: "KOR" numbers, ids that carry their number, generated PDFs, UPO and KSeF XML, one invoice rejected by KSeF and waiting for re-sending, another with a rejection and a resend in its history, correction plans from the demo store's own returns, refunds and edits or a simulated return, a simulated mailbox, a few unpaid documents moved back for the reminders and the summary. Seeded once per store.

### Changed

- An invalid NIP no longer reaches Fakturownia (0.1.0 sent it and the document was refused): the document is issued for a consumer, with a warning.
- The demo's refused document shows a missing basis of a VAT exemption instead of a wrong NIP.
- The HTTP client sends `KodaPlus-Medusa-Fakturownia/0.2` as its user agent.

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
