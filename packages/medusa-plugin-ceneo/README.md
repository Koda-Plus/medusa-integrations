# Ceneo by Koda Plus

Your Medusa catalog on Ceneo, the Polish price comparison site: the Ceneo XML offer feed with Ceneo categories and attributes, the problems that keep a product off the comparison, Zaufane Opinie (trusted reviews) after every order, Kup Teraz orders in Medusa and the CPC bids, from one page in the admin.

Nothing is written to Ceneo until you allow it twice: in the plugin options (`writes`) and with the switch of that writer on the admin page. `demo: true` runs every part against a simulated Ceneo account.

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
- `feed.includeUnmapped`: `true` (default) sends a variant whose category has no Ceneo mapping with the Medusa path and a warning; `false` keeps it out of the file until it is mapped.
- `feed.brand`: where the brand (`Marka`) comes from: `{ from: "metadata", key: "brand" }` (default), `{ from: "type" }`, `{ from: "collection" }`, `{ from: "tag", key: "Marka:" }` (the tag value after the prefix) or `false` for none.
- `reviews.accountGuid`, `reviews.workDays`: Zaufane Opinie, the account GUID from Panel Ceneo and the working days before the survey (0 to 21, default: Ceneo decides). See Zaufane Opinie below.
- `apiKey`: the Ceneo API key from Panel Ceneo, for Kup Teraz and the bids.
- `writes.orders`, `writes.status`, `writes.bids`, `writes.promo`: which writers may ever run. Default `false` (in demo `true`). A writer runs only when it is allowed here and a person armed it on the admin page. See Writers below.
- `orders.importStates`: the Ceneo state ids of Kup Teraz orders ready to ship, the ones imported into Medusa (`[1, 2]` or `"1,2"`). Ceneo documents only some states; the admin lists your account's states. Without it the import stays off.
- `orders.canceledStates`: the state ids that mean "cancelled at Ceneo".
- `orders.paidPaymentTypes`: the Ceneo `PaymentTypeId` values paid up front: their Medusa orders get a captured payment. Any other stays unpaid (cash on delivery).
- `orders.shippingOptionId`: the Medusa shipping option of imported orders (`so_...`), optional.
- `orders.carrierId`: the Ceneo `ParcelCarriers` id sent with a parcel number. Without it only "sent" goes to Ceneo.
- `orders.cancelReason`: the reason Ceneo gets when the store cancels an order.
- `cpc.maxBid`: the highest bid ever sent, in PLN (`"0.80"`). Without it the bids writer cannot be armed (demo: 2.00).
- `cpc.maxBidChangePercent`: how far one run may move a bid, in percent of the current one (default 50).
- `cpc.perRun`: offers read per hourly run, 10 to 3000 (default 300).
- `cpc.shopName`: your store's name as Ceneo lists it among the offers, for the position in the top 10.
- `demo`: simulated Ceneo API, rows flagged demo.

## The feed

The job `ceneo-build-feed` wakes every 5 minutes and builds the file every `feed.intervalMinutes`, and within 10 minutes after a product or variant changes (never more often than every 5 minutes). The admin button "Build now" builds it at once. Ceneo reads `GET /ceneo/feed/<token>.xml` on the backend: the newest successful build, as built, with an ETag. A failed build keeps the previous file served. A scheduled build that would take more than half of the offers off Ceneo at once (or all of them) fails on purpose; "Build now" publishes a smaller file, never an empty one.

What goes into the file:

- One offer per variant of the published products in the sales channel. The id is the variant id (or the SKU); an id once used is never given to another variant.
- The calculated price of the region, gross, in PLN. A region whose prices exclude tax gives no offers: set the price preference of the region to tax inclusive.
- `avail` and `stock` from the inventory of the channel's stock locations.
- The Ceneo category path of the most specific mapped Medusa category (or the Medusa path, see `feed.includeUnmapped`), the images (thumbnail first, at most 20), the description (HTML cut at 100k characters, never inside a tag), `Marka`, `EAN` and `Kod producenta`.

Every variant left out has its reason on its offer row (a missing price, a missing handle for the address, a SKU used twice, and so on).

## Zaufane Opinie

Ceneo sends the shopper a survey after the purchase and shows the reviews on Ceneo. It works only in the browser (there is no server API): the Ceneo script on every page, and `_ceneo('transaction', ...)` on the order confirmation page. The plugin gives the storefront the payload and keeps the shopper's answer.

- `POST /store/ceneo/consent { cart_id, survey }`: the answer to the survey checkbox in the checkout, kept per cart in `ceneo_consent` (no personal data, removed after 90 days). Never in cart metadata: the store routes refuse `ceneo_*` metadata keys.
- `GET /store/ceneo/transaction?cart_id=`: `{ account_guid, survey, transaction }` for the order placed from that cart, within 24 hours, never for a canceled order. `transaction.client_email` only when the shopper ticked the box. Product ids are the feed offer ids, prices per unit gross after discounts, `amount` is the order total.

