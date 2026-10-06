import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the Negotiations module. Idempotent (`if not exists` everywhere)
 * and additive: a re-run, or a run on a database that already has the
 * tables, changes nothing it should not.
 *
 * UPGRADING THE APP MODULE IN PLACE. The Koda Plus demo store had
 * `negotiation` and `negotiation_message` from an app module (migrations
 * `Migration20260527_initial`, `Migration20260623140000_add_raw_target_price`,
 * `Migration20260623150000_ensure_tables`), with rows people still read.
 * This migration:
 *
 *   - creates the two tables only when they are missing, with the same
 *     names, keys and foreign key as before;
 *   - adds every new column with `add column if not exists`, never drops,
 *     renames or retypes one: `target_price numeric` and `raw_target_price
 *     jsonb` stay as they are (the code reads `target_price` of old rows);
 *   - fills the new bookkeeping columns of old rows from their messages
 *     (last activity, message count, whose move it is, the subject, when a
 *     closed thread closed), only where they are still empty;
 *   - adds the sequence of readable references and three new tables.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES AND THE DEMO STORE:
 * Medusa records executed migrations by name alone.
 */
export class Migration20261007100000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "negotiation" (
        "id" text not null,
        "ref" text not null,
        "status" text not null default 'open',
        "customer_id" text null,
        "cart_id" text null,
        "order_id" text null,
        "product_id" text null,
        "variant_id" text null,
        "sku" text null,
        "qty" integer not null default 1,
        "assigned_to" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "negotiation_pkey" primary key ("id")
      );
    `)

    const threadColumns: Array<[string, string]> = [
      ["demo", "boolean not null default false"],
      ["source", "text not null default 'store'"],
      ["subject", "text null"],
      ["title", "text null"],
      ["currency_code", "text null"],
      ["requested_amount", "integer null"],
      ["offered_amount", "integer null"],
      ["agreed_amount", "integer null"],
      ["price_amount", "integer null"],
      ["list_amount", "integer null"],
      ["items", "jsonb null"],
      ["waiting_for", "text null"],
      ["last_activity_at", "timestamptz null"],
      ["message_count", "integer not null default 0"],
      ["expires_at", "timestamptz null"],
      ["closed_at", "timestamptz null"],
      ["closed_by", "text null"],
    ]
    for (const [name, type] of threadColumns) {
      this.addSql(`alter table if exists "negotiation" add column if not exists "${name}" ${type};`)
    }

    this.addSql(`
      create table if not exists "negotiation_message" (
        "id" text not null,
        "negotiation_id" text not null,
        "author_type" text not null default 'system',
        "author_id" text null,
        "body" text not null,
        "attachments" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "negotiation_message_pkey" primary key ("id"),
        constraint "FK_negotiation_message_neg" foreign key ("negotiation_id") references "negotiation" ("id") on delete cascade
      );
    `)

    const messageColumns: Array<[string, string]> = [
      ["kind", "text not null default 'message'"],
      ["amount", "integer null"],
      ["internal", "boolean not null default false"],
      ["metadata", "jsonb null"],
    ]
    for (const [name, type] of messageColumns) {
      this.addSql(`alter table if exists "negotiation_message" add column if not exists "${name}" ${type};`)
    }

    /* Indexes of the app module (kept, created when missing) and the new ones. */
    this.addSql(`create index if not exists "IDX_negotiation_status" on "negotiation" ("status");`)
    this.addSql(`create index if not exists "IDX_negotiation_customer" on "negotiation" ("customer_id");`)
    this.addSql(`create index if not exists "IDX_negotiation_ref" on "negotiation" ("ref");`)
    this.addSql(`create index if not exists "IDX_negotiation_message_neg" on "negotiation_message" ("negotiation_id");`)
    this.addSql(
      `create index if not exists "IDX_negotiation_demo_status_activity" on "negotiation" ("demo", "status", "last_activity_at") where "deleted_at" is null;`,
    )
    this.addSql(`create index if not exists "IDX_negotiation_customer_demo" on "negotiation" ("customer_id", "demo") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_negotiation_product_id" on "negotiation" ("product_id") where "deleted_at" is null;`)
    this.addSql(
      `create index if not exists "IDX_negotiation_message_neg_created" on "negotiation_message" ("negotiation_id", "created_at") where "deleted_at" is null;`,
    )

    /* Readable references: NEG-2026-1001 and on. */
    this.addSql(`create sequence if not exists "negotiation_ref_seq" start with 1001;`)

    /*
     * Bookkeeping of rows written before these columns existed. Each update
     * touches only rows whose new column is still empty, so it is safe to
     * repeat and never overwrites what the plugin wrote.
     */
    this.addSql(`
      update "negotiation" n
      set "message_count" = m."count"
      from (
        select "negotiation_id", count(*)::int as "count"
        from "negotiation_message"
        where "deleted_at" is null and coalesce("internal", false) = false
        group by "negotiation_id"
      ) m
      where m."negotiation_id" = n."id" and n."message_count" = 0 and n."last_activity_at" is null;
    `)
    this.addSql(`
      update "negotiation" n
      set "last_activity_at" = m."last_at"
      from (
        select "negotiation_id", max("created_at") as "last_at"
        from "negotiation_message"
        where "deleted_at" is null
        group by "negotiation_id"
      ) m
      where m."negotiation_id" = n."id" and n."last_activity_at" is null;
    `)
    this.addSql(`update "negotiation" set "last_activity_at" = coalesce("updated_at", "created_at") where "last_activity_at" is null;`)
    this.addSql(`
      update "negotiation" n
      set "waiting_for" = case when lm."author_type" = 'customer' then 'team' else 'customer' end
      from (
        select distinct on ("negotiation_id") "negotiation_id", "author_type"
        from "negotiation_message"
        where "deleted_at" is null
        order by "negotiation_id", "created_at" desc, "id" desc
      ) lm
      where lm."negotiation_id" = n."id" and n."waiting_for" is null and n."status" in ('open', 'counter_offered');
    `)
    this.addSql(`update "negotiation" set "waiting_for" = 'team' where "waiting_for" is null and "status" = 'open';`)
    this.addSql(`update "negotiation" set "waiting_for" = 'customer' where "waiting_for" is null and "status" = 'counter_offered';`)
    this.addSql(`
      update "negotiation"
      set "subject" = case when "variant_id" is not null then 'variant' when "product_id" is not null then 'product' when "cart_id" is not null then 'cart' end
      where "subject" is null and coalesce("variant_id", "product_id", "cart_id") is not null;
    `)
    this.addSql(`update "negotiation" set "closed_at" = "updated_at" where "closed_at" is null and "status" in ('accepted', 'rejected', 'expired');`)

    this.addSql(`
      create table if not exists "negotiation_setting" (
        "id" text not null,
        "key" text not null,
        "value" jsonb null,
        "updated_by" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "negotiation_setting_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_negotiation_setting_key_unique" on "negotiation_setting" ("key");`)

    this.addSql(`
      create table if not exists "negotiation_run" (
        "id" text not null,
        "kind" text not null,
        "trigger" text not null,
        "status" text not null,
        "demo" boolean not null default false,
        "counts" jsonb null,
        "message" text null,
        "started_at" timestamptz not null,
        "finished_at" timestamptz null,
        "duration_ms" integer not null default 0,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "negotiation_run_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_negotiation_run_kind_demo_started" on "negotiation_run" ("kind", "demo", "started_at") where "deleted_at" is null;`,
    )

    this.addSql(`
      create table if not exists "negotiation_draft_order" (
        "id" text not null,
        "negotiation_id" text not null,
        "demo" boolean not null default false,
        "state" text not null default 'pending',
        "draft_order_id" text null,
        "display_id" integer null,
        "error" text null,
        "attempts" integer not null default 0,
        "claim_token" text null,
        "claimed_at" timestamptz null,
        "lease_until" timestamptz null,
        "payload" jsonb null,
        "requested_by" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "negotiation_draft_order_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_negotiation_draft_order_thread_demo_unique" on "negotiation_draft_order" ("negotiation_id", "demo") where "deleted_at" is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_negotiation_draft_order_demo_state" on "negotiation_draft_order" ("demo", "state") where "deleted_at" is null;`,
    )
  }

  async down(): Promise<void> {
    /*
     * Only what this migration alone created. `negotiation` and
     * `negotiation_message` may be older than it and hold real
     * conversations: they and their columns stay.
     */
    this.addSql(`drop table if exists "negotiation_draft_order" cascade;`)
    this.addSql(`drop table if exists "negotiation_run" cascade;`)
    this.addSql(`drop table if exists "negotiation_setting" cascade;`)
    this.addSql(`drop sequence if exists "negotiation_ref_seq";`)
  }
}
