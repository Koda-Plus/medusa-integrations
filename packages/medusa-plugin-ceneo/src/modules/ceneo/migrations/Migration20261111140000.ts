import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The Ceneo category tree and the mapping of Medusa categories to it.
 * Idempotent (`if not exists`). The name is unique across all Koda Plus
 * packages and the demo store.
 */
export class Migration20261111140000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "ceneo_category" (
        "id" text not null,
        "ceneo_id" text not null,
        "name" text not null,
        "parent_ceneo_id" text null,
        "path" text not null,
        "depth" integer not null default 0,
        "leaf" boolean not null default true,
        "active" boolean not null default true,
        "synced_at" timestamptz not null default now(),
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "ceneo_category_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_ceneo_category_ceneo_id_unique" on "ceneo_category" ("ceneo_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_ceneo_category_active" on "ceneo_category" ("active") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "ceneo_category_map" (
        "id" text not null,
        "category_id" text not null,
        "ceneo_id" text not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "ceneo_category_map_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_ceneo_category_map_category_unique" on "ceneo_category_map" ("category_id") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "ceneo_category_map" cascade;`)
    this.addSql(`drop table if exists "ceneo_category" cascade;`)
  }
}
