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
    settings: "Ustawienia",
  },
  by: "by Koda Plus",
  subtitle: "Drabinka opakowań zbiorczych katalogu: sztuka, karton i paleta, minimalne zamówienie i wielokrotność, kody EAN i etykiety SSCC.",
  points: {
    ladder: "Sztuka, karton, paleta",
    moq: "Minimum i wielokrotność",
    ean: "EAN kartonu",
    sscc: "Etykiety SSCC",
  },
  mode: {
    demo: "Demo",
    demoTitle: "Tryb demo",
    demoText: "Przykładowe drabinki z flagą demo obok prawdziwych danych sklepu. Nic nie wychodzi poza serwer.",
  },
  actions: {
    refresh: "Odśwież",
    products: "Produkty",
    sscc: "Etykieta SSCC",
    more: "Więcej akcji",
  },
  loading: "Wczytuję opakowania",
  error: "Nie udało się wczytać strony: {{message}}",
  stats: {
    products: "Produkty",
    productsHint: "W katalogu",
    moq: "Z minimalnym zamówieniem",
    moqHint: "Minimum ponad zero",
    sscc: "Z SSCC",
    ssccHint: "Paleta z prefiksem",
    unset: "Bez drabinki",
    unsetHint: "Tylko sztuki",
  },
  products: {
    title: "Drabinki opakowań",
    points: {
      ladder: "Sztuka, karton, paleta",
      moq: "Minimum i wielokrotność",
      edit: "Ołówek otwiera edytor",
    },
    search: "SKU albo nazwa produktu",
    filter: {
      all: "Wszystkie",
      moq: "Z minimum",
      sscc: "Z SSCC",
      unset: "Bez drabinki",
    },
    empty: "Brak produktów w katalogu",
    emptySearch: "Żaden produkt nie pasuje",
    sku: "SKU",
    product: "Produkt",
    ladder: "Drabinka",
    moq: "Minimum",
    step: "Wielokrotność",
    unset: "Nie ustawiono",
    edit: "Edytuj drabinkę",
    open: "Otwórz produkt",
  },
  sscc: {
    title: "Etykiety SSCC",
    points: {
      prefix: "Prefiks GS1 {{prefix}}",
      digits: "18 cyfr",
      check: "Cyfra kontrolna liczona",
      nothing: "Nic się nie zapisuje",
    },
    serial: "Numer seryjny palety",
    placeholder: "np. 000001",
    payload: "Ładunek GS1-128",
    empty: "Wpisz numer seryjny, min. 3 cyfry",
    copy: "Kopiuj numer",
    copied: "Skopiowano",
  },
  editor: {
    title: "Drabinka",
    moq: "Minimalne zamówienie (szt.)",
    step: "Wielokrotność (szt.)",
    box: "Karton: sztuk",
    boxEan: "EAN kartonu",
    pallet: "Paleta: sztuk",
    ssccPrefix: "Prefiks SSCC palety",
    save: "Zapisz",
    cancel: "Anuluj",
  },
  settings: {
    title: "Ustawienia",
    subtitle: "Opcje w użyciu, tylko do odczytu. Ustawia się je w medusa-config.ts.",
    tab: {
      options: "Opcje",
    },
    points: {
      readOnly: "Tylko odczyt",
      config: "medusa-config.ts",
    },
    gs1Prefix: "Prefiks GS1",
    units: "Jednostki drabinki",
    demo: "Tryb demo",
    on: "Włączony",
    off: "Wyłączony",
    none: "Nie ustawiono",
  },
  toast: {
    saved: "Zapisano",
    refreshed: "Odświeżono",
    error: "Coś poszło nie tak: {{error}}",
  },
  guide: {
    intro: {
      title: "Wdrożenie krok po kroku",
      text: "Instalujesz wtyczkę, rejestrujesz ją, uruchamiasz migracje, otwierasz panel. Karta produktu i koszyk czytają drabinkę, etykiety SSCC liczą się same.",
      time: "ok. 15 minut",
      timeLabel: "Czas",
      needsLabel: "Potrzebujesz",
      needs: {
        medusa: "Medusa 2.12 lub nowsza",
        gs1: "Prefiks GS1 dla etykiet SSCC",
      },
    },
    stepsTitle: "Kroki",
    stepsSubtitle: "Wszystko, co trzeba zrobić, żeby panel działał w Twoim sklepie.",
    state: {
      done: "Zrobione",
      todo: "Do zrobienia",
      optional: "Opcjonalnie",
      later: "Później",
    },
    checkLabel: "Sprawdź:",
    copy: "Kopiuj",
    copied: "Skopiowano",
    steps: {
      install: {
        title: "Zainstaluj wtyczkę",
        p1: "Menedżerem pakietów projektu, potem migracje.",
        p2: "Migracje tworzą packaging_product i packaging_unit.",
        check: "Opakowania widać w bocznym menu admina.",
      },
      config: {
        title: "Zarejestruj w medusa-config.ts",
        p1: "Dodaj wpis do listy plugins, nie ruszając reszty. Każda opcja ma wartość domyślną.",
        check: "Ustawienia pokazują Twój prefiks GS1.",
      },
      demo: {
        title: "Tryb demo (opcjonalnie)",
        p1: "Tylko po włączeniu: przykładowe drabinki z flagą demo obok prawdziwych danych.",
        p2: "PACKAGING_DEMO=true w .env, nigdy w kodzie.",
        check: "W nagłówku widać plakietkę Demo.",
      },
      ladder: {
        title: "Wpisz pierwszą drabinkę",
        p1: "Sztuka, karton, paleta z liczbą sztuk, EAN kartonu i prefiks SSCC palety.",
        check: "Produkt znika z filtra Bez drabinki.",
      },
      store: {
        title: "Podepnij sklep",
        p1: "/store/packaging/products/:id zwraca drabinkę dla karty produktu, koszyk pilnuje minimum i wielokrotności.",
        check: "Karta produktu pokazuje karton i minimum.",
      },
    },
    checklist: {
      title: "Lista przed startem",
      subtitle: "Wszystko odhaczone: zamówienia hurtowe w pełnych opakowaniach.",
      ladder: "Każdy produkt hurtowy ma drabinkę",
      moq: "Minimum i wielokrotność tam, gdzie trzeba",
      ean: "EAN-y kartonów zgodne z kodem na opakowaniu",
      sscc: "Prefiks GS1 ustawiony, etykiety SSCC z cyfrą kontrolną",
    },
    faq: {
      title: "Pytania",
      optional: {
        q: "Czy karton i paleta muszą być zawsze?",
        a: "Nie. Same sztuki albo sztuki i karton. Puste pole sztuk palety usuwa ją z oferty.",
      },
      check: {
        q: "Skąd bierze się cyfra kontrolna SSCC?",
        a: "Wtyczka liczy ją według GS1-128 z numeru seryjnego palety, bez zapisywania czegokolwiek. /admin/packaging/sscc zwraca numer etykiety.",
      },
      demo: {
        q: "Czy tryb demo coś wysyła na zewnątrz?",
        a: "Nie. Demo to wyłącznie przykładowe drabinki w bazie.",
      },
    },
  },
  community: communityPl,
  integration: integrationPl,
}

const samePolishKeys: typeof en = pl
void samePolishKeys

/* Polish typography: no one-letter word left at the end of a line. */
export default typeset(pl)
