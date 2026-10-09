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
  },
  by: "by Koda Plus",
  subtitle: "Punkty za każde zamówienie: {{pointsPerPln}} punkt za 1,00, punkt wart {{redeemRate}}, drabinka nagród i historia wykupów.",
  mode: {
    demo: "Demo",
  },
  error: "Nie udało się wczytać strony: {{message}}",
  stats: {
    accounts: "Konta",
    points: "Punktów w obiegu",
    redeemed: "Wykupionych punktów",
    ready: "Gotowi na nagrodę",
  },
  rewards: {
    title: "Drabinka nagród",
  },
  adjust: {
    title: "Koryguj punkty",
    subtitle: "Ręczna zmiana punktów klienta: dodatnia to bonus, ujemna to korekta.",
    customer: "Klient",
    customerPlaceholder: "Szukaj po nazwie albo e-mailu",
    delta: "Punkty",
    reason: "Powód",
    reasonPlaceholder: "np. reklamacja, bonus za duże zamówienie",
    save: "Koryguj",
  },
  accounts: {
    title: "Konta punktów",
    subtitle: "Saldo, zebrane i wykupione punkty oraz mnożnik tieru każdego klienta z kontem.",
    empty: "Nie ma jeszcze kont. Pierwsze zamówienie je zakłada.",
    customer: "Klient",
    balance: "Saldo",
    earned: "Zebrane",
    redeemed: "Wykupione",
    tier: "Tier",
  },
  transactions: {
    title: "Transakcje",
    subtitle: "Ostatnie ruchy na kontach.",
    empty: "Nie ma jeszcze transakcji.",
    when: "Kiedy",
    kind: "Rodzaj",
    delta: "Punkty",
    reason: "Powód",
  },
  kind: {
    earn_order: "Zamówienie",
    redeem: "Wykup",
    bonus: "Bonus",
    adjust: "Korekta",
    expire: "Wygasły",
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
