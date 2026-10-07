/**
 * The stored tokens survive configuration mistakes: a wrong encryption key or
 * a wrong client secret leaves them where they are (the status says why),
 * a rotated key reads them and stores them again under the new key, and only
 * Allegro's `invalid_grant` ends the connection. No network: `fetch` is a
 * script that answers like Allegro's OAuth server and API.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { oauthCode, AllegroApiError } from "../src/modules/allegro/lib/client.ts"
import { apiGet, isConnected, oauthHint, refreshEndsConnection, unreadableTokens } from "../src/modules/allegro/lib/connection.ts"
import { decrypt, decryptAny, encrypt, keyFromBase64 } from "../src/modules/allegro/lib/crypto.ts"
import { resolveOptions, type AllegroPluginOptions } from "../src/modules/allegro/lib/options.ts"
import { maskSecrets } from "../src/modules/allegro/lib/security.ts"

const KEY_A = Buffer.alloc(32, 7).toString("base64")
const KEY_B = Buffer.alloc(32, 9).toString("base64")
const BASE: AllegroPluginOptions = { clientId: "client-test", clientSecret: "secret-for-tests-only", encryptionKey: KEY_A, requestsPerMinute: 6000 }

type Row = Record<string, any>

function fakeSvc(options: AllegroPluginOptions, row: Row) {
  const rows: Row[] = [row]
  const o = resolveOptions(options)
  const logs: string[] = []
  return {
    rows,
    logs,
    getOptions: () => o,
    isDemo: () => false,
    isConfigured: () => true,
    mask: (s: string) => maskSecrets(s, [o.clientSecret, o.encryptionKey, ...o.previousEncryptionKeys]),
    getLogger: () => ({ info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }),
    listAllegroConnections: async () => rows.slice(0, 1),
    updateAllegroConnections: async (patch: Row) => {
      Object.assign(rows[0], patch)
      return rows[0]
    },
    createAllegroConnections: async (r: Row) => {
      rows.push(r)
      return r
    },
  }
}

function storedRow(key: string, accessFresh: boolean): Row {
  const k = keyFromBase64(key)
  return {
    id: "default",
    environment: "production",
    refresh_token_enc: encrypt("refresh-token-value-0001", k),
    access_token_enc: encrypt("access-token-value-0001", k),
    access_expires_at: new Date(Date.now() + (accessFresh ? 3_600_000 : -60_000)),
    refreshed_at: new Date(),
    connected_at: new Date(),
    disconnected_at: null,
    scope: "allegro:api:sale:offers:read",
    device_code_enc: null,
    last_error: null,
    last_error_at: null,
    version: 1,
  }
}

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

async function withFetch<T>(script: (url: string) => Response, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => script(String(input))) as typeof fetch
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

test("tokens: the OAuth error code is read from the answer; only invalid_grant ends the connection", () => {
  assert.equal(oauthCode({ error: "invalid_grant", error_description: "x" }), "invalid_grant")
  assert.equal(oauthCode({ error: "Invalid device code" }), null)
  assert.equal(oauthCode(null), null)
  assert.equal(refreshEndsConnection(new AllegroApiError(400, "x", false, "invalid_grant")), true)
  assert.equal(refreshEndsConnection(new AllegroApiError(401, "x", false, "invalid_client")), false)
  assert.equal(refreshEndsConnection(new AllegroApiError(400, "x", false, null)), false)
  assert.equal(refreshEndsConnection(new AllegroApiError(503, "x", true, "invalid_grant")), false)
  assert.match(oauthHint("invalid_client") ?? "", /clientId and clientSecret/)
  assert.match(oauthHint("unauthorized_client") ?? "", /device app/)
  assert.equal(oauthHint("invalid_grant"), null)
})

test("tokens: a previous key opens what the current one cannot; nothing else does", () => {
  const a = keyFromBase64(KEY_A)
  const b = keyFromBase64(KEY_B)
  const sealed = encrypt("token", a)
  assert.deepEqual(decryptAny(sealed, [a]), { plain: "token", rotated: false })
  assert.deepEqual(decryptAny(sealed, [b, a]), { plain: "token", rotated: true })
  assert.throws(() => decryptAny(sealed, [b]), /different key or damaged value/)
})

test("tokens: a wrong encryption key keeps the stored tokens and reads as not connected", async () => {
  const row = storedRow(KEY_A, true)
  const before = row.refresh_token_enc
  const svc = fakeSvc({ ...BASE, encryptionKey: KEY_B }, row)
  assert.equal(await isConnected(svc as never), false)
  assert.match(unreadableTokens(svc as never, row) ?? "", /do not open with encryptionKey/)
  await assert.rejects(() => apiGet(svc as never, "/sale/offers", {}), /cannot be read/)
  assert.equal(row.refresh_token_enc, before, "the refresh token was kept")
  assert.ok(row.access_token_enc)
  assert.equal(row.disconnected_at, null)
  assert.match(String(row.last_error), /The tokens were kept/)
  /* The right key back: connected again, no new consent. */
  assert.equal(await isConnected(fakeSvc(BASE, row) as never), true)
})

test("tokens: after a key rotation the old key reads them and they are stored under the new one", async () => {
  const row = storedRow(KEY_A, true)
  const svc = fakeSvc({ ...BASE, encryptionKey: KEY_B, previousEncryptionKeys: [KEY_A] }, row)
  assert.equal(await isConnected(svc as never), true)
  const got = await withFetch(() => answer(200, { offers: [] }), () => apiGet<{ offers: unknown[] }>(svc as never, "/sale/offers", {}))
  assert.deepEqual(got, { offers: [] })
  assert.equal(decrypt(row.refresh_token_enc, keyFromBase64(KEY_B)), "refresh-token-value-0001")
  assert.equal(decrypt(row.access_token_enc, keyFromBase64(KEY_B)), "access-token-value-0001")
})

test("tokens: a wrong client secret at refresh keeps the tokens; invalid_grant disconnects", async () => {
  const kept = storedRow(KEY_A, false)
  const svc = fakeSvc(BASE, kept)
  await withFetch(
    () => answer(401, { error: "invalid_client", error_description: "Bad client credentials" }),
    () => assert.rejects(() => apiGet(svc as never, "/sale/offers", {}), (err: unknown) => err instanceof AllegroApiError && err.code === "invalid_client"),
  )
  assert.ok(kept.refresh_token_enc, "a configuration mistake does not cost a new consent")
  assert.match(String(kept.last_error), /clientId and clientSecret/)
  assert.doesNotMatch(String(kept.last_error), /secret-for-tests-only/)

  const revoked = storedRow(KEY_A, false)
  const svc2 = fakeSvc(BASE, revoked)
  await withFetch(
    () => answer(400, { error: "invalid_grant", error_description: "Invalid refresh token" }),
    () => assert.rejects(() => apiGet(svc2 as never, "/sale/offers", {})),
  )
  assert.equal(revoked.refresh_token_enc, null)
  assert.ok(revoked.disconnected_at instanceof Date)
})
