# Fakturownia by Koda Plus

Issue Polish **VAT invoices, proformas, receipts and correction invoices in Fakturownia** (fakturownia.pl) for your Medusa orders, exactly once. The document is created when the payment is captured (or when the order is placed); the payment, the KSeF number and the PDF come back to the admin; when an order changes after issue, the correction is planned for a person to approve; documents go to buyers by e-mail and to logged-in customers in the storefront. The API token never reaches a browser.

Nothing about the buyer is stored in Medusa: the plugin keeps the document kind, number, amounts, positions and statuses, and builds the buyer data from the order at the moment it sends it. E-mail addresses in the send history are masked.

![Fakturownia page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-fakturownia/docs/admin-fakturownia.png)

**Live demo:** Medusa admin [medusa.koda.plus/app/fakturownia](https://medusa.koda.plus/app/fakturownia?demo=en), signed in to a public demo account by the link itself. The demo runs the plugin in demo mode (`demo: true`): a simulated Fakturownia account that issues documents for the store's own orders, with KSeF statuses, corrections to approve and e-mails, and zero outgoing requests.

## What it does

- **Documents** (VAT invoice, proforma, receipt): Medusa to Fakturownia, at the trigger you choose (`payment_captured` by default, or `order_placed`), retried with backoff, with a pass every 2 minutes.
- **Proforma first, VAT later** (optional): a proforma at the trigger and the VAT invoice after the first fulfillment, made from the proforma and linked to it.
- **Receipts for consumers** (optional): buyers without a tax ID get a receipt instead of a VAT invoice.
- **Corrections** (faktury korygujące): a return received, a refund, an order edit or a cancellation after issue becomes a correction plan (positions before and after, net, VAT and gross). A person approves the plan as shown; the correction invoice is issued once. Receipts, claims and exchanges get a manual plan that says what to do.
- **Payment**: a document issued unpaid becomes paid in Fakturownia when the payment is captured in Medusa, after an amount check.
- **KSeF**: the KSeF number, status, send date, the errors KSeF gave, the verification link, the UPO and the KSeF XML, a history per document, "Send to KSeF again", and counters of accepted, processing and rejected documents.
- **E-mail**: Fakturownia e-mails the document to the buyer, automatically after issue (option) or from the admin, to the buyer or to other addresses, with a history per document; payment reminders for unpaid proformas and VAT invoices.
- **Customer documents**: storefront routes for the logged-in customer, the documents of their own order and the PDF, rate limited.
- **B2B buyer data**: where the NIP is looked for (metadata keys, the billing address, a company module of your store), the NIP checksum, and the seller department per sales channel.
- **Monthly summary**: documents and their value per kind and month, the unpaid amount, the share KSeF accepted.
- **Canceled orders**: a proforma is rejected in Fakturownia; a VAT invoice gets a correction to zero planned for approval; a receipt gets a manual plan.

## Features

- **Exactly once**, with four locks: unique rows per business key in the database, an atomic claim with a lease, a lookup in Fakturownia before every create, and a create request that is never repeated blindly. Corrections follow the same rules, with their own key.
- **Plan first**: a correction is computed from the order's state, shown with every position before and after, recomputed while it waits, and issued only after a person approved the exact revision they saw.
- **Two switches for every new write**: corrections, e-mails and KSeF re-sending start off. An option can forbid each one for good; a person turns it on in the admin, and the admin shows who did and when.
- **Company or person**: a valid tax ID (NIP) makes the buyer a company; an invalid or missing one gives a consumer document and a warning in the admin, never a surprise refusal from Fakturownia.
- **Positions from Medusa totals**: one per line item ("Product, variant", SKU, quantity, gross total after discounts, the tax rate of the line's tax lines) and one per shipping method, also at 0.00.
- **Admin page** with a Panel and a Setup guide: counters, the writers, the connection, the corrections, the documents with a detail drawer (KSeF, e-mails, corrections), the unpaid documents, the e-mails, the monthly summary, the history of background runs, and the stores running the integration.
- **Order widget** with the documents of the order, their details, "Issue now", the correction plans and "Check for corrections".
- **Demo mode** (only with `demo: true`): a simulated Fakturownia account inside the plugin that shows everything above. Nothing leaves Medusa.
- **Admin in English and Polish.**
- **Workflows, events and a PDF method** for your own code and for other plugins.
- **Works with Koda Plus hosts**: the `koda.integration/1` contract (one line per order and customer, board counters) and an order card that a host can show as a tab.

## Requirements

- Medusa 2.12 to 2.21 and Node.js 20+ (see Compatibility).
- For a real account: a Fakturownia API token (Ustawienia, Ustawienia konta, Integracja, Kod autoryzacyjny API) and the account name (the subdomain of your Fakturownia address).

## Installation

```bash
npm install @koda-plus/medusa-plugin-fakturownia
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-fakturownia` or `pnpm add @koda-plus/medusa-plugin-fakturownia`.

## Setup in brief

The admin page has the full guide (Fakturownia, then Setup guide, or `/app/fakturownia?view=guide`), with the state of each step read from your store.

1. **Create the Fakturownia account** at fakturownia.pl. The first part of your address (`mojafirma` in mojafirma.fakturownia.pl) is the `account` option.
2. **Copy the API token**: Ustawienia, Ustawienia konta, Integracja, Kod autoryzacyjny API. Put it in an environment variable, never in code.
3. **Add the plugin** to `medusa-config.ts` (below) and run `npx medusa db:migrate`.
4. **Check the connection** in the admin: it reads the companies of the account, nothing is created.
5. **Choose the seller company** (optional): `departmentId` (Ustawienia, Dane firmy, the id is in the address), and `departmentsBySalesChannel` for several channels.
6. **Connect KSeF in Fakturownia**: Ustawienia, Integracje i dodatki, KSeF (authorize with a certificate or an authorization file), then Ustawienia, KSeF, Automatyczna wysyłka. The plugin does not talk to KSeF itself.
7. **Choose the documents and the trigger**: `documentFlow`, `trigger`, `receiptForConsumers`.
8. **Map payment methods** (optional): `paymentTypes`, `codProviders`, `paymentTermDays`.
9. **Check the numbering series** in Fakturownia's account settings (optional); set `oidPrefix` when an earlier shop used the same order numbers.
10. **Tell the plugin where the NIP is** (optional): `nipSources`.
11. **Issue a test order end to end**: the document, its PDF, its KSeF number; then a partial refund and its correction plan.
12. **Turn on the writers you want** (go-live): corrections, e-mails, KSeF re-sending, under Writes to Fakturownia.
13. **Show documents in the customer account** (optional): the storefront routes below.

## Configuration

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-fakturownia",
      options: {
        apiToken: process.env.FAKTUROWNIA_API_TOKEN,
        account: process.env.FAKTUROWNIA_ACCOUNT, // "mojafirma" for https://mojafirma.fakturownia.pl
        issuePlace: "Warszawa",
        // demo: process.env.FAKTUROWNIA_DEMO === "true", // a simulated account, only when asked for
        // documentFlow: "proforma_then_vat",
        // receiptForConsumers: true,
        // corrections: "plan",
        // writers: { corrections: true, emails: true, ksef: true },
      },
    },
  ],
})
```

Run the migrations, then open **Fakturownia** in the admin sidebar and click **Check connection**.

```bash
npx medusa db:migrate
```

Without `apiToken` (or `account`) the plugin registers, the admin says "Not configured" in red, the log says so (an error with `NODE_ENV=production`) and nothing is issued: paid orders wait and can be issued later. Demo mode runs only when you ask for it with `demo: true`, so a token lost on production never turns real orders into simulated documents. Missing options never break the boot.

### Options

- `apiToken`: the Fakturownia API token. Sent only in the `Authorization` header, masked in every log, error and admin screen.
- `account`: the account subdomain, like `mojafirma` (the full address works too). It becomes part of the host name, so anything that is not a valid subdomain is refused.
- `demo` (default `false`): the simulated account, only when set to `true` (for example `demo: process.env.FAKTUROWNIA_DEMO === "true"`). Since 0.3.0 a missing token no longer turns it on.
- `documentFlow` (default `vat`): `vat` issues the final document at the trigger; `proforma_then_vat` issues a proforma at the trigger and the final document after the first fulfillment, linked with `from_invoice_id`.
- `trigger` (default `payment_captured`): `payment_captured` (the order captured in full) or `order_placed`.
- `receiptForConsumers` (default `false`): buyers without a tax ID get a receipt instead of a VAT invoice.
- `receiptKind` (default `receipt`): the API `kind` of a receipt.
- `defaultVatRate` (default `23`): the rate of a line without Medusa tax lines. `zw` and `np` work too.
- `lang` (default `pl`): the document language, like `en` or `pl/en` for a bilingual document.
- `issuePlace`: the place of issue printed on the document (the API does not take it from the account settings).
- `departmentId`: the seller department (Ustawienia, Dane firmy). Default: the main company of the account.
- `departmentsBySalesChannel` (default none): the seller department by sales channel id, like `{ "sc_01J...": 456 }`; other channels use `departmentId`.
- `categoryId`: the income category of the documents.
- `shippingPositionName` (default `Dostawa`): the name of a shipping position when the shipping method has none.
- `quantityUnit` (default `szt.`): the unit of every position.
- `paymentTypes` (default: `transfer` for everything): the Fakturownia `payment_type` by payment provider id prefix, like `{ pp_stripe: "card", pp_payu: "payu" }`.
- `codProviders` (default `pp_cod`, `pp_cash`): payment provider id prefixes meaning cash on delivery (`cash_on_delivery`).
- `paymentTermDays` (default `7`, 0 to 365): the payment term of documents issued unpaid.
- `markPaidOnCapture` (default `true`): when a payment is captured for a document issued unpaid, set it paid in Fakturownia.
- `sendByEmail` (default `false`): after issuing, Fakturownia e-mails the document to the buyer (`writers.emails: false` stops it too).
- `emailPdf` (default `false`): attach the PDF to the e-mails Fakturownia sends (`email_pdf`).
- `cancelOnOrderCanceled` (default `true`): a canceled order rejects its proforma; a VAT invoice or a receipt is flagged "needs correction" (and with `corrections: "plan"` a correction to zero is planned).
- `corrections` (default `plan`): `plan` computes correction plans when an issued order changes; `off` plans nothing (0.1.0 behaviour).
- `writers` (default `{ corrections: true, emails: true, ksef: true }`): the hard switches of the writes added in 0.2.0. `true` lets a person turn the writer on in the admin (it starts off); `false` turns it off for good, whatever the admin says. Strings like `"false"` from environment variables work.
- `reminderAfterDays` (default `7`, 0 to 365): unpaid proformas and VAT invoices at least this old are listed for a payment reminder (and are orange in the contract lines).
- `nipSources` (default: the keys of `taxIdMetadataKeys` in the order metadata, then in the billing address metadata, then `billing_address.tax_id`): where the buyer's NIP is looked for, in order. Strings `order.metadata.<key>`, `billing_address.metadata.<key>`, `billing_address.tax_id`, `billing_address.company` (a NIP typed into the company name, taken only when it passes the checksum), `company:<entity>`, or an object `{ entity, customerField, nipField, nameField }` for a company module of your store read with Query by the order's customer (defaults `customer_id`, `nip`, `name`).
- `taxIdMetadataKeys` (default `nip`, `tax_id`, `invoice_nip`): the metadata keys of the default `nipSources`.
- `oidPrefix` (default none): a prefix for the order number sent to Fakturownia, for accounts that already hold documents numbered like Medusa orders (an earlier shop).
- `references` (default none): stores running the integration, shown in the admin ("Running in production"): `[{ name, url, icon?, description?, metrics?: [{ label, value }], links?: [{ label, url }], review?: { rating, scale?, source, url?, icon?, quote?, author? }, soon? }]`, texts plain or `{ en, pl }`. `icon` is a data URI or an https address; `review` is the store's rating of the work (a positive `rating` up to `scale`, default 5, and its `source`, like Clutch). `soon: true` marks a store that starts on Medusa soon: it is shown with a "Soon" badge and no link, and its `url` is optional. Entries without a name, or live entries without an https address, are dropped.
- `requestsPerMinute` (default `60`, 1 to 600): self-imposed rate limit (Fakturownia documents none).
- `timeoutMs` (default `30000`, 5000 to 120000): one request. The claim of an attempt lasts at least ten minutes, and fifteen times this.

## Which document, and when

Every event of an order (placed, payment captured, fulfillment created) asks the same question, so the order of the events does not matter and a missed event is caught by the next one:

- `documentFlow: "vat"`: when the trigger is met, the final document.
- `documentFlow: "proforma_then_vat"`: when the trigger is met, a proforma; after the first fulfillment, the final document. An order fulfilled before the trigger goes straight to the final document.
- The final document is a VAT invoice for a company, and for a person too unless `receiptForConsumers` is on (then a receipt).
- **Issue now** on the order page issues the document of the trigger without waiting for it.
- Cash on delivery orders are captured late in Medusa, or never: with the default trigger their document waits for the capture. Stores with cash on delivery usually choose `trigger: "order_placed"` or the proforma flow.

The final document after a proforma is made from the proforma as Fakturownia holds it: every position, the whole buyer including its type (company or person), the order number and the payment. `from_invoice_id` links the two documents.

## Exactly once

A duplicate VAT invoice on a KSeF account can only be undone with a correction invoice, so the plugin is built around never creating one:

1. **One row per business key.** Subscribers only insert a pending row into `fakturownia_document`. A unique index on (order id, kind, mode) makes the database refuse a second document of the same kind for one order, a partial unique index allows only one final document (VAT invoice or receipt) per order, and a correction is unique per (order id, source key, mode). A racing insert is ignored. The demo mode keeps its rows apart.
2. **One sender per row.** The job claims a row with one atomic `UPDATE ... SET status = 'issuing' ... WHERE id = ? AND status = 'pending' RETURNING *`, with a claim token and a lease that follows `timeoutMs` (at least ten minutes, half an hour at the longest timeout). Two processes cannot both win a row, and the result is written only by the claim's owner. The owner proves the claim is still its own with one conditional update when it writes what it will send, and again right before the create request leaves (after the queue of the rate limit), stamping `create_sent_at`: when Fakturownia answered so slowly that the lease ran out and another process took the row over, the slow attempt stops and sends nothing.
3. **Look before you write.** Before the create request, the document is looked up in Fakturownia by its order number and kind (`GET /invoices.json?oid=`), a final document made from a proforma also by `?from_invoice_id=`, and a correction by the corrections of the invoice it corrects, where it carries a marker in its private note (`internal_note`). A matching document is adopted and nothing is sent; one with another amount is a conflict for a person.
4. **One shot, never blind.** The create request is never repeated. A timeout, a 5xx or a broken answer means "unknown": the plugin looks again a few seconds later and adopts the document when it is there. Otherwise the row becomes `unknown`, and it is looked up again before anything else is sent; a "not found" counts only after a grace of two minutes plus `timeoutMs` from the moment the create request left (never from the claim, so a slow lookup cannot shorten it). On top, `oid_unique: "yes"` makes Fakturownia itself refuse a second document with the same order number (not sent on corrections and on a final document made from a proforma, which carry the order number of their original).

A request that Fakturownia refused (any 4xx, or a network error before the request left) created nothing, so it is retried with backoff for about two and a half days when it may pass (429) and fails at once when it will not (422). A row with a Fakturownia id is never sent again by any road. An `unknown` row also waits for a person in the admin: **Check in Fakturownia**, **Issue again** (after a confirmation), **Mark as issued**. Details and sources: [docs/fakturownia-api-notes.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-fakturownia/docs/fakturownia-api-notes.md).

## Corrections

With `corrections: "plan"` (default), every change of an order with an issued VAT invoice or receipt is planned:

- **Sources**: `order.return_received`, `payment.refunded`, `order-edit.confirmed`, `order.canceled`, a scan of the issued documents every 30 minutes (for events that were missed), and **Check for corrections** on the order page.
- **The plan is a difference of states**, not a replay of events: what the document says (its positions plus every correction already decided) against what the order says now (quantities after edits, minus the goods that came back from received and damaged returns, a refund beyond the returned goods spread over the positions as a price reduction, nothing at all for a canceled order). Positions are matched by SKU (or name) and tax rate. The refund that pays back a return is part of that return's correction, not a second one; a missed event is caught by the next one.
- **One open plan per document**, updated while it waits; its revision grows when the content changes. **Approve** takes the revision the person saw (a plan recomputed in the meantime is refused) and the reason printed on the correction (at most 256 characters, the KSeF limit). **Dismiss** records that no correction from the plugin is needed (made by hand, or none due); a dismissed or approved change is never planned again.
- **Issuing** happens only while the corrections writer is armed, at most ten corrections per pass. The payload is the documented one: `kind: "correction"`, `correction_reason`, `invoice_id` and `from_invoice_id` of the corrected invoice, and per changed position `kind: "correction"` with `correction_before_attributes` and `correction_after_attributes`. The buyer, the seller department and the order number are copied from the corrected invoice as Fakturownia holds it (KSeF refuses a correction that changes them). Before sending, the corrected invoice is read: when someone changed it in Fakturownia, nothing is sent and the plan says why.
- **A canceled order** gets a correction to zero, the only way to cancel an invoice in KSeF; its invoice stays "needs correction" until the correction is issued or the plan is dismissed.
- **Receipts are not corrected with a correction invoice**: a return of goods sold with a receipt is recorded in the register of returns (ewidencja zwrotów, § 3 ust. 3 of the cash register regulation, Dz.U. 2025 poz. 845, in force since July 2025), with the receipt and a return protocol signed by the seller and the buyer (or an internal note). A receipt's plan is manual: it shows the amounts for the register, and a person marks it done.
- **Claims and exchanges** mix returned and new goods: their plan is manual too.
- Corrections go to KSeF by the account's setting like VAT invoices; their KSeF status, e-mail, PDF and events work like every document.

## Payments

A document issued before the money arrived (cash on delivery, a transfer, `trigger: "order_placed"`, a VAT invoice after a proforma) is unpaid, with the payment term of `paymentTermDays`. When the payment is captured in full, the plugin reads the document, compares its amount with what was captured (two cents of tolerance) and sets `paid`. A document already paid in Fakturownia (a bank import, a person) is only recorded; a document with another amount is left alone and the row says why. A payment recorded in Fakturownia is also picked up by the status read.

## KSeF

The plugin does not send documents to KSeF itself: that is the account's setting in Fakturownia. It always sends `buyer_company`, which that setting decides by, and dates documents in Poland's time zone (a document dated before today would be treated as OFFLINE24).

KSeF is mandatory in 2026 (from 1 February for the largest taxpayers, from 1 April for the others). The automatic sending modes that send only companies leave invoices for private persons outside KSeF: decide with your accountant or tax adviser which mode your store needs.

- Every 15 minutes it reads `gov_status`, `gov_id` (the KSeF number), `gov_send_date`, `gov_error_messages`, `gov_verification_link` and, for corrections, `gov_corrected_invoice_number` of VAT invoices and corrections of the last 14 days, until they are accepted. Every change goes into the document's KSeF history.
- The document drawer shows the number, the dates, the errors KSeF reported, the verification link, the **UPO** and the **KSeF XML** (fetched by the backend from `GET /invoices/{id}/attachment?kind=gov_upo|gov`) and the history.
- **Send to KSeF again** (`GET /invoices/{id}.json?send_to_ksef=yes`) for a document never sent, a send error, a KSeF server error, an offline document or a fixed connection problem, with the KSeF writer armed, once per five minutes per document (taken atomically: two clicks send once). Not offered for `status_check_error` (the invoice may be accepted already: check Fakturownia) or `duplicate_error`.
- The status pass picks its documents in the database, never checked first and then the least recently checked, so a store with thousands of documents reads every one of them in turn; a document sent to KSeF again is read for 14 days after the resend, one deleted in Fakturownia is no longer read.
- **A correction waits until KSeF accepted the invoice it corrects**: it names that invoice's KSeF number.
- The header counts the documents accepted, processing and rejected.

![The order page widget: the document, its payment and KSeF status, and corrections](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-fakturownia/docs/admin-order-widget.png)

## E-mails and reminders

- **Automatic** (`sendByEmail`): right after issue Fakturownia e-mails the document to the buyer's address. On a KSeF account a company document waits for its KSeF number (Fakturownia refuses it before with "brak numeru KSeF"); the plugin tries again for three days. The e-mail is taken with one conditional update (`pending` to `sending`), so two processes never send it twice; one left half sent by a stopped process becomes `failed` with a note that it may have gone out.
- **From the admin** (the e-mails writer armed): **Send by e-mail** to the buyer, or to up to five other addresses (`email_to`), with the PDF attached or not (`email_pdf`).
- **Reminders**: Fakturownia's API has no reminder call and no field for the text of an e-mail, so **Send a reminder** e-mails an unpaid proforma or VAT invoice again with the account's template, at most once a day (taken atomically: two clicks send one; a refused reminder may be tried again at once). The **Unpaid documents** section lists those issued at least `reminderAfterDays` days ago. Fakturownia's own automatic payment reminders (account settings) send their own text.
- **History**: every request with who asked, when, the masked address and Fakturownia's answer, per document and in the **E-mails** section. A request without an answer may have sent the e-mail, so it is never repeated by the plugin.

## Buyer data and B2B

- `nipSources` says where the NIP is, in order (see Options). A NIP a shopper typed at checkout is input like any other: the plugin validates it as data. A Polish NIP must have ten digits and pass the checksum; an EU VAT number of another country keeps its prefix and needs the shape of that country's numbers (EL for Greece, XI for Northern Ireland); two letters followed by digits are not enough.
- **A receipt always names a consumer**: a NIP that appeared after the receipt was queued is shown as a warning on the row and never sent as `buyer_tax_no`. An invoice to a receipt (faktura do paragonu) is issued by hand in Fakturownia.
- **An invalid NIP, or a company name without a NIP, gives a consumer document** (a receipt with `receiptForConsumers`) and a warning on the row ("the NIP from order.metadata.nip fails the checksum"), never a refusal from Fakturownia. The NIP itself is not stored.
- **A company module of your store** (B2B): `{ entity: "company" }` reads the company of the order's customer with Query, its NIP and its name. A source that cannot be read is logged once and skipped; it never stops a document.
- **The seller department per sales channel**: `departmentsBySalesChannel`. **Check connection** names the department of every mapped channel.

## Customer documents in the storefront

Two store routes serve the documents of the **logged-in customer** (a customer session or bearer token, plus the publishable API key every store route needs):

- `GET /store/fakturownia/orders/:orderId/documents`: the issued documents of the order (VAT invoices, proformas, receipts, corrections) with their number, date, gross amount, payment, KSeF number and `pdfUrl`.
- `GET /store/fakturownia/documents/:id/pdf` (`?download=1` for a download): the PDF, fetched by the backend (generated in demo mode).

Ownership is the order's customer id, never the e-mail: a guest order or another customer's order answers 404. Each customer may list 30 times and download 10 PDFs a minute (per process). The plugin's `src/api/middlewares.ts` authenticates these routes; when the plugin's code is copied into an app, spread its routes into the app's middlewares.

```ts
// A storefront account page (the customer is logged in)
const res = await fetch(`${MEDUSA_URL}/store/fakturownia/orders/${orderId}/documents`, {
  credentials: "include", // the session cookie
  headers: {
    "x-publishable-api-key": PUBLISHABLE_KEY,
    // or: Authorization: `Bearer ${customerToken}`,
  },
})
const { documents } = await res.json()
// <a href={`${MEDUSA_URL}${documents[0].pdfUrl}?download=1`}>Download the invoice</a> (same credentials)
```

## Writes to Fakturownia: two switches

Every write added in 0.2.0 ships off, and carries a **Beta** badge in the admin (see "What is verified, and what is not"):

- **Corrections**: issues approved correction invoices.
- **E-mails**: sends documents and reminders from the admin.
- **KSeF sending**: asks Fakturownia to send a document to KSeF again.

The option `writers.<name>` is the hard switch: `false` turns the writer off for good and the admin cannot override it. The runtime toggle is in the admin (Writes to Fakturownia), stored in the database with who flipped it and when, apart for demo and live mode. A writer writes only when both say yes. The writes of 0.1.0 keep their own options: issuing documents, `markPaidOnCapture`, `cancelOnOrderCanceled` (proforma rejection) and `sendByEmail`.

## What is verified, and what is not

- **Measured in production** (the integration this plugin comes from): VAT invoices, proformas and the final document made from a proforma, receipts, the lookup by order number before every create, `oid_unique`, marking documents paid, rejecting a proforma, the PDF, the KSeF status read, the automatic e-mail after issue.
- **Built from the API documentation and tested against a simulated account, not yet against a real account with KSeF** (Beta in the admin): correction invoices and their approval, e-mails and reminders from the admin, "Send to KSeF again", the UPO and the KSeF XML. Try them on a Fakturownia test account (30 days free) with KSeF (DEMO) before you turn their writers on in your store: a correction is an accounting document in KSeF, undone only by another correction.
- Checklist for that test account: a correction of a returned item and a correction to zero (the payload with `correction_before_attributes` and `correction_after_attributes`, the marker in the private note, the lookup by `from_invoice_id`), a correction issued while the corrected invoice is still processing in KSeF, `send_to_ksef=yes`, the UPO and the XML downloads, an e-mail refused before the KSeF number, an invoice in EUR, a line with the `zw` rate.

## Demo mode

A simulated Fakturownia account inside the plugin, with zero outgoing requests, only when you set `demo: true` (for example `demo: process.env.FAKTUROWNIA_DEMO === "true"`). Documents are built from your real orders by the same code as live ones, so bad order data fails the same way.

- The sample documents come for the newest orders on the first visit to the admin page (it asks once with `POST /admin/fakturownia/demo/seed`) or at the next run of the issue job; GET routes never write. One of them is refused with a readable error, to show that state.
- Numbers per kind and month: "FV 12/10/2026", "PRO 3/10/2026", "PAR 7/10/2026", "KOR 1/10/2026". The simulated Fakturownia id carries the kind and the number, so the PDF of a demo document shows its number wherever it is downloaded.
- Paid: every document of a captured order, and about a third of the others.
- KSeF: a VAT invoice or a correction is "Processing" after issue and "Accepted", with a KSeF-shaped number, two to eight minutes later (the issue job moves the simulated KSeF, every two minutes). One invoice was rejected by KSeF and waits for **Send to KSeF again**; another shows a rejection and a resend in its history.
- Corrections: plans from the demo store's own returns, refunds and edits when it has any (nothing is created in Medusa); otherwise a simulated return on one invoice, marked as simulated, that can be approved and issued.
- E-mails go to a simulated mailbox; a few unpaid invoices are moved one to five weeks back for the reminders and the monthly summary; PDFs, the UPO and the KSeF XML are generated.
- The writers start off in demo mode too: turning them on shows the whole road.
- Everything is deterministic per order id and seeded once per store, so a restart does not reshuffle the demo.
- Connecting a real account later: demo rows stay apart and are never sent.

## Admin API

Every route is behind Medusa's admin authentication, and every `GET` only reads (never Fakturownia, never a write). Writes take a JSON body or the `x-koda-request` header and answer 415 otherwise.

- `GET /admin/fakturownia`: configuration summary (never the token), counters, writers, references, the last run of each kind, `demoPrepared` in demo mode. Reads the database only.
- `POST /admin/fakturownia/demo/seed`: demo mode only, the sample documents now (idempotent; 409 in live mode).
- `POST /admin/fakturownia/check`: harmless reads now (departments, categories).
- `POST /admin/fakturownia/sync` with `{ "what": "issue" | "statuses" | "payments" | "corrections" }`: run a job now (202, background).
- `POST /admin/fakturownia/writers` with `{ "writer": "corrections" | "emails" | "ksef", "on": true }`: the runtime toggle.
- `GET /admin/fakturownia/documents?filter=all|pending|issued|attention|unpaid|ksef|corrections|canceled&q=`: the documents. Exact lookups: `order_id=a,b` (up to 50), `number=` (the number as printed), `customer_id=` (the documents of a customer's newest 500 orders). A search keeps the filter.
- `GET /admin/fakturownia/documents/:id`: one document with its KSeF and e-mail history, corrections and plans.
- `POST /admin/fakturownia/documents/:id/retry`, `/issue-again`, `/check`, `/mark-issued` (`{ "number": "...", "fakturowniaId": "..." }`): what a person can do.
- `POST /admin/fakturownia/documents/:id/email` with `{ "kind": "manual" | "reminder", "to": "...", "attachPdf": true }` and `POST /admin/fakturownia/documents/:id/ksef-resend`.
- `GET /admin/fakturownia/documents/:id/pdf` and `GET /admin/fakturownia/documents/:id/ksef-file?file=upo|xml`: files fetched and streamed by the backend.
- `GET /admin/fakturownia/corrections?filter=open|approved|issued|closed|all&q=`, `POST /admin/fakturownia/corrections/:id/approve` (`{ "revision": 2, "reason": "..." }`), `/dismiss` and `/done` (`{ "note": "..." }`).
- `GET /admin/fakturownia/orders/:orderId`, `POST /admin/fakturownia/orders/:orderId/issue` and `POST /admin/fakturownia/orders/:orderId/corrections`: the order widget.
- `GET /admin/fakturownia/reminders`, `GET /admin/fakturownia/emails`, `GET /admin/fakturownia/summary`, `GET /admin/fakturownia/runs?kind=issue|payments|statuses|corrections`.
- `GET /admin/fakturownia/integration`, `/integration/summary`, `/integration/attention`: the koda.integration/1 contract, see "Works with Koda Plus hosts".

No route uses DELETE: dismissing and closing are POSTs.

## Use it from your code

```ts
import { issueFakturowniaDocumentWorkflow } from "@koda-plus/medusa-plugin-fakturownia/workflows"

