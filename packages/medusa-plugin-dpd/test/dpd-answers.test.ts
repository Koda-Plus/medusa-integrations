/**
 * What a DPDServices answer means: one case per sandbox fixture (spec 8.1,
 * 8.2, errata E17), plus the shapes the sandbox did not show (5xx, a body
 * that is no JSON, UNKNOWN_ERROR, NOT_PROCESSED, OK without a waybill, a
 * label that is no PDF, 404 without a body, 403, 415, 429). The body is read
 * before the HTTP status; a value DPD echoes back never reaches a message or
 * a problem. Stage 3: the DPD Pickup answers 10a to 10m (spec 8.1) get the
 * codes of the plan with source "dpd", the point id that was sent (E5) and
 * none of the receiver codes DPD adds after a point code.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  classifyLabelsAnswer,
  classifyNumbersAnswer,
  cleanDpdText,
  DPD_ERROR_CODES,
  DPD_PROBLEM_CODES,
  isPdfBase64,
  PICKUP_ANSWER_CODES,
  problemsOfBean,
  problemsOfGpn,
  transportFailure,
  type LabelsOutcome,
  type NumbersOutcome,
} from "../src/modules/dpd/lib/dpd-answers.ts"
import type { DpdHttpAnswer, GeneratePackagesNumbersRequest } from "../src/modules/dpd/lib/dpdservices.ts"
import { FakeDpdServices, loadFixture, TINY_PDF_BASE64 } from "./fake-dpdservices.ts"

/** The fixture's answer as the client hands it over: the "<pdf>" token becomes a real PDF in base64. */
function answerOf(name: string): DpdHttpAnswer {
  const f = loadFixture(name)
  const raw = JSON.stringify(f.response.body).replace(/"<pdf>"/g, JSON.stringify(TINY_PDF_BASE64))
  const body: unknown = f.response.body === "" ? null : JSON.parse(raw)
  const record = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null
  return {
    httpStatus: f.response.httpStatus,
    body,
    text: body === null ? String(f.response.body) : "",
    traceId: typeof record?.traceId === "string" ? record.traceId : null,
    ms: 0,
  }
}

/** The request of the fixture: payerFID is masked there, and 08g and 08h hold two packages, so it is cast. */
const sentOf = (name: string) => loadFixture(name).request.body as GeneratePackagesNumbersRequest

const numbers = (name: string): NumbersOutcome => classifyNumbersAnswer(answerOf(name), sentOf(name))
const labels = (name: string): LabelsOutcome => classifyLabelsAnswer(answerOf(name))

function synthetic(httpStatus: number, body: unknown, text = ""): DpdHttpAnswer {
  return { httpStatus, body, text, traceId: null, ms: 0 }
}

const ONE_BOX = { generationPolicy: "STOP_ON_FIRST_ERROR", packages: [{ reference: "ful_1", parcels: [{ reference: "ful_1-1", weight: 1 }] }] } as unknown as GeneratePackagesNumbersRequest

test("numbers OK (01, 08a, 08b, 08j, 08k, 06b, 06f): the waybill, the session id as a string (E3), the trace id", () => {
  const ok = numbers("01-numbers-ok")
  assert.equal(ok.kind, "ok")
  if (ok.kind !== "ok") return
  assert.deepEqual(ok.parcels, [{ reference: "probe-mvzj6089-R1-1", waybill: "0000899044445Q" }])
  assert.equal(ok.sessionId, "244462951")
  assert.equal(ok.traceId, "39fbc532-30ac-4539-912a-924baac18d83")
  assert.equal(ok.httpStatus, 200)
  for (const name of ["08a-invalid-postal-code", "08b-missing-receiver-phone", "08j-retry-same-ref-after-incorrect-data", "08k-retry-same-ref-after-bean-400", "06b-fid-header-wrong", "06f-fid-header-unknown-big"]) {
    const o = numbers(name)
    assert.equal(o.kind, "ok", name)
    if (o.kind === "ok") assert.ok(o.parcels.every((p) => /^\d{13}Q$/.test(p.waybill)), name)
  }
})

test("numbers with two packages (08g, IGNORE_ERRORS): OK, the classifier does not assume one package", () => {
  const o = numbers("08g-multi-errors-ignore-errors")
  assert.equal(o.kind, "ok")
  if (o.kind === "ok") assert.equal(o.parcels.length, 2)
})

