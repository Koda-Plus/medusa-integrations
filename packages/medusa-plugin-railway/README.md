# Railway by Koda Plus

The production hosting of a [Medusa](https://medusajs.com) v2 store in its own admin. Every [Railway](https://railway.com) service of the project with the state of its last deployment, the commit and the uptime, the deployment history, runtime and build logs with secrets masked, CPU, memory and network charts, variable names (never values), domains, volumes and a list of what needs a look. Read only: GraphQL queries, never a mutation.

**Live demo:** [medusa.koda.plus/app/railway](https://medusa.koda.plus/app/railway?demo=en) runs the plugin in demo mode on a sample project.

## What it does

The office and the developers of a store check the hosting without a Railway login: did the last deploy go through, since when does the backend run, why did the storefront build fail, is Postgres running out of disk, is `STRIPE_READ_KEY` set at all. The plugin reads Railway's public GraphQL API v2 on the server with a token kept in an environment variable, and the admin page shows:

- **Problems:** a last deployment that failed or crashed, an instance that crashed or keeps restarting, memory or a volume near its limit (orange from 85 %, red from 95 %), many error lines in the last hour, a custom domain without verification or a valid certificate, a build stuck for 30 minutes. Worst first.
- **Services:** one card per service (apps first, then Postgres, Redis and the other databases) with the state of the latest deployment, its commit (short SHA, message, author), when, the uptime of the deployment that serves now, the instances, memory against its limit and the volumes.
- **Deployments:** the last 20 of a service with state, start, duration, commit and author, a link to the deployment in the Railway dashboard, and its runtime or build logs.
- **Logs:** runtime logs of the serving deployment (or any deployment from the history) and build logs of a failed one, newest first, monospace and wrapped; errors only, text search, the last 15 minutes, hour or 6 hours.
- **Metrics:** CPU, memory with the limit line and network in and out for the last hour, 6 hours or 24 hours.
- **Variables:** the names of a service's variables with "set", "empty" or "reference" (a `${{Postgres.DATABASE_URL}}` reference), never a value.
- **Domains and volumes:** Railway and custom domains with their state, volumes with their use.

## Features

- **Read only by construction.** Railway project tokens are not read only: they can redeploy, delete a service or change a variable, and Railway offers no read-only token. So the plugin keeps itself read only: it sends a fixed set of GraphQL queries, ids travel as variables, and the client refuses any document that contains `mutation` (or `subscription`) before anything leaves the server.
- **Secrets never reach the browser.** The token stays on the server. Variable values are asked for unrendered and reduced to one word per name. Every log line and commit message is masked before it is sent: credentials in URLs (`postgres://user:***@host`), Stripe, Resend, GitHub and npm keys, `Bearer` and `Basic` headers, JWTs, `SECRET=`, `TOKEN=`, `PASSWORD=` and similar, secret query parameters and long token-like runs. The panel says how many were masked.
- **Kind to the rate limit.** Railway allows 100 requests an hour on Free, 1 000 on Hobby and 10 000 on Pro, for the whole account. The overview is one GraphQL request for every service, one for the memory of all of them and one for the error counts; each read is cached (60 s by default, single flight, a forced refresh at most every 15 seconds, a failure remembered a minute, the last good read served when Railway does not answer); the log filters run over the cached read; and the plugin caps itself at 2 requests a second and 300 an hour.
- **Project or account tokens.** A project token (header `Project-Access-Token`) names its project and environment by itself; an account or workspace token (`Authorization: Bearer`) works with `projectId`.
- **Demo mode** on a sample project, through the same client, cache, shaping and masking.
- **Admin in English and Polish**, a setup guide, settings with the request counters, and the koda.integration/1 contract for Koda Plus hosts (board counters).

## Requirements

- Medusa 2.12 or newer (built and tested on 2.13 and 2.15), Node.js 20 or newer.
- A Railway project and a token: a project token from Project Settings, Tokens, or an account or workspace token.

## Installation

```bash
npm install @koda-plus/medusa-plugin-railway
```

No migration: the plugin keeps no tables.

## Configuration

```ts
// medusa-config.ts
plugins: [
  {
    resolve: "@koda-plus/medusa-plugin-railway",
    options: {
      token: process.env.RAILWAY_READ_TOKEN, // a project token names its project and environment
      // projectId: "...",            // only with an account or workspace token
      // environmentId: "...",        // default: the token's, or "production"
      // cacheSeconds: 60,
      // requestsPerHour: 300,        // the plugin's own cap
    },
  },
],
```

```bash
# .env of the backend (on Railway: the backend service, Variables)
RAILWAY_READ_TOKEN=<project token>
```

Without `token` the plugin reads the variable named by `tokenEnv` (default `RAILWAY_READ_TOKEN`). A missing token never breaks the boot: the page shows the setup.

### Options

- `token`: the Railway token. Server side only.
- `tokenEnv`: the environment variable to read the token from when `token` is not set. Default `RAILWAY_READ_TOKEN`.
- `tokenKind`: `"project"`, `"account"` or `"auto"` (default: a project token first, then Bearer).
- `projectId`, `environmentId`: the project and environment to show. A project token implies both; with an account token `projectId` is required and the environment defaults to `production` (or the first one).
- `dashboardUrl`: the Railway dashboard for the links. Default `https://railway.com`.
- `demo`: `true` shows a sample project; never turned on by a missing token.
- `cacheSeconds`: how long a read is reused. Default 60 (15 to 3600).
- `requestsPerSecond`, `requestsPerHour`: the plugin's own brakes. Defaults 2 and 300.
- `timeoutMs`: timeout of one request. Default 15000.
- `scanErrors`: count error lines of the last hour for the problems (one more request per overview). Default `true`.

## Setup in brief

1. In Railway open the project, Project Settings, Tokens, and create a token for the production environment.
2. Set it as `RAILWAY_READ_TOKEN` on the Medusa backend service and redeploy.
3. Add the plugin to `medusa-config.ts`.
4. Open Railway in the admin sidebar: the services of the token's environment, with the problems first.

## Admin API

Every route is a GET under `/admin/railway`, behind the admin session and the kit's write guard:

- `GET /admin/railway`: the setup (mode, missing options, the token kind once known, options, request counters). No call to Railway.
- `GET /admin/railway/overview?fresh=1`: services, deployments, instances, domains, volumes, memory, error counts and problems.
- `GET /admin/railway/services/:id/deployments`: the last 20 deployments.
- `GET /admin/railway/services/:id/metrics?range=1h|6h|24h`: CPU, memory and network.
- `GET /admin/railway/services/:id/variables`: variable names with `set`, `empty` or `reference`.
- `GET /admin/railway/deployments/:id/logs?kind=deploy|build&errors=1&q=&minutes=60&limit=300`: masked lines, newest first.

Ids from the browser are checked: a service must be one of the environment's, a deployment must belong to the project (otherwise 404).

## Works with Koda Plus hosts

The plugin answers the koda.integration/1 contract: `GET /admin/railway/integration` (the manifest), `/integration/summary` (no entities: every entity answers 400) and `/integration/attention?scope=integration` with three counters, each linked to `/railway?filter=problems`: `deploys_failing` (red), `resources_high` and `errors_high`. The counters reuse the overview the page read, up to 15 minutes old.

## Use it from your code

```ts
import { loadRailwayOverview } from "@koda-plus/medusa-plugin-railway/workflows"

const { problems } = await loadRailwayOverview(container)
```

`loadRailwayDeployments`, `loadRailwayLogs`, `loadRailwayMetrics` and `loadRailwayVariables` go through the same cache.

## Security and data

- The token is read on the server and never sent to the browser, the status route shows only its kind.
- Only GraphQL queries are sent, from fixed documents; the client's guard refuses a document with `mutation` or `subscription`, a test runs every document through it.
- Variable values are dropped on the server before anything is cached; the browser gets names and one word.
- Log lines and commit messages are masked before they leave; the search runs over the masked text, so it never finds a secret.
- Nothing is written to the database; the cache lives in memory per process.

## What this plugin does not do

- No redeploy, restart, rollback, variable change or any other write. Use the Railway dashboard (the page links there).
- No restart counter: Railway's public API shows the state of each instance (running, crashed, restarting), not how often it restarted.
- No HTTP request logs or log streaming: the newest lines of a read, refreshed on demand.
- No alerts by itself: the counters feed a Koda Plus host, and `loadRailwayOverview` can feed your own job.

## Uninstall

Remove the entry from `medusa-config.ts` and the variable; revoke the token in Railway. Nothing to clean in the database.

## Compatibility

Medusa 2.12 to 2.15, Railway public API v2 (`https://backboard.railway.com/graphql/v2`). The documents are checked against Railway's published schema.

## Development

```bash
npm install
npm test          # node --test on the pure logic, a fake Railway, no network
npm run typecheck
npm run build
```

## Commercial support

Built and maintained by [Koda Plus](https://koda.plus), a Medusa agency from Poland, for the stores we host on Railway. Need a hand with your hosting? Write to kontakt@koda.plus.

## Trademarks

Railway and the Railway logo are trademarks of Railway Corporation, used here only to identify the service this plugin reads from. The mark comes from [Simple Icons](https://simpleicons.org) (CC0). This is an independent integration built on Railway's public API, not affiliated with or endorsed by Railway.

## License

MIT, see [LICENSE](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-railway/LICENSE).

## Changelog

### 0.1.0 (unreleased)

The first version: services, deployments, logs, metrics, variable names, domains, volumes and problems, read only. Full list in [CHANGELOG.md](https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/medusa-plugin-railway/CHANGELOG.md).
