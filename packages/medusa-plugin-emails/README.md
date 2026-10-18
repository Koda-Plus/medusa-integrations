# E-mails by Koda Plus

Transactional e-mails for Medusa, sent through Resend, ready the moment you install them: the order confirmation, the shipping e-mail with tracking numbers, the cancellation, the welcome and the password reset, in English and Polish, in your store's look and with a dark mode. Every message is sent once per event, logged with the address masked, and visible in the Medusa admin, where you preview every template live and send yourself a test.

The templates carry no images: the store name is live text and products are tiles with their name, SKU, quantity and price, so nothing breaks when a mail app blocks images. Your own templates (a B2B approval, an invoice, a campaign) plug into the same registry and the same look.

A store that already sends its e-mails through its own provider keeps it: in app mode the plugin sends nothing itself and gives that provider the same page (see Next to your own e-mail provider). With a Resend key that can read, the page also shows what happened after sending: delivered, delayed, bounced, and the addresses Resend no longer sends to.

![E-mails page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-emails/docs/admin-emails.png)

**Live demo:** Medusa admin [medusa.koda.plus/app/emails](https://medusa.koda.plus/app/emails?demo=en), signed in to a public demo account by the link itself. The demo runs the plugin in demo mode: every e-mail the store would send lands in a simulated outbox you can open, and nothing leaves the server.

## What it does

- **Sends the store's e-mails through Resend**, as a Medusa notification provider: subscribers to Medusa's events render the right template in the customer's language and hand it to the notification module, the provider sends it.
- **Exactly once per event**: one idempotency key per event (`emails:order.placed:<order id>`), checked by Medusa's notification module, claimed atomically in the plugin's send log, and sent to Resend as the `Idempotency-Key` header.
- **Logs what went out** with the recipient masked (`a***@e***.com`; in app mode in full with `showAddresses`): the template, the subject, the status, the Resend id, the error when there was one.
- **Shows it in the admin**: counters, the log, counts per template, the template gallery with a live preview (light and dark, desktop and phone, Polish and English, sample data or your newest order), a test send, and the e-mails of each order on the order page.
- **Reads what happened after sending** (option `deliveryKey`, GET requests only): the addresses Resend no longer sends to, with the reason and the message that caused it, and in app mode the delivery state of every message in the log.
- **Runs next to your own provider** (option `appProvider`): the page, the previews, the tests and the log for the e-mails your store already sends, with Medusa's whole history of them.

## Templates

Wired to Medusa's events, on by default:

- **Order confirmation** (`order.placed`, on `order.placed`): the order's road on a tracker, number, date, delivery, the products with their amounts, the totals with tax and discount notes, the delivery address, a link to the order.
- **Order shipped** (`order.shipped`, on `shipment.created`): every tracking number with its link (from the label, or from your `trackingUrls`), the products of this parcel, and a note when the rest follows in another parcel.
- **Order cancelled** (`order.canceled`, on `order.canceled`): the order as a slip with its status, the cancelled products, where the money goes.
- **Welcome** (`customer.welcome`, on `customer.created`, registered accounts only): a customer card and three first steps.
- **Password reset** (`password.reset`, on `auth.password_reset`): a button to your storefront's reset page for customers, to the admin's for admin users, how long the link works, what to do if it was not you.

Optional, off until you turn them on:

- **Abandoned cart** (`cart.abandoned`, an hourly job): carts idle between 24 and 72 hours with an address and products, one reminder per cart, at most 50 an hour.
- **Negotiation e-mails** (`negotiation.countered`, `negotiation.accepted`, `negotiation.rejected`): for the events of `@koda-plus/medusa-plugin-negotiations` when it is installed. The offer with its price per unit (or for the whole cart), the quantity and how long a counter offer is valid. A customer who declines an offer gets no e-mail about their own click. The plugins know each other by event name only; this one has no dependency on that one.

## Features

- **E-mails page in the admin** with three views switched in the header: **Panel** (the counters and the log, with the test send and the Templates button in the header), **Setup guide** (also as `?view=guide`) and **Settings** (the gallery of template previews, the template switches, branding, the provider).
- **Counters that open what they count**: a tile narrows the log to its filter and time window and scrolls to it; "All e-mails" shows the whole log again.
- **The log**: the template, the recipient, the status, an Order column (the order with "Open the order", its state and the link of its template group), the Resend id linked to the message in Resend's dashboard when Resend sent it, a search by address, subject, template or order number, filters, and a drawer per message.
- **Rejected addresses** (option `deliveryKey`): a tile and a list of the addresses Resend no longer sends to (bounced, reported as spam, added by hand), each with the subject of the message that caused the block, a link to it in Resend, a corrected address when the domain is a known typo (`gmial.com`), and the mailing it came from (option `campaigns`).
- **Template groups** (option `templateGroups`): pills above the log for a set of templates (for example the store's payment reminders), with the stage of each message, the state of its order now and a link to the admin page that acts on it.
- **Live preview** of every template, built-in or yours, exactly as the provider renders it, with your branding: light or dark, desktop or phone, Polish or English, on sample data or on your newest order, cart or customer (with the customer's name, company and address replaced by sample ones).
- **Test send** to an address you type, through the same path as every e-mail, so it also proves the setup. The subject starts with `[Test]`; at most 5 tests per person in 10 minutes and 30 an hour for the store.
- **Branding** from the options or from the admin: the store name, a live-text logo (with an accent part such as a "+" and a lighter suffix), the accent and band colours, a footer line per language, a support address. Colours derive the rest: text in the accent colour is darkened or lightened until it reads at 4.5:1, the neutrals take the hue of the band, a band too light for white text is darkened.
- **Every template switchable**: the option is the hard switch (`templates: { key: false }`), the admin switch the runtime one, with who flipped it and when.
- **Per-recipient language**: the order's or cart's `locale`, then `locale` or `language` in the order's, cart's or customer's metadata, then `defaultLocale`.
- **Dark mode** for Apple Mail and most apps, Outlook.com included; Polish typography with no one-letter word at the end of a line.
- **Under Gmail's clipping size** and a plain-text part in every message; long orders show 30 lines and a sum-up line.
- **Retry from the admin** for failed messages of the order, shipping, cancellation, welcome and cart templates: the data is read again, the provider takes the failed row over, Resend gets a fresh key.
- **Order widget** on every order page: the e-mails of that order with their status, one click to the message; a host can show it as a tab (see Works with Koda Plus hosts).
- **Deep links** into the log: `/emails?filter=attention&since=7d`, `/emails?filter=bounced`, `/emails?order_id=order_...`, `/emails?customer_id=cus_...`, `/emails?q=anna@example.com`.
- **Demo mode** (only with `demo: true`): a simulated outbox, seeded from your newest orders and customers and dated over the last days, rebuilt with fresh dates twice a day so a public demo never looks abandoned; test sends and new events land there and stay; nothing leaves the server, and password reset links are kept hidden.
- **Your own templates** in the same look, with the same kit, through the `templates` option or `registerEmailTemplate`.
- **Admin in English and Polish** through the Medusa admin translations.

## Requirements

- Medusa 2.12 to 2.21 and Node.js 20+ (see Compatibility).
- A Resend account with a verified sending domain, and an API key with sending access. Without a key the plugin logs every message instead of sending it (the admin says "Log only"); in demo mode it needs nothing. The free plan of Resend sends 100 e-mails a day and 3 000 a month: choose a plan for your volume before you go live.
- Optional, to read delivery: a second Resend key with full access in `deliveryKey`. Resend refuses `GET /emails` and `GET /suppressions` to a sending-only key, so the plugin cannot read with one; the page then says the key cannot read.
- In app mode (`appProvider`) the plugin needs no Resend key to send: your provider sends with its own.

## Installation

```bash
npm install @koda-plus/medusa-plugin-emails
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-emails` or `pnpm add @koda-plus/medusa-plugin-emails`.

## Configuration

The plugin is registered twice with **the same options object**: as a plugin (the send log, the admin page, the subscribers and jobs) and as the provider of the email channel in Medusa's notification module (rendering and sending). Keep the object in one constant. A store that keeps its own provider registers the plugin once, without the provider: see Next to your own e-mail provider.

```ts
import { defineConfig } from "@medusajs/framework/utils"

const emails = {
  apiKey: process.env.RESEND_API_KEY,
  from: process.env.EMAILS_FROM, // "Your Store <orders@mail.example.com>"
  replyTo: "support@example.com",
  defaultLocale: "en", // or "pl"
  timeZone: "Europe/Warsaw",
  storefrontUrl: "https://shop.example.com",
  brand: {
    name: "Your Store",
    accentColor: "#26D07C",
    footer: { en: "Your Store Ltd, 1 Market Street, London", pl: "Your Store sp. z o.o., ul. Rynek 1, Warszawa" },
    supportEmail: "support@example.com",
  },
  demo: process.env.EMAILS_DEMO === "true", // a simulated outbox, nothing leaves the server
}

module.exports = defineConfig({
  // ...
  plugins: [{ resolve: "@koda-plus/medusa-plugin-emails", options: emails }],
  modules: [
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "@koda-plus/medusa-plugin-emails/providers/emails",
            id: "emails",
            options: { channels: ["email"], ...emails },
          },
          {
            // Keep Medusa's own provider on the feed channel: product import and export
            // and the order export send their notifications there, and fail without it.
            resolve: "@medusajs/medusa/notification-local",
            id: "local",
            options: { name: "Local Notification Provider", channels: ["feed"] },
          },
        ],
      },
    },
  ],
})
```

Listing `providers` replaces Medusa's default list, which held the local provider of the `feed` channel; that is why the example adds it back. Without it, product import and export and the order export end with "Could not find a notification provider for channel: feed". The admin warns when no provider serves `feed`.

Set the variables in `.env`:

```bash
RESEND_API_KEY=re_...
EMAILS_FROM="Your Store <orders@mail.example.com>"
# EMAILS_DEMO=true   # only on a demo: a simulated outbox instead of Resend
```

Run the migrations, then open **E-mails** in the admin sidebar:

```bash
npx medusa db:migrate
```

Medusa uses one provider per channel: if another provider serves `email` (SendGrid, or the local one set to `email`), remove it, and keep the local one on `feed`. The admin says when the provider is missing, got other options than the plugin, or runs in another mode. The `id` of the registration (`"emails"` above) is the name Medusa's provider table and this admin show; `koda-emails` is the identifier of the provider class, which you never type.

### Options

Sending:

- `apiKey`: the Resend API key. Without it nothing is sent: every message is rendered, logged and recorded as not sent.
- `from`: `Name <address>` or the bare address, on a domain verified in Resend. Required in live mode.
- `replyTo`: one address or a list. With it, the "Questions?" box tells customers to reply.
- `demo` (default `false`): the simulated outbox. Nothing leaves the server, every message is kept to look at. Only `demo: true` turns it on: a missing API key never does, it means "Log only" (nothing is sent, the admin says what is missing). Set it from a variable of your own, `demo: process.env.EMAILS_DEMO === "true"`.
- `requestsPerSecond` (default `5`, at most 50), `timeoutMs` (default `15000`, 1000 to 120000), `maxRetries` (default `2`, 0 to 5): requests to Resend from one process, the timeout of one request, the extra tries after a temporary error.
- `channels` (provider registration only, no default): the channels the provider serves, given in the provider's options (`{ channels: ["email"], ...emails }`). It must include `"email"`, or Medusa never routes an e-mail to the provider (the server log warns). The plugin registration ignores it.

Your own provider (app mode, see Next to your own e-mail provider):

- `appProvider` (default none): the id of YOUR notification provider on the `email` channel, like `"resend"` (letters, digits, `.`, `_`, `-`). With it the plugin registers no provider and sends none of its built-in templates; the page shows the templates of `templates`, previews them, sends tests through your provider and lists what your provider reports with `recordAppEmail`, together with Medusa's own history of it. Ignored in demo mode. Leave it out to let the plugin send.

Language and links:

- `defaultLocale` (default `"en"`): `"en"` or `"pl"`, when the recipient's language is unknown.
- `timeZone` (default `"UTC"`): for dates in messages.
- `storefrontUrl`: the public address of the storefront. Links default to it: the store, `/account`, `/cart`, `/reset-password?token={token}&email={email}`.
- `links`: `{ store, account, order, cart, passwordReset, adminPasswordReset, negotiation }`, each an absolute address or a path joined to `storefrontUrl`, with the placeholders `{order_id}`, `{display_id}`, `{cart_id}`, `{country}`, `{locale}`, `{token}`, `{email}`, `{id}`, `{ref}` (URI-encoded; an empty one leaves no double slash). For example `order: "/{country}/account/orders/details/{order_id}"`.
- `adminUrl` (default: `admin.backendUrl` and `admin.path` of medusa-config.ts): the admin, for the password reset of admin users.
- `passwordResetMinutes` (default `15`): how long the reset link works, for the text of the message (Medusa's own default).
- `passwordResetsPerHour` (default `3`, from 1 to 50): password reset e-mails to one address in any hour. Asking for a reset needs no account, so this keeps a stranger from flooding an inbox from your domain and using up your Resend plan; further requests are logged as skipped (`THROTTLED`).
- `trackingUrls`: tracking links per fulfillment provider id (or its first part) when a label has none, e.g. `{ inpost: "https://inpost.pl/sledzenie-przesylek?number={number}" }`.

Brand (`brand`), each field also editable in the admin:

- `name`: in subjects and texts.
- `logo`: `{ text, accent, suffix, italic }`, the logo as live text (default: the name).
- `accentColor` (default `#26D07C`), `headerColor` (default `#212721`): buttons and highlights, and the band at the top.
- `footer`: one line, a string or `{ en, pl }`.
- `supportEmail`: shown in the "Questions?" box.
- `headingFont`, `bodyFont`: CSS font-family lists (default: the system sans). `fontFaces`: `[{ family, url }]`, web fonts on https, loaded where the mail app allows them.

Templates:

- `templates`: `false` turns a template off for good (the admin cannot turn it on), `true` turns an optional one on, a definition adds a template or replaces a built-in one under its key.
- `abandonedCart`: `{ afterHours: 24, maxAgeHours: 72, maxPerRun: 50 }`. The links of `links.cart` lead to the cart: with `{cart_id}` in it, the link opens that cart (and the address typed in it) for anyone who holds the e-mail, so prefer a page that asks the shopper to sign in.
- `skipOrderMetadataKeys` (default `["marketplace_order_ref"]`): orders with one of these metadata keys get no e-mail. Orders with Medusa's `no_notification` never do. A shopper cannot set these keys through the Store API (see Security).
- `negotiationAmounts` (default `"major"`): only for negotiation events that send `price` as a number without `price_amount`, in major units (469 for 469.00) or minor (46900). The Koda Plus negotiations plugin sends `price` as a decimal string and `price_amount` in minor units, so it needs nothing here.

Presentation and data:

- `logRetentionDays` (default `365`, `0` keeps everything, at most 3650): how long the send log keeps its rows.

The log and delivery:

- `showAddresses` (default `false`): full recipient addresses in the log of app mode (read from Medusa's notification table) and in the list of rejected addresses in every mode, and the log of app mode finds an address by any part of it (`anna`, `@example.com`). Without it addresses are masked and the log finds one only by the full address. The plugin's own send log never stores an address in full, so outside app mode the log stays masked either way. Turn it on when the people using the admin already see customers' addresses on orders: the log then finds a message the way support looks for it.
- `deliveryKey` (default: the `apiKey` in live mode, none in the other modes): a Resend API key used ONLY to read what happened after sending, with `GET /suppressions` (the rejected addresses) and `GET /emails` (the last event of each message). It needs full access: a sending-only key cannot read, and since the `apiKey` recommended here sends only, set a separate full access key. In app mode set it to read the Resend account your provider sends through. The key never reaches the admin and is never logged. What it shows: the Rejected addresses tile and list in every mode; the delivery badge of each row and the Resend part of the `bounced` filter in app mode.
- `campaigns` (default none): mailings sent through the same Resend account outside the shop, `[{ key, label, tag?: { name, value } }]`. `key` is letters, digits, `.`, `_`, `-` (at most 64), `label` a short name, `tag` the Resend tag the mailing was sent with. Rows of kind `campaign` in the send log (template `campaign:<key>`, written by the store's own code) get the label and a badge and stay out of the sent counters; a rejected address whose blocking message carries the tag names the mailing.
- `templateGroups` (default none): named sets of templates for the log, `[{ key, label, templates, variant?, link?, orderState? }]`. Each group is a pill above the log and `?group=<key>` in the URL; up to 20 template keys per group.
  - `variant`: `{ field, labels }`, the stage of a message read from `field` of its data and shown with its label, like `{ field: "kind", labels: { upcoming: "Before the due date", overdue: "Overdue" } }` (`overdue` is red, the others blue). The stage is read from the data Medusa keeps in its notification table, so it shows on the history rows of app mode.
  - `link`: `{ label, path }`, an admin path (relative, starting with `/`) that acts on the message, like `{ label: "Open the invoice", path: "/invoices?order_id=:order_id" }`; `:order_id` and `:customer_id` are filled from the message, and a path without them is also shown above the log.
  - `orderState`: `async (scope, orderIds) => ({ [orderId]: { label, color, hint? } })`, the state of each order now (`color` is `green`, `red`, `orange`, `grey` or `blue`, `hint` the tooltip), called while the log is shown, for the orders of the group's messages on the page. When it throws, the log shows no state.
- `references` (default none): stores running the plugin, shown as "Running in production": `[{ name, url, description?, metrics?: [{ label, value }], links?: [{ label, url }], soon? }]`, texts plain or `{ en, pl }`. `soon: true` marks a store that starts on Medusa soon: it is shown with a "Soon" badge and no link, and its `url` is optional. Entries without a name, or live entries without an https URL, are dropped.

Missing or broken options never break the boot: broken values fall back to their defaults and the admin lists them. Campaigns and template groups with an invalid key, no label or no valid templates are dropped.

## Next to your own e-mail provider

This is app mode, for a store that already sends its e-mails through its own notification provider on the `email` channel (your own Resend provider with your own templates, for example) and wants to keep it. Medusa routes a channel to exactly one provider, so the plugin does not register a second one and does not send anything itself. It gives your provider the admin page instead: the gallery and live previews of your templates, test sends, the send log with Medusa's whole history, the counters, the order card and, with `deliveryKey`, what happened after sending.

What changes against the default mode:

- **Who sends**: your provider, as before. The plugin registers no provider, needs no `apiKey` and no `from`, and the badge of the page says "Sent by your provider" (red, "Your provider is off", when Medusa does not route the `email` channel to it).
- **Templates**: the plugin's built-in templates are off and hidden, and never sent, not even as a test: your provider cannot render them, and they would only duplicate the e-mails your store already sends. The gallery shows the templates you pass in `templates`, in your order.
- **Tests**: a test send goes through Medusa's notification module to your provider, with the template's sample data.
- **The log**: what your provider reports with `recordAppEmail`, together with Medusa's own history of your provider (see below). A failed e-mail is retried by Medusa or by your own code, not from this page.

1. Register only the plugin, with `appProvider` set to the id of your provider and your templates in `templates`. Keep your provider registered in the notification module as it is:

```ts
plugins: [
  {
    resolve: "@koda-plus/medusa-plugin-emails",
    options: {
      appProvider: "resend", // the id of your provider in the notification module
      templates: myTemplates, // { "order.placed": defineEmailTemplate({ ... }), ... }
      defaultLocale: "pl",
      timeZone: "Europe/Warsaw",
      // deliveryKey: process.env.RESEND_READ_KEY, // a full access key, to read delivery
      // showAddresses: true,
    },
  },
]
```

2. Let your provider report what it sent, after every send and every failure. `recordAppEmail` never throws and never stores an address in the clear:

```ts
import { recordAppEmail } from "@koda-plus/medusa-plugin-emails/app"

await recordAppEmail(pg, { notification, status: "sent", subject, externalId: id })
// on a failure: await recordAppEmail(pg, { notification, status: "failed", subject, error: err.message })
```

`pg` is `ContainerRegistrationKeys.PG_CONNECTION` from the provider's container. A report also takes `errorCode`, `orderId`, `customerId` and `secrets` (strings masked wherever they appear, like your API key). Medusa retrying a failed notification reports the same key again and updates the same row.

3. Optional: set `deliveryKey` to a Resend key with full access to see the delivery state of every message and the addresses Resend no longer sends to; give a template `subjectOf(data, locale)` so its history rows have a subject; name sets of templates with `templateGroups` and mailings outside the shop with `campaigns`.

The log also reads Medusa's own history of your provider (its `notification` table, channel `email`), so it shows every e-mail from the store's first day, before the plugin was installed and even before its migrations ran (until then the page says the plugin log starts after `npx medusa db:migrate`). A notification your provider also reported is listed once, as the plugin's row. History rows are masked like every other row, never show a body, and get a subject only when the template has a `subjectOf(data, locale)` function: it receives the notification's data without attachments, links and anything named like a token or a secret. The history is read only: the plugin never writes Medusa's table.

## Custom templates

A template is a definition with a `render` function. Build it with the kit to get the look, the dark mode, the escaping and the plain-text part for free, then pass it in `templates` (in the shared options object, so the plugin and the provider both get it):

```ts
import { defineEmailTemplate } from "@koda-plus/medusa-plugin-emails/templates"

export const companyApproved = defineEmailTemplate<{ company_name?: string; tier?: string }>({
  label: { en: "B2B company approved", pl: "Firma B2B zatwierdzona" },
  description: { en: "The team approves a company account", pl: "Zespół zatwierdza konto firmy" },
  trigger: { kind: "event", name: "company.approved" },
  sample: { company_name: "Krawczyk Builders Ltd", tier: "B2B Premium" },
  render: ({ data, locale, kit, links }) => ({
    subject: locale === "pl" ? `Ceny ${data.tier} są już aktywne` : `Your ${data.tier} prices are live`,
    eyebrow: locale === "pl" ? "Firma zweryfikowana" : "Company verified",
    title: [locale === "pl" ? "Gotowe. Widzisz już " : "Done. You now see ", kit.accent(data.tier ?? ""), "."],
    band: kit.card({ title: data.company_name ?? "", status: { label: "OK", tone: "accent" } }),
    blocks: [kit.actions({ label: locale === "pl" ? "Zobacz ceny" : "See your prices", href: links.store() })],
  }),
})

// medusa-config.ts: const emails = { ..., templates: { "company.approved": companyApproved } }
```

Then send it from your own code, through the notification module or the bundled workflow:

```ts
import { sendEmailWorkflow } from "@koda-plus/medusa-plugin-emails/workflows"

await sendEmailWorkflow(container).run({
  input: { template: "company.approved", to: customer.email, data: { company_name, tier }, idempotencyKey: `company.approved:${company.id}` },
})
```

- The kit: inline text (`accent`, `strong`, `nowrap`, `mono`, `muted`, `link`, `br`) and blocks: `paragraph`, `section`, `facts`, `items`, `totals`, `steps`, `checks`, `note`, `actions`, `linkFallback`, `tracking`, `priceList`, `divider`, and on the band `tracker`, `card`, `slip`, `tiles`. Strings are escaped; only `trusted(html, text)` passes markup through.
- `render` may also return finished `{ subject, html, text? }`; the text part is then made from the HTML.
- Keep `render` pure: the same data, the same message. A retry must send the same payload.
- `sensitive: ["field"]` marks data fields that carry a secret (a link with a token, as `reset_url` of the built-in password reset). Such a message never goes through Medusa's notification table (the plugin hands it to its provider directly, with the same send log and idempotency), and the simulated outbox keeps it with those fields hidden. A built-in template you replace under its key keeps its secret fields.
- `registerEmailTemplate(key, definition)` registers at run time instead (from a file Medusa loads in every process). Lookup order: the `templates` option, then `registerEmailTemplate`, then the built-in set.
- `renderEmailPreview({ template, data, locale, options })` renders outside Medusa, for your own tests.
- A notification whose `provider_data.emails.kind` is `"test"` ignores the template switches: that is how the admin's test send checks a template that is off. Keep it for tests.
- App code may call `createNotifications({ to, channel: "email", template, data })` directly; pass an `idempotency_key` to make it exactly once. Medusa keeps `data` in its notification table and returns it from `GET /admin/notifications`, so send a template with secret fields through `sendEmailWorkflow` instead.

## Setup in brief

The admin has the full guide (**E-mails**, **Setup guide**), with the state of every step taken from your store.

1. Create a Resend account. Until a domain is verified, Resend sends only from its own test address and only to the address of your account. The free plan sends 100 e-mails a day and 3 000 a month.
2. Add your sending domain in Resend (a subdomain such as `mail.example.com` keeps your main domain's reputation apart) and add the records it shows at your DNS provider: MX and TXT (SPF) on `send`, TXT (DKIM) on `resend._domainkey`. Add DMARC on the main domain.
3. Create an API key with sending access, limited to that domain, and put it in the environment (`apiKey`). To see delivery in the admin (the rejected addresses, and in app mode the state of each message), create a second key with full access for `deliveryKey`: Resend lets only such a key read `GET /emails` and `GET /suppressions`. The plugin uses it for GET requests only.
4. Install the plugin, register it as a plugin and as the email provider with the same options (with Medusa's local provider kept on `feed`), run the migrations.
5. Set the branding and point the links at your storefront, the password reset page included.
6. Send a test of the order confirmation to yourself; look at it on a phone and in dark mode.
7. Choose the templates: turn off what another system sends, turn on the optional ones you want.
8. Place and ship a real order; watch the Failed counter (and, with `deliveryKey`, the Rejected addresses tile) for the first days. Choose a Resend plan that covers your busiest day before it comes.

With your own provider (app mode), steps 1 to 3 are your provider's setup: register only the plugin with `appProvider`, let the provider call `recordAppEmail`, and run the migrations (see Next to your own e-mail provider).

## Security and data

- **The API key** travels only in the `Authorization` header to `api.resend.com`. It is never sent to the admin (which sees "set" or "missing"), and it is masked, with every `re_...` key, `Bearer` value and long token, in logs, stored errors and admin screens.
- **The delivery key** (`deliveryKey`) is used only for `GET` requests to `api.resend.com` (`/emails`, `/emails/{id}`, `/suppressions`), never to send, change or delete anything in Resend; it never reaches the admin. What it reads is kept in the memory of the process for minutes, never in a table. The list of rejected addresses shows them with the part before the `@` masked (`a***@example.com`), unless `showAddresses` is on.
- **Password reset links never sit in a table.** The reset e-mail does not go through Medusa's notification module, whose table keeps the data of every notification and returns it from `GET /admin/notifications` to every admin user and secret API key; the plugin hands it straight to its provider (the same send log, switch and idempotency key). The send log keeps a hash of the token in the key, never the token; the simulated outbox of demo mode keeps the message with the link hidden, and demo mode handles no reset of an admin user. Without the provider registered in the process, a reset is not sent at all.
- **At most `passwordResetsPerHour` (3) reset e-mails per address in an hour**, counted in the send log under a lock per address, so several processes never pass the limit together.
- **Addresses are masked** in logs and in the send log (`a***@e***.com`). Next to the masked address the log keeps a one-way hash of the address (to find the e-mails of one address and to count resets) and the Medusa customer id. It keeps the template, the subject, the status, the Resend id and ids of the order or customer; never the message body (except in demo mode, for the simulated outbox, with secret fields hidden). With `showAddresses: true` the log of app mode shows full addresses, taken from Medusa's notification table where Medusa keeps them anyway, and searches them by part, and the list of rejected addresses shows them in every mode; the send log itself still stores them masked.
- **Escaping by construction**: every value from customers, the catalog and the configuration is escaped in the HTML; links are used only when they are absolute http(s) addresses; colours and fonts from the options are validated before they reach CSS. The admin preview runs in a sandboxed frame without scripts.
- **A stranger's words stay out of the welcome.** Anyone can register with any address, and Medusa does not confirm it: the welcome shows a name only when it reads like one (letters, spaces, apostrophes, hyphens), a company only when it is not a link, an address or a domain, and the subject carries no name at all.
- **Previews and tests never carry a customer's details**: with your newest order they keep the products, amounts and the order number, and replace the name, company, address, the order and cart ids and the tracking numbers with sample ones (a real cart id opens the cart, with the shopper's address, through the Store API).
- **Test sends are limited** (5 per person in 10 minutes, 30 an hour for the store), counted in the send log as well as in memory, so a restart or a second instance does not reset them, and logged with who sent them.
- **The demo outbox shows the sample person**: the store's products, amounts and numbers with the name, address and tracking numbers of the samples, so a demo on a copy of a live database never keeps customers' details.
- **Writes need the admin.** Writes to `/admin/emails/*` (settings, test sends, retries, the demo seed) take a JSON body or the `x-koda-request` header and answer 415 otherwise: Medusa's session cookie is `SameSite=None` in production, so a form on another site could otherwise post with it. The plugin's admin sends both.
- **Shopper metadata is not state.** A shopper may not set the keys of `skipOrderMetadataKeys` on a cart or the account through the Store API (400 `reserved_metadata_key`): Medusa copies cart metadata to the order, and such an order gets no e-mail. The language keys (`locale`, `language`) stay the shopper's own.
- **Reads do not write**: `GET` routes only read; the demo outbox is built by `POST /admin/emails/demo/seed` (the page asks for it) and by the hourly housekeeping job.
- **Errors**: unexpected server errors answer a plain sentence; the details stay in the server log, masked.
- **No retry storms**: only temporary answers are tried again, at most twice, with the same idempotency key; a breaker stops retrying during an outage; quotas, auth and validation errors are final. A message whose fate is unknown is never resent by itself.
- **When the settings cannot be read**, the last settings this process read stay in force; with none, nothing is sent and the message is logged as failed (`SETTINGS_UNAVAILABLE`) for a person to retry. A template switched off in the admin never comes back on by itself.
- **Demo negotiations** (`demo: true` in the event) never e-mail anyone outside demo mode.
- **What Medusa itself keeps**: the notification table of Medusa keeps the address and the data of every notification (names, order lines, links) with no end date; the retention of this plugin covers only its own send log. Messages the plugin skips (a template switched off, no API key, a duplicate) are `success` there, without an external id: the send log of this page tells what really happened.
- The send log deletes its own rows after `logRetentionDays`; nothing in Medusa is changed by this plugin (no cart or order metadata is written).

## What this plugin does not do

- It does not send staff notifications (a new order for the team), newsletters or marketing campaigns; the abandoned cart reminder is the only one, off by default, and it adds no unsubscribe link: check your consent basis before you turn it on.
- It does not attach invoices or other files by itself; attachments passed to the notification module are sent along.
- It does not receive Resend's webhooks. Without `deliveryKey` the log says what Resend accepted, not what reached the inbox; with it the page reads the delivery state from Resend when it is shown (GET requests, cached for minutes), and the board counters of Koda Plus hosts still count only what the send log knows.
- It does not remove an address from Resend's suppression list: the list of rejected addresses links to Resend, where a person removes it.
- It does not manage Resend domains, API keys or audiences.
- It does not send SMS or push messages, only the email channel.
- It does not translate your custom templates: they render what you write, in the languages you write.

## Works with Koda Plus hosts

An app that shows every Koda Plus plugin in one place (like [medusa.koda.plus](https://medusa.koda.plus/app/orders?demo=en)) reads E-mails through the shared contract `koda.integration/1` and never needs to know its tables:

- `GET /admin/emails/integration`: the manifest (mode, configuration, problems such as no API key or a provider that is not registered, the widget).
- `GET /admin/emails/integration/summary?entity=order&id=order_...` (or `ids=`, up to 50; `entity=customer` too): one line per record, the worst message speaking. A message that failed is red; one that may not have gone out, or an address that was refused (customers), is orange; one being sent is blue; sent is green, with the number of messages and the newest one. Messages skipped on purpose (a template switched off, no API key) only speak when there is nothing else, and test sends never count. A customer's line covers the customer's own e-mails and those of orders placed as a guest with the same address (found by the hash of the address). No facts: e-mails are not a payment, a delivery or a document.
- `GET /admin/emails/integration/attention?scope=orders,customers`: counters of the last 7 days, `messages_failed` (red, orders: messages of orders that failed or may not have gone out, linked to `/emails?filter=attention&since=7d`) and `bounced` (orange, customers: addresses refused when a message was sent, linked to `/emails?filter=bounced&since=7d`). The plugin reads no bounce webhooks of Resend, so a message that bounced after Resend accepted it is not counted.
- The order card registers as `emails.order` for the zone `order.details` (tab order 80); a host that claims the zone shows it as a tab (`embedded`) and Medusa's own spot stays empty. Without a host nothing changes.
- The page opens on deep links: `?filter=` (`all`, `sent`, `attention`, `skipped`, `test`, `bounced`), `?since=` (`24h`, `7d`, `30d`), `?order_id=`, `?customer_id=` and `?q=`.

All three routes only read the send log (and, for a customer, the customer's address by id); they never seed the demo outbox, call Resend or write.

## Admin API

Every route needs an admin session or token. Writes take a JSON body or the `x-koda-request` header (415 otherwise).

- `GET /admin/emails`: the status of the page in one read: the mode, the options in use (never a key), the provider and its channels, the templates with their switches and 30 day counts, the counters, the delivery summary (with `deliveryKey`), the campaigns and template groups. Reads the database and the options, never Resend except the cached suppression count.
- `GET /admin/emails/messages`: the send log of the current mode, newest first, with `filter` (`all`, `sent`, `attention`, `skipped`, `test`, `bounced`), `since` (`24h`, `7d`, `30d`), `template` (one key or several separated by commas), `q`, `order_id`, `customer_id`, `limit` (up to 100) and `offset`. In app mode together with Medusa's history, each row with its `source`, `delivery`, `variant` and `orderState`.
- `GET /admin/emails/messages/:id`: one message; the body only in demo mode, with secrets hidden. In app mode also a history row (`noti_...`), without a body.
- `POST /admin/emails/messages/:id/retry`: sends a failed, unknown or skipped message of a built-in event template again, from fresh data.
- `GET /admin/emails/preview?template=&locale=&theme=&source=`: one template rendered as the provider would, on sample data or on the newest order with the person replaced. Changes nothing.
- `POST /admin/emails/test`: `{ template, to, locale?, source? }`, one test send through the same path as every e-mail, rate limited, subject starting with `[Test]`.
- `POST /admin/emails/settings`: `{ brand?, templates? }`, the branding overrides and the template switches, stored with who changed them.
- `POST /admin/emails/demo/seed`: demo mode only, fills or refreshes the simulated outbox (409 outside demo mode).
- `GET /admin/emails/delivery?fresh=1`: the addresses Resend no longer sends to, with the reason, since when, the subject and mailing of the message that caused the block, its Resend link, a typo fix and (app mode) the last message here. `{ configured: false }` without `deliveryKey`; `fresh=1` skips the cache.
- `GET /admin/emails/integration`, `/integration/summary`, `/integration/attention`: the koda.integration/1 contract (see Works with Koda Plus hosts).

## Public API

What other code may import: `@koda-plus/medusa-plugin-emails/app` (app mode: `recordAppEmail`), `@koda-plus/medusa-plugin-emails/templates` (your own templates: `defineEmailTemplate`, `registerEmailTemplate`, the kit, `renderEmailPreview`, the data types), `@koda-plus/medusa-plugin-emails/workflows` (`sendEmailWorkflow`, `sendAbandonedCartsWorkflow`, `sendTemplate`, `emailsIntegration`), `@koda-plus/medusa-plugin-emails/modules/emails` (the module, its options and the same template API), `@koda-plus/medusa-plugin-emails/providers/emails` (the notification provider) and `/admin`. Type declarations ship with the package, so `defineEmailTemplate<{ ... }>(...)` is checked in a strict TypeScript app. Every other path is internal and may change in any release.

## Uninstall

1. Remove both registrations from `medusa-config.ts`: the plugin in `plugins`, and its provider in the notification module. Put back a provider for the `email` channel if the store still sends e-mails, and keep the local provider on `feed` (or remove the whole `@medusajs/medusa/notification` entry to go back to Medusa's defaults).
2. Remove the package from `package.json`.
3. The tables `emails_message` and `emails_setting` stay with their data. Drop them by hand when you no longer need the log, or run `npx medusa db:rollback emails` before removing the package. Medusa keeps its own notification rows and the record of the migrations; the `emails` row of its provider table is disabled by Medusa once the provider is gone.

## Compatibility

Medusa 2.12 to 2.21 (peer range `^2.12.0`) and Node.js 20+. The tests and the build run on Medusa 2.15.3; the release of each version runs the smoke test on a fresh Medusa 2.12.6 and 2.21.2 app (migrations, build, start and the admin pages). Admin translations need Medusa 2.12 or newer. Developing the plugin needs Node.js 22.6+ (the tests run the TypeScript sources directly).

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers every built-in template in both languages (with full and with almost no data, escaping, the clipping size, dark mode, the text part), the delivery path of the provider (dev mode, demo mode, the exact Resend request, idempotency, switches, finished content, failures, a person's retry, a missing table), the Resend client (error mapping, retries with the same key, retry-after, the breaker, pacing), options, links, locales and formats, masking, keys, the registry and app templates, settings, the SQL of the send log, the mappers from Medusa records, and the flows with a fake Medusa container. Tests need Node.js 22.6 or newer (they run the TypeScript sources directly). What the plugin relies on from the Resend and Medusa documentation is in [docs/resend-api-notes.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-emails/docs/resend-api-notes.md). To try the plugin in a Medusa app, run `npx medusa plugin:publish` here, then `npx medusa plugin:add @koda-plus/medusa-plugin-emails` in the app.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. The templates grew out of the e-mails of our Medusa demo store and the stores we build. Need your own templates, another provider or a Medusa store? Write to kontakt@koda.plus.

## Trademarks

Resend is a trademark of its owner, used here only to identify the e-mail service this plugin sends through. This is an independent integration built on the public Resend API, not affiliated with or endorsed by Resend.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-emails/LICENSE).

## Changelog

Every release is in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-emails/CHANGELOG.md).

- 0.3.0 (unreleased): app mode next to your own provider (`appProvider`, `recordAppEmail`, Medusa's notification history in the log), delivery read from Resend (`deliveryKey`: rejected addresses, delivery badges, the `bounced` filter), `showAddresses`, `campaigns`, `templateGroups` (stage, link, order state), an Order column and Resend links in the log, the template previews in Settings and tiles that open the log. No migration.
- 0.2.0 (2026-10-07): password reset links out of every table, resets limited per address, the contract for Koda Plus hosts (summaries of orders and customers, board counters, the order card as a tab) and type declarations; it needs `npx medusa db:migrate`.
