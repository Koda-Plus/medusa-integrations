import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Version 0.1.0: the send log and the settings. Written by hand and
 * idempotent (`if not exists` everywhere), so a re-run is a no-op. The name
 * is unique across every Koda Plus package: Medusa records executed
 * migrations by name in one shared table.
 */
export class Migration20261007110000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "emails_message" (
        "id" text not null,
        "key" text not null,
        "template" text not null,
        "locale" text null,
        "demo" boolean not null default false,
        "kind" text not null default 'event',
        "status" text not null,
        "recipient" text null,
        "subject" text null,
        "trigger" text null,
        "resource_type" text null,
        "resource_id" text null,
        "order_id" text null,
        "notification_id" text null,
        "external_id" text null,
        "resend_key" text null,
        "rotation" integer not null default 0,
        "attempts" integer not null default 0,
        "error_code" text null,
        "error" text null,
        "retryable" boolean not null default false,
        "claim_token" text null,
        "lease_until" timestamptz null,
        "sent_at" timestamptz null,
        "requested_by" text null,
        "body_html" text null,
        "body_text" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "emails_message_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_emails_message_key_demo_unique" on "emails_message" ("key", "demo") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_emails_message_demo_created_at" on "emails_message" ("demo", "created_at") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_emails_message_template_demo_created_at" on "emails_message" ("template", "demo", "created_at") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_emails_message_order_id" on "emails_message" ("order_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_emails_message_status_demo" on "emails_message" ("status", "demo") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_emails_message_deleted_at" on "emails_message" ("deleted_at") where deleted_at is null;`)

    this.addSql(`
      create table if not exists "emails_setting" (
        "id" text not null,
        "key" text not null,
        "value" jsonb null,
        "updated_by" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "emails_setting_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_emails_setting_key_unique" on "emails_setting" ("key") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_emails_setting_deleted_at" on "emails_setting" ("deleted_at") where deleted_at is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "emails_message" cascade;`)
    this.addSql(`drop table if exists "emails_setting" cascade;`)
  }
}
