import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the BaseLinker module. Idempotent (`if not exists`), so a re-run
 * on a database that already has them is a no-op.
 */
export class Migration20261005130000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "baselinker_product" (
        "id" text not null,
        "bl_product_id" text not null,
        "parent_id" text null,
        "sku" text null,
        "ean" text null,
        "name" text not null,
        "stock" integer null,
        "price" jsonb null,
        "match_key" text null,
        "match_source" text null,
        "variant_id" text null,
        "product_id" text null,
        "variant_sku" text null,
        "product_title" text null,
        "conflict" text null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "baselinker_product_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_baselinker_product_bl_product_id_demo_unique" on "baselinker_product" ("bl_product_id", "demo") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_baselinker_product_variant_id" on "baselinker_product" ("variant_id") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_baselinker_product_product_id" on "baselinker_product" ("product_id") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_baselinker_product_deleted_at" on "baselinker_product" ("deleted_at") where "deleted_at" is null;`,
    )

    this.addSql(`
      create table if not exists "baselinker_order" (
        "id" text not null,
        "order_id" text not null,
        "display_id" integer null,
        "status" text not null default 'pending',
        "bl_order_id" text null,
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "last_error" text null,
        "last_error_code" text null,
        "sent_at" timestamptz null,
        "bl_status_id" integer null,
        "bl_status_name" text null,
        "tracking_number" text null,
        "tracking_url" text null,
        "carrier" text null,
        "status_checked_at" timestamptz null,
        "fulfilled_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "baselinker_order_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_baselinker_order_order_id_demo_unique" on "baselinker_order" ("order_id", "demo") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_baselinker_order_status_next_attempt_at" on "baselinker_order" ("status", "next_attempt_at") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_baselinker_order_bl_order_id" on "baselinker_order" ("bl_order_id") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_baselinker_order_deleted_at" on "baselinker_order" ("deleted_at") where "deleted_at" is null;`,
    )

    this.addSql(`
      create table if not exists "baselinker_stock_change" (
        "id" text not null,
        "run_id" text null,
        "variant_id" text not null,
        "product_id" text null,
        "sku" text null,
        "product_title" text null,
        "bl_product_id" text not null,
        "inventory_item_id" text not null,
        "location_id" text not null,
        "level_id" text null,
        "medusa_stocked" integer null,
        "medusa_reserved" integer not null default 0,
        "bl_stock" integer not null,
        "target" integer not null,
        "delta" integer not null,
        "kind" text not null,
        "status" text not null default 'planned',
        "after_stocked" integer null,
        "applied_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "baselinker_stock_change_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_baselinker_stock_change_demo_delta" on "baselinker_stock_change" ("demo", "delta") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_baselinker_stock_change_deleted_at" on "baselinker_stock_change" ("deleted_at") where "deleted_at" is null;`,
    )

    this.addSql(`
      create table if not exists "baselinker_sync_run" (
        "id" text not null,
        "kind" text not null,
        "source" text not null,
        "trigger" text not null,
        "status" text not null,
        "complete" boolean not null default false,
        "counts" jsonb null,
        "message" text null,
        "duration_ms" integer not null default 0,
        "started_at" timestamptz not null,
        "finished_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "baselinker_sync_run_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_baselinker_sync_run_kind_started_at" on "baselinker_sync_run" ("kind", "started_at") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_baselinker_sync_run_deleted_at" on "baselinker_sync_run" ("deleted_at") where "deleted_at" is null;`,
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "baselinker_sync_run" cascade;`)
    this.addSql(`drop table if exists "baselinker_stock_change" cascade;`)
    this.addSql(`drop table if exists "baselinker_order" cascade;`)
    this.addSql(`drop table if exists "baselinker_product" cascade;`)
  }
}
