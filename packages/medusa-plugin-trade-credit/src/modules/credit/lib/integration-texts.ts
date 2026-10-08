import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers for Trade Credit: one line
 * per customer with credit terms, and the board counter.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  customer: {
    blocked: "Credit blocked",
    overdue_one: "1 credit order overdue",
    overdue_other: "{{count}} credit orders overdue",
    exhausted: "Credit limit reached: {{used}} of {{limit}}",
    used: "Used {{used}} of {{limit}}, {{remaining}} left",
    ready: "Credit ready: {{limit}}",
  },
  attention: {
    to_check: "Credit limits to check",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  customer: {
    blocked: "Kredyt zablokowany",
    overdue_one: "1 faktura kredytowa po terminie",
    overdue_few: "{{count}} faktury kredytowe po terminie",
    overdue_many: "{{count}} faktur kredytowych po terminie",
    overdue_other: "{{count}} faktury kredytowej po terminie",
    exhausted: "Limit kredytu wyczerpany: {{used}} z {{limit}}",
    used: "Wykorzystano {{used}} z {{limit}}, zostało {{remaining}}",
    ready: "Kredyt gotowy: {{limit}}",
  },
  attention: {
    to_check: "Limity kredytowe do sprawdzenia",
  },
}

/* Polish has more plural forms than English; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
