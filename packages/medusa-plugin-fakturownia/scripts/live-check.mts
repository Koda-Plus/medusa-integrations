/**
 * THE CHECK ON A REAL FAKTUROWNIA ACCOUNT (a test or trial account only).
 * Not part of the package (outside `files`), not run by `npm test`.
 *
 *   FAKTUROWNIA_API_TOKEN=... FAKTUROWNIA_ACCOUNT=mojafirma \
 *     node --experimental-strip-types --no-warnings --import ./test/ts-resolve.mjs scripts/live-check.mts --yes
 *
 * It builds documents with the plugin's own code (the same payloads a store
 * sends) and sends them with the plugin's own client: a VAT invoice found
 * again by its order number, the refusal of a second one for the same order
 * (`oid_unique`), a proforma and the final invoice made from it, a receipt,
 * a correction, an invoice in EUR, the PDF, and a send to KSeF on an account
 * without KSeF (a clear refusal is the expected answer). It never deletes
 * anything and never sends an e-mail. Every document carries a test order
 * number (`LIVECHECK-<time>`), so they are easy to find and remove by hand.
 *
 * The result: one line per check on the console and `live-check.json` here.
 * NEVER run it on a company account with real numbering or KSeF switched on.
 */
import { writeFileSync } from "node:fs"
import { FakturowniaClient } from "../src/modules/fakturownia/lib/client.ts"
import { buildFinalFromProforma } from "../src/modules/fakturownia/lib/conversion.ts"
import { buildDocument } from "../src/modules/fakturownia/lib/document.ts"
import { resolveOptions } from "../src/modules/fakturownia/lib/options.ts"
import { order, unpaid } from "../test/helpers.ts"

const token = process.env.FAKTUROWNIA_API_TOKEN ?? ""
const account = process.env.FAKTUROWNIA_ACCOUNT ?? ""
if (!process.argv.includes("--yes") || !token || !account) {
  console.error("Set FAKTUROWNIA_API_TOKEN and FAKTUROWNIA_ACCOUNT of a TEST account and pass --yes. Nothing was sent.")
  process.exit(1)
}

const o = resolveOptions({ apiToken: token, account, requestsPerMinute: 60, oidPrefix: "LIVECHECK-" } as never)
const client = new FakturowniaClient({ token, account, requestsPerMinute: 60, timeoutMs: 30_000, limiter: null })
const stamp = Date.now() % 1_000_000_000
const today = new Date().toISOString().slice(0, 10)
const results: Array<{ check: string; ok: boolean; detail: string }> = []

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn()
    results.push({ check: name, ok: true, detail })
    console.log(`ok    ${name}: ${detail}`)
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    results.push({ check: name, ok: false, detail })
    console.log(`FAIL  ${name}: ${detail}`)
  }
}

const id = (r: Record<string, unknown> | null | undefined) => String(r?.id ?? "")
let vat: Record<string, unknown> | null = null
let proforma: Record<string, unknown> | null = null

await check("account answers (departments)", async () => `${(await client.listDepartments()).length} department(s)`)

await check("VAT invoice from an order, with oid_unique", async () => {
  const built = buildDocument(order({ display_id: stamp }) as never, o, { kind: "vat", today, oidUnique: true })
  vat = await client.createInvoice(built.invoice as never)
  return `id ${id(vat)}, number ${String(vat.number ?? "?")}, gross ${String(vat.price_gross ?? "?")}`
})

await check("found again by its order number (?oid=)", async () => {
  const found = await client.findInvoices({ oid: `LIVECHECK-${stamp}` })
  if (!found.some((x) => id(x) === id(vat))) throw new Error(`not found among ${found.length}`)
  return `${found.length} document(s) for LIVECHECK-${stamp}`
})

await check("a second VAT invoice for the same order is refused (oid_unique)", async () => {
  const built = buildDocument(order({ display_id: stamp }) as never, o, { kind: "vat", today, oidUnique: true })
  try {
    const again = await client.createInvoice(built.invoice as never)
    throw new Error(`accepted: id ${id(again)} (the account does not enforce oid_unique)`)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("accepted")) throw err
    return `refused: ${(err as Error).message.slice(0, 160)}`
  }
})

await check("proforma for an unpaid order", async () => {
  const built = buildDocument(unpaid({ display_id: stamp + 1 }) as never, o, { kind: "proforma", today, oidUnique: true })
  proforma = await client.createInvoice(built.invoice as never)
  return `id ${id(proforma)}, number ${String(proforma.number ?? "?")}`
})

await check("final invoice from the proforma (from_invoice_id)", async () => {
  if (!proforma) throw new Error("no proforma")
  const full = await client.getInvoice(id(proforma))
  const built = buildFinalFromProforma(full as never, {
    kind: "vat",
    receiptKind: o.receiptKind,
    today,
    capturedInFull: true,
    paymentTermDays: o.paymentTermDays,
    fallback: { issuePlace: o.issuePlace, lang: o.lang },
  })
  const final = await client.createInvoice(built.invoice as never)
  const children = await client.findInvoices({ fromInvoiceId: id(proforma) })
  return `id ${id(final)}, number ${String(final.number ?? "?")}, ${children.length} document(s) from the proforma`
})

await check("receipt (paragon) for a consumer", async () => {
  const built = buildDocument(order({ display_id: stamp + 2 }) as never, o, { kind: "receipt", today, oidUnique: false })
  const receipt = await client.createInvoice(built.invoice as never)
  return `id ${id(receipt)}, kind ${String(receipt.kind ?? "?")}, number ${String(receipt.number ?? "?")}`
})

await check("invoice in EUR", async () => {
  const built = buildDocument(order({ display_id: stamp + 3, currency_code: "eur" }) as never, o, { kind: "vat", today, oidUnique: true })
  const eur = await client.createInvoice(built.invoice as never)
  return `id ${id(eur)}, currency ${String(eur.currency ?? "?")}, exchange ${String(eur.exchange_rate ?? eur.exchange_currency ?? "?")}`
})

await check("PDF of the VAT invoice through the API", async () => {
  if (!vat) throw new Error("no invoice")
  const pdf = await client.downloadPdf(id(vat))
  const head = Buffer.from(pdf.bytes.slice(0, 5)).toString("latin1")
  if (head !== "%PDF-") throw new Error(`not a PDF (${pdf.contentType})`)
  return `${pdf.bytes.length} bytes, ${pdf.contentType}`
})

await check("send to KSeF on an account without KSeF: a clear refusal", async () => {
  if (!vat) throw new Error("no invoice")
  try {
    const answer = await client.sendToKsef(id(vat))
    return `answered: ${JSON.stringify(answer).slice(0, 200)}`
  } catch (err) {
    return `refused as expected: ${(err as Error).message.slice(0, 200)}`
  }
})

writeFileSync("live-check.json", JSON.stringify({ account, stamp, today, results }, null, 2))
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed} of ${results.length} checks passed. Test documents carry the order numbers LIVECHECK-${stamp} to LIVECHECK-${stamp + 3}.`)
process.exit(failed ? 1 : 0)
