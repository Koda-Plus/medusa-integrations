import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the OLX module. Idempotent (`if not exists`), so a re-run on a
 * database that already has them is a no-op.
 */
export class Migration20261004120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "olx_connection" (
        "id" text not null,
        "refresh_token_enc" text null,
        "access_token_enc" text null,
        "access_expires_at" timestamptz null,
        "refreshed_at" timestamptz null,
        "connected_at" timestamptz null,
        "disconnected_at" timestamptz null,
        "scope" text null,
        "state" text null,
        "state_expires_at" timestamptz null,
        "last_error" text null,
        "last_error_at" timestamptz null,
        "version" integer not null default 0,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "olx_connection_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_olx_connection_deleted_at" on "olx_connection" ("deleted_at") where "deleted_at" is null;`,
    )

    this.addSql(`
      create table if not exists "olx_advert" (
        "id" text not null,
        "olx_id" text not null,
        "title" text not null,
        "url" text not null,
        "status" text not null,
        "external_id" text null,
        "description_sku" text null,
        "match_key" text null,
        "match_source" text null,
        "variant_id" text null,
        "product_id" text null,
        "sku" text null,
        "product_title" text null,
        "is_primary" boolean not null default false,
        "price" jsonb null,
        "valid_to" timestamptz null,
        "olx_created_at" timestamptz null,
        "demo" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "olx_advert_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_olx_advert_olx_id_unique" on "olx_advert" ("olx_id") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_olx_advert_variant_id" on "olx_advert" ("variant_id") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_olx_advert_product_id" on "olx_advert" ("product_id") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_olx_advert_deleted_at" on "olx_advert" ("deleted_at") where "deleted_at" is null;`,
    )

    this.addSql(`
      create table if not exists "olx_sync_run" (
        "id" text not null,
        "source" text not null,
        "trigger" text not null,
        "status" text not null,
        "complete" boolean not null default false,
        "pages" integer not null default 0,
        "adverts" integer not null default 0,
        "statuses" jsonb null,
        "linked" integer not null default 0,
        "linked_live" integer not null default 0,
        "unmatched_live" integer not null default 0,
        "created_count" integer not null default 0,
        "updated_count" integer not null default 0,
        "removed_count" integer not null default 0,
        "message" text null,
        "duration_ms" integer not null default 0,
        "started_at" timestamptz not null,
        "finished_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "olx_sync_run_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_olx_sync_run_deleted_at" on "olx_sync_run" ("deleted_at") where "deleted_at" is null;`,
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "olx_sync_run" cascade;`)
    this.addSql(`drop table if exists "olx_advert" cascade;`)
    this.addSql(`drop table if exists "olx_connection" cascade;`)
  }
}
