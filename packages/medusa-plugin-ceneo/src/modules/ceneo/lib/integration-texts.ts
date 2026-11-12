import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers (one line per Kup Teraz
 * order and per product, the channel and listing facts, the board
 * counters), in the `integration` subtree of the admin dictionaries. The
 * server uses them for the fallback sentence; `en.ts` and `pl.ts` mount
 * them as `integration`.
 *
 * Plain text here: the Polish dictionary goes through typeset() as a whole.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  order: {
    importHeld: "Ceneo import waits for a person",
    importRetrying: "Ceneo import failed, retrying",
    importing: "Importing from Ceneo",
    writeAttention: "Ceneo needs a person for this order",
    writeFailed: "Ceneo keeps refusing the status",
    canceledAtCeneo: "Cancelled at Ceneo",
    cancelSent: "Cancellation sent to Ceneo",
    cancelQueued: "Cancellation waits to go to Ceneo",
    sent: "Ceneo knows it was sent",
    shipmentQueued: "Shipment waits to go to Ceneo",
    confirmed: "Confirmed at Ceneo, waiting for shipment",
    imported: "Imported from Ceneo Kup Teraz",
    notArmed: "Ceneo hears about it once a person arms the status writer",
    lastError: "The last write to Ceneo failed, it will be retried",
    demo: "Sample data of the demo mode",
  },
  product: {
    errors_one: "{{count}} variant cannot go to Ceneo",
    errors_other: "{{count}} variants cannot go to Ceneo",
    warnings_one: "On Ceneo, {{count}} variant has a warning",
    warnings_other: "On Ceneo, {{count}} variants have a warning",
    excluded: "Not in the Ceneo feed",
    inFeedSome: "On Ceneo, {{done}} of {{total}} variants",
    inFeed: "On Ceneo",
  },
  fact: {
    channel: "Ceneo Kup Teraz {{number}}",
    listing: "Ceneo feed: {{done}} of {{total}}",
  },
  attention: {
    imports_held: "Ceneo orders that wait for a person",
    writes_attention: "Ceneo status writes that need a person",
    offer_errors: "Variants kept off Ceneo by an error",
    writers_tripped: "Ceneo writers stopped after failures",
  },
  problem: {
    demo: "Demo mode: sample data, nothing goes to Ceneo",
    not_configured: "No feed token or product address: Ceneo has no feed",
    no_api_key: "No Ceneo API key: no Kup Teraz orders and no bids",
    writer_tripped: "A Ceneo writer stopped after repeated failures",
    no_carrier: "No orders.carrierId: Ceneo gets \"sent\" without the parcel number",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  order: {
    importHeld: "Import z Ceneo czeka na człowieka",
    importRetrying: "Import z Ceneo nie wyszedł, ponawiam",
    importing: "Importuję z Ceneo",
    writeAttention: "Ceneo wymaga uwagi przy tym zamówieniu",
    writeFailed: "Ceneo stale odrzuca status",
    canceledAtCeneo: "Anulowane w Ceneo",
    cancelSent: "Anulowanie wysłane do Ceneo",
    cancelQueued: "Anulowanie czeka na wysyłkę do Ceneo",
    sent: "Ceneo wie o wysyłce",
    shipmentQueued: "Wysyłka czeka na zgłoszenie do Ceneo",
    confirmed: "Potwierdzone w Ceneo, czeka na wysyłkę",
    imported: "Zaimportowane z Ceneo Kup Teraz",
    notArmed: "Ceneo dowie się o tym, gdy ktoś uzbroi zapis statusu",
    lastError: "Ostatni zapis do Ceneo nie wyszedł, zostanie ponowiony",
    demo: "Przykładowe dane trybu demo",
  },
  product: {
    errors_one: "{{count}} wariant nie może trafić do Ceneo",
    errors_few: "{{count}} warianty nie mogą trafić do Ceneo",
    errors_many: "{{count}} wariantów nie może trafić do Ceneo",
    errors_other: "{{count}} wariantu nie może trafić do Ceneo",
    warnings_one: "W Ceneo {{count}} wariant ma ostrzeżenie",
    warnings_few: "W Ceneo {{count}} warianty mają ostrzeżenie",
    warnings_many: "W Ceneo {{count}} wariantów ma ostrzeżenie",
    warnings_other: "W Ceneo {{count}} wariantu ma ostrzeżenie",
    excluded: "Poza feedem Ceneo",
    inFeedSome: "W Ceneo {{done}} z {{total}} wariantów",
    inFeed: "W Ceneo",
  },
  fact: {
    channel: "Ceneo Kup Teraz {{number}}",
    listing: "Feed Ceneo: {{done}} z {{total}}",
  },
  attention: {
    imports_held: "Zamówienia z Ceneo czekające na człowieka",
    writes_attention: "Zapisy statusu do Ceneo wymagające uwagi",
    offer_errors: "Warianty zatrzymane przed Ceneo przez błąd",
    writers_tripped: "Zapisy do Ceneo zatrzymane po błędach",
  },
  problem: {
    demo: "Tryb demo: przykładowe dane, nic nie idzie do Ceneo",
    not_configured: "Brak tokenu feedu albo adresu produktu: Ceneo nie ma feedu",
    no_api_key: "Brak klucza API Ceneo: bez zamówień Kup Teraz i stawek",
    writer_tripped: "Zapis do Ceneo zatrzymał się po powtarzających się błędach",
    no_carrier: "Brak orders.carrierId: Ceneo dostaje „wysłane” bez numeru przesyłki",
  },
}

/* Polish has more plural forms than English; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