Both need `reviews.accountGuid` (404 `reviews_off` without it) and the publishable key, like every store route. The cart id is the shopper's own secret (Medusa's own `GET /store/carts/:id` trusts it the same way), so the routes need no login. Keep it out of addresses the shopper sees or shares: the code below reads it on the server from an httpOnly cookie.

### Next.js storefront (Medusa starter)

1. The script, in the root layout, in manual consent mode. It runs once per visit; the cookie banner calls `updateConsentState` itself when the shopper agrees, and the layout passes `tracking` for the visits after.

```tsx
// src/app/ceneo-script.tsx
"use client"
import Script from "next/script"

export function CeneoScript({ guid, tracking }: { guid: string; tracking: boolean }) {
  return (
    <Script id="ceneo" strategy="afterInteractive">{`
      (function(w,d,s,i,dl){w._ceneo=w._ceneo||function(){(w._ceneo.e=w._ceneo.e||[]).push(arguments)};
      dl=dl===undefined?"dataLayer":dl;
      var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.defer=true;
      j.src="https://ssl.ceneo.pl/ct/v5/script.js?accountGuid="+i+"&t="+Date.now()+(dl?"&dl="+dl:"");
      f.parentNode.insertBefore(j,f)})(window,document,"script","${guid}");
      _ceneo("enableManualConsentMode");
      ${tracking ? '_ceneo("updateConsentState",{allow_tracking:true});' : ""}
    `}</Script>
  )
}

// In the cookie banner, when the shopper accepts:
window._ceneo?.("updateConsentState", { allow_tracking: true })
```

2. The checkbox in the checkout, unticked by default (the e-mail goes to Ceneo only with consent), saved through a server action next to the starter's cart actions:

```ts
// src/lib/data/cart.ts
export async function setCeneoConsent(cartId: string, survey: boolean) {
  await sdk.client.fetch("/store/ceneo/consent", {
    method: "POST",
    body: { cart_id: cartId, survey },
    headers: await getAuthHeaders(),
  })
}
```

```tsx
const [survey, setSurvey] = useState(false)
// ...
<Checkbox
  label="Send me the Ceneo survey about this purchase (Zaufane Opinie)"
  checked={survey}
  onChange={() => {
    const next = !survey
    setSurvey(next)
    void setCeneoConsent(cart.id, next)
  }}
/>
```

3. In `placeOrder` (`src/lib/data/cart.ts`) keep the cart id for the confirmation page before the cart cookie goes:

```ts
const cookieStore = await cookies()
cookieStore.set("_ceneo_cart", id, { httpOnly: true, sameSite: "strict", secure: true, maxAge: 60 * 60 })
```

4. On the confirmation page (`src/app/[countryCode]/(main)/order/[id]/confirmed/page.tsx`) fetch the payload on the server and render it only for this page's order:

```tsx
const cartId = (await cookies()).get("_ceneo_cart")?.value
const ceneo = cartId
  ? await sdk.client
      .fetch<{ order_id: string; transaction: unknown }>(`/store/ceneo/transaction?cart_id=${cartId}`, { headers: await getAuthHeaders() })
      .catch(() => null)
  : null
// ...
{ceneo && ceneo.order_id === params.id ? <CeneoTransaction transaction={ceneo.transaction} /> : null}
```

```tsx
// src/modules/order/components/ceneo-transaction.tsx
"use client"
import { useEffect } from "react"

type CeneoQueue = ((...args: unknown[]) => void) & { e?: unknown[][] }
declare global {
  interface Window { _ceneo?: CeneoQueue }
}

export function CeneoTransaction({ transaction }: { transaction: unknown }) {
  useEffect(() => {
    /* The Ceneo script may load after this effect: queue the call, the script reads the queue. */
    const w = window
    w._ceneo = w._ceneo || Object.assign((...args: unknown[]) => { (w._ceneo!.e = w._ceneo!.e || []).push(args) }, { e: [] as unknown[][] })
    w._ceneo("transaction", transaction)
  }, [transaction])
  return null
}
```

Settings on the admin page counts the answers, the consents and the orders sent over the last 30 days.

## Kup Teraz orders

With `apiKey` (Panel Ceneo gives one to stores already integrated with Ceneo) the job `ceneo-sync-orders` reads the Kup Teraz orders of the last 14 days every 5 minutes into `ceneo_order`: the Ceneo number, the state, the amounts and the items, each matched to a variant by the feed offer id (an id the variant used before counts too).

- Personal data stay at Ceneo until the order is imported: the shipping, invoice and pickup data and the buyer's remark are read when an order is opened in the admin, never stored by the plugin.
- A run fetches the items of at most 50 orders (new ones, and ones whose state moved) and writes as it goes; the rest waits for the next run. Demo rows and live rows never mix: the admin shows the current mode.
- An item whose id no variant has, or a state missing from the Ceneo dictionary, is shown as a problem on the order.
- "Test the API key" asks Ceneo for a fresh token and the execution limits per method.

### Into Medusa (the orders writer)

