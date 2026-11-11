# Ceneo by Koda Plus

Your Medusa catalog on Ceneo, the Polish price comparison site: the Ceneo XML offer feed with Ceneo categories and attributes, the problems that keep a product off the comparison, Zaufane Opinie (trusted reviews) after every order, Kup Teraz orders in Medusa and the CPC bids, from one page in the admin.

Work in progress: this version has the module, the options, the admin page and the XML feed. Ceneo categories, Zaufane Opinie, Kup Teraz and the bids follow.

## Install

```bash
npm install @koda-plus/medusa-plugin-ceneo
npx medusa db:migrate
```

```ts
module.exports = defineConfig({
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-ceneo",
      options: {
        feed: {
          token: process.env.CENEO_FEED_TOKEN,
          productUrl: "https://shop.example.com/pl/products/{handle}?variant={variant_id}",
        },
        demo: process.env.CENEO_DEMO === "true",
      },
    },
  ],
})
```

Every option is optional and nothing stops Medusa from starting. The admin page says what is missing.

## Options

- `feed.token`: the secret part of the feed address, `/ceneo/feed/<token>.xml`. 16 to 128 letters, digits, `-` or `_` (`openssl rand -hex 24`). Ceneo reads the feed without a password.
- `feed.productUrl`: the storefront address of a product with placeholders `{handle}`, `{product_id}`, `{variant_id}`, `{sku}`.
- `feed.regionId`, `feed.salesChannelId`: where prices and products come from. Default: the first region in PLN and the default sales channel.
- `feed.offerId`: `variant_id` (default, never changes) or `sku`.
- `feed.inStockAvail` (default 1), `feed.backorderAvail` (default 7): the Ceneo `avail` values 1, 3, 7, 14, 90, 99 or 110.
- `feed.outOfStock`: `skip` (default) or `check` (`avail` 99).
- `feed.intervalMinutes`: minutes between builds, default 30.
- `reviews.accountGuid`, `reviews.workDays`: Zaufane Opinie.
- `apiKey`: the Ceneo API key from Panel Ceneo, for Kup Teraz and the bids.
- `demo`: simulated Ceneo API, rows flagged demo.

## The feed

The job `ceneo-build-feed` wakes every 5 minutes and builds the file every `feed.intervalMinutes`, and within 10 minutes after a product or variant changes (never more often than every 5 minutes). The admin button "Build now" builds it at once. Ceneo reads `GET /ceneo/feed/<token>.xml` on the backend: the newest successful build, as built, with an ETag. A failed build keeps the previous file served. A scheduled build that would take more than half of the offers off Ceneo at once (or all of them) fails on purpose; "Build now" publishes a smaller file, never an empty one.

What goes into the file:

- One offer per variant of the published products in the sales channel. The id is the variant id (or the SKU); an id once used is never given to another variant.
- The calculated price of the region, gross, in PLN. A region whose prices exclude tax gives no offers: set the price preference of the region to tax inclusive.
- `avail` and `stock` from the inventory of the channel's stock locations.
- The most specific Medusa category as the path, the images (thumbnail first, at most 20), the description, `EAN` and `Kod producenta`.

Every variant left out has its reason on its offer row (a missing price, a missing handle for the address, a SKU used twice, and so on).

## License

MIT
