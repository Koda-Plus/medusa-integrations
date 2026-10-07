# Changelog

## 0.1.0 (2026-10-07)

First public release: Stripe in the Medusa admin, next to Medusa's official Stripe provider, read only, for Polish stores.

### Panel

- Volume, Stripe fees and net for the last 7 or 30 days, the success rate (declined attempts against succeeded ones), refunds and open disputes, as integer sums per currency; fees and net from the balance transactions, in the currency Stripe settles in.
- Payment methods split the way a Polish store sees them: card, BLIK, Przelewy24, Apple Pay, Google Pay, Link, other, each with payments, share, volume, fees, net, declined attempts and success rate.
- Payments of the last 30 days with filters (succeeded, declined, need a look, refunded, disputed, not from Medusa), methods and search by payment id, order number, card ending or Przelewy24 reference; each with its method details, status, decline message, Radar risk, fee and net, a link to its Medusa order (through the payment session id the official provider puts in every PaymentIntent) and to the Stripe Dashboard.
- Open disputes with their evidence deadline, days left and urgency; recent refunds; the balance (available and pending) and payouts (on the way and paid).

### Health checks

- Ten checks with a verdict and a fix each: the Stripe provider registered in Medusa (`pp_stripe_<id>` with BLIK and Przelewy24), the plugin's key (restricted or secret, live or test, matching the store's payments), the account (country, settlement currency, charges, payouts, requirements), the payment methods (`card_payments`, `blik_payments`, `p24_payments`, on at checkout), the webhook endpoint at this backend's `/hooks/payment/stripe_<id>` with the events Medusa needs, failed webhook deliveries in 24 hours, the Apple Pay and Google Pay domains, the PLN regions offering BLIK and Przelewy24, the capture mode BLIK and Przelewy24 need, and payments that succeeded without an order.
- Option `checks` turns a check, and its read, off.

### Order widget

- The PaymentIntent behind the order's payment: status, method (BLIK, the Przelewy24 bank, the card brand and last four digits, the wallet), amount, Stripe fee and net from the balance transaction, exchange rate, Radar risk, refunds, a dispute with its deadline, and the Dashboard link (test or live). Says why when a payment cannot be read (another account or mode, a missing permission, no key yet).

### Reading Stripe

- One HTTP client, GET only, plain `fetch` without the Stripe SDK, API version `2024-04-10` pinned (the one the official provider uses), Stripe's form encoding, pages of 100 up to `maxPages`.
- Reads only when someone opens the page or the order widget, never in the background; every read cached for `cacheSeconds` (5 minutes by default), one read at a time per key, a forced refresh at most every 30 seconds, failed reads kept for a minute. A self-imposed rate limit (`requestsPerSecond`) and retries after 429, 5xx and dropped connections, honouring `Retry-After` and `Stripe-Should-Retry`.
- A part of the read that fails leaves its section empty with the reason and the restricted key permission Stripe asked for.
- A missing or wrong key never breaks the boot: the page shows the setup.

### Admin

- Panel, Setup guide (a Polish store from a new Stripe account to production, each step with its state from the checks, the go-live checklist, troubleshooting) and Settings (the options in use, the checks with what each one reads, the access a restricted key needs).
- The Koda Plus header: mode and read only badges, the stores running the integration (`references`), "Add your store", "Copy prompt" and help on Discord. English and Polish.
- Demo mode (`demo: true`): a sample Stripe account built from the store's own orders, with zero requests to Stripe, through the same parsers, sums and checks as live data.
