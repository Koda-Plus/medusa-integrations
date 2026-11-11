import type en from "./en"
import { typeset } from "../lib/ceneo-typeset"
import { communityPl } from "../lib/ceneo-kit-community"

/* Typed by en.ts below (every English key exists here). */
const pl = {
  nav: "Ceneo",
  title: "Ceneo",
  view: {
    panel: "Panel",
    guide: "Przewodnik wdrożenia",
    settings: "Ustawienia",
  },
  by: "by Koda Plus",
  subtitle: "Twój katalog na Ceneo: plik XML z ofertami, kategoriami i atrybutami Ceneo, problemy, przez które produkt nie trafia do porównywarki, Zaufane Opinie po każdym zamówieniu, zamówienia Kup Teraz w Medusie i stawki CPC, na jednej stronie.",
  points: {
    feed: "Plik XML z katalogu",
    problems: "Problemy per wariant",
    reviews: "Zaufane Opinie",
    orders: "Zamówienia Kup Teraz",
    bids: "Stawki CPC",
  },
  mode: {
    demo: "Demo",
    demoTitle: "Tryb demo",
    demoText: "API Ceneo jest symulowane, a jego wiersze mają oznaczenie demo. Plik XML powstaje z prawdziwego katalogu, tak jak przeczyta go Ceneo.",
  },
  actions: {
    refresh: "Odśwież",
    openFeed: "Otwórz plik",
    more: "Więcej akcji",
    build: "Zbuduj teraz",
  },
  loading: "Wczytuję Ceneo",
  error: "Nie udało się wczytać strony: {{message}}",
  toast: {
    refreshed: "Odświeżono",
    error: "Coś poszło nie tak: {{error}}",
    copied: "Skopiowano",
    built: "Plik zbudowany, ofert w pliku: {{offers}}",
    builtSame: "Plik zbudowany bez zmian, ofert: {{offers}}",
    buildFailed: "Budowa się nie udała, Ceneo dostaje poprzedni plik: {{error}}",
    buildRunning: "Budowa już trwa",
    buildGaps: "Plik czeka jeszcze na ustawienia",
  },
  stats: {
    offers: "Oferty",
    offersHint: "Warianty znane Ceneo",
    ok: "W pliku",
    okHint: "Nic do poprawy",
    problems: "Problemy",
    problemsHint: "Poza plikiem do czasu poprawki",
    build: "Ostatni plik",
    buildHint: "Ofert w pliku: {{count}}",
    never: "Jeszcze nie zbudowany",
  },
  feed: {
    title: "Plik z ofertami",
    points: {
      address: "Wklej adres w Panelu Ceneo",
      schedule: "Budowany co {{minutes}} min",
      same: "Ten sam plik do kolejnej budowy",
    },
    address: "Adres pliku",
    copy: "Kopiuj",
    notReady: "Plik nie jest jeszcze udostępniany",
    gaps: {
      token: "Ustaw feed.token: od 16 do 128 liter, cyfr, - lub _ (openssl rand -hex 24).",
      token_rejected: "feed.token jest ustawiony, ale nie pasuje: od 16 do 128 liter, cyfr, - lub _.",
      product_url: "Ustaw feed.productUrl: adres strony produktu w sklepie z {handle}, {product_id}, {variant_id} albo {sku}.",
      product_url_rejected: "feed.productUrl jest ustawiony, ale to nie jest adres http(s) z {handle}, {product_id}, {variant_id} albo {sku}.",
    },
    last: "Ostatnia udana budowa",
    none: "Jeszcze nic nie zbudowano. Pierwsza budowa ruszy zgodnie z harmonogramem, gdy plik będzie miał wszystko, czego potrzebuje.",
    failed: "Najnowsza budowa się nie udała, Ceneo dostaje poprzedni plik: {{error}}",
    built: "{{date}}, ofert: {{offers}}, {{size}}, {{ms}} ms",
  },
  settings: {
    title: "Ustawienia",
    subtitle: "Opcje w użyciu, odczytane z medusa-config.ts. Zmieniasz je tam i restartujesz Medusę.",
    tab: {
      feed: "Plik XML",
      connections: "Połączenia",
    },
    points: {
      readOnly: "Tylko do odczytu",
      config: "Ustawiane w medusa-config.ts",
    },
    productUrl: "Adres produktu",
    region: "Region cen",
    salesChannel: "Kanał sprzedaży",
    defaultValue: "Domyślny",
    offerId: "Id oferty",
    offerIdValue: {
      variant_id: "Id wariantu",
      sku: "SKU",
    },
    inStock: "Na stanie",
    backorder: "Na zamówienie",
    outOfStock: "Brak na stanie",
    outOfStockValue: {
      skip: "Poza plikiem",
      check: "avail 99, sprawdź w sklepie",
    },
    interval: "Budowa co",
    minutes: "{{count}} min",
    demo: "Tryb demo",
    on: "Włączony",
    off: "Wyłączony",
    reviews: "Zaufane Opinie",
    reviewsValue: {
      on: "GUID konta ustawiony",
      off: "Brak GUID konta",
      rejected: "accountGuid to nie jest GUID",
    },
    workDays: "Ankieta po",
    workDaysValue_one: "{{count}} dniu roboczym",
    workDaysValue_few: "{{count}} dniach roboczych",
    workDaysValue_many: "{{count}} dniach roboczych",
    workDaysValue_other: "{{count}} dniach roboczych",
    workDaysNow: "Od razu po zamówieniu",
    workDaysCeneo: "Decyduje Ceneo",
    api: "API Ceneo",
    apiValue: {
      live: "Klucz API ustawiony",
      demo: "Symulowane",
      missing_key: "Brak klucza API",
    },
    timeout: "Limit czasu wywołania",
    seconds: "{{count}} s",
  },
  avail: {
    "1": "1, wysyłka w 24 h",
    "3": "3, do 3 dni",
    "7": "7, do tygodnia",
    "14": "14, do 14 dni",
    "90": "90, na zamówienie",
    "99": "99, sprawdź w sklepie",
    "110": "110, przedsprzedaż",
  },
  guide: {
    intro: {
      title: "Przewodnik wdrożenia",
      text: "Plik XML działa w każdym sklepie: Ceneo czyta jeden plik pod adresem, który znasz tylko Ty. Zaufane Opinie potrzebują GUID konta z Panelu Ceneo, a Kup Teraz i stawki CPC klucza API Ceneo, który Ceneo wydaje sklepom już u siebie obecnym.",
      time: "Około 20 minut na plik XML",
      timeLabel: "Czas",
      needsLabel: "Potrzebujesz",
      needs: {
        medusa: "Medusa 2.12 lub nowsza z regionem w PLN",
        storefront: "Sklep ze stronami produktów",
        panel: "Konto w Panelu Ceneo (biznes.ceneo.pl)",
      },
    },
    stepsTitle: "Kroki",
    stepsSubtitle: "Każdy krok odczytuje swój stan z działającego sklepu.",
    state: {
      done: "Gotowe",
      todo: "Do zrobienia",
      optional: "Opcjonalnie",
      later: "Później",
    },
    checkLabel: "Jak sprawdzić",
    copy: "Kopiuj",
    copied: "Skopiowano",
    steps: {
      install: {
        title: "Zainstaluj plugin",
        p1: "Dodaj pakiet do backendu Medusy i uruchom migracje: plugin trzyma budowy pliku i oferty we własnych tabelach.",
        p2: "Admin dostaje tę stronę w sekcji Extensions, po polsku i po angielsku.",
        check: "Ta strona się otwiera.",
      },
      config: {
        title: "Dodaj go do medusa-config.ts",
        p1: "Każda opcja jest opcjonalna i żadna nie zatrzyma startu Medusy. Sekrety trafiają do .env, nigdy do repozytorium.",
        check: "Zakładka Ustawienia pokazuje ustawione opcje.",
      },
      token: {
        title: "Ustaw token pliku",
        p1: "Ceneo czyta plik bez hasła, więc adres zawiera tajny token. Kto zna adres, zobaczy plik: to Twój publiczny katalog, ale adres zostaw dla Ceneo.",
        p2: "Wygeneruj go poleceniem openssl rand -hex 24 i wpisz do .env.",
        check: "Panel pokazuje adres pliku.",
      },
      productUrl: {
        title: "Wskaż, gdzie są produkty",
        p1: "Ceneo kieruje kupujących pod adres każdej oferty. Podaj adres strony produktu w sklepie ze znacznikami: {handle}, {product_id}, {variant_id}, {sku}.",
        check: "Karta pliku nie ostrzega o adresie produktu.",
      },
      region: {
        title: "Wybierz region i kanał sprzedaży",
        p1: "Ceny pochodzą z jednego regionu w PLN, produkty z jednego kanału sprzedaży. Bez tych opcji plugin bierze pierwszy region w PLN i domyślny kanał sprzedaży.",
        check: "Ustawienia pokazują oczekiwany region i kanał.",
      },
      panel: {
        title: "Dodaj plik w Panelu Ceneo",
        p1: "W Panelu Ceneo wklej adres pliku jako plik ofert sklepu. Częstotliwość odczytu ustawia Ceneo, zapytaj o nią opiekuna konta w Ceneo.",
        check: "Panel Ceneo pokazuje Twoje oferty po kolejnym odczycie.",
      },
      demo: {
        title: "Wypróbuj w trybie demo",
        p1: "demo: true symuluje API Ceneo (zamówienia Kup Teraz, stawki) z wierszami oznaczonymi jako demo. Plik XML w obu trybach powstaje z prawdziwego katalogu.",
        check: "Przy tytule widać oznaczenie Demo.",
      },
    },
    checklist: {
      title: "Przed startem",
      subtitle: "Co powinien mieć sklep na Ceneo.",
      address: "Adres pliku jest ustawiony i udostępniany",
      built: "Budowa pliku się udała",
      problems: "Żaden wariant nie wypadł z pliku przez nieoczekiwany problem",
      demoOff: "Tryb demo jest wyłączony",
    },
    faq: {
      title: "Pytania",
      why: {
        q: "Dlaczego plik powstaje według harmonogramu, a nie przy każdym zapytaniu?",
        a: "Ceneo musi dostawać ten sam plik między dwiema budowami, a odczyt dużego katalogu trwa. Trasa tylko serwuje najnowszą udaną budowę, więc wolne zapytanie nigdy nie przekroczy czasu Ceneo, a nieudana budowa zostawia poprzedni plik.",
      },
      ids: {
        q: "Dlaczego id oferty to id wariantu?",
        a: "Ceneo zabrania nadawania raz użytego id innemu produktowi. Id wariantu się nie zmienia, SKU może. Sklepy przechodzące ze starszego pliku z SKU jako id ustawiają offerId: \"sku\".",
      },
      secret: {
        q: "Czy adres pliku jest tajny?",
        a: "Tylko przed zgadywaniem. Plik zawiera to, co i tak pokazuje sklep: nazwy, ceny, dostępność. Token odcina roboty, a adres zmienisz, zmieniając token.",
      },
    },
  },
  community: communityPl,
}

const samePolishKeys: typeof en = pl
void samePolishKeys

/* Polish typography: no one-letter word left at the end of a line. */
export default typeset(pl)
