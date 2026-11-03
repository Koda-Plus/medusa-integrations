/**
 * The admin's own behaviour: the plain logic of dpd-logic.ts run as it is,
 * and the wiring of the .tsx files (which `node --test` cannot load) read
 * from the source. The label is fetched with the admin's auth, a refused
 * action refreshes what the page shows, the boxes editor names the refused
 * fields and fits a phone, a writer off in the options says so, an
 * amount reads as money of the admin's language, and a DPD Pickup point
 * reads as its card, can be changed from the plan and shows what DPD said.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import en from "../src/admin/i18n/en.ts"
import { POINT_TYPES } from "../src/modules/dpd/lib/constants.ts"
import type { PointDto, PointLimitsDto } from "../src/modules/dpd/lib/contract.ts"
import {
  BOX_FIELDS,
  DpdRequestError,
  answerProblems,
  boxFieldErrors,
  canChangePoint,
  customerChoseOther,
  errorTone,
  fetchLabelFile,
  fmtMinor,
  isLaterWriter,
  labelFileName,
  pointAddressLine,
  pointHoursRows,
  pointLimitParts,
  pointTypeKey,
  pointsQuery,
  problemDetail,
  problemsOfBody,
  requestError,
  sameSearch,
  writerBlock,
} from "../src/admin/lib/dpd-logic.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const source = (file: string) => readFileSync(join(root, "src/admin", file), "utf8")
const api = source("lib/dpd-api.ts")
const plan = source("lib/dpd-plan.tsx")
const point = source("lib/dpd-point.tsx")
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

/* ------------------------------------------------------------------ */
/* DPD Pickup points (stage 3)                                         */
/* ------------------------------------------------------------------ */

test("what DPD said at the last attempt: dpd_* and the Pickup problems with source dpd, never the plan's own", () => {
  const stored = [
    { code: "dpd_validation", field: "receiver.city", detail: "Incorrect city" },
    { code: "pudo_not_found", field: "INCORRECT_PUDO", detail: "PL11726", source: "dpd" as const },
    { code: "pudo_not_found", field: "pudoId", detail: "PL11726" },
    { code: "multi_box_not_allowed", field: "services[0]", source: "dpd" as const },
    { code: "weight_missing" },
  ]
  assert.deepEqual(answerProblems(stored).map((p) => `${p.code}${p.source ? `:${p.source}` : ""}`), ["dpd_validation", "pudo_not_found:dpd", "multi_box_not_allowed:dpd"])
  assert.deepEqual(answerProblems([]), [])
  /* The drawer takes its block from answerProblems, no longer from a dpd_ filter. */
  const planBody = body(plan, "PlanBody")
  assert.match(planBody, /const dpdProblems = answerProblems\(shipment\.problems\)/)
  assert.ok(!planBody.includes('p.code.startsWith("dpd_")'))
})

test("a point type reads as its own word, a locker type too, anything else as a Pickup point", () => {
  for (const t of POINT_TYPES) assert.equal(pointTypeKey(t), t)
  assert.equal(pointTypeKey("400401"), "400401")
  assert.equal(pointTypeKey("400"), "400")
  assert.equal(pointTypeKey(""), "other")
  assert.equal(pointTypeKey("999"), "other")
  assert.equal(pointTypeKey(" 300"), "other")
  for (const t of [...POINT_TYPES, "other"]) assert.equal(typeof (en.pudo.types as Record<string, string>)[t], "string", t)
})

