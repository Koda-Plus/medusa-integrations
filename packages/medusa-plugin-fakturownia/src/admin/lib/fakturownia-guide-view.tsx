import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { StatusResponse } from "../../modules/fakturownia/lib/contract"
import { GuideChecklist, GuideDiagram, GuideFaq, GuideIntro, GuideSteps, References, type GuideStep, type SetupPromptSpec, type StepState } from "./fakturownia-guide"
import { fmtRating, referencesFor, sinceMonth } from "./fakturownia-ui"

/**
 * THE SETUP GUIDE: from a new Fakturownia account to production, with the
 * state of each step read from the module status (done, to do, optional,
 * later), the go-live checklist, and the failure modes we met in production.
 */

const CONFIG = `// medusa-config.ts
plugins: [
  {
    resolve: "@koda-plus/medusa-plugin-fakturownia",
    options: {
      apiToken: process.env.FAKTUROWNIA_API_TOKEN,
      account: process.env.FAKTUROWNIA_ACCOUNT, // "mojafirma"
      issuePlace: "Warszawa",
      // documentFlow: "proforma_then_vat",
      // trigger: "order_placed",
      // receiptForConsumers: true,
      // corrections: "plan",
      // writers: { corrections: true, emails: true, ksef: true },
      // emailPdf: true,
      // reminderAfterDays: 7,
    },
  },
],`

const INSTALL = `npm install @koda-plus/medusa-plugin-fakturownia
npx medusa db:migrate`

const ENV = `FAKTUROWNIA_API_TOKEN=...   # Ustawienia > Ustawienia konta > Integracja > Kod autoryzacyjny API
FAKTUROWNIA_ACCOUNT=mojafirma # https://mojafirma.fakturownia.pl`

/** What the store owner prepares, in the order of the guide. */
const NEEDS = ["account", "settings", "ksef", "medusa", "order"] as const

