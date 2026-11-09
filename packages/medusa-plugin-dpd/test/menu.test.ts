/**
 * DPD has its own sidebar entry: a plain page under /dpd, not a tab of the
 * InPost page and not a host of tabs. The icon is a generic truck from
 * @medusajs/icons, never the DPD logo. The page files are .tsx (node --test
 * cannot load them), so the wiring is read from the source.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import en from "../src/admin/i18n/en.ts"
import { writingWriters } from "../src/admin/lib/dpd-logic.ts"
import type { WriterKey } from "../src/modules/dpd/lib/contract.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const page = readFileSync(join(root, "src/admin/routes/dpd/page.tsx"), "utf8")
const icon = readFileSync(join(root, "src/admin/lib/dpd-icon.tsx"), "utf8")
const widget = readFileSync(join(root, "src/admin/widgets/dpd-order-widget.tsx"), "utf8")

test("menu: one route of its own, the DPD page under /dpd", () => {
  assert.deepEqual(readdirSync(join(root, "src/admin/routes")), ["dpd"])
  assert.deepEqual(readdirSync(join(root, "src/admin/routes/dpd")), ["page.tsx"])
  assert.match(page, /export default DpdPage\s*$/)
})

test("menu: the own sidebar entry (label, rank last among the extensions, the DPD tile)", () => {
  assert.match(page, /defineRouteConfig\(\{\s*label: "DPD",\s*rank: 100,\s*icon: DpdIcon,\s*\}\)/)
  assert.equal(en.title, "DPD")
})

test("menu: not a tab of another page and not a host of tabs", () => {
  for (const wiring of ["addPageTab", "hostPageTabs", "hostedNavIcon", "KitTabRoute", "KitTabbedPage"]) assert.ok(!page.includes(wiring), wiring)
  assert.ok(!/host:\s*"inpost"/.test(page))
})

test("menu: the icon is DPD's cube drawn inline on the red tile, nothing loaded", () => {
  assert.match(icon, /export function DpdIcon\(/)
  assert.match(icon, /<path/)
  assert.match(icon, /#DC0032/i)
  const code = icon.replace(/\/\*[\s\S]*?\*\//g, "").replaceAll("http://www.w3.org/2000/svg", "")
  assert.ok(!/<img|\.svg"|\.png"|https?:\/\//.test(code), "no loaded image")
})

test("menu: deep links and views are read from the URL", () => {
  assert.match(page, /params\.get\("filter"\)/)
  /* The handover list (?view=dispatches&filter=) and one handover (?dispatch=). */
  assert.match(page, /params\.get\("view"\) === "dispatches"/)
  assert.match(page, /dispatchFilterOf\(params\.get\("filter"\)\)/)
  assert.match(page, /params\.get\("dispatch"\)/)
  assert.match(page, /params\.get\("q"\)/)
  assert.match(page, /usePageNav\(SETTINGS_TABS\)/)
})

test("order card: registered for hosts as dpd.order, next to InPost in the order zone", () => {
  assert.match(widget, /zone: "order\.details\.side\.after"/)
  assert.match(widget, /hostable\(\{ id: "dpd\.order", ns: "dpd", zone: "order\.details", name: "DPD", order: 41, Icon: DpdIcon, hideWhenNone: true \}, DpdOrderCard\)/)
})

test("page: Refresh spins for the person's own refresh only, a reset re-arms the seed once it has landed, a stale writer counts", () => {
  assert.ok(!page.includes("useIsFetching"), "no spinner for background fetches")
  assert.match(page, /loading: refreshing,/)
  assert.match(page, /await reset\.mutateAsync\(\)\s*onResetDone\(\)/)
  assert.ok(!/onResetDone\(\)\s*try/.test(page), "never re-armed before the reset is sent")
  assert.match(page, /badge: Object\.values\(s\.writers\)\.filter\(\(w\) => w\.on\)\.length/)
  assert.match(page, /seedFailed=\{seed\.isError\}/)
})

test("page: the writing badge lists every armed writer that writes", () => {
  const w = (key: WriterKey, armed: boolean) => ({ key, armed, allowed: armed, on: armed, updatedBy: null, updatedAt: null })
  const all = { shipment: w("shipment", true), pickup: w("pickup", true), fulfillmentStatus: w("fulfillmentStatus", true) }
  /* The pickup writer orders couriers since stage 4, the Medusa status writer marks fulfillments since stage 5. */
  assert.deepEqual(writingWriters(all).map((x) => x.key), ["shipment", "pickup", "fulfillmentStatus"])
  assert.deepEqual(writingWriters({ ...all, shipment: w("shipment", false), pickup: w("pickup", false) }).map((x) => x.key), ["fulfillmentStatus"], "the Medusa status writer armed alone")
  assert.deepEqual(writingWriters({ ...all, shipment: w("shipment", false) }).map((x) => x.key), ["pickup", "fulfillmentStatus"])
  assert.deepEqual(writingWriters(undefined), [])
  /* The header counts and names the writers from writingWriters, not every armed writer. */
  assert.match(page, /const armedWriters = writingWriters\(status\?\.writers\)/)
  assert.ok(!/Object\.values\(status\.writers\)\.filter\(\(w\) => w\.armed\)/.test(page), "no armed writer counted as writing")
})

test("plan drawer: Confirm waits while the plan is read again, the hash on screen may be the old one", () => {
  const plan = readFileSync(join(root, "src/admin/lib/dpd-plan.tsx"), "utf8")
  const canCreate = plan.match(/const canCreate = ([^\n]+)/)?.[1] ?? ""
  assert.match(canCreate, /!q\.isFetching/)
  assert.match(plan, /disabled=\{!canCreate\}/)
})
