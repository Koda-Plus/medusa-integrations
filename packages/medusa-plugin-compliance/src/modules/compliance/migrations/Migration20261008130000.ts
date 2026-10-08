import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the EU Compliance module. Idempotent: `if not exists` everywhere,
 * so a second run (or a run on a database that already has them) changes
 * nothing.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES AND THE DEMO STORE:
 * Medusa records executed migrations by name alone.
 */
export class Migration20261008130000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "compliance_responsible_person" (
        "id" text not null,
        "kind" text not null default 'responsible_person',
        "name" text not null,
        "address" text null,
        "email" text null,
        "country_code" text null,
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "compliance_responsible_person_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_compliance_rp_kind_name" on "compliance_responsible_person" ("kind", "name") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_compliance_rp_demo" on "compliance_responsible_person" ("demo") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "compliance_product" (
        "id" text not null,
        "product_id" text not null,
        "sku" text null,
        "title" text null,
        "manufacturer_id" text null,
        "responsible_person_id" text null,
        "warnings" jsonb null,
        "safety_info" text null,
        "complete" boolean not null default false,
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "compliance_product_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_compliance_product_product_unique" on "compliance_product" ("product_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_compliance_product_sku" on "compliance_product" ("sku") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_compliance_product_demo_complete" on "compliance_product" ("demo", "complete") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "compliance_consent" (
        "id" text not null,
        "customer_id" text null,
        "purpose" text not null,
        "granted" boolean not null default false,
        "version" text null,
        "source" text not null default 'cookie_banner',
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "compliance_consent_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_compliance_consent_customer_purpose" on "compliance_consent" ("customer_id", "purpose") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_compliance_consent_purpose_created" on "compliance_consent" ("purpose", "created_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "compliance_dsr" (
        "id" text not null,
        "customer_id" text not null,
        "customer_email" text null,
        "type" text not null,
        "status" text not null default 'pending',
        "note" text null,
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "compliance_dsr_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_compliance_dsr_customer_created" on "compliance_dsr" ("customer_id", "created_at") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_compliance_dsr_status_created" on "compliance_dsr" ("status", "created_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "compliance_price_snapshot" (
        "id" text not null,
        "variant_id" text not null,
        "sku" text null,
        "currency_code" text null,
        "amount" integer null,
        "captured_at" timestamptz not null default now(),
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "compliance_price_snapshot_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_compliance_price_sku_captured" on "compliance_price_snapshot" ("sku", "captured_at") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_compliance_price_variant_captured" on "compliance_price_snapshot" ("variant_id", "captured_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "compliance_price_snapshot" cascade;`)
    this.addSql(`drop table if exists "compliance_dsr" cascade;`)
    this.addSql(`drop table if exists "compliance_consent" cascade;`)
    this.addSql(`drop table if exists "compliance_product" cascade;`)
    this.addSql(`drop table if exists "compliance_responsible_person" cascade;`)
  }
}
