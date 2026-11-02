/**
 * The admin's own behaviour: the plain logic of dpd-logic.ts run as it is,
 * and the wiring of the .tsx files (which `node --test` cannot load) read
 * from the source. The label is fetched with the admin's auth, a refused
 * action refreshes what the page shows, the boxes editor names the refused
 * fields and fits a phone, a writer off in the options says so, and an
 * amount reads as money of the admin's language.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import en from "../src/admin/i18n/en.ts"
import {
  BOX_FIELDS,
  DpdRequestError,
  boxFieldErrors,
  fetchLabelFile,
  fmtMinor,
  isLaterWriter,
  labelFileName,
  problemDetail,
  requestError,
  writerBlock,
} from "../src/admin/lib/dpd-logic.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const source = (file: string) => readFileSync(join(root, "src/admin", file), "utf8")
const api = source("lib/dpd-api.ts")
const plan = source("lib/dpd-plan.tsx")
const NBSP = String.fromCharCode(0xa0)

/** The text of one function of a source file, from its declaration to the next top level declaration. */
function body(text: string, name: string): string {
  const start = text.search(new RegExp(`(?:function|const) ${name}\\b`))
  assert.ok(start >= 0, name)
  const rest = text.slice(start + 1)
  const end = rest.search(/\n(?:export )?(?:async )?(?:function|const|type) /)
  return end < 0 ? text.slice(start) : text.slice(start, start + 1 + end)
}

test("the label is fetched with the init it is given (the admin's auth) and comes back as a PDF with its file name", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = []
  const fetcher = async (url: string, init: RequestInit) => {
    seen.push({ url, init })
    return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { "content-type": "application/octet-stream", "content-disposition": 'inline; filename="1042-0000899000001Q.pdf"' } })
  }
  const init: RequestInit = { credentials: "include", headers: { Authorization: "Bearer token" } }
  const { blob, fileName } = await fetchLabelFile(fetcher, "https://shop.example.com/admin/dpd/shipments/s1/label", init)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].init, init)
  assert.equal(blob.type, "application/pdf")
  assert.equal(blob.size, 4)
  assert.equal(fileName, "1042-0000899000001Q.pdf")
})

test("a missing or removed label throws the server's code, so the toast reads actionError.no_label", async () => {
  const fetcher = async () => new Response(JSON.stringify({ code: "no_label", message: "No stored label for this shipment." }), { status: 404, headers: { "content-type": "application/json" } })
  await assert.rejects(fetchLabelFile(fetcher, "u", {}), (err: unknown) => err instanceof DpdRequestError && err.status === 404 && err.code === "no_label")
  assert.equal(typeof en.actionError.no_label, "string")
})

test("the label file name: the server's when plain, else the fallback", () => {
  assert.equal(labelFileName('attachment; filename="1042-0000899000001Q.pdf"', "x.pdf"), "1042-0000899000001Q.pdf")
  assert.equal(labelFileName(null, "dpd-label-s1.pdf"), "dpd-label-s1.pdf")
  assert.equal(labelFileName('attachment; filename="../../etc/passwd"', "x.pdf"), "x.pdf")
})

