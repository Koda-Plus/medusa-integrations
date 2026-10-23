# Changelog

## 0.2.0 (unreleased)

The coupon's whole build in one form, copies, a pause from the list, and the store's own terms.

### The page

- The header and the list intro say it in short phrases with icons (creator in three steps, each coupon in one sentence, warnings before saving, uses, discount and revenue) instead of long sentences.
- Kit 1.2.0: the page header takes `points`, short phrases with an icon shown as pills instead of the long description (which stays as their tooltip and accessible label); `KeyPoints` draws the same pills under a section heading.

### Delete, send the code, the counter of uses

- Delete a coupon nobody used (a copy made by mistake, a test): a red bin on the row and in the detail, with a confirmation. A coupon with uses or orders (canceled ones too) only turns off; the server checks it itself and answers 409 with the reason. `DELETE /admin/coupons/:id` deletes the promotion through `deletePromotionsWorkflow`, with the store's terms and the campaign the creator made for its dates.
- Send the code by e-mail (options `sendCode` and `previewCode`, the plugin sends nothing itself): the people of "For whom" ticked, more from the creator's customer search, an instruction made from the coupon's sentence (without other customers' names, editable) and the store's own e-mail as a preview. Who got it is kept in the promotion's metadata (`code_sent`), shown when it opens again, and nobody gets it twice: "Add and send" goes only to the new people and adds them to the customer rule first, so the code works for them.
- The counter of uses says what limits it: "0 uses" and under it "limit 1 in total", "1 per customer", "3 customers", on the list and in the detail.
- The creator warns before saving when a limit of 1 in total meets more than one customer: the code works once for one of them; for once per customer set Orders per customer: 1.

### The creator

- Two more types: buy X get Y (Medusa's own buyget on chosen categories, or counted by the store when it keeps buy X get Y in `storeTerms`) and percent off the store's product groups (option `storeTerms`, feature `pools`), whose target rules the store names (for example a product tag per group).
- Two more audiences: every B2B group (the groups in `memberGroupIds`) and retail, everyone outside those groups with guests included (a "customer group is not" rule). Chosen customers: one or more.
- The store's own terms in the steps, only the features the store keeps: from N pieces (in one group or all together), the price list the percent is counted from and the floor below which the price never goes, the price of a free piece, orders per customer, which coupons it adds up with or never goes with, and a note the customer reads next to the code. They are saved through the store's adapter next to the promotion; when they fail, the promotion is removed again, so no half coupon stays.
- New warnings: a code named in "adds up with" that no coupon has. A coupon it adds up with is no stacking warning.
- Single products out of a discount on the store's groups: a ticked group opens the list of its products (thumbnail, name, variant, SKU), all ticked, with select all / clear all, a search and a count ("12 of 13"). An unticked product is saved as one more target rule, `items.variant_id` "ne" the left-out variants (Medusa joins target rules with AND and reads "ne" on a list as "none of them"), so products added to a group later are in the discount too. Nothing unticked: no rule, the coupon as before. The edit form reads the rule back and changes only it, a copy keeps it, the sentence and the preview say "without: ...". The list comes from `GET /admin/coupons/lookups/pool-products?pool=` (the store's `storeTerms.poolProducts`, or the products the group's target names).

### Editing

- The edit form is built like the creator: 1. what it gives (the type, the value or buy X get Y, the categories or product groups it lands on, how it counts), 2. for whom (the same five audiences, a customer condition kept with its groups), 3. how it works (code, dates, uses, minimum, orders per customer, adding up, the note). On the right the coupon as the customer sees it, the sentence after saving and the list of what changes.
- Categories and product groups are edited too (`batchPromotionRulesWorkflow` on the target rules, and on the buy rules of Medusa's buy X get Y); buy X get Y numbers, retail ("is not" groups) and the store's terms as well. A rule the form has no field for is still kept and named.
- Pause and turn on from the edit form's header and from a row's menu, not only from the detail.
- A customer replaces the store's "nobody left" marker (option `nobodyCustomerId`), and the sentence says "for nobody right now" for it.

### Copies

- Duplicate from a row, the detail or the edit form: the same form with a new code (the first number goes up: 7GRATIS1 gives 8GRATIS1) and the changes on top, saved as a new coupon. `POST /admin/coupons/:id/duplicate` with `{ code, patch }` copies every rule, target and buy rule, the dates into a campaign of its own and the store's terms; the original stays as it is. `duplicateCoupon` in `@koda-plus/medusa-plugin-coupons/workflows`.

### The sentence

- Names the product groups, product tags, buy X get Y with its numbers, the price of a free piece, from N pieces, the price lists, retail ("for everyone except"), a customer within groups, orders per customer, the cart value, and which coupons it adds up with or never goes with.

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
