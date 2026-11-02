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
    failed: "DPD refused the shipment",
    unknown: "No clear answer from DPD, to check",
    problem: "Delivery problem",
    returned: "Returning to the store",
    planProblems: "To fix before shipping",
    toCreate: "To ship with DPD",
    toCreateAt: "To ship to Pickup point {{point}}",
    creating: "Creating the shipment",
    toLabel: "Waybill given, label to print",
    labeling: "Printing the label",
    labeled: "Label ready, to hand to the courier",
    handedOver: "Handed to the courier",
    inTransit: "On the way",
    inPoint: "At Pickup point {{point}}",
    delivered: "Delivered",
    collected: "Collected from the Pickup point",
    deliveredSome: "Delivered {{done}} of {{total}}",
    chosenCourier: "DPD courier, waiting for fulfillment",
    chosenPickup: "DPD Pickup point {{point}}, waiting for fulfillment",
    returnToCreate: "Return label to create",
    returnOnTheWay: "Return on the way",
    returnDelivered: "Return back at the store",
    skipped: "Shipped outside DPD",
    canceled: "Shipment canceled",
    more_one: "and {{count}} more shipment",
    more_other: "and {{count}} more shipments",
    notArmed: "Shipments are created once a person arms the writer in Settings",
    demo: "Sample data of the demo mode",
  },
  fact: {
    courier: "DPD courier",
    courierAbroad: "DPD courier to {{country}}",
    pickup: "DPD Pickup {{point}}",
    return: "DPD return",
    waybill: "Waybill {{number}}",
    cod: "Cash on delivery",
    codAmount: "Cash on delivery, {{amount}}",
    codLater: "Cash on delivery, amount set when the shipment is created",
  },
  attention: {
    shipments_problems: "DPD problems",
    shipments_to_create: "To ship with DPD",
    shipments_labeled: "To hand to the DPD courier",
  },
  problem: {
    not_configured: "No DPD login, password or master FID: nothing goes to DPD",
    demo: "Demo mode: sample shipments, nothing goes to DPD",
    sender: "The sender needs fixing before shipping",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  order: {
    failed: "DPD odrzucił przesyłkę",
    unknown: "Brak jasnej odpowiedzi DPD, do sprawdzenia",
    problem: "Problem z doręczeniem",
    returned: "Wraca do sklepu",
    planProblems: "Do poprawy przed nadaniem",
    toCreate: "Do nadania w DPD",
    toCreateAt: "Do nadania do punktu Pickup {{point}}",
    creating: "Tworzę przesyłkę",
    toLabel: "Numer nadany, etykieta do wydruku",
    labeling: "Drukuję etykietę",
    labeled: "Etykieta gotowa, do przekazania kurierowi",
    handedOver: "Przekazana kurierowi",
    inTransit: "W drodze",
    inPoint: "W punkcie Pickup {{point}}",
    delivered: "Doręczona",
    collected: "Odebrana z punktu Pickup",
    deliveredSome: "Doręczone {{done}} z {{total}}",
    chosenCourier: "Kurier DPD, czeka na realizację",
    chosenPickup: "Punkt DPD Pickup {{point}}, czeka na realizację",
    returnToCreate: "Etykieta zwrotna do utworzenia",
    returnOnTheWay: "Zwrot w drodze",
    returnDelivered: "Zwrot dotarł do sklepu",
    skipped: "Wysłana poza DPD",
    canceled: "Przesyłka anulowana",
    more_one: "i jeszcze {{count}} przesyłka",
    more_few: "i jeszcze {{count}} przesyłki",
    more_many: "i jeszcze {{count}} przesyłek",
    more_other: "i jeszcze {{count}} przesyłki",
    notArmed: "Przesyłki powstaną, gdy ktoś uzbroi zapis w Ustawieniach",
    demo: "Przykładowe dane trybu demo",
  },
  fact: {
    courier: "Kurier DPD",
    courierAbroad: "Kurier DPD, kraj {{country}}",
    pickup: "DPD Pickup {{point}}",
    return: "Zwrot DPD",
    waybill: "List przewozowy {{number}}",
    cod: "Za pobraniem",
    codAmount: "Za pobraniem, {{amount}}",
    codLater: "Za pobraniem, kwota przy tworzeniu przesyłki",
  },
  attention: {
    shipments_problems: "Problemy z DPD",
    shipments_to_create: "Do nadania w DPD",
    shipments_labeled: "Do przekazania kurierowi DPD",
  },
  problem: {
    not_configured: "Brak loginu, hasła albo master FID DPD: nic nie idzie do DPD",
    demo: "Tryb demo: przykładowe przesyłki, nic nie idzie do DPD",
    sender: "Nadawca wymaga poprawy przed nadaniem",
  },
}

/* Polish has more plural forms than English; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
