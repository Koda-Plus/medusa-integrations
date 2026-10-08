import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckCircleSolid, ChevronDownMini } from "@medusajs/icons"
import { Badge, Container, Heading, Text, clx } from "@medusajs/ui"
import { typeset } from "./whitelist-typeset"

/**
 * The setup guide of the Whitelist page (Panel | Setup guide). The same lean
 * shape in every Koda Plus module: what it takes, the steps with the code to
 * paste, the go-live checklist and a short FAQ. All copy lives here.
 */

const CONFIG = `module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-vat-whitelist",
      options: {
        // Everything is optional.
        staleHours: 24,
        demo: process.env.WHITELIST_DEMO === "true",
      },
    },
  ],
})`

const COPY = {
  pl: typeset({
    introTitle: "Wdrożenie krok po kroku",
    introText: "Zainstalujesz wtyczkę, zarejestrujesz ją w medusa-config.ts, uruchomisz migracje i otworzysz panel. Sprawdzanie NIP podepniesz pod formularz rejestracji i pod konto klienta, żeby kontrahenci sami potwierdzali swój status VAT.",
    time: "ok. 15 minut",
    needs: "Medusa 2.12 lub nowsza; klucz GUS BIR 1.1 tylko dla trybu produkcyjnego",
    stepsTitle: "Kroki",
    stepsSub: "Wszystko, co trzeba zrobić, żeby panel działał w Twoim sklepie.",
    s1Title: "Zainstaluj wtyczkę",
    s1Text: "Menedżerem pakietów swojego projektu:",
    s2Title: "Zarejestruj w medusa-config.ts",
    s2Text: "Dodaj wpis do listy plugins, nie ruszając tego, co już tam jest. Każda opcja ma wartość domyślną, więc wtyczka startuje bez żadnej:",
    s3Title: "Włącz tryb demo (opcjonalnie)",
    s3Text: "Demo działa tylko po jawnym włączeniu: sprawdzenia odpowiadają wtedy symulowanymi danymi z flagą demo i nic nie wychodzi na zewnątrz. Ustaw WHITELIST_DEMO=true w .env, nigdy w kodzie.",
    s4Title: "Uruchom i otwórz panel",
    s4Text: "Migracje tworzą tabele modułu: whitelist_entity i whitelist_check. Potem otwórz Białą listę w bocznym menu admina: sprawdź pierwszy NIP, a w trybie produkcyjnym podaj klucz GUS w opcjach.",
    s5Title: "Podepnij sklep",
    s5Text: "Trasa publiczna /store/whitelist/preview weryfikuje NIP przy rejestracji firmy, a /store/whitelist/me pokazuje status na koncie klienta. W sklepie demo Koda Plus oba są już podpięte.",
    checkTitle: "Lista przed startem",
    checkSub: "Wszystko odhaczone znaczy, że weryfikacja kontrahentów działa od rejestracji do zamówienia.",
    checklist: [
      "Formularz rejestracji podgląda firmę z białej listy przed wysłaniem konta do akceptacji",
      "Status VAT kontrahenta widoczny przy jego koncie w panelu",
      "Stare sprawdzenia odświeżane po staleHours, nie przy każdym odczycie",
      "W trybie produkcyjnym podany klucz GUS BIR 1.1",
    ],
    faqTitle: "Pytania",
    faq: [
      { q: "Czy weryfikacja działa też dla firm z UE?", a: "Tak. NIP-e europejskie (prefix kraju) sprawdza VIES, polskie biała lista MF, a dane rejestrowe GUS. Odpowiedź zawsze zapisuje się w historii sprawdzeń." },
      { q: "Jak często wtyczka pyta rejestry?", a: "Jedno sprawdzenie danego NIP-u ważne jest staleHours (domyślnie 24 godziny). Potem następne pytanie o ten NIP odpytuje rejestr ponownie." },
      { q: "Czy tryb demo coś wysyła na zewnątrz?", a: "Nie. Demo to wyłącznie symulowane odpowiedzi rejestrów w bazie, nic nie opuszcza serwera i żaden zewnętrzny serwis nie jest odpytuany." },
    ],
  }),
  en: typeset({
    introTitle: "Setup step by step",
    introText: "Install the plugin, register it in medusa-config.ts, run the migrations and open the panel. The tax ID check plugs into the registration form and the customer account, so counterparties confirm their own VAT status.",
    time: "about 15 minutes",
    needs: "Medusa 2.12 or newer; a GUS BIR 1.1 key only for production mode",
    stepsTitle: "Steps",
    stepsSub: "Everything it takes for the panel to work in your store.",
    s1Title: "Install the plugin",
    s1Text: "With your project's package manager:",
    s2Title: "Register it in medusa-config.ts",
    s2Text: "Add an entry to the plugins list without touching what is already there. Every option has a default, so the plugin starts without any:",
    s3Title: "Turn on demo mode (optional)",
    s3Text: "Demo mode runs only when switched on: checks then answer with simulated registry data flagged demo, and nothing leaves the server. Set WHITELIST_DEMO=true in .env, never in code.",
    s4Title: "Start it and open the panel",
    s4Text: "The migrations create the module's tables: whitelist_entity and whitelist_check. Then open Whitelist in the admin sidebar: check the first tax ID, and in production mode put the GUS key in the options.",
    s5Title: "Wire the storefront",
    s5Text: "The public route /store/whitelist/preview verifies the tax ID on company registration, and /store/whitelist/me shows the status on the customer account. The Koda Plus demo store has both already.",
    checkTitle: "The go-live checklist",
    checkSub: "All ticked means counterparty verification works from registration to order.",
    checklist: [
      "The registration form previews the company from the whitelist before the account is sent for approval",
      "The counterparty's VAT status shows on its page in the admin",
      "Old checks refresh after staleHours, not on every read",
      "In production mode the GUS BIR 1.1 key is set",
    ],
    faqTitle: "Questions",
    faq: [
      { q: "Does the check work for EU companies too?", a: "Yes. European tax IDs (country prefix) go to VIES, Polish ones to the MF whitelist, and the registry data to GUS. Every answer is kept in the check history." },
      { q: "How often does the plugin ask the registries?", a: "One check of a tax ID stays fresh for staleHours (24 hours by default). The next question about that tax ID asks the registry again." },
      { q: "Does demo mode call anything outside?", a: "No. Demo mode is only simulated registry answers in the database: nothing leaves the server and no outside service is asked." },
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
    { title: C.s1Title, text: C.s1Text, code: "npm install @koda-plus/medusa-plugin-vat-whitelist" },
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
