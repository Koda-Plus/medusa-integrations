# Negotiations by Koda Plus

B2B price negotiations for Medusa. A logged-in customer asks for a better price on a product, a variant or a whole cart, with a quantity, a target price and a message. Your team answers in the Medusa admin: replies, counter offers, accepts, rejects and internal notes, from a queue that shows what waits for you first. The customer follows the same thread in the store and can accept your offer there. Stale threads expire on their own.

Every move is an event with a documented, stable payload, so e-mails, a CRM or an ERP can follow without touching the plugin. Accepting records the agreed unit price; turning it into a Medusa draft order is a separate writer, off until you allow it in the options and arm it in the admin.

![Negotiations page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-negotiations/docs/admin-negotiations.png)

**Live demo:** Medusa admin [medusa.koda.plus/app/negotiations](https://medusa.koda.plus/app/negotiations?demo=en), signed in to a public demo account by the link itself. The demo runs the plugin in demo mode: a story of negotiations built from the store's own catalog, in every state, and every move works on it.

## What it does

- **Customers ask** through the Store API: a thread about a product, a variant or their own cart, with a quantity, an optional target price and a message. Only logged-in customers, only products the store sells to them, one open thread per subject.
- **The team answers** on the Negotiations page: the queue with status filters and search, the thread drawer with the whole conversation and the facts (list price, the customer's target, your offer, the value, the discount), and the moves: reply, counter offer with an optional validity, accept, reject with a reason, internal note.
- **The customer decides** in the store: reads your offer, accepts it, answers with a new target, or declines.
- **Stale threads expire** after a number of days without a move, or when a counter offer's own validity runs out.
- **Everything is an event**: `negotiation.opened`, `.message_added`, `.countered`, `.accepted`, `.rejected`, `.expired`.
- **Draft orders at the agreed price**, optionally: an accepted thread becomes a Medusa draft order for its customer, planned first and created once.

## Features

- **Negotiations page in the admin** with three views switched in the header: **Panel** (counters, the queue, the thread drawer), **Setup guide** (also as `?view=guide`) and **Settings** (`?view=settings`). `?thread=<id>` opens a thread directly.
- **Counters** for what waits for the team, open threads, counter offers, accepted, rejected and expired ones, the value in talks and what was agreed in the last 30 days, per currency.
- **The status machine** of the original Koda Plus module: `open`, `counter_offered`, `accepted`, `rejected`, `expired`. Every move is one conditional database update: two people (or a person and the expiry job) can never both close a thread.
- **Accept what you read**: the store's accept and the admin's accept carry the price their side saw; when it changed in the meantime the answer is 409 and nothing is agreed.
- **Internal notes** on any thread, open or closed, never shown to the customer and never announced.
- **Whose move it is**: every thread knows whether it waits for the team or for the customer, and the queue sorts and filters by it. "Answer the oldest" opens the thread that has waited longest.
- **Cart negotiations**: one price for the whole cart, with a snapshot of its lines at the moment it was sent.
- **Widgets** on the product page (negotiations about this product), the customer page (this customer's threads) and above the order list (what waits for the team).
- **Exact money**: amounts are integers in minor units with their currency code, prices travel as decimal text; no floating point, no `bigNumber` columns.
- **Draft order writer** with the house safety rules: two switches, a plan with the exact input, a dry run, a cap per run, exactly once per thread, a lookup after an interrupted run.
- **Demo mode**: nine negotiations built from your catalog and customers, flagged `demo`, rebuilt daily, never shown to customers and never mixed with real threads.
- **Setup guide** in the admin with live step states, the storefront calls, a go-live checklist and troubleshooting, in English and Polish.
- **Admin in English and Polish** through the Medusa admin translations.
- **Workflows included** for every move, the expiry pass and the writer.

## Requirements

- Medusa 2.12 or newer (tested on 2.15.3) and Node.js 20+.
- A storefront where customers log in: the Store API serves logged-in customers only (session or bearer token).

## Installation

```bash
npm install @koda-plus/medusa-plugin-negotiations
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-negotiations` or `pnpm add @koda-plus/medusa-plugin-negotiations`.

## Configuration

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-negotiations",
      options: {
        expiryDays: 14,
        // taxInclusive: false, // negotiated prices are net (B2B)
        // writers: { draftOrders: true }, // allow the draft order writer, then arm it in Settings
        // demo: process.env.NEGOTIATIONS_DEMO === "true", // sample threads from your catalog
      },
    },
  ],
})
```

Run the migrations, then open **Negotiations** in the admin sidebar:

```bash
npx medusa db:migrate
```

### Options

Every option is optional, and nothing here can stop Medusa from starting: a value that makes no sense falls back to its default. Numbers may come as strings (environment variables).

Behaviour:

- `demo` (default `false`): sample threads built from your catalog, for evaluation. Threads customers open in demo mode are demo threads too: turn it off before your storefront goes live.
- `expiryDays` (default `14`, up to `365`): an open or countered thread expires after this many days without a move. `0` turns the clock off; counter offers with their own validity still expire.
- `defaultCurrency` (default: the store's default currency): the currency of product threads that name none.
- `taxInclusive` (default `false`): negotiated prices include tax. Shown in the admin and the Store API, used for draft order lines.
- `storeApi` (default `true`): the Store API. `false` answers 404 on every `/store/negotiations` route.
- `customerAccept` (default `true`): customers may accept a counter offer in the store. With `false`, only the team accepts.

Limits per customer (the Store API answers 429 or 409 past them):

- `maxActivePerCustomer` (default `20`): open threads (open or countered) at once.
- `openPerHour` (default `10`): new threads an hour.
- `messagesPerHour` (default `60`): messages, accepts and declines an hour.
- `maxMessageLength` (default `2000`, from 200 to 10000 characters).
- `maxQuantity` (default `100000`).

Writers (off by default in live mode; in demo mode they default to on and only simulate):

- `writers.draftOrders` (default `false`): allows the draft order writer. A person still arms it in Settings; `false` here wins over the admin.
- `draftOrders.regionId` (default: the first region in the thread's currency): the region of the drafts.
- `draftOrders.salesChannelId` (default: the store's default sales channel).
- `draftOrders.maxPerRun` (default `10`): drafts one run creates at most.

Presentation:

- `references` (default empty): stores running the plugin, shown as "Running in production" in the header and the setup guide. Each entry: `name`, `url` (https), and optionally `icon`, `description` (a string, or `{ en, pl }`), `metrics` (`[{ label, value }]`), `links` (`[{ label, url }]`) and `review`. A store that starts on Medusa soon gets `soon: true`: it is shown with a "Soon" badge and no link, and its `url` is optional. Entries without a name, or live entries without an https URL, are dropped; nothing here can break the boot. The package itself names no store.

## Store API

Every route needs the publishable API key and a logged-in customer (the session cookie, or `Authorization: Bearer` with a customer token). Prices are decimal text in major units with the decimals of the thread's currency (`"469.00"`, `"1200"` for JPY); in requests `"469,50"` works too. For a cart thread prices are for the whole cart, otherwise per unit.

- `GET /store/negotiations`: the customer's negotiations, latest activity first. Query: `status` (one or more, comma separated), `product_id`, `variant_id`, `cart_id` (is there a negotiation about this?), `limit` (up to 50), `offset`. Answer: `{ negotiations, count, limit, offset }`.
- `POST /store/negotiations`: opens a thread. Body: `product_id`, `variant_id` or `cart_id` (a product with a single variant becomes a variant thread), `quantity` (not for a cart), `target_price` (optional: without it the customer asks for an offer), `currency_code` (optional, a currency the store sells in; a cart thread is in the cart's currency), `message`. Answer 201: `{ negotiation }` with the first message.
- `GET /store/negotiations/:id`: one thread with its conversation, never the team's internal notes, and what the customer may do now: `can_reply`, `can_accept`, `can_decline`.
- `POST /store/negotiations/:id/messages`: `{ message, target_price? }`. With `target_price` it is a new target, and a countered thread is open again.
- `POST /store/negotiations/:id/accept`: `{ price?, message? }` accepts the team's counter offer. Send `price` as shown (`offered_price`): when the offer changed meanwhile the answer is 409 `offer_changed` with the new `offered_price`, and nothing is accepted.
- `POST /store/negotiations/:id/decline`: `{ message? }` declines and closes the thread.

A thread answers with `id`, `ref` (like `NEG-2026-1001`), `status`, `subject`, `product_id`, `variant_id`, `cart_id`, `title`, `sku`, `quantity`, `currency_code`, `requested_price`, `offered_price`, `agreed_price`, `price` (the price on the table), `tax_inclusive`, `items` (cart lines), `waiting_for` (`team` or `customer`), `expires_at`, `created_at`, `updated_at`, `last_activity_at`, `message_count`, the three `can_*` flags and, for one thread, `messages` (`author` is `customer`, `team` or `system`; `kind` is `message`, `counter`, `accepted`, `rejected` or `expired`; `price` is what the message carries).

Errors carry a stable `code` next to the message, for the storefront's own texts. 401 comes from Medusa's customer authentication when nobody is logged in; then: 404 `not_found`, `product_not_found`, `variant_not_found`, `cart_not_found` or `disabled`; 400 `invalid_data` with `errors: [{ field, code, message }]` or `variant_mismatch`; 403 `accept_disabled`; 409 `closed`, `expired`, `no_offer`, `offer_changed`, `already_open` (with `negotiation_id`), `too_many_active`, `thread_full`, `cart_completed` or `cart_empty`; 429 `rate_limited` with `Retry-After`. Someone else's thread or cart answers 404, exactly like one that does not exist.

```ts
const res = await fetch(`${MEDUSA_URL}/store/negotiations`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json", "x-publishable-api-key": PUBLISHABLE_KEY },
  body: JSON.stringify({ variant_id, quantity: 24, target_price: "469.00", message: "24 pcs for a new branch" }),
})
```

## Events

The contract other plugins and apps build on. Each move emits one event on the Medusa event bus, after the move is stored:

- `negotiation.opened`: a customer opened a thread.
- `negotiation.message_added`: a customer or the team wrote. A customer message may carry a new target price and move a countered thread back to `open`.
- `negotiation.countered`: the team offered a price.
- `negotiation.accepted`: a price was agreed, by the customer accepting the offer or by the team accepting the price on the table.
- `negotiation.rejected`: the team rejected, or the customer declined.
- `negotiation.expired`: nobody moved within the expiry window, or an offer's validity ran out.

Internal notes emit nothing. Every event carries the same data, the thread after the move:

- `id` (string): the negotiation id.
- `ref` (string): the readable reference, like `NEG-2026-1001`.
- `status`: `open`, `counter_offered`, `accepted`, `rejected` or `expired`, after the move.
- `previous_status`: the status before the move; `null` for `negotiation.opened`.
- `subject`: `product`, `variant` or `cart`.
- `customer_id`, `product_id`, `variant_id`, `cart_id`, `sku` (string or null).
- `qty` (number): the quantity; `1` for a cart.
- `price` (string or null): the price on the table after the move, decimal text in major units (`"469.00"`); the agreed price once accepted. Per unit, or for the whole cart.
- `price_amount` (number or null): the same in minor units (`46900`).
- `requested_price`, `offered_price`, `agreed_price` (string or null): the customer's latest target, the team's latest offer, the agreed price.
- `currency_code` (string or null): lower case, like `pln`.
- `expires_at` (ISO 8601 or null): when the thread expires under the current options.
- `actor`: `customer`, `admin` (the team) or `system` (the plugin, for expiry).
- `actor_id` (string or null): the customer id or the admin user id behind the move.
- `message_id` (string or null): the message stored with the move.
- `demo` (boolean): a thread of demo mode. Never send e-mails or write real data for it.

The names and these fields are stable: new fields may be added, none renamed, removed or retyped. To read the conversation, the customer and the message of `message_id`, use `getNegotiationThread(container, id)` from `@koda-plus/medusa-plugin-negotiations/workflows`.

```ts
// src/subscribers/negotiation-mails.ts
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

