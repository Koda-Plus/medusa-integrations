import { test } from "node:test"
import assert from "node:assert/strict"
import { FakturowniaClient, accountBaseUrl, assertDocumentId } from "../src/modules/fakturownia/lib/client.ts"
import {
  FakturowniaApiError,
  FakturowniaUnknownResultError,
  describeError,
  interpretResponse,
  networkError,
} from "../src/modules/fakturownia/lib/errors.ts"
import { maskSecrets } from "../src/modules/fakturownia/lib/security.ts"

const TOKEN = "fkTEST0123456789abcdefGHIJ/mojafirma"
const mask = (t: string) => maskSecrets(t, [TOKEN])

interface Seen {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
  redirect: string | undefined
}

/** A scripted Fakturownia: one answer (or thrown error) per call, in order; the last one repeats. */
function fake(script: Array<(call: Seen) => Response | Error>) {
  const calls: Seen[] = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const call: Seen = {
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      redirect: init?.redirect,
    }
    calls.push(call)
    const result = script[Math.min(calls.length - 1, script.length - 1)](call)
    if (result instanceof Error) throw result
    return result
  }) as typeof fetch
  return { calls, fetchImpl }
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const timeout = () => () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })

function client(fetchImpl: typeof fetch) {
  const sleeps: number[] = []
  const warnings: string[] = []
  const c = new FakturowniaClient({
    token: TOKEN,
    account: "mojafirma",
    requestsPerMinute: 600,
    timeoutMs: 1000,
    fetch: fetchImpl,
    sleep: async (ms) => void sleeps.push(ms),
    limiter: null,
    logger: { warn: (m: string) => void warnings.push(m) },
  })
  return { c, sleeps, warnings }
}

