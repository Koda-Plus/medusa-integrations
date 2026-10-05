# OLX Partner API: what this plugin relies on

Verified on 5 October 2026 against the official sources:

- the Partner API reference, https://developer.olx.pl/api/doc (rendered from the OpenAPI file https://developer.olx.pl/swagger/v2/partner_api.yaml, read in full, including its referenced files),
- the developer portal articles "Dostęp do API" (https://developer.olx.pl/artykuly/dostep-do-api) and "Częste pytania" (https://developer.olx.pl/artykuly/czeste-pytania),
- the OLX API terms, "Regulamin OLX API" (https://pomoc.olx.pl/olxplhelp/s/article/Regulamin-OLX-API).

Everything the plugin sends or reads is listed here. What the documentation does not say is listed at the end, together with what the plugin does about it.

## Access to the API

- Registration (Dostęp do API): log in to the developer portal with the OLX account, click "Dodaj aplikację" and fill in the form. OLX verifies every application; meanwhile the portal shows "Oczekuje na akceptację". The result comes by e-mail, and after a positive verification the application has a Client ID and a Client Secret.
- Terms (Regulamin OLX API): the developer runs a business (an adult person or a company, using OLX for business). OLX decides about every API key and may refuse it. Forbidden among others: presenting OLX adverts on competing services, presenting account statistics without OLX's permission, scraping, overloading the service. Technical support: developer-support@olx.com, working days 9:00 to 17:00. Complaints: olx-api-support@olx.pl.
- Callback URL (Częste pytania, point 5): "Twoje aplikacje", "Edytuj Aplikację", field "Adres powrotu". Several addresses may be given, separated by a space.
- One country per application (point 8): credentials manage adverts of one country only.
- No test environment (point 9): use another OLX account for tests.
- Categories open to API adverts on OLX.pl (point 10): 4 Praca, 5 Motoryzacja, 87 Moda, 88 Dla Dzieci, 99 Elektronika, 103 Zwierzęta, 628 Dom i Ogród, 751 Muzyka i Edukacja, 757 Rolnictwo, 767 Sport i Hobby, 4371 Usługi. Others (for example real estate) may be closed.
- Rate limit (point 11): at most 4 500 requests from one IP in 5 minutes. Exceeding it blocks the IP automatically for 30 minutes; the blocked requests get a 403 with a Request ID. The plugin limits itself to 200 per minute by default (`requestsPerMinute`), recognises the 403 of the block and pauses every job of the process for 30 minutes.

## OAuth 2.0

From the "Authentication" chapter of the API reference.

- Consent: `https://www.olx.pl/oauth/authorize/?client_id=…&response_type=code&state=…&scope=…&redirect_uri=…`. `state` is optional in the protocol, and the documentation asks not to omit it; the plugin always sends a one-time nonce and compares it literally.
- Token: `POST https://www.olx.pl/api/open/oauth/token`, JSON body.
  - `grant_type: authorization_code` with `client_id`, `client_secret`, `code`, `scope`, `redirect_uri` (mandatory when it was in the consent URL). The authorization code is valid for 10 minutes ("Authorization errors", point 2).
  - `grant_type: refresh_token` with `client_id`, `client_secret`, `refresh_token`.
  - `grant_type: client_credentials` exists for configuration data only (categories, cities) and is not used: actions on an account need the user context ("Invalid owner in token" otherwise).
- Answer: `access_token`, `expires_in` (86400 in the example), `token_type: bearer`, `scope`, `refresh_token`.
- Lifetimes: the refresh token is valid one month (2592000 seconds); a new refresh token is issued once a day (within the same day the latest one comes back); a refresh token unused for a month is invalidated and the user has to authorize again (`invalid_grant`, "Invalid refresh token").
- Scopes: `v2`, `read`, `write`; default "v2 read write". An application has a closed list of allowed scopes: `invalid_scope` (400) for a scope the client may not ask for, `insufficient_scope` (401) for a token without the needed one. The plugin asks for `read v2`, and for `read write v2` only when a writer is allowed in the options; arming a writer in live mode requires a granted scope containing `write`.
- Every request: `Authorization: Bearer <token>`.

## Common rules of the Partner API

- Base URL: `https://www.olx.pl/api/partner` (the other markets use their own host, same paths).
- Header `Version: 2.0` is required ("Missing required 'Version' header!").
- `Content-Type: application/json` only on POST and PUT; on a GET it causes 400 (Częste pytania, point 2).
- Errors: standard HTTP codes (400, 401, 403, 404, 406, 415, 429, 500), body `{ "error": { "status", "title", "detail", "validation": [{ "field", "title", "detail" }] } }`, sometimes wrapped in `data`.

## Endpoints the plugin uses

Reads (scope `v2 read`):

- `GET /adverts?offset&limit&external_id&category_ids`: the adverts of the account, `{ data: [...] }`. Fields read: `id`, `status`, `url`, `title`, `description`, `category_id`, `external_id` ("Advert's ID in origin system"), `price { value, currency, negotiable, trade, budget }`, `created_at`, `valid_to`. The `external_id` filter is the lookup before every create. Page size 50 (used in production since 0.1.0; the reference names no maximum).
- `GET /adverts/{advertId}`: one advert with every field (`{ data: {...} }`), read before every write and after it.
- `GET /adverts/{advertId}/statistics`: `advert_views`, `phone_views`, `users_observing` (the reference shows them at the top level; the parser also accepts `data`).
- `GET /threads?advert_id&interlocutor_id&offset&limit`: threads with `uuid` (the preferred identifier; numeric `id` is deprecated), `advert_id`, `interlocutor_id`, `total_count`, `unread_count`, `created_at`, `is_favourite`. The plugin keeps the key, the advert, both counts, the date and the flag, never `interlocutor_id`.
- `GET /categories/{categoryId}`: `id`, `name`, `parent_id`, `photos_limit`, `is_leaf`. A category that is not a leaf is refused ("Fix the category").
- `GET /categories/{categoryId}/attributes`: definitions with `code`, `label`, `unit`, `validation { type (attribute, price, salary; package for delivery), required, numeric, min, max, allow_multiple_values }` and `values [{ code, label }]`. Attributes of type price and salary are sent in the `price` and `salary` objects, not in `attributes`.

Writes (scope `v2 write`), each one only from the writer armed for the call:

- `POST /adverts/{advertId}/commands`, body `{ "command": "activate" | "deactivate" | "finish", "is_success": boolean }`, answer 204. `is_success` ("If transaction was successful") is required for `deactivate`. `deactivate` works on an active advert only ("Ad has to be active") and leaves it `removed_by_user`, which can be activated again. `finish` moves an inactive (limited) advert to the finished section. `extend` exists (not in UA and PT) and is never sent.
- `PUT /adverts/{advertId}`: "All parameters and validation rules are the same as in Create advert section." Required: `title`, `description`, `category_id`, `advertiser_type`, `contact` (with `name`), `location` (with `city_id`), `attributes`. Omitting `auto_extend_enabled` keeps it unchanged. Answer: the advert in `data`. The plugin rebuilds the body from `GET /adverts/{advertId}` field by field (only documented fields, empty ones left out, because an extra field makes OLX refuse the body) and changes only `price.value`.
- `POST /adverts`: body `title`, `description`, `category_id`, `advertiser_type`, `external_id`, `contact { name, phone }`, `location { city_id, district_id, latitude, longitude }`, `images [{ url }]`, `price { value, currency, negotiable }`, `attributes [{ code, value | values }]`. Validation rules: title 16 to 150 characters, description 80 to 9 000, at most 50 % capital letters, none of `! ? . , - = + # % & @ * _ > < : ( ) |` three times in a row, no e-mail addresses, web addresses or phone numbers. A new advert is `new` (moderation, "usually it takes some seconds") or `limited` (a packet must be bought, then `activate`). `external_url` is for the Jobs category only and needs OLX's consent; `product_safety_regulation` is required in some categories in PL and RO.

Statuses (Create advert, "Advert statuses"): `new`, `active`, `limited`, `removed_by_user`, `outdated`, `unconfirmed`, `unpaid`, `moderated`, `blocked`, `disabled`, `removed_by_moderator`.

Documented but deliberately NOT used: `DELETE /adverts/{advertId}` (throttling cost 5), `extend`, packets, paid features, logos, `POST /threads/{id}/messages`, `POST /threads/{id}/commands`, `PUT /users-business/me`. The write barrier in `src/modules/olx/lib/security.ts` refuses all of them.

## Web addresses (not part of the API)

- The chat inbox of a seller is `https://<market host>/myaccount/answers/`: the "Czat" link in the header of olx.pl and olx.ro (checked on 5 October 2026). The API reference documents no web address of a single thread, so the admin links the inbox and the advert.

## Not documented, and what the plugin does

- The status an advert gets after `finish`: the plugin reads the advert after every command and stores what OLX says. The demo simulates `outdated`.
- Whether an edited advert goes back to moderation: the plugin reads the advert after the update and stores its status; a moderated advert is never touched by the writers.
- Whether bringing an advert back uses a package slot: the documentation says an advert over the limit becomes `limited` and needs a packet. The plugin never buys packets or paid features; an advert that comes back `limited` shows up in the alerts.
- Case sensitivity of the `external_id` filter: the plugin compares the found adverts with the SKU itself, ignoring case, before adopting one.
- `Retry-After` on 429: not documented; the plugin honours it when present (at most two minutes) and waits 60 seconds otherwise, for reads only. A 429 on a write stops the run without counting an attempt.
- Page size limit of `GET /threads`: not documented; the plugin moves by the number of threads received and stops on an empty page.
