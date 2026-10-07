import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * 0.3.0: indexes for the exact reads of the host contract (a product's
 * cards by SKU, an inventory item's stock plan, a variant's push plan, the
 * flagged imports). Idempotent; the name is unique across the monorepo,
 * because Medusa records migrations of every module by name in one table.
 */
export class Migration20261008150000_baselinker extends Migration {
  async up(): Promise<void> {
    this.addSql(`create index if not exists "IDX_baselinker_product_match_key" on "baselinker_product" ("match_key") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_baselinker_stock_change_inventory_item_id" on "baselinker_stock_change" ("inventory_item_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_baselinker_stock_change_product_id" on "baselinker_stock_change" ("product_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_baselinker_plan_item_variant_id" on "baselinker_plan_item" ("variant_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_baselinker_plan_item_product_id" on "baselinker_plan_item" ("product_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_baselinker_import_flag" on "baselinker_import" ("flag") where deleted_at is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_baselinker_product_match_key";`)
    this.addSql(`drop index if exists "IDX_baselinker_stock_change_inventory_item_id";`)
    this.addSql(`drop index if exists "IDX_baselinker_stock_change_product_id";`)
    this.addSql(`drop index if exists "IDX_baselinker_plan_item_variant_id";`)
    this.addSql(`drop index if exists "IDX_baselinker_plan_item_product_id";`)
    this.addSql(`drop index if exists "IDX_baselinker_import_flag";`)
  }
}
