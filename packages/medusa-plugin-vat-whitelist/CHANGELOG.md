# Changelog

## 0.1.0 (unreleased)

### Added

- The first release: Polish NIPs verified against the Ministry of Finance whitelist and EU VAT numbers against VIES, with the VAT status, the name, the address and the bank accounts for split payment.
- One page in the admin with the check form, the counterparties and the check history, in English and Polish; a re-check refreshes a counterparty.
- Demo mode with simulated registry answers, flagged `demo`; stale answers are marked after `staleHours`.
- A store API for the logged-in customer: their own counterparty status and a fresh check of their company NIP.
- The koda.integration/1 contract with one line per customer whose company was checked and the board counter of counterparties to verify.
