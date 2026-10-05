# Bridge contract

`openapi.yaml` is the complete HTTP contract between the Medusa plugin and a bridge running next to Subiekt nexo PRO. The plugin and the Koda Plus bridge are both tested against the files in this folder. Current version: **1.1.0**.

## Files

- `openapi.yaml`: endpoints, schemas, error codes, the signing scheme, the capability names.
- `examples/order-create.request.json`: exactly what the plugin sends for the example order (a unit test builds it from a Medusa order and compares).
- `examples/order-create-b2b.request.json`: a company order with the `buyer` block (1.1).
- `examples/order-create.response.json`, `error.unmatched-lines.json`, `health.json`, `stock.response.json`, `products.response.json`, `events.response.json`, `document-create.response.json`: answers a bridge gives.
- `examples/document-create.request.json`: a sales document request (1.1).
- `examples/signature-vectors.json`: secret, timestamp, method, path, body and the expected `X-Koda-Signature` header. Any implementation must reproduce every vector.

## What 1.1 adds

All of it is additive. A 1.0 bridge keeps working with a 1.1 plugin, and a 1.1 bridge with a 1.0 plugin.

- `capabilities` in `GET /v1/health`. The plugin uses only what a bridge lists and hides the rest in the admin, with the reason. A bridge without the field is read as `orders`, `fulfillments`, `stock`, `events`.
- `GET /v1/products`: products with EAN, unit, VAT, the `active` flag (Sklep internetowy), weight, and net and gross prices in the price levels the bridge publishes. Paged from one snapshot.
- `Order.buyer`: the company buying (NIP with a valid checksum, name, address, e-mail, phone, `create_if_missing`). The ZK goes to the contractor with that NIP; a missing one is created only when the bridge allows it and the order asks for it.
- `POST /v1/orders/{orderId}/documents` with `{ "kind": "fs" | "pa" }`: the faktura sprzedaży or the paragon, from the WZ when the order has one, from the ZK otherwise. One sales document per order.
- `Document.ksef_number` and the event type `document.updated`, published when KSeF assigns the number later.
- Health: nexo SDK and database versions, Sfera licence state, the last event, queue sizes. With `time` (already in 1.0) a reader shows the clock skew that breaks signatures.

## Rules for changes

- `1.x` only adds optional fields, endpoints and event types. Readers ignore unknown fields and unknown event types.
- A breaking change becomes `/v2/...`, served next to `/v1` until every Medusa store moved.
- Bump `info.version`, the plugin `CONTRACT_VERSION` and the bridge `ContractVersion` together. The contract test in each repository checks that they agree.
- The bridge repository keeps an identical copy of this folder. Change it here first, then copy.

## Writing your own bridge

1. Verify `X-Koda-Signature` on every `/v1` request against the raw body and the raw request target, reject timestamps older than 300 seconds.
2. Make `POST /v1/orders` idempotent per `order_id`. Store the order id in the document itself (the Koda Plus bridge writes `[medusa:<order_id>]` into the ZK notes), so the link survives a lost bridge database.
3. Make `POST /v1/orders/{orderId}/documents` idempotent per order the same way: look for a sales document carrying the order tag before creating one.
4. Number events monotonically and keep them at least 30 days. Return `head_id` so a reader can notice a reset feed.
5. Answer with the contract error body and a correct `retryable` flag: Medusa retries only what can succeed later.
6. List in `capabilities` only what your bridge really does.
