import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the Subiekt nexo module. Idempotent (`if not exists`), so a re-run
 * on a database that already has them is a no-op.
 */
export class Migration20261004180000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "subiekt_connection" (
        "id" text not null,
        "reachable" boolean not null default false,
        "health" jsonb null,
        "checked_at" timestamptz null,
        "last_error" text null,
        "last_error_at" timestamptz null,
        "consecutive_failures" integer not null default 0,
        "events_cursor" text null,
        "events_read_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "subiekt_connection_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_subiekt_connection_deleted_at" on "subiekt_connection" ("deleted_at") where "deleted_at" is null;`,
    )

    this.addSql(`
      create table if not exists "subiekt_task" (
        "id" text not null,
        "kind" text not null,
        "order_id" text not null,
        "display_id" integer null,
        "reference" text null,
        "status" text not null,
        "trigger" text not null,
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "started_at" timestamptz null,
        "succeeded_at" timestamptz null,
        "last_error" text null,
        "last_error_code" text null,
        "result" jsonb null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "subiekt_task_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_subiekt_task_kind_order_reference" on "subiekt_task" ("kind", "order_id", coalesce("reference", ''), "demo") where "deleted_at" is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_subiekt_task_status_due" on "subiekt_task" ("status", "next_attempt_at") where "deleted_at" is null;`,
    )
    this.addSql(`create index if not exists "IDX_subiekt_task_order_id" on "subiekt_task" ("order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_subiekt_task_deleted_at" on "subiekt_task" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "subiekt_document" (
        "id" text not null,
        "order_id" text null,
        "display_id" integer null,
        "kind" text not null,
        "number" text not null,
        "subiekt_id" text null,
        "status" text not null default 'open',
        "issued_at" timestamptz null,
        "source" text not null,
        "warehouse" text null,
        "related" jsonb null,
        "event_id" text null,
        "applied_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "subiekt_document_pkey" primary key ("id")
      );
    `)
    this.addSql(`drop index if exists "IDX_subiekt_document_kind_number_demo";`)
    this.addSql(
      `create unique index if not exists "IDX_subiekt_document_kind_number_order" on "subiekt_document" ("kind", "number", "demo", coalesce("order_id", '')) where "deleted_at" is null;`,
    )
    this.addSql(`create index if not exists "IDX_subiekt_document_order_id" on "subiekt_document" ("order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_subiekt_document_deleted_at" on "subiekt_document" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "subiekt_sync_run" (
        "id" text not null,
        "kind" text not null,
        "trigger" text not null,
        "status" text not null,
        "dry_run" boolean not null default false,
        "message" text null,
        "stats" jsonb null,
        "started_at" timestamptz not null,
        "finished_at" timestamptz null,
        "duration_ms" integer not null default 0,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "subiekt_sync_run_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_subiekt_sync_run_kind_started" on "subiekt_sync_run" ("kind", "started_at") where "deleted_at" is null;`,
    )
    this.addSql(`create index if not exists "IDX_subiekt_sync_run_deleted_at" on "subiekt_sync_run" ("deleted_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "subiekt_sync_run" cascade;`)
    this.addSql(`drop table if exists "subiekt_document" cascade;`)
    this.addSql(`drop table if exists "subiekt_task" cascade;`)
    this.addSql(`drop table if exists "subiekt_connection" cascade;`)
  }
}
