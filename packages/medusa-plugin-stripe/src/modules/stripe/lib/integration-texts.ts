import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers (one line per order and per
 * customer, the payment fact, the board counters), in the `integration`
 * subtree of the admin dictionaries. The server uses them for the fallback
 * sentence; `en.ts` and `pl.ts` mount them as `integration`, so a host
 * translates the same keys with the plugin dictionary.
 *
 * Plain text here: the Polish dictionary goes through typeset() as a whole.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  order: {
    paid: "Paid, {{method}}",
    refundedAll: "Refunded in full",
    refundedPart: "Refunded {{amount}} of {{total}}",
    refundPending: "Refund under way",
    refundFailed: "Refund failed",
    authorized: "Authorized, capture by {{date}}",
    authorizedSoon: "Capture by {{date}}, the authorization expires",
    authorizedMedusa: "Authorized, waiting for the capture",
    processing: "Waiting for the bank",
    waitingCustomer: "Waiting for the customer",
    notPaid: "Not paid yet",
    declined: "Declined",
    canceled: "Payment canceled",
    canceledStripe: "Canceled in Stripe: the order is not paid",
    dispute: "Dispute to answer",
    disputeAnswer: "Dispute: answer by {{date}}",
    disputeOverdue: "Dispute: the deadline passed",
    disputeReview: "Dispute under review at the bank",
    disputeLost: "Dispute lost, {{amount}}",
    disputeWon: "Dispute won",
    unreadable: "Could not read Stripe",
    forbidden: "The key may not read this payment",
    notFound: "Stripe does not know this payment",
    unconfigured: "Stripe by Koda Plus has no read key",
    more_one: "and {{count}} more payment",
    more_other: "and {{count}} more payments",
    risk: "Elevated risk (Radar {{score}})",
    permission: "Add {{permission}} to the key",
    stale: "Stripe did not answer: the last read",
    medusaOnly: "From Medusa's records; open the order for Stripe's",
    demo: "Sample data of the demo mode",
  },
  customer: {
    payments_one: "{{count}} Stripe payment",
    payments_other: "{{count}} Stripe payments",
    order: "Order #{{order}}: {{line}}",
    mostly: "Mostly {{method}}",
    demo: "Sample data of the demo mode",
  },
  method: {
    card: "Card",
    blik: "BLIK",
    p24: "Przelewy24",
    apple_pay: "Apple Pay",
    google_pay: "Google Pay",
    link: "Link",
    other: "Other method",
    stripe: "Stripe",
  },
  fact: {
    method: "{{method}}",
    feeNet: "Fee {{fee}}, net {{net}}",
    feePending: "Fee not settled yet",
    amount: "{{amount}}",
    payments_one: "{{count}} payment",
    payments_other: "{{count}} payments",
  },
  attention: {
    payments_failed: "Payments that need a look",
    disputes_open: "Open disputes",
    health_failing: "Stripe checks that fail",
  },
  problem: {
    not_configured: "No read key: nothing is read from Stripe",
    publishable: "The key is publishable (pk_) and cannot read Stripe",
    secret: "A secret key (sk_) can move money: use a restricted key",
    demo: "Demo mode: sample payments built from the store's orders, nothing read from Stripe",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  order: {
    paid: "Opłacone, {{method}}",
    refundedAll: "Zwrócono w całości",
    refundedPart: "Zwrócono {{amount}} z {{total}}",
    refundPending: "Zwrot w toku",
    refundFailed: "Zwrot nieudany",
    authorized: "Autoryzowana, pobierz do {{date}}",
    authorizedSoon: "Pobierz do {{date}}, autoryzacja wygasa",
    authorizedMedusa: "Autoryzowana, czeka na pobranie",
    processing: "Czeka na bank",
    waitingCustomer: "Czeka na klienta",
    notPaid: "Jeszcze nieopłacone",
    declined: "Odrzucona",
    canceled: "Płatność anulowana",
    canceledStripe: "Anulowana w Stripe: zamówienie nie jest opłacone",
    dispute: "Spór do odpowiedzi",
    disputeAnswer: "Spór: odpowiedz do {{date}}",
    disputeOverdue: "Spór: termin minął",
    disputeReview: "Spór w rozpatrzeniu u banku",
    disputeLost: "Spór przegrany, {{amount}}",
    disputeWon: "Spór wygrany",
    unreadable: "Nie udało się odczytać Stripe",
    forbidden: "Klucz nie może odczytać tej płatności",
    notFound: "Stripe nie zna tej płatności",
    unconfigured: "Stripe by Koda Plus nie ma klucza do odczytu",
    more_one: "i jeszcze {{count}} płatność",
    more_few: "i jeszcze {{count}} płatności",
    more_many: "i jeszcze {{count}} płatności",
    more_other: "i jeszcze {{count}} płatności",
    risk: "Podwyższone ryzyko (Radar {{score}})",
    permission: "Dodaj do klucza {{permission}}",
    stale: "Stripe nie odpowiedział: ostatni odczyt",
    medusaOnly: "Z zapisów Medusy; dane Stripe na stronie zamówienia",
    demo: "Przykładowe dane trybu demo",
  },
  customer: {
    payments_one: "{{count}} płatność Stripe",
    payments_few: "{{count}} płatności Stripe",
    payments_many: "{{count}} płatności Stripe",
    payments_other: "{{count}} płatności Stripe",
    order: "Zamówienie #{{order}}: {{line}}",
    mostly: "Najczęściej {{method}}",
    demo: "Przykładowe dane trybu demo",
  },
  method: {
    card: "Karta",
    blik: "BLIK",
    p24: "Przelewy24",
    apple_pay: "Apple Pay",
    google_pay: "Google Pay",
    link: "Link",
    other: "Inna metoda",
    stripe: "Stripe",
  },
  fact: {
    method: "{{method}}",
    feeNet: "Prowizja {{fee}}, netto {{net}}",
    feePending: "Prowizja jeszcze nierozliczona",
    amount: "{{amount}}",
    payments_one: "{{count}} płatność",
    payments_few: "{{count}} płatności",
    payments_many: "{{count}} płatności",
    payments_other: "{{count}} płatności",
  },
  attention: {
    payments_failed: "Płatności do sprawdzenia",
    disputes_open: "Otwarte spory",
    health_failing: "Kontrole Stripe z błędem",
  },
  problem: {
    not_configured: "Brak klucza do odczytu: nic nie jest czytane ze Stripe",
    publishable: "Klucz jest publiczny (pk_) i nie może czytać Stripe",
    secret: "Klucz tajny (sk_) może ruszać pieniądze: użyj klucza ograniczonego",
    demo: "Tryb demo: przykładowe płatności z zamówień sklepu, nic nie jest czytane ze Stripe",
  },
}

/* Polish has more plural forms than English; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
