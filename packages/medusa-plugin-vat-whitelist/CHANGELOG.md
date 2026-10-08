# Changelog

## 0.1.0 (2026-10-08)

### Added

- The first release: Polish NIPs verified against the Ministry of Finance whitelist and EU VAT numbers against VIES, with the VAT status, the name, the address and the bank accounts for split payment.
- The GUS Business Registry check next to the whitelist: the REGON number and the legal form (a free BIR 1.1 API key in real mode, simulated answers in demo mode).
- One page in the admin with the check form and the full company card of the answer, the counterparties and the check history, in English and Polish; a re-check refreshes a counterparty.
- A public, rate limited preview route that fills the registration form from the NIP, and the customer's own status and re-check in the storefront.
- Demo mode with a simulated registry: a known company answers with its real public data, every other valid NIP with a deterministic company card, flagged `demo`; stale answers are marked after `staleHours`.
- The koda.integration/1 contract with one line per customer whose company was checked and the board counter of counterparties to verify.
