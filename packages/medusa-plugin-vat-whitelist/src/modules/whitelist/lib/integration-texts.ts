import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers for the VAT Whitelist: one
 * line per customer whose company was checked, and the board counter.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  customer: {
    active: "VAT verified: {{name}}",
    exempt: "VAT exempt: {{name}}",
    failed: "Not on the whitelist: {{name}}",
    unavailable: "Registry unavailable: {{name}}",
  },
  attention: {
    unverified: "Counterparties to verify",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  customer: {
    active: "VAT zweryfikowany: {{name}}",
    exempt: "Zwolniony z VAT: {{name}}",
    failed: "Nie ma na białej liście: {{name}}",
    unavailable: "Rejestr niedostępny: {{name}}",
  },
  attention: {
    unverified: "Kontrahenci do weryfikacji",
  },
}

/* Polish has more plural forms than English; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