When the orders writer is armed, the same job imports every matched order in one of `orders.importStates` as a Medusa order: the Ceneo prices (gross), the shipping and invoice address, the shipping option, a captured payment for the paid types. The order is placed like any other (reservations, `order.placed`), so invoicing and the ERP see it.

- One order in Medusa per Ceneo order, also with two servers: the order is claimed in one SQL statement, and the id of the Medusa draft is saved at once. An import that stopped halfway without that id waits for a person ("Needs attention") instead of risking a second order.
- A failed import is retried 4 times with growing pauses, then waits for a person. "Retry" on the order puts it back.
- The order is created with `no_notification` and `metadata.marketplace_order_ref` (`ceneo:<id>`): if your store sends its own confirmation e-mail on `order.placed`, skip the orders that have that key.
- An order Ceneo cancels (`orders.canceledStates`) is cancelled in Medusa while nothing was shipped; a shipped one waits for a person. This runs only while the orders writer is armed.

### Back to Ceneo (the status writer)

When the status writer is armed, Ceneo hears what happens to imported orders: the store's order number and the confirmation right after the import, the parcel number (`orders.carrierId`) or "sent" when a fulfillment is shipped in Medusa, the cancellation (`orders.cancelReason`) when the order is cancelled in Medusa. Only orders with a write waiting are read, the longest waiting first. A write Ceneo refuses 5 times waits for a person: "Resume the writes to Ceneo" on the order sends it again. Without `orders.carrierId` Ceneo gets "sent" without the parcel number, and the koda.integration/1 status lists it as a problem.

### Writers

Every write to Ceneo belongs to one writer: `orders` (imports into Medusa), `status` (writes back to Ceneo), `bids` and `promo` (CPC). A run hands the client only the writers that are armed, and the client refuses any write method whose writer it was not given, so a bug elsewhere cannot write either.

- A writer runs when the option allows it (`writes.<name>`) and a person armed it on the admin page. Switching between demo and live disarms it.
- 5 failures in a row that are not about one order (Ceneo down, a refused key) stop the writer: the admin shows why, a person arms it again.
- One run per writer at a time, across every process: the run holds a lease in the database.

The client is the only place that talks to the Ceneo API: a token per key cached for its 900 seconds and refreshed after a 401, one wait on 429, the key and the token masked in every log line. Reads are retried for 5xx and timeouts; a write is sent once. Every Ceneo method is a GET, writes included, so the client knows each read method and each write method with its writer: anything else never leaves, and a write leaves only for a writer the run was given.

## CPC bids and promotion texts

The job `ceneo-cpc` runs every hour (and "Run now" on the admin page):

1. It reads the bids and the top 10 offers of the feed offers, the least recently read first, at most `cpc.perRun` (Ceneo takes 300 ids per call).
2. When the bids writer is armed: one step per offer towards the target you set, computed again at sending time, never above `cpc.maxBid` and never more than `cpc.maxBidChangePercent` of the current bid; then the bid is read back. A bid above `maxBid` (set in Panel Ceneo) comes down to it at once.
3. When the promotion writer is armed: the promotion texts that changed (at most 30 characters, 20 ids per call).

Targets and texts are set per offer and per Ceneo category in the admin, or with `POST /admin/ceneo/cpc` (`targetBid` in grosze as an integer, or `targetBidPln` as a string). Ceneo sets a bid by its own product id: an offer Ceneo has not matched to a product yet gets no bid, and its row says so.

## Categories

The job `ceneo-sync-categories` downloads the Ceneo category tree every night at 3:20 (and the button "Download the Ceneo tree" at once). A download that is not the expected document, or has fewer than 100 categories, changes nothing. A category Ceneo removed stays in the table as removed: offers mapped to it go out with the Medusa path and a warning until you map it again.

On the admin page each Medusa category gets a Ceneo category. A mapping covers the whole subtree, a child's own mapping wins. A product in several categories takes the deepest mapped one.

## Offers and problems

The admin page lists every variant as Ceneo sees it after the last build: state (ok, warning, error, left out), price, `avail`, and each problem in one sentence, with filters and search. The product page shows the same per variant, next to the Ceneo category of the product.

Ceneo never lets an offer id be used again. When a variant was deleted and a new one wants its SKU (`offer_id_taken`), the action "Take over the id" moves the old row to the new variant, only when the old variant is gone from the catalog.

## For Koda hosts (koda.integration/1)

The plugin answers the Koda integration contract, read only (no Ceneo call):

- `GET /admin/ceneo/integration`: who, the mode, the writers armed, the problems.
- `GET /admin/ceneo/integration/summary?entity=order&id=...` (or `entity=product`, `ids=` up to 50): one line per Medusa order that came from Kup Teraz (where it stands between Medusa and Ceneo) and per product (its variants in the feed).
- `GET /admin/ceneo/integration/attention?scope=orders|products|integration`: imports that wait for a person, status writes that need a person, variants kept off Ceneo by an error, writers stopped after failures.

## License

MIT
