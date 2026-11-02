# Changelog

## 0.1.0 (unreleased)

### Added

- An admin page "Railway" (`/app/railway`): tiles (services, running fine, problems, errors of the last hour, the highest memory), the problems worst first, one card per service with the state of the latest deployment, the commit, the uptime of the serving deployment, instances, memory and volumes.
- Per service: the last 20 deployments with state, start, duration, commit, author and a link to the Railway dashboard; runtime and build logs (errors only, text search, last 15 minutes, hour or 6 hours), masked and newest first; CPU, memory and network charts for 1, 6 or 24 hours; variable names with set, empty or reference; domains and volumes.
- Problems: a failed or crashed last deployment, crashed or restarting instances, memory or a volume at 85 % (orange) or 95 % (red), 20 or 100 error lines in the last hour, a custom domain without verification or certificate, a build running for 30 minutes.
- Read only by construction: fixed GraphQL queries with ids as variables, and a guard in the client that refuses any document with `mutation` or `subscription` before it is sent (Railway tokens are not read only).
- Masking of the token, credentials in URLs, API keys, bearer tokens, JWTs, secret-named variables and long token-like runs in every log line and commit message.
- Project tokens (`Project-Access-Token`) and account or workspace tokens (`Authorization: Bearer`, with `projectId`).
- A cache per read (60 s by default, single flight, the last good read when Railway does not answer), 2 requests a second and 300 an hour at most, Railway's own counter shown in the settings.
- Demo mode on a sample project through the same code path, a setup guide, settings, English and Polish.
- koda.integration/1: the manifest and three board counters (`deploys_failing`, `resources_high`, `errors_high`).