test("COD with two boxes (07a): the waybills in box order, matched by the parcel reference", () => {
  const o = numbers("07a-cod-pln-2-parcels")
  assert.equal(o.kind, "ok")
  if (o.kind !== "ok") return
  assert.deepEqual(o.parcels.map((p) => p.waybill), ["0000899044737Q", "0000899044877Q"])
  /* The same answer for a request that lists the boxes the other way round: box order wins over DPD's order. */
  const sent = sentOf("07a-cod-pln-2-parcels") as unknown as { packages: Array<{ parcels: unknown[] }> }
  const reversed = { ...sent, packages: [{ ...sent.packages[0], parcels: [...sent.packages[0].parcels].reverse() }] } as unknown as GeneratePackagesNumbersRequest
  const swapped = classifyNumbersAnswer(answerOf("07a-cod-pln-2-parcels"), reversed)
  assert.equal(swapped.kind, "ok")
  if (swapped.kind === "ok") assert.deepEqual(swapped.parcels.map((p) => p.waybill), ["0000899044877Q", "0000899044737Q"])
})

test("duplicates (02a, 02b, 02c): the shipment exists, never a second one", () => {
  assert.deepEqual(numbers("02a-numbers-same-ref-identical"), { kind: "exists", status: "DUPLICATED_PARCEL_REFERENCE", traceId: answerOf("02a-numbers-same-ref-identical").traceId, httpStatus: 400 })
  const b = numbers("02b-numbers-same-ref-different-content")
  assert.equal(b.kind, "exists")
  if (b.kind === "exists") assert.equal(b.status, "DUPLICATED_PACKAGE_REFERENCE")
  const c = numbers("02c-numbers-new-ref-same-parcel-ref")
  assert.equal(c.kind, "exists")
  if (c.kind === "exists") assert.equal(c.status, "DUPLICATED_PARCEL_REFERENCE")
})

test("401 (06a, 06d, 06e): refused auth with dpd_auth, by the status alone (the body is empty)", () => {
  for (const name of ["06a-fid-header-missing", "06d-auth-wrong-password", "06e-fid-header-non-numeric"]) {
    const o = numbers(name)
    assert.equal(o.kind, "refused", name)
    if (o.kind !== "refused") continue
    assert.equal(o.code, "auth")
    assert.deepEqual(o.problems, [{ code: "dpd_auth" }])
    assert.equal(o.httpStatus, 401)
  }
  /* A 401 with any body is still auth; on the labels call too. */
  assert.equal(classifyNumbersAnswer(synthetic(401, { status: "OK" }), ONE_BOX).kind, "refused")
  const l = classifyLabelsAnswer(synthetic(401, null))
  assert.ok(l.kind === "refused" && l.code === "auth")
})

test("403 DISALLOWED_FID (06c): refused payer_fid with dpd_payer_fid", () => {
  const o = numbers("06c-payerfid-wrong")
  assert.equal(o.kind, "refused")
  if (o.kind !== "refused") return
  assert.equal(o.code, "payer_fid")
  assert.deepEqual(o.problems, [{ code: "dpd_payer_fid" }])
  assert.equal(o.traceId, "1561e7b4-9bcb-4c91-a476-d2094ba12a70")
  const no = classifyNumbersAnswer(synthetic(403, { status: "ERROR_NO_FID_PERMISSION", packages: [] }), ONE_BOX)
  assert.ok(no.kind === "refused" && no.code === "payer_fid")
})

test("INCORRECT_DATA (08e, 08f): refused, the errorCode as the field, the echoed value never kept (E9)", () => {
  const o = numbers("08e-postal-code-with-dash")
  assert.equal(o.kind, "refused")
  if (o.kind !== "refused") return
  assert.equal(o.code, "incorrect_data")
  assert.deepEqual(o.problems, [{ code: "dpd_validation", field: "INCORRECT_RECEIVER_POSTAL_CODE", detail: "Incorrect receiver postal code" }])
  assert.ok(!o.message.includes("30-001"), o.message)
  assert.ok(!JSON.stringify(o.problems).includes("30-001"))
  assert.match(o.message, /^DPD refused the shipment \(INCORRECT_DATA\): INCORRECT_RECEIVER_POSTAL_CODE: Incorrect receiver postal code\.$/)
  const f = numbers("08f-postal-code-bad-pattern")
  assert.ok(f.kind === "refused" && f.code === "incorrect_data")
  assert.ok(!JSON.stringify(f).includes("ABCDE"))
})

