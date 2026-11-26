import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * One clip row per item of a presentation. Two quotes at once could create
 * two rows for the same slide (and order it twice); the index makes the
 * second insert fail instead. Duplicates are soft-deleted first: the row at
 * Tavus stays, else the rendered one, else the newest. Idempotent.
 */
export class Migration20261127120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      update "avatars_render_job" set "deleted_at" = now()
      where "id" in (
        select "id" from (
          select "id", row_number() over (
            partition by "presentation_id", "item_id"
            order by case when "state" in ('ordering', 'rendering') then 0 when "state" = 'ready' then 1 else 2 end, "created_at" desc, "id" desc
          ) as "rn"
          from "avatars_render_job" where "deleted_at" is null
        ) ranked where "rn" > 1
      );
    `)
    this.addSql(`drop index if exists "IDX_avatars_render_job_presentation_item";`)
    this.addSql(`create unique index if not exists "IDX_avatars_render_job_presentation_item_unique" on "avatars_render_job" ("presentation_id", "item_id") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_avatars_render_job_presentation_item_unique";`)
    this.addSql(`create index if not exists "IDX_avatars_render_job_presentation_item" on "avatars_render_job" ("presentation_id", "item_id") where "deleted_at" is null;`)
  }
}
