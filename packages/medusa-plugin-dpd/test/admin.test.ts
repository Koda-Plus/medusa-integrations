/**
 * The admin's own behaviour: the plain logic of dpd-logic.ts run as it is,
 * and the wiring of the .tsx files (which `node --test` cannot load) read
 * from the source. The label is fetched with the admin's auth, a refused
 * action refreshes what the page shows, the boxes editor names the refused
 * fields and fits a phone, a writer off in the options says so, an
 * amount reads as money of the admin's language, a DPD Pickup point
 * reads as its card, can be changed from the plan and shows what DPD said,
 * and a handover to the courier picks its windows from the server's clock,
 * asks the writer the server asks and names its actions in both languages.
 * The DPD statuses show the stage, the waybills with their repins, the source
 * of the statuses and the status writes Medusa did not take.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import en from "../src/admin/i18n/en.ts"
import { POINT_TYPES } from "../src/modules/dpd/lib/constants.ts"
import { WRITER_RETRY_RESULTS } from "../src/modules/dpd/lib/contract.ts"
import type { DispatchActions, DispatchDto, PointDto, PointLimitsDto, ShipmentActions, TrackingDto, WriterDto, WriterKey } from "../src/modules/dpd/lib/contract.ts"
import {
  BOX_FIELDS,
  DISPATCH_FILTERS,
  DpdRequestError,
  LATER_WRITERS,
  SELECTION_MAX,
  STAGE_TONE,
  answerProblems,
  boxFieldErrors,
  canChangePoint,
  canRefreshStatus,
  canRetryStatusWriter,
  courierBlock,
  changeReasonCode,
  courierFormAllowed,
  courierRequestOf,
  courierWindowChoices,
  customerChoseOther,
  defaultCourierDate,
  dispatchActionWriter,
  dispatchErrorTone,
  dispatchFilterOf,
  dispatchLeftClaim,
  dispatchMainAction,
  dispatchTone,
  errorTone,
  fetchLabelFile,
  fmtMinor,
  fmtPickupDate,
  handoverStepOf,
  isLaterWriter,
  labelFileName,
  lastAnsweredAt,
  latestProtocol,
  pageInRange,
  pointAddressLine,
  printToastKind,
  pointHoursRows,
  pointLimitParts,
  pointTypeKey,
  pointsQuery,
  problemDetail,
  problemsOfBody,
  requestError,
  sameSearch,
  selectionPageState,
  selectionPrune,
  selectionToggle,
  shownStage,
  statusSourceTone,
  stoppedRunMovedOn,
  trackingChain,
  trackingTone,
  writerBlock,
  writerFailedOf,
  writerFailedParams,
  writerRetryToast,
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
    assert.match(fn, /onSettled: \(\) => (\{\n\s+)?void client\.invalidateQueries\(\{ queryKey: dpdKeys\.all \}\)/, name)
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

test("the later note waits for a writer of a next version; none in this one", () => {
  assert.equal(isLaterWriter("shipment"), false)
  assert.equal(isLaterWriter("pickup"), false)
  assert.equal(isLaterWriter("fulfillmentStatus"), false)
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
  assert.ok(!("later" in en.account.points))
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

/* ------------------------------------------------------------------ */
/* The handover to the courier (stage 4)                               */
/* ------------------------------------------------------------------ */

const dispatchSource = source("lib/dpd-dispatch.tsx")
const plActions = source("i18n/pl.ts").match(/\n {4}actions: \{([^}]*)\}/)?.[1] ?? ""

const NO_ACTIONS: DispatchActions = { print: false, reprint: false, protocol: false, order: false, reschedule: false, cancelCourier: false, resolve: false, cancel: false, withdraw: false }

/** A handover as the server answers it, with the fields a test changes. */
function dispatchOf(over: Partial<DispatchDto> = {}): DispatchDto {
  return {
    id: "dsp_1",
    mode: "sandbox",
    demo: false,
    state: "pending",
    locationId: null,
    sender: null,
    shipmentIds: ["s1"],
    shipments: [],
    boxes: 1,
    weightKg: 2,
    params: null,
    problems: [],
    warnings: [],
    shipmentProblems: [],
    protocols: [],
    protocolAt: null,
    pickupDate: null,
    pickupTimeFrom: null,
    pickupTimeTo: null,
    orderType: null,
    orderNumber: null,
    hasCheckSum: false,
    orderedAt: null,
    simulated: true,
    error: null,
    errorCode: null,
    attempts: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: "2026-11-03T10:00:00.000Z",
    updatedAt: null,
    attention: false,
    actions: NO_ACTIONS,
    ...over,
  }
}

test("no writer is for later in this version", () => {
  assert.equal(isLaterWriter("pickup"), false)
  assert.ok(!LATER_WRITERS.includes("pickup"))
  assert.deepEqual([...LATER_WRITERS], [])
})

test("courierWindowChoices drops a passed window today and keeps it tomorrow", () => {
  const r = (from: string, to: string) => ({ from, to, offset: null, raw: `${from}-${to}` })
  const ranges = [r("12:00", "16:00"), r("08:00", "12:00"), r("08:00", "12:00"), r("08:00", "16:00")]
  /* Today at 12:30 the morning window has passed (its end is not after now); 12:00 to 16:00 still runs. */
  assert.deepEqual(courierWindowChoices(ranges, "2026-11-03", "2026-11-03", "12:30").map((c) => c.value), ["08:00-16:00", "12:00-16:00"])
  /* At the very end of a window it is gone too. */
  assert.deepEqual(courierWindowChoices(ranges, "2026-11-03", "2026-11-03", "16:00"), [])
  /* Tomorrow every window stays, sorted and without repeats. */
  const tomorrow = courierWindowChoices(ranges, "2026-11-04", "2026-11-03", "12:30")
  assert.deepEqual(tomorrow.map((c) => c.value), ["08:00-12:00", "08:00-16:00", "12:00-16:00"])
  assert.deepEqual(tomorrow[0], { value: "08:00-12:00", from: "08:00", to: "12:00", raw: "08:00-12:00" })
  assert.deepEqual(courierRequestOf("2026-11-04", tomorrow[0]), { pickupDate: "2026-11-04", pickupTimeFrom: "08:00", pickupTimeTo: "12:00" })
})

test("the drawer takes today and nowTime from the availability answer, never from the browser clock", () => {
  const fields = body(dispatchSource, "CourierWindowFields")
  assert.match(fields, /courierWindowChoices\(availability\.ranges, date, availability\.today, availability\.nowTime\)/)
  /* Wherever the choices are read, the today and nowTime of the same answer go in. */
  for (const m of dispatchSource.matchAll(/courierWindowChoices\(([^)]*)\)/g)) assert.match(m[1], /^(\w+)\.ranges, date, \1\.today, \1\.nowTime$/, m[0])
  assert.ok(!/new Date\(\)|Date\.now\(\)[^\n]*(today|nowTime)/.test(dispatchSource.replace(/const startedAt = Date\.now\(\)/g, "")), "no clock of the browser for the windows")
})