test("a refusal with waybills (08h, IGNORE_ERRORS, HTTP 400): unclear partial, never failed", () => {
  const o = numbers("08h-mixed-ignore-errors")
  assert.ok(o.kind === "unclear" && o.code === "partial")
})

test("Bean Validation (07b, 07c, 08c, 08d, 08i): refused validation, fields without the packages[0] prefix", () => {
  const cod = numbers("07b-cod-eur-domestic")
  assert.ok(cod.kind === "refused" && cod.code === "validation")
  if (cod.kind === "refused") assert.deepEqual(cod.problems, [{ code: "dpd_cod_currency", field: "services[0]", detail: "Domestic COD requires PLN currency" }])
  const comma = numbers("07c-cod-pln-comma-decimal")
  assert.ok(comma.kind === "refused" && comma.code === "validation")
  if (comma.kind === "refused") {
    assert.deepEqual(comma.problems, [
      { code: "dpd_validation", field: "package", detail: "Invalid package" },
      { code: "dpd_validation", field: "services[0]", detail: "COD needs AMOUNT attribute" },
    ])
  }
  const weight = numbers("08c-weight-zero")
  assert.ok(weight.kind === "refused" && weight.problems[0].field === "parcels[0].weight")
  const name = numbers("08d-name-too-long")
  assert.ok(name.kind === "refused" && name.problems[0].field === "receiver.name")
  const three = numbers("08i-multi-field-bean-errors")
  assert.equal(three.kind, "refused")
  if (three.kind !== "refused") return
  assert.deepEqual(three.problems.map((p) => p.field), ["receiver.city", "parcels[0].weight", "receiver.name"])
  assert.ok(three.problems.every((p) => p.code === "dpd_validation"))
  assert.match(three.message, /^DPD refused the shipment \(HTTP 400\): receiver\.city: size must be between 0 and 50; /)
})

test("labels OK (03a to 03f, 07d): the PDF, every waybill in DPD's order, documentId null", () => {
  for (const name of ["03a-labels-by-waybill-a4", "03b-labels-by-waybill-a4-again", "03c-labels-by-package-ref-a4", "03d-labels-by-parcel-ref-a4", "03e-labels-by-session-a4", "03f-labels-by-waybill-lbl-printer"]) {
    const o = labels(name)
    assert.equal(o.kind, "ok", name)
    if (o.kind !== "ok") continue
    assert.equal(o.pdfBase64, TINY_PDF_BASE64)
    assert.deepEqual(o.waybills, ["0000899044445Q"], name)
    assert.equal(o.documentId, null)
  }
  const cod = labels("07d-labels-cod-package")
  assert.ok(cod.kind === "ok")
  if (cod.kind === "ok") assert.deepEqual(cod.waybills, ["0000899044737Q", "0000899044877Q"])
})

test("labels NOT_FOUND (04a, 04b): not_found, on HTTP 404 and on HTTP 200", () => {
  assert.deepEqual(labels("04a-labels-unknown-package-ref"), { kind: "not_found", traceId: "e6133ada-42d5-458f-a170-1f2d9d8c1127", httpStatus: 404 })
  assert.equal(labels("04b-labels-unknown-waybill").kind, "not_found")
  assert.equal(classifyLabelsAnswer(synthetic(200, { status: "NOT_FOUND", session: { packages: [] } })).kind, "not_found")
})

