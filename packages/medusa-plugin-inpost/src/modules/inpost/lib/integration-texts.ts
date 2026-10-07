import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers (one line per order, the
 * delivery and payment facts, the board counters), in the `integration`
 * subtree of the admin dictionaries. The server uses them for the fallback
 * sentence; `en.ts` and `pl.ts` mount them as `integration`, so a host
 * translates the same keys with the plugin dictionary.
 *
 * Plain text here: the Polish dictionary goes through typeset() as a whole.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  order: {
    failed: "Shipment not created",
    unknown: "InPost did not answer, checking",
    problem: "Delivery problem",
    returned: "Returning to the sender",
    planProblems: "To fix before shipping",
    toCreate: "To ship",
    toCreateAt: "To ship to locker {{locker}}",
    creating: "Creating the shipment",
    awaitingPayment: "Waiting for the offer payment",
    canceledOpen: "Shipment canceled, fulfillment still open",
    waiting: "Waiting for pickup",
    inTransit: "On the way",
    inLocker: "In locker {{locker}}",
    inPoint: "Ready for pickup",
    delivered: "Delivered",
    deliveredSome: "Delivered {{done}} of {{total}}",
    chosenLocker: "Locker {{locker}}, waiting for fulfillment",
    chosenCourier: "InPost courier, waiting for fulfillment",
    skipped: "Shipped outside InPost",
    canceled: "Shipment canceled",
    more_one: "and {{count}} more parcel",
    more_other: "and {{count}} more parcels",
    notArmed: "Shipments are created once a person arms the writer in Settings",
    demo: "Sample data of the demo mode",
  },
  fact: {
    locker: "Paczkomat {{locker}}",
    courier: "InPost courier",
    tracking: "Tracking {{number}}",
    cod: "Cash on delivery",
    codAmount: "Cash on delivery, {{amount}}",
    codLater: "Cash on delivery, amount set when the parcel is created",
  },
  attention: {
    parcels_to_create: "To ship",
    parcels_failed: "Not created",
    parcels_problems: "Problems and returns",
    parcels_awaiting_payment: "Waiting for the offer payment",
  },
  problem: {
    not_configured: "No ShipX token or organization: nothing goes to InPost",
    demo: "Demo mode: sample shipments, nothing goes to InPost",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  order: {
    failed: "Nie utworzono przesyłki",
    unknown: "InPost nie odpowiedział, sprawdzam",
    problem: "Problem z doręczeniem",
    returned: "Wraca do nadawcy",
    planProblems: "Do poprawy przed nadaniem",
    toCreate: "Do nadania",
    toCreateAt: "Do nadania do paczkomatu {{locker}}",
    creating: "Tworzę przesyłkę",
    awaitingPayment: "Czeka na opłacenie oferty",
    canceledOpen: "Przesyłka anulowana, realizacja dalej otwarta",
    waiting: "Czeka na nadanie",
    inTransit: "W drodze",
    inLocker: "W paczkomacie {{locker}}",
    inPoint: "Do odbioru",
    delivered: "Doręczona",
    deliveredSome: "Doręczone {{done}} z {{total}}",
    chosenLocker: "Paczkomat {{locker}}, czeka na realizację",
    chosenCourier: "Kurier InPost, czeka na realizację",
    skipped: "Wysłana poza InPost",
    canceled: "Przesyłka anulowana",
    more_one: "i jeszcze {{count}} paczka",
    more_few: "i jeszcze {{count}} paczki",
    more_many: "i jeszcze {{count}} paczek",
    more_other: "i jeszcze {{count}} paczki",
    notArmed: "Przesyłki powstaną, gdy ktoś uzbroi zapis w Ustawieniach",
    demo: "Przykładowe dane trybu demo",
  },
  fact: {
    locker: "Paczkomat {{locker}}",
    courier: "Kurier InPost",
    tracking: "Numer {{number}}",
    cod: "Za pobraniem",
    codAmount: "Za pobraniem, {{amount}}",
    codLater: "Za pobraniem, kwota przy tworzeniu przesyłki",
  },
  attention: {
    parcels_to_create: "Do nadania",
    parcels_failed: "Nieutworzone",
    parcels_problems: "Problemy i zwroty",
    parcels_awaiting_payment: "Czeka na opłacenie oferty",
  },
  problem: {
    not_configured: "Brak tokenu ShipX albo organizacji: nic nie idzie do InPost",
    demo: "Tryb demo: przykładowe przesyłki, nic nie idzie do InPost",
  },
}

/* Polish has more plural forms than English; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
