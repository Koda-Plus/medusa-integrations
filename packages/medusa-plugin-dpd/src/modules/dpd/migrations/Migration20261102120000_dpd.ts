import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the DPD module. Idempotent (`if not exists`), so a re-run on a
 * database that already has them is a no-op. The name carries the namespace
 * suffix: Medusa records migrations by name in one shared table, so the name
 * must be unique across every package of the repository.
 *
 * The unique index on (fulfillment_id, kind, mode) is the first lock of the
 * exactly-once rule: the database refuses a second row, so a second DPD
 * shipment, for one fulfillment. The unique `dedupe_key` of the events keeps
 * a status read twice one row. Amounts are integers in minor units.
 *
 * Every index is scoped to the rows not deleted, as the models declare them
 * (Medusa's data model adds `deleted_at IS NULL` to an index without it), so
 * the database, the models and the `on conflict` targets of lib/store.ts
 * agree: one setting per key among the live rows.
 *
 * `references` is a reserved word in SQL: the column is always quoted.
 */
export class Migration20261102120000_dpd extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "dpd_shipment" (
        "id" text not null,
        "order_id" text null,
        "display_id" integer null,
        "fulfillment_id" text null,
        "return_id" text null,
        "kind" text not null default 'outbound',
        "mode" text not null,
        "option_id" text not null,
        "service" text null,
        "pudo_id" text null,
        "country_code" text null,
        "session_type" text null,
        "cod_minor" integer null,
        "currency" text null,
        "reference" text null,
        "references" jsonb null,
        "boxes" jsonb null,
        "waybills" jsonb null,
        "session_id" text null,
        "state" text not null default 'pending',
        "status" text null,
        "stage" text null,
        "plan_hash" text null,
        "problems" jsonb null,
        "dispatch_id" text null,
        "handed_over_at" timestamptz null,
        "claim_token" text null,
        "lease_until" timestamptz null,
        "shipped_marked_at" timestamptz null,
        "delivered_marked_at" timestamptz null,
        "last_checked_at" timestamptz null,
        "error" text null,
        "error_code" text null,
        "attempts" integer not null default 0,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "dpd_shipment_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_dpd_shipment_fulfillment_id_kind_mode_unique" on "dpd_shipment" ("fulfillment_id", "kind", "mode") where "fulfillment_id" is not null and "deleted_at" is null;`,
    )
    this.addSql(`create index if not exists "IDX_dpd_shipment_order_id_mode" on "dpd_shipment" ("order_id", "mode") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_shipment_state_mode" on "dpd_shipment" ("state", "mode") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_shipment_return_id" on "dpd_shipment" ("return_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_shipment_dispatch_id" on "dpd_shipment" ("dispatch_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_shipment_mode_last_checked_at" on "dpd_shipment" ("mode", "last_checked_at") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_shipment_deleted_at" on "dpd_shipment" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "dpd_document" (
        "id" text not null,
        "shipment_id" text null,
        "dispatch_id" text null,
        "type" text not null,
        "format" text not null default 'PDF',
        "page" text null,
        "document_id" text null,
        "data" text not null,
        "mode" text not null,
        "created_by" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "dpd_document_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_dpd_document_shipment_id_type" on "dpd_document" ("shipment_id", "type") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_document_dispatch_id" on "dpd_document" ("dispatch_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_document_mode_created_at" on "dpd_document" ("mode", "created_at") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_document_deleted_at" on "dpd_document" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "dpd_event" (
        "id" text not null,
        "shipment_id" text null,
        "dispatch_id" text null,
        "order_id" text null,
        "waybill" text null,
        "kind" text not null,
        "status" text null,
        "previous_status" text null,
        "source" text null,
        "message" text null,
        "data" jsonb null,
        "actor" text null,
        "dedupe_key" text null,
        "object_id" text null,
        "mode" text not null,
        "occurred_at" timestamptz not null default now(),
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "dpd_event_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_dpd_event_dedupe_key_unique" on "dpd_event" ("dedupe_key") where "dedupe_key" is not null and "deleted_at" is null;`,
    )
    this.addSql(`create index if not exists "IDX_dpd_event_shipment_id_occurred_at" on "dpd_event" ("shipment_id", "occurred_at") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_event_object_id" on "dpd_event" ("object_id") where "object_id" is not null and "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_event_kind_mode_occurred_at" on "dpd_event" ("kind", "mode", "occurred_at") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_event_deleted_at" on "dpd_event" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "dpd_dispatch" (
        "id" text not null,
        "mode" text not null,
        "state" text not null default 'pending',
        "shipment_ids" jsonb null,
        "protocols" jsonb null,
        "pickup_date" text null,
        "pickup_time_from" text null,
        "pickup_time_to" text null,
        "order_type" text null,
        "order_number" text null,
        "check_sum" text null,
        "claim_token" text null,
        "lease_until" timestamptz null,
        "error" text null,
        "error_code" text null,
        "created_by" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "dpd_dispatch_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_dpd_dispatch_state_mode" on "dpd_dispatch" ("state", "mode") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_dispatch_order_number" on "dpd_dispatch" ("order_number") where "order_number" is not null and "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_dispatch_deleted_at" on "dpd_dispatch" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "dpd_setting" (
        "id" text not null,
        "key" text not null,
        "value" jsonb null,
        "updated_by" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "dpd_setting_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_dpd_setting_key_unique" on "dpd_setting" ("key") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_dpd_setting_deleted_at" on "dpd_setting" ("deleted_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "dpd_setting" cascade;`)
    this.addSql(`drop table if exists "dpd_dispatch" cascade;`)
    this.addSql(`drop table if exists "dpd_event" cascade;`)
    this.addSql(`drop table if exists "dpd_document" cascade;`)
    this.addSql(`drop table if exists "dpd_shipment" cascade;`)
  }
}
