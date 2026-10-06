# Resend API and Medusa events: what this plugin relies on

Verified on 6 October 2026 against the official sources:

- the Resend API reference: "Send Email" (https://resend.com/docs/api-reference/emails/send-email), "Errors" (https://resend.com/docs/api-reference/errors), "Rate Limit" (https://resend.com/docs/api-reference/rate-limit), "Introduction" (https://resend.com/docs/api-reference/introduction);
- the Resend guides: "Idempotency Keys" (https://resend.com/docs/dashboard/emails/idempotency-keys), "Domains" (https://resend.com/docs/dashboard/domains/introduction) and the DNS provider guides;
- the Medusa documentation: "Events Reference" (https://docs.medusajs.com/resources/references/events), "Reset Password" of the Auth Module (https://docs.medusajs.com/resources/commerce-modules/auth/reset-password), "Create a Plugin" (https://docs.medusajs.com/learn/fundamentals/plugins/create);
- the source of Medusa 2.15.3 (`@medusajs/notification`, `@medusajs/modules-sdk`, `@medusajs/link-modules`), for what the documentation leaves out.

## Sending

- `POST https://api.resend.com/emails`, `Authorization: Bearer re_...`, JSON body. Answer `{ "id": "..." }`.
- Fields the plugin sends: `from` (`Name <address>` or the bare address, on a verified domain), `to` (one address; Resend takes up to 50), `subject`, `html`, `text` (Resend would make one from the HTML; the plugin writes its own), `reply_to`, `cc`, `bcc` (only from `provider_data`), `headers` (`X-Entity-Ref-ID`, so Gmail does not thread similar messages), `tags` (`template` and `source`; names and values of ASCII letters, digits, underscores and dashes), `attachments` (`filename`, `content` in base64, `content_type`; up to 40 MB per message, the plugin stops at 30 MB and 10 files).
- Not used: `scheduled_at`, `template` (Resend's own templates), `react`.

## Idempotency

- Header `Idempotency-Key`, 1 to 256 characters (400 `invalid_idempotency_key` otherwise), kept 24 hours.
- The same key and the same payload within 24 hours: Resend answers with the first response and sends nothing again.
- The same key with another payload: 409 `invalid_idempotent_request`. The first request went in, so the plugin records the message as unknown (it may have gone out) and never retries it by itself.
- A request still running under the same key: 409 `concurrent_idempotent_requests`; trying again later is safe.
- The plugin's key is the key of the event (`emails:order.placed:<order id>`), at most 200 characters. A person's retry from the admin rotates it (`#r1`), because Resend may hold the earlier answer, an error included, for a day.
- The payload of one attempt series is built once, and templates are pure (dates come from the data, never from the clock), so a retry sends the same payload.

## Errors and retries

Every error has `statusCode`, `name` and `message`. What the plugin does with each:

- 400 `validation_error`, 400 `invalid_idempotency_key`, 401 `missing_api_key`, 401 and 403 `restricted_api_key`, 403 `invalid_permission`, 403 `suspended_api_key`, 403 `validation_error` (an unverified domain, or the test mode of `onboarding@resend.dev`), 404, 405, 422 (`invalid_attachment`, `invalid_parameter`, `missing_required_field`): final, no retry.
- 429 `rate_limit_exceeded`: tried again after `retry-after` (seconds), capped at 10 seconds.
- 429 `daily_quota_exceeded` and `monthly_quota_exceeded`: final, no retry (trying again cannot help before the plan changes).
- 409 `concurrent_idempotent_requests` and `resource_locked`: tried again after a second.
- 500 `application_error` and other 5xx, 503 `service_unavailable`, network errors and timeouts: tried again with the same key (safe, see Idempotency). A 5xx other than 503, a timeout and a network error leave the message unknown when every try failed.
- At most `maxRetries` (2) extra tries per send. After 5 temporary failures in a row the process stops retrying for a minute: every send still gets its one try.

## Rate limit

- 10 requests per second per team by default, reported in `ratelimit-limit`, `ratelimit-remaining` and `ratelimit-reset`; `retry-after` on 429.
- The plugin paces its own requests to `requestsPerSecond` (5) per process, so a server and a worker together stay below the team limit.

## Domains

- Resend recommends sending from a subdomain (`updates.example.com`) to keep the reputation of the main domain apart, and DMARC after the verification.
- Records for a domain `mail.example.com`: MX on `send.mail` (the value from Resend, `feedback-smtp.<region>.amazonses.com`, priority 10), TXT on `send.mail` (`v=spf1 include:amazonses.com ~all`), TXT on `resend._domainkey.mail` (the DKIM key from Resend). Values must be copied from Resend.
- Until a domain is verified, `onboarding@resend.dev` delivers only to the address of the account.

## Medusa events

From the events reference; the payloads are exactly these:

- `order.placed`: `{ id }`, the order (completeCartWorkflow, convertDraftOrderWorkflow).
- `order.canceled`: `{ id }`, the order (cancelOrderWorkflow). Medusa 2.15 cancels uncaptured payments and refunds captured ones; the cancellation e-mail says so in general terms.
- `shipment.created`: `{ id, no_notification }`, `id` is the fulfillment (createOrderShipmentWorkflow). The plugin reads the fulfillment's labels (`tracking_number`, `tracking_url`, `label_url`) and its order through the `order_fulfillment` link (`fulfillment.order`).
- `customer.created`: `{ id }` (createCustomersWorkflow, createCustomerAccountWorkflow). Guests created at checkout have `has_account: false` and get no welcome.
- `auth.password_reset`: `{ entity_id, actor_type, token, metadata }` (generateResetPasswordTokenWorkflow). With the emailpass provider `entity_id` is the address. Medusa's documented links: `<storefront>/reset-password?token=<token>&email=<email>` for customers, `<admin.backendUrl><admin.path>/reset-password?token=<token>&email=<email>` for admin users. Tokens expire after 15 minutes by default, each new request invalidates the earlier token, and a token is consumed by a successful reset.
- Orders imported by the Koda Plus Allegro and BaseLinker plugins carry `no_notification: true` and `metadata.marketplace_order_ref`; their documentation asks every e-mail subscriber to stand back for them.
- Order and cart records have a `locale` column (a BCP 47 tag) from the migrations of December 2025; on an older Medusa the plugin reads the order without it.

## Notification module (from the source of 2.15.3)

- A provider is registered in the notification module's options: `{ resolve, id, options: { channels: ["email"], ... } }`. Medusa calls the static `validateOptions(options)` of the provider class at boot and constructs it with the module's container (logger, `__pg_connection__`, the config) and its options.
- One provider per channel: the module picks the provider of the channel from its own table (`notification_provider`, `is_enabled`, `channels`).
- `createNotifications` with an `idempotency_key`: a notification with the same key that did not fail is not sent again; one that failed is processed again, but in 2.15.3 with a new id that does not exist in the table, so the result cannot be recorded. The plugin's own retry therefore uses a new Medusa key and finds its row through `provider_data.emails.key`.
- The provider receives the whole notification row (`id`, `to`, `from`, `channel`, `template`, `data`, `provider_data`, `content`, `attachments`, `idempotency_key`, `trigger_type`, `resource_id`, `resource_type`, `receiver_id`) and answers `{ id }` with the id of the external system.
- Plugins: the `options` of a plugin reach every module of the plugin; a module provider of a plugin is registered by its path (`@scope/plugin/providers/<name>`) under its module, separately.

## What the documentation does not say, and what the plugin does

- Whether Resend caches a 5xx answer under an idempotency key: the plugin assumes it does not (like most idempotency layers) and retries 5xx with the same key, which is safe either way.

## Negotiation events (from the source of `@koda-plus/medusa-plugin-negotiations`)

- `negotiation.countered`, `.accepted` and `.rejected` carry the same data: `id`, `ref`, `status`, `subject` (`product`, `variant` or `cart`), `customer_id`, `product_id`, `variant_id`, `cart_id`, `sku`, `qty`, `price` (a decimal string in major units, "469.00"), `price_amount` (the same in minor units), `currency_code`, `expires_at`, `actor` (`customer`, `admin` or `system`) and `demo`.
- A cart thread prices the whole cart; the others price one unit.
- `rejected` covers both the team's rejection and the customer's own decline (`actor: "customer"`); the plugin mails only the first.
- The plugin reads `price_amount` first, then a `price` string; `negotiationAmounts` only matters for another emitter that sends a numeric `price`.
- Demo threads (`demo: true`) never send a real e-mail.
