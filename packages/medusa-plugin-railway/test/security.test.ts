/**
 * The two promises of the plugin about safety: it never sends a GraphQL
 * mutation (Railway tokens are not read only), and nothing that looks like a
 * secret reaches the browser.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { assertReadOnlyDocument, ForbiddenDocumentError, maskSecrets, maskSecretsCounted, safeId, stripDocument } from "../src/modules/railway/lib/security.ts"
import { ALL_DOCUMENTS, errorScanDocument } from "../src/modules/railway/lib/queries.ts"
import { RailwayReadClient } from "../src/modules/railway/lib/client.ts"
import { FakeRailway, TOKEN, pgUrl } from "./fixtures.ts"
import { noSleep } from "./harness.ts"

test("guard: every document the plugin sends is a query", () => {
  for (const doc of ALL_DOCUMENTS) assert.equal(assertReadOnlyDocument(doc), doc)
  assert.equal(assertReadOnlyDocument(errorScanDocument(0)), errorScanDocument(0))
  assert.equal(assertReadOnlyDocument("{ me { name } }"), "{ me { name } }")
})

test("guard: a mutation is refused in any spelling, also hidden in a comment or a string", () => {
  const bad = [
    'mutation { serviceDelete(id: "x") }',
    'MUTATION { variableUpsert(input: {}) }',
    'query A { me { name } }\nmutation B { deploymentRedeploy(id: "x") { id } }',
    "query { me { name } } # mutation",
    'query { project(id: "mutation") { id } }',
    "  \n\tmutation\n{ x }",
    "subscription { deploymentLogs(deploymentId: \"x\") { message } }",
  ]
  for (const doc of bad) assert.throws(() => assertReadOnlyDocument(doc), ForbiddenDocumentError, doc)
})

test("guard: a document that is not a query is refused, and so is an empty one", () => {
  for (const doc of ["", "   ", "fragment F on User { name }", "garbage"]) assert.throws(() => assertReadOnlyDocument(doc), ForbiddenDocumentError, doc)
  assert.throws(() => assertReadOnlyDocument(42 as unknown as string), ForbiddenDocumentError)
  assert.equal(stripDocument('query { a(x: "# not a comment") } # gone').includes("gone"), false)
})

test("guard: the client refuses a mutation before anything is sent", async () => {
  const fake = new FakeRailway({})
  const client = new RailwayReadClient({ token: TOKEN, fetch: fake.fetch, clock: noSleep })
  await assert.rejects(() => client.query('mutation { serviceDelete(id: "x") }', {}, "project"), (err: Error & { kind?: string }) => err.kind === "forbidden")
  assert.equal(fake.calls.length, 0, "no request may leave for a refused document")
})

test("masking: credentials in connection URLs keep the user and host, never the password", () => {
  const out = maskSecrets(`connect ${pgUrl()} ok`)
  assert.equal(out, "connect postgres://medusa:***@db.internal:5432/railway ok")
  const redis = ["redis://default", ":", "abcDEF123456", "@redis.railway.internal:6379"].join("")
  assert.equal(maskSecrets(redis), "redis://default:***@redis.railway.internal:6379")
  /* A URL without credentials stays readable. */
  assert.equal(maskSecrets("GET https://api.example.com/store/products 200"), "GET https://api.example.com/store/products 200")
})

test("masking: API keys, bearer tokens, JWTs and secret-named variables", () => {
  const stripe = "sk_" + "live_" + "A1b2C3d4E5f6G7h8"
  const resend = "re_" + "AbCd1234_EfGh5678IjKl"
  const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJ1c2VyIn0", "c2lnbmF0dXJlLXZhbHVl"].join(".")
  const text = [
    `stripe key ${stripe}`,
    `resend ${resend}`,
    "Authorization: Bearer abc.def-ghi",
    `token ${jwt}`,
    "JWT_SECRET=supersecret123",
    '"COOKIE_SECRET": "abc123"',
    "DATABASE_PASSWORD: hunter2",
    "callback?token=abcdef&x=1",
    "Project-Access-Token: 0000-1111",
  ].join("\n")
  const { text: out, masked } = maskSecretsCounted(text)
  assert.ok(!out.includes("A1b2C3d4E5f6G7h8"))
  assert.ok(out.includes("sk_live_***"))
  assert.ok(out.includes("re_***") && !out.includes("EfGh5678"))
  assert.ok(out.includes("Bearer ***"))
  assert.ok(!out.includes("c2lnbmF0dXJlLXZhbHVl"))
  assert.ok(out.includes("JWT_SECRET=***"))
  assert.ok(out.includes('"COOKIE_SECRET": "***"'))
  assert.ok(out.includes("DATABASE_PASSWORD: ***"))
  assert.ok(out.includes("?token=***&x=1"))
  assert.ok(out.includes("Project-Access-Token: ***"))
  assert.ok(masked >= 9, `masked ${masked}`)
})

test("masking: the configured token literally, and long token-like runs", () => {
  assert.equal(maskSecrets(`token is ${TOKEN}!`, [TOKEN]), "token is ***!")
  assert.equal(maskSecrets("a".repeat(48)), "***")
  /* Short secrets in the list are ignored (they would mask ordinary words). */
  assert.equal(maskSecrets("the cat sat", ["cat"]), "the cat sat")
  /* Ordinary log words stay. */
  for (const line of ["Author: Anna", "3 tokens left", "Server is ready on port 9000", "commit 0123abc by Jan"]) assert.equal(maskSecrets(line), line)
})

test("ids: only letters, digits and dashes reach a variable or a link", () => {
  assert.equal(safeId("a0000000-0000-4000-8000-000000000001"), "a0000000-0000-4000-8000-000000000001")
  for (const bad of ["", "ab", "../etc", 'x"}', "a b c", "x".repeat(65), null, 12]) assert.equal(safeId(bad), null, String(bad))
})
