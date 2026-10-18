import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers for Coupons: one line per
 * order (the coupons that worked), per customer (the codes they used) and
 * per product (active coupons that reach it), and the board counters.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  order: {
    one: "Coupon {{code}}: {{amount}} off",
    many: "{{count}} coupons: {{amount}} off",
    automatic: "an automatic coupon",
  },
  customer: {
    used_one: "Used 1 coupon",
    used_other: "Used {{count}} coupons",
    saved: "{{amount}} off in total",
    none: "No coupons used",
  },
  product: {
    active_one: "1 active coupon reaches it",
    active_other: "{{count}} active coupons reach it",
  },
  attention: {
    expiring: "Coupons ending within 7 days",
    automatic_everyone: "Automatic coupons for everyone",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  order: {
    one: "Kupon {{code}}: rabat {{amount}}",
    many: "{{count}} kupony: rabat {{amount}}",
    automatic: "kupon automatyczny",
  },
  customer: {
    used_one: "Użyła 1 kuponu",
    used_few: "Użyła {{count}} kuponów",
    used_many: "Użyła {{count}} kuponów",
    used_other: "Użyła {{count}} kuponów",
    saved: "Łącznie rabatu {{amount}}",
    none: "Bez kuponów",
  },
  product: {
    active_one: "Obejmuje go 1 aktywny kupon",
    active_few: "Obejmują go {{count}} aktywne kupony",
    active_many: "Obejmuje go {{count}} aktywnych kuponów",
    active_other: "Obejmuje go {{count}} aktywnego kuponu",
  },
  attention: {
    expiring: "Kupony kończące się w ciągu 7 dni",
    automatic_everyone: "Kupony automatyczne dla wszystkich",
  },
}

/* Polish has more plural forms than English; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
