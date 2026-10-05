# BaseLinker API: what this plugin relies on, and where it is documented

Checked on 2026-10-05 against the official API documentation at https://api.baselinker.com/ (one page per method, `https://api.baselinker.com/index.php?method=<name>`) and the Base help center at https://base.com/en-EN/help/.

Points marked "measured" come from the production BaseLinker integration Koda Plus runs for a Polish tyre and wheel retailer (read only on that account); they are not in the documentation. Points marked "not documented" are decisions the plugin makes defensively because the documentation is silent.

## Transport, limits, authentication

Source: https://api.baselinker.com/

- One endpoint: `POST https://api.baselinker.com/connector.php`, form fields `method` and `parameters` (JSON in a string). UTF-8.
- Token in the header `X-BLToken` (recommended; the POST field `token` is deprecated). The token is generated in the BaseLinker panel under "Account & other, My account, API".
- Limit: "The API request limit is 100 requests per minute." The page does not say what happens above it, nor whether the limit counts per token or per account (rechecked 2026-10-06). The plugin stays at 80 per minute by default (`requestsPerMinute`, capped at 100) with one limiter per process shared by all its jobs; other tools on the same account may count against the same limit.
- Token: "User can generate API token in BaseLinker panel in "Account & other -> My account -> API" section." The admin guide quotes this path.
- Errors arrive as HTTP 200 with `status: "ERROR"`, `error_code`, `error_message` (every method page). The main page publishes no list of error codes, so the admin never names a code it has not seen: the message shown is BaseLinker's own. Measured: rate limit refusals use `ERROR_RATE_LIMIT`; gateways answer 502 with HTML.
- No scopes or per-method permissions are documented for tokens, which is why the plugin has its own write barrier by method name.

## Catalog (inventory)

`getInventories`: https://api.baselinker.com/index.php?method=getInventories
- Used by the connection check: `inventory_id`, `name`, `warehouses`, `default_warehouse`.

`getInventoryProductsList`: https://api.baselinker.com/index.php?method=getInventoryProductsList
- Parameters used: `inventory_id`, `page` ("1000 products per page"), `filter_sku`, `include_variants` ("Include product variants additionally to products").
- Output: `products` keyed by product id; each entry `id`, `parent_id` ("Returns 0 for main products, or the main product ID for variants"), `ean`, `sku`, `name`, `prices` (gross, key = price group id), `stock` (key = warehouse id).
- Version 0.1 did not pass `include_variants`, so variant cards were invisible. Version 0.2 reads with `include_variants: true`; a main product that has variants is a container and is never linked itself.
- `filter_sku` is used to look a card up before creating it. Whether the filter is exact is not documented, so the plugin compares the SKU itself.

`getInventoryProductsData`: https://api.baselinker.com/index.php?method=getInventoryProductsData
- Parameters: `inventory_id`, `products` (array of ids). No limit per call is documented; the plugin asks for 100 ids at a time.
- Output per product: `is_bundle`, `parent_id`, `sku`, `ean`, `tax_rate`, `weight` ("in kilograms"), `height`, `width`, `length` (centimeters), `category_id`, `manufacturer_id`, `prices`, `stock`, `text_fields` (keys `name`, `description`, `features`, `description_extra1..4`, `extra_field_<id>`, optionally with `|lang|source`), `images` (key = position 1 to 16, value = URL), `variants` (keyed by variant id: `name`, `sku`, `ean`, `asin`, `prices`, `stock`, `locations`), `bundle_products`, `links`.
- Variants carry no weight, description or images of their own: the catalog import takes them from the main product.

`getInventoryCategories`: https://api.baselinker.com/index.php?method=getInventoryCategories
- `inventory_id` optional; output `categories[]` with `category_id`, `name`, `parent_id`. No paging documented.

`getInventoryManufacturers`: https://api.baselinker.com/index.php?method=getInventoryManufacturers
- `page` optional, 1000 per page; output `manufacturers[]` with `manufacturer_id`, `name`.

