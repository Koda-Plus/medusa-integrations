# Tasks by Koda Plus

A task board in the Medusa admin for the store team and the agency or developers who work with it. Six columns from backlog to done with drag and drop, a drawer for every task with its description, comments and activity log, and tasks linked to the orders, products and customers they are about, with a widget on each of those pages. Everything happens where the store is run, without another tool to log in to.

Scripts and AI agents report their work on the same board through the admin API with a Medusa secret API key titled `tasks: ...`, which reaches the Tasks routes and nothing else: they create tasks, move them and comment, signed with their own name and shown as an AI agent. Every change is an event with a documented, stable payload, so Slack, Discord or e-mail notifications are a small subscriber away. A sandbox board keeps public demo accounts apart from the team's real work on every route, and `sandboxGuard` keeps them away from the rest of the admin.

![Tasks board in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-tasks/docs/admin-tasks.png)

**Live demo:** Medusa admin [medusa.koda.plus/app/tasks](https://medusa.koda.plus/app/tasks?demo=en), signed in to a public demo account by the link itself. The demo account is a sandbox account: it works on the sandbox board with sample tasks, and never sees the board Koda Plus runs its own roadmap on.

## What it does

- **One board for everyone in the admin**: backlog, to do, in progress, in review, done and rejected, with priorities, assignees, due dates and tags. Drag a card to another column or another place; open it to change anything, comment and link it.
- **Tasks next to the store's records**: link a task to an order, a product or a customer. Their pages list the linked tasks and start a new one with the record already linked.
- **A log of everything**: who created, moved, assigned, commented and linked what, and when, per task and across the board.
- **Scripts and AI agents as teammates**: a secret API key titled `tasks: ...` creates, moves and comments on tasks through the same routes as the board and reaches nothing else of the store; its comments carry the role `claude`, shown as "AI agent", under the name the request sends (never a teammate's).
- **Events for the rest of your stack**: `tasks.task.created`, `.updated`, `.status_changed`, `.deleted` and `tasks.comment.created`.
- **A sandbox for demo accounts**: accounts listed in `sandboxAccounts` only ever see and change the sandbox board, seeded with sample tasks and reset on demand or every day; with `sandboxGuard` they also stay away from invites, admin users, API keys and every write outside Tasks.
- **Takes over the KODA Panel module**: stores that ran the earlier Koda Plus app module get its tasks, comments and activity copied by the migration, with the same ids and dates.

## Features

- **Tasks page in the admin** with three views switched in the header: **Panel** (counters, the board or the roadmap, filters, recent activity), **Setup guide** (also as `?view=guide`) and **Settings** (`?view=settings`). `?task=<id>` opens a task directly.
- **Drag and drop** within and between columns. A drop names the card's new neighbours, so it lands in the right place even when filters hide part of the column; both columns are numbered again in one transaction under a lock of the board.
- **Roadmap view**: the same tasks by due month (earlier, this month and the two after it, later, no due date), with progress per month and who does what.
- **Counters** for open tasks, in progress, in review, overdue, urgent and high, unassigned, done and rejected; the overdue, urgent and unassigned tiles filter the board.
- **Filters** by text, assignee, tag and priority.
- **Assignees** are admin users, shown with their avatar or initials. Free text still works (rows of the KODA Panel module, a script that names a role), and the `people` option gives such names a photo and a role line.
- **Comments** with the author's role: store team, agency (`agencyAccounts`) or AI agent. Authors edit and delete their own.
- **Widgets** on the order, product and customer pages: the linked tasks, open ones first, and "New task" with the record linked.
- **Links read live**: a link stores the record's id only; the order number, product title or customer name come from Medusa when shown.
- **Setup guide** in the admin with live step states, a ready-to-copy API example, a checklist and troubleshooting, in English and Polish.
- **Admin in English and Polish** through the Medusa admin translations.
- **Workflows included** for creating, updating, moving, deleting, commenting and linking from your own code.

## Requirements

- Medusa 2.12 or newer (tested on 2.15.3) and Node.js 20+.
- Postgres, as every Medusa store has.

## Installation

```bash
npm install @koda-plus/medusa-plugin-tasks
```

Yarn and pnpm work the same way: `yarn add @koda-plus/medusa-plugin-tasks` or `pnpm add @koda-plus/medusa-plugin-tasks`.

## Configuration

Add the plugin to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-tasks",
      options: {
        // Everything is optional.
        agencyAccounts: ["@your-agency.com"],
        sandboxAccounts: (process.env.TASKS_SANDBOX_ACCOUNTS ?? "").split(",").filter(Boolean),
        sandboxGuard: true, // with a public demo account: it stays inside Tasks
      },
    },
  ],
})
```

Run the migrations, then open **Tasks** in the admin sidebar:

```bash
npx medusa db:migrate
```

The migration creates five tables of the module: `tasks_task`, `tasks_comment`, `tasks_activity`, `tasks_link` and `tasks_setting`.

### Options

- `agencyAccounts` (default: none): admin users whose comments read as the agency's, by e-mail or by whole domain (`"@your-agency.com"`). Everyone else writes as the store team. A comma separated string works too. The role is a label on comments, not a permission: it grants nothing.
- `sandboxAccounts` (default: none): admin user e-mails that only ever see and change the sandbox board. For a public demo account. A comma separated string works too, so an environment variable can hold the list.
- `sandboxResetHours` (default `24`): the sandbox board is seeded with the sample tasks again after this many hours, by the hourly `tasks-sandbox` job or when a sandbox account opens the Tasks page. `0` reseeds it only on **Reset the sandbox**.
- `sandboxGuard` (default: off): `true`, or `{ allowWrites: ["/admin/views"] }` for more route prefixes a sandbox account may write to. Sandbox accounts and the keys they created then get 403 `sandbox_guard` on invites, admin users (except their own profile, where only the language form passes), API keys, workflow executions, notifications outside the feed, and on every write outside `/admin/tasks`. Turn it on for any account the public can sign in to. While sandbox accounts are configured without it, Medusa logs a warning at start.
- `sandboxEvents` (default `"skip"`): the sandbox board emits no events; `"emit"` sends them with `demo: true`.
- `sandboxLimits` (default `{ tasks: 200, commentsPerTask: 50, writesPerMinute: 60 }`): the shared sandbox board answers 409 `sandbox_full` past the tasks or comments limit and 429 `sandbox_busy` past the changes per minute of one account (counted per server process). `false` lifts them.
- `sandboxSeedLinks` (default `"product"`): what the sample tasks link to: the newest product only, `"all"` (also the newest order and its customer, for stores with demo data only, since every visitor sees them) or `"none"`.
- `agentKeyPrefix` (default `"tasks:"`): a secret API key whose title starts with this text (without case) reaches only `/admin/tasks` routes; every other admin route answers 403 `agent_key_scope`. `false` turns it off.
- `people` (default: none): faces for free text names on the board, `[{ name, avatar?, role?, kind? }]`. `name` is matched without case against free text assignees and comment authors; `avatar` is a `data:image/...;base64,` URI (up to about 64 KB) or an https URL; `role` is one text or `{ en, pl }`, shown under the name; `kind: "agent"` marks an AI agent or an automation. These names are offered in the assignee picker next to the admin users; any other name shows initials. The plugin ships no photos. Sandbox accounts do not get the list.
- `references` (default: none): stores running the plugin, shown as "Running in stores" in the header and at the end of the setup guide. Each entry: `name`, `url` (https), and optionally `icon`, `description` (a string or `{ en, pl }`), `metrics` and `links`. A store that starts on Medusa soon gets `soon: true`: it is shown with a "Soon" badge and no link, and its `url` is optional.

Entries that make no sense are dropped and broken values fall back to their defaults: no option can stop Medusa from starting.

```ts
people: [
  { name: "Anna", avatar: "https://cdn.your-store.com/team/anna.webp", role: { en: "Store manager", pl: "Kierowniczka sklepu" } },
  { name: "Frontend", role: "The agency's frontend team" },
  { name: "Claude Code", kind: "agent", role: "AI agent in our repository" },
],
```

### Who works on which board

Every admin user works on the main board, the team's. Accounts in `sandboxAccounts` work on the sandbox board instead, and nothing else: the board is decided on the server from the account behind each request, never from the request itself, and every read and write of every route is bound to that board. A task, comment or link of the other board answers 404, exactly like one that does not exist, whatever id is sent. A secret API key works on the board of the admin user who created it.

The sandbox board is seeded with nine sample tasks of an ordinary store week (in both admin languages, linked to the store's newest product, see `sandboxSeedLinks`) when a sandbox account opens the Tasks page and the board is not seeded yet or older than `sandboxResetHours`, by the hourly `tasks-sandbox` job after `sandboxResetHours`, and on **Reset the sandbox** (More actions, or Settings, Sandbox). Reading the board, a widget or a summary never seeds or resets it. Every sandbox account shares the one sandbox board.

**What the sandbox does not do on its own.** It keeps the board apart, not the rest of the store: outside Tasks a sandbox account is still an admin user of Medusa. Without `sandboxGuard` (or a guard of your own in the app) it could invite a new admin user, accept that invite under another e-mail and land on the main board, read the team's e-mails or change the store's settings. Set `sandboxGuard: true` for every account the public can sign in to.

## Automation and AI agents

Scripts, CI jobs and AI agents use the same admin routes as the board, with a Medusa secret API key. Create one in **Settings**, **Secret API Keys** with a title that starts with `tasks:` (for example `tasks: Support agent`): the plugin lets such a key reach only the `/admin/tasks` routes, and every other admin route answers 403 `agent_key_scope`. A key with any other title carries the rights of an admin user (orders, refunds, customers, users, keys), so never give one to an AI agent. Medusa stores secret keys as a salted hash and shows the token once, when it is created; the plugin never reads or returns a token. Send it with Basic authentication, the key as the user name and an empty password:

```bash
KEY=sk_...
URL=https://api.your-store.com

