/**
 * Constants of the Tasks module. ZERO IMPORTS on purpose: this file is loaded
 * by the unit tests through `node --test` with type stripping, without a
 * build, and by the admin bundle.
 */

/** Container key of the module service. */
export const TASKS_MODULE = "tasks"

/*
 * TABLE NAMES, namespaced: generic names like `task` are too likely to exist
 * in a store already (the Koda Plus KODA Panel module used `task`,
 * `task_comment` and `activity_log`; see `legacy.ts` for how their rows are
 * adopted).
 */
export const TASK_TABLE = "tasks_task"
export const COMMENT_TABLE = "tasks_comment"
export const ACTIVITY_TABLE = "tasks_activity"
export const LINK_TABLE = "tasks_link"
export const SETTING_TABLE = "tasks_setting"

/** The tables of the KODA Panel app module this plugin replaces. Read once by the migration, never changed. */
export const LEGACY_TASK_TABLE = "task"
export const LEGACY_COMMENT_TABLE = "task_comment"
export const LEGACY_ACTIVITY_TABLE = "activity_log"

/* ------------------------------------------------------------------ */
/* Boards                                                              */
/* ------------------------------------------------------------------ */

/** The board of the team: every account that is not a sandbox account works here. */
export const MAIN_BOARD = "main"
/** The board of the sandbox accounts (`sandboxAccounts`): sample tasks, apart from everything else. */
export const SANDBOX_BOARD = "sandbox"
export type Board = typeof MAIN_BOARD | typeof SANDBOX_BOARD

export function isBoard(value: unknown): value is Board {
  return value === MAIN_BOARD || value === SANDBOX_BOARD
}

/* ------------------------------------------------------------------ */
/* Statuses, priorities, roles                                         */
/* ------------------------------------------------------------------ */

/** The columns of the board, in their order. Stored values are the ones of the KODA Panel module. */
export const STATUSES = ["backlog", "todo", "in_progress", "review", "done", "rejected"] as const
export type TaskStatus = (typeof STATUSES)[number]

/** Work still to do. */
export const OPEN_STATUSES: readonly TaskStatus[] = ["backlog", "todo", "in_progress", "review"]
/** Finished one way or the other. A task gets `completed_at` when it lands here. */
export const CLOSED_STATUSES: readonly TaskStatus[] = ["done", "rejected"]

export function isStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value)
}

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const
export type TaskPriority = (typeof PRIORITIES)[number]

export function isPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value)
}

/** Priorities that count as "urgent and high" on the board. */
export const URGENT_PRIORITIES: readonly TaskPriority[] = ["urgent", "high"]

/**
 * Who wrote a comment, as stored (the values of the KODA Panel module):
 * `agency` the agency or developers, `client` the store team, `claude` a
 * script or AI agent with a secret API key (shown as "AI agent").
 */
export const ROLES = ["agency", "client", "claude"] as const
export type AuthorRole = (typeof ROLES)[number]

export function isRole(value: unknown): value is AuthorRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
}

/** Who acted: an admin user, a secret API key, or the plugin itself. */
export const ACTOR_TYPES = ["user", "api-key", "system"] as const
export type ActorType = (typeof ACTOR_TYPES)[number]

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

/** Medusa records a task can be linked to, with the id prefix Medusa gives them and their admin page. */
export const LINK_TYPES = ["order", "product", "customer"] as const
export type LinkType = (typeof LINK_TYPES)[number]

export const LINK_ID_PREFIX: Record<LinkType, string> = {
  order: "order_",
  product: "prod_",
  customer: "cus_",
}

export const LINK_ADMIN_PATH: Record<LinkType, string> = {
  order: "/orders",
  product: "/products",
  customer: "/customers",
}

export function isLinkType(value: unknown): value is LinkType {
  return typeof value === "string" && (LINK_TYPES as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

/**
 * Kinds of activity entries. The first five are the ones the KODA Panel
 * module wrote (its rows are adopted as they are).
 */
export const ACTIVITY_TYPES = [
  "task_created",
  "status_changed",
  "commented",
  "task_updated",
  "task_deleted",
  "assigned",
  "linked",
  "unlinked",
] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const TITLE_MAX = 200
export const DESCRIPTION_MAX = 10_000
export const COMMENT_MAX = 5_000
export const TAG_MAX = 32
export const TAGS_MAX = 10
/** A display name sent by a script or an AI agent with its requests. */
export const AUTHOR_MAX = 60
/** A free text assignee (old rows, or a script that names a role like "frontend"). */
export const ASSIGNEE_MAX = 80
export const LINKS_PER_TASK_MAX = 20
export const ID_MAX = 100

/** The board answer: open tasks, then the latest closed ones up to this many per closed column. */
export const OPEN_TASKS_MAX = 1000
export const CLOSED_TASKS_DEFAULT = 100
export const CLOSED_TASKS_MAX = 500
/** Page sizes of the list for scripts. */
export const LIST_DEFAULT = 100
export const LIST_MAX = 500
export const ACTIVITY_DEFAULT = 20
export const ACTIVITY_MAX = 100
/** Tasks a widget on an order, product or customer page shows. */
export const WIDGET_TASKS = 10
/** Admin users the assignee picker lists. */
export const PEOPLE_MAX = 200

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

export const ID_PREFIX = {
  task: "task",
  comment: "tcom",
  activity: "tact",
  link: "tlnk",
  setting: "tset",
} as const

/* ------------------------------------------------------------------ */
/* Settings keys                                                       */
/* ------------------------------------------------------------------ */

/** Written by the migration when it adopted (or found but skipped) the KODA Panel tables. */
export const ADOPTION_KEY = "legacy:adoption"
/** Written with every seed of the sandbox board. */
export const SANDBOX_KEY = "sandbox:seed"

/* ------------------------------------------------------------------ */
/* Sandbox                                                             */
/* ------------------------------------------------------------------ */

/** The sandbox board is seeded again after this many hours (0: only on reset). */
export const DEFAULT_SANDBOX_RESET_HOURS = 24
export const MAX_SANDBOX_RESET_HOURS = 24 * 365
/** Bumped when the sample tasks change, so every sandbox is seeded again once. */
export const SANDBOX_SEED_VERSION = "0.1.0"
/** Ids of the sample rows start with this, so they are recognisable in the database. */
export const SANDBOX_ID_PREFIX = "sbx"

/** The cache of admin user profiles and API keys behind requests. */
export const PROFILE_TTL_MS = 60 * 1000
