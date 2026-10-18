# Changelog

## 0.3.0 (unreleased)

### Added

- App mode: `appProvider: "resend"` (the id of your own notification provider) keeps the store's provider on the email channel. The plugin registers no provider and sends none of its built-in templates (hidden from the gallery, never sent, not even as a test); it shows the store's own templates from `templates`, previews them, sends tests through the store's provider and lists what that provider reports with `recordAppEmail` (`@koda-plus/medusa-plugin-emails/app`). The badge says "Sent by your provider", and red when Medusa has that provider off the email channel; the Settings and Setup guide say who sends instead of asking for a key.
- `recordAppEmail(pg, { notification, status, subject, externalId, error })`: one row per message in the send log, the address masked and hashed, the error masked, no body. A second report under the same key (Medusa retried the notification) updates the outcome of that app row; rows of the plugin's own flows are never touched.
- App mode reads Medusa's own history of the store's provider (the `notification` table): the log, its search and filters, the order card, the counters and the per template numbers show every e-mail from the store's first day, also before the plugin's migrations ran (the page then says the plugin log starts after db:migrate, instead of an error). Read only, the address masked, no body; a notification the provider also reported is listed once. A template may give `subjectOf(data, locale)` for the subject of its history rows. `GET /admin/emails/messages/:id` opens a history row (`noti_...`) too, without a body.
- App mode in the admin: the Settings tab Provider says which provider sends and whether Medusa routes the `email` channel to it (with the email and feed providers, the language, the time zone and the number recorded in 30 days); the Setup guide marks the Resend steps as the store's own setup; a test of a built-in template answers 409 with the reason.
- Option `showAddresses` (default `false`): full recipient addresses in the log of app mode (from Medusa's notification table) and in the list of rejected addresses, and the log of app mode finds an address by any part of it (`anna`, `@example.com`). Without it addresses are masked and the log finds one only by the full address; the plugin's own send log never stores an address in full.
- Delivery read from Resend, GET only, with the option `deliveryKey` (a Resend key with full access; in live mode the plugin's `apiKey` when left out). `GET /suppressions` feeds a "Rejected addresses" tile on the Panel and the list behind it (`GET /admin/emails/delivery`): every address Resend no longer sends to, with the reason (bounced, reported as spam, added by hand), since when, the subject of the message that caused the block, a link to that message in Resend, a corrected address when the domain is a known typo (`gmial.com` to `gmail.com`) and, in app mode, the last message to that address in this store. In app mode `GET /emails` adds a delivery badge to each row of the log (Resend's `last_event`: delivered, delayed, bounced, opened, clicked and so on), and the `bounced` filter also covers addresses Resend suppresses and messages that bounced after Resend accepted them. The reads are cached in memory (suppressions 10 minutes, the newest messages 5 minutes, final states an hour) and paced under Resend's 10 requests a second; a key that cannot read (sending access only) shows the reason instead of numbers.
- Option `campaigns`: mailings the store sent through the same Resend account outside the shop (a notice to all customers, a newsletter), each with a `key`, a `label` and the Resend `tag` it was sent with. Rows of kind `campaign` in the log (template `campaign:<key>`) carry the mailing's label and a badge and stay out of the sent counters, and the list of rejected addresses says which mailing caused a block (matched by the tag of the message behind it).
- Option `templateGroups`: named sets of templates the log can be narrowed to, as pills above the log and as `?group=<key>` in the URL (other pages link to it). `variant` shows the stage of a message from a field of its data as a badge (for example `kind`: upcoming or overdue), `link` points every row to the admin page that acts on it (`:order_id` and `:customer_id` filled from the message; a path without placeholders is also shown above the log), and `orderState(scope, orderIds)` gives the state of each order now (a label and a colour, for example paid or unpaid next to a payment reminder). A failing `orderState` only hides the badges.
- The log has an Order column: the Medusa mark with "Open the order", the order state of its template group and the group link. A message Resend sent (live mode, or app mode with a provider whose id names Resend) links to the message in Resend's dashboard, in the row and in the message drawer.
- Template previews in Settings: a Gallery tab with the live preview of every template, opened from the Templates button in the header of the Panel.
- The tiles of the Panel narrow the log to what they count (their filter and time window) and scroll to it; an "All e-mails" tile shows the whole log again.
- Loading states from the shared kit (1.0.9): skeleton rows while the log loads, a thin bar while it refreshes, a line while a message opens.
- `GET /admin/emails/messages?template=` takes several keys separated by commas (up to 20), for a template group.

### Changed

- The gallery lists the templates of the `templates` option in the order the store gave them (a store groups its own: orders first, then accounts), then the ones registered by code by key; before, all of them were sorted by key.
- The template gallery moved from the Panel to Settings (Gallery tab); the Panel starts with the counters and the log.
- The sent counters of the Panel and the board leave out rows of kind `campaign`.
- In app mode the log marks only test and demo rows: a row from the store's provider or from Medusa's history carries no kind badge, and the gallery has no "Your template" badge (every template is the store's). The badge of a template of the options is grey instead of orange.
- The koda.integration/1 manifest reports app mode as `live` when the store's provider is configured, and asks for no plugin provider in app mode.

## 0.2.0 (2026-10-07)

Run `npx medusa db:migrate`: the send log gets two columns (`Migration20261008110000_emails`).

### Fixed

- Security: password reset links never sit in a table. The reset e-mail no longer goes through Medusa's notification module, whose table keeps the data of every notification and returns it from `GET /admin/notifications` to every admin user and secret API key; the plugin hands it straight to its provider, with the same send log, switch and idempotency key. Without the provider registered in the process, a reset is not sent at all.
- Security: the simulated outbox of demo mode keeps a password reset with the link hidden, the message view never shows a reset kept by 0.1.0 and takes anything shaped like a token out of every stored body, and demo mode handles no password reset of an admin user.
- Security: at most `passwordResetsPerHour` (3) reset e-mails go to one address in an hour, counted in the send log under a lock per address; the rest are logged as skipped (`THROTTLED`).
- Security: the welcome shows a name only when it reads like one and a company only when it is not a link, an address or a domain, and its subject carries no name: anyone can register with anyone's address.
- Security: previews and test sends from the newest order, parcel or cart carry sample order and cart ids and tracking numbers (a real cart id opens the cart, with the shopper's address, through the Store API).
- A failed read of the settings keeps the last settings this process read instead of turning templates switched off in the admin back on; with none read yet, nothing is sent and the message is logged as failed (`SETTINGS_UNAVAILABLE`) for a person to retry.
- An e-mail that fails before it reaches the provider (Query could not read the order, the settings could not be read, no provider for the channel) gets a failed row in the log (`PRE_SEND`), so the page shows it and "Retry" works; a second delivery of the same event is a duplicate, not an error.
- The medusa-config examples (README, Setup guide, Settings, the setup prompt) keep Medusa's local provider on the `feed` channel: listing the providers replaced Medusa's default one, and product import and export and the order export failed. The admin warns when no provider serves `feed`.
- Abandoned carts: only carts with an address are read, page after page, so carts already reminded never hide a new one.
- The lease of a send covers every try the options allow; a result that could not be written, or a claim that failed, is an error in the server log, and the outcome still gets its row.
- A name of api.resend.com that does not resolve, or a refused connection, is `failed` (nothing left the machine), not `unknown`; once a try may have gone out, the message stays `unknown`.
- Resend refusing the recipient's address is logged as `INVALID_RECIPIENT`.
- The demo outbox reads the newest orders one by one when Medusa refuses them together (Medusa 2.12 computes no totals of an order without its version), so one bad order never empties the demo; order reads ask for `version`.
- Saving the branding merges with what the database holds, not with the cache of one process.
- The version in the admin and in the User-Agent comes from `package.json`.
- The limits of test sends are counted in the send log too, so a restart or a second instance does not reset them.
- The demo outbox shows the store's products with the sample person: a copy of a live database never puts a customer's name, address or tracking number in it.
- Admin pages work when the plugin is installed from npm: the admin libraries are optional peers, so the app keeps the copies of Medusa's dashboard instead of a second, newer copy.

### Changed

- Demo mode only with `demo: true`, as before; the examples and the setup prompt now say `demo: process.env.EMAILS_DEMO === "true"` and never turn it on because a key is missing.
- Reads never write: `GET /admin/emails` no longer builds the demo outbox. `POST /admin/emails/demo/seed` does (the page asks for it when the status says the seed is stale), and so does the hourly housekeeping job. The status tells when the outbox was seeded.
- Writes to `/admin/emails/*` take a JSON body or the `x-koda-request` header (415 otherwise). The admin sends both, and works with Medusa's JWT auth, through the shared kit.
- A shopper may not set the keys of `skipOrderMetadataKeys` on a cart or the account through the Store API (400 `reserved_metadata_key`).
- Unexpected server errors answer a plain sentence; the details stay in the server log, masked.
- The log and the status are read once a minute, every 5 seconds only while a message is being sent, never in a hidden tab.
- The badge of the page follows the provider's own mode and says in red when it differs from the plugin's.
- Searching the log by a full address finds the messages to that address; the masked address is no longer searched.
- The go-live checklist counts only test sends that went out.

### Added

- The koda.integration/1 contract: `GET /admin/emails/integration`, `/integration/summary` (one line per order and per customer, the worst message speaking; a customer's line covers the e-mails of orders placed as a guest with the same address) and `/integration/attention` (the board counters `messages_failed` and `bounced` of the last 7 days, with links to filtered lists).
- The order card can be embedded by a host (`emails.order`, zone `order.details`): no header of its own, a line while loading, the link to the order's e-mails at the bottom. It reads no status of the plugin any more: each message carries its template's name.
- Deep links into the page: `?filter=` (with `bounced`), `?since=` (`24h`, `7d`, `30d`), `?order_id=`, `?customer_id=` and `?q=`; the log takes `customer_id` and `since`.
- Type declarations in the package, with explicit `./templates` and `./workflows` exports: `defineEmailTemplate<{ ... }>(...)` from the README is checked in a strict TypeScript app. `emailsIntegration` is exported from `/workflows`.
- The option `passwordResetsPerHour`, and `sensitive` in a template definition: data fields with a secret, handled like the password reset link.
- The send log keeps the Medusa customer of a message and a one-way hash of its address (`customer_id`, `recipient_hash`).
- The `bounced` filter of the log: messages refused for the recipient's address.
- The Setup guide and the README name the daily limit of the free Resend plan (100 a day), and the README has Security and Uninstall sections.
- The page warns when admin users would get no password reset e-mail (the address of the admin is unknown).

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