test("the hours of a point: seven days from Monday, ranges sorted and without repeats, an empty day closed", () => {
  const rows = pointHoursRows([
    { day: 1, from: "13:00", to: "18:00" },
    { day: 1, from: "08:00", to: "12:00" },
    { day: 1, from: "08:00", to: "12:00" },
    { day: 3, from: "08:00", to: "18:00" },
    { day: 7, from: "10:00", to: "14:00" },
  ])
  assert.deepEqual(rows.map((r) => r.day), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(rows[0].ranges, [{ from: "08:00", to: "12:00" }, { from: "13:00", to: "18:00" }])
  assert.deepEqual(rows[1].ranges, [])
  assert.deepEqual(rows[2].ranges, [{ from: "08:00", to: "18:00" }])
  assert.deepEqual(rows[6].ranges, [{ from: "10:00", to: "14:00" }])
  assert.ok(pointHoursRows([]).every((r) => r.ranges.length === 0))
  /* A day outside 1 to 7 (a bad answer typed past the DTO) is left out. */
  const bad = JSON.parse('[{"day":8,"from":"08:00","to":"18:00"},{"day":0,"from":"08:00","to":"18:00"},{"day":1.5,"from":"08:00","to":"18:00"}]') as Parameters<typeof pointHoursRows>[0]
  assert.ok(pointHoursRows(bad).every((r) => r.ranges.length === 0))
  /* A range is joined with the dictionary's words, never with a dash. */
  assert.equal(en.pudo.range, "{{from}} to {{to}}")
  assert.match(source("i18n/pl.ts"), /range: "od \{\{from\}\} do \{\{to\}\}",/, "Polish reads od ... do")
  assert.match(point, /t\("pudo\.range", \{ from: r\.from, to: r\.to \}\)/)
})

test("the limits of a point give the values of their text: fits a b c, sum side sum, girth length girth, always kg", () => {
  const fits: PointLimitsDto = { maxKg: 20, box: { kind: "fits", sidesCm: [59, 50, 44] } }
  const sum: PointLimitsDto = { maxKg: 20, box: { kind: "sum", maxSideCm: 150, maxSumCm: 300 } }
  const girth: PointLimitsDto = { maxKg: 20, box: { kind: "girth", maxLengthCm: 100, maxGirthCm: 250 } }
  assert.deepEqual(pointLimitParts(fits), { key: "fits", values: { kg: 20, a: 59, b: 50, c: 44 } })
  assert.deepEqual(pointLimitParts(sum), { key: "sum", values: { kg: 20, side: 150, sum: 300 } })
  assert.deepEqual(pointLimitParts(girth), { key: "girth", values: { kg: 20, length: 100, girth: 250 } })
  /* Each key's values are exactly the placeholders of its text. */
  for (const l of [fits, sum, girth]) {
    const { key, values } = pointLimitParts(l)
    const holes = [...en.pudo.limits[key].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
    assert.deepEqual(Object.keys(values).sort(), holes, key)
  }
})

const PL14509: PointDto = {
  id: "PL14509",
  name: "DPD Pickup, Oddział Miejski",
  type: "300",
  isLocker: false,
  partner: null,
  address: { line1: "Skoroszewska 11", line2: null, zip: "02-495", city: "Warszawa", country: "PL" },
  lat: 52.1937,
  lng: 20.9278,
  active: true,
  services: ["100", "101", "200"],
  delivery: true,
  cod: true,
  hours: [{ day: 1, from: "08:00", to: "18:00" }],
  distance: null,
  limits: { maxKg: 20, box: { kind: "sum", maxSideCm: 150, maxSumCm: 300 } },
}

test("the address of a point on one line, for the confirmation of a change", () => {
  assert.equal(pointAddressLine(PL14509), "Skoroszewska 11, 02-495 Warszawa")
  assert.equal(pointAddressLine({ address: { ...PL14509.address, line2: "Pawilon 2" } }), "Skoroszewska 11, Pawilon 2, 02-495 Warszawa")
  assert.equal(pointAddressLine({ address: { ...PL14509.address, line2: "  " } }), "Skoroszewska 11, 02-495 Warszawa")
})

test("the change button: a plannable outbound row of a Pickup option, also without a point, never a courier or a return, no writer needed", () => {
  const actions = { plan: true, create: true, boxes: true, fetchLabel: false, label: false, lookup: false, accept: false, skip: true }
  assert.equal(canChangePoint({ kind: "outbound", actions }, { kind: "pickup" }), true)
  assert.equal(canChangePoint({ kind: "outbound", actions: { ...actions, plan: false } }, { kind: "pickup" }), false)
  assert.equal(canChangePoint({ kind: "outbound", actions }, { kind: "courier" }), false)
  assert.equal(canChangePoint({ kind: "return", actions }, { kind: "pickup" }), false)
  assert.equal(canChangePoint({ kind: "outbound", actions }, { kind: null }), false)
  /* The drawer asks canChangePoint only, never the writer (the change writes only the plugin row, DS4). */
  const drawer = body(plan, "PlanDrawer")
  assert.match(drawer, /pointChange=\{canChangePoint\(shipment, plan\)\}/)
  const planBody = body(plan, "PlanBody")
  const button = planBody.indexOf("pointChange && !picking ?")
  assert.ok(button > 0)
  assert.ok(!/writer|armed/i.test(planBody.slice(button, button + 300)))
  /* A Pickup plan shows the point and who collects there instead of the courier receiver. */
  assert.match(planBody, /const pickup = plan\.point !== null \|\| plan\.kind === "pickup"/)
  assert.match(planBody, /t\("plan\.point"\)/)
  assert.match(planBody, /t\("plan\.pudoReceiver"\)/)
  assert.match(planBody, /<PointPicker cod=\{plan\.cod\}/)
})

test("the order card says which point the customer chose when the shipment now goes to another one", () => {
  const s = { kind: "outbound" as const, optionKind: "pickup" as const, pudoId: "PL14509" }
  assert.equal(customerChoseOther("PL9DEMO01", s), "PL9DEMO01")
  assert.equal(customerChoseOther("PL14509", s), null)
  assert.equal(customerChoseOther(null, s), null)
  assert.equal(customerChoseOther("PL9DEMO01", { ...s, optionKind: "courier" }), null)
  assert.equal(customerChoseOther("PL9DEMO01", { ...s, kind: "return" }), null)
  /* A row without a point yet, the customer chose one: the line shows it. */
  assert.equal(customerChoseOther("PL9DEMO01", { ...s, pudoId: null }), "PL9DEMO01")
  assert.match(source("widgets/dpd-order-widget.tsx"), /t\("pudo\.customerChose", \{ id: chose \}\)/)
})

test("the point search of the admin runs only with five digits, by postal code and city, cod only when asked", () => {
  assert.equal(pointsQuery(null), null)
  assert.equal(pointsQuery({}), null)
  assert.equal(pointsQuery({ zip: "0249" }), null)
  assert.equal(pointsQuery({ zip: "02 495" }), null)
  assert.deepEqual(pointsQuery({ zip: "02-495" }), { zip: "02495" })
  assert.deepEqual(pointsQuery({ zip: " 02495 ", city: "  Warszawa   Włochy ", cod: false }), { zip: "02495", city: "Warszawa Włochy" })
  assert.deepEqual(pointsQuery({ zip: "02495", city: "", cod: true }), { zip: "02495", cod: "true" })
  /* The hook asks GET /admin/dpd/points with that query and is off without one. */
  const hook = body(api, "useDpdPoints")
  assert.match(hook, /const query = pointsQuery\(q\)/)
  assert.match(hook, /enabled: query !== null/)
  assert.match(hook, /\/admin\/dpd\/points\?/)
  assert.match(api, /points: \(q: Record<string, string>\) => \["dpd", "points", q\] as const/)
})

test("the same point search asked again after an error is read again: the query key does not change, so the picker refetches", () => {
  assert.equal(sameSearch({ zip: "02-495", city: " Warszawa " }, { zip: "02495", city: "Warszawa" }), true, "the same key, written another way")
  assert.equal(sameSearch({ zip: "02495" }, { zip: "02495", cod: true }), false)
  assert.equal(sameSearch({ zip: "02495", city: "Warszawa" }, { zip: "02495" }), false)
  assert.equal(sameSearch(null, { zip: "02495" }), false, "the first search is set, not refetched")
  const submit = body(point, "PointPicker")
  assert.match(submit, /if \(sameSearch\(asked, \{ zip, city, cod \}\)\) \{\s*if \(q\.isError \|\| q\.isStale\) void q\.refetch\(\)\s*\} else setAsked\(\{ zip, city, cod \}\)/)
})

test("a refused point carries its problems from the body; other bodies give none", () => {
  const refused = {
    code: "point_refused",
    message: "This point cannot take the shipment.",
    problems: [{ code: "pudo_inactive", field: "pudoId", detail: "PL0SBX01" }, { code: "pudo_not_found", source: "dpd" }, { code: "x", source: "shop" }, { field: "pudoId" }, "pudo_no_cod", { code: 7 }],
  }
  const err = requestError(422, JSON.stringify(refused))
  assert.equal(err.code, "point_refused")
  assert.deepEqual(err.problems, [{ code: "pudo_inactive", field: "pudoId", detail: "PL0SBX01" }, { code: "pudo_not_found", source: "dpd" }, { code: "x" }])
  assert.deepEqual(requestError(500, "not json").problems, [])
  assert.deepEqual(problemsOfBody({ code: "invalid" }), [])
  assert.deepEqual(problemsOfBody(null), [])
  /* The dialog shows those problems and keeps the point when refused. */
  const dialog = body(point, "PointChangeDialog")
  assert.match(dialog, /err\.code === "point_refused"\) setRefused\(err\.problems\)/)
  assert.match(dialog, /<ProblemList items=\{refused\} \/>/)
  assert.match(dialog, /toast\.success\(t\("toast\.pointChanged"\)\)/)
})

test("a changed point puts the fresh plan in its query and refreshes the lists, the shipment and the order card on every answer", () => {
  const hook = body(api, "useDpdSetPoint")
  assert.match(hook, /shipmentPath\(id, "point"\), \{ method: "POST", body \}/)
  assert.match(hook, /onSuccess: \(data\) => client\.setQueryData\(dpdKeys\.plan\(id\), data\)/)
  const settled = hook.slice(hook.indexOf("onSettled"))
  for (const key of [/\[\.\.\.dpdKeys\.all, "shipments"\]/, /dpdKeys\.shipment\(id\)/, /\[\.\.\.dpdKeys\.all, "order"\]/]) assert.match(settled, key)
  /* Not the plan on every answer: it is the one in the answer, and reading it again would read the point again. */
  assert.ok(!/queryKey: dpdKeys\.all \}/.test(hook))
})

