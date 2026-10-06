# E-mails by Koda Plus

Transactional e-mails for Medusa, sent through Resend, ready the moment you install them: the order confirmation, the shipping e-mail with tracking numbers, the cancellation, the welcome and the password reset, in English and Polish, in your store's look and with a dark mode. Every message is sent once per event, logged with the address masked, and visible in the Medusa admin, where you preview every template live and send yourself a test.

The templates carry no images: the store name is live text and products are tiles with their name, SKU, quantity and price, so nothing breaks when a mail app blocks images. Your own templates (a B2B approval, an invoice, a campaign) plug into the same registry and the same look.

![E-mails page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-emails/docs/admin-emails.png)

**Live demo:** Medusa admin [medusa.koda.plus/app/emails](https://medusa.koda.plus/app/emails?demo=en), signed in to a public demo account by the link itself. The demo runs the plugin in demo mode: every e-mail the store would send lands in a simulated outbox you can open, and nothing leaves the server.

## What it does

- **Sends the store's e-mails through Resend**, as a Medusa notification provider: subscribers to Medusa's events render the right template in the customer's language and hand it to the notification module, the provider sends it.
- **Exactly once per event**: one idempotency key per event (`emails:order.placed:<order id>`), checked by Medusa's notification module, claimed atomically in the plugin's send log, and sent to Resend as the `Idempotency-Key` header.
- **Logs what went out** with the recipient masked (`a***@e***.com`): the template, the subject, the status, the Resend id, the error when there was one.
- **Shows it in the admin**: counters, the log, counts per template, the template gallery with a live preview (light and dark, desktop and phone, Polish and English, sample data or your newest order), a test send, and the e-mails of each order on the order page.

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

- **E-mails page in the admin** with three views switched in the header: **Panel** (what was sent, the template gallery, the test send), **Setup guide** (also as `?view=guide`) and **Settings** (branding, templates, the provider).
- **Live preview** of every template, built-in or yours, exactly as the provider renders it, with your branding: light or dark, desktop or phone, Polish or English, on sample data or on your newest order, cart or customer (with the customer's name, company and address replaced by sample ones).
- **Test send** to an address you type, through the same path as every e-mail, so it also proves the setup. The subject starts with `[Test]`; at most 5 tests per person in 10 minutes and 30 an hour for the store.
- **Branding** from the options or from the admin: the store name, a live-text logo (with an accent part such as a "+" and a lighter suffix), the accent and band colours, a footer line per language, a support address. Colours derive the rest: text in the accent colour is darkened or lightened until it reads at 4.5:1, the neutrals take the hue of the band, a band too light for white text is darkened.
- **Every template switchable**: the option is the hard switch (`templates: { key: false }`), the admin switch the runtime one, with who flipped it and when.
- **Per-recipient language**: the order's or cart's `locale`, then `locale` or `language` in the order's, cart's or customer's metadata, then `defaultLocale`.
- **Dark mode** for Apple Mail and most apps, Outlook.com included; Polish typography with no one-letter word at the end of a line.
- **Under Gmail's clipping size** and a plain-text part in every message; long orders show 30 lines and a sum-up line.
- **Retry from the admin** for failed messages of the order, shipping, cancellation, welcome and cart templates: the data is read again, the provider takes the failed row over, Resend gets a fresh key.
- **Order widget** on every order page: the e-mails of that order with their status.
- **Demo mode**: a simulated outbox, seeded from your newest orders and customers and dated over the last days, rebuilt with fresh dates twice a day so a public demo never looks abandoned; test sends and new events land there and stay; nothing leaves the server.
- **Your own templates** in the same look, with the same kit, through the `templates` option or `registerEmailTemplate`.
- **Admin in English and Polish** through the Medusa admin translations.

## Requirements

- Medusa 2.12 or newer (tested on 2.15.3) and Node.js 20+.
- A Resend account with a verified sending domain, and an API key with sending access. Without a key the plugin logs every message instead of sending it; in demo mode it needs nothing.

## Installation

```bash
npm install @koda-plus/medusa-plugin-emails
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-emails` or `pnpm add @koda-plus/medusa-plugin-emails`.

## Configuration

The plugin is registered twice with **the same options object**: as a plugin (the send log, the admin page, the subscribers and jobs) and as the provider of the email channel in Medusa's notification module (rendering and sending). Keep the object in one constant:

```ts
import { defineConfig } from "@medusajs/framework/utils"

const emails = {
  apiKey: process.env.RESEND_API_KEY,
  from: process.env.EMAILS_FROM, // "Your Store <orders@mail.your-store.com>"
  replyTo: "support@your-store.com",
  defaultLocale: "en", // or "pl"
  timeZone: "Europe/Warsaw",
  storefrontUrl: "https://your-store.com",
  brand: {
    name: "Your Store",
    accentColor: "#26D07C",
    footer: { en: "Your Store Ltd, 1 Market Street, London", pl: "Your Store sp. z o.o., ul. Rynek 1, Warszawa" },
    supportEmail: "support@your-store.com",
  },
  // demo: true, // a simulated outbox, nothing leaves the server
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
        ],
      },
    },
  ],
})
```

Set the variables in `.env`:

```bash
RESEND_API_KEY=re_...
EMAILS_FROM="Your Store <orders@mail.your-store.com>"
```

Run the migrations, then open **E-mails** in the admin sidebar:

```bash
npx medusa db:migrate
```

Medusa uses one provider per channel: if another provider serves `email` (SendGrid, the local one), remove it. The admin says when the provider is missing, or got other options than the plugin.

### Options

Sending:

- `apiKey`: the Resend API key. Without it nothing is sent: every message is rendered, logged and recorded as not sent.
- `from`: `Name <address>` or the bare address, on a domain verified in Resend. Required in live mode.
- `replyTo`: one address or a list. With it, the "Questions?" box tells customers to reply.
- `demo` (default `false`): the simulated outbox. Nothing leaves the server, every message is kept to look at.
- `requestsPerSecond` (default `5`), `timeoutMs` (default `15000`), `maxRetries` (default `2`): requests to Resend from one process, the timeout of one request, the extra tries after a temporary error.

Language and links:

- `defaultLocale` (default `"en"`): `"en"` or `"pl"`, when the recipient's language is unknown.
- `timeZone` (default `"UTC"`): for dates in messages.
- `storefrontUrl`: the public address of the storefront. Links default to it: the store, `/account`, `/cart`, `/reset-password?token={token}&email={email}`.
- `links`: `{ store, account, order, cart, passwordReset, adminPasswordReset, negotiation }`, each an absolute address or a path joined to `storefrontUrl`, with the placeholders `{order_id}`, `{display_id}`, `{cart_id}`, `{country}`, `{locale}`, `{token}`, `{email}`, `{id}`, `{ref}` (URI-encoded; an empty one leaves no double slash). For example `order: "/{country}/account/orders/details/{order_id}"`.
- `adminUrl` (default: `admin.backendUrl` and `admin.path` of medusa-config.ts): the admin, for the password reset of admin users.
- `passwordResetMinutes` (default `15`): how long the reset link works, for the text of the message (Medusa's own default).
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
- `abandonedCart`: `{ afterHours: 24, maxAgeHours: 72, maxPerRun: 50 }`.
- `skipOrderMetadataKeys` (default `["marketplace_order_ref"]`): orders with one of these metadata keys get no e-mail. Orders with Medusa's `no_notification` never do.
- `negotiationAmounts` (default `"major"`): only for negotiation events that send `price` as a number without `price_amount`, in major units (469 for 469.00) or minor (46900). The Koda Plus negotiations plugin sends `price` as a decimal string and `price_amount` in minor units, so it needs nothing here.

Presentation and data:

- `logRetentionDays` (default `365`, `0` keeps everything): how long the send log keeps its rows.
- `references` (default none): stores running the plugin, shown as "Running in production": `[{ name, url, description?, metrics?: [{ label, value }], links?: [{ label, url }], soon? }]`, texts plain or `{ en, pl }`. `soon: true` marks a store that starts on Medusa soon: it is shown with a "Soon" badge and no link, and its `url` is optional. Entries without a name, or live entries without an https URL, are dropped.

Missing or broken options never break the boot: broken values fall back to their defaults and the admin lists them.

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
- `registerEmailTemplate(key, definition)` registers at run time instead (from a file Medusa loads in every process). Lookup order: the `templates` option, then `registerEmailTemplate`, then the built-in set.
- `renderEmailPreview({ template, data, locale, options })` renders outside Medusa, for your own tests.
- App code may call `createNotifications({ to, channel: "email", template, data })` directly; pass an `idempotency_key` to make it exactly once.

## Setup in brief

The admin has the full guide (**E-mails**, **Setup guide**), with the state of every step taken from your store.

1. Create a Resend account. Until a domain is verified, Resend delivers only to your own address from `onboarding@resend.dev`.
2. Add your sending domain in Resend (a subdomain such as `mail.your-store.com` keeps your main domain's reputation apart) and add the records it shows at your DNS provider: MX and TXT (SPF) on `send`, TXT (DKIM) on `resend._domainkey`. Add DMARC on the main domain.
3. Create an API key with sending access, limited to that domain, and put it in the environment.
4. Install the plugin, register it as a plugin and as the email provider with the same options, run the migrations.
5. Set the branding and point the links at your storefront, the password reset page included.
6. Send a test of the order confirmation to yourself; look at it on a phone and in dark mode.
7. Choose the templates: turn off what another system sends, turn on the optional ones you want.
8. Place and ship a real order; watch the Failed counter for the first days.

## Security and data

- **The API key** travels only in the `Authorization` header to `api.resend.com`. It is never sent to the admin (which sees "set" or "missing"), and it is masked, with every `re_...` key, `Bearer` value and long token, in logs, stored errors and admin screens.
- **Addresses are masked** in logs and in the send log (`a***@e***.com`). The send log keeps the template, the subject, the status, the Resend id and ids of the order or customer; never the message body (except in demo mode, for the simulated outbox), never a password reset token.
- **Escaping by construction**: every value from customers, the catalog and the configuration is escaped in the HTML; links are used only when they are absolute http(s) addresses; colours and fonts from the options are validated before they reach CSS. The admin preview runs in a sandboxed frame without scripts.
- **Previews and tests never carry a customer's details**: with your newest order they keep the products and amounts and replace the name, company and address with sample ones.
- **Test sends are limited** (5 per person in 10 minutes, 30 an hour for the store) and logged with who sent them.
- **No retry storms**: only temporary answers are tried again, at most twice, with the same idempotency key; a breaker stops retrying during an outage; quotas, auth and validation errors are final. A message whose fate is unknown is never resent by itself.
- **Password reset tokens** never reach a log or a key: the key carries a hash of the token. The link itself lives in Medusa's own notification row, as in Medusa's documented example.
- **Demo negotiations** (`demo: true` in the event) never e-mail anyone outside demo mode.
- The send log deletes its own rows after `logRetentionDays`; nothing in Medusa is changed by this plugin (no cart or order metadata is written).

## What this plugin does not do

- It does not send staff notifications (a new order for the team), newsletters or marketing campaigns; the abandoned cart reminder is the only one, off by default, and it adds no unsubscribe link: check your consent basis before you turn it on.
- It does not attach invoices or other files by itself; attachments passed to the notification module are sent along.
- It does not read Resend's delivery, open or bounce events (webhooks): the log says what Resend accepted, not what reached the inbox.
- It does not manage Resend domains, API keys or audiences.
- It does not send SMS or push messages, only the email channel.
- It does not translate your custom templates: they render what you write, in the languages you write.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers every built-in template in both languages (with full and with almost no data, escaping, the clipping size, dark mode, the text part), the delivery path of the provider (dev mode, demo mode, the exact Resend request, idempotency, switches, finished content, failures, a person's retry, a missing table), the Resend client (error mapping, retries with the same key, retry-after, the breaker, pacing), options, links, locales and formats, masking, keys, the registry and app templates, settings, the SQL of the send log, the mappers from Medusa records, and the flows with a fake Medusa container. What the plugin relies on from the Resend and Medusa documentation is in [docs/resend-api-notes.md](./docs/resend-api-notes.md). To try the plugin in a Medusa app, run `npx medusa plugin:publish` here, then `npx medusa plugin:add @koda-plus/medusa-plugin-emails` in the app.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. The templates grew out of the e-mails of our Medusa demo store and the stores we build. Need your own templates, another provider or a Medusa store? Write to kontakt@koda.plus.

## Trademarks

Resend is a trademark of its owner, used here only to identify the e-mail service this plugin sends through. This is an independent integration built on the public Resend API, not affiliated with or endorsed by Resend.

## License

MIT, see [LICENSE](./LICENSE).

## Changelog

### 0.1.0 (2026-10-06)

First public release, generalized from the e-mails of the Koda Plus demo store: a Resend notification provider with exactly-once delivery and a send log, nine templates in English and Polish (order confirmation, shipping with tracking, cancellation, welcome, password reset, abandoned cart, three negotiation e-mails), branding from the options and the admin, custom templates with the same kit, the admin page with the live gallery, test sends, the log and the setup guide, the order widget and demo mode.
