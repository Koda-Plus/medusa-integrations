/**
 * Settings from the admin (branding overrides, switches), their cache, and
 * the SQL of the send log store.
 */
import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/emails/lib/options.ts"
import {
  applyBrandOverrides,
  brandKey,
  cachedSettings,
  forgetSettings,
  mergeOverrides,
  readSettings,
  sanitizeBrandOverrides,
  templateKey,
} from "../src/modules/emails/lib/settings.ts"
import { createSqlStore, isMissingTable, setClause } from "../src/modules/emails/lib/store.ts"

beforeEach(() => forgetSettings())

test("branding overrides are checked field by field; null or empty goes back to the option", () => {
  const { value, errors } = sanitizeBrandOverrides({ name: " Koda  Supply ", accentColor: "#26d07c", headerColor: "red", supportEmail: "nope", logoItalic: true, footerPl: "x".repeat(400), logoAccent: "" })
  assert.deepEqual(value, { name: "Koda  Supply", accentColor: "#26D07C", logoItalic: true, logoAccent: null })
  assert.deepEqual(errors.sort(), ["footerPl", "headerColor", "supportEmail"])
  assert.deepEqual(sanitizeBrandOverrides("x").errors, ["brand"])
})

test("overrides sit on top of the options, the footer per language", () => {
  const o = resolveOptions({ brand: { name: "Shop", accentColor: "#111111", footer: { en: "EN line", pl: "PL linia" } } })
  const b = applyBrandOverrides(o.brand, { name: "Better", footerPl: "Nowa linia", accentColor: null })
  assert.equal(b.name, "Better")
  assert.equal(b.accentColor, "#111111")
  assert.deepEqual(b.footer, { en: "EN line", pl: "Nowa linia" })
  assert.deepEqual(mergeOverrides({ name: "A", accentColor: "#000000" }, { name: null, headerColor: "#111111" }), { accentColor: "#000000", headerColor: "#111111" })
})

test("settings per mode; demo changes older than a day are forgotten", () => {
  const old = new Date(Date.now() - 2 * 24 * 3600 * 1000)
  const rows = [
    { key: brandKey(false), value: { name: "Live name" }, updated_by: "user_1", updated_at: new Date() },
    { key: brandKey(true), value: { name: "Stale demo name" }, updated_at: old },
    { key: templateKey(true, "order.placed"), value: { on: false }, updated_at: new Date() },
  ]
  const liveS = readSettings(rows, false)
  assert.equal(liveS.brand?.name, "Live name")
  assert.equal(liveS.brandUpdatedBy, "user_1")
  assert.deepEqual(liveS.templates, {})
  const demoS = readSettings(rows, true)
  assert.equal(demoS.brand, null)
  assert.equal(demoS.templates["order.placed"].on, false)
})

test("the settings cache: one read per 10 seconds, forgotten after a change, defaults only without the table", async () => {
  let reads = 0
  const load = async () => {
    reads += 1
    return [{ key: brandKey(false), value: { name: `v${reads}` } }]
  }
  const a = await cachedSettings(false, load, 1000)
  const b = await cachedSettings(false, load, 5000)
  assert.equal(reads, 1)
  assert.equal(a.brand?.name, b.brand?.name)
  await cachedSettings(false, load, 12_000)
  assert.equal(reads, 2)
  forgetSettings()
  await cachedSettings(false, load, 12_001)
  assert.equal(reads, 3)
  const noTable = await cachedSettings(true, async () => {
    throw Object.assign(new Error('relation "emails_setting" does not exist'), { code: "42P01" })
  })
  assert.equal(noTable.brand, null, "no table yet: nobody could have switched anything, the defaults")
})

