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
    trackingLinked: "Shipped: InPost Von Halsky shows the parcel",
    trackingDemo: "Shipped (demo simulation)",
    trackingWaiting: "Shipped, but InPost Von Halsky does not show the parcel yet",
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
    title_invalid: "The name needs 7 to 150 characters and two words",
    no_ean: "No EAN",
    invalid_ean: "The EAN check digit is wrong",
    no_brand: "No brand (and no EAN)",
    no_description: "No description",
    description_short: "The description is shorter than 100 characters",
    no_image: "No image",
    no_category: "No marketplace category",
    attributes_missing: "Required category attributes are missing",
    no_gpsr: "No GPSR manufacturer",
    gpsr_incomplete: "The GPSR manufacturer lacks a name or an e-mail",
    too_large: "Too large for a parcel locker or courier parcel",
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
    afterSale: "Returns {{returns}}, claims {{claims}}",
  },
  attention: {
    held_orders: "InPost Von Halsky orders that could not be imported",
    tracking_waiting: "Shipped InPost Von Halsky orders the marketplace does not show as shipped yet",
    open_cases: "InPost Von Halsky returns and claims waiting for a decision",
    awaiting_shipment: "InPost Von Halsky orders to ship",
    blocked_offers: "Variants that cannot be listed on InPost Von Halsky",
    connection_lost: "InPost Von Halsky refuses the credentials: the integration is disconnected and the marketplace deactivates its offers",
  },
  problems: {
    credentials: "The InPost Von Halsky credentials are missing (organizationId, clientId, clientSecret)",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  order: {
    awaiting: "Zamówienie z InPost Von Halsky, czeka na wysyłkę",
    demo: "Zamówienie z InPost Von Halsky (symulacja demo)",
    trackingLinked: "Wysłane: InPost Von Halsky widzi przesyłkę",
    trackingDemo: "Wysłane (symulacja demo)",
    trackingWaiting: "Wysłane, ale InPost Von Halsky jeszcze nie widzi przesyłki",
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
    title_invalid: "Nazwa musi mieć od 7 do 150 znaków i dwa słowa",
    no_ean: "Brak EAN",
    invalid_ean: "Błędna cyfra kontrolna EAN",
    no_brand: "Brak marki (i brak EAN)",
    no_description: "Brak opisu",
    description_short: "Opis ma mniej niż 100 znaków",
    no_image: "Brak zdjęcia",
    no_category: "Brak kategorii marketplace",
    attributes_missing: "Brak wymaganych parametrów kategorii",
    no_gpsr: "Brak producenta GPSR",
    gpsr_incomplete: "Producentowi GPSR brakuje nazwy albo e-maila",
    too_large: "Za duże na paczkomat i paczkę kurierską",
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
    afterSale: "Zwroty {{returns}}, reklamacje {{claims}}",
  },
  attention: {
    held_orders: "Zamówienia z InPost Von Halsky, których nie udało się zaimportować",
    tracking_waiting: "Wysłane zamówienia z InPost Von Halsky, których marketplace jeszcze nie widzi jako wysłane",
    open_cases: "Zwroty i reklamacje z InPost Von Halsky czekające na decyzję",
    awaiting_shipment: "Zamówienia z InPost Von Halsky do wysłania",
    blocked_offers: "Warianty, których nie da się wystawić w InPost Von Halsky",
    connection_lost: "InPost Von Halsky odrzuca dane dostępowe: integracja jest rozłączona, a marketplace wyłącza jej oferty",
  },
  problems: {
    credentials: "Brak danych dostępowych InPost Von Halsky (organizationId, clientId, clientSecret)",
  },
}

/* Polish may add plural forms; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
