import { test } from "node:test"
import assert from "node:assert/strict"
import { carrierName, trackingUrl } from "../src/modules/baselinker/lib/tracking.ts"

test("tracking links for the carriers BaseLinker accounts use in Poland", () => {
  assert.equal(trackingUrl("dpd", "1050500491500U"), "https://tracktrace.dpd.com.pl/parcelDetails?p1=1050500491500U")
  assert.equal(trackingUrl("GLS", "123"), "https://gls-group.com/PL/pl/sledzenie-paczek?match=123")
  assert.equal(trackingUrl("inpost_kurier", "520113014230722029585646"), "https://inpost.pl/sledzenie-przesylek?number=520113014230722029585646")
  assert.equal(trackingUrl("paczkomaty", "6800"), "https://inpost.pl/sledzenie-przesylek?number=6800")
  assert.equal(trackingUrl("dhl", "JJD000"), "https://www.dhl.com/pl-pl/home/tracking.html?tracking-id=JJD000")
  assert.equal(trackingUrl("ups", "1Z999"), "https://www.ups.com/track?tracknum=1Z999")
  assert.equal(trackingUrl("fedex", "7777"), "https://www.fedex.com/fedextrack/?trknbr=7777")
  assert.equal(trackingUrl("pocztapolska", "PX00"), "https://emonitoring.poczta-polska.pl/?numer=PX00")
})

test("an unknown carrier gives no link, the number is encoded, an empty number gives nothing", () => {
  assert.equal(trackingUrl("rabbit_express", "123"), null)
  assert.equal(trackingUrl("dpd", "A B/1"), "https://tracktrace.dpd.com.pl/parcelDetails?p1=A%20B%2F1")
  assert.equal(trackingUrl("dpd", "  "), null)
  assert.equal(trackingUrl(null, "123"), null)
})

test("carrier names: known modules get their trade name, unknown ones are kept", () => {
  assert.equal(carrierName("inpost"), "InPost")
  assert.equal(carrierName("pocztex"), "Poczta Polska")
  assert.equal(carrierName("rabbit_express"), "rabbit_express")
  assert.equal(carrierName(""), null)
})
