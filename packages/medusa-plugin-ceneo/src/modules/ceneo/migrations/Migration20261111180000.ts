import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Kup Teraz orders as read from Ceneo. Idempotent (`if not exists`). The
 * name is unique across all Koda Plus packages and the demo store.
 */
export class Migration20261111180000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "ceneo_order" (
        "id" text not null,
        "ceneo_order_id" text not null,
        "displayed_order_id" text null,
        "shop_order_id" text null,
        "state_id" integer null,
        "ordered_at" timestamptz null,
        "amounts" jsonb null,
        "delivery_form" text null,
        "payment_type_id" integer null,
        "payment_method_id" integer null,
        "items" jsonb null,
        "matched" boolean not null default false,
        "problems" jsonb null,
        "medusa_order_id" text null,
        "demo" boolean not null default false,
        "synced_at" timestamptz not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "ceneo_order_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_ceneo_order_ceneo_id_unique" on "ceneo_order" ("ceneo_order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_ceneo_order_ordered_at" on "ceneo_order" ("ordered_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "ceneo_order" cascade;`)
  }
}
