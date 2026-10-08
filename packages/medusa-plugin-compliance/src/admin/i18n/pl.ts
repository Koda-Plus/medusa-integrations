import type en from "./en"
import { typeset } from "../lib/compliance-typeset"
import { communityPl } from "../lib/compliance-kit-community"
import { integrationPl } from "../../modules/compliance/lib/integration-texts"

/* Typed by en.ts below (every English key exists here). */
const pl = {
  nav: "Zgodność",
  title: "Zgodność z UE",
  by: "by Koda Plus",
  subtitle: "Bezpieczeństwo produktów GPSR, zgody RODO i żądania podmiotów danych oraz historia cen Omnibus, w jednym panelu.",
  tabs: {
    gpsr: "GPSR",
    rodo: "RODO",
    omnibus: "Omnibus",
  },
  mode: {
    demo: "Demo",
  },
  loading: "Wczytywanie",
  error: "Nie udało się wczytać panelu: {{message}}",
  stats: {
    operators: "Podmioty",
    products: "Kompletne produkty",
    dsr: "Otwarte żądania",
    snapshots: "Migawki cen",
    consent: "Rekordy zgód",
  },
  operators: {
    title: "Podmioty gospodarcze",
    subtitle: "Producenci, osoby odpowiedzialne, importerzy i upoważnieni przedstawiciele. Produkt jest kompletny według GPSR, gdy wskazuje producenta i osobę odpowiedzialną w UE.",
    kind: "Rodzaj",
    name: "Nazwa",
    namePlaceholder: "Firma albo osoba",
    country: "Kraj",
    add: "Dodaj",
    contact: "Kontakt",
    empty: "Nie ma jeszcze podmiotów. Dodaj producenta i osobę odpowiedzialną swoich produktów.",
  },
  kind: {
    manufacturer: "Producent",
    responsible_person: "Osoba odpowiedzialna",
    importer: "Importer",
    authorized_representative: "Upoważniony przedstawiciel",
  },
  products: {
    title: "Bezpieczeństwo produktów",
    subtitle: "Każdy produkt sprzedawany online w UE musi pokazywać, kto go wyprodukował, kto odpowiada w UE i jakie ma ostrzeżenia. Oferta czyta dane stąd.",
    sku: "SKU",
    product: "Produkt",
    manufacturer: "Producent",
    responsible: "Osoba odpowiedzialna",
    state: "Stan",
    complete: "Kompletny",
    incomplete: "Niekompletny",
    empty: "Brak produktów w katalogu.",
    edit: "Edytuj",
    open: "Otwórz produkt w panelu",
    none: "Brak",
    warnings: "Ostrzeżenia",
    warningsPlaceholder: "Jedno ostrzeżenie w wierszu, w języku klienta",
    safety: "Informacje o bezpieczeństwie",
    safetyPlaceholder: "Instrukcje i informacje o bezpieczeństwie pokazywane przy ofercie",
    save: "Zapisz",
    cancel: "Anuluj",
  },
  dsr: {
    title: "Żądania podmiotów danych",
    subtitle: "Żądania składane przez zalogowanych klientów na ich koncie. Przerabiaj kolejkę i oznaczaj każde jako gotowe albo odrzucone.",
    when: "Kiedy",
    customer: "Klient",
    type: "Rodzaj",
    status: "Status",
    complete: "Gotowe",
    reject: "Odrzuć",
    empty: "Nie ma jeszcze żądań. Klient składa je na stronie swojego konta.",
    open: "Otwórz klienta w panelu",
  },
  type: {
    access: "Dostęp",
    erasure: "Usunięcie",
    portability: "Przenoszenie",
    restriction: "Ograniczenie",
    objection: "Sprzeciw",
    rectification: "Sprostowanie",
  },
  status: {
    pending: "Oczekuje",
    in_progress: "W toku",
    completed: "Zakończone",
    rejected: "Odrzucone",
  },
  consent: {
    title: "Rekordy zgód",
    subtitle: "Decyzje zapisywane przez baner cookies, stronę konta i podsumowanie zamówienia, według celu.",
    purpose: "Cel",
    granted: "Zgody",
    declined: "Odmowy",
    empty: "Nie zapisano jeszcze żadnej zgody. Baner cookies sklepu zapisuje je tutaj.",
  },
  purpose: {
    necessary: "Niezbędne",
    functional: "Funkcjonalne",
    analytics: "Analityka",
    marketing: "Marketing",
  },
  prices: {
    title: "Przejrzystość cen",
    subtitle: "Cena bazowa każdego wariantu, zapisywana raz dziennie, żeby promocja mogła pokazać najniższą cenę z ostatnich 30 dni.",
    capture: "Zapisz teraz",
    captured: "Zapisano cen: {{n}}",
    sku: "SKU",
    product: "Produkt",
    current: "Obecna",
    lowest: "Najniższa z 30 dni",
    snapshots: "Migawki",
    empty: "Nie ma jeszcze migawek cen. Zapisz teraz albo poczekaj na codzienne zadanie.",
  },
  toast: {
    created: "Podmiot dodany",
    deleted: "Podmiot usunięty",
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
