import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Kit subscriber ids outgrew a Postgres integer (they are past 4 billion):
 * every log row failed to insert and the admin showed no sign-ups. The id is
 * kept as text; the API still answers with a number.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES: Medusa records executed
 * migrations by name alone.
 */
export class Migration20261110120000_kit extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table if exists "kit_subscriber_log" alter column "kit_subscriber_id" type text using "kit_subscriber_id"::text;`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table if exists "kit_subscriber_log" alter column "kit_subscriber_id" type bigint using nullif("kit_subscriber_id", '')::bigint;`)
  }
}