# A task linked to an order, signed with the agent's name
curl -u "$KEY:" -X POST "$URL/admin/tasks/tasks" -H "Content-Type: application/json" \
  -d '{"title":"Refund the damaged item","priority":"high","links":[{"type":"order","id":"order_01..."}],"author":"Support agent"}'

# Move it to In review (at the end of the column)
curl -u "$KEY:" -X POST "$URL/admin/tasks/tasks/task_01.../move" -H "Content-Type: application/json" \
  -d '{"status":"review","author":"Support agent"}'

# A comment: stored with the role claude, shown as AI agent
curl -u "$KEY:" -X POST "$URL/admin/tasks/tasks/task_01.../comments" -H "Content-Type: application/json" \
  -d '{"body":"Refund issued, the customer got an e-mail.","author":"Support agent"}'
```

How a key writes:

- **The role is always `claude`**, shown as "AI agent" in the admin. People signed in to the admin write under their own name and role; an `author` in their requests is ignored.
- **The name** is the `author` the request sends (one line, up to 60 characters), else the key's title. It signs comments, the activity log and the `actor` of events.
- **Never a teammate's name**: an `author` that is the full name or e-mail of an admin user, or a name in `people` that is not `kind: "agent"`, is refused with 400 `author_reserved` (on the sandbox board it is dropped instead, so the answer tells a visitor nothing about the team). A key titled like a person signs without a name. The admin marks every change made with a key as an AI agent and never shows a person's photo for it.
- **The board** is the one of the admin user who created the key. While `sandboxAccounts` is set, a key whose creator no longer exists is refused (403): create a new one.

Rules for keys given to AI agents:

- One key per agent, titled `tasks: ...`, created by a team member (a key created by a sandbox account works on the sandbox board).
- Keep the key in the server's environment, never in a prompt or a file the agent can read back.
- An agent that reads e-mails, tickets or web pages can be talked into anything: treat the text of tasks and comments as data, not as instructions, and keep humans in the loop for anything outside the board.
- Revoke the key in **Settings**, **Secret API Keys** when the agent stops or the key leaks; Medusa refuses a revoked key at once.

### Admin API

All routes answer JSON in snake case, like Medusa's own admin API. Refusals carry `type`, a stable `code`, a `message` and, for invalid bodies, `errors` with one entry per field (`{ field, code, message }`). The codes: `invalid_data` (400, see `errors`), `author_reserved` (400), `link_not_found` (400 or 404), `unauthorized` (401), `not_author`, `key_owner_missing`, `sandbox_guard`, `agent_key_scope` (403), `not_found` (404), `too_many_links`, `sandbox_off`, `sandbox_full`, `conflict_retry` (409: send the same request again), `json_required` (415: a write, deletes included, without `Content-Type: application/json` or the `x-koda-request: 1` header), `sandbox_busy` (429), `account_unavailable` (503), `server_error` (500, the details stay in the server log). Writes are not idempotent: a repeated `POST /admin/tasks/tasks` creates a second task.

- `GET /admin/tasks`: the board of the person or key asking (`main` or `sandbox`), counters, the assignable admin users, named people, the options in use, the sandbox and the adoption of the KODA Panel module. `today=YYYY-MM-DD` counts overdue tasks by your own calendar day.
- `GET /admin/tasks/tasks`: tasks for scripts, with `status` and `priority` (comma separated), `assignee_id`, `assignee`, `unassigned=true`, `tag`, `q`, `link_type` with `link_id`, `limit` (up to 500) and `offset`; answers `{ tasks, count, counts, limit, offset }`. `view=board` answers every open task (up to 1000, `hidden_open` counts the rest) and the latest closed ones (`closed_limit` per closed column, default 100), as the admin page reads them.
- `POST /admin/tasks/tasks`: `title` (required), `description`, `status` (default `todo`), `priority` (default `medium`), the assignee as `assignee_id`, `assignee_email` or free text `assignee`, `due_date` (`YYYY-MM-DD`; a full timestamp counts by its UTC day), `tags`, `links` (`[{ type, id }]`), `author`. Answers `{ task }` (201).
- `GET /admin/tasks/tasks/:id`: one task with its comments, links and activity.
- `POST /admin/tasks/tasks/:id`: changes any of `title`, `description`, `status` (the task goes to the end of its new column), `priority`, the assignee (null to unassign), `due_date` (null to clear) and `tags`.
- `POST /admin/tasks/tasks/:id/move`: `{ status, after_id?, before_id? }`, the drag and drop. Done and rejected are ordered by when tasks closed, so a move there changes the status only.
- `DELETE /admin/tasks/tasks/:id`: deletes the task with its comments and links (soft delete); its activity stays in the log.
- `GET` and `POST /admin/tasks/tasks/:id/comments`: comments, oldest first; `{ body }` adds one.
- `POST` and `DELETE /admin/tasks/comments/:id`: the author changes or deletes their comment; the earlier text stays in the task's log (`comment_edited`, `comment_deleted`).
- `GET /admin/tasks/tasks/:id/activity`: the task's log, newest first.
- `POST /admin/tasks/tasks/:id/links`: `{ type: "order" | "product" | "customer", id }`; linking twice changes nothing. `DELETE /admin/tasks/tasks/:id/links/:link_id` unlinks.
- `GET /admin/tasks/activity`: the latest activity across the board.
- `GET /admin/tasks/orders/:id`, `/products/:id`, `/customers/:id`: tasks linked to that record, for the widgets.
- `POST /admin/tasks/sandbox/ensure`: seeds the sandbox board when it is stale (`sandbox_board.stale` in the status), for the Tasks page of a sandbox account; `{ seeded }`. A no-op for the team.
- `POST /admin/tasks/sandbox/reset`: the sandbox board back to its sample tasks (a second reset within ten seconds changes nothing).

### Workflows

```ts
import { createTaskWorkflow, moveTaskWorkflow, addTaskCommentWorkflow } from "@koda-plus/medusa-plugin-tasks/workflows"