export default async function negotiationMails({ event }: SubscriberArgs<{ id: string; status: string; price: string | null; demo: boolean }>) {
  if (event.data.demo) return
  // event.name tells what happened; event.data is the thread after the move
}

export const config: SubscriberConfig = {
  event: ["negotiation.opened", "negotiation.countered", "negotiation.accepted", "negotiation.rejected", "negotiation.expired", "negotiation.message_added"],
}
```

## Accept and the draft order writer

Accepting a thread records the agreed price (`agreed_price`), closes the thread and emits `negotiation.accepted`. Nothing else in the store changes: what happens next (a price list entry, a quote, an order) is your store's decision, and the event tells your code.

The **draft order writer** is the one write into Medusa this plugin can make, off by default:

1. Allow it in the options (`writers.draftOrders: true`). Without that, the admin cannot arm it.
2. Arm it in **Settings**, **Writers**. The toggle is stored with who flipped it and when, apart for demo and live mode.
3. From then on, an accepted thread is queued (one row per thread, a unique index makes a second impossible). Threads accepted before arming are never swept in; a person can queue one from its drawer.
4. The **plan** shows every queued thread with the exact input of Medusa's `createOrderWorkflow`, or why it cannot become a draft: a cart thread (one price for the whole cart, a person decides how it splits across lines), a product thread without a chosen variant, no region in the thread's currency, no customer e-mail. **Dry run** returns the same without writing.
5. Every 10 minutes (or on **Create now**) the writer creates at most `draftOrders.maxPerRun` drafts: the customer, one line of the variant, the quantity, the agreed unit price as a custom price, the region of the currency, the customer's default addresses when saved, `no_notification`, and `metadata.negotiation_id`. Each row is claimed by one process with a lease; a failure keeps Medusa's message and is retried three times by the job, then waits for a person; a run that stopped mid-create leaves the row `unknown`, and the next run looks for a draft with the thread's id before creating anything.

The team finishes the draft in **Orders**, **Draft orders** (shipping, address) and converts it. In demo mode the writer only simulates: no draft order reaches Medusa.

## Admin API

- `GET /admin/negotiations`: the page status: mode, options in use, counters, value in talks, the writer, the last runs, references.
- `GET /admin/negotiations/threads`: the queue. Query: `status` (all, waiting, or a status), `q` (reference, SKU, title, or a customer or product their modules find), `customer_id`, `product_id`, `order` (`recent` or `oldest`), `limit` (up to 100), `offset`.
- `GET /admin/negotiations/threads/:id`: one thread with the whole conversation, internal notes included.
- `POST /admin/negotiations/threads/:id/messages` `{ message }`, `/counter` `{ price, message?, valid_days? }`, `/accept` `{ price?, message? }`, `/reject` `{ message? }`, `/notes` `{ note }`, `/draft-order` (queue the draft order of an accepted thread).
- `GET /admin/negotiations/products/:id` and `GET /admin/negotiations/customers/:id`: the widgets.
- `POST /admin/negotiations/expire`: the expiry pass now.
- `GET /admin/negotiations/runs`: the history of background runs.
- `POST /admin/negotiations/writers` `{ writer: "draftOrders", on }`, `GET /admin/negotiations/writers/plan`, `POST /admin/negotiations/writers/run` `{ dry_run? }`.
- `POST /admin/negotiations/demo/reset`: demo mode only, rebuilds the demo story.

Every admin route works on the threads of the current mode only. No route deletes anything.

## Jobs

- `negotiations-expire`, every hour at :15: closes threads past their expiry, with a system message and `negotiation.expired` for each. Live threads only.
- `negotiations-draft-orders`, every 10 minutes: the draft order writer, only when it is armed.

## Workflows

```ts
import {
  openNegotiationWorkflow,
  addNegotiationMessageWorkflow,
  counterNegotiationWorkflow,
  acceptNegotiationWorkflow,
  rejectNegotiationWorkflow,
  expireNegotiationsWorkflow,
  runNegotiationDraftOrdersWorkflow,
  getNegotiationThread,
} from "@koda-plus/medusa-plugin-negotiations/workflows"

