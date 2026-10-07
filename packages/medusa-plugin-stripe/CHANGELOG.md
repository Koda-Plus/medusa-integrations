# Changelog

## 0.2.0 (2026-10-07)

First npm release. 0.1.0 was never published: it ran only as vendored code on medusa.koda.plus.

### Fixed

- Admin pages work when the plugin is installed from npm: the admin libraries are optional peers, so the app keeps the copies of Medusa's dashboard instead of a second, newer copy.
- Demo mode pays only orders Stripe would have paid: a Stripe provider among the order's Medusa payments (or, before a payment, its sessions). Marketplace imports marked paid, cash on delivery, other gateways, orders without a total and orders below Stripe's minimum charge get no sample payment, and order metadata is never read. BLIK and Przelewy24 follow the order's own provider. New option `demoOrders` (`stripe`, the default, or `stripe-or-none` for a demo store seeded without a checkout).
- An order's sample payment is dated a few minutes before the order on the order page, also when the panel moves an older order into its 30 days; its refunds and dispute stay with it.
- Paid without an order counts only payment sessions of this Medusa. A payment of another Medusa on the same Stripe account is information (filter "Another Medusa", grey in the list), a session Medusa replaced when the customer changed the method never counts, and the advice is to check, never to refund.
- "Need a look", the paid without an order check and the board counter use one rule: paid by this store's checkout without an order (30 minutes to 7 days old), or the newest refund failed.
- The PLN settlement, BLIK, Przelewy24 and capture mode checks judge only stores that sell in PLN (a region in PLN or PLN payments).
- Failed webhook deliveries are the account's: a lost `payment_intent.succeeded` fails the check only when this Medusa's endpoint is the one endpoint listening to it.
- Dispute deadlines are counted at every answer, not frozen in the cache.
- The order widget reads Stripe again after a capture or a refund in Medusa, and on Read again (at most every 30 seconds). When Stripe does not answer, it shows the last good read, marked stale.
- The order widget's cache keeps the normalized payment only: no client secret, billing details or dispute evidence in memory.
- The cache keeps the order widgets apart from the snapshot and the checks, so browsing orders never pushes them out, and drops entries long past their time.
- A whole read has a 25 second budget: no further page and no retry past it, so a Stripe outage no longer holds the page for a minute.
- Open disputes are read 180 days back, page by page, so a dispute of a payment older than the panel's 30 days shows.
- An error inside a check reaches the admin masked.
- A failure outside Stripe (Medusa, the database) answers 500 with a plain sentence, the details in the server log; only a Stripe error answers 502.
- The User-Agent names the package version.

### Changed

- "Copy prompt" turns demo mode on only with `STRIPE_DEMO=true`; a store whose read key is missing shows the setup, never sample data. Demo mode in production logs a warning at start.
- The prompt and the guide keep an existing Stripe provider entry and its options (capture included) as they are.
- The key check, the start log, the guide and the README no longer call a restricted key read only: Stripe does not show the plugin a key's permissions, so they ask for Read or None per resource. A secret key logs a warning.
- The payments filter "Disputed" lists open disputes only; "Need a look" no longer lists declined cards or payments waiting for the customer (they have their own filter and status).
- The admin fetch goes through the kit: admins signed in with a JWT work, and every write carries the header the write guard asks for. Writes to `/admin/stripe/*` take a JSON body or the `x-koda-request` header (415 otherwise); every route only reads today.
- `prepublishOnly` runs the typecheck too.
- The order card stays out of orders not paid with Stripe (it used to say so in a card of its own) and lists every dispute of a payment; the exchange rate shows its currency pair.
- The package ships type declarations; the dead `./providers/*` export is gone.

### Added

- The koda.integration/1 contract: `GET /admin/stripe/integration` (the manifest), `/integration/summary` for orders and customers (one line per record, the worst Stripe payment speaking, with the payment fact: method, Stripe's fee and the net formatted on the server with the currency's exponent) and `/integration/attention` (board counters `payments_failed`, `disputes_open`, `health_failing`, each linked to its filtered list). Summaries read Stripe only through the plugin's cache, at most five PaymentIntents per answer, and serve the last good read as stale when Stripe does not answer.
- The order card can be embedded by a host (`embedded`): no frame, header or footer of its own, the facts in a grid, a line while loading and on orders not paid with Stripe. It registers as `stripe.order` for the zone `order.details`.
- "Read again" in the order card, with the time of the read and a note when Stripe did not answer.
- Deep links into the page: `?filter=` (`attention`, `disputed`, `checks` and the other payment filters) and `?q=`; a new payments filter for another Medusa on the same Stripe account.
- `stripeIntegration` and more response types in the public exports.

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
