import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers for Loyalty: one line per
 * customer with points, and the board counter.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  customer: {
    points_one: "1 point",
    points_other: "{{count}} points",
    ready: "Can redeem the {{count}} reward",
    empty: "No points",
    earned: "Earned {{count}} in total",
  },
  attention: {
    ready: "Customers ready for a reward",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  customer: {
    points_one: "1 punkt",
    points_few: "{{count}} punkty",
    points_many: "{{count}} punktów",
    points_other: "{{count}} punktu",
    ready: "Może odebrać nagrodę za {{count}}",
    empty: "Brak punktów",
    earned: "Zebrane łącznie: {{count}}",
  },
  attention: {
    ready: "Klienci gotowi na nagrodę",
  },
}

/* Polish has more plural forms than English; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