test("a failing read never turns a switched-off template back on: the last settings read, else nothing is sent", async () => {
  const off = [{ key: templateKey(false, "order.placed"), value: { on: false } }]
  const first = await cachedSettings(false, async () => off, 1000)
  assert.equal(first.templates["order.placed"]?.on, false)
  const warnings: string[] = []
  const busy = async (): Promise<never> => {
    throw new Error("timeout acquiring a connection for owner.secret@db.example.com, the pool is probably full")
  }
  /* Past the 10 seconds: the read fails, the switch from the last good read stays, with one warning a minute. */
  const stale = await cachedSettings(false, busy, 20_000, { warn: (m) => void warnings.push(m) })
  assert.equal(stale.templates["order.placed"]?.on, false)
  await cachedSettings(false, busy, 30_000, { warn: (m) => void warnings.push(m) })
  assert.equal(warnings.length, 1)
  assert.ok(!warnings[0].includes("owner.secret@"), "an address in the error is masked")
  /* After a change in the admin the fallback stays too. */
  forgetSettings({ keepFallback: true })
  assert.equal((await cachedSettings(false, busy, 31_000)).templates["order.placed"]?.on, false)
  /* Nothing read before: the caller learns the settings are unknown. */
  forgetSettings()
  await assert.rejects(() => cachedSettings(false, busy, 40_000), (err: Error & { code?: string }) => err.name === "SettingsUnavailableError" && err.code === "SETTINGS_UNAVAILABLE")
})

function runner() {
  const calls: Array<{ sql: string; bindings: readonly unknown[] }> = []
  let next: unknown = { rows: [] }
  return {
    calls,
    set: (v: unknown) => (next = v),
    sql: {
      raw: async (sql: string, bindings: readonly unknown[] = []) => {
        calls.push({ sql, bindings })
        return next
      },
    },
  }
}

const NEW = {
  key: "emails:order.placed:o1",
  template: "order.placed",
  locale: "pl",
  demo: false,
  kind: "event" as const,
  recipient: "a***@e***.com",
  subject: "S",
  trigger: "order.placed",
  resource_type: "order",
  resource_id: "o1",
  order_id: "o1",
  notification_id: "noti_1",
  requested_by: null,
}

test("SQL: a claim is one insert that ignores conflicts, holding the token and the lease", async () => {
  const r = runner()
  const store = createSqlStore({ sql: r.sql, newId: (p) => `${p}_1` })
  r.set({ rows: [{ id: "emmsg_1" }] })
  const lease = new Date("2026-10-07T10:00:00Z")
  const row = await store.claimNew(NEW, { token: "tok", leaseUntil: lease, resendKey: NEW.key })
  assert.equal(row?.id, "emmsg_1")
  const { sql, bindings } = r.calls[0]
  assert.match(sql, /insert into "emails_message"/)
  assert.match(sql, /on conflict do nothing returning \*/)
  assert.ok(bindings.includes("sending") && bindings.includes("tok") && bindings.includes(lease) && bindings.includes("emmsg_1"))
  r.set({ rows: [] })
  assert.equal(await store.claimNew(NEW, { token: "t2", leaseUntil: lease, resendKey: NEW.key }), null)
})

test("SQL: a retry takes over only failed, unknown, skipped or expired rows and rotates the key", async () => {
  const r = runner()
  const store = createSqlStore({ sql: r.sql, newId: (p) => `${p}_1` })
  await store.claimRetry("k", false, { token: "t", leaseUntil: new Date(), notificationId: null, requestedBy: "user_1" })
  const { sql, bindings } = r.calls[0]
  assert.match(sql, /"status" in \('failed', 'unknown', 'skipped'\) or \("status" = 'sending' and "lease_until" < now\(\)\)/)
  assert.match(sql, /"resend_key" = "key" \|\| '#r' \|\| \("rotation" \+ 1\)::text/)
  assert.deepEqual(bindings.slice(-2), ["k", false])
})

test("SQL: only the claim's owner writes the result; patches name known columns only", async () => {
  const r = runner()
  const store = createSqlStore({ sql: r.sql, newId: (p) => `${p}_1` })
  r.set({ rows: [{ id: "emmsg_1" }] })
  assert.equal(await store.finish("emmsg_1", "tok", { status: "sent", external_id: "re_1" }), true)
  assert.match(r.calls[0].sql, /where "id" = \? and "claim_token" = \? and "status" = 'sending'/)
  const set = setClause({ status: "sent", ...({ "evil\"; drop table x; --": 1 } as object) })
  assert.equal(set.sql, `"status" = ?, "updated_at" = now()`)
})

