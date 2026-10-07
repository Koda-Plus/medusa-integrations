import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers (one line per order, product
 * and inventory item, the channel, delivery, document, payment and stock
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
    sent: "In BaseLinker",
    sentStatus: "In BaseLinker: {{status}}",
    fulfillmentFailed: "In BaseLinker, the Medusa fulfillment failed",
    queued: "On its way to BaseLinker",
    retrying: "Sending to BaseLinker again after an error",
    failed: "Not sent to BaseLinker",
    skip: {
      canceled: "Not sent to BaseLinker: canceled",
      skip_key: "Not sent to BaseLinker: a test order",
      marketplace_order: "Not sent to BaseLinker: a marketplace order",
      imported: "Not sent: it came from BaseLinker",
      other: "Not sent to BaseLinker",
    },
    imported: "Imported from {{source}}",
    importedStatus: "Imported from {{source}}: {{status}}",
    cancelBlocked: "Cancelled in BaseLinker, already fulfilled here",
    importing: "Import from BaseLinker under way",
    importFailed: "Import from BaseLinker failed",
    importSkipped: "Import from BaseLinker skipped",
    attempt: "Attempt {{attempts}} failed ({{code}})",
    code: "Code {{code}}",
    fulfillByHand: "Fulfill it by hand, or retry in BaseLinker",
    cancelByHand: "Cancel or return it in Medusa by hand",
    demo: "Sample data of the demo mode",
  },
  product: {
    linked_one: "Linked to {{count}} BaseLinker card",
    linked_few: "Linked to {{count}} BaseLinker cards",
    linked_many: "Linked to {{count}} BaseLinker cards",
    linked_other: "Linked to {{count}} BaseLinker cards",
    partly: "{{linked}} of {{total}} variants have a card",
    conflict: {
      duplicate_sku: "Card conflict: the SKU is on two BaseLinker cards",
      duplicate_ean: "Card conflict: the EAN is on two BaseLinker cards",
      ambiguous_variant: "Card conflict: two variants share the SKU",
      other: "A BaseLinker card conflict",
    },
    quarantined: "Held in quarantine by a BaseLinker plan",
    quarantinedDetail: "Released by a person in Settings, Plans",
  },
  inventory: {
    quarantined: "Stock write held in quarantine",
    failed: "The stock write failed",
    waiting: "Stock differs from BaseLinker",
    waitingNotArmed: "Waits for a person to arm the stock writer",
    waitingArmed: "Written on the next run of the armed stock writer",
    applied: "Stock updated from the plan",
    inStep: "Stock in step with BaseLinker",
  },
  fact: {
    channel: "BaseLinker: {{source}}",
    channelRef: "Order {{ref}}",
    parcel: "{{carrier}} parcel",
    parcelUnknown: "Parcel",
    tracking: "Tracking {{number}}",
    invoice: "Invoice {{number}}",
    receipt: "Receipt {{number}}",
    document: "Document {{number}}",
    documentSub: "Held by BaseLinker in {{field}}",
    paid: "Paid",
    cod: "Cash on delivery",
    partial: "Partly paid",
    awaiting: "Not paid yet",
    paymentSub: "As BaseLinker reports it",
    stockPlan_one: "{{count}} stock change planned",
    stockPlan_few: "{{count}} stock changes planned",
    stockPlan_many: "{{count}} stock changes planned",
    stockPlan_other: "{{count}} stock changes planned",
    stockUnits: "Units {{added}} in, {{removed}} out",
    stockBaseLinker: "BaseLinker {{stock}}",
    stockMedusa: "Medusa {{from}}, target {{to}}",
    stockSame: "Medusa the same",
  },
  attention: {
    orders_failed: "Orders not sent to BaseLinker",
    imports_failed: "Marketplace orders not imported",
    quarantined: "Items in quarantine",
    cards_conflict: "BaseLinker card conflicts",
  },
  problem: {
    not_configured: "Missing plugin options: {{missing}}. Nothing goes to BaseLinker",
    demo: "Demo mode: a simulated BaseLinker account, nothing leaves Medusa",
    demo_not_prepared: "Demo mode: the sample data is being prepared",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  order: {
    sent: "W BaseLinkerze",
    sentStatus: "W BaseLinkerze: {{status}}",
    fulfillmentFailed: "W BaseLinkerze, realizacja w Medusie się nie udała",
    queued: "W drodze do BaseLinkera",
    retrying: "Ponowna wysyłka do BaseLinkera po błędzie",
    failed: "Nie wysłano do BaseLinkera",
    skip: {
      canceled: "Nie wysłano do BaseLinkera: anulowane",
      skip_key: "Nie wysłano do BaseLinkera: zamówienie testowe",
      marketplace_order: "Nie wysłano do BaseLinkera: zamówienie z marketplace'u",
      imported: "Nie wysłano: przyszło z BaseLinkera",
      other: "Nie wysłano do BaseLinkera",
    },
    imported: "Zaimportowane z {{source}}",
    importedStatus: "Zaimportowane z {{source}}: {{status}}",
    cancelBlocked: "Anulowane w BaseLinkerze, a tu już zrealizowane",
    importing: "Import z BaseLinkera w toku",
    importFailed: "Import z BaseLinkera się nie udał",
    importSkipped: "Import z BaseLinkera pominięty",
    attempt: "Próba {{attempts}} nieudana ({{code}})",
    code: "Kod {{code}}",
    fulfillByHand: "Zrealizuj je ręcznie albo ponów w BaseLinkerze",
    cancelByHand: "Anuluj je albo przyjmij zwrot ręcznie w Medusie",
    demo: "Przykładowe dane trybu demo",
  },
  product: {
    linked_one: "Połączony z {{count}} kartą BaseLinkera",
    linked_few: "Połączony z {{count}} kartami BaseLinkera",
    linked_many: "Połączony z {{count}} kartami BaseLinkera",
    linked_other: "Połączony z {{count}} kartami BaseLinkera",
    partly: "Kartę ma {{linked}} z {{total}} wariantów",
    conflict: {
      duplicate_sku: "Konflikt kart: SKU jest na dwóch kartach BaseLinkera",
      duplicate_ean: "Konflikt kart: EAN jest na dwóch kartach BaseLinkera",
      ambiguous_variant: "Konflikt kart: dwa warianty mają to samo SKU",
      other: "Konflikt kart BaseLinkera",
    },
    quarantined: "Wstrzymany w kwarantannie planu BaseLinkera",
    quarantinedDetail: "Zwalnia go człowiek w Ustawieniach, w Planach",
  },
  inventory: {
    quarantined: "Zapis stanu wstrzymany w kwarantannie",
    failed: "Zapis stanu się nie udał",
    waiting: "Stan różni się od BaseLinkera",
    waitingNotArmed: "Czeka, aż człowiek uzbroi zapis stanów",
    waitingArmed: "Zapisze go najbliższy przebieg uzbrojonego zapisu stanów",
    applied: "Stan zaktualizowany z planu",
    inStep: "Stan zgodny z BaseLinkerem",
  },
  fact: {
    channel: "BaseLinker: {{source}}",
    channelRef: "Zamówienie {{ref}}",
    parcel: "Przesyłka {{carrier}}",
    parcelUnknown: "Przesyłka",
    tracking: "Numer {{number}}",
    invoice: "Faktura {{number}}",
    receipt: "Paragon {{number}}",
    document: "Dokument {{number}}",
    documentSub: "Zapisany w BaseLinkerze w polu {{field}}",
    paid: "Opłacone",
    cod: "Za pobraniem",
    partial: "Opłacone częściowo",
    awaiting: "Jeszcze nieopłacone",
    paymentSub: "Tak, jak podaje BaseLinker",
    stockPlan_one: "{{count}} zmiana stanu w planie",
    stockPlan_few: "{{count}} zmiany stanów w planie",
    stockPlan_many: "{{count}} zmian stanów w planie",
    stockPlan_other: "{{count}} zmiany stanów w planie",
    stockUnits: "Sztuk {{added}} na plus, {{removed}} na minus",
    stockBaseLinker: "BaseLinker {{stock}}",
    stockMedusa: "Medusa {{from}}, docelowo {{to}}",
    stockSame: "W Medusie tyle samo",
  },
  attention: {
    orders_failed: "Zamówienia niewysłane do BaseLinkera",
    imports_failed: "Niezaimportowane zamówienia z marketplace'ów",
    quarantined: "Pozycje w kwarantannie",
    cards_conflict: "Konflikty kart BaseLinkera",
  },
  problem: {
    not_configured: "Brakuje opcji wtyczki: {{missing}}. Nic nie trafia do BaseLinkera",
    demo: "Tryb demo: symulowane konto BaseLinkera, nic nie wychodzi poza Medusę",
    demo_not_prepared: "Tryb demo: przykładowe dane są w przygotowaniu",
  },
}

/** Polish has the same keys (it may add plural forms). */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