const { result: task } = await createTaskWorkflow(container).run({
  input: { task: { title: "Call the customer back", links: [{ type: "order", id: order.id }] }, actor_name: "Order watcher" },
})
await moveTaskWorkflow(container).run({ input: { id: task.id, status: "in_progress", actor_name: "Order watcher" } })
await addTaskCommentWorkflow(container).run({ input: { task_id: task.id, body: "Left a voicemail.", actor_name: "Order watcher" } })
```

The bodies are the same as the admin API's. Changes are made on the main board (or `board: "sandbox"`) by the plugin itself (`system`) under `actor_name`, with the role `actor_role` (default `claude`, shown as "AI agent"; `agency` or `client` for the store's own automations); with `user_id` they are made as that admin user, on that user's board. `updateTaskWorkflow`, `deleteTaskWorkflow` and `linkTaskWorkflow` complete the set; editing and deleting comments has no workflow, call the routes or `editComment` and `deleteComment` from `/workflows`.

## Events

Each change emits one event on the Medusa event bus after it is stored:

- `tasks.task.created`: a task was created.
- `tasks.task.updated`: title, description, priority, assignee, due date, tags or links changed; `changes` lists which.
- `tasks.task.status_changed`: the status changed, by a drag, a status picked in the task or a script; `previous_status` says from where.
- `tasks.task.deleted`: a task was deleted.
- `tasks.comment.created`: a comment was added.

A request that changes the status and another field emits both `status_changed` and `updated`, each about its own part. Reordering cards within a column emits nothing.

The task events carry:

```ts
{
  id: string                // the task
  board: string             // "main", or "sandbox"
  title: string
  status: "backlog" | "todo" | "in_progress" | "review" | "done" | "rejected"
  previous_status: string | null // null for created; equal to status when it did not change
  priority: "low" | "medium" | "high" | "urgent"
  assignee: string | null   // the name shown
  assignee_id: string | null // the admin user, when assigned to one
  due_date: string | null   // ISO 8601
  tags: string[]
  links: Array<{ type: "order" | "product" | "customer"; id: string }>
  changes: string[]         // updated only: "title", "description", "priority", "assignee", "due_date", "tags", "links"
  actor: { type: "user" | "api-key" | "system"; id: string | null; name: string | null; role: "agency" | "client" | "claude" }
  demo: boolean             // the sandbox board
}
```

`tasks.comment.created` carries `id` (the comment), `task_id`, `board`, the task's `title`, `status`, `priority`, `assignee`, `assignee_id` and `links`, the comment's `author_role`, `actor` and `demo`.

The sandbox board emits nothing unless `sandboxEvents: "emit"`; then its events carry `demo: true`, and subscribers that notify people or write to other systems must skip them (a public visitor wrote that text). The shape is a contract: fields and events may be added, none is renamed, removed or retyped.

```ts
// src/subscribers/tasks-notify.ts
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

