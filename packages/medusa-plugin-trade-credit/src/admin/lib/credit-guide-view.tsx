import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckCircleSolid, ChevronDownMini } from "@medusajs/icons"
import { Badge, Container, Heading, Text, clx } from "@medusajs/ui"
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
    stepsTitle: "Kroki",
    stepsSub: "Wszystko, co trzeba zrobić, żeby panel działał w Twoim sklepie.",
    s1Title: "Zainstaluj wtyczkę",
    s1Text: "Menedżerem pakietów swojego projektu:",
    s2Title: "Zarejestruj w medusa-config.ts",
    s2Text: "Dodaj wpis do listy plugins, nie ruszając tego, co już tam jest. Każda opcja ma wartość domyślną, więc wtyczka startuje bez żadnej:",
    s3Title: "Uzbrój wymuszanie (dopiero po próbach)",
    s3Text: "Opcja enforce: true sprawia, że kasa odmawia dokończenia zamówienia klientowi nad limitem albo zablokowanemu (403 credit_hold). Włącz ją dopiero wtedy, gdy limity działają tak, jak chcesz. Ustaw CREDIT_DEMO=true w .env, żeby najpierw poćwiczyć na danych przykładowych.",
    s4Title: "Uruchom i otwórz panel",
    s4Text: "Migracje tworzą tabele modułu: credit_limit i credit_order. Potem otwórz Kredyt w bocznym menu admina: nadaj pierwszy limit z terminem net 14, 30 albo 60 dni. Codzienne zadanie zaznacza zaległe faktury jako overdue.",
    s5Title: "Podepnij sklep",
    s5Text: "Trasa /store/credit/me zwraca limit, wykorzystanie i termin klienta, a otwarte zamówienia kredytowe widnieją na jego koncie. W sklepie demo Koda Plus kasa pokazuje je przy płatności.",
    checkTitle: "Lista przed startem",
    checkSub: "Wszystko odhaczone znaczy, że sprzedaż na kredyt działa bez ryzyka dla sklepu.",
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
      { q: "Czy tryb demo coś wysyła na zewnątrz?", a: "Nie. Demo to wyłącznie przykładowe limity i zamówienia kredytowe w bazie, nic nie opuszcza serwera." },
    ],
  }),
  en: typeset({
    introTitle: "Setup step by step",
    introText: "Install the plugin, register it in medusa-config.ts, run the migrations and open the panel. The credit limits plug into the checkout, so the customer sees their credit when placing an order and the team sees overdue orders in the admin.",
    time: "about 15 minutes",
    needs: "Medusa 2.12 or newer; limits are granted by a rep in the panel",
    stepsTitle: "Steps",
    stepsSub: "Everything it takes for the panel to work in your store.",
    s1Title: "Install the plugin",
    s1Text: "With your project's package manager:",
    s2Title: "Register it in medusa-config.ts",
    s2Text: "Add an entry to the plugins list without touching what is already there. Every option has a default, so the plugin starts without any:",
    s3Title: "Arm enforcement (only after dry runs)",
    s3Text: "The enforce: true option makes the checkout refuse to complete an order for a customer over their limit or blocked (403 credit_hold). Turn it on only once the limits behave the way you want. Set CREDIT_DEMO=true in .env to practice on sample data first.",
    s4Title: "Start it and open the panel",
    s4Text: "The migrations create the module's tables: credit_limit and credit_order. Then open Credit in the admin sidebar: grant the first limit with net 14, 30 or 60 days terms. A daily job flags overdue orders.",
    s5Title: "Wire the storefront",
    s5Text: "The /store/credit/me route returns the customer's limit, usage and terms, and the open credit orders show on their account. In the Koda Plus demo store the checkout shows them next to the payment.",
    checkTitle: "The go-live checklist",
    checkSub: "All ticked means selling on credit works without risk to the store.",
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
      { q: "Does demo mode call anything outside?", a: "No. Demo mode is only sample limits and credit orders in the database: nothing leaves the server." },
    ],
  }),
}

function Step({ n, title, text, code }: { n: number; title: string; text: string; code?: string }) {
  return (
    <li className="flex flex-col gap-y-2 px-6 py-4">
      <div className="flex items-center gap-x-2">
        <span className="txt-compact-small-plus flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ui-bg-component text-ui-fg-subtle tabular-nums">{n}</span>
        <Text size="small" weight="plus">
          {title}
        </Text>
      </div>
      <Text size="small" className="max-w-3xl text-ui-fg-subtle">
        {text}
      </Text>
      {code ? <pre className="overflow-x-auto rounded-lg bg-ui-bg-subtle px-3 py-2.5 font-mono text-[11px] leading-[18px] text-ui-fg-subtle">{code}</pre> : null}
    </li>
  )
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-6 py-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-x-3 text-left">
        <Text size="small" weight="plus">
          {q}
        </Text>
        <ChevronDownMini className={clx("shrink-0 text-ui-fg-muted transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <Text size="small" className="mt-2 max-w-3xl text-ui-fg-subtle">
          {a}
        </Text>
      ) : null}
    </div>
  )
}

export function GuideView() {
  const { i18n } = useTranslation()
  const C = i18n.language?.startsWith("pl") ? COPY.pl : COPY.en
  const steps = [
    { title: C.s1Title, text: C.s1Text, code: "npm install @koda-plus/medusa-plugin-trade-credit" },
    { title: C.s2Title, text: C.s2Text, code: CONFIG },
    { title: C.s3Title, text: C.s3Text },
    { title: C.s4Title, text: C.s4Text },
    { title: C.s5Title, text: C.s5Text },
  ]

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="p-0">
        <div className="flex flex-col gap-y-1 px-6 py-4">
          <Heading level="h2">{C.introTitle}</Heading>
          <Text size="small" className="max-w-3xl text-ui-fg-subtle">
            {C.introText}
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-ui-border-base px-6 py-3">
          <Badge size="2xsmall" color="blue">
            {C.time}
          </Badge>
          <Badge size="2xsmall" color="grey">
            {C.needs}
          </Badge>
        </div>
      </Container>

      <Container className="p-0">
        <div className="flex flex-col gap-y-1 border-b border-ui-border-base px-6 py-4">
          <Heading level="h2">{C.stepsTitle}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {C.stepsSub}
          </Text>
        </div>
        <ol className="divide-y divide-ui-border-base">
          {steps.map((s, i) => (
            <Step key={i} n={i + 1} title={s.title} text={s.text} code={s.code} />
          ))}
        </ol>
      </Container>

      <Container className="p-0">
        <div className="flex flex-col gap-y-1 border-b border-ui-border-base px-6 py-4">
          <Heading level="h2">{C.checkTitle}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {C.checkSub}
          </Text>
        </div>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-2 px-6 py-4 md:grid-cols-2">
          {C.checklist.map((row) => (
            <li key={row} className="flex items-start gap-x-2">
              <CheckCircleSolid className="mt-px shrink-0 text-ui-tag-green-text" />
              <Text size="small" className="text-ui-fg-subtle">
                {row}
              </Text>
            </li>
          ))}
        </ul>
      </Container>

      <Container className="divide-y divide-ui-border-base p-0">
        <div className="flex flex-col gap-y-1 px-6 py-4">
          <Heading level="h2">{C.faqTitle}</Heading>
        </div>
        {C.faq.map((row) => (
          <FaqRow key={row.q} q={row.q} a={row.a} />
        ))}
      </Container>
    </div>
  )
}