test("call shape: the account host, the token in a Bearer header only, never in the URL or the body, redirects not followed", async () => {
  const { calls, fetchImpl } = fake([json({ id: 1, number: "FV 1/10/2026" })])
  const { c } = client(fetchImpl)
  await c.getInvoice("123", ["id", "number"])
  await c.createInvoice({ kind: "vat", positions: [] })
  assert.equal(calls[0].url, "https://mojafirma.fakturownia.pl/invoices/123.json?fields%5Binvoice%5D=id%2Cnumber")
  assert.equal(calls[1].url, "https://mojafirma.fakturownia.pl/invoices.json")
  for (const call of calls) {
    assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`)
    assert.ok(!call.url.includes("api_token") && !call.url.includes(TOKEN))
    assert.equal(call.redirect, "manual")
  }
  assert.deepEqual(calls[1].body, { invoice: { kind: "vat", positions: [] } })
  assert.ok(!JSON.stringify(calls[1].body).includes(TOKEN))
})

test("the documented endpoints: list filters, mark paid, change status, e-mail", async () => {
  const { calls, fetchImpl } = fake([json([]), json({ id: 5 }), json({}), json({ status: "ok" })])
  const { c } = client(fetchImpl)
  await c.findInvoices({ oid: "1042", kind: "vat", dateFrom: "2026-09-28", dateTo: "2026-10-06" })
  await c.markPaid(5, "143.00")
  await c.changeStatus(5, "rejected")
  await c.sendByEmail(5)
  const list = new URL(calls[0].url)
  assert.equal(list.pathname, "/invoices.json")
  assert.deepEqual(Object.fromEntries(list.searchParams), {
    oid: "1042",
    kind: "vat",
    period: "more",
    date_from: "2026-09-28",
    date_to: "2026-10-06",
    per_page: "100",
    page: "1",
  })
  assert.deepEqual([calls[1].method, new URL(calls[1].url).pathname, calls[1].body], ["PUT", "/invoices/5.json", { invoice: { paid: "143.00" } }])
  assert.equal(calls[2].url, "https://mojafirma.fakturownia.pl/invoices/5/change_status.json?status=rejected")
  assert.equal(calls[2].method, "POST")
  assert.equal(calls[3].url, "https://mojafirma.fakturownia.pl/invoices/5/send_by_email.json")
})

test("errors: a 422 with field errors reads well; a refusal in an HTTP 200 body is an error too", () => {
  assert.throws(
    () => interpretResponse({ operation: "create", httpStatus: 422, text: JSON.stringify({ code: "error", message: { buyer_tax_no: ["- nie może być puste"] } }), mask }),
    (e: unknown) => e instanceof FakturowniaApiError && e.code === "HTTP_422" && e.refused && !e.transient && e.message.includes("buyer_tax_no: nie może być puste"),
  )
  assert.throws(
    () => interpretResponse({ operation: "send_by_email", httpStatus: 200, text: JSON.stringify({ message: "Faktura nie może zostać wysłana - brak numeru KSeF", status: "error" }), mask }),
    (e: unknown) => e instanceof FakturowniaApiError && e.code === "API_ERROR" && e.refused && e.message.includes("brak numeru KSeF"),
  )
  assert.deepEqual(interpretResponse({ operation: "get", httpStatus: 200, text: '{"id":1}', mask }), { id: 1 })
})

test("errors: an HTML 502, broken JSON and a redirect, with the token masked", () => {
  assert.throws(
    () => interpretResponse({ operation: "get", httpStatus: 502, text: `<html>Bad gateway ${TOKEN}</html>`, mask }),
    (e: unknown) => e instanceof FakturowniaApiError && e.code === "HTTP_502" && e.transient && !e.refused && !e.message.includes(TOKEN),
  )
  assert.throws(
    () => interpretResponse({ operation: "get", httpStatus: 200, text: "<html>maintenance</html>", mask }),
    (e: unknown) => e instanceof FakturowniaApiError && e.code === "ERROR_JSON" && e.transient,
  )
  assert.throws(
    () => interpretResponse({ operation: "get", httpStatus: 302, text: "", mask }),
    (e: unknown) => e instanceof FakturowniaApiError && e.code === "HTTP_302" && !e.transient,
  )
  assert.throws(() => interpretResponse({ operation: "get", httpStatus: 429, text: "{}", mask }), (e: unknown) => e instanceof FakturowniaApiError && e.transient && e.refused)
})

test("network errors: a name that does not resolve was never sent; a timeout may have been", () => {
  const dns = networkError("create", Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }), mask)
  assert.equal(dns.code, "ERROR_NETWORK")
  assert.equal(dns.refused, true)
  const late = networkError("create", Object.assign(new Error("aborted"), { name: "TimeoutError" }), mask)
  assert.equal(late.code, "ERROR_TIMEOUT")
  assert.equal(late.refused, false)
  const reset = networkError("create", Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }), mask)
  assert.equal(reset.refused, false)
})

test("reads retry transient failures with growing pauses; refusals are thrown at once", async () => {
  const { calls, fetchImpl } = fake([() => new Response("<html>502</html>", { status: 502 }), timeout(), json([{ id: 101, name: "Moja Firma" }])])
  const { c, sleeps, warnings } = client(fetchImpl)
  assert.deepEqual(await c.listDepartments(), [{ id: 101, name: "Moja Firma" }])
  assert.equal(calls.length, 3)
  assert.deepEqual(sleeps, [1000, 4000])
  assert.equal(warnings.length, 2)

  const refused = fake([json({ code: "error", message: "nieprawidłowy token" }, 401)])
  await assert.rejects(client(refused.fetchImpl).c.listDepartments(), (e: unknown) => e instanceof FakturowniaApiError && e.code === "HTTP_401")
  assert.equal(refused.calls.length, 1)
})

test("create: ONE shot. A timeout, a 5xx or broken JSON is an unknown result, never repeated", async () => {
  for (const answer of [timeout(), () => new Response("<html>502</html>", { status: 502 }), () => new Response("not json", { status: 201 })]) {
    const { calls, fetchImpl } = fake([answer])
    await assert.rejects(client(fetchImpl).c.createInvoice({ kind: "vat" }), FakturowniaUnknownResultError)
    assert.equal(calls.length, 1)
  }
  const noId = fake([json({ status: "ok" }, 201)])
  await assert.rejects(client(noId.fetchImpl).c.createInvoice({ kind: "vat" }), FakturowniaUnknownResultError, "a success without an id may still have created it")
  assert.equal(describeError(new FakturowniaUnknownResultError("create", "x")).code, "unknown_result")
})

test("create: a refusal is not unknown (nothing was created), and is not repeated either", async () => {
  for (const [answer, code] of [
    [json({ code: "error", message: { buyer_tax_no: ["- nieprawidłowy"] } }, 422), "HTTP_422"],
    [json({ code: "error", message: "slow down" }, 429), "HTTP_429"],
    [() => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }), "ERROR_NETWORK"],
  ] as const) {
    const { calls, fetchImpl } = fake([answer])
    await assert.rejects(client(fetchImpl).c.createInvoice({ kind: "vat" }), (e: unknown) => e instanceof FakturowniaApiError && e.code === code && e.refused)
    assert.equal(calls.length, 1)
  }
})

test("the token never reaches an error message or a log line, even when Fakturownia echoes it", async () => {
  const echo = fake([json({ code: "error", message: `Invalid token ${TOKEN}, see ?api_token=${TOKEN}` }, 401)])
  await assert.rejects(client(echo.fetchImpl).c.getInvoice(1), (e: unknown) => e instanceof Error && !e.message.includes(TOKEN) && !e.message.includes("fkTEST0123456789"))
  const flaky = fake([() => new Response(`<html>${TOKEN}</html>`, { status: 503 }), json({ id: 1 })])
  const { c, warnings } = client(flaky.fetchImpl)
  await c.getInvoice(1)
  assert.equal(warnings.length, 1)
  assert.ok(!warnings[0].includes(TOKEN) && !warnings[0].includes("fkTEST0123456789"))
  const thrown = fake([() => Object.assign(new TypeError(`fetch failed for ${TOKEN}`), { cause: { code: "ECONNREFUSED" } })])
  await assert.rejects(client(thrown.fetchImpl).c.createInvoice({}), (e: unknown) => e instanceof Error && !e.message.includes("fkTEST0123456789"))
})

test("lookup pages until a short page, and its ceiling is an error, never a silent 'not found'", async () => {
  const page = (n: number, size: number) => json(Array.from({ length: size }, (_, i) => ({ id: n * 1000 + i, oid: "x" })))
  const two = fake([page(1, 100), page(2, 7)])
  assert.equal((await client(two.fetchImpl).c.findInvoices({ oid: "1042" })).length, 107)
  assert.equal(new URL(two.calls[1].url).searchParams.get("page"), "2")
  assert.equal(new URL(two.calls[0].url).searchParams.get("period"), "all", "without a window the whole history is searched")
  const endless = fake([page(1, 100)])
  await assert.rejects(client(endless.fetchImpl).c.findInvoices({ oid: "1042" }, 3), (e: unknown) => e instanceof FakturowniaApiError && e.code === "LOOKUP_CEILING" && !e.transient)
  assert.equal(endless.calls.length, 3)
})

test("PDF: bytes checked to be a PDF; an HTML page or a 422 means not ready yet", async () => {
  const ok = fake([() => new Response(new TextEncoder().encode("%PDF-1.4 body"), { status: 200 })])
  const file = await client(ok.fetchImpl).c.downloadPdf(5)
  assert.equal(file.contentType, "application/pdf")
  assert.equal(new TextDecoder().decode(file.bytes.slice(0, 4)), "%PDF")
  assert.equal(ok.calls[0].headers.Accept, "application/pdf")
  for (const answer of [() => new Response("<html>KSeF</html>", { status: 200 }), json({ code: "error" }, 422)]) {
    const notReady = fake([answer])
    await assert.rejects(client(notReady.fetchImpl).c.downloadPdf(5), (e: unknown) => e instanceof FakturowniaApiError && e.code === "PDF_NOT_READY")
    assert.equal(notReady.calls.length, 3, "a fresh document gets a few seconds")
  }
})

test("nothing but a valid subdomain and a numeric id ever becomes part of a URL", async () => {
  assert.equal(accountBaseUrl("mojafirma"), "https://mojafirma.fakturownia.pl")
  assert.throws(() => accountBaseUrl("evil.com#"), (e: unknown) => e instanceof FakturowniaApiError && e.code === "BAD_ACCOUNT")
  assert.equal(assertDocumentId(" 123 "), "123")
  for (const bad of ["../departments", "1?x=1", "", "abc"]) assert.throws(() => assertDocumentId(bad), (e: unknown) => e instanceof FakturowniaApiError && e.code === "BAD_ID")
  const none = fake([json({})])
  const noToken = new FakturowniaClient({ token: " ", account: "mojafirma", requestsPerMinute: 60, timeoutMs: 1000, fetch: none.fetchImpl, limiter: null })
  await assert.rejects(noToken.getInvoice(1), (e: unknown) => e instanceof FakturowniaApiError && e.code === "NO_TOKEN")
  assert.equal(none.calls.length, 0)
})
