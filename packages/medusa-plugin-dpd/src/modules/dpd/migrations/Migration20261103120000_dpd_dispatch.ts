import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The columns of the handover to the courier (stage 4) on dpd_dispatch: the
 * location and the sender snapshot of the plan, its packagesParams, problems
 * and hash, the claim count and the times of the protocol and the courier
 * order. Idempotent (`if exists`, `if not exists`), so a re-run is a no-op.
 * The name carries the namespace suffix, like the first migration.
 */
export class Migration20261103120000_dpd_dispatch extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table if exists "dpd_dispatch"
        add column if not exists "location_id" text null,
        add column if not exists "sender" jsonb null,
        add column if not exists "params" jsonb null,
        add column if not exists "problems" jsonb null,
        add column if not exists "plan_hash" text null,
        add column if not exists "attempts" integer not null default 0,
        add column if not exists "protocol_at" timestamptz null,
        add column if not exists "ordered_at" timestamptz null,
        add column if not exists "updated_by" text null;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table if exists "dpd_dispatch"
        drop column if exists "location_id",
        drop column if exists "sender",
        drop column if exists "params",
        drop column if exists "problems",
        drop column if exists "plan_hash",
        drop column if exists "attempts",
        drop column if exists "protocol_at",
        drop column if exists "ordered_at",
        drop column if exists "updated_by";
    `)
  }
}
