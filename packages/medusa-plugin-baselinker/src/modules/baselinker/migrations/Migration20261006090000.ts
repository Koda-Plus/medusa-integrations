import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Version 0.2: writer arms and cursors, plans of the new writers, quarantine,
 * imported marketplace orders, returns and invoice numbers. Idempotent
 * (`if not exists`), so a re-run on a database that has them is a no-op.
 */
export class Migration20261006090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "baselinker_setting" (
        "id" text not null,
        "key" text not null,
        "value" jsonb null,
        "demo" boolean not null default false,
        "changed_by" text null,
        "changed_by_label" text null,
        "changed_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "baselinker_setting_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_baselinker_setting_key_demo_unique" on "baselinker_setting" ("key", "demo") where deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_baselinker_setting_deleted_at" on "baselinker_setting" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "baselinker_plan_item" (
        "id" text not null,
        "kind" text not null,
        "run_id" text null,
        "item_key" text not null,
        "action" text not null,
        "status" text not null default 'planned',
        "reason" text null,
        "label" text null,
        "sku" text null,
        "product_id" text null,
        "variant_id" text null,
        "bl_product_id" text null,
        "changes" jsonb null,
        "error" text null,
        "applied_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "baselinker_plan_item_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_baselinker_plan_item_kind_demo_status" on "baselinker_plan_item" ("kind", "demo", "status") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_baselinker_plan_item_kind_demo_action" on "baselinker_plan_item" ("kind", "demo", "action") where deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_baselinker_plan_item_deleted_at" on "baselinker_plan_item" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "baselinker_quarantine" (
        "id" text not null,
        "kind" text not null,
        "item_key" text not null,
        "label" text null,
        "failures" integer not null default 0,
        "last_error" text null,
        "quarantined_at" timestamptz null,
        "released_at" timestamptz null,
        "released_by" text null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "baselinker_quarantine_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_baselinker_quarantine_kind_item_key_demo_unique" on "baselinker_quarantine" ("kind", "item_key", "demo") where deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_baselinker_quarantine_deleted_at" on "baselinker_quarantine" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "baselinker_import" (
        "id" text not null,
        "bl_order_id" text not null,
        "source" text not null,
        "source_id" text null,
        "external_order_id" text null,
        "marketplace_ref" text null,
        "status" text not null default 'pending',
        "order_id" text null,
        "display_id" integer null,
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "last_error" text null,
        "last_error_code" text null,
        "confirmed_at" timestamptz null,
        "total_minor" integer null,
        "currency" text null,
        "lines" integer not null default 0,
        "unlinked_lines" integer not null default 0,
        "payment_state" text null,
        "bl_status_id" integer null,
        "bl_status_name" text null,
        "tracking_number" text null,
        "tracking_url" text null,
        "carrier" text null,
        "status_checked_at" timestamptz null,
        "flag" text null,
        "imported_at" timestamptz null,
        "canceled_at" timestamptz null,
        "fulfilled_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "baselinker_import_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_baselinker_import_bl_order_id_demo_unique" on "baselinker_import" ("bl_order_id", "demo") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_baselinker_import_status_next_attempt_at" on "baselinker_import" ("status", "next_attempt_at") where deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_baselinker_import_order_id" on "baselinker_import" ("order_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_baselinker_import_marketplace_ref" on "baselinker_import" ("marketplace_ref") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_baselinker_import_deleted_at" on "baselinker_import" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "baselinker_return" (
        "id" text not null,
        "bl_return_id" text not null,
        "bl_order_id" text null,
        "order_id" text null,
        "display_id" integer null,
        "source" text null,
        "external_return_id" text null,
        "status_id" integer null,
        "status_name" text null,
        "fulfillment_status" integer null,
        "refunded_minor" integer null,
        "currency" text null,
        "products" jsonb null,
        "created_in_bl_at" timestamptz null,
        "status_changed_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "baselinker_return_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_baselinker_return_bl_return_id_demo_unique" on "baselinker_return" ("bl_return_id", "demo") where deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_baselinker_return_order_id" on "baselinker_return" ("order_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_baselinker_return_deleted_at" on "baselinker_return" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "baselinker_invoice" (
        "id" text not null,
        "document_id" text not null,
        "external_id" text null,
        "order_id" text not null,
        "display_id" integer null,
        "bl_order_id" text null,
        "kind" text not null,
        "number" text null,
        "field" text not null,
        "status" text not null default 'pending',
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "last_error" text null,
        "last_error_code" text null,
        "written_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "baselinker_invoice_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_baselinker_invoice_document_id_demo_unique" on "baselinker_invoice" ("document_id", "demo") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_baselinker_invoice_status_next_attempt_at" on "baselinker_invoice" ("status", "next_attempt_at") where deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_baselinker_invoice_order_id" on "baselinker_invoice" ("order_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_baselinker_invoice_deleted_at" on "baselinker_invoice" ("deleted_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "baselinker_invoice" cascade;`)
    this.addSql(`drop table if exists "baselinker_return" cascade;`)
    this.addSql(`drop table if exists "baselinker_import" cascade;`)
    this.addSql(`drop table if exists "baselinker_quarantine" cascade;`)
    this.addSql(`drop table if exists "baselinker_plan_item" cascade;`)
    this.addSql(`drop table if exists "baselinker_setting" cascade;`)
  }
}
