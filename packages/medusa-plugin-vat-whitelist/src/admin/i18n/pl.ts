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
  subtitle: "Sprawdź polski NIP w rejestrze REGON GUS i białej liście Ministerstwa Finansów, a numery VAT UE w VIES: dane firmy, czy działa, status VAT, numery kont do podzielonej płatności i historia weryfikacji.",
  points: {
    nip: "NIP: GUS i biała lista MF",
    vies: "VAT UE: VIES",
    accounts: "Konta do podzielonej płatności",
    fresh: "Odpowiedź ważna {{hours}} h",
    history: "Historia weryfikacji",
  },
  mode: {
    demo: "Demo",
    demoTitle: "Tryb demo",
    demoText: "Symulowane odpowiedzi rejestrów z flagą demo. Żaden zewnętrzny serwis nie jest odpytywany.",
    demoLiveText: "Numery przykładowe odpowiadają symulowanymi danymi z flagą demo. Każdy inny numer pyta prawdziwe rejestry: {{registries}}.",
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
    notFoundHint: "Brak w rejestrze albo zamknięta",
  },
  check: {
    title: "Sprawdź kontrahenta",
    points: {
      nip: "10 cyfr: GUS i biała lista",
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
      problem: "Brak, zamknięta albo błędny",
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
    inactive: "Zamknięta",
    not_found: "Nie znaleziono",
    invalid: "Błędny",
    unavailable: "Niedostępny",
  },
  activity: {
    active: "Działa",
    suspended: "Zawieszona",
    closed: "Zakończona",
  },
  result: {
    active: "{{name}}: czynny podatnik VAT",
    exempt: "{{name}}: zwolniony z VAT",
    inactive: "{{name}}: działalność zawieszona albo zakończona",
    not_found: "{{name}}: nie ma w rejestrze",
    invalid: "Numer nie przechodzi walidacji",
    unavailable: "Rejestr nie odpowiedział, spróbuj za chwilę",
    title: "Wynik weryfikacji",
    accounts: "Konta z rejestru",
    krs: "KRS",
    regon: "REGON",
    since: "od {{date}}",
  },
  registries: {
    lead: "Rejestry, w których sprawdzamy numer: GUS i biała lista MF dla polskiego NIP-u, VIES dla numerów VAT UE.",
    points: {
      pl: "NIP: w tej kolejności",
      eu: "VAT UE: VIES",
      test: "Test tylko się loguje",
    },
    order: "Krok {{n}} dla NIP-u",
    reason: "Brak odpowiedzi: {{reason}}",
    mode: {
      live: "Na żywo",
      demo: "Symulacja",
      missing_key: "Brak klucza",
      off: "Nieużywany",
    },
    gus: {
      name: "Rejestr REGON GUS (BIR 1.1)",
      gives: "Firma: pełna nazwa, adres, REGON, KRS, forma prawna, data rozpoczęcia i to, czy działalność trwa, jest zawieszona albo zakończona.",
      when: "Pytany jako pierwszy o polski NIP. Bezpłatny, z kluczem użytkownika od GUS.",
      missing: "Bez klucza GUS jest pomijany. Wpisz klucz w GUS_API_KEY albo zacznij od środowiska testowego GUS.",
      keySet: "Klucz ustawiony",
      keyMissing: "Brak klucza",
      env: {
        production: "Produkcja",
        test: "Środowisko testowe",
      },
    },
    whitelist: {
      name: "Biała lista MF",
      gives: "Status VAT (Czynny, Zwolniony), numery kont do podzielonej płatności, data rejestracji.",
      when: "Pytana o polski NIP po GUS. Bez klucza; API MF ma dzienny limit wyszukiwań.",
      missing: "",
    },
    vies: {
      name: "VIES (Komisja Europejska)",
      gives: "Czy numer VAT UE jest ważny, oraz nazwa i adres, jeśli państwo członkowskie je udostępnia.",
      when: "Pytany o każdy numer z prefiksem kraju (DE, FR, NL...). O polski NIP tylko, gdy plRegistries zawiera vies albo numer ma prefiks PL.",
      missing: "",
    },
    test: {
      run: "Testuj połączenie",
      ok: "Działa ({{ms}} ms)",
      fail: "Nie działa",
      messages: {
        missing_key: "Brak klucza GUS.",
        timeout: "Rejestr nie odpowiedział na czas.",
        network: "Brak połączenia z rejestrem.",
        "GUS refused the key": "GUS odrzucił klucz. Sprawdź GUS_API_KEY i środowisko (produkcja albo test).",
        vies_down: "VIES zgłasza niedostępność.",
      },
    },
  },
  settings: {
    title: "Ustawienia",
    subtitle: "Opcje w użyciu, tylko do odczytu. Ustawia się je w medusa-config.ts.",
    tab: {
      registries: "Rejestry",
      options: "Opcje",
    },
    points: {
      readOnly: "Tylko odczyt",
      config: "medusa-config.ts",
    },
    staleHours: "Ważność odpowiedzi",
    hours: "{{count}} h",
    plRegistries: "Polski NIP",
    euRegistry: "Numer VAT UE",
    live: "Na żywo w trybie demo",
    timeout: "Limit czasu rejestru",
    seconds: "{{count}} s",
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
      text: "Instalujesz wtyczkę, rejestrujesz ją, uruchamiasz migracje, dodajesz klucz GUS, otwierasz panel. Formularz rejestracji i konto klienta same sprawdzają NIP.",
      time: "ok. 15 minut",
      timeLabel: "Czas",
      needsLabel: "Potrzebujesz",
      needs: {
        medusa: "Medusa 2.12 lub nowsza",
        gus: "Klucz użytkownika GUS BIR 1.1 (bezpłatny, na e-mail)",
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
      gus: {
        title: "Dodaj klucz GUS",
        p1: "GUS podaje dane firmy, do której należy NIP. Klucz użytkownika usługi BIR 1.1 jest bezpłatny: poproś o niego mailem na regon_bir@stat.gov.pl, podając nazwę firmy, NIP i cel; przychodzi w kilka dni.",
        p2: "Wpisz go w zmienne środowiskowe, nigdy w kod, i przekaż jako gusApiKey. Zanim przyjdzie, gusEnvironment: \"test\" używa środowiska testowego GUS i jego publicznego klucza.",
        p3: "Ustawienia / Rejestry pokazują, czy klucz jest ustawiony, i testują połączenie: logowanie i wylogowanie, bez zużywania wyszukiwań.",
        check: "Testuj połączenie przy GUS odpowiada Działa.",
      },
      demo: {
        title: "Tryb demo (opcjonalnie)",
        p1: "Tylko po włączeniu: symulowane odpowiedzi rejestrów z flagą demo, nic nie wychodzi poza serwer.",
        p2: "WHITELIST_DEMO=true w .env, nigdy w kodzie.",
        check: "W nagłówku widać plakietkę Demo.",
      },
      first: {
        title: "Sprawdź pierwszy NIP",
        p1: "Wpisz NIP w Sprawdź kontrahenta. Karta pokazuje firmę z GUS, status VAT z białej listy i to, co odpowiedział każdy rejestr.",
        check: "Kontrahent pojawia się na liście.",
      },
      eu: {
        title: "Sprzedaż w UE (opcjonalnie)",
        p1: "Numery z prefiksem kraju zawsze idą do VIES. Przy polskim nabywcy w dostawie wewnątrzwspólnotowej dopisz vies do plRegistries: VIES potwierdzi wtedy rejestrację VAT-UE obok białej listy.",
        p2: "Formularz sklepu dla danego kraju może wysłać numer bez prefiksu razem z kodem kraju; prefiks dopisze wtyczka.",
        check: "Numer DE albo FR pokazuje VIES w historii weryfikacji.",
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
      gus: "Klucz GUS ustawiony, środowisko produkcyjne działa",
    },
    faq: {
      title: "Pytania",
      gus: {
        q: "Dlaczego GUS przed białą listą?",
        a: "GUS zna każdą firmę, płatnika VAT czy nie, z formą prawną i informacją, czy jeszcze działa. Biała lista zna tylko podatników VAT i ma dzienny limit wyszukiwań. Razem: firma z GUS, status VAT i konta z białej listy. Działalność zawieszona albo zakończona dostaje status Zamknięta, cokolwiek mówi biała lista.",
      },
      eu: {
        q: "Czy weryfikacja działa też dla firm z UE?",
        a: "Tak. Numery z prefiksem kraju sprawdza VIES. Część państw (Niemcy, Hiszpania) potwierdza tylko ważność numeru, bez nazwy firmy. Każda odpowiedź zostaje w historii.",
      },
      often: {
        q: "Jak często wtyczka pyta rejestry?",
        a: "Sprawdzenie jest ważne staleHours (domyślnie 24). Następne pytanie o ten numer po tym czasie odpytuje rejestr ponownie.",
      },
      demo: {
        q: "Czy tryb demo coś wysyła na zewnątrz?",
        a: "Domyślnie nie: demo to symulowane odpowiedzi w bazie. Z opcją live wskazane rejestry odpowiadają naprawdę dla każdego numeru spoza przykładów, więc publiczne demo może pokazać prawdziwe dane firm.",
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