test("SQL: settings upsert on the key, existing keys in one query, the log pruned without rows in flight", async () => {
  const r = runner()
  const store = createSqlStore({ sql: r.sql, newId: (p) => `${p}_1` })
  await store.setSetting("live:brand", { name: "X" }, "user_1")
  assert.match(r.calls[0].sql, /on conflict \("key"\) where "deleted_at" is null\s+do update/)
  assert.equal(r.calls[0].bindings[2], JSON.stringify({ name: "X" }))
  r.set({ rows: [{ key: "a" }] })
  const keys = await store.existingKeys(["a", "b", "a"], true)
  assert.deepEqual([...keys], ["a"])
  assert.match(r.calls[1].sql, /"key" in \(\?, \?\)/)
  assert.deepEqual(await store.existingKeys([], true), new Set())
  r.set({ rows: [{ id: "1" }, { id: "2" }] })
  assert.equal(await store.prune(new Date(), false), 2)
  assert.match(r.calls[2].sql, /"status" <> 'sending'/)
})

test("SQL: the demo seed is swapped in one transaction; only seeded rows are refreshed or deleted", async () => {
  const r = runner()
  let transactions = 0
  const sql = {
    ...r.sql,
    transaction: async <T,>(handler: (trx: typeof r.sql) => Promise<T>) => {
      transactions += 1
      return handler(r.sql)
    },
  }
  const store = createSqlStore({ sql, newId: (p) => `${p}_1` })
  const seed = { ...NEW, demo: true, kind: "seed" as const, status: "sent" as const, created_at: new Date("2026-10-07T10:00:00Z") }
  r.set({ rows: [{ key: NEW.key }] })
  const out = await store.replaceSeed([seed, { ...seed }, { ...seed, key: "emails:customer.welcome:c1", demo: false }])
  assert.equal(transactions, 1)
  assert.equal(r.calls.length, 2)
  const [upsert, cleanup] = r.calls
  assert.match(upsert.sql, /on conflict \("key", "demo"\) where "deleted_at" is null\s+do update set/)
  assert.match(upsert.sql, /where "emails_message"\."kind" = 'seed' and "emails_message"\."status" <> 'sending'/)
  assert.equal((upsert.sql.match(/coalesce\(\?, now\(\)\)/g) ?? []).length, 1, "one row: the repeated key and the live row are dropped")
  assert.ok(!/"(id|key|demo|kind)" = excluded/.test(upsert.sql), "a refreshed row keeps its id, key, mode and kind")
  assert.ok(upsert.bindings.includes(seed.created_at), "the date of the seed is written")
  assert.match(cleanup.sql, /delete from "emails_message"\s+where "demo" = true and "kind" = 'seed' and "status" <> 'sending'/)
  assert.match(cleanup.sql, /"key" not in \(\?\)/)
  assert.deepEqual(cleanup.bindings, [NEW.key])
  assert.deepEqual(out, { written: 1, removed: 1 })

  const empty = runner()
  await createSqlStore({ sql: empty.sql, newId: (p) => `${p}_1` }).replaceSeed([])
  assert.equal(empty.calls.length, 1, "no rows: only the leftovers go")
  assert.doesNotMatch(empty.calls[0].sql, /not in/)
})

test("a missing table is recognised by its Postgres code or message", () => {
  assert.equal(isMissingTable({ code: "42P01" }), true)
  assert.equal(isMissingTable(new Error('relation "emails_message" does not exist')), true)
  assert.equal(isMissingTable(new Error("deadlock")), false)
})