test("synthetic numbers answers: 5xx, no JSON, unknown statuses, OK without a waybill, plain HTTP refusals", () => {
  const code = (a: DpdHttpAnswer) => {
    const o = classifyNumbersAnswer(a, ONE_BOX)
    return `${o.kind}:${"code" in o ? o.code : ""}`
  }
  assert.equal(code(synthetic(500, null, "<html>error</html>")), "unclear:server_error")
  assert.equal(code(synthetic(502, null)), "unclear:server_error")
  assert.equal(code(synthetic(200, null, "<html>maintenance</html>")), "unclear:bad_answer")
  assert.equal(code(synthetic(200, { traceId: "x" })), "unclear:bad_answer")
  assert.equal(code(synthetic(200, { status: "UNKNOWN_ERROR", packages: [] })), "unclear:dpd_unknown_error")
  assert.equal(code(synthetic(200, { status: "NOT_PROCESSED", packages: [] })), "unclear:not_processed")
  assert.equal(code(synthetic(200, { status: "SOMETHING_NEW", packages: [] })), "unclear:unknown_status")
  assert.equal(code(synthetic(200, { status: "OK", packages: [] })), "unclear:no_waybill")
  assert.equal(code(synthetic(200, { status: "OK", packages: [{ status: "OK", parcels: [{ reference: "ful_1-1", waybill: null }] }] })), "unclear:no_waybill")
  assert.equal(code(synthetic(200, { status: "OK", packages: [{ status: "OK", parcels: [{ reference: "a", waybill: "1" }, { reference: "b", waybill: "2" }] }] })), "unclear:no_waybill", "more waybills than boxes")
  assert.equal(code(synthetic(400, { status: "DISABLED_API", packages: [] })), "refused:disabled_api")
  assert.equal(code(synthetic(400, { status: "DUPLICATED_ALTERNATIVE_PARCEL_NUMBER", packages: [] })), "refused:alternative_number")
  assert.equal(code(synthetic(404, null)), "unclear:http_404")
  assert.equal(code(synthetic(403, null)), "refused:forbidden")
  assert.equal(code(synthetic(415, null)), "refused:unsupported")
  assert.equal(code(synthetic(429, null)), "refused:rate_limited")
  assert.equal(code(synthetic(422, null)), "refused:bad_request")
  assert.equal(code(synthetic(500, { errors: [{ userMessage: "must not be null", field: "packages[0].receiver" }] })), "unclear:server_error", "errors[] under a 5xx is no proven refusal")
  const disabled = classifyNumbersAnswer(synthetic(400, { status: "DISABLED_API", packages: [] }), ONE_BOX)
  assert.ok(disabled.kind === "refused" && disabled.problems.some((p) => p.code === "dpd_disabled_api"))
})

test("validationInfo codes: INCORRECT_PAYER_FID adds dpd_payer_fid, COD_CURRENCY_* becomes dpd_cod_currency", () => {
  const body = {
    status: "INCORRECT_DATA",
    packages: [
      {
        status: "INCORRECT_DATA",
        validationInfo: [
          { errorCode: "INCORRECT_PAYER_FID", info: "Incorrect payer fid: (1234)" },
          { errorCode: "COD_CURRENCY_NOT_ALLOWED", info: "COD currency (EUR) not allowed" },
        ],
        parcels: [{ status: "INCORRECT_DATA", waybill: null, validationInfo: [{ errorCode: "INCORRECT_WEIGHT", info: "Incorrect weight: (0)" }] }],
      },
    ],
  }
  assert.deepEqual(problemsOfGpn(body), [
    { code: "dpd_validation", field: "INCORRECT_PAYER_FID", detail: "Incorrect payer fid" },
    { code: "dpd_payer_fid" },
    { code: "dpd_cod_currency", field: "COD_CURRENCY_NOT_ALLOWED", detail: "COD currency not allowed" },
    { code: "dpd_validation", field: "INCORRECT_WEIGHT", detail: "Incorrect weight" },
  ])
  assert.deepEqual(problemsOfGpn(null), [])
  assert.deepEqual(problemsOfBean({ errors: "nope" }), [])
  assert.deepEqual(problemsOfBean({ errors: [{ userMessage: "Domestic COD requires PLN currency", field: "packages[0].services[0]" }] })[0].code, "dpd_cod_currency")
})

