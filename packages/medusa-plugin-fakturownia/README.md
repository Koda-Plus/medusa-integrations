# Fakturownia by Koda Plus

Issue Polish **VAT invoices, proformas and receipts in Fakturownia** (fakturownia.pl) for your Medusa orders, exactly once. The document is created when the payment is captured (or when the order is placed), the payment status and the KSeF number come back, and the PDF opens from the order page without the API token ever reaching the browser.

Nothing about the buyer is stored in Medusa: the plugin keeps the document kind, number, amounts, positions and statuses, and builds the buyer data from the order at the moment it sends it.

## What it does

- **Documents** (VAT invoice, proforma, receipt): Medusa to Fakturownia, at the trigger you choose (`payment_captured` by default, or `order_placed`), retried with backoff, with a pass every 2 minutes.
- **Proforma first, VAT later** (optional): a proforma at the trigger and the VAT invoice after the first fulfillment, made from the proforma and linked to it.
- **Receipts for consumers** (optional): buyers without a tax ID get a receipt instead of a VAT invoice.
- **Payment**: a document issued unpaid becomes paid in Fakturownia when the payment is captured in Medusa, after an amount check, every 10 minutes and right after the capture.
- **KSeF status** (read only): processing, accepted with the KSeF number, or the problem Fakturownia reports, every 15 minutes.
- **E-mail** (optional): Fakturownia e-mails the document to the buyer; a company document waits for its KSeF number.
- **Canceled orders**: a proforma is rejected in Fakturownia, a VAT invoice or a receipt is flagged for a correction by a person. Accounting documents are never changed automatically.

## Features

