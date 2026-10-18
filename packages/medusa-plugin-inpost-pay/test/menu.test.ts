/**
 * One menu entry for InPost: with the InPost plugin of Koda Plus in the same
 * app, this page is the "InPost Pay" tab of the InPost page, the own route
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
const page = readFileSync(join(root, "src/admin/routes/inpostpay/page.tsx"), "utf8")

test("menu: the page adds itself as a tab of the InPost page at module load, drawn by its own component", () => {
  assert.match(page, /^addPageTab\(\{ host: "inpost", id: "pay", ns: "inpostpay", name: "InPost Pay", order: \d+, Icon: InpostPayIcon, Component: InpostPayPage \}\)$/m)
})

test("menu: the own route moves to the tab only while the host is there, and draws the page otherwise", () => {
  assert.match(page, /<KitTabRoute host="inpost" tab="pay">\s*<InpostPayPage \/>\s*<\/KitTabRoute>/)
  assert.match(page, /export default InpostPayRoute\s*$/)
})

test("menu: the own sidebar entry keeps its label and steps aside only through the hosted icon", () => {
  assert.match(page, /defineRouteConfig\(\{\s*label: "[^"]+",\s*icon: hostedNavIcon\(InpostPayIcon, \{ host: "inpost", tab: "pay" \}\),\s*\}\)/)
})
