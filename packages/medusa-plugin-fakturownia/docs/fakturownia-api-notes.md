# Fakturownia API: what this plugin relies on, and where it is documented

Checked on 2026-10-05 against:

- the official API repository, https://github.com/fakturownia/API (README.md and KSeF.md, last change 2026-09-07);
- the official examples page linked from that README, https://app.fakturownia.pl/api;
- the official e-receipt API of the same vendor, https://github.com/e-paragony/api (README.md), which calls the Fakturownia API;
- the help of InvoiceOcean, the same platform under its international name, https://invoiceocean-help.sugester.com/479474-Changing-the-format-of-invoice-numbering.

Points marked "measured" come from the production Fakturownia integration Koda Plus runs for a Polish cosmetics wholesaler; they are not in the documentation.

## Authentication

- Documented three ways: `api_token` in the query string (GET examples), `"api_token"` in the JSON body (POST and PUT examples), and the header `Authorization: Bearer API_TOKEN` (app.fakturownia.pl/api, XML examples; e-paragony README, JSON examples for `GET /invoices.json`, `POST /invoices.json` and `send_by_email`).
- The plugin sends the header only. The token is never in a URL or a body, and redirects are not followed.

## Documents

- Create: `POST /invoices.json` with `{"invoice": {...}}`; the examples treat HTTP 201 as success and the answer is the document (with `id` and `number`). `number: null` or no number: the account numbering assigns one.
- Read: `GET /invoices/{id}.json`; `fields[invoice]=a,b,c` limits the answer (KSeF.md, "Sprawdzanie statusu wysyłki").
- Update: `PUT /invoices/{id}.json` with the fields to change (partial). Measured: `{"invoice": {"paid": "143.00"}}` marks a document paid, also a proforma, while `status: "paid"` is refused on a proforma with HTTP 422.
- Status: `POST /invoices/{id}/change_status.json?status=STATUS`, statuses `issued`, `sent`, `paid`, `partial`, `rejected`. Measured: `rejected` works on a proforma even when it is the last document of its numbering, where `POST /invoices/cancel.json` is refused.
- E-mail: `POST /invoices/{id}/send_by_email.json` sends to the document's `buyer_email` (optional `email_to`, `email_cc`, `email_pdf`). With KSeF active, a company document can be e-mailed only after its KSeF number; the refusal is HTTP 200 with `{"status": "error", "message": "Faktura nie może zostać wysłana - brak numeru KSeF"}` (KSeF.md, "Wysyłanie faktur emailem do klientów").
- PDF: `GET /invoices/{id}.pdf`. Measured: a fresh document can answer 422 for a few seconds, and a KSeF account shows an HTML page instead of the VAT invoice PDF until the KSeF number arrives. The public `token` links (`/invoice/{token}.pdf`) open a document without login and are not used.
- Proforma to VAT: `from_invoice_id` is "id faktury na podstawie której faktura została wygenerowana". Measured: it only links the documents and copies nothing (a payload of `kind` and `from_invoice_id` alone is refused with 422), so the plugin copies the proforma's positions and buyer, including `buyer_company`, `buyer_first_name` and `buyer_last_name`. The documented `copy_invoice_from` would copy the whole proforma, its dates included, and is not used.

## Order number, lookups and exactly once

- `oid`: "numer zamówienia (np z zewnętrznego systemu zamówień)", printed on the document.
- `oid_unique: "yes"`: "system nie pozwoli stworzyc 2 faktur o takim samym OID". Whether the rule is per kind or per account is not documented, so it is left out for a final document made from a proforma (both carry the order number), and it is never the only lock.
- Lookup by order number: `GET /invoices.json?oid=nr_zam` ("Pobranie faktury po Id zamówienia", app.fakturownia.pl/api); README section "Kompatybilność wsteczna, pole oid": "zapis, odczyt i wyszukiwanie faktur po oid działają jak dotychczas". Whether the filter is exact is not documented, so the plugin matches the order number and the kind exactly on its side and reads page after page with a ceiling.
- Lookup of documents made from a proforma: `GET /invoices.json?from_invoice_id=id` (app.fakturownia.pl/api).
- List parameters used: `page`, `per_page` (100 at most), `period=more` with `date_from` and `date_to` (or `period=all`), `kind`.

## Fields of a document

