# Changelog

## 0.3.0 (2026-10-07)

### Fixed

- Exactly once under a slow Fakturownia: the lease of an attempt follows `timeoutMs` (at least ten minutes, half an hour at 120 s), and the owner proves its claim with one conditional update when it writes what it will send and again right before the create request leaves, after the queue of the rate limit. When the claim ran out and another process took the row over, nothing is sent (`claim_lost`). The grace of a lost answer counts from the moment the create request left (`create_sent_at`, plus `timeoutMs`), never from the claim, so a slow lookup can no longer produce a second final document or correction.
- The automatic e-mail is taken atomically (`email_status` from `pending` to `sending` in one update): the issuing process and the status pass never both send it. One left in `sending` by a stopped process becomes `failed` after 15 minutes, with a note that it may have gone out, and is never sent again.
- A payment reminder and "Send to KSeF again" are taken atomically too: two clicks from two tabs send once. A refused reminder may be tried again at once.
- The KSeF status pass, the correction scan and the backlog of final documents after proformas pick their rows in the database (never checked first, then the least recently checked), also in stores with more than 500 documents in the window. A document sent to KSeF again is read for 14 days after the resend; one deleted in Fakturownia is no longer read in every pass.
- `GET /admin/fakturownia/documents?filter=corrections` and `GET /admin/fakturownia/runs?kind=corrections` filter as documented; a search keeps the filter.
- One definition of "unpaid" for the filter, the counter, the reminders and the monthly summary: no corrections, no proformas turned into a final document (new column `converted_at`, filled for 0.2.x documents by the migration), no documents of canceled orders.
- "Needs attention" includes a proforma of a canceled order whose rejection Fakturownia refused, and every tile of the page counts exactly its own list.
- PDF, UPO and KSeF XML downloads work for document numbers with Polish letters: an ASCII file name plus the name as printed in `filename*` (RFC 6266). Files carry `X-Content-Type-Options: nosniff`; the KSeF files are always `application/xml` and read with a 5 MB limit, checked before the whole body is read.
- An e-mail refusal is treated as "waiting for the KSeF number" only for the documented sentence ("brak numeru KSeF"), not for any message that names KSeF.
- EU VAT numbers are checked by country prefix and shape (EL for Greece, XI for Northern Ireland); any two letters followed by digits no longer make a company buyer.
- A receipt always names a consumer: a NIP that appeared after the row was queued is shown as a warning, never sent as `buyer_tax_no`.
- "Mark as issued" with a Fakturownia id checks the document's kind and order number too, and refuses a document another row already holds.
- `cancelOnOrderCanceled: false` also stops the plan of a correction to zero for a canceled order, as documented.
- A correction waits until KSeF accepted the invoice it corrects (it names that invoice's KSeF number).
- The lookup of a correction reads the private note of a candidate whose list answer left it out, so two corrections of the same value in flight never take each other's document.
- A payment that keeps failing goes to the end of the queue instead of holding its head.
- The history of runs keeps 50 per kind in each mode: the demo no longer pushes the real account's runs out.
- Stored and logged error texts mask e-mail addresses too (KSeF and document numbers stay readable).
- A shopper never reads why a PDF failed (a plain sentence, the reason in the server log); a store that lost its token answers 503 instead of a simulated PDF.
- Admin pages work when the plugin is installed from npm: the admin libraries are optional peers, so the app keeps the copies of Medusa's dashboard instead of a second, newer copy.

### Changed

- README describes this plugin only: the list of other invoicing plugins is gone.
- Demo mode runs only with `demo: true`. Without a token the plugin is "not configured": nothing is issued, the admin shows it in red and the log says so (an error on production). Before, a lost token quietly switched a live store to the simulated account. Set `demo: process.env.FAKTUROWNIA_DEMO === "true"` where you want the demo.
- GET routes never write: the sample data of the demo comes from the issue job or from `POST /admin/fakturownia/demo/seed`, which the page calls once on a first visit (`demoPrepared` in `GET /admin/fakturownia`); the simulated KSeF moves in the job, not when someone looks.
- Writes to `/admin/fakturownia` need a JSON body or the `x-koda-request` header (the kit's `writeGuard`), so a form on another site cannot trigger them with the admin's cookie.
- The admin calls the routes through the kit (`kitRequestInit`), so an admin signed in with a token (JWT) works too; the PDF, UPO and XML are fetched as files the same way instead of plain links.
- The admin asks again only while something moves by itself (5 s while issuing, 60 s for KSeF, e-mails and retries, never for what waits for a person), and never while the tab is hidden.
- The writers of 0.2.0 (corrections, e-mails and reminders, KSeF sending) carry a Beta badge in the admin: they are built from the API documentation and tested against a simulated account, not yet against a real one with KSeF. The README says what is measured in production and what is not, with a checklist for a test account with KSeF DEMO.
- Turning the corrections writer on asks first when approved corrections wait: how many go out right away.
- The admin says "1 day" and "1 dzień" (singular forms of the day counts).
- The guide's KSeF step names the 2026 dates and what the "companies only" modes leave outside KSeF; the FAQ on a wrong NIP describes the correction to zero and a new invoice by hand (a correction cannot change the buyer on a KSeF account).
- The order card is hostable (`fakturownia.order`, zone `order.details`, tab order 20): a Koda Plus host that claims the zone shows it as a tab, with `embedded` (no frame or header of its own, a line while loading). Without a host nothing changes.
- The package ships type declarations (`declaration: true`); `prepublishOnly` runs the typecheck too. The `./providers/*` export is gone (the plugin has no providers).

### Added

- RBAC policies for Medusa 2.15 and newer with the `rbac` feature flag: `fakturownia:read` on every admin route, `fakturownia:update` on every write, and `approve` (corrections), `send` (e-mails, reminders, KSeF again) and `manage` (writers) on top. Older Medusa versions and stores without the flag work as before.
- Exact lookups: `GET /admin/fakturownia/documents?order_id=a,b` and `?number=`.
- Deep links into the page: `?filter=`, `?q=`, `?doc=` (the document drawer), `?customer=` (a customer's documents), `?plans=` (the correction plans).
- The koda.integration/1 contract for Koda Plus hosts: `GET /admin/fakturownia/integration` (manifest), `/integration/summary?entity=order|customer` (the worst signal speaks, with the facts `document`, priority 80, and `buyer`, priority 60, from the plugin's rows, never from order metadata) and `/integration/attention?scope=orders` (counters `documents_attention`, `ksef_problems`, `corrections_to_approve`, `to_issue`, each the length of the list its link opens).
- `GET /admin/fakturownia/documents?customer_id=`: the documents of a customer's orders.
- Migration `Migration20261008093000_fakturownia`: `create_sent_at`, `email_claimed_at`, `reminder_at`, `finals_checked_at`, `converted_at` (columns only, idempotent).

## 0.2.2 (2026-10-07)

- References: stores that start soon (`soon: true`, shown with a Soon badge and no link); the since date is no longer shown.

## 0.2.1 (2026-10-06)

README only: screenshots of the admin page and of the order widget, and the link to the live demo on medusa.koda.plus, like the other Koda Plus integrations. No code changes.

## 0.2.0 (2026-10-06)

Corrections, e-mails, KSeF in depth, documents in the customer account and B2B buyer data, with a contract other plugins can build on. Every new write to Fakturownia ships off.

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

### Admin page (the same in all five Koda Plus integrations)

- One header: the name with the state badges, the description, then a toolbar with the view tabs (Panel, Setup guide, Settings, each with its name) and the page's actions, one main button and the others beside it or under More actions.
- The panel shows the business (counters, lists next to the Medusa product or order); Settings hold the technical parts (account, writers, plans, history).
- "Running in N stores" from the `references` option, with the rating and its source (`review`), and "Add your store", a request to Koda Plus by e-mail.
- "Copy prompt": a prompt for an AI coding agent (Claude Code, Cursor) that installs the plugin in another Medusa project the way the setup guide shows, with every writer off, and leaves notes for the next session.
- "Help on Discord": the Koda Plus server.
- Polish copy typeset: no one-letter word or short conjunction left at the end of a line.

## 0.1.0 (2026-10-05)

First release in the repository (never published on npm; the first npm release is 0.2.0), generalized from the Fakturownia integration Koda Plus runs in production for a Polish cosmetics wholesaler.

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