`getInventoryPriceGroups`: https://api.baselinker.com/index.php?method=getInventoryPriceGroups
- No parameters; output `price_groups[]` with `price_group_id`, `name`, `description`, `currency`, `is_default`, `price_group_type`, `source_price_group_id` (0 when the group is not derived from another one), `price_multiplier`, `price_addition`.
- A derived group (`source_price_group_id` not 0) is computed by BaseLinker from its source. The connection check warns about it, and the price push reads the groups before the first write of every run: nothing is written into a derived group, a group the account does not have, or a group whose `currency` differs from `priceCurrency`.

`getInventoryWarehouses`: https://api.baselinker.com/index.php?method=getInventoryWarehouses
- No parameters; output `warehouses[]` with `warehouse_type` ("bl" for Base warehouses, otherwise the integration type), `warehouse_id`, `name`, `stock_edition` (manual stock editing permitted), `is_default`.
- The warehouse key used everywhere else is `<warehouse_type>_<warehouse_id>`, for example `bl_205` (format `[type:bl|shop|warehouse]_[id:int]` on the getInventoryProductsData and updateInventoryProductsStock pages).

`addInventoryProduct`: https://api.baselinker.com/index.php?method=addInventoryProduct
- "The method allows you to add a new product to Base catalog. Entering the product with the ID updates previously saved product."
- Fields used: `inventory_id`, `product_id` (only for an update: "given only during the update. Should be left blank when creating a new product"), `sku` (varchar 50), `ean` (varchar 32), `weight` (kilograms, decimal 10,2), `prices` (key = price group id, gross), `stock` (key `bl_<id>`, cannot target external warehouses), `text_fields` (`name` up to 200 characters, `description`), `images` (up to 16; "the key identifies the photo position in the gallery (numbering from 0 to 15)", values `url:<address>`; "Include in the request ONLY the images you want to add or modify"). Output `product_id`, `warnings`.
- Not used: `parent_id` (variant structure), `is_bundle`, `category_id`, `manufacturer_id`. Each Medusa variant becomes its own card.
- Creating without `product_id` is not idempotent, so a create is one shot: a lookup by SKU before it, and after an unclear answer a second lookup instead of a second create.
- Not documented: what an update with `product_id` does to fields and `text_fields` keys that are not sent (rechecked 2026-10-06, including the example request). The keyed maps of the same method behave per key where the page does say something: images take "ONLY the images you want to add or modify" and an empty string removes one key (`"3|allegro_123": ""`). The plugin relies on the same per key behaviour and keeps every card update minimal: `text_fields.name` alone and `ean`, never the description, images, prices or stock of an existing card (prices and stock have their own methods and plans). Because this is an inference, the README and the setup guide advise arming the cards writer with `maxCatalogChangesPerRun: 1` first and checking that card in BaseLinker.

`updateInventoryProductsStock`: https://api.baselinker.com/index.php?method=updateInventoryProductsStock
- `inventory_id`, `products` keyed by product id (a variant id for a variant), each `{ "<warehouse id>": quantity }`. At most 1000 products per call. Stock cannot be assigned to warehouses "created automatically for purposes of keeping external stocks".
- Output `counter` (updated products) and `warnings` ("the key of each element is the product identifier, the value is the update error message"). The plugin counts a product with a warning as failed, and quarantines it after repeated failures.
- Absolute values, not deltas: writing the same number twice is harmless, so failed calls are retried.

`updateInventoryProductsPrices`: https://api.baselinker.com/index.php?method=updateInventoryProductsPrices
- `inventory_id`, `products` keyed by product id (variant id for a variant), each `{ "<price group id>": gross price }`. At most 1000 products per call. Output `counter`, `warnings` (same shape as above).

## Orders

