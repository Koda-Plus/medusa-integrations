import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * InPost returns (0.4.0): the table of the returns created on the InPost
 * Returns API. Idempotent (`if not exists`).
 *
 * The name is this plugin's own (`inpost_parcel_return`): another InPost
 * plugin for Medusa keeps a returns table of another shape under a shorter
 * name, and `create table if not exists` must never adopt it.
 *
 * The unique index on (order_id, return_key, demo) is the lock of the
 * one-return-per-return rule: the database refuses a second row, so a second
 * InPost return, for one Medusa return (or, with return_key "-", for the
 * return a person created for the order).
 */
export class Migration20261106120000_inpost_returns extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "inpost_parcel_return" (
        "id" text not null,
        "order_id" text not null,
        "display_id" integer null,
        "return_id" text null,
        "return_key" text not null,
        "demo" boolean not null default false,
        "state" text not null default 'pending',
        "method" text null,
        "reference" text null,
        "plan_hash" text null,
        "shipment_id" text null,
        "inpost_parcel_id" text null,
        "tracking_number" text null,
        "short_number" text null,
        "drop_off_code" text null,
        "has_label" boolean not null default false,
        "expires_at" timestamptz null,
        "skip_reason" text null,
        "error" text null,
        "error_code" text null,
        "attempts" integer not null default 0,
        "claim_token" text null,
        "claimed_at" timestamptz null,
        "lease_until" timestamptz null,
        "created_by" text null,
        "shipment_created_at" timestamptz null,
        "last_checked_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "inpost_parcel_return_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_inpost_parcel_return_order_id_return_key_demo_unique" on "inpost_parcel_return" ("order_id", "return_key", "demo") where "deleted_at" is null;`,
    )
    this.addSql(`create index if not exists "IDX_inpost_parcel_return_state_demo" on "inpost_parcel_return" ("state", "demo") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_inpost_parcel_return_return_id" on "inpost_parcel_return" ("return_id") where "return_id" is not null and "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_inpost_parcel_return_deleted_at" on "inpost_parcel_return" ("deleted_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "inpost_parcel_return" cascade;`)
  }
}
