/**
 * One menu entry for InPost: with the InPost plugin of Koda Plus in the same
 * app, this page is the "Von Halsky" tab of the InPost page, the own route
 * redirects there and the own sidebar entry steps aside; without it the page
 * stands alone. The page file is .tsx (node --test cannot load it), so the
 * wiring is read from the source.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const page = readFileSync(join(root, "src/admin/routes/vonhalsky/page.tsx"), "utf8")

test("menu: the page adds itself as a tab of the InPost page at module load, drawn by its own component", () => {
  assert.match(page, /^addPageTab\(\{ host: "inpost", id: "vonhalsky", ns: "vonhalsky", name: "Von Halsky", order: \d+, Icon: VonHalskyIcon, Component: VonHalskyPage \}\)$/m)
})

test("menu: the own route moves to the tab only while the host is there, and draws the page otherwise", () => {
  assert.match(page, /<KitTabRoute host="inpost" tab="vonhalsky">\s*<VonHalskyPage \/>\s*<\/KitTabRoute>/)
  assert.match(page, /export default VonHalskyRoute\s*$/)
})

test("menu: the own sidebar entry keeps its label and steps aside only through the hosted icon", () => {
  assert.match(page, /defineRouteConfig\(\{\s*label: "[^"]+",\s*icon: hostedNavIcon\(VonHalskyIcon, \{ host: "inpost", tab: "vonhalsky" \}\),\s*\}\)/)
})
