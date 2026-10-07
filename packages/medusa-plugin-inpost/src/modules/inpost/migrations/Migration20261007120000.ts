import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the InPost module. Idempotent (`if not exists`), so a re-run on a
 * database that already has them is a no-op.
 *
 * The names are this plugin's own (`inpost_parcel`, `inpost_parcel_event`,
 * `inpost_setting`): another InPost plugin for Medusa keeps `inpost_shipment`
 * and `inpost_return`, and `create table if not exists` must never adopt a
 * table of another plugin with other columns.
 *
 * The unique index on (fulfillment_id, demo) is the first lock of the
 * exactly-once rule: the database refuses a second row, so a second shipment,
 * for one fulfillment. The unique `dedupe_key` of the events keeps the
 * webhook idempotent.
 */
export class Migration20261007120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "inpost_parcel" (
        "id" text not null,
        "order_id" text not null,
        "display_id" integer null,
        "fulfillment_id" text null,
        "demo" boolean not null default false,
        "option_id" text not null,
        "kind" text not null,
        "cod" boolean not null default false,
        "service" text not null,
        "locker_code" text null,
        "locker_name" text null,
        "locker_address" jsonb null,
        "parcel_size" text null,
        "parcel_no" integer not null default 1,
        "cod_minor" integer null,
        "currency" text null,
        "reference" text null,
        "state" text not null default 'pending',
        "status" text null,
        "status_at" timestamptz null,
        "shipment_id" text null,
        "tracking_number" text null,
        "sending_method" text null,
        "plan_hash" text null,
        "problems" jsonb null,
        "skip_reason" text null,
        "external" boolean not null default false,
        "error" text null,
        "error_code" text null,
        "attempts" integer not null default 0,
        "claim_token" text null,
        "claimed_at" timestamptz null,
        "lease_until" timestamptz null,
        "created_by" text null,
        "shipment_created_at" timestamptz null,
        "offer" jsonb null,
        "buy_requested_at" timestamptz null,
        "dispatch_state" text null,
        "dispatch_order_id" text null,
        "dispatch_error" text null,
        "dispatch_at" timestamptz null,
        "fulfillment_canceled_at" timestamptz null,
        "shipped_marked_at" timestamptz null,
        "delivered_marked_at" timestamptz null,
        "status_writer_error" text null,
        "last_checked_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "inpost_parcel_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_inpost_parcel_fulfillment_id_demo_unique" on "inpost_parcel" ("fulfillment_id", "demo") where "fulfillment_id" is not null and "deleted_at" is null;`,
    )
    this.addSql(`create index if not exists "IDX_inpost_parcel_order_id_demo" on "inpost_parcel" ("order_id", "demo") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_inpost_parcel_state_demo" on "inpost_parcel" ("state", "demo") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_inpost_parcel_shipment_id" on "inpost_parcel" ("shipment_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_inpost_parcel_demo_last_checked_at" on "inpost_parcel" ("demo", "last_checked_at") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_inpost_parcel_deleted_at" on "inpost_parcel" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "inpost_parcel_event" (
        "id" text not null,
        "parcel_id" text null,
        "order_id" text null,
        "shipment_id" text null,
        "kind" text not null,
        "status" text null,
        "previous_status" text null,
        "source" text null,
        "message" text null,
        "data" jsonb null,
        "actor" text null,
        "dedupe_key" text null,
        "demo" boolean not null default false,
        "occurred_at" timestamptz not null default now(),
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "inpost_parcel_event_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_inpost_parcel_event_dedupe_key_unique" on "inpost_parcel_event" ("dedupe_key") where "dedupe_key" is not null and "deleted_at" is null;`,
    )
    this.addSql(`create index if not exists "IDX_inpost_parcel_event_parcel_id_occurred_at" on "inpost_parcel_event" ("parcel_id", "occurred_at") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_inpost_parcel_event_kind_demo_occurred_at" on "inpost_parcel_event" ("kind", "demo", "occurred_at") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_inpost_parcel_event_deleted_at" on "inpost_parcel_event" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "inpost_setting" (
        "id" text not null,
        "key" text not null,
        "value" jsonb null,
        "updated_by" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "inpost_setting_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_inpost_setting_key_unique" on "inpost_setting" ("key");`)
    this.addSql(`create index if not exists "IDX_inpost_setting_deleted_at" on "inpost_setting" ("deleted_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "inpost_setting" cascade;`)
    this.addSql(`drop table if exists "inpost_parcel_event" cascade;`)
    this.addSql(`drop table if exists "inpost_parcel" cascade;`)
  }
}