test("SQL: a limited claim locks the address, counts its messages of the hour and inserts in one transaction", async () => {
  const r = runner()
  let transactions = 0
  const sql = {
    ...r.sql,
    transaction: async <T,>(handler: (trx: typeof r.sql) => Promise<T>) => {
      transactions += 1
      return handler(r.sql)
    },
  }
  const store = createSqlStore({ sql, newId: (p) => `${p}_1` })
  const since = new Date("2026-10-07T09:00:00Z")
  const m = { ...NEW, template: "password.reset", recipient_hash: "h".repeat(40) }
  r.set({ rows: [{ n: 3 }] })
  assert.deepEqual(await store.claimLimited(m, { token: "t", leaseUntil: new Date(), resendKey: "k" }, { max: 3, since }), { row: null, throttled: true })
  assert.equal(transactions, 1)
  assert.equal(r.calls.length, 2, "over the limit: nothing is inserted")
  assert.match(r.calls[0].sql, /pg_advisory_xact_lock\(hashtext\(\?\)\)/)
  assert.deepEqual(r.calls[0].bindings, [`emails:limit:password.reset:${"h".repeat(40)}`])
  assert.match(r.calls[1].sql, /"template" = \? and "recipient_hash" = \? and "demo" = \? and "created_at" >= \? and "status" <> 'skipped'/)
  assert.deepEqual(r.calls[1].bindings, ["password.reset", "h".repeat(40), false, since])
  r.set({ rows: [{ n: 1, id: "emmsg_1" }] })
  const ok = await store.claimLimited(m, { token: "t", leaseUntil: new Date(), resendKey: "k" }, { max: 3, since })
  assert.equal(ok.throttled, false)
  assert.match(r.calls[4].sql, /insert into "emails_message"/)
  assert.ok(r.calls[4].bindings.includes("h".repeat(40)), "the hash of the address is written")
})

test("SQL: summaries read all records at once, never the address or the body; board counters in one grouped count", async () => {
  const r = runner()
  const store = createSqlStore({ sql: r.sql, newId: (p) => `${p}_1` })
  await store.forOrders(["order_1", "order_2", "order_1"], false)
  assert.match(r.calls[0].sql, /"order_id" in \(\?, \?\)/)
  assert.match(r.calls[0].sql, /"kind" <> 'test'/)
  assert.doesNotMatch(r.calls[0].sql, /"recipient",|body_html|body_text/)
  assert.deepEqual(r.calls[0].bindings, [false, "order_1", "order_2", 50])
  await store.forCustomers(["cus_1"], ["a".repeat(40)], true)
  assert.match(r.calls[1].sql, /\("customer_id" in \(\?\) or "recipient_hash" in \(\?\)\)/)
  assert.deepEqual(await store.forOrders([], false), [])
  assert.equal(r.calls.length, 2, "no ids, no query")
  r.set({ rows: [{ orderFailed: 2, refusedAddresses: 1 }] })
  assert.deepEqual(await store.boardCounts(false, new Date("2026-10-01T00:00:00Z")), { orderFailed: 2, refusedAddresses: 1 })
  assert.match(r.calls[2].sql, /count\(\*\) filter \(where "status" in \('failed', 'unknown'\) and "order_id" is not null\)/)
  assert.match(r.calls[2].sql, /count\(distinct coalesce\("recipient_hash", "id"\)\) filter \(where "status" = 'failed' and "error_code" = 'INVALID_RECIPIENT'\)/)
  assert.match(r.calls[2].sql, /"kind" <> 'test'/)
})

test("SQL: the log of an older version (no customer_id or recipient_hash yet) is not ready", async () => {
  const ok = runner()
  assert.equal(await createSqlStore({ sql: ok.sql, newId: (p) => p }).schemaReady(), true)
  assert.match(ok.calls[0].sql, /select "customer_id", "recipient_hash" from "emails_message" where false/)
  const old = { raw: async () => Promise.reject(Object.assign(new Error('column "customer_id" does not exist'), { code: "42703" })) }
  assert.equal(await createSqlStore({ sql: old, newId: (p) => p }).schemaReady(), false)
})

test("SQL: test sends are counted in the log per person and for the store, in one statement", async () => {
  const r = runner()
  r.set({ rows: [{ mine: 2, all: 7 }] })
  const mineSince = new Date("2026-10-07T09:50:00Z")
  const allSince = new Date("2026-10-07T09:00:00Z")
  assert.deepEqual(await createSqlStore({ sql: r.sql, newId: (p) => p }).testCounts(false, "user_1", mineSince, allSince), { mine: 2, all: 7 })
  assert.match(r.calls[0].sql, /count\(\*\) filter \(where "requested_by" = \? and "created_at" >= \?\)/)
  assert.match(r.calls[0].sql, /"kind" = 'test' and "demo" = \?/)
  assert.deepEqual(r.calls[0].bindings, ["user_1", mineSince, false, allSince])
})
