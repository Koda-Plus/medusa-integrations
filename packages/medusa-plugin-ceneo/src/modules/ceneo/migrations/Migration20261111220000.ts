import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * CPC bids, promotion texts and the competition (`ceneo_bid`). Idempotent
 * (`if not exists`). The name is unique across all Koda Plus packages and
 * the demo store.
 */
export class Migration20261111220000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "ceneo_bid" (
        "id" text not null,
        "kind" text not null,
        "key" text not null,
        "ceneo_product_id" text null,
        "name" text null,
        "current_bid" integer null,
        "click_rate" integer null,
        "min_suggested_bid" integer null,
        "target_bid" integer null,
        "planned_bid" integer null,
        "plan_reasons" jsonb null,
        "target_by" text null,
        "target_at" timestamptz null,
        "promo_text" text null,
        "promo_applied" text null,
        "promo_pending" boolean not null default false,
        "promo_at" timestamptz null,
        "top10" jsonb null,
        "offers_number" integer null,
        "position" integer null,
        "lowest_price" jsonb null,
        "applied_at" timestamptz null,
        "error" text null,
        "error_at" timestamptz null,
        "read_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "ceneo_bid_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_ceneo_bid_kind_key_demo_unique" on "ceneo_bid" ("kind", "key", "demo") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_ceneo_bid_read_at" on "ceneo_bid" ("read_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "ceneo_bid" cascade;`)
  }
}