test("the label buttons never open a bare URL: the PDF is fetched with the admin's auth and opened from memory", () => {
  assert.ok(!/window\.open\(\s*labelUrl/.test(plan), "a bare label URL in a new tab carries no JWT")
  assert.match(plan, /await openLabel\(s\.id, download\)/)
  const open = body(api, "openLabel")
  assert.match(open, /kitRequestInit\(/)
  assert.match(open, /URL\.createObjectURL\(/)
  assert.match(source("lib/dpd-api.ts"), /URL\.revokeObjectURL\(/)
})

test("a refused action refreshes what the page shows: the mutations invalidate on settle, not only on success", () => {
  for (const name of ["useAction", "usePost", "useDpdBoxes"]) {
    const fn = body(api, name)
    assert.match(fn, /onSettled: \(\) => void client\.invalidateQueries\(\{ queryKey: dpdKeys\.all \}\)/, name)
    assert.ok(!/onSuccess: \(\) => void client\.invalidateQueries/.test(fn), name)
  }
})

test("the drawer neither shows nor confirms a plan whose last read failed", () => {
  const drawer = body(plan, "PlanDrawer")
  assert.match(drawer, /const data = q\.isError \? undefined : q\.data/)
  assert.match(drawer, /const canCreate = Boolean\(!q\.isError && /)
  assert.match(drawer, /\{plan && shipment \? <PlanBody /)
})

test("a 400 of the boxes lists its fields: zero based index, field name, other names mapped, bad entries left out", () => {
  const body400 = {
    code: "invalid",
    message: "The boxes are not valid: boxes[1].weightKg.",
    fields: [{ index: 1, field: "weightKg" }, { index: 0, field: "sizeXCm" }, { index: -1, field: "heightCm" }, { index: 2 }, "boxes", { index: 1.5, field: "widthCm" }],
  }
  assert.deepEqual(boxFieldErrors(body400), [
    { index: 1, field: "weightKg" },
    { index: 0, field: "lengthCm" },
  ])
  /* No fields (an older server, or a refusal of the whole list): the message is shown instead. */
  assert.deepEqual(boxFieldErrors({ code: "invalid", message: "Send { boxes: [...] }." }), [])
  assert.deepEqual(boxFieldErrors(null), [])
  /* The body of the error is kept, so the editor can read the fields. */
  const err = requestError(400, JSON.stringify(body400))
  assert.equal(err.code, "invalid")
  assert.deepEqual(boxFieldErrors(err.body), boxFieldErrors(body400))
})

test("the boxes editor shows the refused fields as Box n and the field, the message only without them", () => {
  const editor = body(plan, "BoxesEditor")
  assert.match(editor, /boxFieldErrors\(err\.body\)/)
  assert.match(editor, /t\("plan\.box", \{ n: f\.index \+ 1 \}\)/)
  assert.match(editor, /plan\.boxFields\.\$\{field\}/)
  for (const f of BOX_FIELDS) assert.equal(typeof en.plan.boxFields[f], "string", f)
})

test("the boxes editor fits a phone: two columns of values under sm, the remove button outside the value grid", () => {
  const editor = body(plan, "BoxesEditor")
  /* The old row put four inputs and the button (five children) in a three column grid. */
  assert.ok(!editor.includes("grid-cols-[1fr_1fr_28px]"))
  assert.match(editor, /grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4/)
  /* The value grid closes before the remove button. */
  const grid = editor.indexOf("grid-cols-2 gap-2 sm:grid-cols-4")
  const button = editor.indexOf("<IconButton", grid)
  assert.ok(grid > 0 && button > grid && editor.slice(grid, button).includes("</div>"))
  /* A label over each value on a phone, where the header row is hidden. */
  assert.match(editor, /<span className="txt-compact-xsmall text-ui-fg-muted sm:hidden">\{label\}<\/span>/)
})

test("a writer the options turn off says writer_off, never arm it in Settings", () => {
  assert.equal(writerBlock({ allowed: false }, false), "off")
  assert.equal(writerBlock({ allowed: false }, true), "off")
  assert.equal(writerBlock({ allowed: true }, false), "not_armed")
  assert.equal(writerBlock({ allowed: true }, true), null)
  assert.equal(writerBlock(undefined, false), "not_armed")
  assert.match(plan, /t\("actionError\.writer_off"\)/)
  const drawer = body(plan, "PlanDrawer")
  assert.match(drawer, /block === "off"/)
  assert.match(drawer, /block === "not_armed" \? \(\s*<InlineTip variant="info" label=\{t\("plan\.notArmed"\)\}/)
  /* Both hosts of the drawer and the action bar hand over the writer of the status (or the order card). */
  assert.match(source("lib/dpd-panel.tsx"), /writer=\{status\.writers\.shipment\}/)
  assert.match(source("widgets/dpd-order-widget.tsx"), /writer=\{info\.writers\.shipment\}/)
  assert.match(source("widgets/dpd-order-widget.tsx"), /!writerAllowed \? t\("actionError\.writer_off"\)/)
})

test("the order_paid amount reads as money of the admin's language; without it the detail stays", () => {
  const warning = { code: "order_paid", detail: "50.00", amount: { minor: 12345, currency: "PLN" } }
  assert.equal(problemDetail(warning, "pl"), `123,45${NBSP}zł`)
  assert.equal(fmtMinor(5000, "EUR", "pl"), `50,00${NBSP}€`)
  assert.equal(problemDetail({ code: "order_paid", detail: "50.00" }, "pl"), "50.00")
  assert.equal(problemDetail({ code: "order_paid", detail: "50.00", amount: { minor: "x", currency: "PLN" } }, "pl"), "50.00")
  assert.match(source("lib/dpd-ui.tsx"), /t\(key, \{ detail: problemDetail\(p, lang\) \}\)/)
})

test("the later note is for the writers this version does not use yet, not for the shipment writer", () => {
  assert.equal(isLaterWriter("shipment"), false)
  assert.equal(isLaterWriter("pickup"), true)
  assert.equal(isLaterWriter("fulfillmentStatus"), true)
  assert.match(source("lib/dpd-settings.tsx"), /isLaterWriter\(writer\.key\) \? \(/)
  /* The header lists the armed writers instead of a note about one of them. */
  assert.ok(!source("routes/dpd/page.tsx").includes('t("writers.later")'))
  /* The note no longer says the shipment writer creates shipments: it is about a writer that waits. */
  assert.ok(!/creates/i.test(en.writers.later), en.writers.later)
})