export default async function tasksNotify({ event }: SubscriberArgs<{ title: string; status: string; demo: boolean }>) {
  if (event.data.demo) return
  if (event.data.status === "review") {
    // post `${event.data.title} is ready for review` to Slack or Discord
  }
}

export const config: SubscriberConfig = { event: "tasks.task.status_changed" }
```

## Upgrading from the KODA Panel module

Koda Plus stores ran the board earlier as app code, the "KODA Panel" module, with the tables `task`, `task_comment` and `activity_log`. The migration of this plugin takes them over:

1. It reads the columns of those tables from the catalog. Every known copy of the module matches: with `tags` or with a single `category` (which becomes a tag), with or without `activity_log.metadata`, and with the AI agent's comments stored as `claude` or as `koda` (read as `claude`).
2. When they have that shape and the new tables are still empty, it copies every row into the new tables, on the main board: the same ids, timestamps and soft deletes, statuses, priorities, positions, assignees (as free text names), comments with their authors and roles, the activity log. Done tasks get `completed_at` from when they last changed. Every copied row is marked `metadata.adopted_from = "koda-panel"`.
3. It records what it did in `tasks_setting` (`legacy:adoption`): the counts of the old tables and of the copied rows. Settings, General shows it.

The old tables are only read: never dropped, renamed or altered, so nothing is lost. The copy runs once, inside the migration: deploy the migration together with the removal of the old module (or stop writing to it first), because rows written to the old tables after the migration are not copied. A table called `task` that is not the KODA Panel's (another module's) does not match the shape: nothing is copied and the marker says why. Running the migration again copies nothing.

Then remove the old module, its admin routes, workflows and page from the app. The admin API moves from `/admin/koda-panel/tasks` to `/admin/tasks/tasks`; task ids stay the same. To give the old free text names (a first name, "AI helper") a face, list them in `people`.

## Security and data

- **Admin only.** Every route is under `/admin`, behind Medusa's own authentication: a signed in admin user or a secret API key. Nothing is exposed to the storefront, and the plugin reads no order or cart metadata.
- **Writes from the admin or a server only.** Writes to `/admin/tasks/*` take a JSON body or the `x-koda-request` header and answer 415 otherwise: Medusa's session cookie is `SameSite=None` in production, so a form on another site could otherwise post with it. The plugin's admin sends both, with the dashboard's session or JWT.
- **Keys for AI agents reach only Tasks** (`agentKeyPrefix`), sign with their own name only, and are never shown with a person's photo. The plugin never reads, stores or returns key tokens.
- **Sandbox accounts** are kept to their board on every route; with `sandboxGuard` also away from invites, admin users, API keys, workflow executions, notifications outside the feed and every write outside Tasks. Their changes are paced (`sandboxLimits`) and emit no events by default.
- **Boards decided on the server.** The board comes from the account behind the request (and, for a key, from the account that created it); every statement of every route is bound to it. A sandbox account cannot read or change a task, comment, link or activity entry of the main board, not even by guessing ids, and sees neither the team's admin users nor the option lists. When the account behind a request cannot be read while sandbox accounts are configured, the request is refused (503) instead of guessed.
- **Plain text.** Titles, descriptions, comments, tags and names are stored as plain text, with control characters and bidirectional overrides removed; every screen escapes them. Bodies have length limits (title 200, description 10 000, comment 5 000 characters).
- **Links store ids only.** No order, product or customer data is copied into the module's tables; names are read from Medusa when shown.
- **What is stored:** tasks, comments, activity entries, links and two settings (the sandbox seed, the adoption marker). Authors, assignees and actors are stored by id (admin user or API key) and display name: the admin user's name, or their e-mail when the account has no name, or the name a script sent.
- **Deletes are soft, the log only grows.** A deleted task keeps its rows with `deleted_at`, together with its comments and links; its activity entries stay, and so do the earlier texts of edited and deleted comments.
- **Reads do not write.** `GET` routes only read: the sandbox is seeded by `POST /admin/tasks/sandbox/ensure` and the job.
- **Errors.** Unexpected server errors answer a plain sentence (`server_error`); the details stay in the server log, with keys and connection strings masked. Photos are shown only from https or image data URIs, without a referrer.

## What this plugin does not do

- It does not send notifications or e-mails: it emits events for whatever sends them.
- It does not show tasks to customers or on the storefront.
- It does not manage permissions within the team: every admin user (except sandbox accounts) works on the main board.
- It does not attach files to tasks or comments.
- It does not track time, estimates or sprints.
- It does not change orders, products or customers: links only point at them.
- It does not drop or change the KODA Panel tables it takes over.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm test` covers the options, the `people` and `references` parsers, the status and position rules, due dates, request validation, the request context (boards for users and keys, failing closed), the isolation of the sandbox on every admin route, the flows end to end, API key authors, links, the sample tasks, the events and the adoption of the KODA Panel tables (the shape check against every known copy and the SQL the migration sends), plus every SQL statement of the stores bound to its board. With `TASKS_TEST_PG_URL` set to a scratch Postgres, one more test runs the migration (twice, on two copies of the old tables and on a foreign `task` table), every statement and the admin routes against a real database, in a schema of its own that it drops afterwards. To try the plugin in a Medusa app, run `npx medusa plugin:publish` here, then `npx medusa plugin:add @koda-plus/medusa-plugin-tasks` in the app.

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland. Koda Plus runs its own roadmap on this board, next to its OLX, Allegro, BaseLinker, Subiekt nexo and Fakturownia integrations. Need it wired into your team's tools, notifications or an AI agent of your own? Write to kontakt@koda.plus.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-tasks/LICENSE).

## Changelog

### 0.1.0 (2026-10-07)

First public release, a generic version of the KODA Panel module Koda Plus built for its stores: the board with drag and drop, the roadmap view, the task drawer with comments and the activity log, links to orders, products and customers with their widgets, admin users as assignees, secret API keys for scripts and AI agents, five documented events, the sandbox board for demo accounts, named people, and the adoption of the KODA Panel tables.
