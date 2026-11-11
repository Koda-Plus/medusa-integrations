/**
 * Its own sidebar entry, next to InPost (rank 3): a marketplace is a sales
 * channel of its own, so the page is no tab of the InPost page any more
 * (since 11.11.2026). The page file is .tsx (node --test cannot load it), so
 * the wiring is read from the source.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const page = readFileSync(join(root, "src/admin/routes/vonhalsky/page.tsx"), "utf8")

test("menu: its own route and sidebar entry, rank 3 next to InPost, the Von Halsky tile", () => {
  assert.match(page, /defineRouteConfig\(\{\s*label: "Von Halsky",\s*rank: 3,\s*icon: VonHalskyIcon,\s*\}\)/)
  assert.match(page, /export default VonHalskyPage\s*$/)
})

test("menu: not a tab of the InPost page any more", () => {
  for (const wiring of ["addPageTab", "KitTabRoute", "hostedNavIcon", 'host: "inpost"']) assert.ok(!page.includes(wiring), wiring)
})
