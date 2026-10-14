# Coupons by Koda Plus

Coupons on top of Medusa promotions, for people who make discounts every week and do not want to build them rule by rule. A creator in three steps (the type, for whom, the rules), every coupon described in one plain sentence, warnings before saving, and what each coupon brought: uses, discount, order value and new customers.

Every coupon the creator saves is an ordinary promotion of Medusa's own promotion module. The cart, the order, invoices and every other module see it exactly as they see a promotion made by hand, and Medusa's promotion page still edits it.

## What it does

- A page under Extensions: tiles (active, scheduled, orders with a coupon and the discount given in 30 days, coupons ending within 7 days, automatic coupons for everyone), the list of every promotion in one sentence, its uses and what it brought, and a coupon's detail with its latest orders, a pause and a link to Medusa.
- The creator: percent off the order, an amount off the order, free delivery or percent off chosen categories; for everyone, for customer groups or for one customer; with a code or automatic; until the end of the month, 30 days, own dates or no end; single use, 100 uses, no limit or an own number; an order minimum.
- Warnings before saving: an automatic coupon with no group reaches everyone, logged-in groups with their own prices included; groups with own prices named in the options; another automatic coupon on the same part of the order; half price or more; an amount off with no minimum; no end and no limit; a code that is taken.
- Cards on the order (which coupons worked and what each gave), the customer (the codes used, the coupons made for them or their groups) and the product (active coupons that reach it).
- The koda.integration/1 routes, so Koda Plus hosts show the same lines and counters.

## Requirements

Medusa 2.12 or newer. No migrations: the plugin keeps no tables.

## Installation

```bash
npm install @koda-plus/medusa-plugin-coupons
```

```ts
module.exports = defineConfig({
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-coupons",
      options: {
        currencyCode: "pln",
        memberGroupIds: ["cusgroup_..."],
        codePrefix: "SHOP",
      },
    },
  ],
})
```

## Options

- `currencyCode`: the currency of amount coupons and minimums. Default `pln`.
- `memberGroupIds`: customer groups of logged-in members with their own prices (B2B, wholesale). The creator warns when an automatic coupon reaches them. Default: none named.
- `codePrefix`: a prefix for the codes the creator suggests. Default none.

Nothing breaks the boot: a wrong value falls back to its default and is listed in Settings.

## How a coupon is saved

- Percent off the order: `application_method` percentage on `order`, allocation `across`.
- Amount off the order: fixed on `order` with its `currency_code`, plus the currency rule Medusa's own creator adds.
- Free delivery: 100 percent on `shipping_methods`, allocation `across`.
- Percent off categories: percentage on `items`, allocation `across`, a target rule on `items.product.categories.id`.
- Groups: a rule on `customer.groups.id`; one customer: a rule on `customer.id`; a minimum: a rule `item_total gte`.
- Dates: a campaign with `starts_at` and `ends_at`; a limit: the promotion's `limit`.

Use is counted from orders (promotion adjustments on order lines and shipping methods, canceled orders left out), not from the promotion's counter.

## Works with Koda Plus hosts

- `GET /admin/coupons/integration`, `/integration/summary?entity=order|customer|product&id=`, `/integration/attention?scope=integration`.
- Widget ids: `coupons.order`, `coupons.customer`, `coupons.product`.
- Counters: `expiring` (blue), `automatic_everyone` (orange).

## Public API

`@koda-plus/medusa-plugin-coupons/workflows`: `listCoupons`, `couponDetail`, `customerCoupons`, `orderCoupons`, `productCoupons`, `lookups`, `searchCustomers`, `createCoupon`, `setCouponStatus`, `couponsIntegration`. `@koda-plus/medusa-plugin-coupons/modules/coupons`: the module and its types. Every other path is internal.

## Security

Writes to `/admin/coupons*` need a JSON body or the `x-koda-request` header (the kit's write guard), so a form on another site cannot create a coupon with an admin's session. The plugin reads nothing a shopper can set through the Store API.

## Uninstall

Remove the plugin from `medusa-config.ts`. The coupons stay: they are Medusa promotions.

## Compatibility

Built and tested on Medusa 2.15, works from 2.12. Node 20 or newer.

## License

MIT. See https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-coupons/LICENSE
