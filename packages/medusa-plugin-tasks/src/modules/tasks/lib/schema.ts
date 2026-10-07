/**
 * The tables of the module as SQL, for the migration. Zero imports: the
 * unit tests read the statements without a database.
 *
 * Every table has a `board` column (main or sandbox), denormalized into
 * comments, activity and links so every statement of a board can filter by
 * it on its own. Comments, activity and links hang on their task with a
 * foreign key (cascade on a hard delete; the plugin itself only soft
 * deletes).
 */

export const CREATE_STATEMENTS: readonly string[] = [
  `create table if not exists "tasks_task" (
    "id" text not null,
    "board" text not null default 'main',
    "title" text not null,
    "description" text null,
    "status" text not null default 'todo',
    "priority" text not null default 'medium',
    "assignee" text null,
    "assignee_id" text null,
    "due_date" timestamptz null,
    "tags" jsonb null,
    "position" integer not null default 0,
    "completed_at" timestamptz null,
    "created_by" text null,
    "created_by_id" text null,
    "metadata" jsonb null,
    "created_at" timestamptz not null default now(),
    "updated_at" timestamptz not null default now(),
    "deleted_at" timestamptz null,
    constraint "tasks_task_pkey" primary key ("id")
  );`,
  `create index if not exists "IDX_tasks_task_board_status_position" on "tasks_task" ("board", "status", "position") where "deleted_at" is null;`,
  `create index if not exists "IDX_tasks_task_board_assignee_id" on "tasks_task" ("board", "assignee_id") where "deleted_at" is null;`,
  `create index if not exists "IDX_tasks_task_deleted_at" on "tasks_task" ("deleted_at") where "deleted_at" is null;`,

  `create table if not exists "tasks_comment" (
    "id" text not null,
    "board" text not null default 'main',
    "task_id" text not null,
    "body" text not null,
    "author" text null,
    "author_role" text not null default 'agency',
    "author_id" text null,
    "author_type" text null,
    "metadata" jsonb null,
    "edited_at" timestamptz null,
    "created_at" timestamptz not null default now(),
    "updated_at" timestamptz not null default now(),
    "deleted_at" timestamptz null,
    constraint "tasks_comment_pkey" primary key ("id"),
    constraint "tasks_comment_task_id_foreign" foreign key ("task_id") references "tasks_task" ("id") on update cascade on delete cascade
  );`,
  `create index if not exists "IDX_tasks_comment_task_id_created_at" on "tasks_comment" ("task_id", "created_at") where "deleted_at" is null;`,
  `create index if not exists "IDX_tasks_comment_deleted_at" on "tasks_comment" ("deleted_at") where "deleted_at" is null;`,

  `create table if not exists "tasks_activity" (
    "id" text not null,
    "board" text not null default 'main',
    "task_id" text not null,
    "type" text not null,
    "message" text null,
    "actor" text null,
    "actor_id" text null,
    "actor_type" text null,
    "metadata" jsonb null,
    "created_at" timestamptz not null default now(),
    "updated_at" timestamptz not null default now(),
    "deleted_at" timestamptz null,
    constraint "tasks_activity_pkey" primary key ("id"),
    constraint "tasks_activity_task_id_foreign" foreign key ("task_id") references "tasks_task" ("id") on update cascade on delete cascade
  );`,
  `create index if not exists "IDX_tasks_activity_task_id_created_at" on "tasks_activity" ("task_id", "created_at") where "deleted_at" is null;`,
  `create index if not exists "IDX_tasks_activity_board_created_at" on "tasks_activity" ("board", "created_at") where "deleted_at" is null;`,
  `create index if not exists "IDX_tasks_activity_deleted_at" on "tasks_activity" ("deleted_at") where "deleted_at" is null;`,

  `create table if not exists "tasks_link" (
    "id" text not null,
    "board" text not null default 'main',
    "task_id" text not null,
    "entity_type" text not null,
    "entity_id" text not null,
    "created_by" text null,
    "created_by_id" text null,
    "created_at" timestamptz not null default now(),
    "updated_at" timestamptz not null default now(),
    "deleted_at" timestamptz null,
    constraint "tasks_link_pkey" primary key ("id"),
    constraint "tasks_link_task_id_foreign" foreign key ("task_id") references "tasks_task" ("id") on update cascade on delete cascade
  );`,
  `create unique index if not exists "IDX_tasks_link_task_entity_unique" on "tasks_link" ("task_id", "entity_type", "entity_id") where "deleted_at" is null;`,
  `create index if not exists "IDX_tasks_link_board_entity" on "tasks_link" ("board", "entity_type", "entity_id") where "deleted_at" is null;`,
  `create index if not exists "IDX_tasks_link_deleted_at" on "tasks_link" ("deleted_at") where "deleted_at" is null;`,

  `create table if not exists "tasks_setting" (
    "id" text not null,
    "key" text not null,
    "value" jsonb null,
    "updated_by" text null,
    "created_at" timestamptz not null default now(),
    "updated_at" timestamptz not null default now(),
    "deleted_at" timestamptz null,
    constraint "tasks_setting_pkey" primary key ("id")
  );`,
  `create unique index if not exists "IDX_tasks_setting_key_unique" on "tasks_setting" ("key");`,
]
