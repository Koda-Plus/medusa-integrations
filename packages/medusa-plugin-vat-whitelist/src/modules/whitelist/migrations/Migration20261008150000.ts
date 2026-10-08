import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the VAT Whitelist module. Idempotent: `if not exists` everywhere,
 * so a second run changes nothing.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES AND THE DEMO STORE:
 * Medusa records executed migrations by name alone.
 */
export class Migration20261008150000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "whitelist_entity" (
        "id" text not null,
        "nip" text not null,
        "country_code" text not null default 'PL',
        "source" text not null default 'whitelist',
        "state" text not null default 'unavailable',
        "status_vat" text null,
        "name" text null,
        "address" text null,
        "bank_accounts" jsonb null,
        "customer_id" text null,
        "checked_at" timestamptz not null default now(),
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "whitelist_entity_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_whitelist_entity_nip_unique" on "whitelist_entity" ("nip") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_whitelist_entity_customer" on "whitelist_entity" ("customer_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_whitelist_entity_state" on "whitelist_entity" ("state") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "whitelist_check" (
        "id" text not null,
        "entity_id" text null,
        "nip" text not null,
        "country_code" text not null default 'PL',
        "source" text not null default 'whitelist',
        "state" text not null default 'unavailable',
        "status_vat" text null,
        "name" text null,
        "address" text null,
        "bank_accounts" jsonb null,
        "requested_by" text null,
        "customer_id" text null,
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "whitelist_check_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_whitelist_check_nip_created" on "whitelist_check" ("nip", "created_at") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_whitelist_check_customer" on "whitelist_check" ("customer_id") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "whitelist_check" cascade;`)
    this.addSql(`drop table if exists "whitelist_entity" cascade;`)
  }
}
