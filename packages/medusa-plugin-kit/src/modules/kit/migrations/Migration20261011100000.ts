import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The tables of the Kit module: the subscription log and the settings.
 * Idempotent: `if not exists` everywhere.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES: Medusa records executed
 * migrations by name alone.
 */
export class Migration20261011100000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "kit_subscriber_log" (
      "id" text not null primary key,
      "email" text not null,
      "first_name" text null,
      "kit_subscriber_id" integer null,
      "state" text null,
      "tags" jsonb null,
      "source" text null,
      "status" text not null default 'ok',
      "error" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null
    );`)
    this.addSql(`create index if not exists "IDX_kit_subscriber_log_email" on "kit_subscriber_log" ("email") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_kit_subscriber_log_created_at" on "kit_subscriber_log" ("created_at") where "deleted_at" is null;`)
    this.addSql(`create table if not exists "kit_setting" (
      "id" text not null primary key,
      "key" text not null,
      "value" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null
    );`)
    this.addSql(`create unique index if not exists "IDX_kit_setting_key_unique" on "kit_setting" ("key") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "kit_subscriber_log" cascade;`)
    this.addSql(`drop table if exists "kit_setting" cascade;`)
  }
}
