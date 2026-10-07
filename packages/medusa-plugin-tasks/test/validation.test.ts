import { test } from "node:test"
import assert from "node:assert/strict"
import { parseComment, parseCreate, parseLink, parseMove, parseTags, parseUpdate, type FieldError } from "../src/modules/tasks/lib/validation.ts"
import { cleanDisplayName, cleanLine, cleanText, isEntityId, likePattern } from "../src/modules/tasks/lib/text.ts"
import { linkLabel, linkPath } from "../src/modules/tasks/lib/links.ts"

const fields = (r: { ok: boolean; errors?: FieldError[] }) => (r.ok ? [] : (r.errors ?? []).map((e) => `${e.field}:${e.code}`))

test("create: a title is all it takes; defaults for the rest", () => {
  const r = parseCreate({ title: "  Add a size guide  " })
  assert.ok(r.ok)
  assert.deepEqual(r.value, { title: "Add a size guide", description: null, status: "todo", priority: "medium", assignee: null, due_date: null, tags: [], links: [], author: null })
})

test("create: every field checked, one error per field", () => {
  const r = parseCreate({ title: "", status: "archived", priority: "critical", due_date: "next week", tags: [{}], links: [{ type: "invoice", id: "x" }] })
  assert.deepEqual(fields(r), ["title:required", "status:invalid", "priority:invalid", "due_date:invalid", "tags:invalid", "links.0.type:invalid"])
  assert.deepEqual(fields(parseCreate({ title: "x".repeat(201) })), ["title:too_long"])
  assert.deepEqual(fields(parseCreate({ title: "ok", description: "y".repeat(10_001) })), ["description:too_long"])
  assert.deepEqual(fields(parseCreate(null)), ["title:required"])
  assert.deepEqual(fields(parseCreate("a string body")), ["title:required"])
})

test("create: the whole body of a script, links and an agent's name", () => {
  const r = parseCreate({
    title: "Refund the damaged item",
    description: "Line one\r\nLine two\u0007",
    status: "in_progress",
    priority: "urgent",
    assignee_email: " Owner@Store.example ",
    due_date: "2026-10-12",
    tags: "support, Orders, support",
    links: [
      { type: "order", id: "order_01ABC" },
      { type: "order", id: "order_01ABC" },
      { entity_type: "customer", entity_id: "cus_01XYZ" },
    ],
    author: "  Support\u202E agent  ",
    board: "main",
  })
  assert.ok(r.ok)
  assert.equal(r.value.description, "Line one\nLine two")
  assert.deepEqual(r.value.assignee, { kind: "email", email: "owner@store.example" })
  assert.deepEqual(r.value.tags, ["support", "Orders"])
  assert.deepEqual(r.value.links, [
    { type: "order", id: "order_01ABC" },
    { type: "customer", id: "cus_01XYZ" },
  ])
  assert.equal(r.value.author, "Support agent", "bidi overrides and extra spaces are gone")
  assert.equal("board" in r.value, false, "a body never chooses the board")
})

test("assignee: assignee_id wins over assignee_email over free text; null and empty unassign", () => {
  const a = (body: Record<string, unknown>) => {
    const r = parseUpdate(body)
    return r.ok ? r.value.assignee : fields(r)
  }
  assert.deepEqual(a({ assignee_id: "user_1", assignee: "frontend" }), { kind: "user", id: "user_1" })
  assert.deepEqual(a({ assignee_email: "a@b.pl", assignee: "x" }), { kind: "email", email: "a@b.pl" })
  assert.deepEqual(a({ assignee: " frontend " }), { kind: "text", name: "frontend" })
  assert.equal(a({ assignee_id: null }), null)
  assert.equal(a({ assignee: "" }), null)
  assert.deepEqual(a({ assignee_id: "user 1; drop table" }), ["assignee_id:invalid"])
  assert.deepEqual(a({ assignee_email: "nope" }), ["assignee_email:invalid"])
  assert.deepEqual(a({ assignee: "x".repeat(81) }), ["assignee:too_long"])
})

test("update: something to change is required; only the fields sent change", () => {
  assert.deepEqual(fields(parseUpdate({})), ["body:empty"])
  assert.deepEqual(fields(parseUpdate({ author: "Bot" })), ["body:empty"])
  const r = parseUpdate({ status: "done", due_date: null, description: null })
  assert.ok(r.ok)
  assert.deepEqual(r.value, { author: null, status: "done", due_date: null, description: null })
  assert.deepEqual(fields(parseUpdate({ title: "   " })), ["title:required"])
})

