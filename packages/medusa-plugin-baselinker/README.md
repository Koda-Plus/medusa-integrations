# BaseLinker by Koda Plus

Connect Medusa to **BaseLinker** (Base, base.com), the order and warehouse hub most Polish online stores run their marketplaces through, in both directions. You decide where the catalog lives and whose stock is the truth, and the plugin carries the rest: it links Medusa variants to BaseLinker cards or creates the missing cards, imports BaseLinker products when the catalog lives there, carries stock and prices the way you chose, sends store orders to BaseLinker exactly once, imports Allegro, Amazon and other marketplace orders into Medusa exactly once, and keeps statuses, parcels, returns and invoice numbers in step.

Every write that changes data ships switched off. It waits behind a plan your team reads item by item, and behind a writer a person arms in the admin, with their name and the date next to it.

![BaseLinker page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-baselinker/docs/admin-baselinker.png)

**Live demo:** Medusa admin [medusa.koda.plus/app/baselinker](https://medusa.koda.plus/app/baselinker?demo=en), signed in to a public demo account by the link itself, and the storefront [demo.koda.plus](https://demo.koda.plus). The demo runs the plugin in demo mode, so every screen has data: place an order in the storefront and watch it reach "Wysłane" with a tracking number a few minutes later, read the plans, arm a writer, and watch simulated Allegro and Amazon orders become Medusa orders. The **Setup guide** view (`?view=guide`) walks through a real setup step by step.

## What it syncs

- **Card links** (BaseLinker card to Medusa variant, by SKU, then EAN): read only, every hour at minute 15 and on **Sync cards now**. Variant cards are read too; a main card that has variants is a container and is never linked itself.
- **Catalog from BaseLinker** (with `catalogSource: "baselinker"`): products and variants with the price of one price group, SKU, EAN, weight, images, description, category and manufacturer, into Medusa after every complete read. Planned; applied by the `catalogImport` writer.
- **Cards from Medusa** (with `catalogSource: "medusa"`, the default): a new BaseLinker card for each variant that has none (name, SKU, EAN, weight, description, images, and the price and stock where they are known), and the name and EAN of linked cards kept in step. Planned; applied by the `cards` writer.
- **Stock, BaseLinker to Medusa** (with `stockSource: "baselinker"`, the default): one BaseLinker warehouse into Medusa inventory levels. Planned; applied by the `stockToMedusa` writer.
- **Stock, Medusa to BaseLinker** (with `stockSource: "medusa"`): what Medusa can still sell, into one `bl_` warehouse. Planned; applied by the `stockToBaseLinker` writer.
- **Prices, Medusa to BaseLinker** (catalog in Medusa and `priceGroupId` set): the Medusa price in `priceCurrency`, gross, into the price group. Planned; applied by the `prices` writer. With the catalog in BaseLinker, prices come in with the catalog import instead.
- **Store orders** (lines, prices, shipping address, invoice data, payment and cash on delivery flags): Medusa to BaseLinker on `order.placed`, then every 2 minutes for retries, and on **Send to BaseLinker now**.
- **Marketplace orders** (the BaseLinker order sources you choose: Allegro, Amazon, eBay, Erli and the rest): BaseLinker to Medusa, found every 5 minutes, created by the `orderImport` writer, exactly once each.
- **Order status and tracking** (status name, parcel number, carrier, tracking link): BaseLinker to Medusa order metadata, for sent and for imported orders, every 15 minutes (from the BaseLinker order journal when it is enabled) and on **Read statuses**.
- **Fulfillment and cancellation**: the Medusa fulfillment of the remaining items when BaseLinker reaches one of `fulfillOnStatusIds` (imported orders need `orderImportShippingOptionId` for that); an imported order is cancelled in Medusa when BaseLinker reaches one of `orderImportCancelStatusIds` and nothing is fulfilled yet, and flagged for a person otherwise. A payment that arrives later in BaseLinker marks the imported order paid.
- **Returns**: the BaseLinker return manager, read only, every hour at minute 45 and on **Read returns**, linked to the Medusa order when the order is one this plugin sent or imported.
- **Invoice numbers**: the number of each invoice or receipt the Fakturownia plugin of Koda Plus issues, into one field of the BaseLinker order. Applied by the `invoiceNumbers` writer.

## Write safety

- **Off until a person arms it.** Seven writers: `catalogImport`, `cards`, `stockToMedusa`, `stockToBaseLinker`, `prices`, `orderImport` and `invoiceNumbers`. Each has two switches. The option `writers: { <name>: false }` is a hard switch: it wins and cannot be overridden from the admin. The arm switch in the admin is stored in the database with who flipped it and when. Both stock writers also need `stockSync: "write"`.
- **Write barrier by method name.** Every `get*` method passes. `addOrder` passes only while `exportOrders` is on. `addInventoryProduct`, `updateInventoryProductsStock`, `updateInventoryProductsPrices` and `setOrderFields` pass only with the permit of the writer that owns them, which a run gets only while that writer is armed. Every other method (`delete*`, `setOrderStatus`, `setOrderPayment`, `addInvoice` and the rest) is blocked by name before a request leaves the process.
- **Plan first.** Catalog, card, stock and price changes are computed as a plan (what changes, from what to what), shown in the admin, and applied only by an armed writer, up to a cap per run. An item that fails `quarantineAfter` runs in a row (3 by default) is quarantined until a person releases it. An incomplete read plans nothing, and an item missing from a read is never zeroed or deleted.
- **Exactly once.** Store orders, marketplace orders and invoice numbers each get a unique row before anything goes to the network and a lease, so a crashed process never leaves a row stuck. Every create is preceded by a lookup: the `[medusa:<order id>]` marker in BaseLinker for store orders, `metadata.baselinker_order_id` and `metadata.marketplace_order_ref` in Medusa for marketplace orders, the SKU in BaseLinker for new cards, the current value of the order field for invoice numbers. An unclear answer is settled by another lookup, never by a blind retry.
- **Retries only for transient errors** (network, timeouts, 5xx responses, the rate limit), with backoff. A refusal about the item itself counts towards its quarantine; an outage does not.

## Features

- **Admin page with two views.** The **Panel**: connection check with everything the account offers (catalogs, warehouses and which of them take stock, price groups, order sources, statuses, custom order fields, journal state), the directions and writers, the plan of every direction in force with its filters and quarantine, the cards, the store orders, the marketplace orders, the returns, the invoice numbers and the history of runs. The **Setup guide**: a diagram of the parts, eleven steps from the token to go-live with a live state each, a go-live checklist ticked from the store itself, and answers to the failures this integration really meets.
- **Order widget** on every order: the BaseLinker order, its status and the tracking link with **Send to BaseLinker now**; for an imported marketplace order its source, payment state and parcel instead. **Product widget** on every product: the linked cards, their BaseLinker stock and the main card they hang under.
- **References** ("Running in production"): stores you pass in the `references` option are shown on the Panel and at the end of the guide.
- **Demo mode**: a simulated BaseLinker account built from your own catalog, with duplicated SKUs and EANs, price groups, both stock directions, Allegro and Amazon orders and returns. Nothing leaves Medusa.
- **Admin in English and Polish.**
- **Workflows and events** for your own code.

## Requirements

- Medusa 2.12 or newer (tested on 2.15.3) and Node.js 20+.
- For a real account: a BaseLinker API token (in BaseLinker: Account & other, My account, API) and a catalog (inventory) with a `bl_` warehouse. The plugin works with catalogs, not with BaseLinker's old storage.
- For marketplace orders: a Medusa region for the order currency and a sales channel whose stock location holds the stock. For invoice numbers: the Fakturownia plugin of Koda Plus (optional, never imported as a package).

## Installation

```bash
npm install @koda-plus/medusa-plugin-baselinker
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-baselinker` or `pnpm add @koda-plus/medusa-plugin-baselinker`.

## Configuration

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-baselinker",
      options: {
        apiToken: process.env.BASELINKER_API_TOKEN,
        inventoryId: process.env.BASELINKER_INVENTORY_ID, // the BaseLinker catalog
        warehouseId: process.env.BASELINKER_WAREHOUSE_ID, // like bl_12345
        orderStatusId: process.env.BASELINKER_ORDER_STATUS_ID, // status of new orders
        customSourceId: process.env.BASELINKER_SOURCE_ID, // recommended
        priceGroupId: process.env.BASELINKER_PRICE_GROUP_ID,
        // catalogSource: "medusa", // or "baselinker"
        // stockSource: "baselinker", // or "medusa"
        // stockSync: "plan", // "off" | "plan" | "write"
        // orderImportSources: ["allegro", "amazon:7245"],
        // writers: { prices: false }, // a hard switch: false wins over the admin
        // demo: true, // simulated BaseLinker built from your catalog, no account needed
      },
    },
  ],
})
```

Run the migrations, then open **BaseLinker** in the admin sidebar and click **Check connection**:

```bash
npx medusa db:migrate
```

## Setup in brief

The **Setup guide** view of the admin page has the same steps, each with its live state.

1. **Create the API token.** In BaseLinker open Account & other, My account, API and generate a token for this store. Put it in `BASELINKER_API_TOKEN`.
2. **Configure the plugin** as above and run `npx medusa db:migrate`. Missing values never break the start: the Panel lists what is missing.
3. **Choose the catalog and the warehouse.** **Check connection** lists the catalogs with their warehouses. Set `inventoryId`, and a warehouse of type `bl` as `warehouseId`: only `bl_` warehouses take stock writes, `shop_` and `warehouse_` ones mirror an external system.
4. **Price group and order statuses.** Check connection lists the price groups and the order statuses. Set `priceGroupId` (a standard group in your currency, not a derived one), `orderStatusId` for new orders, `fulfillOnStatusIds` for shipped, `closedStatusIds` for finished and `orderImportCancelStatusIds` for cancelled.
5. **A custom order source** (recommended). In BaseLinker open Orders, Settings, Custom order sources, create one named after the store and set its id as `customSourceId`.
6. **Decide the source of truth** for each kind of data: the catalog (`catalogSource`), stock (`stockSource`), prices (they follow the catalog) and marketplace orders (`orderImportSources`). Clear the duplicated SKUs and EANs the cards show before any import or push.
7. **Read the plans.** **Sync cards now** reads BaseLinker and makes the plan of every direction in force. Nothing is written.
8. **Arm the writers one at a time**, reading the history after each. Start the cards writer with `maxCatalogChangesPerRun: 1` and look at that one card in BaseLinker.
9. **Marketplace orders** (optional). Set `orderImportSources`, make the store's confirmation e-mail skip orders with `metadata.marketplace_order_ref`, then arm the order import writer.
10. **Invoice numbers** (optional). Choose `invoiceNumberField`, then arm the invoice number writer.
11. **Go live** with the checklist of the guide.

## Options

Every option is optional. Numbers may come as strings (environment variables), lists as comma separated strings. Missing options never break the boot: the module registers, the admin lists what is missing and each job waits for the options it needs. Demo mode never switches itself on in a real store: set `demo: true`, or `demo: !process.env.BASELINKER_API_TOKEN` as the live demo does.

### Connection

- `apiToken`: BaseLinker API token. Stays on the server and is masked in every log, stored error and admin screen.
- `inventoryId`: the BaseLinker catalog (inventory) the cards live in.
- `warehouseId`: the warehouse whose stock counts, like `bl_12345` (a bare number becomes `bl_<number>`). Stock pushed from Medusa needs a `bl_` warehouse.
- `orderStatusId`: the BaseLinker status new store orders get.
- `customSourceId` (optional): a custom order source created in BaseLinker, so Medusa orders are labeled there. It also lets the status read fetch 100 orders per request, and keeps the marketplace import from taking our own orders back.
- `stockLocationId` (optional when the store has one location): the Medusa stock location stock is read from and written to.
- `demo` (default `false`): the simulated BaseLinker account.
- `requestsPerMinute` (default `80`, at most `100`): self-imposed rate limit shared by every job.
- `timeoutMs` (default `20000`): one BaseLinker request.

### Directions, writers and limits

- `catalogSource` (default `medusa`): `medusa` links cards and lets the `cards` writer create the missing ones; `baselinker` lets the `catalogImport` writer import BaseLinker products into Medusa. Prices follow the catalog.
- `stockSource` (default `baselinker`): `baselinker` plans BaseLinker stock into Medusa; `medusa` plans Medusa stock into the `bl_` warehouse.
- `stockSync` (default `plan`): `off` (no stock plan at all), `plan` (plans are stored and shown, nothing is written) or `write` (the stock writer of the direction may be armed). Version 0.1 configurations with `write` keep writing BaseLinker stock into Medusa until a person touches the arm switch.
- `writers` (default: none switched off): hard switches by writer name, for example `{ catalogImport: false, prices: false }`. `false` (or `"false"`) wins over the admin.
- `priceGroupId` (default none): the BaseLinker price group the catalog import reads and the price push writes.
- `priceCurrency` (default `pln`): the Medusa currency of that price group.
- `maxCatalogChangesPerRun` (default `200`): imported products and created or updated cards per run.
- `maxStockChangesPerRun` (default `500`): stock changes per run, in either direction; decreases go first.
- `maxPriceChangesPerRun` (default `1000`): price changes per run.
- `quarantineAfter` (default `3`): failed runs of one item before it is quarantined.
- `catalogSyncEnabled` (default `true`): the hourly read and every plan after it.

### Catalog import (`catalogSource: "baselinker"`)

- `catalogImportStatus` (default `published`): status of the products the import creates, or `draft`.
- `catalogImportSalesChannelId` (default: the store's default sales channel): sales channel of imported products.
- `catalogImportShippingProfileId` (default: the default shipping profile): shipping profile of imported products.
- `catalogImportOptionTitle` (default `Variant`): the option of imported products with several variants; its values are the variant names.
- `createMissingCategories` (default `false`): create Medusa categories that do not exist yet (matched by name). Off, a missing category is only reported.
- `manufacturerAs` (default `metadata`): the manufacturer goes to `metadata.manufacturer`, or to a product tag with `tag` (only the tag naming a BaseLinker manufacturer is ever replaced).
- `draftRemovedProducts` (default `false`): an imported product removed in BaseLinker becomes a draft. Off, it is only reported. Nothing is ever deleted.
- `weightUnit` (default `g`): the unit of Medusa weights, `g` or `kg`. BaseLinker uses kilograms.

### Store orders to BaseLinker

- `exportOrders` (default `true`): send placed orders to BaseLinker.
- `fulfillOnStatusIds` (default none): BaseLinker status ids that create the Medusa fulfillment for the remaining items.
- `closedStatusIds` (default none): BaseLinker status ids after which an order is no longer read. Without them, orders are followed for 30 days.
- `codProviders` (default `pp_cod`, `pp_cash`): payment provider id prefixes meaning cash on delivery.
- `paymentLabels` (default: built-in English names): payment method names shown in BaseLinker by provider id prefix, for example `{ pp_cod: "Pobranie", pp_stripe: "Karta / BLIK" }`. Up to 30 characters each.
- `skipOrderMetadataKey` (default `baselinker_skip`): an order with `metadata[key] === true` never goes to BaseLinker. Use it for test orders.
- `exportMarketplaceOrders` (default `false`): orders another plugin took straight from a marketplace (they carry `metadata.marketplace_order_ref`) go to BaseLinker too. Off by default, because BaseLinker usually gets them from its own marketplace integration.

### Marketplace orders into Medusa

- `orderImportSources` (default none, nothing is imported): BaseLinker order sources to import, as types or `type:id`, for example `["allegro", "amazon:7245"]` or `"allegro,erli"`. The ids come from Check connection.
- `orderImportRegionId` (default: the region of the order currency): region of imported orders.
- `orderImportSalesChannelId` (default: the store's default sales channel): sales channel of imported orders.
- `orderImportShippingOptionId` (optional): shipping option of imported orders. With it, `fulfillOnStatusIds` fulfills them too.
- `orderImportCancelStatusIds` (default none): BaseLinker statuses that cancel the imported Medusa order while nothing is fulfilled.
- `orderImportSince` (default: 24 hours before the first discovery): ISO date of the first orders to read.
- `orderImportMaxAgeHours` (default `72`): an order older than this when the writer reaches it waits for a person instead of being imported.

### Returns, journal, invoice numbers, references

- `returnsSync` (default `true`): read returns, read only.
- `returnsWindowDays` (default `30`): returns of the last N days.
- `journal` (default `auto`): `auto` reads statuses from the BaseLinker order journal when it returns events, with a full read every 2 hours and after a gap of more than 2 days; `off` always reads the full way.
- `invoiceNumberField` (default `extra_field_1`): the BaseLinker order field for invoice numbers: `extra_field_1`, `extra_field_2` or a custom order field id (`135` or `custom:135`).
- `invoiceNumberKinds` (default `vat`, `receipt`): Fakturownia document kinds whose number is written.
- `references` (default none): stores running this integration, shown as "Running in production": `[{ name, url, description?, metrics?, links?, soon? }]`, texts as strings or `{ en, pl }`. `soon: true` marks a store that starts on Medusa soon: it is shown with a "Soon" badge and no link, and its `url` is optional. Entries without a name, or live entries without an https URL, are dropped, never an error.

## How linking works

1. The whole catalog is read with `getInventoryProductsList` and `include_variants`, 1 000 cards per page, from page 1 until a short page. A failed page or the page ceiling makes the read incomplete.
2. A main card that has variants is a container: stored and shown, never linked. Its variant cards are linked like simple cards.
3. Every card is looked up by SKU, uppercased and trimmed on both sides. A SKU that sits on two or more cards is a `duplicate_sku` conflict; two variants with one SKU are an `ambiguous_variant` conflict. Neither is linked.
4. A card the SKU did not settle is looked up by EAN (digits only, 8 to 14), with the same rules (`duplicate_ean`). A variant is linked to at most one card, and a SKU link wins over an EAN link.
5. A complete read replaces the snapshot. An incomplete read only adds and updates: a card missing from a broken list looks exactly like a deleted one, so nothing is unlinked.
6. Variants with a SKU that no card carries are counted as "only in Medusa".

Why so strict: on a production account we measured 12 993 cards carrying 8 522 distinct SKUs, and at a tyre retailer with about 11 000 cards, 4 438 SKU pairs were the same physical item entered twice. Linking "the first one" would send stock and orders to a random copy.

## Catalog import (plan first)

With `catalogSource: "baselinker"`, every complete read is followed by `getInventoryProductsData` (100 cards per request), `getInventoryCategories` and `getInventoryManufacturers`, and a plan:

- **Create**: a BaseLinker product with no Medusa counterpart becomes a Medusa product with its variants (one option, `catalogImportOptionTitle`), the price of `priceGroupId`, SKU, EAN, weight, images in BaseLinker's order, description, category (by name) and manufacturer, and `metadata.baselinker_product_id`. The new variants are linked to their cards at once.
- **Update**: a linked product whose title, description, images, category, manufacturer, variant title, price, EAN or weight differs is updated field by field; unchanged fields stay out of the write. A new BaseLinker variant of an imported product adds an option value and a variant.
- **Draft**: an imported product removed in BaseLinker, only with `draftRemovedProducts`.
- **Skip or conflict, with the reason**: bundles, cards without a SKU, duplicated SKUs or EANs, a SKU on two Medusa variants, variants spread over two Medusa products, a new variant of a product the import did not create, a missing category while `createMissingCategories` is off.

The import is idempotent by the BaseLinker id: a product it created is found by `metadata.baselinker_product_id` and its variants by their card links, so a second run updates instead of creating again. Writes go through Medusa's own workflows (`createProductsWorkflow` in batches of 10, `updateProductsWorkflow`, `updateProductVariantsWorkflow`) and prices through the Pricing module, which adds or replaces only the base price of `priceCurrency` and leaves every other price alone. BaseLinker prices are gross: for net Medusa prices they are divided by the product's VAT rate, and a product without a rate gets no price change at all.

## Cards from Medusa (plan first)

With `catalogSource: "medusa"`, every complete read is followed by the card plan:

- **Create** a card for a variant that has none: name (product and variant title, up to 200 characters), SKU, EAN, weight in kilograms, description, up to 16 images, the price in `priceGroupId` when Medusa prices include tax, and the first stock when Medusa is the source of stock. Each variant becomes its own card; grouping cards under a main card stays a decision made in BaseLinker.
- **Update** a linked card whose name or EAN no longer matches Medusa. Only those two fields are sent: prices and stock have their own plans.
- **Never a second card for the same goods.** A variant whose SKU already sits on any card, or whose EAN sits on a card with another SKU, is a conflict. Before every create the plugin looks the SKU up in BaseLinker, and after an unclear answer it looks again instead of creating twice. A SKU longer than the 50 characters BaseLinker keeps is skipped, never sent cut.

The created card is linked to its variant at once, so the next plans (stock, prices) already see it.

## Stock in both directions (plan first)

The plan covers linked, conflict-free variants that manage inventory with exactly one inventory item, after every complete read. Kits are skipped, and so is everything after an incomplete read.

- **BaseLinker to Medusa** (`stockSource: "baselinker"`): `target stocked = max(0, BaseLinker stock) + reserved quantity of the level`. BaseLinker reports what can still be sold while Medusa keeps `stocked` before its reservations; adding the reservations back makes Medusa's available quantity equal to BaseLinker's, and an order already sent to BaseLinker does not take the item twice. Applied with Medusa's own `batchInventoryItemLevelsWorkflow`.
- **Medusa to BaseLinker** (`stockSource: "medusa"`): `target = max(0, stocked - reserved)` of the Medusa level, written with `updateInventoryProductsStock` into the `bl_` warehouse, 1 000 cards per request. A level that does not exist is unknown, never zero. A card BaseLinker refuses (its warning names the card) fails alone and counts towards its quarantine.

Both directions write absolute numbers, never deltas, so a repeated write is harmless; decreases go first and `maxStockChangesPerRun` caps a run. Why a plan first: BaseLinker numbers are not always the truth. On a production account we found duplicated cards with different stock, negative stock after overselling and a nightly import that kept raising zeros back.

## Prices (plan first)

With the catalog in Medusa and `priceGroupId` set, the base Medusa price in `priceCurrency` of every linked variant is compared with the card's price in that group and changed ones are written with `updateInventoryProductsPrices`, 1 000 per request, within `maxPriceChangesPerRun`. BaseLinker keeps gross prices: net Medusa prices are multiplied by the card's VAT rate, and a card without a rate is left alone. Before the first write of a run the plugin reads the price groups and writes nothing into a group derived from another one (BaseLinker computes those itself), a group the account does not have, or a group in another currency than `priceCurrency`; Check connection shows the same warnings.

## Store orders exactly once

BaseLinker has no idempotency key, and a mapping row written after `addOrder` cannot protect against a lost answer. So:

1. `order.placed` writes a row in `baselinker_order` first, then sends in the background. The payload is built from the order at send time and never stored, because it carries personal data.
2. Every attempt scans `getOrders` (from the order date minus one hour, unconfirmed orders included, paging by `id_from`) for the marker `[medusa:<order id>]`. Found: that BaseLinker order is adopted and nothing is written.
3. Otherwise one `addOrder`. It is never retried blindly; only a rate limit refusal repeats, because then BaseLinker took nothing.
4. A timeout, a 502 or broken JSON after `addOrder` means "no answer", not "no order": the plugin waits and scans again. Still not found, the row is retried later, and that attempt scans first.
5. Success writes `sent`, the BaseLinker order id and `metadata.baselinker_order_id`, and emits `baselinker.order_sent`. After the backoff runs out (about two and a half days) the row is `failed`, `baselinker.order_failed` is emitted, and a person can **Send again**, which is always safe.

Lines whose variant is linked go to their card (`storage: "db"`, the catalog id, the card id), so stock moves on the right card in BaseLinker. Other lines go as free lines with name, SKU and EAN; the order still arrives. The unit price is the line total after discounts divided by the quantity, the tax rate is the highest rate of the line. `paid` is 1 only when the payment is captured in full; `payment_method_cod` marks cash on delivery by payment provider. Invoice fields go only when the buyer asked for one (`metadata.invoice` or a tax id such as `metadata.invoice_nip`), and InPost lockers from the shipping method data become the delivery point.

Orders that came from a marketplace never go back: an order this plugin imported is skipped, and so is an order with `metadata.marketplace_order_ref` from another plugin unless `exportMarketplaceOrders` is on.

## Marketplace orders into Medusa (exactly once)

**Discovery** runs every 5 minutes while `orderImportSources` is set: `getOrders` from a cursor on `date_confirmed` (confirmed orders only, 100 per page), filtered to the chosen sources. Our own exports (the marker in `admin_comments`) and orders of our custom source are never taken. Each order becomes a `pending` row, one per BaseLinker order id: the admin shows them before anything is created. The cursor starts again at the same second and skips the ids it has seen, so orders confirmed in the same second as a page boundary are not lost.

**Import** runs only while the `orderImport` writer is armed, per row, under a lock on the BaseLinker id:

1. The row's next attempt moves ten minutes ahead first, so a crashed process leaves a row that comes back by itself.
2. An order older than `orderImportMaxAgeHours` waits for a person (**Import now** imports it anyway).
3. The order is read again from BaseLinker. The buyer's data goes onto the Medusa order and nowhere else.
4. **Lookups before create:** a Medusa order with this BaseLinker id is adopted. A Medusa order with the same `metadata.marketplace_order_ref` (taken by another plugin or by hand) makes this one `skipped`. The reference is looked up again inside a lock named `marketplace-order-ref:<ref>`, the key the other marketplace plugins of Koda Plus take for the same order, so the one that comes second sees the first one's order.
5. The order is created as a draft with Medusa's own `createOrderWorkflow` and its id is stored at once, then placed with `convertDraftOrderWorkflow`, which reserves the inventory and emits `order.placed`, just as the admin does with draft orders. Lines of linked cards get their variant, other lines stay custom lines; prices come from the order (gross, `is_tax_inclusive`), taxes from the region, delivery becomes a shipping method with its price, a pickup point goes to the shipping method data, and the e-mail is set on the order itself, never through a guest customer.
6. A payment collection for the total, marked paid through Medusa's `markPaymentCollectionAsPaid` when BaseLinker has the order paid in full. Cash on delivery and unpaid orders stay unpaid until BaseLinker reports the payment.

Why `createOrderWorkflow` and not the cart: Medusa documents it for importing orders from an external system, it takes our own unit prices, checks the inventory, computes tax lines from the region and keeps the shipping method we give it. The cart path would need a payment session and a shipping option the marketplace order never had.

Imported orders carry `metadata.baselinker_imported`, `baselinker_order_id`, `baselinker_order_source`, `baselinker_external_order_id` and `marketplace_order_ref = "<source>:<external order id>"` (lowercased, for Allegro `allegro:<checkout form id>`), plus `no_notification: true`. **`order.placed` is emitted for them on purpose** (invoices, ERP documents and stock follow-ups should see them), so **make your order confirmation e-mail skip orders with `metadata.marketplace_order_ref`**: the marketplace talks to its buyer.

## Statuses and the order journal

Every 15 minutes the plugin reads the status, parcel number and carrier of the orders it sent and of the orders it imported, writes them into order metadata and creates fulfillments or cancellations as described above. With `journal: "auto"` it first asks `getJournalList` for order events since the last one it processed; only the orders with events are read. The journal keeps three days and has to be enabled for the account (Account & other, My account, API, or Base support), so the plugin also reads everything the full way every 2 hours, after a gap of more than 2 days, and for as long as the journal has never returned an event.

## Returns (read only)

Every hour the plugin reads `getOrderReturns` for the last `returnsWindowDays` days with the return statuses and reasons, and shows each return with its products, status, reason, refunded amount and parcel, linked to the Medusa order when the order is one it sent or imported. Buyer data (e-mail, phone, address, bank account, the buyer's comment) is dropped before anything is stored. Nothing is written anywhere.

## Invoice numbers from Fakturownia

When the Fakturownia plugin of Koda Plus emits `fakturownia.document.issued` for an order that is in BaseLinker (sent or imported), the number goes into the order field `invoiceNumberField` with `setOrderFields`, exactly once per document. The field is read first: empty means write, the same number means it is already there, any other value is a conflict for a person and is never overwritten. `extra_field_1` and `extra_field_2` hold 50 characters; a longer number is refused rather than cut. The dependency is soft: the event is subscribed by name, the Fakturownia package is never imported, and a simulated document never reaches a real account. BaseLinker's own `addInvoice` is not used, because it would issue a second invoice in BaseLinker's numbering.

## Demo mode

Without an account, `demo: true` runs every feature against a simulated BaseLinker account built from the store's own catalog, through the same parsers, planners and workflows as live mode. Rows are flagged `demo`, and the admin says it is a simulation on every view.

- **Catalog**: one card per variant, grouped under a main card for products with several variants, plus cards only BaseLinker has (one of them a bundle, one a main card with two variants), a card duplicated under the same SKU, an EAN on two cards, a renamed card and a few changed prices, so every plan has something to show.
- **Account**: two price groups (one derived), a `bl_` warehouse and a shop warehouse that cannot take stock, Allegro and Amazon order sources, a custom order field.
- **Directions**: a visitor may switch the catalog and stock directions in the admin to try each plan; writers "succeed" against the simulation and the next simulated read reflects what they wrote.
- **Orders**: store orders get BaseLinker ids in seconds and are "shipped" with an InPost number a few minutes later. Deterministic Allegro and Amazon orders appear over the day (at most 5 a day, buyers at `@example.com` only); once a visitor arms the order import writer they become real Medusa orders of the demo store, and their statuses move on, one of them cancelled.
- **Returns** and **invoice numbers** are simulated too. Nothing leaves Medusa.

## Admin API

- `GET /admin/baselinker`: configuration summary (never the token), counters, directions, writers with who armed them and when, references, journal state and the last run of each kind. Reads the database only.
- `POST /admin/baselinker/check`: what the account offers, read now.
- `POST /admin/baselinker/sync` with `{ "what": "catalog" | "statuses" | "orders" | "imports" | "returns" | "invoices" }`: run a job now (202, background).
- `POST /admin/baselinker/writers/:key` with `{ "armed": true | false }`: arm or disarm a writer. Refused while the options switch it off.
- `POST /admin/baselinker/directions` with `{ "catalog"?, "stock"? }`: demo mode only, to try the other directions.
- `GET /admin/baselinker/plans?kind=catalog_import|cards|stock_push|prices&filter=&q=`: the plan of one direction.
- `POST /admin/baselinker/quarantine/:id/release`: release a quarantined item.
- `GET /admin/baselinker/products?filter=all|linked|unmatched|conflicts|nosku&q=`: the card snapshot.
- `GET /admin/baselinker/products/by-medusa/:productId`: cards of one product, for the product widget.
- `GET /admin/baselinker/stock?q=`: the current plan of BaseLinker stock into Medusa.
- `GET /admin/baselinker/orders?filter=all|pending|sent|failed|skipped&q=`: the outbox and the way back.
- `POST /admin/baselinker/orders/:id/send`: send (or send again) one order now.
- `GET /admin/baselinker/orders/by-medusa/:orderId`: the BaseLinker side of one order, for the order widget.
- `GET /admin/baselinker/imports?filter=all|pending|imported|skipped|failed|flagged&q=`: marketplace orders.
- `POST /admin/baselinker/imports/:id/import`: import one marketplace order now (needs the armed writer).
- `GET /admin/baselinker/returns?q=&linked=1`: returns.
- `GET /admin/baselinker/invoices?filter=`: invoice numbers.
- `POST /admin/baselinker/invoices/:id/retry`: write one invoice number again.
- `GET /admin/baselinker/runs?kind=`: the history.

No route deletes anything.

## Use it from your code

```ts
import {
  sendOrderToBaseLinkerWorkflow,
  syncBaseLinkerCatalogWorkflow,
  syncBaseLinkerStatusesWorkflow,
  importBaseLinkerOrdersWorkflow,
  syncBaseLinkerReturnsWorkflow,
} from "@koda-plus/medusa-plugin-baselinker/workflows"

