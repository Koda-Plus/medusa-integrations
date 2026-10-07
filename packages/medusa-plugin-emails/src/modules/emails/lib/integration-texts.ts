import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers (one line per order and per
 * customer, the board counters, the problems of the manifest), in the
 * `integration` subtree of the admin dictionaries. The server uses them for
 * the fallback sentence; `en.ts` and `pl.ts` mount them as `integration`, so
 * a host translates the same keys with the plugin dictionary.
 *
 * `{{template}}` is the name of a template in the answer's language ("Order
 * confirmation"), `{{when}}` a date and time formatted on the server. Polish
 * lines put the name first and an impersonal verb after it, so they read
 * right for every template.
 *
 * Plain text here: the Polish dictionary goes through typeset() as a whole.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  order: {
    failed: "{{template}}: not sent",
    unknown: "{{template}}: may not have gone out",
    sending: "{{template}}: being sent",
    sent_one: "{{count}} e-mail sent",
    sent_other: "{{count}} e-mails sent",
    simulated_one: "{{count}} e-mail simulated",
    simulated_other: "{{count}} e-mails simulated",
    skippedOff: "{{template}}: not sent, the template is off",
    skippedNoKey: "{{template}}: logged only, no API key",
    skipped: "{{template}}: not sent",
    latest: "Latest: {{template}}, {{when}}",
    checkResend: "Check it in Resend before sending it again",
    more_one: "and {{count}} more e-mail to look at",
    more_other: "and {{count}} more e-mails to look at",
    demo: "Demo mode: simulated, nothing left the server",
  },
  customer: {
    failed: "{{template}}: not sent",
    addressRefused: "{{template}}: the address was refused",
    unknown: "{{template}}: may not have gone out",
    sending: "{{template}}: being sent",
    sent_one: "{{count}} e-mail sent",
    sent_other: "{{count}} e-mails sent",
    simulated_one: "{{count}} e-mail simulated",
    simulated_other: "{{count}} e-mails simulated",
    skippedOff: "{{template}}: not sent, the template is off",
    skippedNoKey: "{{template}}: logged only, no API key",
    throttled: "{{template}}: too many in an hour, skipped",
    skipped: "{{template}}: not sent",
    latest: "Latest: {{template}}, {{when}}",
    checkAddress: "Check the address in the customer's account",
    checkResend: "Check it in Resend before sending it again",
    more_one: "and {{count}} more e-mail to look at",
    more_other: "and {{count}} more e-mails to look at",
    demo: "Demo mode: simulated, nothing left the server",
  },
  attention: {
    messages_failed: "E-mails not sent",
    bounced: "Addresses refused",
  },
  problem: {
    demo: "Demo mode: a simulated outbox, nothing leaves the server",
    no_key: "No Resend API key: messages are logged, not sent",
    not_configured: "The From address is missing: nothing is sent",
    no_provider: "The e-mail provider of this plugin is not registered",
    mode_differs: "The provider runs in another mode than the plugin",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  order: {
    failed: "{{template}}: nie wysłano",
    unknown: "{{template}}: nie wiadomo, czy wysłano",
    sending: "{{template}}: wysyłam",
    sent_one: "Wysłano {{count}} e-mail",
    sent_few: "Wysłano {{count}} e-maile",
    sent_many: "Wysłano {{count}} e-maili",
    sent_other: "Wysłano {{count}} e-maila",
    simulated_one: "Zasymulowano {{count}} e-mail",
    simulated_few: "Zasymulowano {{count}} e-maile",
    simulated_many: "Zasymulowano {{count}} e-maili",
    simulated_other: "Zasymulowano {{count}} e-maila",
    skippedOff: "{{template}}: nie wysłano, szablon wyłączony",
    skippedNoKey: "{{template}}: tylko w logu, brak klucza API",
    skipped: "{{template}}: nie wysłano",
    latest: "Ostatni: {{template}}, {{when}}",
    checkResend: "Sprawdź w Resend, zanim wyślesz ponownie",
    more_one: "i jeszcze {{count}} e-mail do sprawdzenia",
    more_few: "i jeszcze {{count}} e-maile do sprawdzenia",
    more_many: "i jeszcze {{count}} e-maili do sprawdzenia",
    more_other: "i jeszcze {{count}} e-maila do sprawdzenia",
    demo: "Tryb demo: symulacja, nic nie wyszło z serwera",
  },
  customer: {
    failed: "{{template}}: nie wysłano",
    addressRefused: "{{template}}: adres odrzucony",
    unknown: "{{template}}: nie wiadomo, czy wysłano",
    sending: "{{template}}: wysyłam",
    sent_one: "Wysłano {{count}} e-mail",
    sent_few: "Wysłano {{count}} e-maile",
    sent_many: "Wysłano {{count}} e-maili",
    sent_other: "Wysłano {{count}} e-maila",
    simulated_one: "Zasymulowano {{count}} e-mail",
    simulated_few: "Zasymulowano {{count}} e-maile",
    simulated_many: "Zasymulowano {{count}} e-maili",
    simulated_other: "Zasymulowano {{count}} e-maila",
    skippedOff: "{{template}}: nie wysłano, szablon wyłączony",
    skippedNoKey: "{{template}}: tylko w logu, brak klucza API",
    throttled: "{{template}}: za dużo w ciągu godziny, pominięto",
    skipped: "{{template}}: nie wysłano",
    latest: "Ostatni: {{template}}, {{when}}",
    checkAddress: "Sprawdź adres na koncie klienta",
    checkResend: "Sprawdź w Resend, zanim wyślesz ponownie",
    more_one: "i jeszcze {{count}} e-mail do sprawdzenia",
    more_few: "i jeszcze {{count}} e-maile do sprawdzenia",
    more_many: "i jeszcze {{count}} e-maili do sprawdzenia",
    more_other: "i jeszcze {{count}} e-maila do sprawdzenia",
    demo: "Tryb demo: symulacja, nic nie wyszło z serwera",
  },
  attention: {
    messages_failed: "E-maile, które nie wyszły",
    bounced: "Odrzucone adresy",
  },
  problem: {
    demo: "Tryb demo: symulowana skrzynka, nic nie wychodzi z serwera",
    no_key: "Brak klucza API Resend: wiadomości trafiają do logu, nie wychodzą",
    not_configured: "Brakuje adresu nadawcy: nic nie wychodzi",
    no_provider: "Dostawca e-maili tej wtyczki nie jest zarejestrowany",
    mode_differs: "Dostawca działa w innym trybie niż wtyczka",
  },
}

/* Polish has more plural forms than English; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
