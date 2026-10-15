# Changelog

## 0.2.0 - 2026-10-15

The list in numbers and the broadcasts in the panel (active subscribers, growth over 30 and 90 days, open and click rates; the newest campaigns with recipients, opens, clicks and unsubscribes), read only and cached for ten minutes. Tags by sign-up source (`source` from the storefront, for example `drop`). Tags for buyers on `order.placed`, only for addresses that are already active subscribers, optionally one tag per bought product with a configurable prefix. New admin routes `GET /admin/kit/overview` and `GET /admin/kit/broadcasts`; the settings route takes `source_tags`, `buyer_tags`, `product_tags` and `product_tag_prefix`. The settings are key and value rows, so there is no migration.

## 0.1.0 - 2026-10-11

First public release: the newsletter of a Medusa v2 store on the Kit list. The storefront form subscribes customers (upsert + tags + double opt-in form), the admin shows the account, the list settings and the subscription log. Includes the koda.integration/1 contract (manifest, customer summary, failed-sign-up counter), the rate-limited public route, masked secrets and missing options that never break the boot.