test("move: a status and optional neighbours", () => {
  const r = parseMove({ status: "review", after_id: "task_1", before_id: "", author: "Bot" })
  assert.ok(r.ok)
  assert.deepEqual(r.value, { status: "review", before_id: null, after_id: "task_1", author: "Bot" })
  assert.deepEqual(fields(parseMove({ status: "nope" })), ["status:invalid"])
  assert.deepEqual(fields(parseMove({ status: "todo", after_id: "../etc" })), ["after_id:invalid"])
})

test("comments: a body, cleaned, at most 5000 characters; body, text or message", () => {
  assert.deepEqual(parseComment({ body: "  Done.  ", author: "Claude Code" }), { ok: true, value: { body: "Done.", author: "Claude Code" } })
  assert.deepEqual(parseComment({ text: "From text" }), { ok: true, value: { body: "From text", author: null } })
  assert.deepEqual(parseComment({ message: "From message" }), { ok: true, value: { body: "From message", author: null } })
  assert.deepEqual(fields(parseComment({ body: "   " })), ["body:required"])
  assert.deepEqual(fields(parseComment({ body: "x".repeat(5001) })), ["body:too_long"])
  assert.deepEqual(fields(parseComment({})), ["body:required"])
})

test("links: a known type and an id with the prefix Medusa gives that type", () => {
  assert.deepEqual(parseLink({ type: "order", id: "order_01" }), { ok: true, value: { type: "order", id: "order_01" } })
  assert.deepEqual(parseLink({ type: "product", id: "prod_01" }), { ok: true, value: { type: "product", id: "prod_01" } })
  assert.deepEqual(parseLink({ type: "customer", id: "cus_01" }), { ok: true, value: { type: "customer", id: "cus_01" } })
  assert.deepEqual(fields(parseLink({ type: "order", id: "prod_01" })), ["link.id:invalid"])
  assert.deepEqual(fields(parseLink({ type: "invoice", id: "inv_01" })), ["link.type:invalid"])
  assert.deepEqual(fields(parseLink({ type: "order", id: "order_' or 1=1" })), ["link.id:invalid"])
  assert.deepEqual(fields(parseCreate({ title: "t", links: Array.from({ length: 21 }, (_, i) => ({ type: "order", id: `order_${i}` })) })), ["links:too_many"])
})

test("links: labels read from Medusa, never copied", () => {
  assert.equal(linkLabel("order", { id: "order_1", display_id: 1042 }), "#1042")
  assert.equal(linkLabel("product", { id: "prod_1", title: " Linen shirt " }), "Linen shirt")
  assert.equal(linkLabel("customer", { id: "cus_1", company_name: "Acme", first_name: "Anna" }), "Acme")
  assert.equal(linkLabel("customer", { id: "cus_1", first_name: "Anna", last_name: "Nowak", email: "a@x.pl" }), "Anna Nowak")
  assert.equal(linkLabel("customer", { id: "cus_1", email: "a@x.pl" }), "a@x.pl")
  assert.equal(linkLabel("order", null), null)
  assert.equal(linkPath("customer", "cus_1"), "/customers/cus_1")
})

test("tags: arrays or comma separated, unique without case, at most ten of 32 characters", () => {
  const errors: FieldError[] = []
  assert.deepEqual(parseTags(["a", "A", " b ", "", 7], errors), ["a", "b", "7"])
  assert.deepEqual(parseTags("x,  y , x", errors), ["x", "y"])
  assert.deepEqual(parseTags(null, errors), [])
  assert.equal(errors.length, 0)
  assert.equal(parseTags(Array.from({ length: 11 }, (_, i) => `t${i}`), errors), undefined)
  assert.equal(parseTags(["x".repeat(33)], errors), undefined)
  assert.deepEqual(
    errors.map((e) => e.code),
    ["too_many", "too_long"],
  )
})

test("text: control characters and bidirectional overrides are removed, lines kept where they belong", () => {
  assert.equal(cleanText("a\u0000b\u202Ec\r\nd\t ", 100), "abc\nd")
  assert.equal(cleanLine(" a\n  b\tc ", 100), "a b c")
  assert.equal(cleanLine("abcdef", 3), "abc")
  assert.equal(cleanDisplayName("   "), null)
  assert.equal(cleanDisplayName("x".repeat(80))?.length, 60)
  assert.equal(isEntityId("01J9ZK8N1Q2R3S4T5V6W7X8Y9Z"), true, "old KODA Panel ids are bare ULIDs")
  assert.equal(isEntityId("task_01J"), true)
  assert.equal(isEntityId("a/b"), false)
  assert.equal(isEntityId(""), false)
  assert.equal(likePattern("50%_off\\"), "%50\\%\\_off\\\\%")
  assert.equal(likePattern("  "), "")
})