test("dispatchActionWriter: resolve, order, reschedule and cancelCourier need pickup; print, reprint and cancel need shipment", () => {
  for (const state of ["pending", "printed", "ordered", "unknown"] as const) {
    for (const action of ["resolve", "order", "reschedule", "cancelCourier"] as const) assert.equal(dispatchActionWriter(action, state), "pickup", `${action} ${state}`)
    for (const action of ["print", "reprint", "cancel"] as const) assert.equal(dispatchActionWriter(action, state), "shipment", `${action} ${state}`)
  }
  /* The drawer, the list and its main button disable an action by the writer of dispatchActionWriter. */
  const actions = body(dispatchSource, "useDispatchActions")
  for (const action of ["print", "reprint", "order", "reschedule", "cancelCourier", "resolve", "cancel"]) assert.ok(actions.includes(`blocked("${action}")`), action)
  assert.match(body(dispatchSource, "useDispatchBlock"), /dispatchActionWriter\(action, state\)/)
  assert.match(body(dispatchSource, "DispatchView"), /blockOf\("resolve", d\.state\)/)
})

test("dispatchActionWriter: withdraw needs pickup only for ordered, shipment for pending, printed and canceled", () => {
  assert.equal(dispatchActionWriter("withdraw", "ordered"), "pickup")
  for (const state of ["pending", "printed", "canceled"] as const) assert.equal(dispatchActionWriter("withdraw", state), "shipment", state)
  /* One writer for a withdraw in the action bar, never both. */
  const bar = body(plan, "ShipmentActionBar")
  assert.match(bar, /dispatchActionWriter\("withdraw", dispatch\.state\)/)
  assert.match(bar, /hidden: !\(s\.actions\.withdraw && dispatch\)/)
  /* The panel list does not know the handovers: no withdraw there, only the way to the handover (E14). */
  assert.ok(!/dispatch=\{/.test(source("lib/dpd-panel.tsx")))
  assert.match(source("lib/dpd-panel.tsx"), /onOpenDispatch=\{onOpenDispatch\}/)
  assert.match(source("widgets/dpd-order-widget.tsx"), /dispatch=\{dispatch\}/)
})

test("dispatchErrorTone: none without an error or while claimed, red for attention, else orange", () => {
  const e = { error: "DPD refused", errorCode: "pickup_time" }
  assert.equal(dispatchErrorTone({ state: "printed", error: null, errorCode: null, attention: false }), null)
  for (const state of ["printing", "ordering", "updating"] as const) assert.equal(dispatchErrorTone({ state, ...e, attention: false }), null, state)
  assert.equal(dispatchErrorTone({ state: "unknown", ...e, errorCode: "order_unclear", attention: true }), "red")
  assert.equal(dispatchErrorTone({ state: "ordered", ...e, errorCode: "update_unclear", attention: true }), "red")
  assert.equal(dispatchErrorTone({ state: "printed", ...e, attention: false }), "orange")
  assert.equal(dispatchErrorTone({ state: "pending", error: null, errorCode: "protocol_unclear", attention: false }), "orange")
})

test("the drawer renders dispatch.warnings with the orange tone and dispatch errors with DispatchErrorText", () => {
  assert.match(dispatchSource, /<ProblemList items=\{d\.warnings\} tone="orange" \/>/)
  assert.match(dispatchSource, /<ProblemList items=\{d\.problems\} \/>/)
  assert.match(dispatchSource, /<DispatchErrorText dispatch=\{d\} \/>/)
  /* The ErrorText of dpd-ui takes a shipment: never used for a handover. */
  assert.ok(!/\bErrorText\b[^\n]*from "\.\/dpd-ui"/.test(dispatchSource))
  assert.ok(!/<ErrorText /.test(dispatchSource))
  const text = body(dispatchSource, "DispatchErrorText")
  assert.match(text, /const tone = dispatchErrorTone\(d\)/)
  assert.match(text, /text-ui-tag-orange-text/)
  assert.match(text, /title=\{t\("dispatch\.error"\)\}/)
  assert.equal(typeof en.dispatch.error, "string")
})

test("useWriterBlockText is exported and names the option of the writer it gets", () => {
  const hook = body(plan, "useWriterBlockText")
  assert.match(plan, /export function useWriterBlockText\(\): \(block: "off" \| "not_armed", writer: WriterKey\)/)
  assert.match(hook, /WRITER_OPTION\[writer\]/)
  assert.ok(!hook.includes("WRITER_OPTION.shipment"))
  assert.match(dispatchSource, /import \{[^}]*useWriterBlockText[^}]*\} from "\.\/dpd-plan"/)
  /* The courier block of the drawer names the pickup writer's option. */
  assert.match(dispatchSource, /blockText\(.*, "pickup"\)/)
})

test("a not armed writer is named by its own words: a pickup block never asks to arm the shipment writer", () => {
  const hook = body(plan, "useWriterBlockText")
  assert.match(hook, /t\(`writers\.notArmed\.\$\{writer\}`\)/)
  assert.ok(!hook.includes("actionError.not_armed"), "the shipment words for every writer")
  assert.equal(en.writers.notArmed.shipment, en.actionError.not_armed)
  assert.notEqual(en.writers.notArmed.pickup, en.writers.notArmed.shipment)
  assert.match(en.writers.notArmed.pickup, /courier order/)
  /* Order, change, cancel, resolve and the withdraw from an ordered handover all ask with the pickup writer. */
  assert.match(body(dispatchSource, "useDispatchBlock"), /blockText\(block, key\)/)
  assert.match(plan, /blockText\(withdrawBlock, withdrawWriter\)/)
  /* A not armed refusal of a withdraw from the server names the same writer the button asks for. */
  assert.match(body(plan, "ShipmentActionBar"), /err\.code === "not_armed" \? blockText\("not_armed", withdrawWriter\)\.title : errorText\(err\)/)
})

test("defaultCourierDate prefers tomorrow", () => {
  assert.equal(defaultCourierDate(["2026-11-03", "2026-11-04", "2026-11-05"]), "2026-11-04")
  assert.equal(defaultCourierDate(["2026-11-03"]), "2026-11-03")
  assert.equal(defaultCourierDate([]), null)
})

test("a pickup date reads as a day in Warsaw in the admin's language, whatever the browser zone", () => {
  assert.equal(fmtPickupDate("2026-03-29", "en-GB"), "29 Mar 2026")
  assert.equal(fmtPickupDate("2026-10-25", "pl"), "25 paź 2026")
  assert.equal(fmtPickupDate("not a date", "pl"), "not a date")
  assert.match(source("lib/dpd-logic.ts"), /timeZone: "Europe\/Warsaw"/)
})

test("a list that shrank below its page goes to its last page with rows, in both lists", () => {
  assert.equal(pageInRange(1, 20, 20), 0, "21 rows on two pages, one resolved: back to the first page")
  assert.equal(pageInRange(1, 21, 20), 1)
  assert.equal(pageInRange(3, 45, 20), 2)
  assert.equal(pageInRange(2, 0, 20), 0, "an empty list has page 0")
  assert.equal(pageInRange(0, 0, 20), 0)
  assert.equal(pageInRange(-1, 50, 20), 0)
  assert.match(source("lib/dpd-dispatch.tsx"), /setPage\(\(p\) => pageInRange\(p, total, DISPATCH_PAGE\)\)/)
  assert.match(source("lib/dpd-panel.tsx"), /setPage\(\(p\) => pageInRange\(p, total, PAGE_SIZE\)\)/)
})

