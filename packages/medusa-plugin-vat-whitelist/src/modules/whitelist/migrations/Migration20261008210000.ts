import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The registry numbers of the counterparty (REGON and KRS from the Ministry
 * of Finance whitelist), added on top of the 0.1.0 tables. Additive and
 * idempotent: `add column if not exists`, a re-run changes nothing.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES AND THE DEMO STORE:
 * Medusa records executed migrations by name alone.
 */
export class Migration20261008210000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table if exists "whitelist_entity" add column if not exists "regon" text null;`)
    this.addSql(`alter table if exists "whitelist_entity" add column if not exists "krs" text null;`)
    this.addSql(`alter table if exists "whitelist_entity" add column if not exists "legal_form" text null;`)
    this.addSql(`alter table if exists "whitelist_check" add column if not exists "regon" text null;`)
    this.addSql(`alter table if exists "whitelist_check" add column if not exists "krs" text null;`)
    this.addSql(`alter table if exists "whitelist_check" add column if not exists "legal_form" text null;`)
  }

  async down(): Promise<void> {
    /* The columns stay: dropping them would lose the answers of older checks. */
  }
}
