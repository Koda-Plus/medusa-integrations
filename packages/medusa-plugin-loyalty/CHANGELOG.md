# Changelog

## 0.1.0 (2026-10-08)

### Added

- The first release: points for every placed order (total times `pointsPerPln`, scaled by the tier multiplier), a reward ladder, redemption at `redeemRate` and manual adjustments.
- One page in the admin with the points accounts, the reward ladder, a manual adjustment with a customer search and the latest transactions, in English and Polish.
- The tables keep the names of the original app module (`loyalty_account`, `loyalty_transaction`), so the rows carry over; the migration only adds the `demo` flag.
- A store API with the same response shape the storefront already reads, plus the reward ladder and the redemption route.
- The koda.integration/1 contract with one line per customer with points and the board counter of customers ready for a reward, and demo mode with flagged rows.