test("synthetic labels answers: a label that is no PDF, unknown statuses, Bean errors, plain HTTP", () => {
  const code = (a: DpdHttpAnswer) => {
    const o = classifyLabelsAnswer(a)
    return `${o.kind}:${"code" in o ? o.code : ""}`
  }
  assert.equal(code(synthetic(200, { status: "OK", documentData: Buffer.from("<html>no</html>").toString("base64"), session: {} })), "unclear:not_pdf")
  assert.equal(code(synthetic(200, { status: "OK", documentData: null })), "unclear:not_pdf")
  assert.equal(code(synthetic(200, { status: "DISABLED_API" })), "refused:disabled_api")
  assert.equal(code(synthetic(200, { status: "NOT_PROCESSED" })), "unclear:not_processed")
  assert.equal(code(synthetic(200, { status: "UNKNOWN_ERROR" })), "unclear:dpd_unknown_error")
  assert.equal(code(synthetic(200, { status: "WHATEVER" })), "unclear:unknown_status")
  assert.equal(code(synthetic(400, { errors: [{ userMessage: "must not be null", field: "format" }] })), "refused:validation")
  assert.equal(code(synthetic(403, null)), "refused:forbidden")
  assert.equal(code(synthetic(404, null, "<html>cloudflare</html>")), "unclear:http_404")
  assert.equal(code(synthetic(429, null)), "refused:rate_limited")
  assert.equal(code(synthetic(415, null)), "refused:unsupported")
  assert.equal(code(synthetic(400, null)), "refused:bad_request")
  assert.equal(code(synthetic(503, null)), "unclear:server_error")
  assert.equal(code(synthetic(500, { errors: [{ userMessage: "must not be null", field: "format" }] })), "unclear:server_error", "errors[] under a 5xx is no proven refusal")
  assert.equal(code(synthetic(200, null, "not json")), "unclear:bad_answer")
  const withId = classifyLabelsAnswer(synthetic(200, { status: "OK", documentData: TINY_PDF_BASE64, documentId: 203216918, session: { packages: [] } }))
  assert.ok(withId.kind === "ok" && withId.documentId === "203216918")
})

test("transport failures and helpers", () => {
  assert.deepEqual(transportFailure(true, "aborted", 20000).code, "timeout")
  assert.match(transportFailure(true, "aborted", 20000).message, /20000 ms/)
  const net = transportFailure(false, "socket hang up", 20000)
  assert.equal(net.code, "network")
  assert.equal(net.httpStatus, 0)
  assert.match(net.message, /socket hang up/)
  assert.equal(isPdfBase64(TINY_PDF_BASE64), true)
  assert.equal(isPdfBase64("JVBERi0xLjQK"), true)
  assert.equal(isPdfBase64(Buffer.from("hello world").toString("base64")), false)
  assert.equal(isPdfBase64("<pdf>"), false)
  assert.equal(isPdfBase64(42), false)
  assert.equal(cleanDpdText("Incorrect receiver postal code: (30-001)"), "Incorrect receiver postal code")
  assert.equal(cleanDpdText(null), "")
  for (const c of ["dpd_validation", "dpd_cod_currency", "dpd_auth", "dpd_payer_fid", "dpd_disabled_api"]) assert.ok((DPD_PROBLEM_CODES as readonly string[]).includes(c))
  assert.equal(new Set(DPD_ERROR_CODES).size, DPD_ERROR_CODES.length)
})

/** A GPN refusal of one package with these validationInfo codes, as the demo host shapes it (10c). */
function gpnRefusal(codes: Array<[string, string]>): DpdHttpAnswer {
  return synthetic(400, {
    status: "INCORRECT_DATA",
    sessionId: null,
    packages: [{ status: "INCORRECT_DATA", reference: "ful_1", validationInfo: codes.map(([errorCode, info]) => ({ errorCode, info })), parcels: [{ status: "OK", reference: "ful_1-1", waybill: null, validationInfo: [] }] }],
    traceId: "t",
  })
}

const PICKUP_SENT = sentOf("10a-pickup-pl14509")

test("Pickup OK (10a, 10e, 10l, 10m): the waybill and the session id; 20 kg and 19.99 kg pass, COD after DPD_PICKUP passes", () => {
  const expected: Record<string, string> = { "10a-pickup-pl14509": "0000899060290Q", "10e-pickup-cod": "0000899060315Q", "10l-pickup-20kg": "0000899060450Q", "10m-pickup-19_99kg": "0000899060531Q" }
  for (const [name, waybill] of Object.entries(expected)) {
    const o = numbers(name)
    assert.equal(o.kind, "ok", name)
    if (o.kind !== "ok") continue
    assert.deepEqual(o.parcels.map((p) => p.waybill), [waybill], name)
    assert.ok(o.sessionId !== null && /^\d+$/.test(o.sessionId), name)
  }
  const cod = sentOf("10e-pickup-cod").packages[0]
  assert.deepEqual(cod.services?.map((x) => x.code), ["DPD_PICKUP", "COD"])
  assert.equal(cod.receiver, undefined, "a Pickup package has no receiver")
})

