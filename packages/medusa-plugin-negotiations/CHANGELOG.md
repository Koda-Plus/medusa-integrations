# Changelog

## 0.1.0 (2026-10-06)

First public release, a generic version of the negotiations module Koda Plus built for its B2B demo store (medusa.koda.plus).

- Store API for logged-in customers (`/store/negotiations`): open a thread about a product, a variant or the customer's own cart with a quantity, an optional target price and a message; list, read, reply with a new target, accept the team's counter offer (with the price the customer saw), decline. Ownership checked on every route, one open thread per subject, caps and rate limits per customer, stable error codes.
- The status machine of the original module (`open`, `counter_offered`, `accepted`, `rejected`, `expired`) with every move as one conditional update plus its message in a transaction: two moves can never both close a thread.
- Admin page with Panel (counters, the queue with filters and search, the thread drawer with the conversation, counter offers with an optional validity, accept, reject, internal notes, cart lines), Setup guide (storefront calls, events, expiry, the writer, go-live checklist, troubleshooting) and Settings (options in use, expiry, the writer and its plan, history). Widgets on the product page, the customer page and above the order list.
- Expiry: active threads expire after `expiryDays` without a move, or when a counter offer's own validity runs out; hourly job, system message, `negotiation.expired`.
- Six events with a documented, stable payload: `negotiation.opened`, `.message_added`, `.countered`, `.accepted`, `.rejected`, `.expired`.
- Exact money: integer minor units with the currency code, decimal text in the APIs and events, no `bigNumber`.
- Draft order writer (`writers.draftOrders`), off by default: two switches, a plan with the exact `createOrderWorkflow` input, a dry run, a cap per run, exactly once per thread, a lookup after an interrupted run, simulated in demo mode.
- Demo mode: nine negotiations built from the store's catalog and customers, flagged `demo`, rebuilt daily, never shown to customers, never mixed with real threads.
- Admin in English and Polish, workflows for every move, the expiry pass and the writer.
- One migration (`Migration20261007100000`) that creates the tables when missing and otherwise only adds columns and tables, so stores with the app module's `negotiation` and `negotiation_message` upgrade in place; old rows keep working (their single price and Polish system notes are read as they are).
