import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers for InPost Von Halsky: one
 * line per marketplace order and per product with offers, the facts and the
 * board counters.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  order: {
    awaiting: "InPost Von Halsky order, waiting for shipment",
    demo: "InPost Von Halsky order (demo simulation)",
    trackingSent: "Tracking sent to InPost Von Halsky",
    trackingRecorded: "Tracking recorded (demo simulation)",
    trackingPending: "Tracking waits for the seller API",
    trackingFailed: "Tracking did not reach InPost Von Halsky",
  },
  product: {
    listed_one: "Listed on InPost Von Halsky ({{count}} variant)",
    listed_other: "Listed on InPost Von Halsky ({{count}} variants)",
    draft_one: "{{count}} variant ready to list on InPost Von Halsky",
    draft_other: "{{count}} variants ready to list on InPost Von Halsky",
    blocked_one: "{{count}} variant cannot be listed on InPost Von Halsky",
    blocked_other: "{{count}} variants cannot be listed on InPost Von Halsky",
    closed: "Taken off InPost Von Halsky",
  },
  reason: {
    no_title: "No title",
    no_ean: "No EAN",
    invalid_ean: "The EAN check digit is wrong",
    no_brand: "No brand",
    no_gpsr: "No GPSR manufacturer",
    gpsr_incomplete: "The GPSR manufacturer lacks an e-mail or an address",
    no_price: "No PLN price",
    not_published: "The product is not published",
    unknown: "Something is missing",
  },
  fact: {
    channel: "InPost Von Halsky",
    orderId: "Marketplace order {{id}}",
    paid: "Paid on the marketplace",
    cod: "Cash on delivery",
    locker: "Parcel locker {{point}}",
    courier: "Courier",
    tracking: "Tracking {{numbers}}",
    offers: "{{listed}} of {{total}} listed",
  },
  attention: {
    held_orders: "InPost Von Halsky orders that could not be imported",
    tracking_failed: "InPost Von Halsky orders whose tracking failed",
    awaiting_shipment: "InPost Von Halsky orders to ship",
    blocked_offers: "Variants that cannot be listed on InPost Von Halsky",
  },
  problems: {
    credentials: "The InPost Von Halsky credentials are missing (apiUrl, organizationId, accessToken)",
    pending: "The seller API client waits for the official documentation: nothing is sent to the marketplace yet",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  order: {
    awaiting: "Zamówienie z InPost Von Halsky, czeka na wysyłkę",
    demo: "Zamówienie z InPost Von Halsky (symulacja demo)",
    trackingSent: "Numer przesyłki wysłany do InPost Von Halsky",
    trackingRecorded: "Numer przesyłki zapisany (symulacja demo)",
    trackingPending: "Numer przesyłki czeka na API sprzedawcy",
    trackingFailed: "Numer przesyłki nie dotarł do InPost Von Halsky",
  },
  product: {
    listed_one: "Wystawione w InPost Von Halsky ({{count}} wariant)",
    listed_few: "Wystawione w InPost Von Halsky ({{count}} warianty)",
    listed_many: "Wystawione w InPost Von Halsky ({{count}} wariantów)",
    listed_other: "Wystawione w InPost Von Halsky ({{count}} wariantu)",
    draft_one: "{{count}} wariant gotowy do wystawienia w InPost Von Halsky",
    draft_few: "{{count}} warianty gotowe do wystawienia w InPost Von Halsky",
    draft_many: "{{count}} wariantów gotowych do wystawienia w InPost Von Halsky",
    draft_other: "{{count}} wariantu gotowego do wystawienia w InPost Von Halsky",
    blocked_one: "Nie da się wystawić {{count}} wariantu w InPost Von Halsky",
    blocked_few: "Nie da się wystawić {{count}} wariantów w InPost Von Halsky",
    blocked_many: "Nie da się wystawić {{count}} wariantów w InPost Von Halsky",
    blocked_other: "Nie da się wystawić {{count}} wariantu w InPost Von Halsky",
    closed: "Zdjęte z InPost Von Halsky",
  },
  reason: {
    no_title: "Brak nazwy",
    no_ean: "Brak EAN",
    invalid_ean: "Błędna cyfra kontrolna EAN",
    no_brand: "Brak marki",
    no_gpsr: "Brak producenta GPSR",
    gpsr_incomplete: "Producentowi GPSR brakuje e-maila albo adresu",
    no_price: "Brak ceny w PLN",
    not_published: "Produkt nie jest opublikowany",
    unknown: "Czegoś brakuje",
  },
  fact: {
    channel: "InPost Von Halsky",
    orderId: "Zamówienie w marketplace {{id}}",
    paid: "Opłacone w marketplace",
    cod: "Za pobraniem",
    locker: "Paczkomat {{point}}",
    courier: "Kurier",
    tracking: "Przesyłka {{numbers}}",
    offers: "Wystawione {{listed}} z {{total}}",
  },
  attention: {
    held_orders: "Zamówienia z InPost Von Halsky, których nie udało się zaimportować",
    tracking_failed: "Zamówienia z InPost Von Halsky z nieudanym numerem przesyłki",
    awaiting_shipment: "Zamówienia z InPost Von Halsky do wysłania",
    blocked_offers: "Warianty, których nie da się wystawić w InPost Von Halsky",
  },
  problems: {
    credentials: "Brak danych dostępowych InPost Von Halsky (apiUrl, organizationId, accessToken)",
    pending: "Klient API sprzedawcy czeka na oficjalną dokumentację: nic nie jest jeszcze wysyłane do marketplace",
  },
}

/* Polish may add plural forms; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
