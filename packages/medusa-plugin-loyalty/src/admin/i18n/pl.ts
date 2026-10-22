import type en from "./en"
import { typeset } from "../lib/loyalty-typeset"
import { communityPl } from "../lib/loyalty-kit-community"
import { integrationPl } from "../../modules/loyalty/lib/integration-texts"

/* Typed by en.ts below (every English key exists here). */
const pl = {
  nav: "Lojalność",
  title: "Lojalność",
  view: {
    panel: "Panel",
    guide: "Przewodnik wdrożenia",
    settings: "Ustawienia",
  },
  by: "by Koda Plus",
  subtitle: "Punkty za każde zamówienie: {{pointsPerPln}} punkt za 1,00, punkt wart {{redeemRate}}, drabinka nagród i historia wykupów.",
  points: {
    earn: "{{count}} pkt za 1,00",
    worth: "1 pkt = {{value}}",
    ladder: "Drabinka nagród",
    manual: "Ręczne korekty",
    ledger: "Pełna historia",
  },
  mode: {
    demo: "Demo",
    demoTitle: "Tryb demo",
    demoText: "Przykładowe konta i transakcje z flagą demo. Nic nie wychodzi poza serwer.",
  },
  actions: {
    refresh: "Odśwież",
    adjust: "Koryguj punkty",
    customers: "Klienci",
    more: "Więcej akcji",
  },
  loading: "Wczytuję lojalność",
  error: "Nie udało się wczytać strony: {{message}}",
  stats: {
    accounts: "Konta",
    accountsHint: "Z kontem punktów",
    points: "Punktów w obiegu",
    pointsHint: "Saldo wszystkich kont",
    redeemed: "Wykupionych punktów",
    redeemedHint: "Od początku",
    ready: "Gotowi na nagrodę",
    readyHint: "Saldo ponad pierwszą nagrodę",
  },
  rewards: {
    title: "Drabinka nagród",
    points: {
      balance: "Odblokowuje saldo",
      account: "Widoczna na koncie klienta",
    },
    at: "{{count}} pkt",
  },
  adjust: {
    title: "Koryguj punkty",
    points: {
      plus: "Plus = bonus",
      minus: "Minus = korekta",
      reason: "Powód obowiązkowy",
    },
    customer: "Klient",
    customerPlaceholder: "Nazwa albo e-mail",
    clear: "Wybierz innego klienta",
    delta: "Punkty",
    deltaPlaceholder: "+500 albo -100",
    reason: "Powód",
    reasonPlaceholder: "np. reklamacja, bonus za duże zamówienie",
    save: "Koryguj",
  },
  accounts: {
    title: "Konta punktów",
    points: {
      balance: "Saldo i sumy",
      tier: "Mnożnik tieru",
      row: "Nazwa otwiera klienta",
    },
    search: "Nazwa, e-mail, ID klienta",
    filter: {
      all: "Wszystkie",
      ready: "Gotowi na nagrodę",
    },
    empty: "Nie ma jeszcze kont",
    emptyHint: "Pierwsze zamówienie zakłada konto",
    emptySearch: "Żadne konto nie pasuje",
    customer: "Klient",
    balance: "Saldo",
    earned: "Zebrane",
    redeemed: "Wykupione",
    tier: "Tier",
    open: "Otwórz klienta",
  },
  transactions: {
    title: "Transakcje",
    points: {
      newest: "Najnowsze na górze",
      orders: "Naliczane z zamówień",
      manual: "Ręczne z powodem",
    },
    filter: {
      all: "Wszystkie",
      plus: "Dodane",
      minus: "Odjęte",
    },
    empty: "Nie ma jeszcze transakcji",
    when: "Kiedy",
    kind: "Rodzaj",
    delta: "Punkty",
    reason: "Powód",
    openOrder: "Otwórz zamówienie",
  },
  kind: {
    earn_order: "Zamówienie",
    redeem: "Wykup",
    bonus: "Bonus",
    adjust: "Korekta",
    expire: "Wygasły",
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
    earn: "Punkty za 1,00",
    worth: "Wartość punktu",
    rewards: "Drabinka nagród",
    rewardsNone: "Brak nagród",
    demo: "Tryb demo",
    on: "Włączony",
    off: "Wyłączony",
  },
  toast: {
    saved: "Zapisano",
    refreshed: "Odświeżono",
    error: "Coś poszło nie tak: {{error}}",
  },
  guide: {
    intro: {
      title: "Wdrożenie krok po kroku",
      text: "Instalujesz wtyczkę, rejestrujesz ją, uruchamiasz migracje, otwierasz panel. Sklep pokazuje saldo i wymienia punkty na rabaty.",
      time: "ok. 15 minut",
      timeLabel: "Czas",
      needsLabel: "Potrzebujesz",
      needs: {
        medusa: "Medusa 2.12 lub nowsza",
        ladder: "Drabinka nagród do wyboru",
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
        p2: "Migracje tworzą loyalty_account i loyalty_transaction, istniejące tylko uzupełniają o flagę demo.",
        check: "Lojalność widać w bocznym menu admina.",
      },
      config: {
        title: "Zarejestruj w medusa-config.ts",
        p1: "Dodaj wpis do listy plugins, nie ruszając reszty. Każda opcja ma wartość domyślną.",
        check: "Panel wczytuje się bez błędu.",
      },
      values: {
        title: "Ustaw wartość punktu i nagrody",
        p1: "pointsPerPln: punkty za 1,00 wartości zamówienia. redeemRate: wartość jednego punktu (0.05 = 100 punktów za 5,00).",
        p2: "Nagrody to drabinka widoczna na koncie klienta. LOYALTY_DEMO=true w .env daje najpierw dane przykładowe.",
        check: "Ustawienia pokazują Twoje wartości.",
      },
      open: {
        title: "Otwórz panel",
        p1: "Pierwsze punkty naliczą się z zamówieniem. Korekty ręcznie, z powodem.",
        check: "Po pierwszym zamówieniu pojawia się konto.",
      },
      store: {
        title: "Podepnij sklep",
        p1: "/store/loyalty/me pokazuje saldo na koncie klienta, /store/loyalty/redeem wymienia punkty na rabat.",
        check: "Klient widzi saldo i drabinkę.",
      },
    },
    checklist: {
      title: "Lista przed startem",
      subtitle: "Wszystko odhaczone: program działa od pierwszego zamówienia.",
      accrue: "Punkty naliczają się z każdym złożonym zamówieniem",
      account: "Klient widzi saldo i drabinkę nagród",
      redeem: "Wymiana od razu odejmuje punkty, rabat trafia do koszyka",
      adjust: "Ręczna korekta z powodem działa w panelu",
    },
    faq: {
      title: "Pytania",
      when: {
        q: "Kiedy punkty trafiają na konto?",
        a: "Gdy zamówienie zostaje złożone. Workflow order.placed nalicza punkty od wartości netto i zapisuje transakcję earn.",
      },
      change: {
        q: "Czy mogę zmienić wartość punktu później?",
        a: "Tak, w medusa-config.ts. Działa od następnych zamówień, historia zostaje bez zmian.",
      },
      demo: {
        q: "Czy tryb demo coś wysyła na zewnątrz?",
        a: "Nie. Demo to wyłącznie przykładowe konta i transakcje w bazie.",
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
