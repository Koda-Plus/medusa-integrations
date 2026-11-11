/** Button and paper colours: the store's gold button with readable text, a cream page with matching lines. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { contrast, makePalette } from "../src/modules/emails/lib/theme.ts"

test("the button colour is used with the better reading text, the accent stays for highlights", () => {
  const p = makePalette("#43C463", "#0B0F0C", { button: "#FFBB0F" })
  assert.equal(p.button, "#FFBB0F")
  assert.equal(p.accent, "#43C463")
  assert.ok(contrast(p.button, p.onButton) >= 4.5)
  assert.notEqual(p.onButton, "#FFFFFF")
})

test("without the options nothing changes", () => {
  const a = makePalette("#43C463", "#0B0F0C")
  assert.equal(a.button, a.accent)
  assert.equal(a.onButton, a.onAccent)
})

test("a cream paper sets the page, fields and lines; a dark paper is lifted to a light one", () => {
  const p = makePalette("#43C463", "#0B0F0C", { paper: "#F6F4EC" })
  assert.equal(p.light.page, "#F6F4EC")
  assert.ok(contrast(p.light.ink, p.light.page) >= 7)
  assert.ok(contrast(p.light.line, p.light.page) > 1.1)
  const dark = makePalette("#43C463", "#0B0F0C", { paper: "#333333" })
  assert.ok(contrast(dark.light.ink, dark.light.page) >= 7)
})
