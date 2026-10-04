# Subiekt nexo by Koda Plus

Connect Medusa to **Subiekt nexo PRO** (InsERT), the most common ERP of Polish shops. Orders become ZK documents in Subiekt seconds after checkout, the WZ the warehouse issues comes back to the order, and stock flows from Subiekt to Medusa inventory. Your team keeps working in Subiekt; Medusa stays the storefront.

![Subiekt nexo page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-plugin-subiekt-nexo/main/docs/admin-subiekt.png)

## How it works

Subiekt nexo has no web API. Its SDK, **Sfera**, is a Windows .NET library that runs next to the Subiekt database. So the integration has two parts that talk over one signed, documented HTTP contract:

```
 Medusa (anywhere)                         Windows machine next to Subiekt
 +----------------------------+  HTTPS    +----------------------------+  Sfera SDK  +------------------+
 | this plugin                | --------> | bridge                     | ----------> | Subiekt nexo PRO |
 |  task queue, workflows,    |  signed   |  contract/openapi.yaml     |             |  SQL Server      |
 |  admin page, order widget  | <-------- |  event feed, WZ watcher    |             +------------------+
 +----------------------------+  webhook  +----------------------------+
```

- **This plugin** (MIT) is everything on the Medusa side: when to send an order, retries, the admin, stock matching.
- **The bridge** implements [`contract/openapi.yaml`](contract/openapi.yaml). Koda Plus builds and runs a production bridge on the Sfera SDK (commercial, see [The bridge](#the-bridge)); any bridge that follows the contract works, and the plugin ships a **demo bridge** so you can evaluate everything without Subiekt.

The bridge usually sits behind a Cloudflare Tunnel, so the Subiekt machine opens no inbound port.

## What it syncs

- **Orders to ZK** (zamówienie od klienta): Medusa to Subiekt, on `order.placed`. Prepaid orders (card, BLIK, Przelewy24, PayU...) wait for the capture first, so the warehouse never packs an order that may still fail to pay. Lines are matched by EAN first, then SKU against the product symbol, with the gross price the customer paid.
- **Cancellations**: Medusa to Subiekt, on `order.canceled`. Refused once a WZ exists (that is a return). Sfera cannot set every ZK status, so the bridge marks what it can and the admin says honestly when someone must finish it in Subiekt.
- **WZ issued in the warehouse**: Subiekt to Medusa, through the bridge event feed. The WZ number lands in the order metadata, the plugin emits `subiekt.document_issued`, and with `fulfillOnWz` it creates the Medusa fulfillment.
- **WZ from Medusa fulfillments** (optional, `issueWzOnFulfillment`): Medusa to Subiekt.
- **Stock**: Subiekt to Medusa, every 10 minutes, into the inventory levels of one stock location.

## Features

- **Outbox with retries.** Every call to the bridge is a row first and a request second, retried with backoff for about two and a half days, so a bridge machine switched off over a weekend loses nothing. A task fails for good only on a non-retryable error, and then it waits in the admin with a **Send again** button.
- **Idempotent end to end.** The bridge creates one ZK per order no matter how often it is asked (the link survives in the Subiekt notes as `[medusa:order_...]`), so retries and "send again" are always safe.
- **Admin page** with the connection (bridge, contract, Subiekt version, database), the queue (waiting for payment, queued, needs attention), documents, the last stock sync with its changes and every SKU that did not match, and the history of background runs.
- **Order widget** on the order page: the ZK and WZ of the order, the state of its tasks, **Send to Subiekt now**.
- **Safe stock sync.** Ambiguous matches (one EAN on two products, one inventory item pulled two ways) are reported and never written. Products missing from a reading are never zeroed. Kit components are matched by their own SKU. `stockDryRun` records the plan without writing.
- **Signed both ways.** HMAC-SHA256 over timestamp, method, path and raw body, with secret rotation and a 5 minute window. Optional Cloudflare Access service token.
- **Demo mode.** A simulated bridge inside Medusa: ZK numbers in seconds, a WZ about three minutes later, stock computed from your SKUs (dry run).
- **Workflows included**, in the spirit of the [Medusa ERP recipe](https://docs.medusajs.com/resources/recipes/erp): `sendOrderToSubiektWorkflow`, `cancelOrderInSubiektWorkflow`, `createSubiektWzWorkflow`, `syncSubiektStockWorkflow`, `pullSubiektEventsWorkflow`, `checkSubiektConnectionWorkflow`, `processSubiektTasksWorkflow`.
- **Admin in English and Polish.**

## Requirements

- Medusa 2.12 or newer (tested on 2.15.3), Node.js 20+.
- For a real Subiekt: Subiekt nexo PRO (the Sfera SDK is part of the PRO licence) and a bridge on a Windows machine with access to the nexo SQL Server.

## Installation

```bash
npm install @koda-plus/medusa-plugin-subiekt-nexo
```

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-subiekt-nexo",
      options: {
        bridgeUrl: process.env.SUBIEKT_BRIDGE_URL, // https://subiekt-bridge.your-shop.pl
        secret: process.env.SUBIEKT_SECRET, // the same value as in the bridge
        // demo: true, // simulated bridge, no Subiekt needed
      },
    },
  ],
})
```

Generate the shared secret with `openssl rand -hex 32` and put the same value in the bridge configuration. Then run the migrations and open **Subiekt nexo** in the admin sidebar:

```bash
npx medusa db:migrate
```

### Options

- `bridgeUrl`: base URL of the bridge. Use an origin; a path prefix must reach the bridge unchanged.
- `secret`: shared HMAC secret, 16 characters at least, 64 hex characters recommended.
- `previousSecret`: accepted on incoming webhooks while you rotate the secret.
- `cfAccessClientId`, `cfAccessClientSecret`: Cloudflare Access service token, when the tunnel is protected by Access.
- `demo` (default `false`): the simulated bridge.
- `prepaidProviders` (default: Stripe, Przelewy24, PayU, Tpay, PayPal, Adyen, Mollie prefixes): payment providers whose orders wait for the capture. Prefix match on the provider id.
- `codProviders` (default `pp_cod`, `pp_cash`): providers meaning cash on delivery.
- `stockSyncEnabled` (default `true`), `stockLocationId` (optional when the store has one location), `stockField` (`quantity`, physical, default, or `available`, minus ZK reservations), `stockDryRun` (default `false`).
- `issueWzOnFulfillment` (default `false`): a Medusa fulfillment asks the bridge for a WZ.
- `fulfillOnWz` (default `false`): a WZ from Subiekt creates the Medusa fulfillment for the remaining items.
- `eventsEnabled` (default `true`): read the bridge event feed.
- `stripSkuSuffixes` (default none): SKU suffixes removed before matching, for example `["-WH"]` for wholesale variants of one Subiekt product.
- `omitLinesWithoutCode` (default `false`): leave lines without EAN and SKU (services, gift cards) off the ZK instead of failing the order.
- `forwardMetadataKeys`, `taxIdMetadataKeys`: order metadata passed to the bridge, and where to look for the buyer's NIP.
- `timeoutMs` (default `30000`): one bridge request.

Missing options never break the boot: the module registers, the admin lists what is missing, and nothing is queued until the plugin is configured, so a store configured a week after installing does not flood Subiekt with a week of old orders.

## The order lifecycle

1. `order.placed`: the order gets an `order.create` task. Due at once for cash on delivery, bank transfer, trade credit and manual payments; **waiting** for prepaid providers until `payment.captured`.
2. The queue sends it right away (the scheduled job every minute is the safety net and the retry clock). The bridge matches the lines and creates the ZK; the plugin stores it, writes `subiekt_zk_number` into the order metadata and emits `subiekt.document_issued`.
3. The warehouse issues the WZ from the ZK in Subiekt. The bridge watcher announces it in the event feed (and nudges Medusa through `POST /hooks/subiekt`); the plugin writes `subiekt_wz_number` and, with `fulfillOnWz`, fulfills the order.
4. `order.canceled`: if the ZK was never attempted, the queued create is simply canceled; otherwise the bridge cancels the ZK, or refuses with `document_locked` once a WZ exists.

![The order page widget: ZK and WZ of the order](https://raw.githubusercontent.com/Koda-Plus/medusa-plugin-subiekt-nexo/main/docs/admin-order-widget.png)

There is deliberately **no compensation that deletes a ZK**. The ERP recipe compensates a remote create by deleting the remote record; here the bridge is idempotent per order, so a retry after a local failure gets the same ZK back, while a deleted ZK would leave a hole in the number series and might already be on the warehouse's desk.

## The bridge

[`contract/openapi.yaml`](contract/openapi.yaml) is the whole contract: `GET /v1/health`, `POST /v1/orders`, `GET /v1/orders/{id}`, `POST /v1/orders/{id}/cancel`, `POST /v1/orders/{id}/fulfillments`, `GET /v1/stock`, `GET /v1/events`, and the webhook `POST /hooks/subiekt`. Request and response examples and cross-language signature test vectors live in [`contract/examples`](contract/examples).

Koda Plus provides a production bridge for Subiekt nexo PRO: a Windows service on .NET 8 and the Sfera SDK, with a dedicated Sfera thread (no desktop heap exhaustion after days of uptime), an incremental WZ watcher, SQLite event feed, read-only probe mode and Cloudflare Tunnel setup. It is available commercially from Koda Plus, write to **kontakt@koda.plus**. You can also build your own bridge from the contract.

## Stock matching

1. Each Subiekt product is indexed by EAN (digits only, 8 to 14) and by symbol (case-insensitive).
2. A variant that manages inventory with exactly one inventory item finds its product by EAN (`ean`, `barcode` or `upc` of the variant), then by SKU against the symbol, after removing `stripSkuSuffixes`.
3. Inventory items of kits get a second chance by their own SKU.
4. A duplicated EAN in Subiekt, or one inventory item matched to two products with different stock, is a conflict: reported in the admin, never written.
5. Only matched items are written, through Medusa's `batchInventoryItemLevelsWorkflow`. Negative Subiekt stock becomes 0.

![Stock plan: changes, products only in Subiekt, conflicts](https://raw.githubusercontent.com/Koda-Plus/medusa-plugin-subiekt-nexo/main/docs/admin-subiekt-stock.png)

## Admin API

- `GET /admin/subiekt`: connection, queue counters, the last run of each kind. Reads the database only.
- `POST /admin/subiekt/check`: `GET /v1/health` now.
- `POST /admin/subiekt/sync` with `{ "what": "stock" | "events" | "tasks" }`: run a job now (202, background).
- `GET /admin/subiekt/tasks?filter=attention|open|done|all&q=`, `POST /admin/subiekt/tasks/:id/retry`.
- `GET /admin/subiekt/documents?kind=ZK|WZ&q=`, `GET /admin/subiekt/runs?kind=`.
- `GET /admin/subiekt/orders/:id`, `POST /admin/subiekt/orders/:id/send`.
- `POST /hooks/subiekt`: the bridge webhook. Public, signed.

## Use it from your code

```ts
import { sendOrderToSubiektWorkflow } from "@koda-plus/medusa-plugin-subiekt-nexo/workflows"

