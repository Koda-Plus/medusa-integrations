import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Zaufane Opinie: the survey consent per cart. Idempotent (`if not
 * exists`). The name is unique across all Koda Plus packages and the demo
 * store.
 */
export class Migration20261111160000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "ceneo_consent" (
        "id" text not null,
        "cart_id" text not null,
        "survey" boolean not null default false,
        "answered_at" timestamptz null,
        "order_id" text null,
        "transaction_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "ceneo_consent_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_ceneo_consent_cart_unique" on "ceneo_consent" ("cart_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_ceneo_consent_created_at" on "ceneo_consent" ("created_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "ceneo_consent" cascade;`)
  }
}