test("Pickup Bean refusals (10b, 10g): multi_box_not_allowed and pickup_over_limit on services[0] with source dpd, DPD's text in the message (E10)", () => {
  const two = numbers("10b-pickup-two-parcels")
  assert.ok(two.kind === "refused" && two.code === "validation")
  if (two.kind !== "refused") return
  assert.deepEqual(two.problems, [{ code: "multi_box_not_allowed", field: "services[0]", detail: "Domestic DPD_PICKUP service is available only for single parcel shipments", source: "dpd" }])
  assert.match(two.message, /^DPD refused the shipment \(HTTP 400\): services\[0\]: Domestic DPD_PICKUP service is available only for single parcel shipments\.$/)
  const heavy = numbers("10g-pickup-locker-25kg")
  assert.ok(heavy.kind === "refused" && heavy.code === "validation")
  if (heavy.kind !== "refused") return
  assert.deepEqual(heavy.problems, [{ code: "pickup_over_limit", field: "services[0]", detail: "20 kg", source: "dpd" }])
  assert.ok(!heavy.message.includes("25"), heavy.message)
})

test("Pickup without contact (10f): exactly one problem, contact_missing; the name error next to it is dropped (P5), alone it stays dpd_validation", () => {
  const o = numbers("10f-pickup-no-contact")
  assert.ok(o.kind === "refused" && o.code === "validation")
  if (o.kind !== "refused") return
  assert.deepEqual(o.problems, [{ code: "contact_missing", field: "services[0]", detail: "Pudo receiver phone or email is needed with DPD_PICKUP service", source: "dpd" }])
  assert.ok(o.message.includes("phone or email is needed"), o.message)
  assert.ok(!o.message.includes("Name or company"), o.message)
  assert.deepEqual(problemsOfBean({ errors: [{ userMessage: "Name or company is required", field: "packages[0].pudoReceiver" }] }), [{ code: "dpd_validation", field: "pudoReceiver", detail: "Name or company is required" }])
  /* By the text, whatever its case. */
  assert.equal(problemsOfBean({ errors: [{ userMessage: "DOMESTIC DPD_PICKUP SERVICE IS AVAILABLE ONLY FOR SINGLE PARCEL SHIPMENTS", field: "packages[0].services[0]" }] })[0].code, "multi_box_not_allowed")
  assert.deepEqual(problemsOfBean({ errors: [{ userMessage: "the dpd_pickup service is unavailable for parcels from 31 kg", field: "packages[0].services[0]" }] })[0], { code: "pickup_over_limit", field: "services[0]", detail: "31 kg", source: "dpd" })
})

test("Pickup point refusals (10c, 10d, 10h, 10i): pudo_not_found with the id that was sent (E5), none of the three receiver codes", () => {
  const sent: Record<string, string> = { "10c-pickup-unknown-id": "PL99999", "10d-pickup-numeric-id": "1111", "10h-pickup-pl11726": "PL11726", "10i-pickup-de-id": "DE12345" }
  for (const [name, id] of Object.entries(sent)) {
    const o = numbers(name)
    assert.ok(o.kind === "refused" && o.code === "incorrect_data", name)
    if (o.kind !== "refused") continue
    assert.deepEqual(o.problems, [{ code: "pudo_not_found", field: "INCORRECT_PUDO", detail: id, source: "dpd" }], name)
    assert.ok(!o.problems.some((p) => String(p.field).startsWith("INCORRECT_RECEIVER_")), name)
    assert.equal(o.message, `DPD refused the shipment (INCORRECT_DATA): INCORRECT_PUDO: ${id}.`, name)
    assert.ok(!o.message.includes("Incorrect pudo identifier") && !o.message.includes("odbiorcy"), name)
  }
  /* problemsOfGpn alone keeps DPD's text (cleaned); only the classifier knows what was sent. */
  assert.deepEqual(problemsOfGpn(answerOf("10c-pickup-unknown-id").body), [{ code: "pudo_not_found", field: "INCORRECT_PUDO", detail: "Incorrect pudo identifier", source: "dpd" }])
})

