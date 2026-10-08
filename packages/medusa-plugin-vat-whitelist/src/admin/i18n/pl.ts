import type en from "./en"
import { typeset } from "../lib/whitelist-typeset"
import { communityPl } from "../lib/whitelist-kit-community"
import { integrationPl } from "../../modules/whitelist/lib/integration-texts"

/* Typed by en.ts below (every English key exists here). */
const pl = {
  nav: "Biała lista",
  title: "Biała lista VAT",
  by: "by Koda Plus",
  subtitle: "Sprawdź polski NIP w białej liście Ministerstwa Finansów i numery VAT UE w VIES: status VAT, numery kont do podzielonej płatności i historia weryfikacji.",
  mode: {
    demo: "Demo",
  },
  error: "Nie udało się wczytać strony: {{message}}",
  stats: {
    entities: "Kontrahenci",
    active: "Czynni VAT",
    exempt: "Zwolnieni",
    notFound: "Nie znaleziono",
  },
  check: {
    title: "Sprawdź kontrahenta",
    subtitle: "Polski NIP (10 cyfr) trafia do białej listy, numer VAT UE do VIES. Odpowiedź jest ważna przez {{hours}} godzin.",
    placeholder: "NIP albo numer VAT UE",
    run: "Sprawdź",
  },
  entities: {
    title: "Kontrahenci",
    subtitle: "Ostatnia odpowiedź rejestru dla każdego numeru, odświeżana ponownym sprawdzeniem. NIP linkuje do klienta, gdy weryfikacja dotyczyła jego firmy.",
    empty: "Jeszcze nic nie sprawdzono. Wpisz NIP powyżej.",
    nip: "NIP",
    name: "Nazwa",
    state: "Status",
    accounts: "Konta",
    checked: "Sprawdzony",
    stale: "nieaktualny",
    recheck: "Sprawdź ponownie",
    accountsCount: "{{count}}",
  },
  checks: {
    title: "Historia weryfikacji",
    subtitle: "Każde sprawdzenie, od najnowszych.",
    empty: "Jeszcze bez weryfikacji.",
    when: "Kiedy",
    nip: "Numer",
    source: "Rejestr",
    state: "Odpowiedź",
  },
  source: {
    whitelist: "Biała lista (MF)",
    vies: "VIES",
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
  },
  toast: {
    error: "Coś poszło nie tak: {{error}}",
  },
  community: communityPl,
  integration: integrationPl,
}

const samePolishKeys: typeof en = pl
void samePolishKeys

/* Polish typography: no one-letter word left at the end of a line. */
export default typeset(pl)