const { result } = await sendOrderToSubiektWorkflow(container).run({
  input: { order_id: "order_01J..." },
})
// result.document.number === "ZK 128/MAG/2026"
```

Subscribe to `subiekt.document_issued` (`{ order_id, kind, number, status, source }`) to react to a WZ, for example to send the invoice or the shipping e-mail, and to `subiekt.task_failed` to alert your team.

## How this maps to the Medusa ERP recipe

| ERP recipe | This plugin |
| --- | --- |
| ERP module with a client | `subiekt_nexo` module, `HttpBridgeClient`, `DemoBridge` |
| Sync orders to the ERP on `order.placed` | `subiekt-order-placed` subscriber, outbox, `sendOrderToSubiektWorkflow` |
| Restrict purchase by ERP data | stock sync into inventory levels; Medusa's own inventory checks do the rest |
| Sync from the ERP via webhook | signed `POST /hooks/subiekt` plus the cursor-based event feed |
| Scheduled product sync job | `subiekt-sync-stock` (stock), product data stays in Medusa in version 0.1 |

## Security

- Every request is signed in both directions; a captured request cannot be replayed against another endpoint or after five minutes.
- Secrets live only in the plugin options and are masked in every stored error.
- The admin never calls the bridge while rendering; network calls sit behind explicit actions and jobs.
- The plugin stores documents, tasks and counters, no customer data beyond the order id and number.

## Roadmap

- Product and price import from Subiekt (`syncFromErp`).
- Partial WZ and corrections (KWZ), returns.
- Contractors by NIP for B2B buyers.
- Sales documents (FS, PA) issued from Subiekt with KSeF numbers.

## License

MIT, see [LICENSE](LICENSE). Built and maintained by [Koda Plus](https://koda.plus).

Subiekt nexo, nexo PRO and Sfera are trademarks of InsERT S.A. This project is independent and not affiliated with InsERT.
