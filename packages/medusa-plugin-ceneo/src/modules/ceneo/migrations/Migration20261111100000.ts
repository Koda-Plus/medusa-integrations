import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the Ceneo module: the feed builds and the offers. Idempotent:
 * `if not exists` everywhere, so a second run changes nothing.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES AND THE DEMO STORE:
 * Medusa records executed migrations by name alone.
 */
export class Migration20261111100000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "ceneo_feed" (
        "id" text not null,
        "status" text not null default 'built',
        "xml" text null,
        "hash" text null,
        "bytes" integer not null default 0,
        "offers" integer not null default 0,
        "warnings" integer not null default 0,
        "errors" integer not null default 0,
        "excluded" integer not null default 0,
        "duration_ms" integer not null default 0,
        "error" text null,
        "trigger" text not null default 'schedule',
        "built_at" timestamptz not null default now(),
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "ceneo_feed_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_ceneo_feed_status_built" on "ceneo_feed" ("status", "built_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "ceneo_offer" (
        "id" text not null,
        "offer_id" text null,
        "variant_id" text not null,
        "product_id" text not null,
        "sku" text null,
        "title" text not null,
        "state" text not null default 'ok',
        "problems" jsonb null,
        "in_feed" boolean not null default false,
        "price" jsonb null,
        "avail" integer null,
        "stock" integer null,
        "ceneo_category_id" text null,
        "built_at" timestamptz not null default now(),
        "retired_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "ceneo_offer_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_ceneo_offer_offer_id_unique" on "ceneo_offer" ("offer_id") where "deleted_at" is null;`)
    this.addSql(`create unique index if not exists "IDX_ceneo_offer_variant_active" on "ceneo_offer" ("variant_id") where "retired_at" is null and "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_ceneo_offer_product" on "ceneo_offer" ("product_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_ceneo_offer_state" on "ceneo_offer" ("state") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "ceneo_offer" cascade;`)
    this.addSql(`drop table if exists "ceneo_feed" cascade;`)
  }
}
