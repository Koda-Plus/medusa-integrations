import { test } from "node:test"
import assert from "node:assert/strict"
import { findPerson, normalizePeople, personKey } from "../src/modules/tasks/lib/people.ts"
import { resolveOptions } from "../src/modules/tasks/lib/options.ts"

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

test("people: a name is all it takes; kind defaults to person, avatar and role to none", () => {
  assert.deepEqual(normalizePeople([{ name: "Anna" }]), [{ name: "Anna", avatar: null, role: null, kind: "person" }])
})

test("people: the whole entry, with a data URI photo, a role in both languages and an AI agent", () => {
  const people = normalizePeople([
    { name: " Ola ", avatar: PNG, role: { en: "Backend and integrations", pl: "Backend i integracje" } },
    { name: "Koda AI", avatar: "https://cdn.example.com/koda-ai.webp", role: "Code, tests and docs", kind: "agent" },
  ])
  assert.deepEqual(people, [
    { name: "Ola", avatar: PNG, role: { en: "Backend and integrations", pl: "Backend i integracje" }, kind: "person" },
    { name: "Koda AI", avatar: "https://cdn.example.com/koda-ai.webp", role: { en: "Code, tests and docs", pl: "Code, tests and docs" }, kind: "agent" },
  ])
})

test("people: lenient like the references; broken parts are dropped, broken entries skipped, nothing throws", () => {
  const people = normalizePeople([
    { name: "Insecure photo", avatar: "http://cdn.example.com/a.png" },
    { name: "Script photo", avatar: "javascript:alert(1)" },
    { name: "Not an image", avatar: "data:text/html;base64,PHNjcmlwdD4=" },
    { name: "Huge photo", avatar: `data:image/png;base64,${"A".repeat(100_000)}` },
    { name: "Odd kind", kind: "robot", role: { de: "Roboter" } },
    { name: "" },
    { avatar: PNG },
    "Ola",
    null,
    42,
    ["array"],
  ])
  assert.deepEqual(
    people.map((p) => [p.name, p.avatar, p.role, p.kind]),
    [
      ["Insecure photo", null, null, "person"],
      ["Script photo", null, null, "person"],
      ["Not an image", null, null, "person"],
      ["Huge photo", null, null, "person"],
      ["Odd kind", null, null, "person"],
    ],
  )
  for (const input of [undefined, null, "Ola, Piotr", {}, 7]) assert.deepEqual(normalizePeople(input), [])
})

test("people: the first entry of a name wins, without case; at most 50; names are cut at 80 characters", () => {
  const people = normalizePeople([{ name: "Ola", role: "first" }, { name: "  OLA  ", role: "second" }, { name: "ola " }])
  assert.equal(people.length, 1)
  assert.deepEqual(people[0].role, { en: "first", pl: "first" })
  assert.equal(normalizePeople(Array.from({ length: 60 }, (_, i) => ({ name: `Person ${i}` }))).length, 50)
  assert.equal(normalizePeople([{ name: "x".repeat(200) }])[0].name.length, 80)
})

test("people: free text names match without case and extra spaces", () => {
  const people = normalizePeople([{ name: "Koda AI", kind: "agent" }, { name: "Piotr" }])
  assert.equal(findPerson(people, "koda  ai")?.name, "Koda AI")
  assert.equal(findPerson(people, " PIOTR ")?.name, "Piotr")
  assert.equal(findPerson(people, "Piotrek"), null, "a whole name, never a part of one")
  assert.equal(findPerson(people, ""), null)
  assert.equal(findPerson(people, null), null)
  assert.equal(personKey("  Ko  da "), "ko da")
})

test("people: part of the options, empty by default", () => {
  assert.deepEqual(resolveOptions({}).people, [])
  assert.deepEqual(resolveOptions({ people: [{ name: "Leo", kind: "agent" }] }).people, [{ name: "Leo", avatar: null, role: null, kind: "agent" }])
  assert.deepEqual(resolveOptions({ people: "Leo" as never }).people, [])
})
