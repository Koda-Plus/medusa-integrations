import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * 0.2.0: writers with their runtime toggles, the catalog plan from Subiekt
 * (prices and products to create) with its quarantine, KSeF numbers on
 * documents, frozen task input, and bridge diagnostics on the connection.
 * Idempotent (`if not exists`), so a re-run is a no-op.
 */
export class Migration20261006120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "subiekt_writer" (
        "id" text not null,
        "key" text not null,
        "armed" boolean not null default false,
        "changed_by" text null,
        "changed_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "subiekt_writer_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_subiekt_writer_key_demo" on "subiekt_writer" ("key", "demo") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_subiekt_writer_deleted_at" on "subiekt_writer" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "subiekt_catalog_change" (
        "id" text not null,
        "run_id" text null,
        "kind" text not null,
        "status" text not null default 'planned',
        "symbol" text not null,
        "sku" text null,
        "ean" text null,
        "title" text null,
        "variant_id" text null,
        "product_id" text null,
        "price_id" text null,
        "currency" text not null,
        "from_minor" integer null,
        "to_minor" integer null,
        "level" text null,
        "matched_by" text null,
        "data" jsonb null,
        "attempts" integer not null default 0,
        "last_error" text null,
        "applied_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "subiekt_catalog_change_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_subiekt_catalog_change_demo_kind_status" on "subiekt_catalog_change" ("demo", "kind", "status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_subiekt_catalog_change_deleted_at" on "subiekt_catalog_change" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "subiekt_catalog_quarantine" (
        "id" text not null,
        "kind" text not null,
        "item_key" text not null,
        "failures" integer not null default 0,
        "quarantined" boolean not null default false,
        "last_error" text null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "subiekt_catalog_quarantine_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_subiekt_catalog_quarantine_item" on "subiekt_catalog_quarantine" ("kind", "item_key", "demo") where "deleted_at" is null;`,
    )
    this.addSql(`create index if not exists "IDX_subiekt_catalog_quarantine_deleted_at" on "subiekt_catalog_quarantine" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`alter table if exists "subiekt_document" add column if not exists "ksef_number" text null;`)
    this.addSql(`alter table if exists "subiekt_task" add column if not exists "detail" jsonb null;`)
    this.addSql(`alter table if exists "subiekt_connection" add column if not exists "latency_ms" integer null;`)
    this.addSql(`alter table if exists "subiekt_connection" add column if not exists "clock_skew_ms" integer null;`)
    this.addSql(`alter table if exists "subiekt_connection" add column if not exists "diagnostics" jsonb null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "subiekt_catalog_quarantine" cascade;`)
    this.addSql(`drop table if exists "subiekt_catalog_change" cascade;`)
    this.addSql(`drop table if exists "subiekt_writer" cascade;`)
    this.addSql(`alter table if exists "subiekt_document" drop column if exists "ksef_number";`)
    this.addSql(`alter table if exists "subiekt_task" drop column if exists "detail";`)
    this.addSql(`alter table if exists "subiekt_connection" drop column if exists "latency_ms";`)
    this.addSql(`alter table if exists "subiekt_connection" drop column if exists "clock_skew_ms";`)
    this.addSql(`alter table if exists "subiekt_connection" drop column if exists "diagnostics";`)
  }
}
