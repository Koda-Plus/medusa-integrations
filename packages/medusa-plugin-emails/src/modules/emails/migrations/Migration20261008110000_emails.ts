import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Version 0.2.0: the send log knows the customer of a message and a one-way
 * hash of its address.
 *
 *   customer_id      the Medusa customer (`cus_...`), for the customer's
 *                    page and its summary; welcomes logged before are filled
 *                    in from their resource
 *   recipient_hash   `addressHash` of the address: the e-mails of one
 *                    address (a customer's guest orders, a search by the full
 *                    address) and the limit of password resets per address
 *
 * Written by hand and idempotent (`if not exists`), so a re-run is a no-op.
 * The name carries the namespace: Medusa records executed migrations by name
 * in one table shared by every module, so a name must be unique across all
 * Koda Plus packages.
 */
export class Migration20261008110000_emails extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table if exists "emails_message" add column if not exists "customer_id" text null;`)
    this.addSql(`alter table if exists "emails_message" add column if not exists "recipient_hash" text null;`)
    this.addSql(
      `create index if not exists "IDX_emails_message_customer_id_demo" on "emails_message" ("customer_id", "demo") where deleted_at is null and customer_id is not null;`,
    )
    this.addSql(
      `create index if not exists "IDX_emails_message_recipient_hash" on "emails_message" ("recipient_hash", "template", "demo", "created_at") where deleted_at is null and recipient_hash is not null;`,
    )
    this.addSql(
      `update "emails_message" set "customer_id" = "resource_id" where "customer_id" is null and "resource_type" = 'customer' and "resource_id" like 'cus\\_%';`,
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_emails_message_recipient_hash";`)
    this.addSql(`drop index if exists "IDX_emails_message_customer_id_demo";`)
    this.addSql(`alter table if exists "emails_message" drop column if exists "recipient_hash";`)
    this.addSql(`alter table if exists "emails_message" drop column if exists "customer_id";`)
  }
}
