import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { StatusResponse } from "../../modules/credit/lib/contract"
import { GuideChecklist, GuideFaq, GuideIntro, GuideSteps, type GuideStep, type SetupPromptSpec } from "./credit-guide"
import { KIT_META } from "./credit-kit-meta"
import { typeset } from "./credit-typeset"

/**
 * The setup guide of the Credit page (Panel | Setup guide). The same lean
 * shape in every Koda Plus module: what it takes, the steps with the code to
 * paste, the go-live checklist and a short FAQ. All copy lives here.
 */

const CONFIG = `module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-trade-credit",
      options: {
        // Everything is optional.
        enforce: false,
        demo: process.env.CREDIT_DEMO === "true",
      },
    },
  ],
})`

const COPY = {
  pl: typeset({
    introTitle: "Wdrożenie krok po kroku",
    introText: "Zainstalujesz wtyczkę, zarejestrujesz ją w medusa-config.ts, uruchomisz migracje i otworzysz panel. Limity kredytowe podepniesz pod kasę, żeby klient widział swój kredyt przy składaniu zamówienia, a ekipa widziała przeterminowania w panelu.",
    time: "ok. 15 minut",
    needs: "Medusa 2.12 lub nowsza; limity nadaje handlowiec w panelu",
    needsList: ["Medusa 2.12 lub nowsza", "Handlowiec nadaje limity"],
    needsLabel: "Potrzebne",
    timeLabel: "Czas",
    state: { done: "gotowe", todo: "do zrobienia", optional: "opcjonalnie", later: "później" },
    checkLabel: "Sprawdź",
    copy: "Kopiuj",
    copied: "Skopiowano",
    stepsTitle: "Kroki",
    stepsSub: "Od instalacji do kasy",
    s1Title: "Zainstaluj wtyczkę",
    s1Text: "Menedżerem pakietów swojego projektu:",
    s2Title: "Zarejestruj w medusa-config.ts",
    s2Text: "Dodaj wpis do listy plugins, nie ruszając tego, co już tam jest. Każda opcja ma wartość domyślną, więc wtyczka startuje bez żadnej:",
    s3Title: "Uzbrój wymuszanie (dopiero po próbach)",
    s3Text: "Opcja enforce: true sprawia, że kasa odmawia dokończenia zamówienia klientowi zablokowanemu, wstrzymanemu albo takiemu, który tym zamówieniem przekroczyłby limit (403 credit_hold). Włącz ją dopiero wtedy, gdy limity działają tak, jak chcesz. Ćwicz najpierw na koncie testowym klienta z małym limitem.",
    s4Title: "Uruchom i otwórz panel",
    s4Text: "Migracje tworzą tabele modułu: credit_limit i credit_order. Potem otwórz Kredyt w bocznym menu admina: nadaj pierwszy limit z terminem net 14, 30 albo 60 dni. Codzienne zadanie zaznacza zaległe faktury jako overdue.",
    s5Title: "Podepnij sklep",
    s5Text: "Trasa /store/credit/me zwraca limit, wykorzystanie i termin klienta, a otwarte zamówienia kredytowe widnieją na jego koncie. W sklepie demo Koda Plus kasa pokazuje je przy płatności.",
    checkTitle: "Lista przed startem",
    checkSub: "Przed sprzedażą na kredyt",
    checklist: [
      "Każdy kontrahent z kredytem ma limit i termin płatności w panelu",
      "Wykorzystanie liczy się z nieopłaconych zamówień automatycznie",
      "Handlowiec widzi zaległości w panelu i na tablicy zamówień",
      "enforce włączone dopiero po próbie na sucho",
    ],
    faqTitle: "Pytania",
    faq: [
      { q: "Kiedy zamówienie staje się zamówieniem kredytowym?", a: "Gdy kontrahent ma limit i wybierze płatność z terminem, w momencie złożenia zamówienia. Subskrybent order.placed zapisuje je w credit_order z datą wymagalności." },
      { q: "Czy kasa blokuje zamówienia nad limitem od razu?", a: "Nie. Domyślnie enforce: false, więc limity są widoczne, ale niczego nie blokują. Włączenie enforce: true to decyzja sklepu, po próbach." },
      { q: "Czy tryb demo coś wysyła na zewnątrz?", a: "Nie. Tryb demo tylko oznacza nowe limity i zamówienia kredytowe jako demo; przykładowe dane wgrywa skrypt seed Twojej aplikacji. Nic nie opuszcza serwera." },
    ],
  }),
  en: typeset({
    introTitle: "Setup step by step",
    introText: "Install the plugin, register it in medusa-config.ts, run the migrations and open the panel. The credit limits plug into the checkout, so the customer sees their credit when placing an order and the team sees overdue orders in the admin.",
    time: "about 15 minutes",
    needs: "Medusa 2.12 or newer; limits are granted by a rep in the panel",
    needsList: ["Medusa 2.12 or newer", "A rep grants the limits"],
    needsLabel: "Needs",
    timeLabel: "Time",
    state: { done: "done", todo: "to do", optional: "optional", later: "later" },
    checkLabel: "Check",
    copy: "Copy",
    copied: "Copied",
    stepsTitle: "Steps",
    stepsSub: "From install to checkout",
    s1Title: "Install the plugin",
    s1Text: "With your project's package manager:",
    s2Title: "Register it in medusa-config.ts",
    s2Text: "Add an entry to the plugins list without touching what is already there. Every option has a default, so the plugin starts without any:",
    s3Title: "Arm enforcement (only after dry runs)",
    s3Text: "The enforce: true option makes the checkout refuse to complete an order for a customer who is blocked, paused or would pass the limit with that order (403 credit_hold). Turn it on only once the limits behave the way you want. Practice first on a test customer with a small limit.",
    s4Title: "Start it and open the panel",
    s4Text: "The migrations create the module's tables: credit_limit and credit_order. Then open Credit in the admin sidebar: grant the first limit with net 14, 30 or 60 days terms. A daily job flags overdue orders.",
    s5Title: "Wire the storefront",
    s5Text: "The /store/credit/me route returns the customer's limit, usage and terms, and the open credit orders show on their account. In the Koda Plus demo store the checkout shows them next to the payment.",
    checkTitle: "The go-live checklist",
    checkSub: "Before selling on credit",
    checklist: [
      "Every counterparty on credit has a limit and payment terms in the panel",
      "Usage is counted from unpaid orders automatically",
      "The rep sees overdue orders in the panel and on the orders board",
      "enforce switched on only after a dry run",
    ],
    faqTitle: "Questions",
    faq: [
      { q: "When does an order become a credit order?", a: "When the counterparty has a limit and picks a payment method with terms, at the moment the order is placed. The order.placed subscriber saves it to credit_order with a due date." },
      { q: "Does the checkout block over-limit orders right away?", a: "No. By default enforce: false, so limits are visible but block nothing. Turning enforce: true on is the store's decision, after dry runs." },
      { q: "Does demo mode call anything outside?", a: "No. Demo mode only flags new limits and credit orders as demo; sample data comes from your app's seed script. Nothing leaves the server." },
    ],
  }),
}

