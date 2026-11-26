import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Kup Teraz writes: the writer toggles and the import columns of
 * `ceneo_order`. Idempotent (`if not exists`). The name is unique across all
 * Koda Plus packages and the demo store.
 */
export class Migration20261111200000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "ceneo_writer" (
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
        "last_success_at" timestamptz null,
        "lease_token" text null,
        "lease_until" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "ceneo_writer_pkey" primary key ("id")
      );
    `)
    this.addSql(`alter table if exists "ceneo_writer" add column if not exists "lease_token" text null;`)
    this.addSql(`alter table if exists "ceneo_writer" add column if not exists "lease_until" timestamptz null;`)
    this.addSql(`alter table if exists "ceneo_order" add column if not exists "import_status" text null;`)
    this.addSql(`alter table if exists "ceneo_order" add column if not exists "import_claim" text null;`)
    this.addSql(`alter table if exists "ceneo_order" add column if not exists "import_lease_until" timestamptz null;`)
    this.addSql(`alter table if exists "ceneo_order" add column if not exists "import_attempts" integer not null default 0;`)
    this.addSql(`alter table if exists "ceneo_order" add column if not exists "import_next_at" timestamptz null;`)
    this.addSql(`alter table if exists "ceneo_order" add column if not exists "import_error" text null;`)
    this.addSql(`alter table if exists "ceneo_order" add column if not exists "imported_at" timestamptz null;`)
    this.addSql(`alter table if exists "ceneo_order" add column if not exists "ceneo_writes" jsonb null;`)
    this.addSql(`alter table if exists "ceneo_order" add column if not exists "writes_due" boolean not null default false;`)
    this.addSql(`alter table if exists "ceneo_order" add column if not exists "cancel_handled_at" timestamptz null;`)
    this.addSql(`create index if not exists "IDX_ceneo_order_writes_due" on "ceneo_order" ("writes_due") where "deleted_at" is null and "writes_due" = true;`)
    this.addSql(`create index if not exists "IDX_ceneo_order_medusa_order_id" on "ceneo_order" ("medusa_order_id") where "deleted_at" is null and "medusa_order_id" is not null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_ceneo_order_medusa_order_id";`)
    this.addSql(`drop index if exists "IDX_ceneo_order_writes_due";`)
    for (const c of ["import_status", "import_claim", "import_lease_until", "import_attempts", "import_next_at", "import_error", "imported_at", "ceneo_writes", "writes_due", "cancel_handled_at"]) {
      this.addSql(`alter table if exists "ceneo_order" drop column if exists "${c}";`)
    }
    this.addSql(`drop table if exists "ceneo_writer" cascade;`)
  }
}
