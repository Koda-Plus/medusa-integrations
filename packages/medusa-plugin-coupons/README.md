# Coupons by Koda Plus

Coupons on top of **Medusa's own promotions**, for people who make discounts every week and do not want to build them rule by rule. A creator in three steps (the type, for whom, the rules), every coupon described in one plain sentence, warnings before saving, editing of what changes day to day, and what each coupon brought: uses, discount, order value and new customers. Cards on the order, customer and product pages show which coupons worked or apply there.

**No tables of its own.** Every coupon the creator saves is an ordinary promotion of Medusa's promotion module (with a campaign for its dates). The cart, the order, invoices and every other module see it exactly as they see a promotion made by hand, Medusa's promotion page still edits it, and removing the plugin leaves every coupon in place.

## What it does

- **Coupons page** under Extensions, with a Panel, a Setup guide and Settings. Tiles: all coupons, active, scheduled, orders with a coupon and the discount given in the last 30 days, coupons ending within 7 days, automatic coupons for everyone. The list of the newest 300 promotions, each in one sentence with its status, uses, orders, discount and order value, filtered by status (active, scheduled, ended, paused, automatic, ending soon) and searchable by code.
- **One plain sentence per coupon**: what it gives (percent or amount off the order, the items or the delivery, free delivery, buy X get Y), on what (categories, products, collections, delivery types and options by name), for whom (everyone, groups, customers), in which sales channels and regions, from which minimum and until when. A rule the plugin does not know is still named, with its values.
- **A coupon's detail**: the sentence, uses, orders, discount, order value and new customers, the latest 25 orders (a customer's first order marked), a pause (and back on), Edit and a link to Medusa's promotion page.
- **The creator**: percent off the order, an amount off the order, free delivery or percent off chosen categories; for everyone, for customer groups or for one customer; with a code or automatic; until the end of the month, 30 days, own dates or no end; single use, 100 uses, no limit or an own number; an order minimum. A preview shows the coupon as the customer sees it, with an example cart.
- **Warnings before saving**: an automatic coupon with no group reaches everyone, logged-in groups with their own prices included; an automatic coupon reaches a group named in `memberGroupIds`; another automatic coupon is active on the same part of the order; half price or more; an amount off with no minimum; open for everyone with no end and no limit; a code that is taken.
- **Editing** from a row of the list or from the detail: the code, code or automatic, the value, the dates, the uses allowed, the order minimum and who it is for. Everything else of the promotion stays as it is.
- **Cards** on the order (which coupons worked and what each gave), the customer (the codes used, the coupons made for them or their groups) and the product (active coupons that reach it).
- **Works with Koda Plus hosts**: the koda.integration/1 routes, so a host shows the same lines and counters.

## Features

- **Plain Medusa promotions**: written only through Medusa's own workflows (`createPromotionsWorkflow`, `updatePromotionsWorkflow`, `createCampaignsWorkflow`, `updateCampaignsWorkflow`, `batchPromotionRulesWorkflow`), read through Query. Nothing to migrate, nothing to sync, nothing that can drift from what Medusa keeps.
- **Use from orders**, not from the promotion's counter: the promotion adjustments on order lines and shipping methods of orders that were not canceled, so the discount, the order value, the first orders of new customers and the last use come with it.
- **Built for B2B stores**: name the groups that have their own prices and the creator warns before an automatic coupon reaches them too.
- **Stores with their own promotion logic**: `codeInDescription` counts the adjustments a store writes itself, and `storeRules` puts the store's own rule into the sentence.
- **The same checks twice**: the admin runs the creator's and the edit form's checks live, the server runs them again before it writes.
- **Never breaks the boot**: every option has a default, a wrong value falls back to it and is listed in Settings and in the log.
- **Admin in English and Polish**, with "Copy prompt" for an AI agent and help on the Koda Plus Discord.
- No demo mode: the page always shows the store's own promotions.

## Requirements

- Medusa 2.12 to 2.21 and Node.js 20+ (see Compatibility).
- Medusa's promotion, customer, product and order modules (in every Medusa app by default) on PostgreSQL.

## Installation

```bash
npm install @koda-plus/medusa-plugin-coupons
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-coupons` or `pnpm add @koda-plus/medusa-plugin-coupons`. The plugin keeps no tables, so there is no migration to run.

## Setup in brief

The admin page has the guide too (Coupons, then Setup guide).

