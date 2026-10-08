import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckCircleSolid, ChevronDownMini } from "@medusajs/icons"
import { Badge, Container, Heading, Text, clx } from "@medusajs/ui"
import { typeset } from "./compliance-typeset"

/**
 * The setup guide of the Compliance page (Panel | Setup guide). The same
 * lean shape in every Koda Plus module without an outside service: what it
 * takes, the steps with the code to paste, the go-live checklist and a
 * short FAQ. All copy lives here, translated with the page's language.
 */

const CONFIG = `module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-compliance",
      options: {
        // Everything is optional.
        demo: process.env.COMPLIANCE_DEMO === "true",
        sections: ["gpsr", "rodo", "omnibus"],
        consentPurposes: ["functional", "analytics", "marketing"],
      },
    },
  ],
})`

const COPY = {
  pl: typeset({
    introTitle: "Wdrożenie krok po kroku",
    introText: "Zainstalujesz wtyczkę, zarejestrujesz ją w medusa-config.ts, uruchomisz migracje i otworzysz panel. Dane GPSR, zgody RODO i historię cen podepniesz w sklepie jednym blokiem na stronę produktu i jedną sekcją na konto.",
    time: "ok. 15 minut",
    needs: "Medusa 2.12 lub nowsza, nic poza tym",
    stepsTitle: "Kroki",
    stepsSub: "Wszystko, co trzeba zrobić, żeby panel działał w Twoim sklepie.",
    s1Title: "Zainstaluj wtyczkę",
    s1Text: "Menedżerem pakietów swojego projektu:",
    s2Title: "Zarejestruj w medusa-config.ts",
    s2Text: "Dodaj wpis do listy plugins, nie ruszając tego, co już tam jest. Każda opcja ma wartość domyślną, więc wtyczka startuje bez żadnej:",
    s3Title: "Włącz tryb demo (opcjonalnie)",
    s3Text: "Demo działa tylko po jawnym włączeniu: panel pokazuje wtedy przykładowe rekordy z flagą demo, obok prawdziwych danych sklepu. Ustaw COMPLIANCE_DEMO=true w .env, nigdy w kodzie.",
    s4Title: "Uruchom i otwórz panel",
    s4Text: "Migracje tworzą tabele modułu. Potem otwórz Zgodność w bocznym menu admina: podmioty GPSR, kolejka żądań RODO i historia cen Omnibus, w jednym panelu.",
    s5Title: "Podepnij sklep",
    s5Text: "Na stronę produktu dodaj blok bezpieczeństwa GPSR, a na konto klienta sekcję żądań RODO; oba czytają z tras /store wtyczki. W sklepie demo Koda Plus oba są już podpięte.",
    checkTitle: "Lista przed startem",
    checkSub: "Wszystko odhaczone znaczy, że sklep sprzedaje zgodnie z GPSR, RODO i Omnibus.",
    checklist: [
      "Producent i osoba odpowiedzialna uzupełnieni dla produktów sprzedawanych w UE",
      "Ostrzeżenia i informacje o bezpieczeństwie po polsku i angielsku",
      "Migawki cen zbierane codziennie, promocje pokazują najniższą cenę z 30 dni",
      "Klienci mogą złożyć żądanie RODO z poziomu swojego konta",
    ],
    faqTitle: "Pytania",
    faq: [
      { q: "Czy mogę wyłączyć sekcję, której nie potrzebuję?", a: "Tak. Opcja sections wyłącza całą sekcję w panelu i w API. Podaj tylko te, których używasz, na przykład [\"gpsr\", \"omnibus\"]." },
      { q: "Skąd oferta wie, kto jest producentem?", a: "Stąd: produkt łączy się z podmiotami w panelu. Sklep czyta dane z /store/compliance/products/:id i sam je renderuje, bez zmian w katalogu Medusy." },
      { q: "Czy tryb demo coś wysyła na zewnątrz?", a: "Nie. Demo to wyłącznie przykładowe rekordy w bazie, nic nie opuszcza serwera i żaden zewnętrzny serwis nie jest odpytuany." },
    ],
  }),
  en: typeset({
    introTitle: "Setup step by step",
    introText: "Install the plugin, register it in medusa-config.ts, run the migrations and open the panel. The GPSR data, RODO consents and price history plug into the storefront with one block per product page and one section per account.",
    time: "about 15 minutes",
    needs: "Medusa 2.12 or newer, nothing else",
    stepsTitle: "Steps",
    stepsSub: "Everything it takes for the panel to work in your store.",
    s1Title: "Install the plugin",
    s1Text: "With your project's package manager:",
    s2Title: "Register it in medusa-config.ts",
    s2Text: "Add an entry to the plugins list without touching what is already there. Every option has a default, so the plugin starts without any:",
    s3Title: "Turn on demo mode (optional)",
    s3Text: "Demo mode runs only when switched on: the panel then shows sample records flagged demo, next to the store's real data. Set COMPLIANCE_DEMO=true in .env, never in code.",
    s4Title: "Start it and open the panel",
    s4Text: "The migrations create the module's tables. Then open Compliance in the admin sidebar: the GPSR operators, the RODO request queue and the Omnibus price history, in one panel.",
    s5Title: "Wire the storefront",
    s5Text: "Add the GPSR safety block to the product page and the data request section to the customer account; both read the plugin's /store routes. The Koda Plus demo store has both already.",
    checkTitle: "The go-live checklist",
    checkSub: "All ticked means the store sells in line with GPSR, RODO and Omnibus.",
    checklist: [
      "Manufacturer and responsible person filled in for products sold in the EU",
      "Warnings and safety information in Polish and English",
      "Price snapshots captured daily, promotions show the lowest price of the last 30 days",
      "Customers can file a data request from their own account",
    ],
    faqTitle: "Questions",
    faq: [
      { q: "Can I switch a section off if I do not need it?", a: "Yes. The sections option switches a whole section off in the panel and the API. List only the ones you use, for example [\"gpsr\", \"omnibus\"]." },
      { q: "How does the offer know who made the product?", a: "From here: the product links to the operators in the panel. The storefront reads /store/compliance/products/:id and renders the data itself, without touching the Medusa catalog." },
      { q: "Does demo mode call anything outside?", a: "No. Demo mode is only sample rows in the database: nothing leaves the server and no outside service is asked." },
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
    { title: C.s1Title, text: C.s1Text, code: "npm install @koda-plus/medusa-plugin-compliance" },
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
