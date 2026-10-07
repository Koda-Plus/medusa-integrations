import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers (one line per order, product
 * or customer with linked tasks, and the board counters), in the
 * `integration` subtree of the admin dictionaries. The server uses them for
 * the fallback sentence; `en.ts` and `pl.ts` mount them as `integration`, so
 * a host translates the same keys with the plugin dictionary.
 *
 * The line reads the same for every kind of record, so it lives under
 * `record`. Plain text here: the Polish dictionary goes through typeset() as
 * a whole.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  record: {
    overdue_one: "1 task overdue",
    overdue_other: "{{count}} tasks overdue",
    dueToday_one: "1 task due today",
    dueToday_other: "{{count}} tasks due today",
    review_one: "1 task in review",
    review_other: "{{count}} tasks in review",
    open_one: "1 open task",
    open_other: "{{count}} open tasks",
    allDone_one: "Task closed",
    allDone_other: "All {{count}} tasks closed",
    top: "Most urgent: {{title}}",
    latest: "Latest: {{title}}",
  },
  attention: {
    overdue_orders: "Overdue tasks on orders",
    overdue_products: "Overdue tasks on products",
    overdue_customers: "Overdue tasks on customers",
    unassigned: "Open tasks without a person",
    mine: "My open tasks",
  },
  problem: {
    sandbox_unguarded: "Sandbox accounts are still admin users outside Tasks: set sandboxGuard",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  record: {
    overdue_one: "1 zadanie po terminie",
    overdue_few: "{{count}} zadania po terminie",
    overdue_many: "{{count}} zadań po terminie",
    overdue_other: "{{count}} zadania po terminie",
    dueToday_one: "1 zadanie na dziś",
    dueToday_few: "{{count}} zadania na dziś",
    dueToday_many: "{{count}} zadań na dziś",
    dueToday_other: "{{count}} zadania na dziś",
    review_one: "1 zadanie do sprawdzenia",
    review_few: "{{count}} zadania do sprawdzenia",
    review_many: "{{count}} zadań do sprawdzenia",
    review_other: "{{count}} zadania do sprawdzenia",
    open_one: "1 otwarte zadanie",
    open_few: "{{count}} otwarte zadania",
    open_many: "{{count}} otwartych zadań",
    open_other: "{{count}} otwartego zadania",
    allDone_one: "Zadanie zamknięte",
    allDone_few: "Wszystkie {{count}} zadania zamknięte",
    allDone_many: "Wszystkie {{count}} zadań zamkniętych",
    allDone_other: "Wszystkie {{count}} zadania zamknięte",
    top: "Najpilniejsze: {{title}}",
    latest: "Ostatnie: {{title}}",
  },
  attention: {
    overdue_orders: "Zadania po terminie przy zamówieniach",
    overdue_products: "Zadania po terminie przy produktach",
    overdue_customers: "Zadania po terminie przy klientach",
    unassigned: "Otwarte zadania bez osoby",
    mine: "Moje otwarte zadania",
  },
  problem: {
    sandbox_unguarded: "Konta piaskownicy są poza Zadaniami dalej użytkownikami panelu: ustaw sandboxGuard",
  },
}

/* Polish has more plural forms than English; every English key must exist in Polish. */
const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