1. **Install the plugin** (above).
2. **Register it** in `medusa-config.ts` (below). Every option has a default; name the groups of logged-in members with their own prices in `memberGroupIds`.
3. **Restart Medusa** and open **Coupons** under Extensions in the admin sidebar. Every promotion you already have shows up in the list.
4. **Create the first coupon**: New coupon, then the type, for whom and the rules. The sentence and the warnings show what customers get before you save.
5. **Check it in a cart**: apply the code in the store, or open a cart that matches an automatic coupon. The order page then shows which coupon worked and what it gave.

## Configuration

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-coupons",
      options: {
        // Everything is optional.
        currencyCode: "pln",
        // Groups with their own prices: the creator warns when an automatic coupon reaches them.
        memberGroupIds: ["cusgroup_01EXAMPLEB2B", "cusgroup_01EXAMPLEWHOLESALE"],
        codePrefix: "SHOP",
        // codeInDescription: true, // the store writes its own adjustments as "CODE: ..."
        // storeRules: async (scope, promotionIds) => ({
        //   promo_01EXAMPLE: { text: "Every seventh item free", replacesDiscount: true },
        // }),
      },
    },
  ],
})
```

The plugin's module registers in the container as `koda_coupons`, never `coupons` or `promotion`, so it collides with no module of the store.

### Options

- `currencyCode` (string, default `pln`): the currency of amount coupons and order minimums, three letters. The creator offers the store's supported currencies and starts from this one when the store supports it, otherwise from the store's default currency.
- `memberGroupIds` (array of customer group ids, default none): the groups of logged-in members with their own prices (B2B, wholesale). The creator marks them "own prices" and warns when an automatic coupon would reach them; without the option the warning speaks of logged-in groups in general. Ids that are not ids are dropped.
- `codePrefix` (string, default none): a prefix for the codes the creator suggests, letters and digits, at most 12, in capitals (`SHOP` gives `SHOP-AUTUMN15`).
- `codeInDescription` (boolean, default `false`): `true` when the store writes its own adjustments for some promotions, without a promotion id (so Medusa does not remove them on its own refresh) and with a description that starts with the code and a colon (`SHOP7: 1 free`). Those count as the coupon's uses, discount and orders.
- `storeRules` (function, default none): `(scope, promotionIds) => Promise<Record<string, { text: string; replacesDiscount?: boolean }>>`, for a store whose cart applies some promotions with logic of its own (a free item for every seven, a price list as the floor) while Medusa keeps only a marker of them. Given the promotion ids on the page, it answers a plain description per id; the text joins the coupon's sentence, and `replacesDiscount: true` says Medusa's value is only the marker (often 0.001%, because Medusa takes no zero), so the sentence shows the store's rule in its place. It is called with the request scope, so it can resolve the store's own modules. An error in it reads as no rules and never fails the page. Set it in code: a function cannot come from an environment variable.

A wrong value falls back to its default, is written to the log at start ("Ignored option values") and is listed in Settings. Missing options never break the boot.

## How a coupon is saved

- Percent off the order: `application_method` percentage on `order`, allocation `across`.
- Amount off the order: fixed on `order` with its `currency_code`, plus the currency rule Medusa's own creator adds.
- Free delivery: 100 percent on `shipping_methods`, allocation `across`.
- Percent off categories: percentage on `items`, allocation `across`, a target rule on `items.product.categories.id`.
- Groups: a rule `customer.groups.id in`; one customer: a rule `customer.id`; a minimum: a rule `item_total gte`.
- Code or automatic: the promotion's `code` and `is_automatic` (an automatic promotion needs a code in Medusa too, the customer never types it).
- Dates: a campaign with `starts_at` and `ends_at`; no dates, no campaign. A limit: the promotion's `limit`.
- Pause: the promotion's status `inactive`, and `active` to turn it back on. An expired coupon stays expired: its dates live in the campaign.

## How use is counted

- From orders: the promotion adjustments on order lines (`order_line_item_adjustment`) and shipping methods (`order_shipping_method_adjustment`) of every order in its current version that was not canceled, read with one SQL query per page. The discount is the sum of the adjustments, the order value the order's current total, a new customer one with no earlier order that was not canceled.
- The uses shown are the larger of Medusa's own counter (the promotion's `used`, or the usage budget of its campaign) and the orders found.
- Medusa does not count the uses of a promotion that applies by itself: an automatic coupon without a limit shows "automatic" in the uses column, and the orders column says how many orders used it.
- With `codeInDescription`, an adjustment without a promotion id counts for the coupon whose code starts its description before a colon.

## Editing a coupon

Edit, in a row of the list or in a coupon's detail, opens a form with what a person changes day to day: the code, code or automatic, the value (for percent and amount coupons), the dates, the uses allowed, the order minimum and who it is for (groups and single customers). The sentence after saving and the warnings update while you type: a used coupon gets a new code (customers who know the old one have to type the new one), an automatic coupon becomes one for everyone, the last group or customer is removed, the dates belong to a campaign other coupons share.

The form sends `POST /admin/coupons/:id` with `{ "patch": { ... } }`:

- A key left out stays as it is; `null` clears the dates, the limit or the minimum; a value equal to the current one writes nothing (`changed: false`).
- Dates are ISO strings, taken as the moment the person picked in the browser's time zone.
- The dates go to the coupon's campaign, or to a new campaign when it had none. The uses allowed go where they live: the promotion's own limit, or the usage budget of its campaign. Uses allowed cannot go below the uses so far.
- Only the audience and minimum rules the patch changes are replaced, in the form the plugin reads them (`in` or `eq`, `gte` or `gt` for the minimum); an exclusion (`ne`) stays.
- Product, category and collection targets, buy X get Y, delivery methods, sales channels, regions and other rules are never written: the form lists them as kept, and they stay on Medusa's promotion page. So does deleting a coupon.
- The answer is `{ coupon, warnings, changed }`. 400 with the keys of what is wrong, 409 when the code is taken, 404 when the coupon is gone; Medusa's own refusals answer 400 in its words.

## Admin API

Every route is behind Medusa's admin authentication. Every `GET` only reads; the writes go through Medusa's promotion workflows.

- `GET /admin/coupons`: the newest 300 promotions as coupons with their use, the names their rules point to, the tiles, and the options in use (currency, code prefix, member groups, ignored values).
- `POST /admin/coupons` with the creator's input (`kind`, `value`, `categoryIds`, `audience`, `groupIds`, `customerId`, `mode`, `code`, `validity` of `month`, `30d`, `none` or `custom` with `startsAt` and `endsAt`, `limit`, `minimum`, `currencyCode`): creates the promotion and its campaign. 201 with `{ coupon, warnings }`, 400 with the keys of what is missing, 409 when the code is taken.
- `GET /admin/coupons/:id`: the coupon, its names and its latest 25 orders.
- `POST /admin/coupons/:id` with `{ "status": "active" | "inactive" }`: pause it or turn it back on. With `{ "patch": { ... } }`: the edit, see Editing a coupon.
- `GET /admin/coupons/lookups`: customer groups (marked when named in `memberGroupIds`), categories and the store's currencies, for the creator.
- `GET /admin/coupons/lookups/customers?q=`: up to 10 customers by name, company or e-mail (at least 2 characters), for "one customer".
- `GET /admin/coupons/for/order/:id`, `/for/customer/:id`, `/for/product/:id`: the data of the cards.
- `GET /admin/coupons/integration`, `/integration/summary`, `/integration/attention`: the koda.integration/1 contract, see Works with Koda Plus hosts.

An error of the creator or the edit answers `{ code: "coupon_invalid", message, errors }`; any other failure answers 500 with `{ code: "coupons_unavailable", message }` and a plain sentence, the details stay in the server log. No route uses DELETE.

## Use it from your code

```ts
import { listCoupons, updateCoupon } from "@koda-plus/medusa-plugin-coupons/workflows"

