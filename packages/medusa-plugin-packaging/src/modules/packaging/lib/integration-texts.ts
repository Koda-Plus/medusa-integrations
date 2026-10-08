import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers for Packaging: one line per
 * product with its ladder, and the board counter.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  product: {
    ladder: "Packaging: {{line}}",
    moq: "Minimum order: {{moq}}, in steps of {{step}}",
  },
  attention: {
    without_ladder: "Products without packaging",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  product: {
    ladder: "Opakowania: {{line}}",
    moq: "Minimalne zamówienie: {{moq}}, wielokrotność {{step}}",
  },
  attention: {
    without_ladder: "Produkty bez opakowań zbiorczych",
  },
}

/* Polish has more plural forms than English; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
