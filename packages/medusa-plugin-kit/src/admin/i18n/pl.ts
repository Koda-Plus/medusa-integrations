import type en from "./en"
import { typeset } from "../lib/kit-typeset"
import { communityPl } from "../lib/kit-kit-community"
import { integrationPl } from "../../modules/kit/lib/integration-texts"

/* Typed by en.ts below (every English key exists here). */
const pl = {  nav: "Kit",
  title: "Kit",
  by: "od Koda Plus",
  subtitle: "Newsletter sklepu na liście Kita: formularz zapisuje klientów z tagami i podwójnym potwierdzeniem, log pokazuje każdy zapis.",
  view: {
    panel: "Panel",
    guide: "Przewodnik wdrożenia",
  },
  error: "Nie udało się wczytać strony: {{message}}",
  mode: {
    off: "Brak konfiguracji",
  },
  stats: {
    subscribed: "Zapisów ze sklepu",
    failed: "Nieudanych zapisów",
    week: "Zapisów, ostatnie 7 dni",
    account: "Konto Kita",
  },
  account: {
    none: "Nie ma jeszcze konta - dodaj klucz API.",
    plan: "Plan {{plan}}",
  },
  status: {
    configured: "Połączono",
    unconfigured: "Brak klucza API Kita - formularz odpowiada grzecznie i nic nie wysyła.",
    missing: "Brakuje: {{what}}",
    problems: "Zignorowane opcje: {{what}}",
  },
  settings: {
    title: "Ustawienia listy",
    subtitle: "Co dostaje każdy nowy subskrybent. Zapisane tutaj, per sklep.",
    tags: "Tagi",
    tagsHint: "Nakładane na każdego nowego subskrybenta (Kit: tagi).",
    tagsEmpty: "Konto nie ma jeszcze tagów - utwórz je najpierw w Kicie.",
    form: "Formularz podwójnego potwierdzenia",
    formHint: "Przy podwójnym potwierdzeniu nowy subskrybent trafia do tego formularza i Kit wysyła maila z potwierdzeniem.",
    formNone: "Nie wybrano formularza potwierdzenia.",
    doubleOptIn: "Podwójne potwierdzenie",
    doubleOptInHint: "Subskrybent czeka na maila z potwierdzeniem, zanim cokolwiek otrzyma.",
    save: "Zapisz",
    saved: "Zapisano",
    saving: "Zapisywanie...",
  },
  subscribers: {
    title: "Log zapisów",
    subtitle: "Każdy zapis, który formularz sklepu wysłał do Kita.",
    empty: "Nikt się jeszcze nie zapisał.",
    email: "E-mail",
    state: "Stan",
    tags: "Tagi",
    source: "Źródło",
    when: "Kiedy",
    statusOk: "ok",
    statusFailed: "błąd",
    stateActive: "aktywny",
    stateInactive: "czeka na potwierdzenie",
    stateNone: "-",
  },
  check: {
    title: "Sprawdzenie połączenia",
    run: "Sprawdź połączenie",
    running: "Sprawdzanie...",
    ok: "Konto odpowiada: {{name}}",
    tags: "{{n}} tagów",
    forms: "{{n}} formularzy",
  },
  guide: {
    steps: [
      "W Kicie otwórz Ustawienia, Developer, klucze API i utwórz klucz API V4. Wstaw go do KIT_API_KEY na backendzie.",
      "Utwórz tagi dla sklepu (np. sklep, klub-stonerow) w Kicie: Subskrybenci, Tagi.",
      "Do podwójnego potwierdzenia utwórz w Kicie formularz osadzany z włączonym podwójnym potwierdzeniem.",
      "W Ustawieniach wybierz tagi i formularz, zapisz i zapisz się testowo z formularza.",
    ],
  },
  community: communityPl,
  integration: integrationPl,
}

/* Typed by en.ts: every English key must exist here (noUnusedLocals reads it). */
const samePolishKeys: typeof en = pl
void samePolishKeys

export default typeset(pl)