const { coupons } = await listCoupons(container)
const autumn = coupons.find((c) => c.code === "AUTUMN15")
if (autumn) {
  // Longer and with more uses; null would clear the end date or the limit.
  const { changed, warnings } = await updateCoupon(container, autumn.id, { endsAt: "2026-11-30T22:59:00.000Z", limit: 500 })
}
```

Also exported: `couponDetail`, `customerCoupons`, `orderCoupons`, `productCoupons`, `lookups`, `searchCustomers`, `createCoupon`, `setCouponStatus`, `CouponInputError` and `couponsIntegration`. They read through Query and write through Medusa's own promotion workflows, the same as the admin.

## Works with Koda Plus hosts

An app that shows every Koda Plus plugin in one place (like [medusa.koda.plus](https://medusa.koda.plus/app/orders?demo=en)) reads Coupons through the shared contract `koda.integration/1`:

- `GET /admin/coupons/integration`: the manifest (mode `live`, the widgets, ignored option values as a problem).
- `GET /admin/coupons/integration/summary?entity=order|customer|product&id=` (or `ids=`, up to 50): one line per order (the coupon that worked and the discount, or how many), per customer (the codes used and what they saved) and per product (how many active coupons reach it).
- `GET /admin/coupons/integration/attention?scope=integration`: the counters `expiring` (blue, active coupons ending within 7 days, `/coupons?status=expiring`) and `automatic_everyone` (orange, active automatic coupons for everyone, `/coupons?status=automatic`).
- The cards register as `coupons.order`, `coupons.customer` and `coupons.product` for the zones `order.details`, `customer.details` and `product.details`; a host that claims the zone shows them as tabs, and each hides itself when there is nothing to show. Without a host they sit in Medusa's side column.
- The page opens on deep links: `/coupons?status=active` (or `scheduled`, `ended`, `paused`, `automatic`, `expiring`) and `/coupons?q=SHOP`.

## Public API

What other code may import: `@koda-plus/medusa-plugin-coupons/workflows` (the reads and writes above), `@koda-plus/medusa-plugin-coupons/modules/coupons` (the module, `CouponsPluginOptions`, `StoreRule` and the response types, `CouponPatch` and `UpdateResponse` among them) and `/admin`. Every other path is internal and may change in any release.

## Security

- **Writes from the admin or a server only**: requests to `/admin/coupons*` that write take a JSON body or the `x-koda-request` header and answer 415 otherwise (the kit's write guard), so a form on another site can never create or change a coupon with an admin's session (Medusa's session cookie is `SameSite=None` in production). The plugin's admin sends both, and works for admins signed in with a JWT.
- **No store routes, no metadata**: the plugin adds nothing to the Store API and reads nothing a shopper can set (no order or cart metadata). Use comes from Medusa's own adjustment rows.
- **Medusa's own rules**: every write goes through Medusa's promotion workflows, so the promotion module checks it as it checks a promotion made on its own page; the plugin checks a taken code and a limit below the uses so far first, to answer in words. The SQL behind the counts only reads and takes every id as a bound parameter.
- **Personal data**: the customer search and the cards show a customer's name, company or e-mail to admins, as Medusa's own pages do; a coupon's latest orders show the order's e-mail. Nothing is stored by the plugin.
- **Who can use it**: every admin user and secret API key of the Medusa admin can read, create, edit and pause coupons (Medusa has no public roles API for it yet).

## What this plugin does not do

- It does not delete coupons, and it does not edit targets, buy X get Y, delivery methods, sales channels or regions: Medusa's promotion page does.
- It does not change how the cart applies promotions: Medusa's promotion module does, exactly as for a promotion made by hand.
- It does not send coupons to customers: put the code in your newsletter or your e-mails.
- It does not keep a history of its own: what a coupon brought is read from the orders every time.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers the options, the sentence of every kind of promotion, the creator's checks, warnings and the promotion it builds, the edit form's checks, the rules it replaces and keeps and its warnings, and the koda.integration/1 contract, without a network or a build. Running the tests needs Node.js 22.6+ (they load the TypeScript sources directly).

## Uninstall

1. Remove the plugin from `plugins` in `medusa-config.ts` and the package from `package.json`.
2. Nothing else to clean: the plugin keeps no tables, no jobs and no subscribers. Every coupon stays as a Medusa promotion (with its campaign) and keeps working in the cart; Medusa's promotion page edits it. An app that hosts the cards shows one tab fewer.

## Compatibility

Medusa 2.12 to 2.21 (peer range `^2.12.0`) and Node.js 20+; built and tested on Medusa 2.15. The counts read Medusa's order tables of the 2.x schema (`order`, `order_item`, `order_shipping`, `order_summary`, the line item and shipping method adjustments) and its `promotion` table. The admin libraries (`@medusajs/ui`, `@medusajs/icons`, `@tanstack/react-query`, `react`, `react-i18next`, `react-router-dom`) are optional peers: the app keeps the copies of Medusa's dashboard.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland, next to our Fakturownia, Stripe, BaseLinker, Allegro, OLX and Subiekt nexo integrations. Need a promotion flow of your own? Write to kontakt@koda.plus.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-coupons/LICENSE).

## Changelog

### 0.1.0 (unreleased)

First release: the coupons page with tiles, every promotion in one sentence and its use from orders, the creator in three steps with a preview and warnings, editing from the list and the detail (`POST /admin/coupons/:id` with `{ patch }`), the options `memberGroupIds`, `codePrefix`, `codeInDescription` and `storeRules`, cards on the order, customer and product pages, and the koda.integration/1 contract. Full list in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-coupons/CHANGELOG.md).
