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
- `feed.includeUnmapped`: `true` (default) sends a variant whose category has no Ceneo mapping with the Medusa path and a warning; `false` keeps it out of the file until it is mapped.
- `feed.brand`: where the brand (`Marka`) comes from: `{ from: "metadata", key: "brand" }` (default), `{ from: "type" }`, `{ from: "collection" }`, `{ from: "tag", key: "Marka:" }` (the tag value after the prefix) or `false` for none.
- `reviews.accountGuid`, `reviews.workDays`: Zaufane Opinie, the account GUID from Panel Ceneo and the working days before the survey (0 to 21, default: Ceneo decides). See Zaufane Opinie below.
- `apiKey`: the Ceneo API key from Panel Ceneo, for Kup Teraz and the bids.
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

## Kup Teraz orders (read only)

With `apiKey` (Panel Ceneo gives one to stores already integrated with Ceneo) the job `ceneo-sync-orders` reads the Kup Teraz orders of the last 14 days every 5 minutes into `ceneo_order`: the Ceneo number, the state, the amounts and the items, each matched to a variant by the feed offer id (an id the variant used before counts too). Nothing is written to Ceneo and no Medusa order is created in this version.

- Personal data stay at Ceneo: the shipping, invoice and pickup data and the buyer's remark are read when an order is opened in the admin, never stored by the plugin.
- A run fetches the items of at most 50 orders (new ones, and ones whose state moved: a return shows there) and writes as it goes; the rest waits for the next run. Demo rows and live rows never mix: the admin shows the current mode.
- An item whose id no variant has, or a state missing from the Ceneo dictionary, is shown as a problem on the order.
- "Test the API key" asks Ceneo for a fresh token and the execution limits per method.
- `demo: true` simulates orders from your own feed offers (same code paths, rows flagged demo); the states with ids above 100 exist only in the demo.

The client is the only place that talks to the Ceneo API: a token per key cached for its 900 seconds and refreshed after a 401, retries for 5xx and timeouts, one wait on 429, the key and the token masked in every log line. Every Ceneo method is a GET, writes included, so the client lets only read methods out.

## Categories

The job `ceneo-sync-categories` downloads the Ceneo category tree every night at 3:20 (and the button "Download the Ceneo tree" at once). A download that is not the expected document, or has fewer than 100 categories, changes nothing. A category Ceneo removed stays in the table as removed: offers mapped to it go out with the Medusa path and a warning until you map it again.

On the admin page each Medusa category gets a Ceneo category. A mapping covers the whole subtree, a child's own mapping wins. A product in several categories takes the deepest mapped one.

## Offers and problems

The admin page lists every variant as Ceneo sees it after the last build: state (ok, warning, error, left out), price, `avail`, and each problem in one sentence, with filters and search. The product page shows the same per variant, next to the Ceneo category of the product.

Ceneo never lets an offer id be used again. When a variant was deleted and a new one wants its SKU (`offer_id_taken`), the action "Take over the id" moves the old row to the new variant, only when the old variant is gone from the catalog.

## License

MIT
