# Changelog

## 0.1.0 (unreleased)

The first version: one-click checkout with the InPost mobile app (InPost Pay) for Medusa v2. Run `npx medusa db:migrate` after installing: one migration (`Migration20261018120000_inpostpay`) adds the baskets and the settings tables. Register the payment provider (`@koda-plus/medusa-plugin-inpost-pay/providers/inpostpay`, `id: "inpost-pay"`) under the payment module and enable it in the PLN region.

### Storefront

- `GET /store/inpostpay/config`: whether InPost Pay is on, the mode, the public Merchant Client Id and the widget script, the places of the button.
- `POST /store/inpostpay/baskets { cart_id, binding_place? }`: binds the cart to an InPost Pay basket and answers the `basket_binding_api_key` of Widget 2.0. PLN only; rate limited per client IP.
- `GET /store/inpostpay/baskets/:id`: the state of the basket while the customer confirms in the app.
- `POST /store/inpostpay/baskets/:id/demo-confirm { phone }` (demo mode only): the simulated app confirmation that places a real Medusa order with a sample buyer. Idempotent.

### Merchant Backend API

- `/inpostpay/v1/izi/basket/{basket_id}` (GET), `/confirmation`, `/event` (POST), `/binding` (DELETE), `/inpostpay/v1/izi/order` (POST), `/order/{order_id}` (GET), `/order/{order_id}/event` (POST), as InPost's merchant documentation lists them.
- Every call verified with InPost's signature (SHA256withRSA over the documented string, the key of the named version with its hash, the exact raw body, 240 seconds).
- The order: buyer and addresses on the cart, the mapped shipping option with the parcel locker as `machine_id`, a payment session of the plugin's provider, the cart completed. Idempotent per basket; the price InPost charged must match the cart.

### Payment provider

- `pp_inpost-pay_inpost-pay`: authorizes only sessions with the plugin's proof (an HMAC of the basket, the cart and the amount), so the Store API cannot complete a cart with it. Demo authorizes at once, sandbox and live when InPost hands the order over; InPost's payment status is kept on the basket.

### Admin

- `/app/inpostpay`: Panel (counters, baskets with products, delivery, masked phone, payment status and history), Setup guide with live step states and the Merchant API address, Settings (delivery mapping, button places, the InPost account and the connection check).
- The order widget `inpostpay.order` (order details, side column, hostable).
- The koda.integration/1 contract: manifest, order summary, counters `payment_problems` and `failed_baskets`.
- One InPost menu (shared kit 1.1.0, page tabs): with the InPost plugin of Koda Plus in the same app, the page is the "InPost Pay" tab of its "InPost" entry (`/app/inpost?service=pay`), `/app/inpostpay` redirects there with every parameter and the own sidebar entry steps aside. Without it the page and the entry stand alone.

### Writer

- `sendOrderEvents` (off by default): a canceled order is reported as `ORDER_REJECTED`, a created shipment sends its parcel numbers.

### Demo mode

- The option `demo` (only on explicit request, it wins over the keys): baskets bound in memory, the simulated confirmation, sample rows from the newest orders, nothing ever reaches InPost.
