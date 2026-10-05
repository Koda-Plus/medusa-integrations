import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Version 0.2.0: corrections, the e-mail and KSeF histories, the writer
 * toggles, and the new columns of the document outbox. Idempotent (`if not
 * exists` everywhere), so a re-run is a no-op.
 *
 * THE ONE CHANGE TO AN EXISTING INDEX: corrections live in the outbox too,
 * and an order may have many, so the unique index on (order_id, kind, demo)
 * is rebuilt without them (a new name, then the old one dropped), and a
 * correction gets its own unique key: (order_id, source_key, demo).
 */
export class Migration20261006092000 extends Migration {
  async up(): Promise<void> {
    const columns: Array<[string, string]> = [
      ["source_key", "text null"],
      ["corrects_document_id", "text null"],
      ["plan_id", "text null"],
      ["order_version", "integer null"],
      ["buyer_warning", "jsonb null"],
      ["gov_send_date", "timestamptz null"],
      ["gov_verification_link", "text null"],
      ["gov_link", "text null"],
      ["gov_corrected_number", "text null"],
      ["gov_errors", "jsonb null"],
      ["ksef_resend_at", "timestamptz null"],
      ["corrections_checked_at", "timestamptz null"],
    ]
    for (const [name, type] of columns) {
      this.addSql(`alter table if exists "fakturownia_document" add column if not exists "${name}" ${type};`)
    }

    this.addSql(
      `create unique index if not exists "IDX_fakturownia_document_order_kind_demo_unique" on "fakturownia_document" ("order_id", "kind", "demo") where "kind" <> 'correction' and deleted_at is null;`,
    )
    this.addSql(`drop index if exists "IDX_fakturownia_document_order_id_kind_demo_unique";`)
    this.addSql(
      `create unique index if not exists "IDX_fakturownia_document_correction_key_unique" on "fakturownia_document" ("order_id", "source_key", "demo") where "kind" = 'correction' and deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_fakturownia_document_corrects_document_id" on "fakturownia_document" ("corrects_document_id") where deleted_at is null;`,
    )

    this.addSql(`
      create table if not exists "fakturownia_correction" (
        "id" text not null,
        "order_id" text not null,
        "display_id" integer null,
        "document_id" text not null,
        "document_kind" text not null,
        "document_number" text null,
        "demo" boolean not null default false,
        "status" text not null default 'draft',
        "manual_reason" text null,
        "revision" integer not null default 1,
        "sources" jsonb null,
        "source_key" text null,
        "reasons" jsonb null,
        "reason" text null,
        "positions" jsonb null,
        "notes" jsonb null,
        "currency" text null,
        "delta_net" numeric(14, 2) null,
        "delta_vat" numeric(14, 2) null,
        "delta_gross" numeric(14, 2) null,
        "simulated" boolean not null default false,
        "correction_document_id" text null,
        "approved_by" text null,
        "approved_at" timestamptz null,
        "closed_by" text null,
        "closed_at" timestamptz null,
        "close_note" text null,
        "computed_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "fakturownia_correction_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_fakturownia_correction_open_unique" on "fakturownia_correction" ("document_id") where "status" in ('draft', 'manual') and deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_fakturownia_correction_order_id" on "fakturownia_correction" ("order_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_fakturownia_correction_demo_status" on "fakturownia_correction" ("demo", "status") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_fakturownia_correction_deleted_at" on "fakturownia_correction" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "fakturownia_email" (
        "id" text not null,
        "document_id" text not null,
        "order_id" text not null,
        "demo" boolean not null default false,
        "kind" text not null,
        "status" text not null,
        "recipient" text null,
        "cc" text null,
        "with_pdf" boolean not null default false,
        "subject" text null,
        "error" text null,
        "requested_by" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "fakturownia_email_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_fakturownia_email_document_created" on "fakturownia_email" ("document_id", "created_at") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_fakturownia_email_demo_created" on "fakturownia_email" ("demo", "created_at") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_fakturownia_email_deleted_at" on "fakturownia_email" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "fakturownia_ksef_event" (
        "id" text not null,
        "document_id" text not null,
        "order_id" text not null,
        "demo" boolean not null default false,
        "source" text not null,
        "gov_status" text null,
        "gov_id" text null,
        "errors" jsonb null,
        "requested_by" text null,
        "note" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "fakturownia_ksef_event_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_fakturownia_ksef_event_document_created" on "fakturownia_ksef_event" ("document_id", "created_at") where deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_fakturownia_ksef_event_deleted_at" on "fakturownia_ksef_event" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "fakturownia_setting" (
        "id" text not null,
        "key" text not null,
        "value" jsonb null,
        "updated_by" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "fakturownia_setting_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_fakturownia_setting_key_unique" on "fakturownia_setting" ("key");`)
    this.addSql(`create index if not exists "IDX_fakturownia_setting_deleted_at" on "fakturownia_setting" ("deleted_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "fakturownia_setting" cascade;`)
    this.addSql(`drop table if exists "fakturownia_ksef_event" cascade;`)
    this.addSql(`drop table if exists "fakturownia_email" cascade;`)
    this.addSql(`drop table if exists "fakturownia_correction" cascade;`)
    this.addSql(`drop index if exists "IDX_fakturownia_document_correction_key_unique";`)
    this.addSql(`drop index if exists "IDX_fakturownia_document_corrects_document_id";`)
    /* 0.1.0 knows no corrections, and its index allows one row per order and kind. */
    this.addSql(`delete from "fakturownia_document" where "kind" = 'correction';`)
    this.addSql(
      `create unique index if not exists "IDX_fakturownia_document_order_id_kind_demo_unique" on "fakturownia_document" ("order_id", "kind", "demo") where deleted_at is null;`,
    )
    this.addSql(`drop index if exists "IDX_fakturownia_document_order_kind_demo_unique";`)
  }
}