`getOrders`: https://api.baselinker.com/index.php?method=getOrders
- "Maximum 100 orders per call." Parameters used: `order_id`, `date_from`, `date_confirmed_from`, `id_from`, `get_unconfirmed_orders` (default false; "e.g. an order from Allegro to which the customer has not yet completed the delivery form"), `filter_order_source`, `filter_order_source_id`, `include_custom_extra_fields`.
- Documented paging for the import: start at `date_confirmed_from`, and when 100 orders came back, continue from the `date_confirmed` of the last order plus one second. The plugin continues from the same second instead and skips the ids it has already seen, so orders confirmed in the same second as a page boundary are not lost; only when one second holds a full page does it move on by one second.
- Measured (read only): `id_from` is inclusive; `admin_comments` comes back as a string.
- Order fields used by the import: `order_id`, `external_order_id` ("An order identifier taken from an external source"), `order_source` ("shop", "personal", "order_return" or a marketplace code), `order_source_id`, `order_status_id`, `confirmed`, `date_confirmed`, `date_add`, `currency`, `payment_method`, `payment_method_cod` ("1" or "0"), `payment_done` ("Amount paid"), `email`, `phone`, `user_comments`, `admin_comments`, `delivery_method`, `delivery_price` (gross), `delivery_fullname`, `delivery_company`, `delivery_address`, `delivery_postcode`, `delivery_city`, `delivery_state`, `delivery_country_code`, `delivery_point_id`, `delivery_point_name`, `delivery_point_address`, `delivery_point_postcode`, `delivery_point_city`, `invoice_*`, `want_invoice`, `delivery_package_module`, `delivery_package_nr`, `products[]`.
- Order product fields used: `storage`, `storage_id`, `product_id` ("Product identifier in Base or shop storage. Blank if unknown"), `variant_id` ("Product variant ID. Blank if unknown"), `name`, `sku`, `ean`, `price_brutto` ("Single item gross price"), `tax_rate`, `quantity`, `bundle_id`.
- `filter_external_order_id` exists: "Allows filtering orders by the original order ID assigned by the marketplace or online store (e.g. Allegro transaction number, Amazon order number)".

The Allegro reference (`marketplace_order_ref`):
- BaseLinker documents `external_order_id` as the marketplace's own order id ("Allegro transaction number"). In the Allegro REST API the order is the checkout form and its id is a UUID (https://developer.allegro.pl/tutorials/jak-obslugiwac-zamowienia-GRaj0qyvwtR). Not verified on an account connected to Allegro: the plugin writes `allegro:<external_order_id>` as given, lowercased, and compares references case-insensitively.

