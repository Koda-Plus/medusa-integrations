# Changelog

## 0.1.0 (2026-10-18)

First release: a coupon creator and a coupon overview on top of Medusa's own promotions. No tables of its own.

### The coupons page

- A page under Extensions (Panel, Setup guide and Settings). Tiles: all coupons, active ones, scheduled ones, orders with a coupon and the discount given in the last 30 days, active coupons ending within 7 days and active automatic coupons for everyone; every tile but the orders one filters the list.
- The list of the newest 300 promotions, each in one plain sentence (what it gives, on what, for whom, from which minimum, until when), with its status (active, scheduled, expired, paused, draft, used up), its uses, orders, discount and order value. Filters (all, active, scheduled, ended, paused, automatic, ending soon), a search by code, deep links by `?status=` and `?q=`.
- Every rule of a promotion is named in the sentence: categories, products, collections, delivery types and options, sales channels and regions by their names, percent and amount off delivery, and any other condition with its values instead of "and N more rules".
- Automatic coupons without a limit show "automatic" in the uses column: Medusa does not count the uses of a promotion that applies by itself, and the orders column shows how many orders used it.
- A coupon's detail: its sentence, uses, orders, discount, order value and new customers, its latest 25 orders (first orders of new customers marked), a pause (and back on) and a link to Medusa's promotion page.
- Settings: the options in use (currency, member groups, code prefix, version) and the option values that were ignored. The Koda Plus header with "Copy prompt" and help on Discord; English and Polish.

### The creator

- Three steps on a full screen, each with a summary: the type (percent off the order, an amount off the order, free delivery, percent off chosen categories), for whom (everyone, customer groups, one customer found by name, company or e-mail) and the rules (a code to type or automatic, until the end of the month, 30 days, own dates or no end, single use, 100 uses, no limit or an own number, an order minimum).
- A preview of the coupon as the customer sees it, an example cart with the price after the discount, the sentence and a readiness check, all live.
- Warnings before saving: an automatic coupon with no group reaches everyone, logged-in groups with their own prices included; an automatic coupon that reaches a group named in `memberGroupIds`; another active automatic coupon on the same part of the order; half price or more; an amount off with no minimum (or one below the amount); open for everyone with no end and no limit; a code that is taken.
- It saves an ordinary Medusa promotion through `createPromotionsWorkflow`, and a campaign through `createCampaignsWorkflow` when the coupon has dates. 400 with the keys of what is missing, 409 when the code is taken.

### Editing

- Edit a coupon from a row of the list or from its detail: the code, code or automatic, the value (percent or amount kinds), the dates, the uses allowed, the order minimum and who it is for (groups and customers), with the sentence after saving and the warnings live (a used coupon gets a new code, an automatic coupon becomes one for everyone, the audience is emptied, the dates belong to a campaign other coupons share).
- `POST /admin/coupons/:id` with `{ patch }`: a missing key is left as it is, `null` clears the dates, the limit or the minimum, a value equal to the current one writes nothing. It writes through Medusa's `updatePromotionsWorkflow`, `createCampaignsWorkflow` / `updateCampaignsWorkflow` and `batchPromotionRulesWorkflow`. Targets, buy X get Y, sales channels and other rules are kept as they are and listed as kept. Uses allowed cannot go below the uses so far; Medusa's own refusals answer 400 in its words.
- The edit form takes dates as a moment in the browser's time zone (the server runs in UTC), so a coupon ends at the hour the person picked.
- `updateCoupon` in `@koda-plus/medusa-plugin-coupons/workflows`.

### Counting use

- Use is counted from orders: the promotion adjustments on order lines and shipping methods of non-canceled orders in their current version, with the discount, the order value, the first orders of new customers and the last use. The uses shown are the orders found when Medusa's own counter is lower.
- Option `codeInDescription`: adjustments the store writes itself, without a promotion id and with a description that starts with the code and a colon (`SHOP7: 1 free`), count as that coupon's uses, discount and orders.
- Option `storeRules`: a function of the store that describes the rules its cart applies with logic of its own (a free item for every seven, a price list as the floor). Its text joins the coupon's sentence, and with `replacesDiscount` takes the place of the marker value Medusa keeps (often 0.001%). An error in it reads as no rules.

### Cards and hosts

- Cards on the order (which coupons worked and what each gave, delivery apart, the discount in total), the customer (the codes used with their orders and discount, the active and scheduled coupons made for them or their groups) and the product (active coupons whose discount reaches it, by product, category or collection). Each card hides itself when there is nothing to show.
- The koda.integration/1 routes: the manifest, one line per order, customer and product (up to 50 ids), and the board counters `expiring` and `automatic_everyone`. The cards register as `coupons.order`, `coupons.customer` and `coupons.product`, so a Koda Plus host can show them as tabs.
- Writes to `/admin/coupons*` take a JSON body or the `x-koda-request` header (the kit's write guard).
