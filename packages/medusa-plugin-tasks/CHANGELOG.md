# Changelog

## 0.2.0 (unreleased)

### Fixed

- Admin pages work when the plugin is installed from npm: the admin libraries are optional peers, so the app keeps the copies of Medusa's dashboard instead of a second, newer copy.
- A status change through `POST /admin/tasks/tasks/:id` and a delete take the board's lock before the task's row, like a move, so a status change and a drag at the same time can no longer deadlock; a transaction Postgres breaks off for a deadlock or a serialization failure runs once more, then answers 409 `conflict_retry`.
- A long column is numbered again in batches of 1000 rows, so it never hits Postgres' limit of bindings; done and rejected are ordered by when tasks closed and are never numbered again.
- Reads never write: no `GET` route seeds or resets the sandbox board any more, so a widget or a counter can no longer wipe a task a visitor is editing.
- A sandbox account learns nothing about the team from the assignee check: an admin user of the main board answers `not_found`, like an address nobody has.
- The due date in the task drawer is saved once it is a whole date (a typed year no longer sends 0002, 0020 and 0202); field errors read in the admin's language; plurals in English and Polish; the Polish guide names the menu "Tajne klucze API".
- Unexpected server errors answer a plain sentence (`server_error`) without SQL or a stack; the details stay in the server log, with keys and connection strings masked.
- A migration runner that cannot read the catalog leaves an adoption marker that says why nothing was copied, and a warning in the log.

### Changed

- Secret API keys titled `tasks: ...` (`agentKeyPrefix`) reach only the `/admin/tasks` routes: every other admin route answers 403 `agent_key_scope`, so a key given to an AI agent never opens orders, refunds, customers, users or keys.
- A key may not sign with the full name or e-mail of an admin user or of a person in `people` (400 `author_reserved`; dropped without an answer on the sandbox board). The admin marks every change made with a key as an AI agent and never shows a person's photo for it.
- Writes to `/admin/tasks/*` take a JSON body or the `x-koda-request` header (415 otherwise), so a form on another site cannot post with the admin's cookie.
- The sandbox board is seeded by `POST /admin/tasks/sandbox/ensure` (the Tasks page of a sandbox account, when the status says `sandbox_board.stale`) and by the hourly `tasks-sandbox` job; a reset within ten seconds of the last seed changes nothing.
- Events of the sandbox board are not emitted unless `sandboxEvents: "emit"`.
- The sample tasks link only to the store's newest product unless `sandboxSeedLinks: "all"`.
- Automations without a user (workflows from subscribers and jobs) comment as `claude`, shown as AI agent; `actor_role` in the workflow input names another role.
- Deleting a task keeps its activity; editing or deleting a comment logs the earlier text (`comment_edited`, `comment_deleted`).
- The admin calls the API through the shared kit: Medusa's JWT auth (`__AUTH_TYPE__ = "jwt"`) works, writes carry the `x-koda-request` header.
- Avatars load only from https or image data URIs, lazily and without a referrer.
- The order, product and customer widgets read once (`GET /admin/tasks/<type>s/:id`, now with the assignees' faces in `people` and `named_people`) once a minute, instead of that read and the whole page status every 30 seconds; "New task" opens a window on the record's page instead of leaving it.
- The unused `./providers/*` export is gone (the plugin has no providers).

### Added

- `sandboxGuard`: sandbox accounts and the keys they created get 403 `sandbox_guard` on invites, admin users (their own profile takes only the language form), API keys, workflow executions, notifications outside the feed and every write outside Tasks (`allowWrites` adds prefixes). Medusa logs a warning at start while sandbox accounts are configured without it.
- `sandboxLimits` (200 tasks, 50 comments per task, 60 changes per minute per account by default): 409 `sandbox_full` and 429 `sandbox_busy` on the shared sandbox board.
- `hidden_open` in the board answer and a line on the page when a board has more than 1000 open tasks; `options.sandbox_guard` and `options.agent_key_prefix` in the status, shown in Settings.
- The koda.integration/1 contract: `GET /admin/tasks/integration`, `/integration/summary` (one line per order, product or customer with linked tasks: overdue red, due today or in review orange, open blue, all closed green, counted by the day of the request's time zone) and `/integration/attention` (`overdue_orders`, `overdue_products`, `overdue_customers`, `unassigned`, `mine`), on the board of the person or key asking, like every other route.
- The order, product and customer cards register as `tasks.order`, `tasks.product` and `tasks.customer` and can be embedded by a host (`embedded`): no header of its own, a quiet line while loading and when nothing is linked.
- Deep links into the board: `quick` (`overdue`, `due_today`, `urgent`, `unassigned`, `mine`, `open`, `review`), `record`, `record_type`, `assignee` (`me`), `q`, `tag`, `priority` and `layout` are read from and kept in the URL.
- Type declarations in the package; the setup prompt installs this exact version.
- README: what the sandbox protects and what it does not, rules for keys given to AI agents, the response shapes and every error code, the workflows' `board` and `actor_role`, Works with Koda Plus hosts, Public API, Uninstall, Compatibility and Trademarks.

## 0.1.0 (2026-10-07)

First public release, a generic version of the KODA Panel module Koda Plus built for its own stores and its roadmap.

- A task board in the admin: backlog, to do, in progress, in review, done and rejected, with priorities, assignees, due dates, tags and a position within each column. Drag and drop within and between columns; a drop names the card's new neighbours, so it lands right even with filters on, and both columns are numbered again in one transaction under a lock of the board.
- A roadmap view of the same tasks by due month, with progress and who does what.
- The task drawer: every field saved at once, the description, links, comments (the author edits and deletes their own) and the activity log.
- Counters (open, in progress, in review, overdue, urgent and high, unassigned, done and rejected) and filters by text, assignee, tag and priority.
- Assignees are admin users with their avatar or initials; free text names still work, and the `people` option gives them a photo, a role line and an AI agent mark.
- Links to orders, products and customers, read live from Medusa, with a widget on each of those pages and "New task" with the record linked.
- Comment roles kept from the KODA Panel module: `agency` (from `agencyAccounts`), `client` (the store team) and `claude` (scripts and AI agents with a secret API key, shown as "AI agent", under the name the request sends).
- The admin API for scripts and AI agents with Medusa secret API keys, documented in the README and the setup guide.
- Five events with a stable payload: `tasks.task.created`, `tasks.task.updated`, `tasks.task.status_changed`, `tasks.task.deleted`, `tasks.comment.created`.
- The sandbox board: accounts in `sandboxAccounts` only ever see and change it, on every route, with sample tasks seeded on the first visit, again after `sandboxResetHours` and on "Reset the sandbox". Keys created by a sandbox account stay in the sandbox.
- One migration (`Migration20261007140000`) with five namespaced tables, which also takes over the rows of the KODA Panel tables (`task`, `task_comment`, `activity_log`) with the same ids, dates and soft deletes, without changing those tables.
- Admin page with Panel, Setup guide and Settings, in English and Polish. Workflows for creating, updating, moving, deleting, commenting and linking from custom code.