test("selectionToggle never goes above 100; selectionPageState none, some, all", () => {
  assert.equal(SELECTION_MAX, 100)
  const ids = Array.from({ length: 120 }, (_, i) => `s${i}`)
  const all = selectionToggle(new Set(), ids, true)
  assert.equal(all.size, 100)
  assert.ok(all.has("s0") && all.has("s99") && !all.has("s100"))
  assert.equal(selectionToggle(all, ["s150"], true).size, 100, "the limit holds for one more tick")
  assert.equal(selectionToggle(all, ["s5", "s6"], false).size, 98)
  const original = new Set(["a"])
  selectionToggle(original, ["b"], true)
  assert.deepEqual([...original], ["a"], "a new set, the old one untouched")
  assert.equal(selectionPageState(new Set(["a", "x"]), ["a", "b"]), "some")
  assert.equal(selectionPageState(new Set(["a", "b"]), ["a", "b"]), "all")
  assert.equal(selectionPageState(new Set(["x"]), ["a", "b"]), "none")
  assert.equal(selectionPageState(new Set(["x"]), []), "none")
  /* A picked row that stopped being a candidate leaves the selection; ids of other pages stay. */
  const picked = new Set(["a", "b", "z"])
  const pruned = selectionPrune(picked, [
    { id: "a", actions: { dispatch: false } },
    { id: "b", actions: { dispatch: true } },
    { id: "c", actions: { dispatch: false } },
  ])
  assert.deepEqual([...pruned], ["b", "z"])
  assert.equal(selectionPrune(picked, [{ id: "b", actions: { dispatch: true } }]), picked, "nothing gone: the same set")
  assert.match(source("lib/dpd-panel.tsx"), /setSelected\(\(sel\) => selectionPrune\(sel, listed\)\)/)
  assert.match(source("lib/dpd-dispatch.tsx"), /onPickGroup\(candidates\.map\(\(s\) => s\.id\)\)/, "the drawer hands over the rest without the left out ones")
  /* The list: a checkbox only for a candidate, the header one indeterminate for some. */
  const panel = source("lib/dpd-panel.tsx")
  assert.match(panel, /s\.actions\.dispatch \? \(\s*<Checkbox/)
  assert.match(panel, /pageState === "some" \? "indeterminate"/)
  assert.match(panel, /t\("shipments\.selectLimit", \{ max: SELECTION_MAX \}\)/)
  assert.match(panel, /<DispatchActionBar count=\{selected\.size\}/)
  /* The header box at the limit adds nothing: disabled with the limit hint, as the row boxes. */
  assert.match(panel, /const pageFull = full && pageState !== "all"/)
  assert.match(panel, /title=\{pageFull \? t\("shipments\.selectLimit", \{ max: SELECTION_MAX \}\) : t\("shipments\.selectPage"\)\}/)
  assert.match(panel, /disabled=\{pageIds\.length === 0 \|\| pageFull\}/)
  /* The page scrolls to the handover list once per request, not on every new status. */
  const page = source("routes/dpd/page.tsx")
  assert.match(page, /if \(scrollTo <= scrolled\.current \|\| !status\.data\) return/)
  assert.match(page, /scrolled\.current = scrollTo/)
})

test("dispatchMainAction order: resolve, print, order, protocol", () => {
  const all: DispatchActions = { ...NO_ACTIONS, print: true, order: true, protocol: true, resolve: true }
  assert.equal(dispatchMainAction(dispatchOf({ state: "unknown", attention: true, actions: all })), "resolve")
  assert.equal(dispatchMainAction(dispatchOf({ actions: { ...all, resolve: false } })), "print")
  assert.equal(dispatchMainAction(dispatchOf({ actions: { ...NO_ACTIONS, order: true, protocol: true } })), "order")
  assert.equal(dispatchMainAction(dispatchOf({ actions: { ...NO_ACTIONS, protocol: true, reprint: true } })), "protocol")
  assert.equal(dispatchMainAction(dispatchOf()), null)
  /* Ordered without a checkSum and without attention (O16): resolve stays an icon, the protocol is the button. */
  const calm = dispatchOf({ state: "ordered", hasCheckSum: false, attention: false, actions: { ...NO_ACTIONS, resolve: true, protocol: true, reprint: true } })
  assert.equal(dispatchMainAction(calm), "protocol")
  assert.equal(dispatchMainAction({ ...calm, actions: { ...calm.actions, protocol: false } }), null)
  /* Each name it can give has its words in both dictionaries (E25). */
  for (const name of ["resolve", "print", "order", "protocol"]) {
    assert.equal(typeof (en.dispatch.actions as Record<string, string>)[name], "string", name)
    assert.match(plActions, new RegExp(`\\b${name}: "`), `pl ${name}`)
  }
  assert.match(body(dispatchSource, "useDispatchActions"), /t\(`dispatch\.actions\.\$\{mainKey\}`\)/)
})

test("courierBlock: writer first, then the order problems", () => {
  const w = (key: WriterKey, armed: boolean, allowed = true): WriterDto => ({ key, armed, allowed, on: armed, updatedBy: null, updatedAt: null })
  const writers = (pickup: WriterDto) => ({ shipment: w("shipment", true), pickup, fulfillmentStatus: w("fulfillmentStatus", false) })
  const problems = [{ code: "courier_over_50kg" }]
  const off = w("pickup", false, false)
  assert.deepEqual(courierBlock(writers(off), problems), { kind: "writer", writer: off })
  assert.equal(courierBlock(writers(w("pickup", false)), [])?.kind, "writer")
  assert.deepEqual(courierBlock(writers(w("pickup", true)), problems), { kind: "problems", problems })
  assert.equal(courierBlock(writers(w("pickup", true)), []), null)
  assert.deepEqual(courierBlock(undefined, problems), { kind: "problems", problems })
  assert.equal(courierBlock(undefined, []), null)
})

test("dispatchFilterOf falls back to open", () => {
  assert.deepEqual([...DISPATCH_FILTERS], ["open", "attention", "all"])
  for (const f of DISPATCH_FILTERS) assert.equal(dispatchFilterOf(f), f)
  assert.equal(dispatchFilterOf(null), "open")
  assert.equal(dispatchFilterOf("problems"), "open")
  assert.equal(dispatchFilterOf(""), "open")
})

test("the tone of a handover: red when it needs a person, orange while it waits, blue while it works, green ordered, grey canceled", () => {
  assert.equal(dispatchTone({ state: "pending", attention: false }), "orange")
  assert.equal(dispatchTone({ state: "printed", attention: false }), "orange")
  for (const state of ["printing", "ordering", "updating"] as const) assert.equal(dispatchTone({ state, attention: false }), "blue", state)
  assert.equal(dispatchTone({ state: "ordered", attention: false }), "green")
  assert.equal(dispatchTone({ state: "ordered", attention: true }), "red")
  assert.equal(dispatchTone({ state: "unknown", attention: true }), "red")
  assert.equal(dispatchTone({ state: "canceled", attention: false }), "grey")
})

test("the toast of a print: success only with a new protocol, never from a leftover attention code", () => {
  const p = (id: string) => ({ id, documentId: null, createdAt: null, shipments: 1, stale: false })
  const d = (state: DispatchDto["state"], errorCode: string | null, attention: boolean, n: number) => ({ state, errorCode, attention, protocols: Array.from({ length: n }, (_, i) => p(String(i))) })
  assert.equal(printToastKind(d("printed", null, false, 1), 0), "printed")
  /* A reprint of an ordered handover with update_unclear or order_status keeps the code (P10): a new protocol is still a success. */
  assert.equal(printToastKind(d("ordered", "update_unclear", true, 2), 1), "printed")
  assert.equal(printToastKind(d("ordered", "order_status", true, 1), 1), "failed", "no new protocol: the attention code says nothing about the print")
  assert.equal(printToastKind(d("pending", "pickup_fid", false, 0), 0), "refused")
  assert.equal(printToastKind(d("printed", "pickup_fid", false, 1), 1), "refused")
  assert.equal(printToastKind(d("pending", "protocol_unclear", false, 0), 0), "unclear")
  const toastBody = body(dispatchSource, "useDispatchToast")
  assert.match(toastBody, /printToastKind\(d, protocolsBefore\)/)
  assert.match(body(dispatchSource, "useDispatchActions"), /const protocolsBefore = d\.protocols\.length/)
})

test("the newest protocol, and the stage a stopped run starts again at, never the create once the handover exists", () => {
  const p = (id: string, createdAt: string | null) => ({ id, documentId: null, createdAt, shipments: 1, stale: false })
  assert.equal(latestProtocol({ protocols: [] }), null)
  assert.equal(latestProtocol({ protocols: [p("a", "2026-11-03T10:00:00Z"), p("b", "2026-11-03T11:00:00Z"), p("c", null)] })?.id, "b")
  assert.equal(handoverStepOf(null, false, false), 0)
  assert.equal(handoverStepOf("pending", false, true), 0)
  /* A refused first protocol (pickup_fid, parcel_limit come from the protocol too) starts again at the print, with or without a courier. */
  assert.equal(handoverStepOf("pending", true, false), 1)
  assert.equal(handoverStepOf("pending", true, true), 1)
  assert.equal(handoverStepOf("printed", true, true), 2)
  /* Printed meanwhile (the view's button, an answer lost on the way back): never printed again by "Try again". */
  assert.equal(handoverStepOf("printed", true, false), null)
  for (const state of ["ordered", "unknown", "canceled", "printing", "ordering", "updating"] as const) assert.equal(handoverStepOf(state, true, true), null, state)
  assert.equal(handoverStepOf(null, true, true), null, "the state not read yet")
  const drawer = body(dispatchSource, "NewDispatch")
  assert.match(drawer, /handoverStepOf\(nowState, createdId !== null, order !== null\)/)
  assert.match(drawer, /live\.dataUpdatedAt > stopped\.at/, "only a read after the stop replaces the state of the answer")
  assert.match(drawer, /run && !movedOn \?/, "the loader of a stopped run goes once the handover moved on")
  assert.match(drawer, /const movedOn = stoppedRunMovedOn\(stopped, fresh, retryFrom\)/)
  assert.match(drawer, /setStopped\(\{ stage: key, state:/)
  /* A stop with the state of the answer: any other state later is history. */
  assert.equal(stoppedRunMovedOn({ stage: "order", state: "printed" }, "ordered", null), true)
  assert.equal(stoppedRunMovedOn({ stage: "order", state: "printed" }, "printed", 2), false)
  /* A failed request (no state): past the stage and nothing to continue is history; still at it, or a retry to offer, keeps the loader. */
  assert.equal(stoppedRunMovedOn({ stage: "protocol", state: null }, "printed", null), true, "the server printed behind a lost answer")
  assert.equal(stoppedRunMovedOn({ stage: "protocol", state: null }, "printed", 2), false, "with a courier the run goes on to the order")
  assert.equal(stoppedRunMovedOn({ stage: "protocol", state: null }, "pending", 1), false)
  assert.equal(stoppedRunMovedOn({ stage: "protocol", state: null }, "printing", null), false, "still printing")
  assert.equal(stoppedRunMovedOn({ stage: "order", state: null }, "ordered", null), true, "ordered from the view")
  assert.equal(stoppedRunMovedOn({ stage: "order", state: null }, "ordering", null), false)
  assert.equal(stoppedRunMovedOn({ stage: "order", state: null }, null, null), false, "no read after the stop yet")
  assert.equal(stoppedRunMovedOn(null, "ordered", null), false)
  assert.match(drawer, /retryFrom !== null \? onRetry : undefined/)
  assert.doesNotMatch(drawer, /stopped\.code|stopped\.printed/)
  /* The protocol and the order wait for their state: a 200 in another state stops the stage. */
  assert.match(drawer, /res\.dispatch\.state !== "printed"/)
  assert.match(drawer, /res\.dispatch\.state !== "ordered"/)
})

test("a failed change on an attention handover never gives its kept code as the reason; a new code does", () => {
  const attention = { attention: true, errorCode: "update_unclear" }
  assert.equal(changeReasonCode(attention, { errorCode: "update_unclear" }), null, "kept by P10: says nothing about this attempt")
  assert.equal(changeReasonCode(attention, { errorCode: "cancel_unclear" }), "cancel_unclear")
  assert.equal(changeReasonCode(attention, { errorCode: null }), null)
  assert.equal(changeReasonCode({ attention: false, errorCode: "pickup_time" }, { errorCode: "pickup_time" }), "pickup_time", "not attention: the code is this answer's")
  assert.equal(changeReasonCode({ attention: false, errorCode: null }, { errorCode: "update_unclear" }), "update_unclear")
  assert.match(body(dispatchSource, "useDispatchToast"), /codeText\(before \? changeReasonCode\(before, d\) : d\.errorCode\)/)
  assert.match(body(dispatchSource, "useDispatchActions"), /action === "cancelCourier" \? before : undefined/)
  assert.match(body(dispatchSource, "CourierOrderForm"), /dispatchToast\(res, mode, 0, before\)/)
  assert.match(body(dispatchSource, "CourierOrderForm"), /codeText\(changeReasonCode\(before, res\.dispatch\)\)/)
  assert.match(plan, /const code = dispatch \? changeReasonCode\(dispatch, res\.dispatch\) : res\.dispatch\.errorCode/)
})

test("courierFormAllowed: the form sends and offers Try again only while the newer of the handover and its answer allows the mode", () => {
  const printed = dispatchOf({ state: "printed", updatedAt: "2026-11-03T10:00:00.000Z", actions: { ...NO_ACTIONS, order: true, cancel: true } })
  const unknown = dispatchOf({ state: "unknown", errorCode: "order_unclear", updatedAt: "2026-11-03T10:00:05.000Z", actions: { ...NO_ACTIONS, resolve: true } })
  const ordered = dispatchOf({ state: "ordered", hasCheckSum: true, updatedAt: "2026-11-03T10:00:05.000Z", actions: { ...NO_ACTIONS, reschedule: true, cancelCourier: true } })
  assert.equal(courierFormAllowed("order", printed, null), true)
  /* The answer went unknown, the host has not read it yet: no second order. */
  assert.equal(courierFormAllowed("order", printed, unknown), false)
  /* The host read it. */
  assert.equal(courierFormAllowed("order", unknown, unknown), false)
  /* Resolved back to printed after the answer: the order is open again. */
  assert.equal(courierFormAllowed("order", { ...printed, updatedAt: "2026-11-03T10:01:00.000Z" }, unknown), true)
  /* A refused order stays printed: Try again is fine. */
  assert.equal(courierFormAllowed("order", printed, { ...printed, errorCode: "pickup_time", updatedAt: "2026-11-03T10:00:05.000Z" }), true)
  /* An order ordered with a code (or ordered elsewhere) is no order any more; a change is. */
  assert.equal(courierFormAllowed("order", printed, ordered), false)
  assert.equal(courierFormAllowed("reschedule", ordered, null), true)
  assert.equal(courierFormAllowed("reschedule", ordered, { ...ordered, errorCode: "update_unclear" }), true, "a change may be tried again")
  assert.equal(courierFormAllowed("reschedule", ordered, { ...unknown, updatedAt: "2026-11-03T10:00:06.000Z" }), false)
  assert.equal(courierFormAllowed("reschedule", { ...ordered, updatedAt: null }, { ...printed, updatedAt: "2026-11-03T10:00:06.000Z" }), false, "no time on the host: the answer counts")
  const form = body(dispatchSource, "CourierOrderForm")
  assert.match(form, /const allowed = courierFormAllowed\(mode, dispatch, answer\)/)
  assert.match(form, /setAnswer\(res\.dispatch\)/)
  assert.match(form, /onRetry=\{run\.status === "error" && allowed \? /)
  assert.match(form, /disabled=\{!allowed \|\| !choice/)
  assert.match(form, /if \(!choice \|\| !date \|\| !allowed\) return/)
})

test("the list's courier drawer reads the handover by its id: the form never works on the row of the click", () => {
  const section = body(dispatchSource, "DispatchesSection")
  assert.match(section, /useState<\{ id: string; mode: "order" \| "reschedule" \} \| null>/)
  assert.match(section, /setForm\(\{ id: d\.id, mode: "order" \}\)/)
  assert.match(section, /setForm\(\{ id: d\.id, mode: "reschedule" \}\)/)
  assert.match(section, /<CourierOrderDrawer id=\{form\.id\}/)
  assert.ok(!/useState<\{ dispatch: DispatchDto/.test(section), "no snapshot of a row in the state")
  const drawer = body(dispatchSource, "CourierOrderDrawer")
  assert.match(drawer, /const q = useDpdDispatch\(id\)/)
  assert.match(drawer, /<CourierOrderForm dispatch=\{d\} mode=\{mode\}/)
})

test("no courier hours from DPD: the tip reads them again or prints only, the ticked courier is never dropped quietly", () => {
  const drawer = body(dispatchSource, "NewDispatch")
  assert.match(drawer, /availability\.refetch\(\)/)
  assert.match(drawer, /onClick=\{\(\) => setCourier\(false\)\}>\s*\{t\("dispatch\.courier\.printOnly"\)\}/)
  assert.match(drawer, /\(!wantsCourier \|\| \(choice && date\)\)/, "with the box ticked the create still needs a window (13.2.4 point 7)")
})

test("a handover drawer opened from the page closes back to the entry it came from; from a link it replaces it", () => {
  const page = source("routes/dpd/page.tsx")
  assert.match(page, /if \(!id && pushed\.current\) \{\s*pushed\.current = false\s*navigate\(-1\)/)
  assert.match(page, /pushed\.current = Boolean\(id\)\s*setParams\(p, \{ replace: !id \}\)/)
})

test("the availability key is outside dpdKeys.all", () => {
  assert.match(api, /export const availabilityKey = \(target: `dispatch:\$\{string\}` \| `group:\$\{string\}`\) => \["dpd-availability", target\] as const/)
  for (const name of ["useDpdDispatchAvailability", "useDpdGroupAvailability"]) {
    const hook = body(api, name)
    assert.match(hook, /queryKey: availabilityKey\(/, name)
    assert.match(hook, /staleTime: 60_000/, name)
    assert.match(hook, /retry: false/, name)
  }
  /* Every action refreshes dpdKeys.all, never the hours. */
  assert.match(body(api, "useBoundAction"), /onSettled: \(\) => void client\.invalidateQueries\(\{ queryKey: dpdKeys\.all \}\)/)
  assert.match(body(api, "useDpdDispatch"), /isClaimedDispatch\(state\) \? 3000 : false/)
})

test("the poll of a claimed handover refreshes the list, the shipments and the tile once the work ends", () => {
  assert.equal(dispatchLeftClaim("printing", "printed"), true)
  assert.equal(dispatchLeftClaim("printing", "unknown"), true, "a lease expiry needs a person: the tile counts it now")
  assert.equal(dispatchLeftClaim("ordering", "ordered"), true)
  assert.equal(dispatchLeftClaim("updating", "ordered"), true)
  assert.equal(dispatchLeftClaim("printing", "printing"), false, "still working: the poll goes on")
  assert.equal(dispatchLeftClaim("printing", "ordering"), false)
  assert.equal(dispatchLeftClaim("printed", "printed"), false, "never claimed: nothing to catch up")
  assert.equal(dispatchLeftClaim("pending", "printed"), false)
  assert.equal(dispatchLeftClaim(null, "printed"), false, "the first read")
  assert.equal(dispatchLeftClaim("printing", null), false)
  const hook = body(api, "useDpdDispatch")
  assert.match(hook, /const seen = useRef<\{ id: string \| null; state: DispatchState \| null \}>\(\{ id, state \}\)/)
  assert.match(hook, /if \(before\.id === id && dispatchLeftClaim\(before\.state, state\)\) void client\.invalidateQueries\(\{ queryKey: dpdKeys\.all \}, \{ cancelRefetch: false \}\)/)
  assert.match(hook, /\}, \[client, id, state\]\)/)
})

test("openProtocol opens the tab before the request", () => {
  const open = body(api, "openProtocol")
  const tab = open.indexOf('window.open("", "_blank")')
  const request = open.indexOf("fetchLabelFile(")
  assert.ok(tab > 0 && request > tab, "the tab first, while the click still allows it")
  assert.match(open, /kitRequestInit\(/)
  assert.match(open, /URL\.createObjectURL\(/)
  assert.match(open, /tab\?\.close\(\)/)
  assert.ok(!/window\.open\(\s*protocolUrl/.test(dispatchSource), "a bare protocol URL in a new tab carries no JWT")
})

test("the subtitle no longer says the courier order comes later", () => {
  assert.ok(!/courier order[^.;]*later/i.test(en.subtitle), en.subtitle)
  assert.ok(!/courier order[^.;]*later/i.test(en.writers.later), en.writers.later)
})

test("the drawer uses a native date input and the ui Select, never a menu", () => {
  assert.match(dispatchSource, /type="date"/)
  assert.match(dispatchSource, /<Select\.Item /)
  assert.ok(!dispatchSource.includes("DropdownMenu"))
  /* The cost is asked before a courier is ordered, never before the protocol alone. */
  assert.match(body(dispatchSource, "NewDispatch"), /if \(courierOrder\) \{\s*const yes = await prompt\(/)
})

test("the handover texts: a refused action reads the handover words first, then the shipment ones", () => {
  const text = body(dispatchSource, "useDispatchErrorText")
  assert.match(text, /`dispatch\.actionError\.\$\{code\}`/)
  assert.match(text, /actionText\(err\)/)
  for (const code of ["busy", "not_armed", "writer_off", "not_found", "wrong_state", "plan_changed"]) assert.equal(typeof (en.dispatch.actionError as Record<string, string>)[code], "string", code)
})

test("settings: the pickup writer says when its orders are simulated", () => {
  const settings = source("lib/dpd-settings.tsx")
  assert.match(settings, /key === "pickup" && s\.options\.courierOrders === "simulated"/)
  assert.match(settings, /<InlineTip variant="info" label=\{t\("writers\.pickupSimulatedLabel"\)\}>/)
  assert.match(settings, /\{note \? <div className="pt-1">\{note\}<\/div> : null\}/)
})

/* ------------------------------------------------------------------ */
/* DPD statuses (stage 5)                                              */
/* ------------------------------------------------------------------ */

/** A waybill of a shipment as the admin gets it, with no event yet unless `over` says otherwise. */
function entry(over: Partial<TrackingDto> & Pick<TrackingDto, "waybill">): TrackingDto {
  return {
    box: 0,
    role: "outbound",
    stage: null,
    code: null,
    at: null,
    lastCode: null,
    lastAt: null,
    description: null,
    possession: false,
    supersededBy: null,
    supersededAt: null,
    from: null,
    checkedAt: null,
    done: false,
    ...over,
  }
}

const statusSources = {
  plan: source("lib/dpd-plan.tsx"),
  ui: source("lib/dpd-ui.tsx"),
  panel: source("lib/dpd-panel.tsx"),
  page: source("routes/dpd/page.tsx"),
  settings: source("lib/dpd-settings.tsx"),
  widget: source("widgets/dpd-order-widget.tsx"),
  guide: source("lib/dpd-guide-view.tsx"),
}

test("shownStage shows a labeled stage and a created row past preparing", () => {
  assert.equal(shownStage({ state: "labeled", stage: "in_transit" }), "in_transit")
  assert.equal(shownStage({ state: "labeled", stage: "preparing" }), "preparing")
  assert.equal(shownStage({ state: "labeled", stage: null }), null)
  /* A created row (waybills, the label did not come) shows where DPD has the parcel, not a stage of its own before that. */
  assert.equal(shownStage({ state: "created", stage: "delivered" }), "delivered")
  assert.equal(shownStage({ state: "created", stage: "preparing" }), null)
  assert.equal(shownStage({ state: "pending", stage: "in_transit" }), null)
  /* The badge reads the stage from shownStage and its tone from the plain logic. */
  assert.match(body(statusSources.ui, "ShipmentStatus"), /const stage = shownStage\(shipment\)/)
  assert.match(statusSources.ui, /import \{ STAGE_TONE,[^}]*\} from "\.\/dpd-logic"/)
  assert.ok(!/const STAGE_TONE/.test(statusSources.ui), "STAGE_TONE lives in dpd-logic.ts")
})

test("trackingTone greys a superseded waybill", () => {
  assert.equal(trackingTone({ stage: "delivered", supersededBy: null }), "green")
  assert.equal(trackingTone({ stage: "delivered", supersededBy: "0000000000302R" }), "grey")
  assert.equal(trackingTone({ stage: "returned", supersededBy: null }), "red")
  assert.equal(trackingTone({ stage: null, supersededBy: null }), "grey")
  assert.deepEqual(STAGE_TONE, { preparing: "blue", ready: "blue", in_transit: "blue", in_point: "blue", delivered: "green", problem: "red", returned: "red", canceled: "grey" })
})

test("trackingChain puts the current waybill first and the old ones after it", () => {
  const entries = [
    entry({ waybill: "0000000000101S", box: 0, stage: "delivered" }),
    entry({ waybill: "0000000000302R", box: 1, role: "return", stage: "returned", from: "0000000000303R" }),
    /* Superseded entries come after the live ones (readTracking order). */
    entry({ waybill: "0000000000301S", box: 1, stage: "in_transit", supersededBy: "0000000000303R" }),
    entry({ waybill: "0000000000303R", box: 1, stage: "in_transit", supersededBy: "0000000000302R", from: "0000000000301S" }),
  ]
  const chain = trackingChain(entries)
  assert.deepEqual(
    chain.map((g) => ({ box: g.box, current: g.current.waybill, previous: g.previous.map((e) => e.waybill) })),
    [
      { box: 0, current: "0000000000101S", previous: [] },
      /* The newest replaced waybill first. */
      { box: 1, current: "0000000000302R", previous: ["0000000000303R", "0000000000301S"] },
    ],
  )
  assert.equal(chain[1].current.role, "return")
  /* A repinned entry without its pair (no `from` leads to it) is a current of its own, in box order. */
  const orphan = trackingChain([entry({ waybill: "0000000000202K", box: 1 }), entry({ waybill: "0000000000201S", box: 0, supersededBy: "0000000000999R" })])
  assert.deepEqual(orphan.map((g) => g.current.waybill), ["0000000000201S", "0000000000202K"])
  assert.deepEqual(trackingChain([]), [])
})

test("canRefreshStatus hides the action for source off and while loading", () => {
  const row = (refreshStatus: boolean) => ({ actions: { refreshStatus } as ShipmentActions })
  assert.equal(canRefreshStatus(row(true), "dpd"), true)
  assert.equal(canRefreshStatus(row(true), "simulated"), true)
  assert.equal(canRefreshStatus(row(true), "off"), false)
  assert.equal(canRefreshStatus(row(true), null), false)
  assert.equal(canRefreshStatus(row(false), "dpd"), false)
  /* The retry of a status write: hidden when the host does not know the writer (the handover drawer), never read as not armed. */
  const writer = { allowed: true, armed: false }
  const retry = (retryStatusWriter: boolean) => ({ actions: { retryStatusWriter } as ShipmentActions })
  assert.equal(canRetryStatusWriter(retry(true), writer), true)
  assert.equal(canRetryStatusWriter(retry(true), undefined), false)
  assert.equal(canRetryStatusWriter(retry(false), writer), false)
  assert.ok(!/statusWriter=/.test(dispatchSource), "the handover drawer passes no status writer")
  /* The bar asks it for the refresh, and the refresh is never the main action. */
  const bar = body(statusSources.plan, "ShipmentActionBar")
  assert.match(bar, /hidden: !canRefreshStatus\(s, statusSource\)/)
  assert.match(bar, /hidden: !canRetryStatusWriter\(s, statusWriter\)/)
  assert.match(bar, /\["plan", "fetchLabel", "retryStatusWriter", "label", "lookup", "accept", "restore"\]/)
})

test("writerFailedOf reads only failed", () => {
  assert.equal(writerFailedOf("failed"), true)
  assert.equal(writerFailedOf(null), false)
  assert.equal(writerFailedOf(""), false)
  assert.equal(writerFailedOf("FAILED"), false)
  assert.equal(writerFailedOf("true"), false)
  assert.match(statusSources.page, /writerFailedOf\(params\.get\("writer"\)\)/)
})

test("statusSourceTone", () => {
  assert.equal(statusSourceTone("dpd"), "green")
  assert.equal(statusSourceTone("simulated"), "blue")
  assert.equal(statusSourceTone("off"), "orange")
})

test("the panel shows the writer failed filter only with a count or when active", () => {
  const section = body(statusSources.panel, "ShipmentsSection")
  assert.match(section, /\{counts\.statusesAttention > 0 \|\| writerFailed \? \(/)
  assert.match(section, /label=\{t\("statuses\.writerFailedFilter"\)\}/)
  assert.match(section, /count=\{counts\.statusesAttention\}/)
  assert.match(section, /active=\{writerFailed\}/)
  assert.match(section, /onClick=\{\(\) => onWriterFailed\?\.\(!writerFailed\)\}/)
  /* The list asks the server with it, and a change goes back to the first page. */
  assert.match(section, /useDpdShipments\(filter, q, page \* PAGE_SIZE, PAGE_SIZE, writerFailed\)/)
  assert.match(section, /useEffect\(\(\) => setPage\(0\), \[filter, q, writerFailed\]\)/)
  /* The row shows the last DPD event without the check line, and a status Medusa did not take. */
  const cell = body(statusSources.panel, "StatusCell")
  assert.match(cell, /<StatusLine shipment=\{s\} lang=\{lang\} compact \/>/)
  assert.match(cell, /<WriterErrorText shipment=\{s\} \/>/)
  /* The header note opens the same filter, and the page keeps it in the URL. */
  assert.match(body(statusSources.page, "Warnings"), /open: \{ label: t\("missing\.statusesOpen"\), run: onWriterFailed \}/)
  assert.match(body(statusSources.page, "Warnings"), /if \(code === "tracking_mode_queue_unsupported"\) continue/)
  assert.match(statusSources.page, /setParams\(writerFailedParams\(params, on, \{ atDispatches, filter: f, clearSearch \}\), \{ replace: true \}\)/)
})

test("the header note shows every row whose status Medusa did not take: it drops the group filter and the search, the filter bar button joins them", () => {
  /* The note counts all of them (counts.statusesAttention), so a tile left active would show a part of them or none. */
  assert.match(statusSources.page, /const showWriterFailed = \(\) => \{\s+setFilter\("all"\)\s+setSearchReset\(\(n\) => n \+ 1\)\s+writeWriterFailed\(true, "all", true\)\s+\}/)
  /* The filter bar button writes the URL with the filter the page shows and keeps the search. */
  assert.match(statusSources.page, /const setWriterFailed = \(on: boolean\) => writeWriterFailed\(on, filter, false\)/)
  /* One URL write per change: the page never builds the writer parameter itself (a second write from stale params kept ?filter and ?q). */
  assert.ok(!/p\.set\("writer"/.test(statusSources.page), "the writer parameter is written by writerFailedParams only")
  assert.match(statusSources.page, /<Warnings status=\{s\} lang=\{lang\} onSettings=\{\(tab\) => nav\.go\("settings", tab\)\} onWriterFailed=\{showWriterFailed\} \/>/)
  assert.match(statusSources.page, /searchReset=\{searchReset\}/)
  const section = body(statusSources.panel, "ShipmentsSection")
  assert.match(section, /useEffect\(\(\) => \{\s+if \(searchReset > 0\) setSearch\(""\)\s+\}, \[searchReset\]\)/)
  /* The filter bar button keeps the group filter and the search (10.6). */
  assert.match(statusSources.page, /onWriterFailed=\{setWriterFailed\}/)
  assert.match(section, /onClick=\{\(\) => onWriterFailed\?\.\(!writerFailed\)\}/)
})

test("writerFailedParams: the header note's URL drops the group filter and the search, so a reload shows what the note counts", () => {
  const url = (q: string, on: boolean, opts: Parameters<typeof writerFailedParams>[2]) => writerFailedParams(new URLSearchParams(q), on, opts).toString()
  const note = { atDispatches: false, filter: "all", clearSearch: true } as const
  /* The board counter (shipments_problems) and the order card's More link open the page with ?filter and ?q. */
  assert.equal(url("filter=problems", true, note), "writer=failed")
  assert.equal(url("q=1042", true, note), "writer=failed")
  assert.equal(url("filter=problems&q=1042&dispatch=d_1", true, note), "dispatch=d_1&writer=failed")
  /* At the handover list ?filter is that list's and stays; the search still goes. */
  assert.equal(url("view=dispatches&filter=attention&q=1042", true, { ...note, atDispatches: true }), "view=dispatches&filter=attention&writer=failed")
  /* The filter bar button: the filter the page shows now (a tile clicked since the deep link), the search stays. */
  const bar = (filter: "all" | "problems" | "in_transit") => ({ atDispatches: false, filter, clearSearch: false })
  assert.equal(url("filter=problems&q=1042", true, bar("in_transit")), "filter=in_transit&q=1042&writer=failed")
  assert.equal(url("filter=problems", true, bar("all")), "writer=failed")
  assert.equal(url("filter=problems&writer=failed", false, bar("problems")), "filter=problems")
  assert.equal(url("view=dispatches&filter=open&writer=failed", false, { ...bar("all"), atDispatches: true }), "view=dispatches&filter=open")
  /* The params read are never changed in place. */
  const params = new URLSearchParams("filter=problems&q=1042")
  writerFailedParams(params, true, note)
  assert.equal(params.toString(), "filter=problems&q=1042")
})

test("the list sends writer=failed only when asked, and its key carries the flag last", () => {
  const list = body(api, "useDpdShipments")
  assert.match(list, /if \(writerFailed\) params\.set\("writer", "failed"\)/)
  assert.match(list, /queryKey: dpdKeys\.shipments\(filter, q, offset, limit, writerFailed\)/)
  assert.match(api, /\["dpd", "shipments", filter, q, offset, limit, writerFailed\] as const/)
  /* Both status actions go through useAction, so every answer, a refusal too, reads the page again, and the order page of Medusa too: they can mark its fulfillment. */
  assert.match(api, /useDpdRefreshStatus = \(\) => useAction<Record<never, never>, ActionResponse>\(\(id\) => shipmentPath\(id, "refresh-status"\), true\)/)
  assert.match(api, /useDpdRetryStatusWriter = \(\) => useAction<Record<never, never>, RetryStatusWriterResponse>\(\(id\) => shipmentPath\(id, "retry-status-writer"\), true\)/)
  assert.match(api, /export const MEDUSA_ORDER_KEYS = \["orders"\] as const/)
  assert.match(body(api, "useAction"), /if \(writesOrder\) void client\.invalidateQueries\(\{ queryKey: MEDUSA_ORDER_KEYS \}\)/)
  /* No other action writes the Medusa fulfillment: only these two ask for it. */
  assert.equal((api.match(/, true\)$/gm) ?? []).length, 2)
})

test("the settings show the status source instead of the later point", () => {
  const account = body(statusSources.settings, "AccountSection")
  assert.ok(!statusSources.settings.includes("account.points.later"))
  assert.match(account, /text: t\(`statusSource\.\$\{s\.statuses\.source\}`\), tone: statusSourceTone\(s\.statuses\.source\)/)
  assert.match(account, /<Fact label=\{t\("account\.statusSource"\)\}>/)
  assert.match(account, /<Fact label=\{t\("statuses\.lastSync"\)\}>/)
  assert.match(account, /variant=\{code === "tracking_mode_queue_unsupported" \? "info" : "warning"\}/)
  /* The fulfillment status writer says what it writes in this mode; live with InfoServices needs no note. */
  const writers = body(statusSources.settings, "WritersSection")
  assert.match(writers, /t\("statuses\.writerDemo"\)/)
  assert.match(writers, /t\("statuses\.writerSandbox"\)/)
  assert.match(writers, /s\.statuses\.source === "off"/)
  assert.match(writers, /key === "fulfillmentStatus" \? \(\s*statusNote/)
})

test("the order card reads the status source from useDpdStatus", () => {
  const card = body(statusSources.widget, "DpdOrderCard")
  assert.match(card, /const status = useDpdStatus\(\)/)
  /* Before the early returns: a hook after them would change the hook order between renders. */
  assert.ok(card.indexOf("useDpdStatus()") < card.indexOf("if (q.isLoading)"))
  assert.match(card, /statusSource=\{status\.data\?\.statuses\.source \?\? null\}/)
  assert.match(card, /statusWriter=\{info\.writers\.fulfillmentStatus\}/)
  const block = body(statusSources.widget, "ShipmentBlock")
  assert.match(block, /<StatusLine shipment=\{s\} lang=\{lang\} source=\{statusSource\} \/>/)
  assert.match(block, /<WriterErrorText shipment=\{s\} \/>/)
  assert.match(block, /statusSource=\{statusSource\}\s*statusWriter=\{statusWriter\}/)
  /* The history names the status actions and marks a simulated DPD event. */
  const history = body(statusSources.widget, "History")
  assert.match(history, /t\(`history\.status\.\$\{e\.action\}`\)/)
  assert.match(history, /t\("statuses\.simulated"\)/)
})

test("useStatusErrorText reads statuses.actionError first and the status writer for not_armed", () => {
  const text = body(statusSources.plan, "useStatusErrorText")
  assert.match(text, /t\(`statuses\.actionError\.\$\{code\}`\)/)
  assert.match(text, /if \(code === "not_armed"\) return t\("writers\.notArmed\.fulfillmentStatus"\)/)
  assert.match(text, /return actionText\(err\)/)
  assert.ok(text.indexOf("statuses.actionError") < text.indexOf("actionText(err)"), "the status words first")
  assert.match(statusSources.plan, /const STATUS_ACTION_ERRORS: readonly string\[\] = \["rate_limited", "not_configured", "wrong_state", "busy"\]/)
  for (const code of ["rate_limited", "not_configured", "wrong_state", "busy"]) assert.equal(typeof (en.statuses.actionError as Record<string, string>)[code], "string", code)
  /* E56: the toast reads what the writer did, never the cleared error alone. */
  const bar = body(statusSources.plan, "ShipmentActionBar")
  assert.match(bar, /const shown = writerRetryToast\(res\.result\)\s*toast\[shown\.kind\]\(t\(shown\.key\)\)/)
  assert.doesNotMatch(bar, /statusWriterError === null/)
})

test("writerRetryToast tells written only when Medusa has the status (E56)", () => {
  assert.deepEqual(writerRetryToast("written"), { kind: "success", key: "toast.statusWritten" })
  assert.deepEqual(writerRetryToast("failed"), { kind: "warning", key: "toast.statusWriteFailed" })
  assert.deepEqual(writerRetryToast("nothing_left"), { kind: "info", key: "toast.statusNothingLeft" })
  assert.deepEqual(writerRetryToast("in_progress"), { kind: "info", key: "toast.statusWriteBusy" })
  assert.deepEqual(writerRetryToast("not_written"), { kind: "warning", key: "toast.statusNotWritten" })
  for (const result of WRITER_RETRY_RESULTS) {
    const key = writerRetryToast(result).key.replace("toast.", "")
    assert.equal(typeof (en.toast as Record<string, string>)[key], "string", `en ${key}`)
    assert.match(source("i18n/pl.ts"), new RegExp(`\n {4}${key}: "`), `pl ${key}`)
    if (result !== "written") assert.notEqual(writerRetryToast(result).kind, "success", result)
  }
})

test("the statuses guide step is todo only in live mode", () => {
  assert.match(statusSources.guide, /id: "statuses",[\s\S]*?state: state\([^)]*, s\.mode === "live" \? "todo" : "optional"\)/)
  assert.match(statusSources.guide, /const statusesOk = s\.statuses\.source === "dpd" && !s\.statuses\.problems\.includes\("statuses_auth"\)/)
  assert.match(statusSources.guide, /\{ label: t\("guide\.checklist\.statuses"\), done: live && statusesOk \}/)
  /* After the arm step, and between armed and live on the checklist. */
  assert.ok(statusSources.guide.indexOf('id: "arm"') < statusSources.guide.indexOf('id: "statuses"'))
  assert.ok(statusSources.guide.indexOf("guide.checklist.armed") < statusSources.guide.indexOf("guide.checklist.statuses"))
  assert.ok(statusSources.guide.indexOf("guide.checklist.statuses") < statusSources.guide.indexOf("guide.checklist.live"))
})

test("Checked in DPD is the last ok answer of a waybill, never the claim time of the pass (E53)", () => {
  assert.equal(lastAnsweredAt([]), null)
  assert.equal(lastAnsweredAt([entry({ waybill: "A" }), entry({ waybill: "B", box: 1 })]), null, "never answered: no line, whatever the claim time")
  const answered = [
    entry({ waybill: "A", checkedAt: "2026-11-03T09:00:00.000Z" }),
    entry({ waybill: "B", box: 1, checkedAt: "2026-11-03T10:30:00.000Z" }),
    entry({ waybill: "C", box: 2, checkedAt: null }),
    entry({ waybill: "D", box: 3, checkedAt: "not a time" }),
  ]
  assert.equal(lastAnsweredAt(answered), "2026-11-03T10:30:00.000Z")
  const line = body(statusSources.ui, "StatusLine")
  assert.match(line, /const checked = compact \? null : lastAnsweredAt\(shipment\.tracking\)/)
  assert.ok(!line.includes("lastCheckedAt"), "StatusLine never shows the claim time")
})
