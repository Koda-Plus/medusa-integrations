# InPost ShipX API: what this plugin relies on

Verified in October 2026 against InPost's public developer documentation (the ShipX API documentation on dokumentacja-inpost.atlassian.net and the Geowidget v5 documentation on geowidget.inpost.pl/docs) and, for the points list, against the public points endpoint itself. ShipX was never called with credentials while the plugin was built: the tests run against a scripted ShipX.

Everything the plugin sends or reads is listed here. What the documentation does not settle is listed at the end, together with what the plugin does about it.

## Hosts and access

- Production: `https://api-shipx-pl.easypack24.net`. Sandbox: `https://sandbox-api-shipx-pl.easypack24.net`. The older `api.inpost.pl` hosts are not ShipX; the plugin never uses them.
- The token: InPost Manager (`https://manager.paczkomaty.pl`, sandbox `https://sandbox-manager.paczkomaty.pl`), My account, API. InPost generates API access only for accounts with complete company and invoice data. The ShipX token is a JWT; the organization id is shown next to it. The Geowidget token on the same page is a public token for the map, and ShipX answers it with 401.
- Every request: `Authorization: Bearer <token>`, JSON in and out (labels are PDF).
- `GET /v1/organizations/:id`: the organization, used by "Check the connection". A token of another organization gets 403.

## Creating a shipment

`POST /v1/organizations/:organization_id/shipments`, in the simplified mode where `service` is in the request:

- `service`: `inpost_locker_standard` (Paczkomat) or `inpost_courier_standard` (courier).
- `receiver`: `company_name` and/or `first_name` and `last_name`, `email`, `phone` (nine digits for Poland), and for couriers `address` with `street`, `building_number`, `flat_number`, `city`, `post_code` (`00-000`) and `country_code`. A Paczkomat shipment needs the e-mail and the phone (the receiver gets the pickup code).
- `sender`: optional; without it InPost uses the organization's data, which InPost recommends. The plugin sends a sender only with an e-mail and a phone.
- `parcels`: a Paczkomat shipment carries one parcel, by `template` (`small` A 8 x 38 x 64 cm, `medium` B 19 x 38 x 64 cm, `large` C 41 x 38 x 64 cm, up to 25 kg). A courier parcel carries `dimensions` (mm) and `weight` (kg); the plugin uses the template's dimensions and the order's weight, up to 30 kg.
- `custom_attributes`: `target_point` (the locker code, Paczkomat only), `sending_method` and, with `parcel_locker`, `dropoff_point`.
- `cod`: `{ amount, currency: "PLN" }`. `insurance`: `{ amount, currency }`, at least the cash on delivery amount, and required for a courier with cash on delivery. The plugin sends both equal to the order's gross total.
- `reference`: 3 to 100 characters.

The answer is the shipment with its `id` and `status` (`created`); the `tracking_number` may come later. With a prepaid account InPost does not buy the shipment: the status becomes `offers_prepared` and the shipment lists `offers` (each with an `id`, its `service`, `rate`, `currency`, `status` such as `available` or `selected`, and `unavailability_reasons`). `POST /v1/shipments/:id/buy` with `{ offer_id }` buys one; the shipment then moves on to `confirmed`.

## Reading shipments

- `GET /v1/shipments/:id`: one shipment, its `status`, `tracking_number`, `offers`, `created_at`.
- `GET /v1/organizations/:id/shipments`: the organization's shipments, with search parameters; answers `{ items: [...] }`. The plugin uses it only to look up a create that got no clear answer (see the end).
- `GET /v1/statuses`: the public dictionary of statuses with their titles and descriptions. The plugin carries English and Polish names of all 53 of them and treats a status it does not know as "in transit".
- Public tracking: `https://inpost.pl/sledzenie-przesylek?number=<tracking number>`. Sandbox shipments have no public tracking.

## Labels

`GET /v1/shipments/:id/label?format=pdf&type=normal|A6`. A label exists once the shipment is paid (`confirmed` and later). `normal` is A4; courier labels exist only as A6. The plugin checks that the answer is a PDF and streams it to the admin.

## Cancel

