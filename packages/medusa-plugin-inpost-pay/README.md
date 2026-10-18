# InPost Pay by Koda Plus

One-click checkout with the **InPost mobile app** for Medusa v2 stores in Poland. The customer taps the InPost Pay button on the product page or in the cart, confirms in the InPost app with a saved address, parcel locker and payment, and the order lands in Medusa. The plugin binds Medusa carts to InPost Pay baskets, answers the signed calls of InPost's Merchant Backend API, places the order through its own payment provider and shows every basket, confirmation and order in the admin.

The plugin never sees card or BLIK data: the customer pays in the InPost app. It ships no InPost artwork either: in production use InPost's official button (Widget 2.0) as InPost's brand guidelines describe it.

## What it does

- **The button** (`POST /store/inpostpay/baskets`): binds the storefront cart to an InPost Pay basket and answers what `InPostPayWidget.init` needs: the `basket_binding_api_key` of Widget 2.0, the public Merchant Client Id and the widget script.
- **The Merchant Backend API** (`/inpostpay/v1/izi/...`, the address the merchant portal is given): the basket as the app shows it, the confirmation (linked or refused in the app), the basket changes made in the app (quantities, codes, suggested products), the unbinding, the order InPost hands over, the order details and the payment and order events. Every call is verified with InPost's signature.
- **The order**: the buyer and the addresses go on the cart, the shipping option mapped to the delivery chosen in the app is added (the parcel locker in the shipping method data as `machine_id`, the shape the [InPost plugin](https://github.com/Koda-Plus/medusa-integrations/tree/main/packages/medusa-plugin-inpost) ships from), a payment session of this plugin's provider is created and the cart is completed. Idempotent per basket.
- **The payment provider** (`pp_inpost-pay_inpost-pay`): authorizes only sessions the plugin created itself (each carries a proof only the server can make), so a session a shopper creates through the Store API is never authorized.
- **Order events back to InPost** (a writer, off by default): a canceled order is reported as `ORDER_REJECTED`, a created shipment sends its parcel numbers.
- **The admin page** (`/app/inpostpay`): the mode, the counters (bound baskets, linked in the app, orders, conversion, failed, without payment), the baskets with their products, delivery, masked phone, InPost payment status and history, a setup guide with live step states and the Merchant API address to paste, and the settings (delivery mapping, the places of the button, the InPost account). An order widget shows the InPost Pay state of an order.
- **Demo mode**: the whole flow without InPost: the storefront confirms the basket with a simulated app confirmation and a real Medusa order is placed, marked as a demo.
- **Works with Koda Plus hosts** through the `koda.integration/1` contract: the manifest, the order summary and two board counters.

## Requirements

- Medusa 2.12 or newer (peer range `^2.12.0`) and Node.js 20+.
- An InPost Pay merchant agreement: sandbox keys come from InPost on request, production keys from the InPost merchant portal (Client ID and Client Secret of the Basket App API, the Merchant Client ID of the widget).
- A public HTTPS address of the backend (InPost calls it).
- A region in PLN (InPost Pay takes PLN only) with the plugin's payment provider enabled.

## Installation

```bash
npm install @koda-plus/medusa-plugin-inpost-pay
```

## Configuration

Register the plugin and its payment provider in `medusa-config.ts`, with the same options object:

```ts
const inpostPay = {
  clientId: process.env.INPOST_PAY_CLIENT_ID,
  clientSecret: process.env.INPOST_PAY_CLIENT_SECRET,
  merchantClientId: process.env.INPOST_PAY_MERCHANT_CLIENT_ID,
  sandbox: process.env.INPOST_PAY_SANDBOX === "true",
  demo: process.env.INPOST_PAY_DEMO === "true",
  // backendUrl: "https://api.example.com",
  // storefrontUrl: "https://shop.example.com",
  // sendOrderEvents: true,
}

module.exports = defineConfig({
  // ...
  plugins: [{ resolve: "@koda-plus/medusa-plugin-inpost-pay", options: inpostPay }],
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          // keep your other payment providers here
          { resolve: "@koda-plus/medusa-plugin-inpost-pay/providers/inpostpay", id: "inpost-pay", options: inpostPay },
        ],
      },
    },
  ],
})
```

The provider id is then `pp_inpost-pay_inpost-pay`. Enable it in the PLN region (Settings, Regions, the region, Payment providers): Medusa completes a cart only with a provider the region has.

Run the migrations:

```bash
npx medusa db:migrate
```

The migration (`Migration20261018120000_inpostpay`) adds two tables: `inpost_pay_basket` (the bound baskets) and `inpost_pay_setting` (the settings chosen in the admin).

Set the keys in `.env`:

```bash
INPOST_PAY_CLIENT_ID=...
INPOST_PAY_CLIENT_SECRET=...
INPOST_PAY_MERCHANT_CLIENT_ID=...
INPOST_PAY_SANDBOX=true
# INPOST_PAY_DEMO=true
```

Without the keys and without `demo` the plugin registers, the admin says "Not configured", the store routes answer `enabled: false` without an error, the Merchant API answers 503 and nothing reaches InPost. Missing or broken options never break the boot: broken values fall back to their defaults and the admin lists them as ignored.

### Options

Every option is optional. Switches and numbers may come as strings, as environment variables do.

- `clientId`, `clientSecret` (default none): the OAuth client credentials of the Basket App API. The secret stays on the server, is masked in the admin (`***` and the last four characters) and in every error.
- `merchantClientId` (default none): the Merchant Client Id the widget is initialised with. Public: the storefront reads it from `GET /store/inpostpay/config`.
- `posId` (default none): the POS id from the merchant portal, shown in the admin. This version sends it nowhere (the pages of the documentation that could be read do not say where it goes).
- `sandbox` (default `false`): InPost's sandbox: `sandbox-api.inpost.pl`, `sandbox-login.inpost.pl` and the sandbox widget.
- `apiUrl`, `tokenUrl`, `widgetUrl` (default InPost's addresses of the environment): overrides, for example when InPost gives another path prefix of the Basket App API.
- `backendUrl` (default the address of the admin request): the public backend address the setup guide builds the Merchant API address from.
- `storefrontUrl` (default none): the public storefront address, for product links in the basket the app shows (`<storefrontUrl>/products/<handle>`).
- `paymentProviderId` (default `pp_inpost-pay_inpost-pay`): the provider the orders are paid with, when you registered it under another `id`.
- `basketTtlHours` (default `24`, 1 to 720): how long the basket stays in the app (`basket_expiration_date`).
- `shippingVatRate` (default `23`): the VAT rate of the shipping price shown in the app, in percent.
- `timeoutMs` (default `15000`, 1000 to 60000): the timeout of one request to InPost.
- `sendOrderEvents` (default `false`): the writer of order events to InPost (below).
- `sessionSecret` (default derived from `clientSecret`): the key of the payment session proofs. Set it when the module and the provider run in different processes without the keys (demo mode on several instances).
- `demo` (default `false`): demo mode, see [Demo mode](https://github.com/Koda-Plus/medusa-integrations/tree/main/packages/medusa-plugin-inpost-pay#demo-mode). It wins over the keys.

The delivery mapping and the places of the button have no option: they are chosen in the admin (Settings) and kept in `inpost_pay_setting`.

## Setup in brief

The admin page has the same steps with their live state (InPost Pay, then Setup guide).

1. Get the keys: the sandbox from InPost (the contact form of the merchant documentation), production from the merchant portal.
2. Install the plugin and its payment provider (above), run the migrations.
3. Enable the provider in the PLN region.
4. Give InPost the Merchant Backend API address: `https://<your backend>/inpostpay` (Settings, InPost account shows it with a copy button). InPost appends the endpoint paths.
5. Map the deliveries in Settings, Delivery: the shipping option of the parcel locker delivery (`APM`) and of the courier (`COURIER`).
6. Put the button on the storefront (below). Until InPost's audit passes, keep it hidden from regular customers (test accounts or a URL parameter), as InPost asks.
7. Go through InPost's test scenarios in the sandbox, then switch to production keys and pass InPost's audit (two test transactions).

## Storefront integration

The storefront reads the switches first:

```ts
const config = await sdk.client.fetch("/store/inpostpay/config")
// { enabled, mode, demo, merchant_client_id, widget_script_url, placements: { product, cart, minicart, checkout, thank_you }, language }
```

In sandbox and live, load InPost's widget and let it ask the store for the binding key. A small React example:

```tsx
import { useEffect } from "react"

export function InpostPayButton({ cartId, place, variantId }: { cartId: string; place: "PRODUCT_CARD" | "BASKET_SUMMARY"; variantId?: string }) {
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const config = await sdk.client.fetch<any>("/store/inpostpay/config")
      if (!config.enabled || config.demo || cancelled) return
      if (!document.querySelector(`script[src="${config.widget_script_url}"]`)) {
        const s = document.createElement("script")
        s.src = config.widget_script_url
        s.onload = () => init(config)
        document.head.appendChild(s)
      } else init(config)
    })()
    function init(config: any) {
      ;(window as any).InPostPayWidget?.init({
        merchantClientId: config.merchant_client_id,
        unboundWidgetClicked: async () => {
          const r = await sdk.client.fetch<any>("/store/inpostpay/baskets", { method: "POST", body: { cart_id: cartId, binding_place: place } })
          return r.widget.basket_binding_api_key
        },
      })
    }
    return () => {
      cancelled = true
    }
  }, [cartId, place])

  // InPost's own placeholder: the widget draws InPost's official button into it.
  return <inpost-izi-button binding_place={place} data-product-id={variantId ?? ""}></inpost-izi-button>
}
```

(Declare `inpost-izi-button` as an intrinsic element in your TypeScript setup, or render it with `dangerouslySetInnerHTML`.) For the product page, `unboundWidgetClicked` first adds the product to the cart, then binds it. The widget's other options (`handleBasketEvent`, `language`) are InPost's; see the Widget 2.0 page of the documentation.

While the customer confirms in the app, the storefront may poll the basket:

```ts
const { basket } = await sdk.client.fetch(`/store/inpostpay/baskets/${basketId}`)
// basket.status: created, linked, rejected, ordered, failed, unbound; basket.order_id once the order exists
```

In demo mode there is no widget (`widget: null`): draw a plain button that says it is a demo, ask for a phone number and call the simulated confirmation:

```ts
const { basket } = await sdk.client.fetch("/store/inpostpay/baskets", { method: "POST", body: { cart_id: cart.id } })
const { order_id } = await sdk.client.fetch(`/store/inpostpay/baskets/${basket.id}/demo-confirm`, { method: "POST", body: { phone } })
// redirect to the order confirmation of order_id
```

## Store API

All store routes need Medusa's publishable API key, like every store route, and no customer login. Errors are `{ code, message }`; show your own text by `code`.

- `GET /store/inpostpay/config`: the switches above. No secret is ever part of it. Cached for 60 seconds.
- `POST /store/inpostpay/baskets` `{ cart_id, binding_place? }`: binds the cart. Answers `{ basket: { id, status, demo, masked_phone, order_id, payment_status }, widget: { merchant_client_id, basket_binding_api_key, script_url } | null }`. `400 CART_EMPTY`, `400 CURRENCY_NOT_SUPPORTED` (not PLN), `404 CART_NOT_FOUND`, `409 CART_COMPLETED`, `502 BINDING_FAILED`; without keys `200 { enabled: false }`. At most 30 per client IP in 10 minutes.
- `GET /store/inpostpay/baskets/:id`: the state of the basket (at most 240 per client IP per minute).
- `POST /store/inpostpay/baskets/:id/demo-confirm` `{ phone }`: demo mode only (404 otherwise). Answers `{ order_id, already, demo: true, basket }`; a second call answers the same order. At most 10 per client IP in 10 minutes.

## Merchant Backend API

What InPost calls. Give InPost the base address `https://<backend>/inpostpay`; InPost appends the paths of its documentation. Every route is public, checked first: in demo mode `403 DEMO_MODE`, without keys `503 NOT_CONFIGURED`, otherwise the signature (below), `401 INVALID_SIGNATURE` when it does not verify. Errors are `{ error_code, error_message }`.

- `GET /inpostpay/v1/izi/basket/{basket_id}`: the basket: `summary` (`basket_base_price` and `basket_final_price` as `{ net, gross, vat }`, `currency` PLN, `basket_expiration_date`, `payment_type: []`), `delivery` (one per mapped delivery the cart can use, with `delivery_type`, `delivery_date`, `delivery_price`), `products`, `promo_codes`. Built fresh from the cart on every call.
- `POST /inpostpay/v1/izi/basket/{basket_id}/confirmation`: the customer linked the basket (`status` SUCCESS) or refused it (REJECT). Keeps the masked phone and InPost's basket id (never the full number) and answers the basket.
- `POST /inpostpay/v1/izi/basket/{basket_id}/event`: `PRODUCTS_QUANTITY` (0 removes the line), `PROMO_CODES` (adds the code), `RELATED_PRODUCTS` (adds the variant). The cart changes through Medusa's own cart workflows; the answer is the whole updated basket.
- `DELETE /inpostpay/v1/izi/basket/{basket_id}/binding`: the basket was unlinked in the app.
- `POST /inpostpay/v1/izi/order`: InPost hands the order over (`order_details`, `account_info`, `delivery`, `invoice_details`). The order is placed as described above; the basket price InPost charged must match the cart (`409 BASKET_PRICE_CHANGED` otherwise), an unmapped delivery answers `422 DELIVERY_NOT_MAPPED`. Idempotent per basket: `201` the first time, `200` with the same order after.
- `GET /inpostpay/v1/izi/order/{order_id}`: the order as the plugin knows it.
- `POST /inpostpay/v1/izi/order/{order_id}/event`: the payment or the order changed in the app (`payment_status` UNPAID, STARTED, PENDING, AUTHORIZED, DECLINED, CANCELLED, ERROR, COD; `order_status`; `payment_type`). Kept on the basket and shown on the order.

The `basket_id` InPost knows is the plugin's basket row id (`ipbsk_...`); the `order_id` is Medusa's order id.

### The signature

As the "Signature verification" page describes it: the headers `x-signature`, `x-signature-timestamp`, `x-public-key-ver` and `x-public-key-hash`; the public key of that version from the Basket App API (`GET /v1/izi/signing-keys/public/{version}`: `public_key_base64` and `merchant_external_id`), cached for an hour; the SHA-256 of the key compared with the hash header; the signed string `base64("<base64(SHA-256(body))>,<merchant_external_id>,<key version>,<timestamp>")` checked with SHA256withRSA over the exact bytes of the body (the plugin keeps the raw body on these routes); the timestamp at most 240 seconds from the server clock.

## The payment provider

The customer pays in the InPost app, never on the storefront, so the provider has nothing to redirect to:

- **demo**: authorized at once; the session data says `demo: true`.
- **sandbox and live**: authorized when InPost hands the order over (`POST /v1/izi/order`, a signed call), because Medusa needs an authorized session to turn the cart into an order. The money state is InPost's payment status, which the plugin keeps on the basket and shows on the order and in the panel. Capture the payment in Medusa when InPost reports `AUTHORIZED` (or when the courier collected cash on delivery).
- **capture, cancel, refund** are recorded in the session data only: settlement and refunds of InPost Pay go through InPost (the merchant portal, or InPost's returns API), not through this provider.
- A session without the plugin's proof (an HMAC of the basket, the cart and the amount) is never authorized, so a shopper cannot complete a cart with this provider through the Store API.

## Order events to InPost (writer)

With `sendOrderEvents: true` the plugin sends `POST /v1/izi/order/{order_id}/event` to the Basket App when an order that came through InPost Pay is canceled (`order_status: ORDER_REJECTED`) and when a shipment is created (`delivery_references_list`, the tracking numbers of its labels). Off by default; in demo mode it is simulated and recorded in the basket history. A failure never fails the cancel or the shipment in Medusa: it is a warning and a history line.

## Demo mode

Only on explicit request: `demo: process.env.INPOST_PAY_DEMO === "true"`. The plugin then never calls InPost, even with keys set:

- the mode badge says **Demo (simulation)** and explains the flow;
- `POST /store/inpostpay/baskets` binds the cart in memory and answers `widget: null`: the demo has no InPost widget, the storefront draws its own button marked as a demo;
- `POST /store/inpostpay/baskets/:id/demo-confirm { phone }` simulates the confirmation in the app with a sample buyer: the name "Demo InPost Pay (symulacja)", an `inpostpay-demo-<hash>@example.com` address (a hash of the phone, the number itself never appears), a sample street in Warsaw and the sample parcel locker `DEMO01M`. The shipping option is the one mapped to the parcel locker delivery or the first the cart can use, the payment session is this plugin's provider in demo, and the cart becomes a real Medusa order, marked as a demo in the basket row and in the session data;
- the panel builds sample rows from the store's newest orders on its first visit (each marked Demo; the orders are only read);
- the Merchant API answers `403 DEMO_MODE`, order events are simulated.

## Admin API

Every route needs an admin session or token. Writes take a JSON body or the `x-koda-request` header (415 otherwise).

- `GET /admin/inpostpay`: the page in one read: the mode, the missing and ignored options, the options in use (secrets masked), the addresses for the merchant portal, the settings, the payment provider state, the store's shipping options and the counters.
- `GET /admin/inpostpay/baskets?filter=&q=&limit=&offset=`: the baskets, newest first. `filter` is a status or `payment_problems`; `q` a basket, cart or order id or an order number.
- `GET /admin/inpostpay/orders/:orderId`: the basket of one order (the order widget).
- `GET /admin/inpostpay/carts?ids=`: the line items of carts of InPost Pay baskets (the products column).
- `GET`, `POST /admin/inpostpay/settings`: `delivery: { APM, COURIER, DIGITAL }` (shipping option ids of the store or null) and `placements: { product, cart, minicart, checkout, thank_you }`.
- `GET /admin/inpostpay/check`: the connection check (an OAuth token).
- `POST /admin/inpostpay/demo/seed`: demo mode only, the sample rows.
- `GET /admin/inpostpay/integration`, `/integration/summary`, `/integration/attention`: the koda.integration/1 contract (below).

## One InPost menu

With the [InPost plugin](https://github.com/Koda-Plus/medusa-integrations/tree/main/packages/medusa-plugin-inpost) of Koda Plus in the same app, InPost Pay does not take a sidebar entry of its own: its page is the "InPost Pay" tab of the "InPost" entry (`/app/inpost?service=pay`), next to Shipping and, when installed, Von Halsky. The page in the tab is the same page, drawn by this plugin (header with the mode badge, Panel, Setup guide, Settings).

- `/app/inpostpay` keeps working: it moves to the tab with every parameter (`/app/inpostpay?filter=payment_problems` opens the tab on that list), so links from hosts, counters and the order card need no change.
- The own sidebar entry steps aside at runtime (Medusa has no conditional sidebar entries): its icon draws a hidden marker while the InPost plugin is there and one CSS rule of the shared kit hides that link. In a browser without CSS `:has()` the entry stays and leads to the tab.
- Without the InPost plugin nothing changes: the own entry "InPost Pay" and the page at `/app/inpostpay`, as before. Nothing to configure, and no import between the packages: the two meet in the registry of the shared kit (page tabs, kit 1.1.0).

## Works with Koda Plus hosts

- `GET /admin/inpostpay/integration`: the manifest (mode `demo`, `sandbox`, `live` or `off`, entity `order`, the widget `inpostpay.order` in `order.details`, the writer of order events).
- `GET /admin/inpostpay/integration/summary?entity=order&id=order_...`: one line per order that came through InPost Pay: paid (green), cash on delivery (green, fact code `cod`), payment pending (blue), declined, canceled, error or rejected (red); the payment and delivery facts (the masked phone, the parcel locker).
- `GET /admin/inpostpay/integration/attention?scope=orders`: `payment_problems` (red, orders whose InPost payment failed) and `failed_baskets` (orange, baskets whose order could not be placed), linked to the filters of the page.

## What the documentation said, and what it did not

The plugin follows InPost's public merchant documentation (dokumentacja-inpost.atlassian.net, space PL, starting at [Scope of works on the Merchant's side](https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/151355427/Scope+of+works+on+the+Merchant+s+side)). These parts could be read and are modelled as written: the list of Merchant Backend API endpoints and their paths, the signature headers and algorithm with the 240 second window, the OAuth client credentials flow and the token addresses of both environments, the Basket App API paths and base addresses, the binding key of Widget 2.0, the widget script addresses and `InPostPayWidget.init` options, the basket summary and delivery fields, the order request fields, the payment and order statuses, the basket and order event fields.

These parts were cut off or not stated in the pages that could be read, and the plugin handles them as said here instead of guessing silently:

- The products part of the basket (`products`, `related_products`, `consents`): the field names used (`product_id`, `product_name`, `product_description`, `product_link`, `product_image`, `ean`, `base_price`, `final_price`, `quantity` with `quantity_type` and `quantity_unit`) are those the readable pages and the basket event page name. No consents are sent.
- The response bodies of `POST /v1/izi/order` and `GET /v1/izi/order/{order_id}`: the plugin answers `order_details` (order id, basket id, dates, `order_status`, `payment_status`, `payment_type`, `currency`, `basket_price`) and `delivery`.
- Error codes of the Merchant API other than `INVALID_SIGNATURE`: the plugin uses its own stable codes (`BASKET_NOT_FOUND`, `DELIVERY_NOT_MAPPED`, `BASKET_PRICE_CHANGED`...).
- Whether `basket_price` of an order includes the delivery: both the cart total and the total without shipping are accepted.
- The request body of the binding call (documented as none, so none is sent) and whether the Basket App API needs a path prefix (the signature page shows `/basket-app/api/v1/izi/...` in one example): use `apiUrl` to add one.
- Whether the key hash header is hex or base64: both are accepted.
- Where the POS id is used, and the returns API.

Check these against the sandbox before going live; the option overrides and the history of every basket make the differences visible.

## Security and data

- **Secrets**: the client secret is sent only to InPost's token endpoint, never to the admin (it sees `***` and the last four characters) and is masked in logs and stored errors. The Merchant Client Id is public by design.
- **InPost's calls are verified**: signature, key hash, exact body and the 240 second window; unknown key versions are not fetched more than 10 times a minute, so forged calls cannot make the store hammer InPost.
- **Payment sessions**: only sessions with the plugin's proof are authorized.
- **Public store routes** are rate limited per client IP in the memory of each process (the first address of `X-Forwarded-For` behind a proxy) and refuse anything but a `cart_...` id. The basket id is a random id only the storefront session that bound the basket knows.
- **Writes need the admin**: writes under `/admin/inpostpay` take a JSON body or the `x-koda-request` header. A shopper may not set `inpostpay_` or `inpost_pay_` metadata on carts or the account.
- **What the plugin keeps** (`inpost_pay_basket`): the cart and order ids, the status, the masked phone (never the full number), the delivery type and parcel locker, InPost's payment and order statuses, the amount, where the button was, the binding key, InPost's basket id, a masked last error and at most 50 history lines. The buyer's name, e-mail and address go only on the Medusa cart and order, like any checkout. No automatic retention: delete rows by hand when needed.
- **Writers**: the only write into InPost beyond what the flow needs is `sendOrderEvents`, off by default.

## Branding

This plugin is an independent integration. It contains no InPost logo, button artwork or imitation of the InPost app: the admin icon is a generic Koda Plus mark, and the demo button is the store's own. In production, show InPost's official button through InPost's Widget 2.0 and follow InPost's brand guidelines and display rules (the product page, the cart and the thank-you page are mandatory placements, and InPost provides the banners).

## Uninstall

1. Remove the plugin and its provider from `medusa-config.ts`, the package from `package.json` and the button from the storefront. Tell InPost to stop calling the Merchant API address.
2. The tables `inpost_pay_basket` and `inpost_pay_setting` stay with their data. Drop them by hand when you no longer need them, or run `npx medusa db:rollback inpostpay` before removing the package. The orders stay in Medusa.

## Compatibility

Medusa 2.12 or newer (peer range `^2.12.0`) and Node.js 20+. The tests and the build run on Medusa 2.15.3. The admin libraries (`@medusajs/ui`, `@medusajs/icons`, `@tanstack/react-query`, `react`, `react-i18next`, `react-router-dom`) are optional peers: the plugin uses the copies of Medusa's dashboard. Developing the plugin needs Node.js 22.6+ (the tests run the TypeScript sources directly).

## Public API

What other code may import: `@koda-plus/medusa-plugin-inpost-pay/workflows` (`bindCart`, `placeOrder`, `createOrderFromInpost`, `applyInpostOrderEvent`, `notifyInpost`, `demoConfirm`, `inpostPayIntegration`, the types), `@koda-plus/medusa-plugin-inpost-pay/modules/inpostpay` (the module, its options and the response types), `@koda-plus/medusa-plugin-inpost-pay/providers/inpostpay` (the payment provider) and `/admin`. Every other path is internal and may change in any release.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. Need InPost Pay wired into your storefront, your checkout or your ERP? Write to kontakt@koda.plus.

## Trademarks

InPost, InPost Pay, Paczkomat, BLIK and Medusa are trademarks of their owners, used here only to identify the service this plugin connects to and the platform it runs on. This is an independent integration built on InPost's public merchant documentation, not affiliated with or endorsed by InPost or Medusa.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-inpost-pay/LICENSE).

## Changelog

Every release is in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-inpost-pay/CHANGELOG.md).

- 0.1.0 (unreleased): the first version. The button, the Merchant Backend API with signature verification, the order through the plugin's payment provider, order events to InPost, the admin page and the order widget, demo mode, the koda.integration/1 contract, one InPost menu with the InPost plugin. It needs `npx medusa db:migrate`.
