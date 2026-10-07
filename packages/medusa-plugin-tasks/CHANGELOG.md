# Changelog

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
