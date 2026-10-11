/**
 * The texts of the koda.integration/1 contract, in both admin languages.
 * The admin i18n merges them under its own keys.
 */

export const integrationEn = {
  title: {
    ok: "{{count}} subscribers from the store",
    attention: "{{count}} failed subscriptions",
    off: "Kit is not configured",
    none: "Nothing here yet",
  },
  detail: {
    ok: "The storefront form writes to Kit",
    failed: "Check the key and the settings",
  },
  problems: {
    apiKey: "The Kit API key is missing",
  },
}

export const integrationPl = {
  title: {
    ok: "{{count}} zapisów ze sklepu",
    attention: "{{count}} nieudanych zapisów",
    off: "Kit nie jest skonfigurowany",
    none: "Tu jeszcze nic nie ma",
  },
  detail: {
    ok: "Formularz sklepu zapisuje do Kita",
    failed: "Sprawdź klucz i ustawienia",
  },
  problems: {
    apiKey: "Brak klucza API Kita",
  },
}
