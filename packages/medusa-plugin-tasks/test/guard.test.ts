/**
 * THE ADMIN GUARD. An AI agent's key (title starting with "tasks:") reaches
 * only Tasks; with `sandboxGuard`, a sandbox account and its keys stay away
 * from invites, admin users, API keys, workflow executions and notifications
 * outside the feed, and write nothing outside Tasks (their own profile:
 * the language form only). Paths are compared decoded, without case, with
 * dot segments resolved.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { guardDecision, normalizeAdminPath, ownProfileWriteAllowed, type GuardActor } from "../src/modules/tasks/lib/guard.ts"
import { isAgentKeyTitle, resolveOptions } from "../src/modules/tasks/lib/options.ts"
import { tasksAdminGuard } from "../src/workflows/tasks/guard.ts"
import { DEFAULT_OPTIONS, setup, type Setup } from "./helpers.ts"

const SANDBOX: GuardActor = { type: "user", sandbox: true, agentKey: false, userId: "user_demo" }
const TEAM: GuardActor = { type: "user", sandbox: false, agentKey: false, userId: "user_team" }
const AGENT: GuardActor = { type: "api-key", sandbox: false, agentKey: true, userId: null }
const on = { sandboxGuard: true, allowWrites: ["/admin/views"] }
const decide = (method: string, url: string, actor: GuardActor, opts = on, query: Record<string, unknown> = {}) => guardDecision({ method, url, query }, actor, opts)

test("paths: decoded, lower case, slashes folded, dot segments resolved; undecodable is null", () => {
  assert.equal(normalizeAdminPath("/admin/Invites/?limit=1"), "/admin/invites")
  assert.equal(normalizeAdminPath("/admin//tasks/../invites"), "/admin/invites")
  assert.equal(normalizeAdminPath("/admin/%69nvites"), "/admin/invites")
  assert.equal(normalizeAdminPath("/admin/tasks/%252e%252e/invites"), "/admin/invites")
  assert.equal(normalizeAdminPath("/admin\\api-keys"), "/admin/api-keys")
  assert.equal(normalizeAdminPath("/admin/%E0%A4%A"), null)
  assert.equal(normalizeAdminPath("/admin/a%00b"), null)
})

test("agent keys: only /admin/tasks, whatever the spelling; the prefix comes from the title", () => {
  assert.equal(decide("GET", "/admin/tasks/tasks", AGENT).allow, true)
  assert.equal(decide("POST", "/admin/tasks/tasks/task_1/comments", AGENT).allow, true)
  for (const url of ["/admin/orders", "/admin/customers?q=a", "/admin/tasks/../api-keys", "/admin/TASKS/../users", "/admin/tasksx", "/admin/%74asks/../invites"]) {
    const d = decide("GET", url, AGENT, { sandboxGuard: false })
    assert.equal(d.allow, false, url)
    assert.equal(!d.allow && d.code, "agent_key_scope", url)
  }
  const o = resolveOptions({})
  assert.equal(isAgentKeyTitle("Tasks: Claude Code", o), true)
  assert.equal(isAgentKeyTitle(" tasks:x", o), true)
  assert.equal(isAgentKeyTitle("Deploy bot", o), false)
  assert.equal(isAgentKeyTitle("Tasks: x", resolveOptions({ agentKeyPrefix: false })), false)
  assert.equal(isAgentKeyTitle("[agent] x", resolveOptions({ agentKeyPrefix: "[Agent]" })), true)
})

test("sandbox guard: closed routes, writes only in Tasks and the allowed prefixes, the own profile and the feed", () => {
  for (const url of ["/admin/invites", "/admin/invites/inv_1/resend", "/admin/users", "/admin/users/user_team", "/admin/api-keys", "/admin/workflows-executions/x", "/admin/notifications"]) {
    const d = decide("GET", url, SANDBOX)
    assert.equal(d.allow, false, url)
    assert.equal(!d.allow && d.code, "sandbox_guard")
  }
  assert.equal(decide("GET", "/admin/users/me", SANDBOX).allow, true)
  assert.equal(decide("GET", "/admin/users/USER_DEMO", SANDBOX).allow, true, "the own profile, any case")
  assert.deepEqual(decide("POST", "/admin/users/user_demo", SANDBOX), { allow: true, ownProfile: true })
  assert.equal(decide("DELETE", "/admin/users/user_demo", SANDBOX).allow, false)
  assert.equal(decide("GET", "/admin/notifications", SANDBOX, on, { channel: "feed" }).allow, true)
  assert.equal(decide("GET", "/admin/notifications", SANDBOX, on, { channel: ["feed", "email"] }).allow, false)
  assert.equal(decide("GET", "/admin/notifications", SANDBOX, on, { channel: "email" }).allow, false)
  assert.equal(decide("GET", "/admin/orders", SANDBOX).allow, true, "reads elsewhere stay")
  assert.equal(decide("POST", "/admin/orders/order_1/cancel", SANDBOX).allow, false)
  assert.equal(decide("DELETE", "/admin/products/prod_1", SANDBOX).allow, false)
  assert.equal(decide("POST", "/admin/tasks/tasks", SANDBOX).allow, true)
  assert.equal(decide("POST", "/admin/views/orders/configurations", SANDBOX).allow, true, "allowWrites")
  assert.equal(decide("POST", "/admin/viewsx", SANDBOX).allow, false, "a prefix ends at a segment")
  /* The team, and the guard off, pass. */
  assert.equal(decide("POST", "/admin/invites", TEAM).allow, true)
  assert.equal(decide("POST", "/admin/invites", SANDBOX, { sandboxGuard: false }).allow, true)
  /* A sandbox account's key: no own profile. */
  assert.equal(decide("GET", "/admin/users/me", { ...SANDBOX, type: "api-key", userId: null }).allow, false)
})