- **Exactly once**, with four locks: unique rows per order and kind in the database, an atomic claim, a lookup in Fakturownia before every create, and a create request that is never repeated blindly. See below.
- **Company or person**: a tax ID (NIP) makes the buyer a company (`buyer_company: true`, the company name, the NIP); without one the buyer is a person (first and last name, `buyer_company: false`), which also decides how KSeF treats the document.
- **Positions from Medusa totals**: one per line item ("Product, variant", SKU, quantity, gross total after discounts, the tax rate of the line's tax lines) and one per shipping method, also at 0.00.
- **Admin page** with the connection check, counters, the documents with filters and search, the actions a person needs (Retry, Check in Fakturownia, Issue again, Mark as issued) and the history of background runs.
- **Order widget** with the documents of the order, the payment, the KSeF status, the PDF and "Issue now".
- **Demo mode**: a simulated Fakturownia account inside the plugin. Nothing leaves Medusa.
- **Admin in English and Polish.**
- **Workflows included** for your own code, and events on the Medusa event bus.

## Requirements

- Medusa 2.12 or newer (tested on 2.15.3) and Node.js 20+.
- For a real account: a Fakturownia API token (Ustawienia, Ustawienia konta, Integracja, Kod autoryzacyjny API) and the account name (the subdomain of your Fakturownia address).

## Installation

```bash
npm install @koda-plus/medusa-plugin-fakturownia
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-fakturownia` or `pnpm add @koda-plus/medusa-plugin-fakturownia`.

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
        // documentFlow: "proforma_then_vat",
        // receiptForConsumers: true,
      },
    },
  ],
})
```

Run the migrations, then open **Fakturownia** in the admin sidebar and click **Check connection**: it reads the companies of the account (nothing is created) and tells you whether `departmentId` and `categoryId` exist.

```bash
npx medusa db:migrate
```

Without `apiToken` the plugin runs in demo mode. With `demo: false` and no token it registers, the admin says "Not configured" and nothing is issued. Missing options never break the boot.

### Options

- `apiToken`: the Fakturownia API token. Sent only in the `Authorization` header, masked in every log, error and admin screen.
- `account`: the account subdomain, like `mojafirma` (the full address works too). It becomes part of the host name, so anything that is not a valid subdomain is refused.
- `demo` (default: on when `apiToken` is missing): the simulated account.
- `documentFlow` (default `vat`): `vat` issues the final document at the trigger; `proforma_then_vat` issues a proforma at the trigger and the final document after the first fulfillment, linked with `from_invoice_id`.
- `trigger` (default `payment_captured`): `payment_captured` (the order captured in full) or `order_placed`.
- `receiptForConsumers` (default `false`): buyers without a tax ID get a receipt instead of a VAT invoice.
- `receiptKind` (default `receipt`): the API `kind` of a receipt.
- `defaultVatRate` (default `23`): the rate of a line without Medusa tax lines. `zw` and `np` work too.
- `lang` (default `pl`): the document language, like `en` or `pl/en` for a bilingual document.
- `issuePlace`: the place of issue printed on the document (the API does not take it from the account settings).
- `departmentId`: the seller department (Ustawienia, Dane firmy). Default: the main company of the account.
- `categoryId`: the income category of the documents.
- `shippingPositionName` (default `Dostawa`): the name of a shipping position when the shipping method has none.
- `quantityUnit` (default `szt.`): the unit of every position.
- `paymentTypes` (default: `transfer` for everything): the Fakturownia `payment_type` by payment provider id prefix, like `{ pp_stripe: "card", pp_payu: "payu" }`.
- `codProviders` (default `pp_cod`, `pp_cash`): payment provider id prefixes meaning cash on delivery (`cash_on_delivery`).
- `paymentTermDays` (default `7`): the payment term of documents issued unpaid.
- `markPaidOnCapture` (default `true`): when a payment is captured for a document issued unpaid, set it paid in Fakturownia.
- `sendByEmail` (default `false`): after issuing, Fakturownia e-mails the document to the buyer.
- `cancelOnOrderCanceled` (default `true`): a canceled order rejects its proforma; a VAT invoice or a receipt is flagged "needs correction" for a person.
- `taxIdMetadataKeys` (default `nip`, `tax_id`, `invoice_nip`): where the buyer's tax ID is looked for, in the order metadata and then in the billing address metadata.
- `oidPrefix` (default none): a prefix for the order number sent to Fakturownia, for accounts that already hold documents numbered like Medusa orders (an earlier shop).
- `requestsPerMinute` (default `60`): self-imposed rate limit (Fakturownia documents none).
- `timeoutMs` (default `30000`): one request.

## Which document, and when

Every event of an order (placed, payment captured, fulfillment created) asks the same question, so the order of the events does not matter and a missed event is caught by the next one:

- `documentFlow: "vat"`: when the trigger is met, the final document.
- `documentFlow: "proforma_then_vat"`: when the trigger is met, a proforma; after the first fulfillment, the final document. An order fulfilled before the trigger goes straight to the final document.
- The final document is a VAT invoice for a company, and for a person too unless `receiptForConsumers` is on (then a receipt).
- **Issue now** on the order page issues the document of the trigger without waiting for it.
- Cash on delivery orders are captured late in Medusa, or never: with the default trigger their document waits for the capture. Stores with cash on delivery usually choose `trigger: "order_placed"` or the proforma flow.

The final document after a proforma is made from the proforma as Fakturownia holds it: every position, the whole buyer including its type (company or person), the order number and the payment. `from_invoice_id` links the two documents ("Wykorzystana w fakturze...").

## Exactly once

A duplicate VAT invoice on a KSeF account can only be undone with a correction invoice, so the plugin is built around never creating one:

1. **One row per order and kind.** Subscribers only insert a pending row into `fakturownia_document`. A unique index on (order id, kind, mode) makes the database refuse a second document of the same kind for one order, and a partial unique index allows only one final document (VAT invoice or receipt) per order. A racing insert is ignored. The demo mode keeps its rows apart, so a store that evaluated the demo starts clean.
2. **One sender per row.** The job claims a row with one atomic `UPDATE ... SET status = 'issuing' ... WHERE id = ? AND status = 'pending' RETURNING *`, with a claim token and a ten minute lease. Two processes cannot both win a row, and the result is written only by the claim's owner.
3. **Look before you write.** Before the create request, the document is looked up in Fakturownia by its order number and kind (`GET /invoices.json?oid=`, documented as "Pobranie faktury po Id zamówienia"), and a final document made from a proforma also by `GET /invoices.json?from_invoice_id=`. A matching document (same number, kind and amount) is adopted and nothing is sent. One with the same number but another amount is a conflict: never adopted, never duplicated, a person decides.
4. **One shot, never blind.** The create request is never repeated. A timeout, a 5xx or a broken answer means "unknown": the plugin looks again a few seconds later and adopts the document when it is there. Otherwise the row becomes `unknown`, and it is looked up again after a two minute grace period before anything else is sent: found means adopted, certainly absent means queued again (and that attempt looks first too). On top, `oid_unique: "yes"` makes Fakturownia itself refuse a second document with the same order number.

A request that Fakturownia refused (any 4xx, or a network error before the request left) created nothing, so it is retried with backoff for about two and a half days when it may pass (429) and fails at once when it will not (422). A row with a Fakturownia id is never sent again by any road. An `unknown` row also waits for a person in the admin: **Check in Fakturownia** runs the lookup now, **Issue again** queues it (after a confirmation), **Mark as issued** records the number a person found (with the Fakturownia id the document is read and the number must match).

Why the order number and not a marker: the order number (`oid`) is a documented field with a documented lookup, it is printed on the document anyway, and `oid_unique` is enforced by Fakturownia. Whether Fakturownia checks `oid_unique` per kind or per account is not documented, so it is left out for a final document made from a proforma (both carry the same order number), where the `from_invoice_id` lookup covers it. Details and sources: [docs/fakturownia-api-notes.md](docs/fakturownia-api-notes.md).

## Payments

A document issued before the money arrived (cash on delivery, a transfer, `trigger: "order_placed"`, a VAT invoice after a proforma) is unpaid, with the payment term of `paymentTermDays`. When the payment is captured in full, the plugin reads the document, compares its amount with what was captured (two cents of tolerance) and sets `paid`. A document already paid in Fakturownia (a bank import, a person) is only recorded; a document with another amount is left alone and the row says why. A payment recorded in Fakturownia is also picked up by the status read.

## KSeF

The plugin does not send documents to KSeF itself: that is the account's setting in Fakturownia (automatic sending for companies, or for everybody). It always sends `buyer_company`, which that setting decides by, dates documents in Poland's time zone (a document dated before today would be treated as OFFLINE24), and reads `gov_status`, the KSeF number and the error messages of VAT invoices of the last 14 days until they are accepted. Proformas and receipts are not sent to KSeF.

## Demo mode

A simulated Fakturownia account inside the plugin, with zero outgoing requests. Documents are built from your real orders by the same code as live ones, so bad order data fails the same way.

- The first visit to the admin page issues documents for the newest orders, and one of them is refused with a readable error, to show that state.
- Numbers per kind and month: "FV 12/10/2026", "PRO 3/10/2026", "PAR 7/10/2026".
- Paid: every document of a captured order, and about a third of the others.
- KSeF: a VAT invoice is "Processing" after issue and "Accepted", with a KSeF-shaped number, two to eight minutes later.
- Everything is deterministic per order id, so a restart does not reshuffle the demo. There are no PDFs.
- New orders follow the configured trigger, like live ones (with the default trigger: when their payment is captured), or **Issue now**.
- Connecting a real account later: demo rows stay apart and are never sent. Orders that got only a demo document are not issued again automatically; use **Issue now** for the ones that need a real document.

## Admin API

- `GET /admin/fakturownia`: configuration summary (never the token), counters, the last run of each kind. Reads the database only.
- `POST /admin/fakturownia/check`: harmless reads now (departments, categories).
- `POST /admin/fakturownia/sync` with `{ "what": "issue" | "statuses" | "payments" }`: run a job now (202, background).
- `GET /admin/fakturownia/documents?filter=all|pending|issued|attention|unpaid|ksef|canceled&q=`: the documents.
- `POST /admin/fakturownia/documents/:id/retry`, `/issue-again`, `/check`, `/mark-issued` (`{ "number": "...", "fakturowniaId": "..." }`): what a person can do.
- `GET /admin/fakturownia/documents/:id/pdf`: the PDF, fetched and streamed by the backend.
- `GET /admin/fakturownia/orders/:orderId` and `POST /admin/fakturownia/orders/:orderId/issue`: the order widget.
- `GET /admin/fakturownia/runs?kind=issue|payments|statuses`: the history.

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

Events on the Medusa event bus:

- `fakturownia.document_issued`: `{ order_id, display_id, document_id, kind, fakturownia_id, number, adopted, paid, demo }`
- `fakturownia.document_failed`: `{ order_id, display_id, document_id, kind, code, message, attempts, demo }`
- `fakturownia.document_needs_attention`: `{ order_id, display_id, document_id, kind, status, demo }` for an unknown result or a document that needs a correction

## Security

- **The token in a header only:** `Authorization: Bearer`, never in a URL or a body, redirects not followed, masked in logs, stored errors, runs and the admin.
- **The PDF through the backend:** the browser talks to a plugin route with the admin session, never to Fakturownia.
- **No personal data at rest:** the tables keep no buyer name, address, e-mail or tax ID, only "company" or "person".
- **One HTTP client:** the Fakturownia host is built in one place, from a validated subdomain, and document ids must be numbers before they reach a path.
- **Reads only while rendering:** the admin never calls Fakturownia to draw a page; network calls sit behind jobs and clicks.

## What this plugin does not do

- It does not issue corrections, cancel or delete accounting documents: a canceled order's VAT invoice or receipt is flagged for a person.
- It does not send documents to KSeF itself; that is the account's setting.
- It does not fiscalize receipts (printer, e-receipt); Fakturownia can do it automatically after a receipt is created through the API.
- It does not sync products, clients or warehouse documents.
- One Fakturownia account per store.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers the options, masking, the buyer and the positions, the kind decision, the proforma conversion, the HTTP client, the lookup and matching, the outbox states and its SQL, the demo, the status mapping, and the flows end to end against a scripted Fakturownia account, without a network or a build.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. The invoicing logic comes from the Fakturownia integration we run in production for a Polish cosmetics wholesaler, next to our BaseLinker, Allegro, OLX and Subiekt nexo integrations. Need corrections, warehouse documents or a custom flow? Write to kontakt@koda.plus.

## Trademarks

Fakturownia and its logo are trademarks of their owner, used here only to identify the service this plugin connects to. This is an independent integration built on the public Fakturownia API, not affiliated with or endorsed by Fakturownia.

## License

MIT, see [LICENSE](./LICENSE).
