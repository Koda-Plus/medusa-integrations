import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the Loyalty module, with the names of the original app module,
 * so the rows carry over. Idempotent: `if not exists` and
 * `add column if not exists`, a re-run changes nothing.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES AND THE DEMO STORE:
 * Medusa records executed migrations by name alone.
 */
export class Migration20261009080000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "loyalty_account" (
        "id" text not null,
        "customer_id" text not null,
        "customer_email" text null,
        "customer_name" text null,
        "balance" integer not null default 0,
        "total_earned" integer not null default 0,
        "total_redeemed" integer not null default 0,
        "tier_multiplier" integer not null default 1,
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "loyalty_account_pkey" primary key ("id")
      );
    `)
    this.addSql(`alter table if exists "loyalty_account" add column if not exists "customer_email" text null;`)
    this.addSql(`alter table if exists "loyalty_account" add column if not exists "customer_name" text null;`)
    this.addSql(`alter table if exists "loyalty_account" add column if not exists "demo" boolean not null default false;`)
    this.addSql(`create unique index if not exists "IDX_loyalty_account_customer_unique" on "loyalty_account" ("customer_id") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "loyalty_transaction" (
        "id" text not null,
        "account_id" text not null,
        "delta" integer not null,
        "kind" text not null default 'earn_order',
        "reason" text null,
        "order_id" text null,
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "loyalty_transaction_pkey" primary key ("id"),
        constraint "FK_loyalty_tx_account" foreign key ("account_id") references "loyalty_account" ("id") on delete cascade
      );
    `)
    this.addSql(`alter table if exists "loyalty_transaction" add column if not exists "demo" boolean not null default false;`)
    this.addSql(`create index if not exists "IDX_loyalty_transaction_account" on "loyalty_transaction" ("account_id");`)
    this.addSql(`create index if not exists "IDX_loyalty_transaction_order" on "loyalty_transaction" ("order_id");`)
  }

  async down(): Promise<void> {
    /* The tables may be older than this migration: they stay. */
  }
}
