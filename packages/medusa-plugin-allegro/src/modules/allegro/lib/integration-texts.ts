import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers (one line per imported order,
 * product or variant, the channel, payment, delivery, buyer and listing
 * facts, the board counters), in the `integration` subtree of the admin
 * dictionaries. The server uses them for the fallback sentence; `en.ts` and
 * `pl.ts` mount them as `integration`, so a host translates the same keys
 * with the plugin dictionary.
 *
 * Plain text here: the Polish dictionary goes through typeset() as a whole.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  order: {
    imported: "Imported from Allegro",
    held: "Allegro import held",
    attention: "Allegro needs a person",
    mismatch: "Total differs from Allegro",
    importing: "Finishing the Allegro import",
    cancelled: "Cancelled on Allegro",
    skipped: "Not imported from Allegro",
    mismatchAmounts: "{{allegro}} on Allegro, {{medusa}} in Medusa",
    heldReason: "Open the import to see why and retry",
    attentionHint: "Changed or cancelled on Allegro after the import",
    demo: "Sample data of the demo mode",
  },
  product: {
    oversell: "Allegro sells more than Medusa has",
    soldOut: "Live on Allegro, sold out in Medusa",
    live_one: "Live on Allegro",
    live_other: "{{count}} offers live on Allegro",
    drafts: "Draft offer on Allegro",
    ended: "Ended on Allegro",
    endedInStock: "Medusa still has stock for it",
    more_one: "and {{count}} more offer",
    more_other: "and {{count}} more offers",
    demo: "Sample offers of the demo mode",
  },
  fact: {
    channel: "Allegro",
    login: "{{login}}",
    cod: "Cash on delivery",
    paid: "Paid on Allegro",
    pending: "Payment pending on Allegro",
    delivery: "{{method}}",
    deliveryAllegro: "Allegro delivery",
    point: "Pickup point {{point}}",
    listingLive: "Live on Allegro, {{quantity}} pcs",
    listingLiveNoQty: "Live on Allegro",
    listingEnded: "Ended on Allegro",
    listingDraft: "Draft on Allegro",
    listingOther: "Allegro offer {{status}}",
    offer: "Offer {{id}}",
  },
  attention: {
    imports_held: "Allegro imports held",
    imports_attention: "Allegro orders that need a person",
    offers_stock_problem: "Allegro offers with stock problems",
    issues_open: "Open Allegro returns and disputes",
  },
  problem: {
    not_configured: "No Allegro keys: nothing is read from Allegro",
    not_connected: "The Allegro account is not connected",
    demo: "Demo mode: a simulated Allegro account, nothing goes to Allegro",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  order: {
    imported: "Zaimportowane z Allegro",
    held: "Import z Allegro wstrzymany",
    attention: "Allegro czeka na człowieka",
    mismatch: "Kwota inna niż na Allegro",
    importing: "Kończę import z Allegro",
    cancelled: "Anulowane na Allegro",
    skipped: "Niezaimportowane z Allegro",
    mismatchAmounts: "{{allegro}} na Allegro, {{medusa}} w Medusie",
    heldReason: "Otwórz import, sprawdź powód i ponów",
    attentionHint: "Zmienione albo anulowane na Allegro po imporcie",
    demo: "Przykładowe dane trybu demo",
  },
  product: {
    oversell: "Allegro sprzedaje więcej, niż ma Medusa",
    soldOut: "Aktywne na Allegro, wyprzedane w Medusie",
    live_one: "Aktywne na Allegro",
    live_few: "{{count}} aktywne oferty na Allegro",
    live_many: "{{count}} aktywnych ofert na Allegro",
    live_other: "{{count}} aktywnej oferty na Allegro",
    drafts: "Szkic oferty na Allegro",
    ended: "Zakończone na Allegro",
    endedInStock: "Medusa ma jeszcze ten towar",
    more_one: "i jeszcze {{count}} oferta",
    more_few: "i jeszcze {{count}} oferty",
    more_many: "i jeszcze {{count}} ofert",
    more_other: "i jeszcze {{count}} oferty",
    demo: "Przykładowe oferty trybu demo",
  },
  fact: {
    channel: "Allegro",
    login: "{{login}}",
    cod: "Za pobraniem",
    paid: "Opłacone na Allegro",
    pending: "Płatność na Allegro w toku",
    delivery: "{{method}}",
    deliveryAllegro: "Dostawa Allegro",
    point: "Punkt odbioru {{point}}",
    listingLive: "Aktywne na Allegro, {{quantity}} szt.",
    listingLiveNoQty: "Aktywne na Allegro",
    listingEnded: "Zakończone na Allegro",
    listingDraft: "Szkic na Allegro",
    listingOther: "Oferta Allegro {{status}}",
    offer: "Oferta {{id}}",
  },
  attention: {
    imports_held: "Wstrzymane importy z Allegro",
    imports_attention: "Zamówienia z Allegro do sprawdzenia",
    offers_stock_problem: "Oferty Allegro z problemem stanów",
    issues_open: "Otwarte zwroty i spory z Allegro",
  },
  problem: {
    not_configured: "Brak kluczy Allegro: nic nie jest czytane z Allegro",
    not_connected: "Konto Allegro nie jest połączone",
    demo: "Tryb demo: symulowane konto Allegro, nic nie trafia do Allegro",
  },
}

/* Polish has more plural forms than English; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
