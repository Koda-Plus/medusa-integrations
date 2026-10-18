import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The tables of the InPost Pay module: the bound baskets and the settings.
 * Idempotent: `if not exists` everywhere.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES: Medusa records executed
 * migrations by name alone.
 */
export class Migration20261018120000_inpostpay extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "inpost_pay_basket" (
      "id" text not null primary key,
      "cart_id" text not null,
      "status" text not null default 'created',
      "demo" boolean not null default false,
      "masked_phone" text null,
      "order_id" text null,
      "delivery_type" text null,
      "delivery_point" text null,
      "payment_status" text null,
      "payment_type" text null,
      "order_status" text null,
      "currency_code" text null,
      "amount_minor" integer null,
      "binding_place" text null,
      "binding_key" text null,
      "inpost_basket_id" text null,
      "linked_at" timestamptz null,
      "ordered_at" timestamptz null,
      "error" text null,
      "events" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null
    );`)
    this.addSql(`create unique index if not exists "IDX_inpost_pay_basket_cart_id_unique" on "inpost_pay_basket" ("cart_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_inpost_pay_basket_order_id" on "inpost_pay_basket" ("order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_inpost_pay_basket_status" on "inpost_pay_basket" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_inpost_pay_basket_created_at" on "inpost_pay_basket" ("created_at") where "deleted_at" is null;`)
    this.addSql(`create table if not exists "inpost_pay_setting" (
      "id" text not null primary key,
      "key" text not null,
      "value" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null
    );`)
    this.addSql(`create unique index if not exists "IDX_inpost_pay_setting_key_unique" on "inpost_pay_setting" ("key") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "inpost_pay_basket" cascade;`)
    this.addSql(`drop table if exists "inpost_pay_setting" cascade;`)
  }
}