test("own profile: the language form sends the names unchanged; a new name, a photo or an e-mail is refused", () => {
  const current = { first_name: "Demo", last_name: null }
  assert.equal(ownProfileWriteAllowed({ first_name: "Demo", last_name: "" }, current), true)
  assert.equal(ownProfileWriteAllowed({ metadata: { theme: "dark" } }, current), true)
  assert.equal(ownProfileWriteAllowed({ first_name: "Hacker", last_name: "" }, current), false)
  assert.equal(ownProfileWriteAllowed({ avatar_url: "https://tracker.example/pixel.png" }, current), false)
  assert.equal(ownProfileWriteAllowed({ email: "x@example.com" }, current), false)
})

/* ------------------------------------------------------------------ */
/* The middleware, on the fake container                               */
/* ------------------------------------------------------------------ */

async function run(s: Setup, actor: { actor_id: string; actor_type: string }, method: string, url: string, body: unknown = {}, query: Record<string, unknown> = {}) {
  const res = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(b: unknown) {
      this.body = b
      return this
    },
  }
  let passed = false
  const req = { scope: s.container, auth_context: actor, method, originalUrl: url, url: "/", query, body }
  await tasksAdminGuard()(req as never, res as never, (() => {
    passed = true
  }) as never)
  return passed ? "next" : `${res.statusCode} ${res.body?.code}`
}

const USER = (id: string) => ({ actor_id: id, actor_type: "user" })
const KEY = (id: string) => ({ actor_id: id, actor_type: "api-key" })

test("middleware: an agent key reaches only Tasks; other keys and users pass untouched", async () => {
  const s = setup()
  assert.equal(await run(s, KEY("apk_agent"), "GET", "/admin/orders?limit=5"), "403 agent_key_scope")
  assert.equal(await run(s, KEY("apk_agent"), "POST", "/admin/api-keys", { title: "escape" }), "403 agent_key_scope")
  assert.equal(await run(s, KEY("apk_agent"), "POST", "/admin/tasks/tasks"), "next")
  assert.equal(await run(s, KEY("apk_team"), "GET", "/admin/orders"), "next")
  assert.equal(await run(s, USER("user_demo"), "POST", "/admin/invites"), "next", "without sandboxGuard the app decides")
  const off = setup({ ...DEFAULT_OPTIONS, agentKeyPrefix: false })
  assert.equal(await run(off, KEY("apk_agent"), "GET", "/admin/orders"), "next")
})

test("middleware: with sandboxGuard, sandbox accounts and their keys stay inside Tasks; the team is not slowed down", async () => {
  const s = setup({ ...DEFAULT_OPTIONS, sandboxGuard: { allowWrites: ["/admin/views"] } })
  assert.equal(await run(s, USER("user_demo"), "GET", "/admin/invites"), "403 sandbox_guard")
  assert.equal(await run(s, USER("user_demo"), "POST", "/admin/invites", { email: "me@example.com" }), "403 sandbox_guard")
  assert.equal(await run(s, USER("user_demo"), "GET", "/admin/users"), "403 sandbox_guard")
  assert.equal(await run(s, USER("user_demo"), "GET", "/admin/users/me"), "next")
  assert.equal(await run(s, USER("user_demo"), "POST", "/admin/users/user_demo", { first_name: "Demo", last_name: "" }), "next", "the language form")
  assert.equal(await run(s, USER("user_demo"), "POST", "/admin/users/user_demo", { first_name: "Someone else" }), "403 sandbox_guard")
  assert.equal(await run(s, USER("user_demo"), "POST", "/admin/products", { title: "x" }), "403 sandbox_guard")
  assert.equal(await run(s, USER("user_demo"), "POST", "/admin/views/orders/configurations"), "next")
  assert.equal(await run(s, USER("user_demo"), "GET", "/admin/orders"), "next")
  assert.equal(await run(s, USER("user_demo"), "POST", "/admin/tasks/tasks"), "next")
  assert.equal(await run(s, KEY("apk_demo"), "POST", "/admin/api-keys"), "403 sandbox_guard")
  assert.equal(await run(s, KEY("apk_demo"), "GET", "/admin/workflows-executions"), "403 sandbox_guard")
  assert.equal(await run(s, KEY("apk_orphan"), "GET", "/admin/invites"), "403 sandbox_guard", "a key whose creator is gone cannot prove it is not the sandbox's")
  assert.equal(await run(s, USER("user_team"), "POST", "/admin/invites"), "next")
  assert.equal(await run(s, KEY("apk_team"), "POST", "/admin/products"), "next")
  s.failUsers.on = true
  assert.equal(await run(s, USER("user_demo2"), "GET", "/admin/invites"), "503 account_unavailable", "fails closed")
})
