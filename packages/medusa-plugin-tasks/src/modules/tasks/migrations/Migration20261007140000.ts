import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import { adoptionStatements, legacyShape, LEGACY_SHAPE_SQL, newRunToken, type ColumnInfo } from "../lib/legacy"
import { CREATE_STATEMENTS } from "../lib/schema"

/**
 * The tables of the Tasks module, and the adoption of the KODA Panel
 * module's rows. Idempotent: `if not exists` everywhere, and the adoption
 * copies only into empty tables (see `lib/legacy.ts`), so a second run
 * changes nothing.
 *
 * The old tables (`task`, `task_comment`, `activity_log`) are read once and
 * never changed.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES AND THE DEMO STORE:
 * Medusa records executed migrations by name alone.
 */
export class Migration20261007140000 extends Migration {
  async up(): Promise<void> {
    for (const sql of CREATE_STATEMENTS) this.addSql(sql)

    /*
     * The shape of the old tables, read now (inside the migration's
     * transaction) so the copy statements below fit the copy of the KODA
     * Panel module this store has. A runner without `execute` skips the
     * adoption; the old rows stay where they are.
     */
    if (typeof this.execute !== "function") return
    const rows = (await this.execute(LEGACY_SHAPE_SQL)) as unknown as ColumnInfo[]
    for (const sql of adoptionStatements(legacyShape(Array.isArray(rows) ? rows : []), newRunToken())) this.addSql(sql)
  }

  async down(): Promise<void> {
    /* Only the tables of this module. The KODA Panel tables, if any, were never touched. */
    this.addSql(`drop table if exists "tasks_link" cascade;`)
    this.addSql(`drop table if exists "tasks_activity" cascade;`)
    this.addSql(`drop table if exists "tasks_comment" cascade;`)
    this.addSql(`drop table if exists "tasks_task" cascade;`)
    this.addSql(`drop table if exists "tasks_setting" cascade;`)
  }
}
