import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * 0.2: writers, plans, order imports, the outbox, customer issues and small
 * named state, plus the refresh lease of the connection and two run columns.
 * Idempotent (`if not exists`), additive and nullable or defaulted: a re-run
 * is a no-op and nothing of 0.1 changes meaning.
 */
export class Migration20261006093000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table if exists "allegro_connection" add column if not exists "refresh_lease_until" timestamptz null;`)
    this.addSql(`alter table if exists "allegro_connection" add column if not exists "refresh_lease_owner" text null;`)
    this.addSql(`alter table if exists "allegro_sync_run" add column if not exists "dry_run" boolean not null default false;`)
    this.addSql(`alter table if exists "allegro_sync_run" add column if not exists "details" jsonb null;`)

    this.addSql(`
      create table if not exists "allegro_writer" (
        "id" text not null,
        "armed" boolean not null default false,
        "mode" text null,
        "changed_by" text null,
        "changed_by_id" text null,
        "changed_at" timestamptz null,
        "failure_streak" integer not null default 0,
        "last_failure" text null,
        "last_failure_at" timestamptz null,
        "tripped_at" timestamptz null,
        "trip_reason" text null,
        "last_run_at" timestamptz null,
        "last_success_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "allegro_writer_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_allegro_writer_deleted_at" on "allegro_writer" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "allegro_plan_item" (
        "id" text not null,
        "kind" text not null,
        "target_key" text not null,
        "allegro_id" text null,
        "variant_id" text null,
        "product_id" text null,
        "sku" text null,
        "title" text null,
        "action" text not null,
        "reason" text not null,
        "status" text not null,
        "current" jsonb null,
        "target" jsonb null,
        "failures" integer not null default 0,
        "last_error" text null,
        "command_id" text null,
        "planned_at" timestamptz null,
        "applied_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "allegro_plan_item_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_allegro_plan_item_kind_target_key_unique" on "allegro_plan_item" ("kind", "target_key") where deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_allegro_plan_item_kind_status" on "allegro_plan_item" ("kind", "status") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_allegro_plan_item_deleted_at" on "allegro_plan_item" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "allegro_order_import" (
        "id" text not null,
        "checkout_form_id" text not null,
        "status" text not null,
        "source" text not null,
        "reason_code" text null,
        "reason" text null,
        "order_id" text null,
        "display_id" integer null,
        "allegro_status" text null,
        "fulfillment_status" text null,
        "payment_type" text null,
        "paid" boolean not null default false,
        "total" jsonb null,
        "medusa_total" jsonb null,
        "total_mismatch" boolean not null default false,
        "line_count" integer not null default 0,
        "bought_at" timestamptz null,
        "last_event_id" text null,
        "last_event_type" text null,
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "claim_token" text null,
        "lease_until" timestamptz null,
        "attention" text null,
        "cancel_requested" boolean not null default false,
        "refresh_requested" boolean not null default false,
        "cancelled_on_allegro_at" timestamptz null,
        "imported_at" timestamptz null,
        "details" jsonb null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "allegro_order_import_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_allegro_order_import_checkout_form_id_unique" on "allegro_order_import" ("checkout_form_id") where deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_allegro_order_import_status" on "allegro_order_import" ("status") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_allegro_order_import_order_id" on "allegro_order_import" ("order_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_allegro_order_import_deleted_at" on "allegro_order_import" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "allegro_outbox" (
        "id" text not null,
        "writer" text not null,
        "dedupe_key" text not null,
        "checkout_form_id" text not null,
        "order_id" text null,
        "payload" jsonb null,
        "status" text not null,
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "claim_token" text null,
        "lease_until" timestamptz null,
        "last_error" text null,
        "result" jsonb null,
        "done_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "allegro_outbox_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_allegro_outbox_dedupe_key_unique" on "allegro_outbox" ("dedupe_key") where deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_allegro_outbox_writer_status" on "allegro_outbox" ("writer", "status") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_allegro_outbox_checkout_form_id" on "allegro_outbox" ("checkout_form_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_allegro_outbox_deleted_at" on "allegro_outbox" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "allegro_issue" (
        "id" text not null,
        "kind" text not null,
        "allegro_id" text not null,
        "checkout_form_id" text null,
        "status" text not null,
        "reason_code" text null,
        "reference_number" text null,
        "opened_at" timestamptz null,
        "due_at" timestamptz null,
        "needs_reply" boolean not null default false,
        "is_open" boolean not null default true,
        "items" integer not null default 0,
        "last_message_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "allegro_issue_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_allegro_issue_kind_allegro_id_unique" on "allegro_issue" ("kind", "allegro_id") where deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_allegro_issue_checkout_form_id" on "allegro_issue" ("checkout_form_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_allegro_issue_deleted_at" on "allegro_issue" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "allegro_state" (
        "id" text not null,
        "value" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "allegro_state_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_allegro_state_deleted_at" on "allegro_state" ("deleted_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "allegro_state" cascade;`)
    this.addSql(`drop table if exists "allegro_issue" cascade;`)
    this.addSql(`drop table if exists "allegro_outbox" cascade;`)
    this.addSql(`drop table if exists "allegro_order_import" cascade;`)
    this.addSql(`drop table if exists "allegro_plan_item" cascade;`)
    this.addSql(`drop table if exists "allegro_writer" cascade;`)
    this.addSql(`alter table if exists "allegro_sync_run" drop column if exists "details";`)
    this.addSql(`alter table if exists "allegro_sync_run" drop column if exists "dry_run";`)
    this.addSql(`alter table if exists "allegro_connection" drop column if exists "refresh_lease_owner";`)
    this.addSql(`alter table if exists "allegro_connection" drop column if exists "refresh_lease_until";`)
  }
}
