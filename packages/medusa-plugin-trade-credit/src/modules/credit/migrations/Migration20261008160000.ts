import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the Trade Credit module. Idempotent: `if not exists` everywhere,
 * so a second run changes nothing.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES AND THE DEMO STORE:
 * Medusa records executed migrations by name alone.
 */
export class Migration20261008160000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "credit_limit" (
        "id" text not null,
        "customer_id" text not null,
        "customer_email" text null,
        "customer_name" text null,
        "currency_code" text not null default 'pln',
        "limit_amount" integer not null default 0,
        "used_amount" integer not null default 0,
        "net_days" integer not null default 0,
        "status" text not null default 'active',
        "blocked" boolean not null default false,
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "credit_limit_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_credit_limit_customer_unique" on "credit_limit" ("customer_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_credit_limit_blocked" on "credit_limit" ("blocked") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "credit_order" (
        "id" text not null,
        "order_id" text not null,
        "display_id" integer null,
        "customer_id" text not null,
        "currency_code" text not null default 'pln',
        "total_amount" integer not null default 0,
        "net_days" integer not null default 0,
        "due_at" timestamptz not null default now(),
        "paid_at" timestamptz null,
        "state" text not null default 'open',
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "credit_order_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_credit_order_order_unique" on "credit_order" ("order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_credit_order_customer_state" on "credit_order" ("customer_id", "state") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_credit_order_state_due" on "credit_order" ("state", "due_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "credit_order" cascade;`)
    this.addSql(`drop table if exists "credit_limit" cascade;`)
  }
}
