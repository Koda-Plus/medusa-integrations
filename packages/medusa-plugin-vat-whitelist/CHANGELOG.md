# Changelog

## 0.2.0 (2026-11-04)

### Added

- The GUS Business Registry as a full registry: a BIR 1.1 client with WS-Addressing and MTOM parsing, the legal person and natural person reports (company name, address, REGON, KRS, legal form, start date) and whether the business runs, is suspended or has ended. The session is reused and logs in again when GUS ends it; every call has a timeout.
- A new state, `inactive`: GUS says the business is suspended or has ended, whatever the whitelist says.
- `plRegistries` (default `["gus", "whitelist"]`): the registries of a Polish NIP, in order. GUS gives the company card, the whitelist the VAT status and the bank accounts; `vies` adds the VAT-UE registration for sales within the EU. A number typed with the PL prefix asks VIES too.
- `gusEnvironment` (`production` or `test`, the GUS test environment with its public key) and `timeoutMs`.
- `live`: in demo mode, the named registries answer for real for every number outside the demo samples, so a public demo can show real company data. Seeded demo counterparties stay simulated on a re-check.
- Settings / Registries: how each registry answers (live, simulated, no key, not used), the GUS key and environment, and a connection test per registry (`POST /admin/whitelist/registries/test`; GUS logs in and out without spending a lookup).
- The check card shows what each registry answered, the business state and the start date; the history shows one row per registry.
- The setup guide has a GUS step (how to get the free key) and an EU step.
- The registration preview takes `{ vat_number, country_code }` as well as `{ nip }`, adds the country prefix to a number typed without it, checks EU numbers in VIES and caches answers for ten minutes.

### Changed

- Only the VIES member states pass as EU VAT numbers (EL for Greece, GR is read as EL); a VIES answer with a member state down reads unavailable.
- A VIES answer has the status `VAT-UE` instead of `Czynny`.
- A registry that does not answer never wipes the company data an earlier check knew.
- A busy VIES member state (`MS_MAX_CONCURRENT_REQ` and the like) is asked once more after a pause; the preview never caches an answer with a registry that did not answer.
- `POST /admin/whitelist/check` answers 400 for a number that does not validate and saves nothing (it used to keep an `invalid` counterparty).

## 0.1.1 (2026-10-18)

- The panel has a setup guide.
- README screenshots.
- Shared kit 1.0.9: white label support (a store can hide the Koda Plus byline, prompt, community links and references), the order products cell (thumbnails, a dialog with the order lines, products of carts without an order) and the amount breakdown component are available to the admin pages, and loaders, skeleton rows and the guide got small fixes.

## 0.1.0 (2026-10-08)

### Added

- The first release: Polish NIPs verified against the Ministry of Finance whitelist and EU VAT numbers against VIES, with the VAT status, the name, the address and the bank accounts for split payment.
- The GUS Business Registry check next to the whitelist: the REGON number and the legal form (a free BIR 1.1 API key in real mode, simulated answers in demo mode).
- One page in the admin with the check form and the full company card of the answer, the counterparties and the check history, in English and Polish; a re-check refreshes a counterparty.
- A public, rate limited preview route that fills the registration form from the NIP, and the customer's own status and re-check in the storefront.
- Demo mode with a simulated registry: a known company answers with its real public data, every other valid NIP with a deterministic company card, flagged `demo`; stale answers are marked after `staleHours`.
- The koda.integration/1 contract with one line per customer whose company was checked and the board counter of counterparties to verify.
