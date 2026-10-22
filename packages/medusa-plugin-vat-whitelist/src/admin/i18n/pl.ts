import type en from "./en"
import { typeset } from "../lib/whitelist-typeset"
import { communityPl } from "../lib/whitelist-kit-community"
import { integrationPl } from "../../modules/whitelist/lib/integration-texts"

/* Typed by en.ts below (every English key exists here). */
const pl = {
  nav: "Biała lista",
  title: "Biała lista VAT",
  view: {
    panel: "Panel",
    guide: "Przewodnik wdrożenia",
    settings: "Ustawienia",
  },
  by: "by Koda Plus",
  subtitle: "Sprawdź polski NIP w białej liście Ministerstwa Finansów i numery VAT UE w VIES: status VAT, numery kont do podzielonej płatności i historia weryfikacji.",
  points: {
    nip: "NIP: biała lista MF",
    vies: "VAT UE: VIES",
    accounts: "Konta do podzielonej płatności",
    fresh: "Odpowiedź ważna {{hours}} h",
    history: "Historia weryfikacji",
  },
  mode: {
    demo: "Demo",
    demoTitle: "Tryb demo",
    demoText: "Symulowane odpowiedzi rejestrów z flagą demo. Żaden zewnętrzny serwis nie jest odpytywany.",
  },
  actions: {
    refresh: "Odśwież",
    check: "Sprawdź NIP",
    customers: "Klienci",
    more: "Więcej akcji",
  },
  loading: "Wczytuję białą listę",
  error: "Nie udało się wczytać strony: {{message}}",
  stats: {
    entities: "Kontrahenci",
    entitiesHint: "Sprawdzone numery",
    active: "Czynni VAT",
    activeHint: "Na białej liście",
    exempt: "Zwolnieni",
    exemptHint: "Bez VAT na fakturze",
    notFound: "Nie znaleziono",
    notFoundHint: "Brak w rejestrze",
  },
  check: {
    title: "Sprawdź kontrahenta",
    points: {
      nip: "10 cyfr: biała lista",
      vat: "Prefiks kraju: VIES",
      fresh: "Ważne {{hours}} h",
    },
    number: "Numer",
    placeholder: "NIP albo numer VAT UE",
    run: "Sprawdź",
  },
  entities: {
    title: "Kontrahenci",
    points: {
      latest: "Ostatnia odpowiedź na numer",
      recheck: "Strzałka sprawdza ponownie",
      customer: "NIP otwiera klienta",
    },
    search: "NIP, nazwa, adres",
    filter: {
      all: "Wszyscy",
      active: "Czynni",
      exempt: "Zwolnieni",
      problem: "Brak albo błędny",
      stale: "Nieaktualni",
    },
    empty: "Jeszcze nic nie sprawdzono",
    emptyHint: "Wpisz NIP powyżej",
    emptySearch: "Żaden kontrahent nie pasuje",
    nip: "NIP",
    name: "Nazwa",
    state: "Status",
    accounts: "Konta",
    checked: "Sprawdzony",
    stale: "Nieaktualny",
    recheck: "Sprawdź ponownie",
    openCustomer: "Otwórz klienta",
    accountsCount: "{{count}}",
  },
  checks: {
    title: "Historia weryfikacji",
    points: {
      newest: "Najnowsze na górze",
      every: "Każde sprawdzenie zapisane",
    },
    empty: "Jeszcze bez weryfikacji",
    when: "Kiedy",
    nip: "Numer",
    source: "Rejestr",
    state: "Odpowiedź",
  },
  source: {
    whitelist: "Biała lista (MF)",
    vies: "VIES",
    gus: "GUS (REGON)",
  },
  state: {
    active: "Czynny",
    exempt: "Zwolniony",
    not_found: "Nie znaleziono",
    invalid: "Błędny",
    unavailable: "Niedostępny",
  },
  result: {
    active: "{{name}}: czynny podatnik VAT",
    exempt: "{{name}}: zwolniony z VAT",
    not_found: "{{name}}: nie ma w rejestrze",
    invalid: "Numer nie przechodzi walidacji",
    unavailable: "Rejestr nie odpowiedział, spróbuj za chwilę",
    title: "Wynik weryfikacji",
    accounts: "Konta z rejestru",
    krs: "KRS",
    regon: "REGON",
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
    staleHours: "Ważność odpowiedzi",
    hours: "{{count}} h",
    sources: "Rejestry",
    demo: "Tryb demo",
    on: "Włączony",
    off: "Wyłączony",
  },
  toast: {
    refreshed: "Odświeżono",
    error: "Coś poszło nie tak: {{error}}",
  },
  guide: {
    intro: {
      title: "Wdrożenie krok po kroku",
      text: "Instalujesz wtyczkę, rejestrujesz ją, uruchamiasz migracje, otwierasz panel. Formularz rejestracji i konto klienta same sprawdzają NIP.",
      time: "ok. 15 minut",
      timeLabel: "Czas",
      needsLabel: "Potrzebujesz",
      needs: {
        medusa: "Medusa 2.12 lub nowsza",
        gus: "Klucz GUS BIR 1.1, tylko produkcja",
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
        p2: "Migracje tworzą whitelist_entity i whitelist_check.",
        check: "Białą listę widać w bocznym menu admina.",
      },
      config: {
        title: "Zarejestruj w medusa-config.ts",
        p1: "Dodaj wpis do listy plugins, nie ruszając reszty. Każda opcja ma wartość domyślną.",
        check: "Panel wczytuje się bez błędu.",
      },
      demo: {
        title: "Tryb demo (opcjonalnie)",
        p1: "Tylko po włączeniu: symulowane odpowiedzi rejestrów z flagą demo, nic nie wychodzi poza serwer.",
        p2: "WHITELIST_DEMO=true w .env, nigdy w kodzie.",
        check: "W nagłówku widać plakietkę Demo.",
      },
      first: {
        title: "Sprawdź pierwszy NIP",
        p1: "Wpisz NIP w Sprawdź kontrahenta. W trybie produkcyjnym podaj klucz GUS w opcjach.",
        check: "Kontrahent pojawia się na liście.",
      },
      store: {
        title: "Podepnij sklep",
        p1: "/store/whitelist/preview sprawdza NIP przy rejestracji firmy, /store/whitelist/me pokazuje status na koncie.",
        check: "Formularz rejestracji pokazuje nazwę firmy.",
      },
    },
    checklist: {
      title: "Lista przed startem",
      subtitle: "Wszystko odhaczone: kontrahenci sprawdzeni od rejestracji do zamówienia.",
      preview: "Rejestracja podgląda firmę przed akceptacją",
      status: "Status VAT widoczny przy kontrahencie",
      stale: "Stare sprawdzenia odświeżane po staleHours",
      gus: "Klucz GUS BIR 1.1 ustawiony na produkcji",
    },
    faq: {
      title: "Pytania",
      eu: {
        q: "Czy weryfikacja działa też dla firm z UE?",
        a: "Tak. Numery z prefiksem kraju sprawdza VIES, polskie biała lista MF, dane rejestrowe GUS. Każda odpowiedź zostaje w historii.",
      },
      often: {
        q: "Jak często wtyczka pyta rejestry?",
        a: "Sprawdzenie jest ważne staleHours (domyślnie 24). Następne pytanie o ten numer po tym czasie odpytuje rejestr ponownie.",
      },
      demo: {
        q: "Czy tryb demo coś wysyła na zewnątrz?",
        a: "Nie. Demo to wyłącznie symulowane odpowiedzi w bazie.",
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
