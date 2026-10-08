import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the Packaging module. Idempotent: `if not exists` everywhere,
 * so a second run changes nothing.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES AND THE DEMO STORE:
 * Medusa records executed migrations by name alone.
 */
export class Migration20261008170000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "packaging_product" (
        "id" text not null,
        "product_id" text not null,
        "sku" text null,
        "title" text null,
        "moq" integer not null default 0,
        "step" integer not null default 0,
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "packaging_product_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_packaging_product_product_unique" on "packaging_product" ("product_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_packaging_product_sku" on "packaging_product" ("sku") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "packaging_unit" (
        "id" text not null,
        "product_id" text not null,
        "name" text not null default 'szt.',
        "pieces" integer not null default 1,
        "ean" text null,
        "sscc_prefix" text null,
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "packaging_unit_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_packaging_unit_product_name" on "packaging_unit" ("product_id", "name") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "packaging_unit" cascade;`)
    this.addSql(`drop table if exists "packaging_product" cascade;`)
  }
}
