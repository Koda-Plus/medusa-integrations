# Changelog

## 0.1.0 (2026-10-06)

First public release, generalized from the transactional e-mails of the Koda Plus demo store (medusa.koda.plus).

- Notification provider for Resend (`@koda-plus/medusa-plugin-emails/providers/emails`, identifier `koda-emails`): renders a template, sends it with a plain-text part, `Reply-To`, tags and an `X-Entity-Ref-ID` header. Without an API key it logs instead of sending; a missing option never breaks the boot.
- Exactly once per event: the event's key is checked by Medusa's notification module, claimed atomically in the send log (a unique row per key and mode) and sent to Resend as the `Idempotency-Key` header.
- No retry storms: only temporary answers are tried again (at most twice, with the same key, after `retry-after` or a growing wait), a breaker stops retrying during an outage, requests are paced per process, quotas, auth and validation errors are final, and a message whose fate is unknown is never resent by itself.
- Nine templates in English and Polish: order confirmation, order shipped (tracking numbers and links, partial shipments), order cancelled, welcome (registered accounts only), password reset (customers and admin users), and, off by default, abandoned cart and three negotiation e-mails (`negotiation.countered`, `.accepted`, `.rejected`, by event name only).
- The look of the Koda Plus templates: a dark band with the store name as live text, a light body, product tiles from the SKU, no images, dark mode for Apple Mail and Outlook.com, Polish typography, below Gmail's clipping size.
- Branding from the options and from the admin: name, live-text logo, accent and band colours (with derived, readable text colours), footer per language, support address, web fonts.
- Per-recipient language from the order's or cart's `locale`, the metadata, then `defaultLocale`; dates in `timeZone`.
- Every template switchable: `templates: { key: false }` in the options for good, the admin switch at run time.
- Custom templates: the `templates` option, `registerEmailTemplate`, `defineEmailTemplate`, the kit and `renderEmailPreview`, exported from `@koda-plus/medusa-plugin-emails/templates`; `sendEmailWorkflow` and `sendAbandonedCartsWorkflow` from `/workflows`.
- Skip rules: `no_notification`, marketplace orders (`marketplace_order_ref`), guests, demo negotiations outside demo mode.
- Admin page with Panel (counters, the template gallery with a live preview in light and dark, desktop and phone, both languages, sample data or the newest order with the person replaced; the send log with masked addresses; counts per template; a test send, rate limited and logged), Setup guide and Settings (branding, templates, the provider with an options check), in English and Polish. An order widget with the e-mails of each order. Retry of failed messages from the admin.
- Demo mode: a simulated outbox seeded from the newest orders and customers, with one failed welcome to try Retry; nothing leaves the server. The seed is dated over the last days, a few rows within the last 24 hours, and rebuilt with fresh dates twice a day in one transaction, under the same keys and never touching the rows of real events and test sends.
- Jobs: `emails-abandoned-carts` (hourly, does nothing while the template is off) and `emails-housekeeping` (hourly: expired leases, the retention of the send log, the demo outbox and the rebuild of its stale seed).
- One migration (`Migration20261007110000`): the send log and the settings tables.