const { result } = await issueFakturowniaDocumentWorkflow(container).run({
  input: { order_id: "order_01J...", force: true },
})
// result.outcomes[0].status === "issued", result.outcomes[0].number === "FV 12/10/2026"
// result.outcomes[0].adopted === true when the document was already in Fakturownia
```

Also exported: `issueFakturowniaDocumentsWorkflow` (one pass of the outbox), `markFakturowniaPaidWorkflow`, `refreshFakturowniaStatusesWorkflow`, `checkFakturowniaConnectionWorkflow`, and the plain functions behind them.

The events of 0.1.0 stay as they were, for code that listens to them (new code should listen to `fakturownia.document.issued` and `.corrected`, below):

- `fakturownia.document_issued` (not for corrections): `{ order_id, display_id, document_id, kind, fakturownia_id, number, adopted, paid, demo }`.
- `fakturownia.document_failed`: `{ order_id, display_id, document_id, kind, code, message, attempts, demo }`, when a document fails for good.
- `fakturownia.document_needs_attention`: `{ order_id, display_id, document_id, kind, status, demo }` plus `message` (an unknown result) or `number` (an invoice of a canceled order that needs a correction).

## Use it from other plugins

The contract the Koda Plus Allegro and BaseLinker plugins build on.

**Events** on the Medusa event bus, each emitted once per document, when it becomes issued (a create, an adoption after a lost answer, the reconciliation of an `unknown` row, or a person marking it issued with its Fakturownia id):

- `fakturownia.document.issued`: a VAT invoice, a proforma or a receipt.
- `fakturownia.document.corrected`: a correction invoice. A correction never emits `fakturownia.document.issued`.

Both carry the same data:

```ts
{
  id: string          // the fakturownia_document row id
  order_id: string
  kind: "vat" | "proforma" | "receipt" | "correction"
  number: string | null
  external_id: string // the Fakturownia invoice id
  demo: boolean
}
```

**The PDF**, from the module service (it reads only the options and calls Fakturownia, so any workflow or subscriber may call it):

```ts
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

