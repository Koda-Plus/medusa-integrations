/**
 * One menu entry for InPost: this page hosts the tabs of the other InPost
 * plugins (InPost Pay, InPost Von Halsky) through the kit's page tabs, and
 * keeps its own sidebar entry. The page files are .tsx (node --test cannot
 * load them), so the wiring is read from the source.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import en from "../src/admin/i18n/en.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const page = readFileSync(join(root, "src/admin/routes/inpost/page.tsx"), "utf8")
const kit = readFileSync(join(root, "src/admin/lib/inpost-kit.tsx"), "utf8")

test("menu: the InPost page hosts the tabs at module load, under its own route", () => {
  assert.match(page, /^hostPageTabs\(\{ id: "inpost", path: "\/inpost", name: "InPost" \}\)$/m)
  assert.match(page, /<KitTabbedPage host="inpost"[^>]*own=\{\{ id: "shipping"/)
  assert.match(page, /export default InpostRoute\s*$/)
})

test("menu: the own sidebar entry stays as it was (label, rank, the plain mark)", () => {
  assert.match(page, /defineRouteConfig\(\{\s*label: "InPost",\s*rank: 3,\s*icon: InpostIcon,\s*\}\)/)
})

test("menu: the tab labels are in the dictionary, and the tab parameter is not one the pages use", () => {
  assert.equal(en.tabs.shipping, "Shipping")
  assert.ok(en.tabs.label.length > 0)
  assert.match(kit, /export const PAGE_TAB_PARAM = "service"/)
  for (const own of ["view", "tab", "section", "filter", "q"]) assert.ok(!kit.includes(`PAGE_TAB_PARAM = "${own}"`))
})