test("the point card says why there is no point, and where a catalog answer came from", () => {
  const card = body(point, "PointCard")
  for (const key of ["pudo.notConfigured", "pudo.unchecked", "pudo.notFound", "pudo.missing", "pudo.invalid", "pudo.inactive", "pudo.delivery", "pudo.cod", "pudo.noCod", "pudo.locker"]) assert.ok(card.includes(`"${key}"`), key)
  assert.match(card, /reason === "not_configured" \? t\("pudo\.notConfigured", \{ id \}\)/)
  /* No note of the source in live: only the demo and sandbox catalogs have words. */
  assert.match(card, /source !== "live"/)
  assert.deepEqual(Object.keys(en.pudo.source).sort(), ["demo", "sandbox"])
  /* Settings warns when live has no MyPudo credentials, outside the option problems. */
  const settings = source("lib/dpd-settings.tsx")
  assert.match(settings, /o\.pickupCheck === "not_configured" \?/)
  assert.match(settings, /t\("account\.pickupNotConfigured"\)/)
})

test("the copy no longer says Pickup points come in a later version", () => {
  assert.ok(!/Pickup points[^.;]*later/i.test(en.subtitle), en.subtitle)
  assert.match(en.subtitle, /courier and DPD Pickup shipments in Poland/)
  const pl = source("i18n/pl.ts")
  assert.ok(!/punkty Pickup[^.;"]*kolejnych wersjach/i.test(pl))
  assert.ok(!pl.includes('"Statusy i punkty"'))
  assert.ok(!en.account.points.later.includes("points"))
})

test("a pending row the pass left to a person says why: point_unchecked and rate_limited_manual read in orange, a plain pending row shows nothing", () => {
  assert.equal(errorTone({ state: "pending", errorCode: "point_unchecked" }), "orange")
  assert.equal(errorTone({ state: "pending", errorCode: "rate_limited_manual" }), "orange")
  assert.equal(errorTone({ state: "pending", errorCode: null }), null)
  assert.equal(errorTone({ state: "pending", errorCode: "rate_limited" }), null, "the pass sends it again by itself")
  assert.equal(errorTone({ state: "failed", errorCode: "point_unchecked" }), "red")
  assert.equal(errorTone({ state: "created", errorCode: "label_unclear" }), "orange")
  assert.equal(errorTone({ state: "created", errorCode: null }), null)
  assert.equal(errorTone({ state: "labeled", errorCode: null }), null)
  for (const code of ["point_unchecked", "rate_limited_manual"]) assert.equal(typeof (en.errorCode as Record<string, string>)[code], "string", code)
  /* The list and the order card show the row's error through ErrorText, which asks errorTone. */
  const ui = source("lib/dpd-ui.tsx")
  assert.match(ui, /const tone = errorTone\(s\)/)
  assert.ok(!ui.includes("ERROR_STATES"), "one rule, in dpd-logic.ts")
  assert.match(source("lib/dpd-panel.tsx"), /<ErrorText shipment=\{s\} \/>/)
  assert.match(source("widgets/dpd-order-widget.tsx"), /<ErrorText shipment=\{s\} \/>/)
})
