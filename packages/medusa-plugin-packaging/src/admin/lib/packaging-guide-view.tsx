import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckCircleSolid, ChevronDownMini } from "@medusajs/icons"
import { Badge, Container, Heading, Text, clx } from "@medusajs/ui"
import { typeset } from "./packaging-typeset"

/**
 * The setup guide of the Packaging page (Panel | Setup guide). The same lean
 * shape in every Koda Plus module: what it takes, the steps with the code to
 * paste, the go-live checklist and a short FAQ. All copy lives here.
 */

const CONFIG = `module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-packaging",
      options: {
        // Everything is optional.
        gs1Prefix: "590123456789",
        demo: process.env.PACKAGING_DEMO === "true",
      },
    },
  ],
})`

const COPY = {
  pl: typeset({
    introTitle: "Wdrożenie krok po kroku",
    introText: "Zainstalujesz wtyczkę, zarejestrujesz ją w medusa-config.ts, uruchomisz migracje i otworzysz panel. Drabinkę opakowań podepniesz pod kartę produktu i koszyk, żeby klient hurtowy od razu widział minimum zamówienia, a etykiety SSCC liczyły się same.",
    time: "ok. 15 minut",
    needs: "Medusa 2.12 lub nowsza; prefiks GS1 dla etykiet SSCC",
    stepsTitle: "Kroki",
    stepsSub: "Wszystko, co trzeba zrobić, żeby panel działał w Twoim sklepie.",
    s1Title: "Zainstaluj wtyczkę",
    s1Text: "Menedżerem pakietów swojego projektu:",
    s2Title: "Zarejestruj w medusa-config.ts",
    s2Text: "Dodaj wpis do listy plugins, nie ruszając tego, co już tam jest. Każda opcja ma wartość domyślną, więc wtyczka startuje bez żadnej:",
    s3Title: "Włącz tryb demo (opcjonalnie)",
    s3Text: "Demo działa tylko po jawnym włączeniu: panel pokazuje wtedy przykładowe drabinki z flagą demo, obok prawdziwych danych sklepu. Ustaw PACKAGING_DEMO=true w .env, nigdy w kodzie.",
    s4Title: "Uruchom i otwórz panel",
    s4Text: "Migracje tworzą tabele modułu: packaging_product i packaging_unit. Potem otwórz Opakowania w bocznym menu admina: wpisz pierwszą drabinkę szt., karton, paleta z liczbą sztuk, EAN-ami i prefiksem SSCC.",
    s5Title: "Podepnij sklep",
    s5Text: "Trasa /store/packaging/products/:id zwraca drabinkę produktu dla karty produktu, a koszyk pilnuje minimum zamówienia i wielokrotności. W sklepie demo Koda Plus oba są już podpięte.",
    checkTitle: "Lista przed startem",
    checkSub: "Wszystko odhaczone znaczy, że zamówienia hurtowe składają się w pełnych opakowaniach zbiorczych.",
    checklist: [
      "Każdy produkt hurtowy ma drabinkę szt., karton, paleta",
      "Minimalne zamówienie i wielokrotność wpisane tam, gdzie to konieczne",
      "EAN-y kartonów zgodne z kodem na opakowaniu",
      "Prefiks GS1 ustawiony, etykiety SSCC liczą się z cyfrą kontrolną",
    ],
    faqTitle: "Pytania",
    faq: [
      { q: "Czy karton i paleta muszą być zawsze?", a: "Nie. Drabinka może mieć tylko sztuki, albo sztuki i karton. Paleta jest opcjonalna; pole liczby sztuk zostaw puste, a jednostka zniknie z oferty." },
      { q: "Skąd bierze się cyfra kontrolna SSCC?", a: "Wtyczka liczy ją według GS1-128 z numeru seryjnego palety, bez zapisywania czegokolwiek. Trasa /admin/packaging/sscc zwraca gotowy numer etykiety." },
      { q: "Czy tryb demo coś wysyła na zewnątrz?", a: "Nie. Demo to wyłącznie przykładowe drabinki w bazie, nic nie opuszcza serwera." },
    ],
  }),
  en: typeset({
    introTitle: "Setup step by step",
    introText: "Install the plugin, register it in medusa-config.ts, run the migrations and open the panel. The packaging ladder plugs into the product card and the cart, so wholesale customers see the MOQ right away and SSCC labels add up on their own.",
    time: "about 15 minutes",
    needs: "Medusa 2.12 or newer; a GS1 prefix for the SSCC labels",
    stepsTitle: "Steps",
    stepsSub: "Everything it takes for the panel to work in your store.",
    s1Title: "Install the plugin",
    s1Text: "With your project's package manager:",
    s2Title: "Register it in medusa-config.ts",
    s2Text: "Add an entry to the plugins list without touching what is already there. Every option has a default, so the plugin starts without any:",
    s3Title: "Turn on demo mode (optional)",
    s3Text: "Demo mode runs only when switched on: the panel then shows sample ladders flagged demo, next to the store's real data. Set PACKAGING_DEMO=true in .env, never in code.",
    s4Title: "Start it and open the panel",
    s4Text: "The migrations create the module's tables: packaging_product and packaging_unit. Then open Packaging in the admin sidebar: enter the first piece, box, pallet ladder with the piece counts, EANs and the SSCC prefix.",
    s5Title: "Wire the storefront",
    s5Text: "The /store/packaging/products/:id route returns a product's ladder for the product card, and the cart keeps the MOQ and the step. The Koda Plus demo store has both already.",
    checkTitle: "The go-live checklist",
    checkSub: "All ticked means wholesale orders come in full collective packages.",
    checklist: [
      "Every wholesale product has a piece, box, pallet ladder",
      "MOQ and step filled in where they matter",
      "Box EANs match the code on the package",
      "GS1 prefix set, SSCC labels compute with the check digit",
    ],
    faqTitle: "Questions",
    faq: [
      { q: "Do the box and pallet always have to be there?", a: "No. The ladder can be pieces only, or pieces and a box. The pallet is optional: leave its piece count empty and the unit disappears from the offer." },
      { q: "Where does the SSCC check digit come from?", a: "The plugin computes it per GS1-128 from the pallet's serial number, without writing anything. The /admin/packaging/sscc route returns the finished label number." },
      { q: "Does demo mode call anything outside?", a: "No. Demo mode is only sample ladders in the database: nothing leaves the server." },
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
    { title: C.s1Title, text: C.s1Text, code: "npm install @koda-plus/medusa-plugin-packaging" },
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
