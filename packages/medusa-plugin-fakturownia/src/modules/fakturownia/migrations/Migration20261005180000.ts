import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the Fakturownia module. Idempotent (`if not exists`), so a re-run
 * on a database that already has them is a no-op.
 *
 * The two unique indexes are the first lock of the exactly-once rule: the
 * database itself refuses a second document of one kind for an order, and a
 * second final document (VAT invoice or receipt) of any kind.
 */
export class Migration20261005180000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "fakturownia_document" (
        "id" text not null,
        "order_id" text not null,
        "display_id" integer null,
        "kind" text not null,
        "status" text not null default 'pending',
        "demo" boolean not null default false,
        "fakturownia_id" text null,
        "number" text null,
        "oid" text null,
        "issue_date" text null,
        "currency" text null,
        "total_gross" numeric(14, 2) null,
        "positions" jsonb null,
        "buyer_type" text null,
        "from_fakturownia_id" text null,
        "paid" boolean not null default false,
        "paid_at" timestamptz null,
        "pay_requested_at" timestamptz null,
        "gov_status" text null,
        "gov_id" text null,
        "gov_error" text null,
        "gov_checked_at" timestamptz null,
        "error" text null,
        "error_code" text null,
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "claim_token" text null,
        "claimed_at" timestamptz null,
        "lease_until" timestamptz null,
        "issued_at" timestamptz null,
        "cancel_requested_at" timestamptz null,
        "email_status" text null,
        "emailed_at" timestamptz null,
        "email_error" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "fakturownia_document_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_fakturownia_document_order_id_kind_demo_unique" on "fakturownia_document" ("order_id", "kind", "demo") where deleted_at is null;`,
    )
    this.addSql(
      `create unique index if not exists "IDX_fakturownia_document_order_id_demo_final_unique" on "fakturownia_document" ("order_id", "demo") where "kind" in ('vat', 'receipt') and deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_fakturownia_document_status_next_attempt_at" on "fakturownia_document" ("status", "next_attempt_at") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_fakturownia_document_fakturownia_id" on "fakturownia_document" ("fakturownia_id") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_fakturownia_document_issued_at" on "fakturownia_document" ("issued_at") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_fakturownia_document_deleted_at" on "fakturownia_document" ("deleted_at") where "deleted_at" is null;`,
    )

    this.addSql(`
      create table if not exists "fakturownia_sync_run" (
        "id" text not null,
        "kind" text not null,
        "source" text not null,
        "trigger" text not null,
        "status" text not null,
        "complete" boolean not null default false,
        "counts" jsonb null,
        "message" text null,
        "duration_ms" integer not null default 0,
        "started_at" timestamptz not null,
        "finished_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "fakturownia_sync_run_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_fakturownia_sync_run_kind_started_at" on "fakturownia_sync_run" ("kind", "started_at") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_fakturownia_sync_run_deleted_at" on "fakturownia_sync_run" ("deleted_at") where "deleted_at" is null;`,
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "fakturownia_sync_run" cascade;`)
    this.addSql(`drop table if exists "fakturownia_document" cascade;`)
  }
}
