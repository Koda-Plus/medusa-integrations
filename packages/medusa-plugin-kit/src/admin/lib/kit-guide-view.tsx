import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckCircleSolid, ChevronDownMini } from "@medusajs/icons"
import { Badge, Container, Heading, Text, clx } from "@medusajs/ui"
import { typeset } from "./kit-typeset"

/**
 * The setup guide of the Kit page (Panel | Setup guide). The same lean shape
 * in every Koda Plus module: what it takes, the steps with the code to
 * paste, the go-live checklist and a short FAQ. All copy lives here.
 */

const CONFIG = `module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-kit",
      options: {
        // Everything is optional.
        apiKey: process.env.KIT_API_KEY,
        source: "Mój Sklep",
      },
    },
  ],
})`

const COPY = {
  pl: typeset({
    introTitle: "Wdrożenie krok po kroku",
    introText: "Zarejestrujesz wtyczkę, podasz klucz API Kita i ustawisz listę w panelu. Formularz newslettera w sklepie zapisuje adresy wprost do Kita - z tagami i podwójnym potwierdzeniem, dokładnie tak, jak klient prowadzi listę do tej pory.",
    time: "ok. 10 minut",
    needs: "Medusa 2.12 lub nowsza; konto Kit (dawniej ConvertKit) z kluczem API V4",
    stepsTitle: "Kroki",
    stepsSub: "Wszystko, co trzeba zrobić, żeby newsletter sklepu trafiał do Kita.",
    s1Title: "Zainstaluj wtyczkę",
    s1Text: "Menedżerem pakietów swojego projektu:",
    s2Title: "Zarejestruj w medusa-config.ts",
    s2Text: "Dodaj wpis do listy plugins. Klucz idzie ze zmiennej środowiskowej, nigdy z kodu:",
    s3Title: "Utwórz klucz API w Kicie",
    s3Text: "W Kicie: Ustawienia, Developer, klucze API, dodaj nowy klucz V4. Wstaw go do KIT_API_KEY na backendzie. Klucz zostaje na serwerze - w logach i w panelu widać tylko jego końcówkę.",
    s4Title: "Ustaw listę w panelu",
    s4Text: "Otwórz Kit w menu admina: wybierz tagi dla nowych subskrybentów (np. sklep, newsletter) i, przy podwójnym potwierdzeniu, formularz Kita, który wyśle maila z potwierdzeniem.",
    s5Title: "Podepnij formularz sklepu",
    s5Text: "Formularz newslettera wysyła POST /store/kit/subscribe (e-mail, opcjonalnie imię). Trasa jest publiczna z limitem 5 zapisów na 10 minut na adres IP i grzecznie odpowiada, gdy klucz jeszcze nie wisi.",
    checkTitle: "Lista przed startem",
    checkSub: "Wszystko odhaczone znaczy, że newsletter sklepu chodzi na Kicie od formularza do listy.",
    checklist: [
      "KIT_API_KEY ustawiony na backendzie",
      "Tagi listy wybrane w panelu",
      "Podwójne potwierdzenie włączone razem z formularzem (gdy sklep go używa)",
      "Testowy zapis z formularza widoczny w logu i w Kicie",
    ],
    faqTitle: "Pytania",
    faq: [
      { q: "Czy zapis z formularza zdubluje subskrybenta?", a: "Nie. Kit traktuje utworzenie subskrybenta jako upsert po adresie e-mail, a tagowanie odpowiada 200, gdy tag już jest - powtórka nic nie zmienia na liście." },
      { q: "Jak działa podwójne potwierdzenie?", a: "Subskrybent powstaje w stanie inactive i trafia do wybranego formularza z podwójnym potwierdzeniem - Kit wysyła maila z potwierdzeniem, a dopiero po kliknięciu adres staje się aktywny." },
      { q: "Co, gdy Kita nie ma klucza?", a: "Wtyczka startuje dalej, formularz odpowiada 200 z informacją, że newsletter nie jest podłączony, a panel pokazuje brakującą opcję. Nic się nie wysypuje." },
    ],
  }),
  en: typeset({
    introTitle: "Setup step by step",
    introText: "Register the plugin, put in the Kit API key and pick the list settings in the panel. The storefront newsletter form signs addresses up straight into Kit - with tags and double opt-in, exactly how the client runs the list today.",
    time: "about 10 minutes",
    needs: "Medusa 2.12 or newer; a Kit account (formerly ConvertKit) with a V4 API key",
    stepsTitle: "Steps",
    stepsSub: "Everything it takes for the store's newsletter to land in Kit.",
    s1Title: "Install the plugin",
    s1Text: "With your project's package manager:",
    s2Title: "Register it in medusa-config.ts",
    s2Text: "Add an entry to the plugins list. The key comes from an environment variable, never from code:",
    s3Title: "Create the API key in Kit",
    s3Text: "In Kit: Settings, Developer, API keys, add a new V4 key. Put it in KIT_API_KEY on the backend. The key stays on the server - logs and the admin show only its ending.",
    s4Title: "Pick the list settings in the panel",
    s4Text: "Open Kit in the admin menu: choose the tags for new subscribers (for example: shop, newsletter) and, for double opt-in, the Kit form that sends the confirmation email.",
    s5Title: "Wire the storefront form",
    s5Text: "The newsletter form posts to /store/kit/subscribe (e-mail, optionally a first name). The route is public with a limit of 5 sign-ups per 10 minutes per address and answers politely while the key is missing.",
    checkTitle: "The go-live checklist",
    checkSub: "All ticked means the store's newsletter runs on Kit from the form to the list.",
    checklist: [
      "KIT_API_KEY set on the backend",
      "The list tags picked in the panel",
      "Double opt-in switched on together with the form (when the store uses it)",
      "A test sign-up from the form shows in the log and in Kit",
    ],
    faqTitle: "Questions",
    faq: [
      { q: "Will a repeated sign-up duplicate the subscriber?", a: "No. Kit's create is an upsert by email and tagging answers 200 when the tag is already there - a repeat changes nothing on the list." },
      { q: "How does double opt-in work?", a: "The subscriber is created in the inactive state and added to the chosen double opt-in form - Kit sends the confirmation email, and only the click makes the address active." },
      { q: "What happens without the Kit key?", a: "The plugin still starts, the form answers 200 saying the newsletter is not connected, and the panel lists the missing option. Nothing breaks." },
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

export function KitGuideView() {
  const { i18n } = useTranslation()
  const C = i18n.language?.startsWith("pl") ? COPY.pl : COPY.en
  const steps = [
    { title: C.s1Title, text: C.s1Text, code: "npm install @koda-plus/medusa-plugin-kit" },
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