const { result } = await sendOrderToBaseLinkerWorkflow(container).run({
  input: { order_id: "order_01J..." },
})
// result.status === "sent", result.blOrderId === "21468320" (the BaseLinker order id)
// result.adopted === true when the order was already in BaseLinker and nothing was written
```

Also exported: `processBaseLinkerOrdersWorkflow` (one pass of the outbox) and `checkBaseLinkerConnectionWorkflow`.

Events on the Medusa event bus:

- `baselinker.order_sent`: `{ order_id, display_id, baselinker_order_id, adopted, linked_lines, free_lines, demo }`
- `baselinker.order_failed`: `{ order_id, display_id, code, message, attempts, demo }`
- `baselinker.order_status_changed`: `{ order_id, baselinker_order_id, status_id, status_name, previous_status_id, tracking_number, tracking_url, carrier, demo }`
- `baselinker.order_imported`: `{ order_id, display_id, baselinker_order_id, source, marketplace_order_ref, payment_state, adopted, demo }`
- `baselinker.order_import_failed`: `{ baselinker_order_id, code, message, attempts, demo }`
- `baselinker.plan_applied`: `{ kind, applied, failed, demo }`, kind `catalog_import`, `cards`, `stock_push` or `prices`
- `baselinker.invoice_number_written`: `{ order_id, baselinker_order_id, number, field, adopted, demo }`

The plugin listens to `order.placed` and, when the Fakturownia plugin is installed, to `fakturownia.document.issued`.

Order metadata the plugin writes, readable by your storefront through the Store API: `baselinker_order_id`, `baselinker_status_id`, `baselinker_status_name`, `baselinker_tracking_number`, `baselinker_tracking_url`, `baselinker_carrier`; on imported orders also `baselinker_imported`, `baselinker_order_source`, `baselinker_external_order_id` and `marketplace_order_ref`. Products created by the catalog import carry `metadata.baselinker_product_id` (and `metadata.manufacturer` unless `manufacturerAs` is `tag`).

## Security and personal data

- **Write barrier by method name**, as described above: nothing outside the permitted methods leaves the process, and a writer that is not armed cannot use its method.
- **One HTTP client:** the BaseLinker URL appears in one file, behind the barrier, a process-wide rate limiter and a timeout.
- **Masked token:** the token and every token-like run of characters are masked in logs, stored errors and the admin.
- **Personal data:** the plugin's own tables hold ids, statuses, totals and tracking, never buyer data. The order payload sent to BaseLinker is built at send time and not stored. An imported marketplace order carries the buyer's name, address, e-mail and phone on the Medusa order itself, as any order does, because the store has to ship it. Returns are stored without the buyer's data.
- **Reads only while rendering:** the admin never calls BaseLinker to draw a page; network calls sit behind jobs and clicks.
- **One worker per item:** locks through the Medusa Locking module (per store order, per marketplace order, per marketplace reference, per invoice document), plus the lookups before every create.

## Out of scope

- It never deletes anything, in BaseLinker or in Medusa. A product removed in BaseLinker can only become a draft, and only with `draftRemovedProducts`.
- Cards created from Medusa are simple cards, one per variant: it does not build main cards with variants in BaseLinker. Card updates cover the name and the EAN only; descriptions, images, categories and manufacturers of existing cards are left as they are. BaseLinker does not document whether an update keeps the text fields that are not sent; the plugin relies on the per key behaviour the documentation describes for images, and the guide advises trying the cards writer on one card first.
- The catalog import gives products one option axis (`catalogImportOptionTitle`) whose values are the variant names; it does not turn BaseLinker features into separate options like Colour and Size. Categories are matched by name, flat; the category tree is not rebuilt.
- One catalog, one warehouse and one price group per store. Kits and bundles are left out of stock, prices and the import.
- It does not change orders that are already in BaseLinker, and it does not push Medusa order edits, refunds or cancellations to BaseLinker. An order cancelled in Medusa before it went out is skipped.
- Imported orders are fulfilled from BaseLinker statuses only when `orderImportShippingOptionId` is set. An imported order that BaseLinker cancels after it was fulfilled in Medusa is flagged for a person, never cancelled automatically.
- Returns are read only: no Medusa return or refund is created from them.
- It does not send e-mails, and it cannot see your e-mail code: skipping the confirmation e-mail for marketplace orders is up to your `order.placed` subscriber.
- The Allegro reference of imported orders assumes BaseLinker's `external_order_id` of an Allegro order is the Allegro checkout form id, as BaseLinker documents it ("Allegro transaction number"); it has not been checked against an account connected to Allegro yet.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers the write barrier, token masking, response errors, the client retry policy, linking with variants and containers, every planner (catalog import, cards, stock both ways, prices) with the caps and the quarantine, the writers and their switches, the order payload, the marker scan, the marketplace order import across a crash and a race, statuses and the journal, returns without personal data, invoice numbers, demo data and backoff, without a network or a build.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. The same BaseLinker logic runs in production since August 2026 at a Polish tyre and wheel retailer, next to our Allegro, OLX, Fakturownia and Subiekt nexo integrations. Need a custom integration or help with a migration to BaseLinker? Write to kontakt@koda.plus.

## Trademarks

BaseLinker and Base are trademarks of their owner, used here only to identify the service this plugin connects to. This is an independent integration built on the public BaseLinker API, not affiliated with or endorsed by BaseLinker.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-baselinker/LICENSE).

## Changelog

### 0.2.1 (2026-10-07)

- References: stores that start soon on Medusa can be listed with `soon: true` (a Soon badge, no link, `url` optional); the since date is no longer shown, and an old `since` in the options is ignored.

### 0.2.0 (2026-10-06)

- Both catalog directions (`catalogSource`): the catalog import from BaseLinker (prices of a price group, SKU, EAN, weight, images, description, categories by name, manufacturer; idempotent by the BaseLinker id; duplicates are conflicts; never a delete) and the card plan from Medusa (create and update, a lookup by SKU before every create, the new card linked at once).
- Stock in both directions (`stockSource`): Medusa stock into a `bl_` warehouse with `updateInventoryProductsStock`, plan first, capped, per item quarantine.
- Price push into a BaseLinker price group with `updateInventoryProductsPrices`, gross prices from net Medusa prices with the card's VAT rate.
- Seven writers, each off by default, with a hard switch in the options (`writers`) and an arm switch in the admin that records who and when.
- Marketplace orders into Medusa, exactly once per BaseLinker order: chosen sources, region and sales channel, lines by card link, prices from the order, delivery as a shipping method, taxes from the region, payment, inventory reserved, `marketplace_order_ref` shared with the other Koda Plus plugins and checked under a shared lock, loop guard in both directions, cancellation while nothing is fulfilled.
- Returns, read only, without buyer data, linked to Medusa orders.
- Faster status pickup through the BaseLinker order journal, with the full read as a fallback.
- Invoice numbers from the Fakturownia plugin into a BaseLinker order field, exactly once, never over another value.
- Variant cards read with `include_variants`; main cards with variants are containers, never linked.
- Admin: Panel and Setup guide views (`?view=guide`), the directions and writers matrix, every plan with filters and quarantine release, marketplace orders, returns, invoice numbers, the account lists in the connection check, references ("Running in production"), widgets for imported orders and main cards.
- Demo mode simulates all of it: duplicated SKUs and EANs, price groups, both stock directions, deterministic Allegro and Amazon orders (at most 5 a day, `@example.com` buyers) that become real Medusa orders, returns and invoice numbers.
- Six new tables (`baselinker_setting`, `baselinker_plan_item`, `baselinker_quarantine`, `baselinker_import`, `baselinker_return`, `baselinker_invoice`): run `npx medusa db:migrate`.

### 0.1.0 (2026-10-05)

First public release: card linking by SKU and EAN with conflicts never linked, stock planned before it is written (BaseLinker to Medusa), store orders exactly once with a marker scan, statuses, tracking and fulfillment back, admin page and widgets in English and Polish, demo mode.
