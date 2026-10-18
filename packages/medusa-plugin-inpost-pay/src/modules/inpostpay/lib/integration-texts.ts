import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers for InPost Pay: one line per
 * order paid through the app, the facts and the board counters.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  order: {
    paid: "Paid in the InPost app",
    cod: "InPost Pay, cash on delivery",
    pending: "InPost Pay payment: {{status}}",
    failed: "InPost Pay payment failed: {{status}}",
    rejected: "Rejected in InPost Pay",
    demo: "InPost Pay (demo simulation)",
  },
  fact: {
    method: "InPost Pay",
    locker: "Parcel locker {{point}}",
    courier: "InPost courier",
    digital: "Digital delivery",
    phone: "App user {{phone}}",
  },
  attention: {
    payment_problems: "InPost Pay orders without payment",
    failed_baskets: "InPost Pay baskets that did not become orders",
  },
  problems: {
    keys: "The InPost Pay keys are missing (clientId, clientSecret, merchantClientId)",
    provider: "The InPost Pay payment provider is not registered in the payment module",
    delivery: "No shipping option is mapped to an InPost Pay delivery",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  order: {
    paid: "Opłacone w aplikacji InPost",
    cod: "InPost Pay, za pobraniem",
    pending: "Płatność InPost Pay: {{status}}",
    failed: "Płatność InPost Pay nie przeszła: {{status}}",
    rejected: "Odrzucone w InPost Pay",
    demo: "InPost Pay (symulacja demo)",
  },
  fact: {
    method: "InPost Pay",
    locker: "Paczkomat {{point}}",
    courier: "Kurier InPost",
    digital: "Dostawa cyfrowa",
    phone: "Użytkownik aplikacji {{phone}}",
  },
  attention: {
    payment_problems: "Zamówienia InPost Pay bez płatności",
    failed_baskets: "Koszyki InPost Pay, z których nie powstało zamówienie",
  },
  problems: {
    keys: "Brak kluczy InPost Pay (clientId, clientSecret, merchantClientId)",
    provider: "Dostawca płatności InPost Pay nie jest zarejestrowany w module płatności",
    delivery: "Żadna opcja dostawy nie jest przypisana do dostawy InPost Pay",
  },
}

/* Polish may add plural forms; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
