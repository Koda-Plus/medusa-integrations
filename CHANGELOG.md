# Changelog

## 0.1.0 (2026-10-05)

First release, built on what Koda Plus learned running a Subiekt nexo bridge in production for a Polish cosmetics brand since 2026.

- Bridge contract `contract/openapi.yaml` 1.0.0: health, orders (ZK), cancel, fulfillments (WZ), stock pages from one snapshot, cursor-based event feed with `head_id`, signed webhook. Examples and cross-language signature vectors.
- Request signatures in both directions: HMAC-SHA256 over timestamp, method, path and raw body; secret rotation; 5 minute window.
- Orders to ZK on `order.placed`; prepaid providers wait for `payment.captured`; cancels on `order.canceled`; optional WZ from Medusa fulfillments.
- Outbox task queue with backoff (14 attempts, about 2.5 days), stale task recovery, non-retryable errors parked for a person.
- Event feed reader: WZ from the warehouse into order metadata, `subiekt.document_issued`, optional `fulfillOnWz`; restarts from 0 when the bridge feed was reset.
- Stock sync into inventory levels: EAN first, then SKU, conflicts never written, missing products never zeroed, kit components by their own SKU, dry run.
- Admin: Subiekt nexo page (connection, queue, documents, stock plan with unmatched SKUs, history) and an order widget, in English and Polish.
- Workflows for custom code: send, cancel, WZ, stock, events, health, queue.
- Demo bridge inside Medusa: ZK in seconds, WZ three minutes later, stock from the catalog.