/** The same setup as this guide (steps "token" and "install"), for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("fakturownia")
  return useMemo(
    () => ({
      service: "Fakturownia",
      pkg: "@koda-plus/medusa-plugin-fakturownia",
      route: "/app/fakturownia",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `# .env\n${ENV}\n\n${CONFIG}`,
      demo: 'demo: process.env.FAKTUROWNIA_DEMO === "true" || !process.env.FAKTUROWNIA_API_TOKEN,',
    }),
    [t],
  )
}

const DEPARTMENTS = `departmentId: 123,
departmentsBySalesChannel: {
  "sc_01HB2B...": 456, // the wholesale channel sells as another company
},`

const PAYMENTS = `paymentTypes: { pp_stripe: "card", pp_payu: "payu" },
codProviders: ["pp_cod", "pp_cash"],
paymentTermDays: 14,`

const NIP = `nipSources: [
  "order.metadata.nip",
  "billing_address.metadata.nip",
  "billing_address.company", // "Firma sp. z o.o., NIP 123-456-32-18"
  { entity: "company", customerField: "customer_id", nipField: "nip", nameField: "name" },
],`

const STOREFRONT = `// A storefront account page (the customer is logged in)
const res = await fetch(
  \`\${MEDUSA_URL}/store/fakturownia/orders/\${orderId}/documents\`,
  {
    credentials: "include", // the session cookie, or:
    headers: {
      "x-publishable-api-key": PUBLISHABLE_KEY,
      // Authorization: \`Bearer \${customerToken}\`,
    },
  },
)
const { documents } = await res.json()
// documents[i].pdfUrl: GET it the same way (add ?download=1 for a download)`

export function GuideView({ status }: { status: StatusResponse }) {
  const { t, i18n } = useTranslation("fakturownia")
  const lang = i18n.language || "en"
  const live = status.mode === "live"
  const c = status.counts
  const o = status.options
  const writers = Object.values(status.writers)
  const writersDecided = writers.every((w) => !w.allowed || w.updatedAt !== null)

  const state = (done: boolean, otherwise: StepState = "todo"): StepState => (done ? "done" : otherwise)
  const p = (key: string, values?: Record<string, unknown>) => (
    <p key={key}>{t(key, values)}</p>
  )

  const steps: GuideStep[] = [
    {
      id: "account",
      title: t("guide.steps.account.title"),
      state: state(live && Boolean(status.account)),
      body: [p("guide.steps.account.p1"), p("guide.steps.account.p2")],
      link: { label: t("guide.steps.account.link"), href: "https://fakturownia.pl" },
      check: t("guide.steps.account.check"),
    },
    {
      id: "token",
      title: t("guide.steps.token.title"),
      state: state(live && status.tokenSet),
      body: [p("guide.steps.token.p1"), p("guide.steps.token.p2")],
      code: ENV,
      link: { label: t("guide.steps.token.link"), href: "https://github.com/fakturownia/API" },
      check: t("guide.steps.token.check"),
    },
    {
      id: "install",
      title: t("guide.steps.install.title"),
      state: state(live && status.configured),
      body: [p("guide.steps.install.p1"), p("guide.steps.install.p2")],
      code: `${INSTALL}\n\n${CONFIG}`,
      check: t("guide.steps.install.check"),
    },
    {
      id: "check",
      title: t("guide.steps.check.title"),
      state: state(live && Boolean(status.lastCheck?.ok)),
      body: [p("guide.steps.check.p1")],
      check: t("guide.steps.check.check"),
    },
    {
      id: "department",
      title: t("guide.steps.department.title"),
      state: o.departmentId !== null || o.departmentsBySalesChannel.length > 0 ? state(Boolean(status.lastCheck?.ok && status.lastCheck.departmentFound !== false)) : "optional",
      body: [p("guide.steps.department.p1"), p("guide.steps.department.p2")],
      code: DEPARTMENTS,
      check: t("guide.steps.department.check"),
    },
    {
      id: "ksef",
      title: t("guide.steps.ksef.title"),
      state: state(live && c.ksefAccepted > 0),
      body: [p("guide.steps.ksef.p1"), p("guide.steps.ksef.p2"), p("guide.steps.ksef.p3")],
      link: { label: t("guide.steps.ksef.link"), href: "https://github.com/fakturownia/API/blob/master/KSeF.md" },
      check: t("guide.steps.ksef.check"),
    },
    {
      id: "flow",
      title: t("guide.steps.flow.title"),
      state: state(status.configured),
      body: [
        p("guide.steps.flow.p1"),
        p("guide.steps.flow.p2"),
        p("guide.steps.flow.now", {
          flow: t(`connection.flows.${o.documentFlow}`),
          trigger: t(`connection.triggers.${o.trigger}`),
          consumers: o.receiptForConsumers ? t("connection.consumersReceipt", { kind: o.receiptKind }) : t("connection.consumersVat"),
        }),
      ],
      check: t("guide.steps.flow.check"),
    },
    {
      id: "payments",
      title: t("guide.steps.payments.title"),
      state: "optional",
      body: [p("guide.steps.payments.p1"), p("guide.steps.payments.p2")],
      code: PAYMENTS,
      check: t("guide.steps.payments.check"),
    },
    {
      id: "numbering",
      title: t("guide.steps.numbering.title"),
      state: "optional",
      body: [p("guide.steps.numbering.p1"), p("guide.steps.numbering.p2")],
      link: { label: t("guide.steps.numbering.link"), href: "https://invoiceocean-help.sugester.com/479474-Changing-the-format-of-invoice-numbering" },
      check: t("guide.steps.numbering.check"),
    },
    {
      id: "nip",
      title: t("guide.steps.nip.title"),
      state: "optional",
      body: [p("guide.steps.nip.p1"), p("guide.steps.nip.p2", { sources: o.nipSources.join(", ") })],
      code: NIP,
      check: t("guide.steps.nip.check"),
    },
    {
      id: "test",
      title: t("guide.steps.test.title"),
      state: state(live && c.issued > 0),
      body: [p("guide.steps.test.p1"), p("guide.steps.test.p2")],
      check: t("guide.steps.test.check"),
    },
    {
      id: "writers",
      title: t("guide.steps.writers.title"),
      state: writersDecided && writers.some((w) => w.updatedAt) ? "done" : "later",
      body: [p("guide.steps.writers.p1"), p("guide.steps.writers.p2")],
      code: `writers: { corrections: true, emails: true, ksef: false }, // false: never, whatever the admin says`,
      check: t("guide.steps.writers.check"),
    },
    {
      id: "storefront",
      title: t("guide.steps.storefront.title"),
      state: "optional",
      body: [p("guide.steps.storefront.p1"), p("guide.steps.storefront.p2")],
      code: STOREFRONT,
      check: t("guide.steps.storefront.check"),
    },
  ]

  const checklist = [
    { label: t("guide.checklist.live"), done: live, hint: live ? undefined : t("guide.checklist.liveHint") },
    { label: t("guide.checklist.connection"), done: live && Boolean(status.lastCheck?.ok) },
    { label: t("guide.checklist.firstDocument"), done: live && c.issued > 0 },
    { label: t("guide.checklist.attention"), done: c.attention === 0, hint: c.attention > 0 ? t("guide.checklist.attentionHint", { count: c.attention }) : undefined },
    { label: t("guide.checklist.ksef"), done: live && c.ksefAccepted > 0 && c.ksefProblems === 0 },
    { label: t("guide.checklist.buyers"), done: c.buyerWarnings === 0, hint: c.buyerWarnings > 0 ? t("guide.checklist.buyersHint", { count: c.buyerWarnings }) : undefined },
    { label: t("guide.checklist.corrections"), done: c.correctionsOpen === 0 || o.corrections === "off" },
    { label: t("guide.checklist.writers"), done: writersDecided },
    { label: t("guide.checklist.payments"), done: o.markPaidOnCapture },
  ]

  const faq = ["auth", "rateLimit", "duplicate", "nip", "ksefRejected", "rounding", "currency", "unknown", "correctionRefused", "emailRefused", "pdf", "receiptReturn"].map((k) => ({
    q: t(`guide.faq.${k}.q`),
    a: [<p key="a1">{t(`guide.faq.${k}.a1`)}</p>, <p key="a2">{t(`guide.faq.${k}.a2`)}</p>],
  }))

  return (
    <div className="flex flex-col gap-y-3">
      <GuideIntro
        title={t("guide.intro.title")}
        text={t("guide.intro.text")}
        time={t("guide.intro.time")}
        timeLabel={t("guide.intro.timeLabel")}
        needsLabel={t("guide.intro.needsLabel")}
        needs={NEEDS.map((k) => t(`guide.intro.needs.${k}`))}
      />
      <GuideDiagram
        title={t("guide.diagram.title")}
        subtitle={t("guide.diagram.subtitle")}
        nodes={[
          { title: "Medusa", caption: t("guide.diagram.medusa") },
          { title: t("title") + " by Koda Plus", caption: t("guide.diagram.plugin"), accent: true },
          { title: "Fakturownia", caption: t("guide.diagram.fakturownia") },
          { title: "KSeF", caption: t("guide.diagram.ksef") },
        ]}
        links={[t("guide.diagram.link1"), t("guide.diagram.link2"), t("guide.diagram.link3")]}
      />
      <GuideSteps
        title={t("guide.stepsTitle")}
        subtitle={t("guide.stepsSubtitle")}
        steps={steps}
        stateLabels={{ done: t("guide.state.done"), todo: t("guide.state.todo"), optional: t("guide.state.optional"), later: t("guide.state.later") }}
        checkLabel={t("guide.checkLabel")}
        copyLabel={t("guide.copy")}
        copiedLabel={t("guide.copied")}
      />
      <GuideChecklist title={t("guide.checklist.title")} subtitle={t("guide.checklist.subtitle")} items={checklist} />
      <GuideFaq title={t("guide.faq.title")} items={faq} />
      <References
        items={referencesFor(status.references, lang)}
        title={t("references.title")}
        subtitle={t("references.subtitle")}
        openLabel={t("references.open")}
        sinceLabel={(since) => t("references.since", { date: sinceMonth(since, lang) })}
        reviewLabel={t("references.review")}
        ratingLabel={(value) => fmtRating(value, lang)}
      />
    </div>
  )
}
