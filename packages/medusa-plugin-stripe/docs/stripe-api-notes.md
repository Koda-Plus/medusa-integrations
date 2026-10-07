# Stripe API notes

What the plugin relies on, checked in Stripe's and Medusa's documentation on 7 October 2026. The plugin pins API version `2024-04-10`, the version of stripe-node 15 that `@medusajs/payment-stripe` uses.

## Reads

Every call is a GET to `https://api.stripe.com/v1`:

- `GET /payment_intents?created[gte]=...&expand[0]=data.latest_charge.balance_transaction`: the payments of the last 30 days, each with its latest charge (method details, Radar outcome, refunded amount, the disputed flag) and the charge's balance transaction (`fee`, `net`, `currency`, `exchange_rate`, `available_on`, `fee_details`). Pages of 100 with `starting_after`.
- `GET /refunds?created[gte]=...&expand[0]=data.payment_intent` and `GET /disputes?expand[0]=data.payment_intent`: the expanded PaymentIntent carries `metadata.session_id`, so refunds and disputes find their Medusa order too.
- `GET /balance`, `GET /payouts?limit=20`.
- `GET /payment_intents/{id}?expand[0]=latest_charge.balance_transaction&expand[1]=latest_charge.refunds`: the order widget. Since API version 2022-11-15 a charge no longer includes its refunds unless expanded.
- `GET /disputes?payment_intent={id}`: only when the charge says `disputed: true`.
- `GET /account`: `country`, `default_currency`, `charges_enabled`, `payouts_enabled`, `requirements`, and `capabilities` with `card_payments`, `blik_payments`, `p24_payments` set to `active`, `inactive` or `pending`.
- `GET /payment_method_configurations`: per method `available` and `display_preference.value` (`on` or `off`) of the default configuration, which the Payment Element uses when the provider sends no configuration.
- `GET /webhook_endpoints`: `url`, `status`, `enabled_events` (`*` means all).
- `GET /events?delivery_success=false&created[gte]=...&type=payment_intent.*`: "events which are still pending or have failed all delivery attempts to a webhook endpoint". Events go back 30 days.
- `GET /payment_method_domains`: `domain_name`, `enabled`, and `apple_pay.status`, `google_pay.status` (`active` or `inactive`, with `status_details.error_message`).

Sources: docs.stripe.com/api (payment_intents, charges, refunds, disputes, balance, payouts, accounts, payment_method_configurations, webhook_endpoints, events, payment_method_domains).

## The official provider (`@medusajs/payment-stripe`, read in 2.15.3, the version the tests install; the release smoke test runs 2.12.6 and 2.21.2)

- One `resolve` registers eight providers, `pp_<identifier>_<id>`: `stripe`, `stripe-blik`, `stripe-przelewy24`, `stripe-bancontact`, `stripe-giropay`, `stripe-ideal`, `stripe-promptpay`, `stripe-oxxo`.
- The payment session data is the PaymentIntent: `data.id` is its id, and the intent is created with `metadata.session_id`, the Medusa payment session.
- `capture_method` is `automatic` when the option `capture` is true, `manual` otherwise; the BLIK and Przelewy24 providers always send `automatic` and one payment method type.
- `automaticPaymentMethods: true` sends `automatic_payment_methods: { enabled: true }`.
- Webhooks: `POST /hooks/payment/{identifier}_{id}` answers 200 at once and verifies the signature later, in the subscriber, with the provider's `webhookSecret`, so a wrong secret never shows as a failed delivery in Stripe, only in the Medusa log. The subscriber skips events without `metadata.session_id` and the canceled, failed, requires action and pending authorization ones; the rest run `processPaymentWorkflow`: `payment_intent.succeeded` captures the payment (authorizing the session first when the customer never came back) and completes the cart into an order, `payment_intent.amount_capturable_updated` authorizes it.
- Medusa's docs list the events `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.payment_failed` and `payment_intent.partially_funded`, and the URLs `/hooks/payment/stripe_stripe`, `stripe-blik_stripe` and `stripe-przelewy24_stripe`.

Sources: node_modules/@medusajs/payment-stripe/dist, node_modules/@medusajs/medusa/dist/api/hooks/payment and subscribers/payment-webhook.js, docs.medusajs.com/resources/commerce-modules/payment/payment-provider/stripe.

## BLIK and Przelewy24

- BLIK: customers in Poland, presentment currency PLN, manual capture not supported, disputes supported (12 calendar days for the evidence), the code is valid for 2 minutes and the customer has 60 seconds to approve. Not in the Express Checkout Element, and not when the payment details are collected before the PaymentIntent exists.
- Przelewy24: customers in Poland, PLN and EUR, minimum 0.50 EUR, manual capture not supported, no disputes, not covered by Radar, refunds asynchronous (up to 3 business days, at most 180 days after the payment), the customer has an hour to approve. `payment_method_details.p24.bank` and `.reference`.
- Apple Pay must have every domain registered (subdomains apart); Google Pay, Link and others use the same registration. A domain registered in live mode is registered in sandboxes too.

Sources: docs.stripe.com/payments/blik, docs.stripe.com/payments/p24, docs.stripe.com/payments/payment-methods/pmd-registration.

## Limits

- 100 requests per second in live mode, 25 in a sandbox, per account; 429 responses carry `Stripe-Rate-Limited-Reason`. List requests with expansions are the heavy kind the concurrency limiter sheds first.
- Read allocation: on average at most 500 read requests per transaction over 30 days, at least 10 000 a month. This is why the plugin reads only when someone opens the page and keeps each read for `cacheSeconds`.
- Restricted keys (`rk_live_`, `rk_test_`) have None, Read or Write per resource; a refused request answers 403 and names the permission, e.g. "Having the 'rak_payout_read' permission would allow this request to continue."

Sources: docs.stripe.com/rate-limits, docs.stripe.com/keys/restricted-api-keys.