/** The setup behind "Copy prompt" in the header: the same steps and config the guide shows. */
export function usePromptSpec(): SetupPromptSpec {
  const { t, i18n } = useTranslation("credit")
  const C = i18n.language?.startsWith("pl") ? COPY.pl : COPY.en
  return useMemo(
    () => ({
      service: "Trade Credit",
      pkg: KIT_META.pkg,
      route: "/app/credit",
      summary: t("subtitle"),
      needs: [C.needs],
      config: CONFIG,
      demo: 'demo: process.env.CREDIT_DEMO === "true",',
    }),
    [t, C],
  )
}

export function GuideView({ status }: { status?: StatusResponse }) {
  const { i18n } = useTranslation()
  const C = i18n.language?.startsWith("pl") ? COPY.pl : COPY.en
  const text = (body: string) => <p>{body}</p>
  const steps: GuideStep[] = [
    { id: "install", title: C.s1Title, state: "done", body: text(C.s1Text), code: "npm install @koda-plus/medusa-plugin-trade-credit" },
    { id: "register", title: C.s2Title, state: "done", body: text(C.s2Text), code: CONFIG },
    { id: "enforce", title: C.s3Title, state: status?.enforce ? "done" : "optional", body: text(C.s3Text) },
    { id: "start", title: C.s4Title, state: status && status.counts.limits > 0 ? "done" : "todo", body: text(C.s4Text) },
    { id: "storefront", title: C.s5Title, state: "optional", body: text(C.s5Text) },
  ]
  const done = [Boolean(status && status.counts.limits > 0), Boolean(status), Boolean(status), Boolean(status?.enforce)]
  return (
    <div className="flex flex-col gap-y-3">
      <GuideIntro title={C.introTitle} text={C.introText} time={C.time} needs={C.needsList} needsLabel={C.needsLabel} timeLabel={C.timeLabel} />
      <GuideSteps title={C.stepsTitle} subtitle={C.stepsSub} steps={steps} stateLabels={C.state} checkLabel={C.checkLabel} copyLabel={C.copy} copiedLabel={C.copied} />
      <GuideChecklist title={C.checkTitle} subtitle={C.checkSub} items={C.checklist.map((label, i) => ({ label, done: done[i] ?? false }))} />
      <GuideFaq title={C.faqTitle} items={C.faq} />
    </div>
  )
}
