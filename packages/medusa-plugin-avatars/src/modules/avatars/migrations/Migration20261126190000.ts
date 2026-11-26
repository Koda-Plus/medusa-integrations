import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Tables of the AI Avatars module. Idempotent: `if not exists` everywhere,
 * so a second run changes nothing.
 *
 * THE NAME IS UNIQUE ACROSS ALL KODA PLUS PACKAGES AND THE DEMO STORE:
 * Medusa records executed migrations by name alone.
 */
export class Migration20261126190000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "avatars_avatar" (
        "id" text not null,
        "name" text not null,
        "provider" text not null default 'tavus',
        "face_id" text not null,
        "voice" text not null,
        "consent_state" text not null default 'none',
        "consent_file_url" text null,
        "consent_signed_by" text null,
        "consent_signed_at" timestamptz null,
        "consent_note" text null,
        "consent_recorded_by" text null,
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "avatars_avatar_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_avatars_avatar_face_id" on "avatars_avatar" ("face_id") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "avatars_presentation" (
        "id" text not null,
        "title" text not null,
        "lang" text not null default 'pl',
        "state" text not null default 'draft',
        "source_kind" text not null default 'text',
        "source_file_url" text null,
        "source_text" text null,
        "transcript" text null,
        "target_minutes" integer not null default 12,
        "avatar_id" text null,
        "script" jsonb null,
        "script_hash" text null,
        "approved_hash" text null,
        "approved_by" text null,
        "approved_at" timestamptz null,
        "published_at" timestamptz null,
        "error" text null,
        "created_by" text null,
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "avatars_presentation_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_avatars_presentation_state" on "avatars_presentation" ("state") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_avatars_presentation_avatar_id" on "avatars_presentation" ("avatar_id") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "avatars_render_job" (
        "id" text not null,
        "presentation_id" text not null,
        "item_id" text not null,
        "signature" text not null,
        "state" text not null default 'queued',
        "provider_video_id" text null,
        "audio_url" text null,
        "video_url" text null,
        "duration_ms" integer null,
        "progress" integer not null default 0,
        "attempts" integer not null default 0,
        "error" text null,
        "demo" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "avatars_render_job_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_avatars_render_job_presentation_item" on "avatars_render_job" ("presentation_id", "item_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_avatars_render_job_state" on "avatars_render_job" ("state") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "avatars_render_job" cascade;`)
    this.addSql(`drop table if exists "avatars_presentation" cascade;`)
    this.addSql(`drop table if exists "avatars_avatar" cascade;`)
  }
}