- `kind`: `vat`, `proforma`, `bill`, `receipt`, `advance`, `final`, `correction`, `invoice_other`, `vat_margin`, `kp`, `kw`, `estimate`, `vat_mp`, `vat_rr`, `correction_note`, `accounting_note`, `client_order`, `dw`, `wnt`, `wdt`, `import_service`, `import_service_eu`, `import_products`, `export_products`. A receipt is `receipt` (also in the e-paragony README); `receiptKind` can change it.
- `lang`: `pl`, `en`, `en-GB`, `de`, `fr`, `cz`, `ru`, `es`, `it`, `nl`, `hr`, `ar`, `sk`, `sl`, `el`, `et`, `cn`, `hu`, `tr`, `fa`, or two joined by a slash for a bilingual document (`pl/en`).
- `department_id`: the seller company or department; without it (and without `seller_name`) the main company of the account.
- `category_id`, `place`. Measured: `place` is not taken from the account settings through the API.
- Buyer: `buyer_name`, `buyer_company` ("czy klient jest firmą"), `buyer_first_name`, `buyer_last_name`, `buyer_tax_no`, `buyer_tax_no_kind` (set to `nip_ue` by Fakturownia for a tax number with another EU country prefix), `buyer_email`, `buyer_street`, `buyer_post_code`, `buyer_city`, `buyer_country`. KSeF.md: always send `buyer_company`, it decides the automatic sending to KSeF. Measured: without it the buyer is created as a company.
- Positions: `name`, `code`, `quantity`, `quantity_unit`, `total_price_gross`, `tax` (a rate, or `zw`, `np`), optionally `price_gross`, `discount_percent`, `discount`. Measured: `total_price_gross` is required (422 without it).
- Discounts: `discount_kind` is `percent_unit`, `percent_unit_gross`, `percent_total` or `amount`; per the README a position discount is computed only with `show_discount` set, and app.fakturownia.pl/api shows it together with `discount_kind: "percent_unit"`. Measured: without both, `discount_percent` is silently dropped. The plugin sends discounts inside the gross totals and adds these two fields only when it copies positions that carry a discount.
- Payment: `payment_type` (`transfer`, `card`, `cash`, `cash_on_delivery`, `payu`, `paypal`, `off`, or free text), `payment_to_kind` (a number of days, `off`, `other_date` with `payment_to`, or `description`), `paid` (the amount paid), `status`.
- Errors: HTTP 422 with `{"code": "error", "message": {"field": ["- message"]}}` (KSeF.md).

## KSeF

- Fields: `gov_status`, `gov_id` (the KSeF number), `gov_error_messages`, `gov_send_date`, `gov_verification_link`.
- `gov_status`: `ok`, `processing`, `send_error`, `server_error`, `status_check_error`, `offline`, `offline_error`, `duplicate_error`, `blocked_403_error`, `not_applicable`, `not_connected`, `null`; the KSeF test environment reports the same values with a `demo_` prefix.
- Sent to KSeF: `vat`, `correction`, `vat_mp`, `vat_margin`, `wdt`, `export_products`, `advance`, `final`. Proformas and receipts get `not_applicable`.
- `gov_save_and_send` and `send_to_ksef` exist; the plugin leaves sending to the account's automatic setting.
- A document dated before today is treated as OFFLINE24, so the plugin dates documents in Poland's time zone (Europe/Warsaw), not in UTC.

## Other

- Harmless reads for "Check connection": `GET /departments.json`, `GET /categories.json`.
- Rate limits: not documented in any of the sources above. The plugin limits itself to 60 requests per minute by default (`requestsPerMinute`).
- Numbering: not part of the API documentation. InvoiceOcean help lists the format variables `nr`, `nr-m`, `nr-d`, `yyyy`, `yy`, `mm`, `dd` with examples like "1/01/2011", and documents of a production account look like "52/08/2026" (number within the month, month, year). The demo adds a prefix per kind ("FV 12/10/2026", "PRO 3/10/2026", "PAR 7/10/2026") so the kinds read at a glance; a real account returns whatever format it is set to.
- The brand mark in `brand-source/` was fetched from the head and the header of https://fakturownia.pl on 2026-10-05: `fakturownia-logo.svg` (https://fs.siteor.com/radgost/files/marketing-2023/img/fakturownia-logo.svg), `favicon-160x160.png` and `apple-touch-icon-152x152.png` (https://fs.siteor.com/radgost/files/marketing-2023/favicon/).