`getOrderSources`: https://api.baselinker.com/index.php?method=getOrderSources
- No parameters; output `sources` keyed by type (`personal`, `shop`, `blconnect`, `allegro`, `ebay`, `amazon`, `amazon_vendor`, `order_return`, other marketplace codes), each a map of source id to name.
- Custom sources ("personal") are created in the panel under "Orders, Settings, Custom order sources", button "Create order source" (https://base.com/en-EN/help/knowledgebase/custom-order-sources/). Integrations (Allegro, shops) create their sources themselves.

`getOrderStatusList`: https://api.baselinker.com/index.php?method=getOrderStatusList
- Output `statuses[]` with `id`, `name`, `name_for_customer`.

`addOrder`: https://api.baselinker.com/index.php?method=addOrder
- `custom_source_id`: "Identifier of custom order source defined in Base panel. If not provided, default order source is assigned."
- `paid`: "Information whether the order is already paid. The value "1" automatically adds a full payment to the order." (Another integration in the Medusa library reports that the field is ignored and uses `setOrderPayment` instead; not reproduced by us, the documentation says the opposite.)
- `extra_field_1`, `extra_field_2`: "the seller can store any information there".
- `admin_comments`: varchar(200), carries the plugin's marker `[medusa:<order id>]`.

`setOrderFields`: https://api.baselinker.com/index.php?method=setOrderFields
- "Only the fields that you want to edit should be given, other fields can be omitted in the request."
- There is no field for an invoice NUMBER: the `invoice_*` fields are the buyer's billing data. The fields that can hold a number are `extra_field_1` and `extra_field_2` (varchar 50 each) and `custom_extra_fields` ("the key is the extra field ID and value is an extra field content"; an empty string removes the value).
- Output: `status` only.

`getOrderExtraFields`: https://api.baselinker.com/index.php?method=getOrderExtraFields
- Output `extra_fields[]` with `extra_field_id`, `name`, `editor_type` (`text`, `number`, `select`, `checkbox`, `radio`, `date`, `file`). Values are read with `getOrders` and `include_custom_extra_fields: true`.

Invoice number, the decision:
- `addInvoice` (https://api.baselinker.com/index.php?method=addInvoice) "allows to issue an order invoice" in a BaseLinker numbering series (`series_id` required) and returns `invoice_id`. It would issue a SECOND fiscal document next to the one Fakturownia issued. Not used.
- `addOrderInvoiceFile` (https://api.baselinker.com/index.php?method=addOrderInvoiceFile) adds a PDF to "an invoice previously issued from Base" and can overwrite its number (`external_invoice_number`, varchar 30). It needs a BaseLinker invoice first and the PDF. Not used.
- The plugin writes the number with `setOrderFields` into one order field the store chooses (`extra_field_1` by default, `extra_field_2`, or a custom extra field id), reads the order first, never overwrites a different value, and writes nothing else.

`setOrderPayment`: https://api.baselinker.com/index.php?method=setOrderPayment
- Documented for reference (`order_id`, `payment_done`, `payment_date`, `payment_comment`, `external_payment_id`). Not used.

## Returns

`getOrderReturns`: https://api.baselinker.com/index.php?method=getOrderReturns
- "A maximum of 100 order returns are returned at a time." Parameters used: `date_from`, `id_from`, `order_id`.
- Fields kept: `return_id`, `order_id`, `external_order_id` ("A return identifier taken from an external source, e.g. the marketplace return ID"), `order_return_source`, `order_return_source_id`, `status_id`, `date_add`, `date_in_status`, `currency`, `refunded`, `delivery_package_module`, `delivery_package_nr`, `fulfillment_status` (0 active, 5 accepted, 1 done, 2 canceled), products with `order_return_product_id`, `order_product_id`, `product_id`, `variant_id`, `name`, `sku`, `ean`, `price_brutto`, `quantity`, `status_id`, `return_reason_id`.
- Fields NOT kept (personal data): `email`, `phone`, `user_login`, every `delivery_*` address field, `order_return_account_number`, `order_return_iban`, `order_return_swift`, `return_reason_comment`, `custom_extra_fields`.

`getOrderReturnStatusList`: https://api.baselinker.com/index.php?method=getOrderReturnStatusList
- Output `statuses[]` with `id`, `name`, `color`, `group_id`, `is_primary`, `name_for_customer`.

`getOrderReturnReasonsList`: https://api.baselinker.com/index.php?method=getOrderReturnReasonsList
- Output `return_reasons[]` with `return_reason_id`, `name`.

## Journal

`getJournalList`: https://api.baselinker.com/index.php?method=getJournalList
- "The method allows you to download a list of order events from the last 3 days."
- "If this method is not enabled for your account, it may return an empty response; in such case, make sure it is enabled in your account API settings." Users who cannot enable it should contact Base support.
- Parameters: `last_log_id`, `logs_types` (array), `order_id`. Output `logs[]` with `log_id`, `log_type`, `order_id`, `object_id`, `date`.
- Types used: 1 order creation, 3 payment, 4 removal of order, invoice or receipt, 9 package creation (object_id: parcel id), 10 package deletion, 18 order status change (object_id: the status id), 22 package status change.
- No page size or order is documented: the plugin keeps the highest `log_id` it has processed and asks again from there, and treats an empty answer as "nothing new or not enabled", never as proof.
- Because the journal keeps three days, a plugin that was down longer reads statuses the full way first.
