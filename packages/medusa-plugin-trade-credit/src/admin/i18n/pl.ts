import type en from "./en"
import { typeset } from "../lib/credit-typeset"
import { communityPl } from "../lib/credit-kit-community"
import { integrationPl } from "../../modules/credit/lib/integration-texts"

/* Typed by en.ts below (every English key exists here). */
const pl = {
  nav: "Kredyt",
  title: "Kredyt kupiecki",
  view: {
    panel: "Panel",
    guide: "Przewodnik wdrożenia",
  },
  by: "by Koda Plus",
  subtitle: "Limity kredytowe i terminy płatności dla klientów B2B: net 14, 30 albo 60 dni, wykorzystana kwota z niezapłaconych zamówień, kontrola przeterminowania i przełącznik blokady.",
  mode: {
    demo: "Demo",
  },
  error: "Nie udało się wczytać strony: {{message}}",
  stats: {
    limits: "Limity",
    used: "Wykorzystane łącznie",
    overdue: "Po terminie",
    blocked: "Do sprawdzenia",
  },
  set: {
    title: "Ustaw warunki kredytu",
    subtitle: "Wybierz klienta, ustaw limit i termin płatności. Klient bez warunków płaci od razu.",
    customer: "Klient",
    customerPlaceholder: "Szukaj po nazwie albo e-mailu",
    amount: "Kwota limitu",
    terms: "Termin płatności",
    immediate: "Natychmiast",
    net: "Net {{days}}",
    save: "Ustaw warunki",
  },
  limits: {
    title: "Limity kredytowe",
    subtitle: "Limit każdego klienta z warunkami: ile może zalegać, ile zalega teraz i ile zostało. Kliknięcie otwiera edytor.",
    empty: "Nie ma jeszcze limitów. Ustaw warunki klienta powyżej.",
    customer: "Klient",
    limit: "Limit",
    used: "Wykorzystane",
    remaining: "Zostało",
    terms: "Termin",
    state: "Stan",
    active: "Aktywny",
    paused: "Wstrzymany",
    blocked: "Zablokowany",
    exhausted: "Limit wyczerpany",
    block: "Zablokuj / odblokuj",
    pause: "Wstrzymaj / wznów",
    edit: "Edytuj",
    save: "Zapisz",
    cancel: "Anuluj",
  },
  orders: {
    title: "Otwarte zamówienia kredytowe",
    subtitle: "Zamówienia na kontach klientów z terminami płatności, z chwili złożenia zamówienia. Codzienne zadanie oznacza przeterminowane i opłacone.",
    empty: "Nie ma otwartych zamówień kredytowych.",
    order: "Zamówienie",
    customer: "Klient",
    amount: "Kwota",
    due: "Termin",
    stateLabel: "Stan",
    state: {
      open: "Otwarte",
      overdue: "Po terminie",
      paid: "Opłacone",
    },
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
