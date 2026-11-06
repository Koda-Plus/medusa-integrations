import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Edits of single offers: what a person changed beside Medusa (the name, the
 * description, the photos, the package, the days to ship) is kept on the
 * offer row as `overrides`. Additive and idempotent: `if not exists`.
 *
 * The status `detached` (removed from the panel only, the marketplace offer
 * stays) is a value of the existing text column `status`: no change needed.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES: Medusa records executed
 * migrations by name alone.
 */
export class Migration20261106160000_vonhalsky_overrides extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table if exists "vonhalsky_offer" add column if not exists "overrides" jsonb null;`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table if exists "vonhalsky_offer" drop column if exists "overrides";`)
  }
}
