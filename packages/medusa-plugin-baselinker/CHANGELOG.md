# Changelog

## 0.1.0 (2026-10-05)

First public release, generalized from the BaseLinker integration Koda Plus runs in production for a Polish tyre and wheel retailer since August 2026.

- One HTTP client for `connector.php` with a write barrier by method name: every `get*` passes, `addOrder` is the only write and only with `exportOrders`. Errors read from the response body, transient retries for reads, a single shot for `addOrder`, a process-wide rate limiter, the token masked everywhere.
- Card linking: the whole catalog through `getInventoryProductsList`, SKU then EAN, unique on both sides, duplicates and ambiguous keys reported and never linked, the complete-read rule (an incomplete read never unlinks), variants missing in BaseLinker counted.
- Stock planned before it is written: target stocked = max(0, BaseLinker) + reserved, negative stock clamped, kits skipped, never from an incomplete read, never zeroing items missing from a read; `stockSync` `off`, `plan` (default) or `write` through `batchInventoryItemLevelsWorkflow`, capped per run, decreases first.
- Orders exactly once: an outbox row on `order.placed`, a marker in `admin_comments`, a `getOrders` scan before every write and after an unknown result, backoff for about two and a half days, `failed` rows waiting for a person; no payload stored.
- `addOrder` payload: catalog lines for linked variants, free lines otherwise, unit price after discounts, highest tax rate, quantity from `items.detail`, shipping address, InPost lockers, invoice data on request, `paid` only when captured, cash on delivery by provider.
- The way back: status names, tracking numbers and carrier links (DPD, GLS, InPost, DHL, UPS, FedEx, Poczta Polska) into order metadata, batched by custom order source where possible; the Medusa fulfillment created once on `fulfillOnStatusIds`.
- Admin: BaseLinker page (connection check, stock plan, cards, orders, history), an order widget and a product widget, in English and Polish.
- Workflows for custom code and the events `baselinker.order_sent`, `baselinker.order_failed`, `baselinker.order_status_changed`.
- Demo mode: a simulated BaseLinker account built from the catalog, orders moving from "Nowe" to "Wysłane" with an InPost number, plan-only stock.
