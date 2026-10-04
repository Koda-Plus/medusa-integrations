# Bridge contract

`openapi.yaml` is the complete HTTP contract between the Medusa plugin and a bridge running next to Subiekt nexo PRO. The plugin and the Koda Plus bridge are both tested against the files in this folder.

## Files

- `openapi.yaml`: endpoints, schemas, error codes, the signing scheme.
- `examples/order-create.request.json`: exactly what the plugin sends for the example order (a unit test builds it from a Medusa order and compares).
- `examples/order-create.response.json`, `error.unmatched-lines.json`, `health.json`, `stock.response.json`, `events.response.json`: answers a bridge gives.
- `examples/signature-vectors.json`: secret, timestamp, method, path, body and the expected `X-Koda-Signature` header. Any implementation must reproduce every vector.

## Rules for changes

- `1.x` only adds optional fields and new event types. Readers ignore unknown fields and unknown event types.
- A breaking change becomes `/v2/...`, served next to `/v1` until every Medusa store moved.
- Bump `info.version`, the plugin `CONTRACT_VERSION` and the bridge `ContractVersion` together. The contract test in each repository checks that they agree.

## Writing your own bridge

1. Verify `X-Koda-Signature` on every `/v1` request against the raw body and the raw request target, reject timestamps older than 300 seconds.
2. Make `POST /v1/orders` idempotent per `order_id`. Store the order id in the document itself (the Koda Plus bridge writes `[medusa:<order_id>]` into the ZK notes), so the link survives a lost bridge database.
3. Number events monotonically and keep them at least 30 days. Return `head_id` so a reader can notice a reset feed.
4. Answer with the contract error body and a correct `retryable` flag: Medusa retries only what can succeed later.