type FakturowniaDocumentEvent = {
  id: string
  order_id: string
  kind: "vat" | "proforma" | "receipt" | "correction"
  number: string | null
  external_id: string
  demo: boolean
}

export default async function attachInvoice({ event: { data }, container }: SubscriberArgs<FakturowniaDocumentEvent>) {
  const fakturownia = container.resolve("fakturownia") as {
    downloadPdf(input: { externalId: string; demo: boolean }): Promise<{ filename: string; contentType: "application/pdf"; data: Buffer }>
  }
  const file = await fakturownia.downloadPdf({ externalId: data.external_id, demo: data.demo })
  // upload file.data (file.filename) wherever the order needs it
}

export const config: SubscriberConfig = { event: ["fakturownia.document.issued", "fakturownia.document.corrected"] }
```

With `demo: true` it returns a small generated PDF of the simulated document with its number, without any request. It throws a `FakturowniaApiError` (check `code`): `PDF_NOT_READY` while Fakturownia has not rendered the PDF (a new document, or a KSeF number on its way: try again in a minute), `DEMO_MODE` for a live document in demo mode, `BAD_ID`, `HTTP_404`.

## Works with Koda Plus hosts

An app that shows every Koda Plus plugin in one place (like [medusa.koda.plus](https://medusa.koda.plus/app/orders?demo=en)) reads Fakturownia through the shared contract `koda.integration/1` and never needs to know its tables:

- `GET /admin/fakturownia/integration`: the manifest (mode `live`, `demo` or `off`, whether it is configured, the writers armed, the widgets, the last issue pass).
- `GET /admin/fakturownia/integration/summary?entity=order&id=order_...` (or `ids=`, up to 50): one line per order, the worst signal speaking. Red: a document not issued, a lost answer, a KSeF rejection. Orange: a correction to approve or to handle by hand, an approved correction waiting for the corrections writer, a proforma of a canceled order still active, an e-mail that failed, a NIP to check, an unpaid document older than `reminderAfterDays`, an order whose trigger is met without a document (to issue). Blue: being issued, KSeF processing, an e-mail waiting for the KSeF number. Green: issued. The facts: `document` (priority 80, Fakturownia is the system of record of its documents: kind and number, the KSeF number or status, paid or not) and `buyer` (priority 60: company with its NIP on the invoice, or consumer, with a NIP warning), both from the plugin's rows, never from order metadata.
- `GET /admin/fakturownia/integration/summary?entity=customer&ids=cus_...`: one line per customer, the worst of their orders, with the last document and its buyer.
- `GET /admin/fakturownia/integration/attention?scope=orders`: the counters `documents_attention` (red), `ksef_problems` (red), `corrections_to_approve` (orange) and `to_issue` (orange), each the length of the list its link opens (`/fakturownia?filter=attention`, `?filter=ksef`, `?plans=open`, `?filter=pending`), with up to 20 order ids.
- The order card registers as `fakturownia.order` for the zone `order.details` (tab order 20); a host that claims the zone shows it as a tab (`embedded`: no frame or header of its own) and Medusa's own spot stays empty. Without a host nothing changes.
- The page opens on deep links: `/fakturownia?filter=attention`, `?q=1042`, `?doc=fkdoc_...` (the document drawer), `?customer=cus_...`, `?plans=open`.

## Public API

What other code may import: `@koda-plus/medusa-plugin-fakturownia/workflows` (the workflows and the plain functions behind them), `@koda-plus/medusa-plugin-fakturownia/modules/fakturownia` (the module, `FakturowniaPluginOptions`, the event names and types, `FakturowniaApiError`, `PdfDownload`) and `/admin`. The plugin has no providers. Type declarations ship with the package. Every other path is internal and may change in any release. The events and `downloadPdf` above are the contract the Allegro and BaseLinker plugins build on and keep their names and shapes.

## Security

- **The token in a header only:** `Authorization: Bearer`, never in a URL or a body, redirects not followed (a KSeF file's redirect is followed by hand, without the token unless it stays on the account host), masked in logs, stored errors, runs and the admin, which only knows whether it is set.
- **Files through the backend:** the PDF, the UPO and the KSeF XML; the admin fetches them with its own session or token, never from Fakturownia. File names are ASCII with the printed name in `filename*`, files carry `nosniff`, the KSeF files are always `application/xml` and limited to 5 MB.
- **Writes from the admin or a server only:** writes to `/admin/fakturownia/*` take a JSON body or the `x-koda-request` header and answer 415 otherwise (Medusa's session cookie is `SameSite=None` in production, so a form on another site could otherwise post with it). The plugin's admin sends both.
- **RBAC** (Medusa 2.15 and newer with the `rbac` feature flag): every admin route needs `fakturownia:read`, every write `fakturownia:update`, and approving corrections `fakturownia:approve`, e-mailing documents and reminders and sending to KSeF again `fakturownia:send`, the writers `fakturownia:manage`. The policies are defined by the plugin (`src/policies`), so roles can be given them. Older versions and stores without the flag work as before.
- **Shopper metadata is not state:** the plugin keeps its state in its own tables and reads no key of its own from order or cart metadata, so it guards none on the Store API. The NIP a shopper types at checkout (`nipSources`) is input, validated as data when the document is built.
- **No personal data at rest:** the tables keep no buyer name, address or tax ID, only "company" or "person" and a NIP warning without the number. Error texts from Fakturownia and KSeF are masked before they are stored or logged: the token, token-like values and e-mail addresses (NIPs and KSeF numbers stay readable, KSeF numbers start with the seller's NIP). The e-mail history keeps the address masked ("a***@e***.pl") and the user id of the admin who asked.
- **Storefront ownership by customer id**, never by e-mail; rate limited; a shopper reads a plain sentence when a PDF cannot be fetched, the reason goes to the server log.
- **One HTTP client:** the Fakturownia host is built in one place, from a validated subdomain, and document ids must be numbers before they reach a path.
- **Reads never write:** no `GET` route writes or calls Fakturownia (the demo data comes from the issue job or one explicit POST); network calls sit behind jobs and clicks.
- **Data processing:** the buyer's data travels to Fakturownia when a document is issued: Fakturownia processes it for the store (sign a data processing agreement, umowa powierzenia, with Fakturownia as you would for any invoicing service).

## What this plugin does not do

- It does not send documents to KSeF itself, nor authorize your company in KSeF; that is Fakturownia's setting.
- It does not correct receipts (the register of returns is kept by a person) and does not plan corrections for claims and exchanges (a manual plan says so).
- It does not send the basis of a VAT exemption (`exempt_tax_kind`) for lines with the `zw` rate, which a KSeF account requires: on such an account every document with a `zw` line is refused (HTTP 422) and waits for a person. Tell us if you sell exempt goods.
- It does not convert amounts of foreign currency documents to PLN: the law asks for the VAT amount in PLN on an invoice in another currency, and a KSeF account may refuse it. Check an invoice in EUR on a test account before you sell in other currencies.
- It does not issue an invoice to a receipt (faktura do paragonu): issue it by hand in Fakturownia.
- Its receipts are Fakturownia documents, not fiscal receipts: where the store is not exempt from the cash register, keep fiscalizing sales as before.
- It does not write a custom text into e-mails or reminders: the API has no field for it, Fakturownia's templates apply.
- It does not fiscalize receipts (printer, e-receipt); Fakturownia can do it after a receipt is created through the API.
- It does not sync products, clients or warehouse documents.
- One Fakturownia account per store.

## Alternatives

Checked in October 2026: no other Fakturownia integration for Medusa v2 is published on npm or listed on medusajs.com/integrations. What exists:

- **inFakt Invoicing** (medusajs.com/integrations): "inFakt invoices and KSeF filing", through inFakt, another Polish invoicing service. For stores that invoice in inFakt rather than in Fakturownia.
- **Invoices** (medusajs.com/integrations): "Auto-generate PDF invoices and credit notes". Its description names no invoicing service and no KSeF.
- **fakturownia-sdk** (npm): a generic Node.js client of the Fakturownia API. Which document to issue and when, exactly once, corrections, KSeF and the admin stay your code.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers the options, masking, the buyer and the NIP sources, the positions, the kind decision, the proforma conversion, the HTTP client, the lookup and matching, the outbox states and its SQL, the claims under a slow Fakturownia and two processes, the correction planner, payload and lookup, the writers, the e-mails, KSeF, the admin and storefront routes (reads never write), the monthly summary, the demo, the koda.integration/1 contract, and the flows end to end against a scripted Fakturownia account, without a network or a build. Running the tests needs Node.js 22.6+ (they load the TypeScript sources directly).

The migrations are written by hand (`create table if not exists`, `add column if not exists`), and the amounts are `numeric(14,2)` in the database while the model declares `float` (without the `raw_` columns of `bigNumber`): do not run `medusa db:generate` for this module, it would generate a change of the amount columns.

## Uninstall

1. Turn the writers off in the admin (Writes to Fakturownia), then remove the plugin from `medusa-config.ts` and the package from `package.json`.
2. The tables `fakturownia_document`, `fakturownia_correction`, `fakturownia_email`, `fakturownia_ksef_event`, `fakturownia_sync_run` and `fakturownia_setting` stay with your data. They are the record of which order got which accounting document: keep them as long as you keep your accounting records, then drop them by hand.
3. Do not run the `down` of the migrations: the one of 0.2.0 deletes every correction row from the outbox.

## Compatibility

Medusa 2.12 to 2.21 (peer range `^2.12.0`) and Node.js 20+. The release of each version runs the smoke test on a fresh Medusa 2.12.6 and 2.21.2 app: migrations, build, start and the admin pages. The admin libraries (`@medusajs/ui`, `@medusajs/icons`, `@tanstack/react-query`, `react`, `react-i18next`, `react-router-dom`) are optional peers: the plugin uses the copies of Medusa's dashboard. The RBAC policies take effect on Medusa versions that have RBAC, with its feature flag on.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. The invoicing logic comes from the Fakturownia integration we run in production for a Polish cosmetics wholesaler, next to our BaseLinker, Allegro, OLX and Subiekt nexo integrations. Need warehouse documents or a custom flow? Write to kontakt@koda.plus.

## Trademarks

Fakturownia and its logo are trademarks of their owner, used here only to identify the service this plugin connects to. This is an independent integration built on the public Fakturownia API, not affiliated with or endorsed by Fakturownia.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-fakturownia/LICENSE).

## Changelog

### 0.3.0 (unreleased)

Exactly once under a slow Fakturownia (the claim is proven right before the create request; the grace of a lost answer counts from that request); the automatic e-mail, reminders and "Send to KSeF again" taken atomically; demo mode only with `demo: true`; reads never write; writes only from the admin or a server, with RBAC policies; one definition of unpaid and honest filters; safe file names; correction invoices wait for KSeF; the koda.integration/1 contract for Koda Plus hosts with an embeddable order card; type declarations. Full list in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-fakturownia/CHANGELOG.md).

### 0.2.2 (2026-10-07)

- References: stores that start soon on Medusa can be listed with `soon: true` (a Soon badge, no link, `url` optional); the since date is no longer shown, and an old `since` in the options is ignored.

### 0.2.1 (2026-10-06)

- README: screenshots of the admin page and of the order widget, and the link to the live demo. No code changes.

### 0.2.0 (2026-10-06)

- Contract for other plugins: the events `fakturownia.document.issued` and `fakturownia.document.corrected` (`{ id, order_id, kind, number, external_id, demo }`, once per document, also after a reconciliation), and `downloadPdf({ externalId, demo })` on the module service, with a generated PDF in demo mode.
- Corrections: plans from returns, refunds, order edits and cancellations (a difference of states, matched by SKU and rate), one open plan per document with revisions, approval of the revision seen, the documented correction payload with before and after, exactly once (business key, marker in the private note, lookup by the corrected invoice), the corrected invoice checked before sending, manual plans for receipts, claims and exchanges, a scan job every 30 minutes, option `corrections`.
- Writers: corrections, e-mails and KSeF re-sending ship off, with the hard switch `writers.<name>` and a runtime toggle that records who flipped it.
- E-mail: send from the admin to the buyer or other addresses with the PDF (`email_to`, `email_pdf`), payment reminders for unpaid proformas and VAT invoices older than `reminderAfterDays`, a history per document with masked addresses, option `emailPdf`.
- KSeF: send date, error messages, verification link, corrected KSeF number, the UPO and the KSeF XML through the backend, a history per document, "Send to KSeF again", counters of accepted, processing and rejected documents.
- Storefront: the documents of the logged-in customer's order and their PDF, ownership by customer id, rate limited.
- B2B: `nipSources` (metadata keys, the billing address, a NIP in the company name, a company module), the NIP checksum, a consumer document with a warning instead of a refusal, `departmentsBySalesChannel`.
- Monthly summary of documents, value, unpaid amount and KSeF share.
- Admin: Panel and Setup guide, references ("Running in production", option `references`), writers, corrections, document drawer, unpaid documents, e-mails, summary; the order widget with corrections.
- Demo mode simulates all of it.

### 0.1.0 (2026-10-05)

First release in the repository (never published on npm; the first npm release is 0.2.0), generalized from the Fakturownia integration Koda Plus runs in production for a Polish cosmetics wholesaler: documents exactly once, proforma then VAT, receipts for consumers, payments, KSeF status, e-mail after issue, canceled orders, the admin page and the order widget, demo mode. Full list in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-fakturownia/CHANGELOG.md).