const { result } = await counterNegotiationWorkflow(container).run({
  input: { id: "neg_01J...", user_id: "user_01J...", price: "469.00", message: "Best we can do", valid_days: 7 },
})
// result: the thread after the move, in the shape of the event data
```

The moves have no compensation on purpose: a move is a conversation the other side may already have read. Every move is one conditional write, so a retried step either writes once or finds the move done (409).

## Setup in brief

The admin has the full guide (**Negotiations**, **Setup guide**), with the state of every step taken from your store.

1. Install the package, add it to the plugins in `medusa-config.ts`, run `npx medusa db:migrate`.
2. Add a "Negotiate a price" button to the product page (and the cart): `POST /store/negotiations` with the publishable key and the customer's session.
3. Show the customer's negotiations in the account: list, thread, reply, accept, decline.
4. Answer from the queue: reply, counter, accept, reject, notes.
5. Choose `expiryDays`.
6. Subscribe to the events for e-mails or your CRM; skip `demo: true`.
7. Optionally allow and arm the draft order writer, after reading the plan and the dry run.
8. Turn `demo` off before the storefront goes live, and walk the go-live checklist.

## Security and data

- **Logged-in customers only.** The plugin's middleware authenticates the customer on every `/store/negotiations` route (session or bearer), and each route checks the actor again. A customer reads and moves only their own threads; anything else answers 404, like a thread that does not exist.
- **Only what the store sells to them.** A thread can be opened for a published product in a sales channel of the publishable key, or for the customer's own cart that is not completed.
- **Rate limits and caps** per customer: new threads an hour, messages an hour, reads a minute, open threads at once, messages per thread, body size (64 KB).
- **Plain text.** Messages are stored as plain text, with control characters and bidirectional overrides removed; every screen escapes them.
- **Internal stays internal.** Notes and writer records never reach the Store API; the Store API never shows team names or ids.
- **One move wins.** Moves are conditional updates in a transaction; accepts carry the price their side saw.
- **Demo apart.** Demo threads are flagged `demo` and each mode shows only its own; the demo story is never shown to customers.
- **What is stored:** the thread (customer id, product and variant ids, SKU, the product title at the time, quantity, amounts, currency, the cart's lines for a cart thread) and its messages. No addresses, no e-mail addresses, no payment data. The draft order writer reads the customer's e-mail and default addresses from Medusa at the moment it creates the draft and passes them to Medusa, nothing more.

## What this plugin does not do

- It does not change prices in your catalog, price lists or carts: an agreed price is recorded and announced, and only the optional writer turns it into a draft order.
- It does not send e-mails or notifications; it emits events for whatever sends them.
- It does not split a cart's agreed price across order lines: cart threads never become draft orders automatically.
- It does not let guests negotiate: the Store API serves logged-in customers only.
- It does not attach files to messages.
- It does not convert currencies: a thread lives in one currency.
- It does not delete threads or messages.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers the money rules, the status machine move by move, the request validation, expiry, the demo story, the event payload, the store and admin answers, the SQL of every conditional write, the flows end to end (ownership, races between two moves, expiry, old rows of the app module, demo mode) and the draft order writer (plan, dry run, exactly once, failures, an interrupted create). With `NEGOTIATIONS_TEST_PG_URL` set to a scratch Postgres, one more test runs the migration (on the app module's tables, twice) and every statement against a real database, in a schema of its own that it drops afterwards. To try the plugin in a Medusa app, run `npx medusa plugin:publish` here, then `npx medusa plugin:add @koda-plus/medusa-plugin-negotiations` in the app.

### Upgrading from the Koda Plus app module

Stores that ran the earlier Negotiations module of the Koda Plus demo (tables `negotiation` and `negotiation_message`) upgrade in place: the migration only adds columns and tables, with `if not exists` everywhere, and touches no existing row except to fill the new bookkeeping columns (last activity, message count, whose move it is, the subject, when a closed thread closed). The old single `target_price` is read as the target, the offer or the agreed price by status, and written into the new amount columns on the first move; old Polish system notes are shown in the admin's language.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. The same negotiation flow runs in the Koda Plus B2B demo store next to our OLX, Allegro, BaseLinker, Subiekt nexo and Fakturownia integrations. Need it wired into your storefront, connected to your e-mails or ERP, or a custom B2B flow? Write to kontakt@koda.plus.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-negotiations/LICENSE).

## Changelog

### 0.1.0 (2026-10-06)

First public release, a generic version of the negotiations module Koda Plus built for its B2B demo store: the Store API for logged-in customers, the admin page with the queue, the thread drawer and widgets, the status machine with conditional moves, expiry, internal notes, cart negotiations, exact money, six documented events, the opt-in draft order writer, demo mode, and an in-place upgrade of the app module's tables.
