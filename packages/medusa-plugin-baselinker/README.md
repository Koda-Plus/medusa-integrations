# BaseLinker by Koda Plus

Connect Medusa to **BaseLinker** (Base, base.com), the order and warehouse hub most Polish online stores run their marketplaces through. This plugin is for stores whose **catalog lives in Medusa** and whose **warehouse and marketplaces run in BaseLinker**: it links your existing variants to your existing BaseLinker cards, sends every order to BaseLinker exactly once, brings the status, the tracking number and the fulfillment back, and pulls stock only after a dry-run plan your team can read.

It never imports or overwrites your Medusa catalog, and it never changes cards, prices or stock in BaseLinker.

![BaseLinker page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-baselinker/docs/admin-baselinker.png)

**Live demo:** Medusa admin [medusa.koda.plus/app/baselinker](https://medusa.koda.plus/app/baselinker?demo=en), signed in to a public demo account by the link itself, and the storefront [demo.koda.plus](https://demo.koda.plus). The demo runs the plugin in demo mode, so every screen has data: place an order in the storefront and watch it reach "Wysłane" with a tracking number a few minutes later.

## What it syncs

- **Card links** (BaseLinker card to Medusa variant, by SKU, then EAN): BaseLinker to Medusa, read only, every hour at minute 15 and on **Sync cards now**.
- **Stock** (the number in one BaseLinker warehouse): BaseLinker to Medusa inventory levels, after every complete catalog read. Planned by default; written only with `stockSync: "write"`.
- **Orders** (lines, prices, shipping address, invoice data, payment and cash on delivery flags): Medusa to BaseLinker, on `order.placed`, then every 2 minutes for retries, and on **Send to BaseLinker now**.
- **Order status and tracking** (status name, parcel number, carrier, tracking link): BaseLinker to Medusa order metadata, every 15 minutes and on **Read statuses**.
- **Fulfillment** (the Medusa fulfillment of the remaining items): created in Medusa when BaseLinker reaches one of the statuses you choose (`fulfillOnStatusIds`).

## Features

- **Link, do not import.** Existing variants are linked to existing BaseLinker cards by SKU (case-insensitive, trimmed) and then by EAN. A SKU on two cards, an EAN on two cards or two variants on one key are reported as conflicts and never linked.
- **Orders exactly once.** A marker `[medusa:<order id>]` goes into the BaseLinker `admin_comments`, and the plugin scans BaseLinker for it before every write. A timeout after `addOrder` is answered with a second scan, never with a blind retry.
- **Outbox with retries.** Every order is a row in your database before anything goes to the network. Failures retry with backoff for about two and a half days, then wait in the admin with a **Send again** button.
- **Status, tracking and fulfillment back.** Carrier links for DPD, GLS, InPost, DHL, UPS, FedEx and Poczta Polska. The fulfillment is created once, without a notification e-mail.
- **Stock planned before it is written.** The admin lists every inventory level that would change: Medusa now, BaseLinker, the target and the units added or removed. Items missing from a read are never zeroed, an incomplete read plans nothing, kits are skipped, and a cap limits the changes per run.
- **Admin page** with the connection check, the stock plan, the cards with filters (linked, only in BaseLinker, conflicts, no SKU), the orders with their BaseLinker status and tracking, and the history of background runs.
- **Order widget** on every order: the BaseLinker order, its status, the tracking link and **Send to BaseLinker now**. **Product widget** on every product: the linked cards and their BaseLinker stock.
- **Demo mode:** a simulated BaseLinker account built from your own catalog. Orders get BaseLinker ids in seconds and are "shipped" with an InPost number a few minutes later. Nothing leaves Medusa.
- **Admin in English and Polish.**
- **Workflows included** for your own code, and events on the Medusa event bus.

## Requirements

- Medusa 2.12 or newer (tested on 2.15.3) and Node.js 20+.
- For a real account: a BaseLinker API token (in BaseLinker: My account, API) and the id of the catalog (inventory) your cards live in.

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
        // stockSync: "plan", // "off" | "plan" | "write"
        // demo: true, // simulated BaseLinker built from your catalog, no account needed
      },
    },
  ],
})
```

Run the migrations, then open **BaseLinker** in the admin sidebar and click **Check connection**: it tells you whether the token works, whether the catalog exists and whether the warehouse belongs to it.

```bash
npx medusa db:migrate
```

### Options

- `apiToken`: BaseLinker API token. Stays on the server and is masked in every log and error.
- `inventoryId`: the BaseLinker catalog (inventory) whose cards are linked to your variants.
- `warehouseId`: the warehouse whose stock counts, like `bl_12345` (a bare number becomes `bl_<number>`).
- `orderStatusId`: the BaseLinker status new orders get.
- `customSourceId` (optional): a custom order source created in BaseLinker, so Medusa orders are labeled there. It also lets the status read fetch 100 orders per request.
- `stockLocationId` (optional when the store has one location): the Medusa stock location that receives BaseLinker stock.
- `stockSync` (default `plan`): `off`, `plan` (store and show the plan, write nothing) or `write`.
- `maxStockChangesPerRun` (default `500`): the most inventory levels one run writes; decreases go first.
- `exportOrders` (default `true`): send placed orders to BaseLinker.
- `fulfillOnStatusIds` (default none): BaseLinker status ids that create the Medusa fulfillment for the remaining items.
- `closedStatusIds` (default none): BaseLinker status ids after which an order is no longer read. Without them, sent orders are followed for 30 days.
- `codProviders` (default `pp_cod`, `pp_cash`): payment provider id prefixes meaning cash on delivery.
- `paymentLabels` (default: built-in English names): payment method names shown in BaseLinker by provider id prefix, for example `{ pp_cod: "Pobranie", pp_stripe: "Karta / BLIK" }`. Up to 30 characters each.
- `skipOrderMetadataKey` (default `baselinker_skip`): an order with `metadata[key] === true` never goes to BaseLinker. Use it for test orders.
- `demo` (default `false`): the simulated BaseLinker account.
- `requestsPerMinute` (default `80`): self-imposed rate limit; BaseLinker allows 100 per token.
- `timeoutMs` (default `20000`): one BaseLinker request.
- `catalogSyncEnabled` (default `true`): the hourly card read and the stock plan after it.

Missing options never break the boot: the module registers, the admin lists what is missing and each job waits for the options it needs. Cards need the token and the catalog, orders need the token and a status, the stock plan needs the warehouse too. Nothing is queued before orders can be sent, so a store configured a week after installing does not flood BaseLinker with a week of old orders.

## How linking works

1. The whole catalog is read with `getInventoryProductsList`, 1 000 cards per page, from page 1 until a short page. A failed page or the page ceiling makes the read incomplete.
2. Every card is looked up by SKU, uppercased and trimmed on both sides. A SKU that sits on two or more cards is a `duplicate_sku` conflict; two variants with one SKU are an `ambiguous_variant` conflict. Neither is linked.
3. A card the SKU did not settle is looked up by EAN (digits only, 8 to 14), with the same rules (`duplicate_ean`). A variant is linked to at most one card, and a SKU link wins over an EAN link.
4. A complete read replaces the snapshot. An incomplete read only adds and updates: a card missing from a broken list looks exactly like a deleted one, so nothing is unlinked.
5. Variants with a SKU that no card carries are counted as "only in Medusa".

Why so strict: on a production account we measured 12 993 cards carrying 8 522 distinct SKUs. One SKU on two cards is common (the same goods entered twice, or two physical items), and linking "the first one" would send stock and orders to a random copy.

## Orders exactly once

BaseLinker has no idempotency key, and a mapping row written after `addOrder` cannot protect against a lost answer. So:

1. `order.placed` writes a row in `baselinker_order` first, then sends in the background. The payload is built from the order at send time and never stored, because it carries personal data.
2. Every attempt scans `getOrders` (from the order date minus one hour, unconfirmed orders included, paging by `id_from`) for the marker `[medusa:<order id>]`. Found: that BaseLinker order is adopted and nothing is written.
3. Otherwise one `addOrder`. It is never retried blindly; only a rate limit refusal repeats, because then BaseLinker took nothing.
4. A timeout, a 502 or broken JSON after `addOrder` means "no answer", not "no order": the plugin waits and scans again. Still not found, the row is retried later, and that attempt scans first.
5. Success writes `sent`, the BaseLinker order id and `metadata.baselinker_order_id`, and emits `baselinker.order_sent`. After the backoff runs out the row is `failed`, `baselinker.order_failed` is emitted, and a person can **Send again**, which is always safe.

Lines whose variant is linked go to their card (`storage: "db"`, the catalog id, the card id), so stock moves on the right card in BaseLinker. Other lines go as free lines with name, SKU and EAN; the order still arrives. The unit price is the line total after discounts divided by the quantity, the tax rate is the highest rate of the line. `paid` is 1 only when the payment is captured in full; `payment_method_cod` marks cash on delivery by payment provider. Invoice fields go only when the buyer asked for one (`metadata.invoice` or a tax id such as `metadata.invoice_nip`), and InPost lockers from the shipping method data become the delivery point.

## Stock (plan first)

After every complete catalog read the plugin plans the stock of linked, conflict-free variants that manage inventory with exactly one inventory item:

`target stocked = max(0, BaseLinker stock) + reserved quantity of the level`

BaseLinker reports what can still be sold, while Medusa keeps `stocked` before its reservations. Adding the reservations back makes Medusa available equal to BaseLinker, and an order already sent to BaseLinker does not take the item twice. Negative BaseLinker stock is clamped to zero.

- `plan` (default): the plan is stored and shown in the admin, nothing is written.
- `write`: up to `maxStockChangesPerRun` changes are applied with Medusa's own `batchInventoryItemLevelsWorkflow`, decreases first, and the levels are read back for the record.
- Never written: from an incomplete read, for items missing from the read (absence is never zero), for kits, in demo mode.

Why a plan first: BaseLinker numbers are not always the truth. On a production account we found duplicated cards with different stock, negative stock after overselling and a nightly import that kept raising zeros back. Read the plan, then switch to `write`.

## Admin API

- `GET /admin/baselinker`: configuration summary (never the token), counters, the last run of each kind. Reads the database only.
- `POST /admin/baselinker/check`: one `getInventories` call now.
- `POST /admin/baselinker/sync` with `{ "what": "catalog" | "statuses" | "orders" }`: run a job now (202, background).
- `GET /admin/baselinker/products?filter=all|linked|unmatched|conflicts|nosku&q=`: the card snapshot.
- `GET /admin/baselinker/products/by-medusa/:productId`: cards of one product, for the product widget.
- `GET /admin/baselinker/stock?q=`: the current stock plan.
- `GET /admin/baselinker/orders?filter=all|pending|sent|failed|skipped&q=`: the outbox and the way back.
- `POST /admin/baselinker/orders/:id/send`: send (or send again) one order now.
- `GET /admin/baselinker/orders/by-medusa/:orderId`: the BaseLinker side of one order, for the order widget.
- `GET /admin/baselinker/runs?kind=catalog|stock|orders|statuses`: the history.

## Use it from your code

```ts
import {
  sendOrderToBaseLinkerWorkflow,
  syncBaseLinkerCatalogWorkflow,
  syncBaseLinkerStatusesWorkflow,
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

Order metadata the plugin writes, readable by your storefront through the Store API: `baselinker_order_id`, `baselinker_status_id`, `baselinker_status_name`, `baselinker_tracking_number`, `baselinker_tracking_url`, `baselinker_carrier`.

## Security

- **Write barrier by method name:** every `get*` method passes; the only write is `addOrder`, and only while `exportOrders` is on. Stock, price, card and order changes are blocked before any request leaves the process.
- **One HTTP client:** the BaseLinker URL appears in one file, behind the barrier, a process-wide rate limiter and a timeout.
- **Masked token:** the token and every token-like run of characters are masked in logs, stored errors and the admin.
- **No personal data at rest:** the outbox stores ids, statuses and tracking, never the order payload.
- **Reads only while rendering:** the admin never calls BaseLinker to draw a page; network calls sit behind jobs and clicks.
- **One sender per order:** a per-order lock through the Medusa Locking module, plus the marker scan before every write.

## What this plugin does not do

- It does not import products, variants, prices or images from BaseLinker; your catalog stays in Medusa.
- It does not create product cards in BaseLinker (yet): it links the cards you already have.
- It does not push stock or prices to BaseLinker.
- It does not handle returns, and it does not create Medusa orders from BaseLinker orders (Allegro, Amazon and the rest stay in BaseLinker).
- It does not cancel or change orders that are already in BaseLinker. An order canceled in Medusa before it went out is skipped; one canceled after an attempt is checked for its marker first and, when BaseLinker has it, the admin says so, to be handled there.
- One BaseLinker catalog and one warehouse per store.

## How it compares

If your catalog lives in Base and Medusa should mirror it, look at `medusa-baselinker` by digity-studio in the Medusa integrations library: it imports products, variants, prices and images from Base into Medusa, then syncs stock, orders and statuses. This plugin is for the opposite setup: the catalog is managed in Medusa, BaseLinker runs the warehouse and the marketplaces, and the two are linked without either side overwriting the other.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers the write barrier, token masking, response errors, the client retry policy, linking, the stock plan, the order payload, the marker scan, tracking links, demo data and backoff, without a network or a build.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. The same BaseLinker logic runs in production since August 2026 at a Polish tyre and wheel retailer, next to our Allegro, OLX and Subiekt nexo integrations. Need stock push to BaseLinker, product cards created from Medusa or a custom integration? Write to kontakt@koda.plus.

## Trademarks

BaseLinker and Base are trademarks of their owner, used here only to identify the service this plugin connects to. This is an independent integration built on the public BaseLinker API, not affiliated with or endorsed by BaseLinker.

## License

MIT, see [LICENSE](./LICENSE).
