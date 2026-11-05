import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The status columns of stage 5 on dpd_shipment: the per waybill tracking,
 * the time of the status and the last error of the Medusa status writer.
 * Idempotent (`if exists`, `if not exists`), so a re-run is a no-op.
 */
export class Migration20261104120000_dpd_tracking extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table if exists "dpd_shipment"
        add column if not exists "tracking" jsonb null,
        add column if not exists "status_at" timestamptz null,
        add column if not exists "status_writer_error" text null;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table if exists "dpd_shipment"
        drop column if exists "tracking",
        drop column if exists "status_at",
        drop column if exists "status_writer_error";
    `)
  }
}
