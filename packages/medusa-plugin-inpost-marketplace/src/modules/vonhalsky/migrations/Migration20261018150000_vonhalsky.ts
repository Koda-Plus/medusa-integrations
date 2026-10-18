import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The tables of the InPost Von Halsky module: the offers, the marketplace
 * orders, the sync log and the settings. Idempotent: `if not exists`
 * everywhere.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES: Medusa records executed
 * migrations by name alone.
 */
export class Migration20261018150000_vonhalsky extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "vonhalsky_offer" (
      "id" text not null primary key,
      "variant_id" text not null,
      "product_id" text not null,
      "sku" text null,
      "title" text null,
      "status" text not null default 'draft',
      "remote_status" text null,
      "remote_id" text null,
      "ean" text null,
      "brand" text null,
      "mpn" text null,
      "manufacturer" text null,
      "gpsr_source" text null,
      "reasons" jsonb null,
      "warnings" jsonb null,
      "base_price_minor" integer null,
      "price_override_minor" integer null,
      "price_minor" integer null,
      "currency_code" text not null default 'pln',
      "stock" integer not null default 0,
      "demo" boolean not null default false,
      "listed_at" timestamptz null,
      "synced_at" timestamptz null,
      "error" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null
    );`)
    this.addSql(`create unique index if not exists "IDX_vonhalsky_offer_variant_id_unique" on "vonhalsky_offer" ("variant_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_vonhalsky_offer_product_id" on "vonhalsky_offer" ("product_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_vonhalsky_offer_status" on "vonhalsky_offer" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_vonhalsky_offer_remote_id" on "vonhalsky_offer" ("remote_id") where "deleted_at" is null;`)

    this.addSql(`create table if not exists "vonhalsky_order" (
      "id" text not null primary key,
      "marketplace_order_id" text not null,
      "status" text not null default 'importing',
      "remote_status" text null,
      "order_id" text null,
      "display_id" integer null,
      "demo" boolean not null default false,
      "delivery_type" text null,
      "delivery_point" text null,
      "shipping_option_id" text null,
      "payment_type" text null,
      "currency_code" text not null default 'pln',
      "total_minor" integer null,
      "lines" jsonb null,
      "tracking_status" text not null default 'none',
      "tracking_numbers" jsonb null,
      "tracking_sent_at" timestamptz null,
      "placed_at" timestamptz null,
      "imported_at" timestamptz null,
      "attempts" integer not null default 0,
      "error" text null,
      "events" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null
    );`)
    this.addSql(`create unique index if not exists "IDX_vonhalsky_order_marketplace_order_id_unique" on "vonhalsky_order" ("marketplace_order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_vonhalsky_order_order_id" on "vonhalsky_order" ("order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_vonhalsky_order_status" on "vonhalsky_order" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_vonhalsky_order_tracking_status" on "vonhalsky_order" ("tracking_status") where "deleted_at" is null;`)

    this.addSql(`create table if not exists "vonhalsky_sync_log" (
      "id" text not null primary key,
      "area" text not null,
      "action" text not null,
      "outcome" text not null default 'ok',
      "message" text not null,
      "count" integer null,
      "demo" boolean not null default false,
      "refs" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null
    );`)
    this.addSql(`create index if not exists "IDX_vonhalsky_sync_log_created_at" on "vonhalsky_sync_log" ("created_at") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_vonhalsky_sync_log_outcome" on "vonhalsky_sync_log" ("outcome") where "deleted_at" is null;`)

    this.addSql(`create table if not exists "vonhalsky_setting" (
      "id" text not null primary key,
      "key" text not null,
      "value" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null
    );`)
    this.addSql(`create unique index if not exists "IDX_vonhalsky_setting_key_unique" on "vonhalsky_setting" ("key") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "vonhalsky_offer" cascade;`)
    this.addSql(`drop table if exists "vonhalsky_order" cascade;`)
    this.addSql(`drop table if exists "vonhalsky_sync_log" cascade;`)
    this.addSql(`drop table if exists "vonhalsky_setting" cascade;`)
  }
}
