import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Version 0.4.0: KSeF numbers that never came and documents the buyer never
 * got, and the gate of payment reminders. Columns only, idempotent (`if not
 * exists` everywhere). The name carries the namespace: Medusa records
 * executed migrations by name in one shared table.
 *
 * fakturownia_document
 *   ksef_number_at           when the plugin first saw the KSeF number;
 *                            filled here for documents numbered before
 *   remote_email_status      Fakturownia's own `email_status` as last read
 *   remote_sent_at           Fakturownia's own `sent_time` as last read
 *   remote_email_checked_at  when those two were last read
 *
 * fakturownia_email
 *   amount                   a reminder: what was left to pay according to
 *                            Fakturownia when it went out
 *   reason                   a refused reminder: paid_in_medusa,
 *                            paid_in_fakturownia or fakturownia_unreachable
 */
export class Migration20261102120000_fakturownia extends Migration {
  async up(): Promise<void> {
    const documents: Array<[string, string]> = [
      ["ksef_number_at", "timestamptz null"],
      ["remote_email_status", "text null"],
      ["remote_sent_at", "timestamptz null"],
      ["remote_email_checked_at", "timestamptz null"],
    ]
    for (const [name, type] of documents) {
      this.addSql(`alter table if exists "fakturownia_document" add column if not exists "${name}" ${type};`)
    }
    this.addSql(`alter table if exists "fakturownia_email" add column if not exists "amount" numeric(14,2) null;`)
    this.addSql(`alter table if exists "fakturownia_email" add column if not exists "reason" text null;`)

    /* Documents numbered before 0.4.0: the best moment known for the number. */
    this.addSql(`
      update "fakturownia_document"
      set "ksef_number_at" = coalesce("gov_send_date", "gov_checked_at", "issued_at", "updated_at")
      where "gov_id" is not null and "ksef_number_at" is null and "deleted_at" is null;
    `)
  }

  async down(): Promise<void> {
    for (const name of ["ksef_number_at", "remote_email_status", "remote_sent_at", "remote_email_checked_at"]) {
      this.addSql(`alter table if exists "fakturownia_document" drop column if exists "${name}";`)
    }
    this.addSql(`alter table if exists "fakturownia_email" drop column if exists "amount";`)
    this.addSql(`alter table if exists "fakturownia_email" drop column if exists "reason";`)
  }
}
