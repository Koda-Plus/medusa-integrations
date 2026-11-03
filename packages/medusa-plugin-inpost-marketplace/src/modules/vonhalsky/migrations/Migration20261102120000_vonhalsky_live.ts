import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The live seller API: what the marketplace says about an offer (final
 * price, promotion, price program, validation, the last command), the money
 * and parcel facts of an order, the after sale cases, the category tree and
 * the daily snapshots. Additive and idempotent: `if not exists` everywhere,
 * no column is dropped.
 *
 * Tracking numbers are no longer sent (the seller API has no such call):
 * the old statuses of that writer become "none".
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES: Medusa records executed
 * migrations by name alone.
 */
export class Migration20261102120000_vonhalsky_live extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table if exists "vonhalsky_offer"
      add column if not exists "category_id" text null,
      add column if not exists "category_source" text null,
      add column if not exists "attributes" jsonb null,
      add column if not exists "hint" jsonb null,
      add column if not exists "remote_price_minor" integer null,
      add column if not exists "remote_final_price_minor" integer null,
      add column if not exists "remote_stock" integer null,
      add column if not exists "promotion" jsonb null,
      add column if not exists "program" text null,
      add column if not exists "validation" jsonb null,
      add column if not exists "command_id" text null,
      add column if not exists "command_kind" text null,
      add column if not exists "command_status" text null,
      add column if not exists "command_at" timestamptz null,
      add column if not exists "pushed_price_minor" integer null,
      add column if not exists "pushed_stock" integer null,
      add column if not exists "image_count" integer null,
      add column if not exists "published_at" timestamptz null;`)
    this.addSql(`create index if not exists "IDX_vonhalsky_offer_command_status" on "vonhalsky_offer" ("command_status") where "deleted_at" is null;`)

    this.addSql(`alter table if exists "vonhalsky_order"
      add column if not exists "remote_updated_at" timestamptz null,
      add column if not exists "paid_at" timestamptz null,
      add column if not exists "buyer_kind" text null,
      add column if not exists "delivery_minor" integer null,
      add column if not exists "base_total_minor" integer null,
      add column if not exists "promotion_discount_minor" integer null,
      add column if not exists "program_discount_minor" integer null,
      add column if not exists "parcels" jsonb null,
      add column if not exists "shipped_at" timestamptz null,
      add column if not exists "expected_delivery_at" timestamptz null,
      add column if not exists "refunded_minor" integer not null default 0,
      add column if not exists "returns_count" integer not null default 0,
      add column if not exists "claims_count" integer not null default 0;`)
    this.addSql(`update "vonhalsky_order" set "tracking_status" = 'none' where "tracking_status" in ('sent', 'failed', 'pending_api');`)

    this.addSql(`create table if not exists "vonhalsky_case" (
      "id" text not null primary key,
      "kind" text not null,
      "remote_id" text not null,
      "display_id" text null,
      "marketplace_order_id" text null,
      "status" text null,
      "sub_status" text null,
      "source" text null,
      "reason" text null,
      "amount_minor" integer null,
      "lines" jsonb null,
      "refund_id" text null,
      "opened_at" timestamptz null,
      "expires_at" timestamptz null,
      "decided_at" timestamptz null,
      "remote_updated_at" timestamptz null,
      "demo" boolean not null default false,
      "events" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null
    );`)
    this.addSql(`create unique index if not exists "IDX_vonhalsky_case_kind_remote_id_unique" on "vonhalsky_case" ("kind", "remote_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_vonhalsky_case_marketplace_order_id" on "vonhalsky_case" ("marketplace_order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_vonhalsky_case_kind_status" on "vonhalsky_case" ("kind", "status") where "deleted_at" is null;`)

    this.addSql(`create table if not exists "vonhalsky_category" (
      "id" text not null primary key,
      "remote_id" text not null,
      "parent_id" text null,
      "name" text not null,
      "path" text not null,
      "depth" integer not null default 0,
      "leaf" boolean not null default false,
      "gpsr_free" boolean not null default false,
      "attributes" jsonb null,
      "attributes_at" timestamptz null,
      "synced_at" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null
    );`)
    this.addSql(`create unique index if not exists "IDX_vonhalsky_category_remote_id_unique" on "vonhalsky_category" ("remote_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_vonhalsky_category_parent_id" on "vonhalsky_category" ("parent_id") where "deleted_at" is null;`)

    this.addSql(`create table if not exists "vonhalsky_snapshot" (
      "id" text not null primary key,
      "day" text not null,
      "data" jsonb not null,
      "demo" boolean not null default false,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null
    );`)
    this.addSql(`create unique index if not exists "IDX_vonhalsky_snapshot_day_unique" on "vonhalsky_snapshot" ("day") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "vonhalsky_snapshot" cascade;`)
    this.addSql(`drop table if exists "vonhalsky_category" cascade;`)
    this.addSql(`drop table if exists "vonhalsky_case" cascade;`)
    this.addSql(`drop index if exists "IDX_vonhalsky_offer_command_status";`)
    this.addSql(`alter table if exists "vonhalsky_order"
      drop column if exists "remote_updated_at", drop column if exists "paid_at", drop column if exists "buyer_kind",
      drop column if exists "delivery_minor", drop column if exists "base_total_minor", drop column if exists "promotion_discount_minor",
      drop column if exists "program_discount_minor", drop column if exists "parcels", drop column if exists "shipped_at",
      drop column if exists "expected_delivery_at", drop column if exists "refunded_minor", drop column if exists "returns_count",
      drop column if exists "claims_count";`)
    this.addSql(`alter table if exists "vonhalsky_offer"
      drop column if exists "category_id", drop column if exists "category_source", drop column if exists "attributes",
      drop column if exists "hint", drop column if exists "remote_price_minor", drop column if exists "remote_final_price_minor",
      drop column if exists "remote_stock", drop column if exists "promotion", drop column if exists "program",
      drop column if exists "validation", drop column if exists "command_id", drop column if exists "command_kind",
      drop column if exists "command_status", drop column if exists "command_at", drop column if exists "pushed_price_minor",
      drop column if exists "pushed_stock", drop column if exists "image_count", drop column if exists "published_at";`)
  }
}