`DELETE /v1/shipments/:id` answers 204. It is allowed only in `created`, `offers_prepared` and `offer_selected`; later ShipX answers `invalid_action`. A paid shipment is canceled in InPost Manager (lockers) or WebTrucker (`https://kurier.inpost.pl`, couriers).

## Courier pickups

`POST /v1/organizations/:id/dispatch_orders` with `shipments` (ids of confirmed shipments), `name`, `phone`, `email`, `comment` and the pickup `address` (`street`, `building_number`, `flat_number`, `city`, `post_code`, `country_code`). Used for shipments with the `dispatch_order` sending method; one dispatch order covers many shipments.

## Sending methods

`GET /v1/sending_methods` (public) lists them; the plugin accepts `parcel_locker`, `pok`, `pop`, `courier_pok`, `branch`, `dispatch_order` and `any_point`, and sends none when the option is empty, so the account's own default applies.

## Webhooks

- The URL is set in InPost Manager (My account, API). InPost checks it with a GET that must answer 200 before saving it, and wants the path in lower case.
- Events: `shipment_confirmed` (`shipment_id`, `tracking_number`), `shipment_status_changed` (`shipment_id`, `status`, `tracking_number`) and `offers_prepared` (`shipment_id`, `offers`), inside `{ event, event_ts, organization_id, payload }`.
- Deliveries are not signed. They come from `91.216.25.0/24`, for production and the sandbox.

## Points (public, no token)

`GET /v1/points` on the ShipX host of the environment. Parameters the plugin uses: `name` (an exact locker code), `relative_post_code` and `relative_point` (`lat,lng`, nearest first), `city`, `type` (`parcel_locker`), `functions` (`parcel_collect`), `payment_available`, `per_page` and `fields` (only the fields below). Each point has `name` (the code), `display_name`, `type`, `status`, `location` (`latitude`, `longitude`), `location_description`, `opening_hours`, `location_247`, `payment_available`, `address` (`line1`, `line2`), `address_details` (`city`, `province`, `post_code`, `street`, `building_number`, `flat_number`) and, for a relative search, `distance` in metres.

Seen while building the plugin, by reading the public endpoint: the `status` filter is ignored, `city` matches only the city as written (so the plugin capitalizes it), and every locker code among 5 000 points read matches the plugin's code pattern (two to six letters, an optional second group after a hyphen, one to five digits, up to five letters).

## Geowidget v5

- Production: `https://geowidget.inpost.pl/inpost-geowidget.js` and `inpost-geowidget.css`. Sandbox: `https://sandbox-easy-geowidget-sdk.easypack24.net` with a sandbox token.
- The element `<inpost-geowidget>` with `token`, `language` and `config` (`parcelCollect`, `parcelCollectPayment` for points that take card payments, `parcelCollect247`, `parcelSend`); the chosen point comes to the `onpoint` callback (or the `onpointselect` event): `point.name` is the locker code, `point.address.line1` and `line2`, `point.address_details.city` and `post_code`.
- The Geowidget token is generated in InPost Manager for the storefront's domain.

## What the documentation does not settle, and what the plugin does

- **Whether a create that timed out exists.** The create is not idempotent and no idempotency key is documented. The plugin never repeats a create blindly: an unclear answer (a timeout, a dropped connection, a 5xx) leaves the row `unknown`, and the next status pass lists the organization's shipments created since the attempt by the receiver (`receiver_email`, else `receiver_phone`, with `created_at_gteq`) and compares the reference itself. One match is adopted, several are left for a person to link, none a quarter of an hour later lets a person try again. The search parameter names follow the ShipX shipment search; if a deployment of ShipX ignored them, the reference comparison still keeps the adoption exact.
- **Rate limits.** No public ShipX limit is documented. The plugin limits itself to `requestsPerMinute` (60 by default), retries reads only, after network errors, 5xx and 429 (honouring `Retry-After` up to 30 seconds), and sends every write once.
- **Webhook retries** are not documented. The status pass reads every open shipment at least every 25 minutes, so a lost delivery only delays a status.
- **The sandbox** reaches `confirmed` for courier shipments, but they never show in WebTrucker, and public tracking does not work there. The plugin's sandbox mode only changes the hosts.
- **Labels in A4 for couriers** do not exist: the plugin asks for A6 whatever the setting.