test("the point codes of the DPDServices enum with no fixture: INACTIVE_PUDO, DPD_PICKUP_IS_NOT_AVAILABLE_FOR_PUDO, SERVICES_NOT_SUPPORTED_BY_PUDO", () => {
  const cases: Array<[string, string]> = [
    ["INACTIVE_PUDO", "pudo_inactive"],
    ["DPD_PICKUP_IS_NOT_AVAILABLE_FOR_PUDO", "pudo_no_delivery"],
    ["SERVICES_NOT_SUPPORTED_BY_PUDO", "pudo_no_cod"],
  ]
  for (const [errorCode, code] of cases) {
    const o = classifyNumbersAnswer(gpnRefusal([["INCORRECT_RECEIVER_CITY", "Miasto odbiorcy jest wymagane"], [errorCode, "Some text"]]), PICKUP_SENT)
    assert.ok(o.kind === "refused" && o.code === "incorrect_data", errorCode)
    if (o.kind === "refused") assert.deepEqual(o.problems, [{ code, field: errorCode, detail: "PL14509", source: "dpd" }], errorCode)
  }
  /* DPD_FOOD_AND_DPD_PICKUP_IS_NOT_AVAILABLE_FOR_POSTAL_CODE is no point code: dpd_validation as before. */
  const food = classifyNumbersAnswer(gpnRefusal([["DPD_FOOD_AND_DPD_PICKUP_IS_NOT_AVAILABLE_FOR_POSTAL_CODE", "Not available"]]), PICKUP_SENT)
  assert.ok(food.kind === "refused")
  if (food.kind === "refused") assert.deepEqual(food.problems, [{ code: "dpd_validation", field: "DPD_FOOD_AND_DPD_PICKUP_IS_NOT_AVAILABLE_FOR_POSTAL_CODE", detail: "Not available" }])
  assert.deepEqual([...PICKUP_ANSWER_CODES].sort(), ["contact_missing", "multi_box_not_allowed", "pickup_over_limit", "pudo_inactive", "pudo_no_cod", "pudo_no_delivery", "pudo_not_found"])
})

test("courier regression (stage 2): INCORRECT_RECEIVER_CITY without a point code stays dpd_validation, no source, DPD's detail kept", () => {
  const o = classifyNumbersAnswer(gpnRefusal([["INCORRECT_RECEIVER_CITY", "Miasto odbiorcy jest wymagane"]]), ONE_BOX)
  assert.ok(o.kind === "refused" && o.code === "incorrect_data")
  if (o.kind !== "refused") return
  assert.deepEqual(o.problems, [{ code: "dpd_validation", field: "INCORRECT_RECEIVER_CITY", detail: "Miasto odbiorcy jest wymagane" }])
  /* A point code on a courier request (nothing sent with PUDO): DPD's text, not an id. */
  const odd = classifyNumbersAnswer(gpnRefusal([["INCORRECT_PUDO", "Incorrect pudo identifier"]]), ONE_BOX)
  assert.ok(odd.kind === "refused" && odd.problems[0].detail === "Incorrect pudo identifier")
})

test("Pickup labels (10j, 10k): the PDF and the waybill of the Pickup shipment", () => {
  for (const [name, waybill] of [["10j-labels-pickup-a4", "0000899060290Q"], ["10k-labels-pickup-cod-a4", "0000899060315Q"]] as const) {
    const o = labels(name)
    assert.equal(o.kind, "ok", name)
    if (o.kind === "ok") assert.deepEqual(o.waybills, [waybill], name)
  }
})

test("the fake DPDServices refuses Pickup like the demo host did (14.3): each request of 10a to 10m gives the problems of its fixture", async () => {
  const fake = new FakeDpdServices()
  const auth = `Basic ${Buffer.from(`${fake.login}:${fake.password}`).toString("base64")}`
  const names = ["10a-pickup-pl14509", "10b-pickup-two-parcels", "10c-pickup-unknown-id", "10d-pickup-numeric-id", "10e-pickup-cod", "10f-pickup-no-contact", "10g-pickup-locker-25kg", "10h-pickup-pl11726", "10i-pickup-de-id", "10l-pickup-20kg", "10m-pickup-19_99kg"]
  for (const name of names) {
    const f = loadFixture(name)
    const body = JSON.parse(JSON.stringify(f.request.body).replace(/"payerFID":"\*\*\*"/g, '"payerFID":1000')) as GeneratePackagesNumbersRequest
    const res = await fake.fetch(`${fake.host}${f.request.path}`, { method: "POST", headers: { authorization: auth, "x-dpd-fid": "1000", "content-type": "application/json" }, body: JSON.stringify(body) })
    const got = classifyNumbersAnswer(synthetic(res.status, await res.json()), body)
    const want = numbers(name)
    assert.equal(res.status, f.response.httpStatus, name)
    assert.equal(got.kind, want.kind, name)
    if (got.kind === "refused" && want.kind === "refused") assert.deepEqual(got.problems, want.problems, name)
  }
  assert.equal(fake.count("numbers"), names.length)
})
