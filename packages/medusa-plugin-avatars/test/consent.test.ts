/**
 * The consent rule: a render needs a signed document, the signer and the
 * date on record; a broken form names every missing piece; revoking or a
 * new face takes the right to render away.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { canRender, consentOf, signConsent } from "../src/modules/avatars/lib/consent.ts"
import { recordConsent, revokeConsent, updateAvatar } from "../src/workflows/avatars/avatars.ts"
import { fakeScope } from "./helpers.ts"

const NOW = new Date("2026-11-26T12:00:00Z")

test("consent: a complete form signs, with the admin who recorded it", () => {
  const r = signConsent({ file_url: "https://files.example.com/consent.pdf", signed_by: "Jane Example", signed_at: "2026-11-20", note: "Paper original in the office" }, "user_1", NOW)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.patch.consent_state, "signed")
  assert.equal(r.patch.consent_signed_by, "Jane Example")
  assert.equal(r.patch.consent_recorded_by, "user_1")
  assert.equal(r.patch.consent_note, "Paper original in the office")
})

test("consent: a path served by the store counts as a file", () => {
  const r = signConsent({ file_url: "/static/consent.pdf", signed_by: "Jane", signed_at: "2026-11-20" }, null, NOW)
  assert.equal(r.ok, true)
  const local = signConsent({ file_url: "http://localhost:9000/static/c.pdf", signed_by: "Jane", signed_at: "2026-11-20" }, null, NOW)
  assert.equal(local.ok, true)
  const plain = signConsent({ file_url: "http://files.example.com/c.pdf", signed_by: "Jane", signed_at: "2026-11-20" }, null, NOW)
  assert.equal(plain.ok, false)
})

test("consent: every missing piece is named", () => {
  const r = signConsent({}, null, NOW)
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.deepEqual(r.problems, ["file_missing", "signer_missing", "date_missing"])
})

test("consent: no protocol-relative or script URLs, no dates in the future", () => {
  for (const file_url of ["//evil.example.com/x.pdf", "javascript:alert(1)", "ftp://x/y.pdf"]) {
    const r = signConsent({ file_url, signed_by: "Jane", signed_at: "2026-11-20" }, null, NOW)
    assert.equal(r.ok, false, file_url)
    if (!r.ok) assert.deepEqual(r.problems, ["file_invalid"])
  }
  const future = signConsent({ file_url: "https://x.example.com/c.pdf", signed_by: "Jane", signed_at: "2027-01-01" }, null, NOW)
  assert.equal(future.ok, false)
  if (!future.ok) assert.deepEqual(future.problems, ["date_future"])
  const broken = signConsent({ file_url: "https://x.example.com/c.pdf", signed_by: "Jane", signed_at: "not a date" }, null, NOW)
  if (!broken.ok) assert.deepEqual(broken.problems, ["date_invalid"])
})

test("consent: only signed with the whole record lets a render start", () => {
  const signed = { state: "signed" as const, file_url: "https://x/c.pdf", signed_by: "Jane", signed_at: "2026-11-20T00:00:00.000Z" }
  assert.equal(canRender(signed), true)
  assert.equal(canRender({ ...signed, state: "revoked" }), false)
  assert.equal(canRender({ ...signed, state: "none" }), false)
  assert.equal(canRender({ ...signed, file_url: null }), false)
  assert.equal(canRender(consentOf({ consent_state: "something else", consent_file_url: "x" })), false)
})

test("consent flows: record, revoke keeps the history, a new face resets it", async () => {
  const { scope, rows } = fakeScope({ avatars: [{ id: "avt_1", name: "A", face_id: "face_a", voice: "Kore", consent_state: "none" }] })
  const signed = await recordConsent(scope, "avt_1", { file_url: "https://x.example.com/c.pdf", signed_by: "Jane", signed_at: "2026-11-20" }, "user_1", NOW)
  assert.equal(signed.ok, true)
  assert.equal(canRender(consentOf(rows.avatars[0])), true)

  const revoked = await revokeConsent(scope, "avt_1", "user_2")
  assert.equal(revoked.ok, true)
  assert.equal(rows.avatars[0].consent_state, "revoked")
  assert.equal(rows.avatars[0].consent_file_url, "https://x.example.com/c.pdf")
  assert.equal(rows.avatars[0].consent_signed_by, "Jane")

  await recordConsent(scope, "avt_1", { file_url: "https://x.example.com/c2.pdf", signed_by: "Jane", signed_at: "2026-11-21" }, "user_1", NOW)
  const moved = await updateAvatar(scope, "avt_1", { face_id: "face_b" })
  assert.equal(moved.ok, true)
  assert.equal(rows.avatars[0].consent_state, "none")

  await recordConsent(scope, "avt_1", { file_url: "https://x.example.com/c3.pdf", signed_by: "Jane", signed_at: "2026-11-21" }, "user_1", NOW)
  await updateAvatar(scope, "avt_1", { voice: "Puck" })
  assert.equal(rows.avatars[0].consent_state, "none")
  await recordConsent(scope, "avt_1", { file_url: "https://x.example.com/c4.pdf", signed_by: "Jane", signed_at: "2026-11-21" }, "user_1", NOW)
  await updateAvatar(scope, "avt_1", { name: "Renamed" })
  assert.equal(rows.avatars[0].consent_state, "signed")

  const missing = await recordConsent(scope, "avt_9", {}, null, NOW)
  assert.equal(missing.ok, false)
  if (!missing.ok) assert.equal(missing.status, 404)
})
