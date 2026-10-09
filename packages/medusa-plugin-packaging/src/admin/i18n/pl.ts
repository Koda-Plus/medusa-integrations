import type en from "./en"
import { typeset } from "../lib/packaging-typeset"
import { communityPl } from "../lib/packaging-kit-community"
import { integrationPl } from "../../modules/packaging/lib/integration-texts"

/* Typed by en.ts below (every English key exists here). */
const pl = {
  nav: "Opakowania",
  title: "Opakowania",
  view: {
    panel: "Panel",
    guide: "Przewodnik wdrożenia",
  },
  by: "by Koda Plus",
  subtitle: "Drabinka opakowań zbiorczych katalogu: sztuka, karton i paleta, minimalne zamówienie i wielokrotność, kody EAN i etykiety SSCC.",
  mode: {
    demo: "Demo",
  },
  error: "Nie udało się wczytać strony: {{message}}",
  stats: {
    products: "Produkty",
    moq: "Z minimalnym zamówieniem",
    sscc: "Z SSCC",
    units: "Jednostki drabinki",
  },
  products: {
    title: "Drabinki opakowań",
    subtitle: "Każdy produkt katalogu z drabinką, minimalnym zamówieniem i wielokrotnością. Kliknięcie otwiera edytor.",
    empty: "Brak produktów w katalogu.",
    sku: "SKU",
    product: "Produkt",
    ladder: "Drabinka",
    moq: "Minimum",
    step: "Wielokrotność",
    unset: "Nie ustawiono",
    edit: "Edytuj",
  },
  sscc: {
    title: "Etykiety SSCC",
    subtitle: "Numer etykiety palety: prefiks GS1 {{prefix}} i numer seryjny dają 18-cyfrowy SSCC z cyfrą kontrolną.",
    placeholder: "Numer seryjny, np. 000001",
    payload: "Ładunek GS1-128",
  },
  editor: {
    moq: "Minimalne zamówienie (szt.)",
    step: "Wielokrotność (szt.)",
    box: "Karton: sztuk",
    boxEan: "EAN kartonu",
    pallet: "Paleta: sztuk",
    ssccPrefix: "Prefiks SSCC palety",
    save: "Zapisz",
    cancel: "Anuluj",
  },
  toast: {
    saved: "Zapisano",
    error: "Coś poszło nie tak: {{error}}",
  },
  community: communityPl,
  integration: integrationPl,
}

const samePolishKeys: typeof en = pl
void samePolishKeys

/* Polish typography: no one-letter word left at the end of a line. */
export default typeset(pl)
