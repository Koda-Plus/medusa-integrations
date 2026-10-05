import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * 0.2.0: statistics and category on the advert snapshot, alerts, the plan
 * rows of the lifecycle and price writers, publications, writer runs, message
 * threads and the small state table. Idempotent (`if not exists`), so a re-run
 * is a no-op.
 */
export class Migration20261006090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table if exists "olx_advert" add column if not exists "category_id" integer null;`)
    this.addSql(`alter table if exists "olx_advert" add column if not exists "stats_views" integer null;`)
    this.addSql(`alter table if exists "olx_advert" add column if not exists "stats_phone_views" integer null;`)
    this.addSql(`alter table if exists "olx_advert" add column if not exists "stats_observers" integer null;`)
    this.addSql(`alter table if exists "olx_advert" add column if not exists "stats_at" timestamptz null;`)

    this.addSql(`
      create table if not exists "olx_alert" (
        "id" text not null,
        "key" text not null,
        "kind" text not null,
        "variant_id" text not null,
        "product_id" text not null,
        "sku" text null,
        "product_title" text null,
        "olx_id" text null,
        "advert_title" text null,
        "advert_url" text null,
        "advert_status" text null,
        "stock" integer null,
        "product_status" text null,
        "first_seen_at" timestamptz not null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "olx_alert_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_olx_alert_key_demo_unique" on "olx_alert" ("key", "demo") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_olx_alert_kind" on "olx_alert" ("kind") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_olx_alert_product_id" on "olx_alert" ("product_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_olx_alert_deleted_at" on "olx_alert" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "olx_plan_item" (
        "id" text not null,
        "writer" text not null,
        "olx_id" text not null,
        "action" text not null,
        "reason" text null,
        "from_value" jsonb null,
        "to_value" jsonb null,
        "approved_value" jsonb null,
        "state" text not null default 'pending',
        "attempts" integer not null default 0,
        "last_error" text null,
        "note" text null,
        "planned_at" timestamptz null,
        "last_attempt_at" timestamptz null,
        "done_at" timestamptz null,
        "paused_at" timestamptz null,
        "unknown_since" timestamptz null,
        "claim_token" text null,
        "lease_until" timestamptz null,
        "title" text null,
        "variant_id" text null,
        "product_id" text null,
        "sku" text null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "olx_plan_item_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_olx_plan_item_writer_olx_id_demo_unique" on "olx_plan_item" ("writer", "olx_id", "demo") where deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_olx_plan_item_state" on "olx_plan_item" ("state") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_olx_plan_item_product_id" on "olx_plan_item" ("product_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_olx_plan_item_deleted_at" on "olx_plan_item" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "olx_publication" (
        "id" text not null,
        "variant_id" text not null,
        "product_id" text not null,
        "sku" text not null,
        "title" text not null,
        "olx_category_id" integer null,
        "state" text not null,
        "payload" jsonb null,
        "missing" jsonb null,
        "warnings" jsonb null,
        "attempts" integer not null default 0,
        "last_error" text null,
        "note" text null,
        "planned_at" timestamptz null,
        "last_attempt_at" timestamptz null,
        "unknown_since" timestamptz null,
        "claim_token" text null,
        "lease_until" timestamptz null,
        "olx_id" text null,
        "olx_url" text null,
        "olx_status" text null,
        "adopted" boolean not null default false,
        "published_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "olx_publication_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_olx_publication_variant_id_demo_unique" on "olx_publication" ("variant_id", "demo") where deleted_at is null;`,
    )
    this.addSql(`create index if not exists "IDX_olx_publication_state" on "olx_publication" ("state") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_olx_publication_product_id" on "olx_publication" ("product_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_olx_publication_deleted_at" on "olx_publication" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "olx_writer_run" (
        "id" text not null,
        "writer" text not null,
        "mode" text not null,
        "trigger" text not null,
        "status" text not null,
        "planned" integer not null default 0,
        "attempted" integer not null default 0,
        "succeeded" integer not null default 0,
        "failed" integer not null default 0,
        "quarantined" integer not null default 0,
        "unknown" integer not null default 0,
        "skipped" integer not null default 0,
        "message" text null,
        "items" jsonb null,
        "actor" text null,
        "duration_ms" integer not null default 0,
        "started_at" timestamptz not null,
        "finished_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "olx_writer_run_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_olx_writer_run_writer" on "olx_writer_run" ("writer", "started_at") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_olx_writer_run_deleted_at" on "olx_writer_run" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "olx_thread" (
        "id" text not null,
        "thread_key" text not null,
        "advert_olx_id" text null,
        "unread_count" integer not null default 0,
        "total_count" integer not null default 0,
        "olx_created_at" timestamptz null,
        "is_favourite" boolean not null default false,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "olx_thread_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_olx_thread_key_demo_unique" on "olx_thread" ("thread_key", "demo") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_olx_thread_advert_olx_id" on "olx_thread" ("advert_olx_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_olx_thread_deleted_at" on "olx_thread" ("deleted_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "olx_state" (
        "id" text not null,
        "value" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "olx_state_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_olx_state_deleted_at" on "olx_state" ("deleted_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "olx_state" cascade;`)
    this.addSql(`drop table if exists "olx_thread" cascade;`)
    this.addSql(`drop table if exists "olx_writer_run" cascade;`)
    this.addSql(`drop table if exists "olx_publication" cascade;`)
    this.addSql(`drop table if exists "olx_plan_item" cascade;`)
    this.addSql(`drop table if exists "olx_alert" cascade;`)
    this.addSql(`alter table if exists "olx_advert" drop column if exists "stats_at";`)
    this.addSql(`alter table if exists "olx_advert" drop column if exists "stats_observers";`)
    this.addSql(`alter table if exists "olx_advert" drop column if exists "stats_phone_views";`)
    this.addSql(`alter table if exists "olx_advert" drop column if exists "stats_views";`)
    this.addSql(`alter table if exists "olx_advert" drop column if exists "category_id";`)
  }
}
