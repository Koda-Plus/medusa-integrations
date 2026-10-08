import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers for EU Compliance: one line
 * per product with its GPSR record and per customer with data requests, plus
 * the board counters. Lives in the `integration` subtree of the admin
 * dictionaries, the server uses it for the fallback sentence.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  product: {
    complete: "GPSR record complete",
    incomplete: "GPSR record incomplete",
    manufacturer: "Manufacturer: {{name}}",
    responsible: "Responsible in the EU: {{name}}",
    missingManufacturer: "Set the manufacturer",
    missingResponsible: "Set the EU responsible person",
  },
  customer: {
    open_one: "1 data request open",
    open_other: "{{count}} data requests open",
    done_one: "1 data request closed",
    done_other: "{{count}} data requests closed",
    type: {
      access: "Access",
      erasure: "Erasure",
      portability: "Portability",
      restriction: "Restriction",
      objection: "Objection",
      rectification: "Rectification",
    },
  },
  attention: {
    products_incomplete: "Products with an incomplete GPSR record",
    dsr_open: "Open data requests",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  product: {
    complete: "Rekord GPSR kompletny",
    incomplete: "Rekord GPSR niekompletny",
    manufacturer: "Producent: {{name}}",
    responsible: "Osoba odpowiedzialna w UE: {{name}}",
    missingManufacturer: "Ustaw producenta",
    missingResponsible: "Ustaw osobę odpowiedzialną w UE",
  },
  customer: {
    open_one: "1 otwarte żądanie danych",
    open_few: "{{count}} otwarte żądania danych",
    open_many: "{{count}} otwartych żądań danych",
    open_other: "{{count}} otwartego żądania danych",
    done_one: "1 zamknięte żądanie danych",
    done_few: "{{count}} zamknięte żądania danych",
    done_many: "{{count}} zamkniętych żądań danych",
    done_other: "{{count}} zamkniętego żądania danych",
    type: {
      access: "Dostęp",
      erasure: "Usunięcie",
      portability: "Przenoszenie",
      restriction: "Ograniczenie",
      objection: "Sprzeciw",
      rectification: "Sprostowanie",
    },
  },
  attention: {
    products_incomplete: "Produkty bez kompletnego rekordu GPSR",
    dsr_open: "Otwarte żądania danych",
  },
}

/* Polish has more plural forms than English; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
