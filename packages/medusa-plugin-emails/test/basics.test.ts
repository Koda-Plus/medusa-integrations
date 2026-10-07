/**
 * The small pieces: escaping and safe links, masking, keys, languages and
 * formats, typography, colours, the text part and the rate limiter.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { cleanText, companyName, cssFontFamily, esc, looksLikeLink, personName, safeHttpsUrl, safeUrl } from "../src/modules/emails/lib/html.ts"
import { addressHash, cleanKey, customerIdOf, entityRef, eventKey, resendKey, resetKey, retryNotificationKey, testKey } from "../src/modules/emails/lib/keys.ts"
import { KIT_META } from "../src/modules/emails/lib/kit-meta.ts"
import { USER_AGENT } from "../src/modules/emails/lib/resend.ts"
import { currencyCode, formatDate, formatMoney, formatShortDate, formatTag, monthYear, normalizeLocale, pickLocale, plural, toNumber, validTimeZone } from "../src/modules/emails/lib/locale.ts"
import { createRateLimiter } from "../src/modules/emails/lib/rate-limit.ts"
import { addressList, HIDDEN_LINK, isEmail, maskAll, maskEmail, maskEmailsIn, maskSecrets, parseSender, redactData, scrubSecrets } from "../src/modules/emails/lib/security.ts"
import { htmlToText } from "../src/modules/emails/lib/text.ts"
import { contrast, makePalette, normalizeHex } from "../src/modules/emails/lib/theme.ts"
import { nb, typesetHtml } from "../src/modules/emails/lib/typeset.ts"

test("esc escapes the five characters and nothing else", () => {
  assert.equal(esc(`<a href="x">Tom & 'Jerry'</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;")
  assert.equal(esc(null), "")
  assert.equal(esc(42), "42")
  assert.equal(esc("Zażółć gęślą jaźń"), "Zażółć gęślą jaźń")
})

test("safe links: absolute http(s) only, mailto on request, no quotes or spaces", () => {
  assert.equal(safeUrl("https://shop.example.com/a?b=1"), "https://shop.example.com/a?b=1")
  assert.equal(safeUrl(" http://x.example.com "), "http://x.example.com")
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "/relative", "//proto.example.com", "https://x.example.com/\"onmouseover", "https://x.example.com/a b", "vbscript:x", "", null, 5]) {
    assert.equal(safeUrl(bad), null, String(bad))
  }
  assert.equal(safeUrl("mailto:help@example.com"), null)
  assert.equal(safeUrl("mailto:help@example.com", { mailto: true }), "mailto:help@example.com")
  assert.equal(safeUrl("mailto:a@b.c?subject=x", { mailto: true }), null)
  assert.equal(safeHttpsUrl("http://x.example.com/f.woff2"), null)
  assert.equal(cssFontFamily("'Cabinet Grotesk', Arial, sans-serif", "x"), "'Cabinet Grotesk', Arial, sans-serif")
  assert.equal(cssFontFamily('Arial;}</style><script>', "fallback"), "fallback")
  assert.equal(cssFontFamily('"Inter"', "fallback"), "fallback", "double quotes would break the style attribute")
  assert.equal(cleanText("a\n\tb   c", 10), "a b c")
  assert.equal(cleanText("x".repeat(20), 5), "xxxx…")
})

test("addresses: validated, masked in single values and in texts", () => {
  assert.equal(isEmail("anna.nowak@example.com"), true)
  assert.equal(isEmail("anna@localhost"), false)
  assert.equal(maskEmail("anna.nowak@example.com"), "a***@e***.com")
  assert.equal(maskEmail("x@mail.firma.example"), "x***@m***.example")
  assert.equal(maskEmail("nope"), "***")
  assert.equal(maskEmailsIn("to anna@example.com and b@c.example"), "to a***@e***.com and b***@c***.example")
  assert.deepEqual(addressList("a@x.example, Bob <b@x.example>; junk"), ["a@x.example", "Bob <b@x.example>"])
  assert.equal(parseSender("Shop <shop@example.com>")?.address, "shop@example.com")
  assert.equal(parseSender("Evil\r\nBcc: x@y.z <shop@example.com>")?.value.includes("\n"), false, "no header injection through the name")
  assert.equal(parseSender("<b>@example.com"), null)
})

test("secrets: the configured key, any Resend-shaped key, Bearer values and long tokens are masked", () => {
  const key = "re_ABCdef1234567890"
  assert.equal(maskSecrets(`key ${key}!`, [key]), "key ***!")
  assert.equal(maskSecrets("re_SomethingElse_99 here"), "re_*** here")
  assert.equal(maskSecrets("Authorization: Bearer abc.def"), "Authorization: Bearer ***")
  assert.equal(maskSecrets(`x ${"A".repeat(45)} y`), "x *** y")
  assert.equal(maskAll(`anna@example.com ${key}`, [key]), "a***@e***.com ***")
})

test("keys: per event, the token only as a hash, rotated for a retry, never too long", () => {
  assert.equal(eventKey("order.placed", "order_01J"), "emails:order.placed:order_01J")
  const reset = resetKey("secret-token-value")
  assert.match(reset, /^emails:password\.reset:[0-9a-f]{32}$/)
  assert.ok(!reset.includes("secret"))
  assert.equal(resetKey("secret-token-value"), reset, "the same token gives the same key")
  assert.equal(resendKey("emails:x:1", 0), "emails:x:1")
  assert.equal(resendKey("emails:x:1", 2), "emails:x:1#r2")
  assert.notEqual(testKey(), testKey())
  const long = cleanKey("k".repeat(500)) as string
  assert.ok(long.length <= 200)
  assert.notEqual(cleanKey(`${"k".repeat(300)}a`), cleanKey(`${"k".repeat(300)}b`), "long keys keep a hash of the whole")
  assert.equal(cleanKey("a bé"), "a_b_")
  assert.equal(cleanKey("  "), null)
  assert.ok(retryNotificationKey("emails:x:1", 1).startsWith("emails:x:1:retry:1:"))
  assert.equal(entityRef("k"), entityRef("k"))
})

test("languages: the primary subtag decides, the first known candidate wins", () => {
  assert.equal(normalizeLocale("pl-PL"), "pl")
  assert.equal(normalizeLocale("PL"), "pl")
  assert.equal(normalizeLocale("en_US"), "en")
  assert.equal(normalizeLocale("polish"), "pl")
  assert.equal(normalizeLocale("de-DE"), null)
  assert.equal(pickLocale([null, "de", "pl-PL", "en"], "en"), "pl")
  assert.equal(pickLocale([undefined, 5], "pl"), "pl")
  assert.equal(formatTag("en", "en-US"), "en-US")
  assert.equal(formatTag("en", "pl-PL"), "en-GB")
  assert.equal(formatTag("pl"), "pl-PL")
})

test("formats: money with the currency, dates in the store's time zone, Polish plurals", () => {
  assert.equal(formatMoney(1234.5, "pln", "pl-PL").replace(/ /g, " "), "1234,50 zł")
  assert.equal(formatMoney(12345.5, "pln", "pl-PL").replace(/ /g, " "), "12 345,50 zł")
  assert.equal(formatMoney(39, "EUR", "en-GB"), "€39.00")
  assert.equal(formatMoney("12,00 zł", "pln", "pl-PL"), "12,00 zł", "a ready string stays")
  assert.equal(formatMoney({ numeric: 5 }, "usd", "en-GB"), "US$5.00")
  assert.equal(formatMoney(5, null, "en-GB"), "5.00")
  assert.equal(formatMoney(null, "pln", "pl-PL"), "")
  assert.equal(toNumber({ value: "12.5" }), 12.5)
  assert.equal(currencyCode("pln"), "PLN")
  const d = "2026-10-06T22:30:00Z"
  assert.equal(formatDate(d, "pl-PL", "Europe/Warsaw"), "7 października 2026")
  assert.equal(formatDate(d, "en-GB", "UTC", true), "6 October 2026, 22:30")
  assert.equal(formatShortDate(d, "pl-PL", "Europe/Warsaw", true), "7 paź, 00:30")
  assert.equal(monthYear(d, "Europe/Warsaw"), "10/2026")
  assert.equal(formatDate("not a date", "en-GB", "UTC"), "not a date")
  assert.equal(validTimeZone("Europe/Warsaw"), true)
  assert.equal(validTimeZone("Nowhere/Land"), false)
  const f = { one: "pozycja", few: "pozycje", many: "pozycji" }
  assert.deepEqual([1, 2, 4, 5, 12, 14, 22, 25, 112].map((n) => plural("pl", n, f)), ["pozycja", "pozycje", "pozycje", "pozycji", "pozycji", "pozycji", "pozycje", "pozycji", "pozycji"])
  assert.equal(plural("en", 2, { one: "item", few: "items", many: "items" }), "items")
})

test("typography: short words glued to the next one, e-mail unbroken, only text between tags touched", () => {
  assert.equal(nb("Kot i pies w domu"), "Kot i pies w domu")
  assert.equal(nb("i w domu"), "i w domu")
  assert.equal(nb("e-mail"), "e‑mail")
  assert.equal(nb("1 234 zł"), "1 234 zł")
  const html = `<html><head><title>a w b</title></head><body><p class="a w b" style="x">a w b</p><style>.a w{}</style></body></html>`
  const out = typesetHtml(html)
  assert.match(out, /<title>a w b<\/title>/, "the head is left alone")
  assert.match(out, /class="a w b"/, "attributes are left alone")
  assert.match(out, />a&nbsp;w&nbsp;b</)
  assert.match(out, /<style>\.a w\{\}<\/style>/)
})

test("colours: derived text colours stay readable for any accent, a light band is darkened", () => {
  for (const accent of ["#26D07C", "#2563EB", "#F59E0B", "#E11D48", "#FFFFFF", "#000000", "#7C3AED", "#14B8A6"]) {
    const p = makePalette(accent, "#212721")
    assert.ok(contrast(p.light.accentInk, "#FFFFFF") >= 4.5, `${accent}: accent text on white`)
    assert.ok(contrast(p.dark.accentInk, p.dark.card) >= 4.5, `${accent}: accent text in dark mode`)
    assert.ok(contrast(p.onAccent, p.accent) >= 4.5 || contrast(p.onAccent, p.accent) >= contrast(p.onAccent === "#FFFFFF" ? p.light.ink : "#FFFFFF", p.accent), `${accent}: button text`)
    assert.ok(contrast(p.accentOnNight, p.night) >= 4.5 || contrast("#FFFFFF", p.night) < 4.5, `${accent}: accent on the band`)
  }
  const light = makePalette("#26D07C", "#F5F5F5")
  assert.ok(contrast("#FFFFFF", light.night) >= 7, "a light band is darkened for white text")
  assert.equal(makePalette("nope", "nope").accent, "#26D07C")
  assert.equal(normalizeHex("#abc"), "#AABBCC")
  assert.equal(normalizeHex("blue"), null)
  const p = makePalette("#26D07C", "#212721")
  assert.equal(p.light.page.length, 7)
})

test("a text part from HTML: links kept, blocks on lines, hidden preheader filler dropped", () => {
  const t = htmlToText(`<html><head><style>p{}</style></head><body><div style="display:none">pre&#8199;&#847;</div><h1>Hi&nbsp;there</h1><p>Visit <a href="https://x.example.com">our shop</a> &amp; save</p><ul><li>One</li><li>Two</li></ul></body></html>`)
  assert.equal(t, "Hi there\nVisit our shop (https://x.example.com) & save\n- One\n- Two")
})

test("the rate limiter: a sliding window per key", () => {
  const l = createRateLimiter({ limit: 2, windowMs: 1000 })
  assert.equal(l.hit("a", 0).ok, true)
  assert.equal(l.hit("a", 10).ok, true)
  const third = l.hit("a", 20)
  assert.equal(third.ok, false)
  assert.equal(third.retryAfterSeconds, 1)
  assert.equal(l.hit("b", 20).ok, true)
  assert.equal(l.hit("a", 1001).ok, true)
})

test("the version in the admin, the manifest and the User-Agent is the one of package.json", () => {
  const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")) as { version: string }
  assert.equal(KIT_META.version, pkg.version)
  assert.equal(USER_AGENT, `KodaPlus-Medusa-Emails/${pkg.version} (+https://koda.plus)`)
})

test("secret fields are hidden in what the outbox keeps; tokens are taken out of old bodies", () => {
  const data = { email: "anna@example.com", reset_url: "https://shop.example.com/reset-password?token=abc&email=x", code: 1234 }
  assert.deepEqual(redactData(data, ["reset_url", "code", "missing"]), { email: "anna@example.com", reset_url: HIDDEN_LINK, code: "hidden" })
  assert.deepEqual(redactData(data, []), data)
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJlbnRpdHlfaWQiOiJhbm5hQGV4YW1wbGUuY29tIn0.c2lnbmF0dXJlMTIzNDU2"
  const html = `<a href="https://shop.example.com/reset-password?token=${jwt}&amp;email=anna%40example.com">Reset</a> https://x.example/?code=998877 ${jwt}`
  const scrubbed = scrubSecrets(html) ?? ""
  assert.ok(!scrubbed.includes("eyJ"))
  assert.ok(!scrubbed.includes("998877"))
  assert.match(scrubbed, /token=hidden&amp;email=anna%40example\.com/, "the rest of the link stays")
  assert.equal(scrubSecrets(null), null)
})

test("an address is kept only as a one-way hash, the same for any spelling of it", () => {
  assert.equal(addressHash("anna@example.com"), addressHash("  ANNA@example.com "))
  assert.notEqual(addressHash("anna@example.com"), addressHash("ania@example.com"))
  assert.match(addressHash("anna@example.com"), /^[0-9a-f]{40}$/)
  assert.equal(customerIdOf("cus_01J9ABC"), "cus_01J9ABC")
  for (const bad of ["user_01", "cus_", "cus_1; drop", null, 42]) assert.equal(customerIdOf(bad), null)
})

test("text that reads like a link, an address or a domain never passes as a name", () => {
  for (const ok of ["Anna", "Zoë", "Anne-Marie", "O'Neil", "Łukasz", "J. R."]) assert.equal(personName(ok), ok, ok)
  for (const bad of ["evil.example", "www.x", "https://x", "a@b.c", "Anna2", "<b>", "x/y"]) assert.equal(personName(bad), null, bad)
  assert.equal(looksLikeLink("Stolarnia sp. z o.o."), false, "a Polish company form is not a domain")
  assert.equal(companyName("Shop at deals.example"), null)
})
