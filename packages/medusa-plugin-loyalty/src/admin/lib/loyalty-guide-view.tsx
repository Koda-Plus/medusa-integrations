import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckCircleSolid, ChevronDownMini } from "@medusajs/icons"
import { Badge, Container, Heading, Text, clx } from "@medusajs/ui"
import { typeset } from "./loyalty-typeset"

/**
 * The setup guide of the Loyalty page (Panel | Setup guide). The same lean
 * shape in every Koda Plus module: what it takes, the steps with the code to
 * paste, the go-live checklist and a short FAQ. All copy lives here.
 */

const CONFIG = `module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-loyalty",
      options: {
        // Everything is optional.
        pointsPerPln: 1,
        redeemRate: 0.05,
        rewards: [
          { at: 1500, name: { en: "50 off", pl: "Rabat 50 zł" } },
          { at: 3000, name: { en: "Free 18V drill", pl: "Wkrętarka 18V gratis" } },
        ],
        demo: process.env.LOYALTY_DEMO === "true",
      },
    },
  ],
})`

const COPY = {
  pl: typeset({
    introTitle: "Wdrożenie krok po kroku",
    introText: "Zainstalujesz wtyczkę, zarejestrujesz ją w medusa-config.ts, uruchomisz migracje i otworzysz panel. Punkty podepniesz pod konto klienta, żeby kontrahenci widzieli swoje saldo i wymieniali punkty na rabaty sami.",
    time: "ok. 15 minut",
    needs: "Medusa 2.12 lub nowsza; drabinka nagród do wyboru",
    stepsTitle: "Kroki",
    stepsSub: "Wszystko, co trzeba zrobić, żeby panel działał w Twoim sklepie.",
    s1Title: "Zainstaluj wtyczkę",
    s1Text: "Menedżerem pakietów swojego projektu:",
    s2Title: "Zarejestruj w medusa-config.ts",
    s2Text: "Dodaj wpis do listy plugins, nie ruszając tego, co już tam jest. Każda opcja ma wartość domyślną, więc wtyczka startuje bez żadnej:",
    s3Title: "Ustaw wartość punktu i nagrody",
    s3Text: "pointsPerPln mówi, ile punktów daje 1,00 wartości zamówienia, a redeemRate ile wart jest jeden punkt (0.05 = 100 punktów za 5,00). Nagrody to drabinka, którą klient widzi na koncie. Ustaw LOYALTY_DEMO=true w .env, żeby najpierw poćwiczyć na danych przykładowych.",
    s4Title: "Uruchom i otwórz panel",
    s4Text: "Migracje tworzą tabele loyalty_account i loyalty_transaction, a istniejące tylko uzupełniają o flagę demo. Potem otwórz Lojalność w bocznym menu admina: pierwsze punkty naliczą się z zamówieniem, korekty zrobisz ręcznie.",
    s5Title: "Podepnij sklep",
    s5Text: "Trasy /store/loyalty/me i /store/loyalty/redeem pokazują saldo na koncie klienta i wymieniają punkty na rabaty. W sklepie demo Koda Plus przycisk wymiany jest w panelu konta.",
    checkTitle: "Lista przed startem",
    checkSub: "Wszystko odhaczone znaczy, że program lojalnościowy działa od pierwszego zamówienia.",
    checklist: [
      "Punkty naliczają się automatycznie z każdego złożonego zamówienia",
      "Klient widzi saldo i drabinkę nagród na swoim koncie",
      "Wymiana punktów odejmuje je natychmiast, rabat trafia do koszyka",
      "Handlowiec może dopisać korektę z powodem w panelu",
    ],
    faqTitle: "Pytania",
    faq: [
      { q: "Kiedy punkty trafiają na konto?", a: "Gdy zamówienie zostaje złożone. Workflow order.placed nalicza punkty od wartości netto i zapisuje transakcję z powodem earn." },
      { q: "Czy mogę zmienić wartość punktu później?", a: "Tak, to opcje w medusa-config.ts. Zmiana działa od następnych zamówień, historia transakcji zostaje bez zmian." },
      { q: "Czy tryb demo coś wysyła na zewnątrz?", a: "Nie. Demo to wyłącznie przykładowe konta i transakcje w bazie, nic nie opuszcza serwera." },
    ],
  }),
  en: typeset({
    introTitle: "Setup step by step",
    introText: "Install the plugin, register it in medusa-config.ts, run the migrations and open the panel. The points plug into the customer account, so counterparties see their balance and redeem points for discounts on their own.",
    time: "about 15 minutes",
    needs: "Medusa 2.12 or newer; a reward ladder of your choice",
    stepsTitle: "Steps",
    stepsSub: "Everything it takes for the panel to work in your store.",
    s1Title: "Install the plugin",
    s1Text: "With your project's package manager:",
    s2Title: "Register it in medusa-config.ts",
    s2Text: "Add an entry to the plugins list without touching what is already there. Every option has a default, so the plugin starts without any:",
    s3Title: "Set the point value and the rewards",
    s3Text: "pointsPerPln says how many points 1.00 of order value earns, redeemRate what one point is worth (0.05 = 100 points for 5.00). Rewards are the ladder the customer sees on their account. Set LOYALTY_DEMO=true in .env to practice on sample data first.",
    s4Title: "Start it and open the panel",
    s4Text: "The migrations create the loyalty_account and loyalty_transaction tables, and only add the demo flag to existing ones. Then open Loyalty in the admin sidebar: the first points accrue with an order, adjustments are manual.",
    s5Title: "Wire the storefront",
    s5Text: "The /store/loyalty/me and /store/loyalty/redeem routes show the balance on the customer account and redeem points for discounts. The Koda Plus demo store has the redeem button in the account panel.",
    checkTitle: "The go-live checklist",
    checkSub: "All ticked means the loyalty program works from the first order.",
    checklist: [
      "Points accrue automatically with every placed order",
      "The customer sees the balance and the reward ladder on their account",
      "Redeeming subtracts the points at once, the discount lands in the cart",
      "The rep can post a manual adjustment with a reason in the panel",
    ],
    faqTitle: "Questions",
    faq: [
      { q: "When do the points reach the account?", a: "When the order is placed. The order.placed workflow awards points on the net value and writes a transaction with the earn reason." },
      { q: "Can I change the point value later?", a: "Yes, they are options in medusa-config.ts. The change applies from the next orders; the transaction history stays as it was." },
      { q: "Does demo mode call anything outside?", a: "No. Demo mode is only sample accounts and transactions in the database: nothing leaves the server." },
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
    { title: C.s1Title, text: C.s1Text, code: "npm install @koda-plus/medusa-plugin-loyalty" },
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
