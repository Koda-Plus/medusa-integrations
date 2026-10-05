import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the Allegro module. Idempotent (`if not exists`), so a re-run on
 * a database that already has them is a no-op.
 */
export class Migration20261005120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "allegro_connection" (
        "id" text not null,
        "environment" text not null,
        "refresh_token_enc" text null,
        "access_token_enc" text null,
        "access_expires_at" timestamptz null,
        "refreshed_at" timestamptz null,
        "connected_at" timestamptz null,
        "disconnected_at" timestamptz null,
        "scope" text null,
        "device_code_enc" text null,
        "user_code" text null,
        "device_expires_at" timestamptz null,
        "device_interval_s" integer null,
        "last_error" text null,
        "last_error_at" timestamptz null,
        "version" integer not null default 0,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "allegro_connection_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_allegro_connection_deleted_at" on "allegro_connection" ("deleted_at") where "deleted_at" is null;`,
    )

    this.addSql(`
      create table if not exists "allegro_offer" (
        "id" text not null,
        "allegro_id" text not null,
        "name" text not null,
        "status" text not null,
        "external_id" text null,
        "match_key" text null,
        "variant_id" text null,
        "product_id" text null,
        "sku" text null,
        "product_title" text null,
        "is_primary" boolean not null default false,
        "price" jsonb null,
        "available" integer null,
        "sold" integer null,
        "medusa_available" integer null,
        "stock_state" text null,
        "format" text null,
        "category_id" text null,
        "started_at" timestamptz null,
        "ending_at" timestamptz null,
        "ended_by" text null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "allegro_offer_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_allegro_offer_allegro_id_unique" on "allegro_offer" ("allegro_id") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_allegro_offer_variant_id" on "allegro_offer" ("variant_id") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_allegro_offer_product_id" on "allegro_offer" ("product_id") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_allegro_offer_deleted_at" on "allegro_offer" ("deleted_at") where "deleted_at" is null;`,
    )

    this.addSql(`
      create table if not exists "allegro_order" (
        "id" text not null,
        "allegro_id" text not null,
        "status" text not null,
        "fulfillment_status" text null,
        "total" jsonb null,
        "bought_at" timestamptz null,
        "allegro_updated_at" timestamptz null,
        "delivery_method" text null,
        "line_count" integer not null default 0,
        "unmatched_lines" integer not null default 0,
        "lines" jsonb null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "allegro_order_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_allegro_order_allegro_id_unique" on "allegro_order" ("allegro_id") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_allegro_order_bought_at" on "allegro_order" ("bought_at") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_allegro_order_deleted_at" on "allegro_order" ("deleted_at") where "deleted_at" is null;`,
    )

    this.addSql(`
      create table if not exists "allegro_sync_run" (
        "id" text not null,
        "kind" text not null,
        "source" text not null,
        "trigger" text not null,
        "status" text not null,
        "complete" boolean not null default false,
        "pages" integer not null default 0,
        "items" integer not null default 0,
        "statuses" jsonb null,
        "linked" integer not null default 0,
        "linked_live" integer not null default 0,
        "unmatched_live" integer not null default 0,
        "issues" integer not null default 0,
        "created_count" integer not null default 0,
        "updated_count" integer not null default 0,
        "removed_count" integer not null default 0,
        "message" text null,
        "duration_ms" integer not null default 0,
        "started_at" timestamptz not null,
        "finished_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "allegro_sync_run_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_allegro_sync_run_deleted_at" on "allegro_sync_run" ("deleted_at") where "deleted_at" is null;`,
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "allegro_sync_run" cascade;`)
    this.addSql(`drop table if exists "allegro_order" cascade;`)
    this.addSql(`drop table if exists "allegro_offer" cascade;`)
    this.addSql(`drop table if exists "allegro_connection" cascade;`)
  }
}
