import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Version 0.3.0: bookkeeping columns of the document outbox. Idempotent
 * (`if not exists` everywhere), so a re-run is a no-op. The name carries the
 * namespace: Medusa records executed migrations by name in one shared table,
 * so a name used by another plugin would count as executed here.
 *
 *   create_sent_at     when the create request of the current attempt left
 *                      (written by the claim's owner right before the request);
 *                      the reconciliation of an unknown row waits from it
 *   email_claimed_at   when a process took the automatic e-mail of a row
 *                      (`email_status = 'sending'`), so two processes never
 *                      send it twice
 *   reminder_at        the last payment reminder taken for sending, claimed
 *                      atomically (once a day per document)
 *   finals_checked_at  proforma flow: when a proforma was last checked for a
 *                      fulfillment the event missed (the least recently
 *                      checked go first)
 *   converted_at       a proforma turned into a final document; it is no
 *                      longer counted as unpaid. Filled here for the
 *                      documents issued by 0.2.x.
 */
export class Migration20261008093000_fakturownia extends Migration {
  async up(): Promise<void> {
    const columns: Array<[string, string]> = [
      ["create_sent_at", "timestamptz null"],
      ["email_claimed_at", "timestamptz null"],
      ["reminder_at", "timestamptz null"],
      ["finals_checked_at", "timestamptz null"],
      ["converted_at", "timestamptz null"],
    ]
    for (const [name, type] of columns) {
      this.addSql(`alter table if exists "fakturownia_document" add column if not exists "${name}" ${type};`)
    }

    /* Proformas already turned into a final document (the final one names the proforma as `from_fakturownia_id`). */
    this.addSql(`
      update "fakturownia_document" as p
      set "converted_at" = coalesce(f."issued_at", f."updated_at", now())
      from "fakturownia_document" as f
      where p."kind" = 'proforma'
        and p."converted_at" is null
        and p."deleted_at" is null
        and p."fakturownia_id" is not null
        and f."order_id" = p."order_id"
        and f."demo" = p."demo"
        and f."kind" in ('vat', 'receipt')
        and f."status" in ('issued', 'needs_correction')
        and f."from_fakturownia_id" = p."fakturownia_id"
        and f."deleted_at" is null;
    `)

    this.addSql(
      `create index if not exists "IDX_fakturownia_document_email_status" on "fakturownia_document" ("email_status") where "email_status" in ('pending', 'sending') and deleted_at is null;`,
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_fakturownia_document_email_status";`)
    for (const name of ["create_sent_at", "email_claimed_at", "reminder_at", "finals_checked_at", "converted_at"]) {
      this.addSql(`alter table if exists "fakturownia_document" drop column if exists "${name}";`)
    }
  }
}
