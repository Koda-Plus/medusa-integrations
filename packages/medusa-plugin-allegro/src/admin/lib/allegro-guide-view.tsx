import { useTranslation } from "react-i18next"
import type { AllegroStatusResponse, AllegroWriterKey } from "../../modules/allegro/lib/contract"
import { pickText, sinceLabel } from "../../modules/allegro/lib/references"
import {
  GuideChecklist,
  GuideDiagram,
  GuideFaq,
  GuideIntro,
  GuideSteps,
  References,
  type GuideStep,
  type Reference,
  type StepState,
} from "./allegro-guide"
import { fmtRating } from "./allegro-ui"

/** References of the options, in the admin language, shaped for the kit. */
export function referencesFor(status: AllegroStatusResponse, lang: string): Reference[] {
  return status.references.map((r) => ({
    name: r.name,
    url: r.url,
    icon: r.icon,
    description: pickText(r.description, lang) || undefined,
    since: r.since ?? undefined,
    metrics: r.metrics.map((m) => ({ label: pickText(m.label, lang), value: m.value })),
    links: r.links.map((l) => ({ label: pickText(l.label, lang), url: l.url })),
    review: r.review ? { ...r.review, quote: pickText(r.review.quote, lang) || undefined } : null,
  }))
}

/** "Running in production" cards, at the end of the guide; the page header has the badge. */
export function ReferencesBlock({ status, lang }: { status: AllegroStatusResponse; lang: string }) {
  const { t } = useTranslation("allegro")
  return (
    <References
      items={referencesFor(status, lang)}
      title={t("references.title")}
      subtitle={t("references.subtitle")}
      openLabel={t("references.open")}
      sinceLabel={(since) => sinceLabel(since, lang)}
      reviewLabel={t("references.review")}
      ratingLabel={(value) => fmtRating(value, lang)}
    />
  )
}

const CODE = {
  key: `openssl rand -base64 32

# .env
ALLEGRO_CLIENT_ID=your-client-id
ALLEGRO_CLIENT_SECRET=your-client-secret
ALLEGRO_ENCRYPTION_KEY=the-32-bytes-from-openssl`,
  options: `// medusa-config.ts
plugins: [
  {
    resolve: "@koda-plus/medusa-plugin-allegro",
    options: {
      clientId: process.env.ALLEGRO_CLIENT_ID,
      clientSecret: process.env.ALLEGRO_CLIENT_SECRET,
      encryptionKey: process.env.ALLEGRO_ENCRYPTION_KEY,
      environment: "production", // or "sandbox"
      appName: "MyShopAllegro", // the name of your app at Allegro
      docsUrl: "https://myshop.example/allegro",
    },
  },
],

npx medusa db:migrate`,
  sandbox: `environment: "sandbox",`,
  allow: `writes: {
  orders: true,   // Allegro orders into Medusa
  stock: true,    // lower Allegro quantities, end sold-out offers
  shipping: true, // tracking numbers and seller status
  invoices: true, // invoice PDFs on Allegro orders
  prices: false,
  publish: false,
},`,
  orders: `orderImport: {
  salesChannelId: "sc_...",   // a sales channel for Allegro orders
  regionId: "reg_...",        // a region in PLN
  shippingOptionId: "so_...", // optional, put on every imported order
},`,
  stock: `stockPush: "decrease", // or "mirror"
stockPushCap: 50,
endOffersAtZero: true,
stockLocationIds: ["sloc_..."], // optional`,
  shipping: `carriers: {
  manual_manual: "OTHER",
  inpost_inpost: "INPOST",
},`,
  invoices: `invoiceKinds: ["vat", "correction"],

// Another invoicing tool: emit this event for an imported order
const eventBus = container.resolve(Modules.EVENT_BUS)
await eventBus.emit({
  name: "allegro.invoice.attach.requested",
  data: { order_id, filename: "FV_12_10_2026.pdf", url: "https://...", number: "FV 12/10/2026" },
})`,
  issues: `issues: { returns: true, disputes: true, messages: true },`,
  prices: `prices: { cap: 20, maxChangePercent: 30, requireFloor: true },

// variant (or product) metadata
{ "allegro_price_min": "89.00", "allegro_price_max": "149.00" }`,
  publish: `publish: {
  shippingRatesId: "Standard", // id or name of a shipping rates set
  location: { city: "Warszawa", postCode: "00-001", province: "MAZOWIECKIE" },
  cap: 5,
},`,
}

function Paragraphs({ items }: { items: string[] }) {
  return (
    <>
      {items.map((p) => (
        <p key={p}>{p}</p>
      ))}
    </>
  )
}

export function GuideView({ status, lang }: { status: AllegroStatusResponse; lang: string }) {
  const { t } = useTranslation("allegro")
  const s = status
  const live = s.mode === "live"
  const writer = (k: AllegroWriterKey) => s.writers.find((w) => w.key === k)
  const writerState = (k: AllegroWriterKey, optional = false): StepState => {
    const w = writer(k)
    if (w?.effective) return "done"
    if (!w?.allowed) return optional ? "optional" : "later"
    return "todo"
  }
  const list = (key: string): string[] => {
    const v = t(key, { returnObjects: true }) as unknown
    return Array.isArray(v) ? (v as string[]) : []
  }
  const step = (id: string, state: StepState, extra: Partial<GuideStep> = {}): GuideStep => ({
    id,
    title: t(`guide.steps.${id}.title`),
    state,
    body: <Paragraphs items={list(`guide.steps.${id}.body`)} />,
    check: t(`guide.steps.${id}.check`),
    ...extra,
  })

  const sandboxApps = "https://apps.developer.allegro.pl.allegrosandbox.pl"
  const productionApps = "https://apps.developer.allegro.pl"
  const keyMissing = s.missing.some((m) => m.startsWith("encryptionKey"))
  const anyAllowed = s.writers.some((w) => w.allowed)
  const lastOffers = s.lastRuns.offers ?? null

  const steps: GuideStep[] = [
    step("register", live && !s.missing.some((m) => m === "clientId" || m === "clientSecret") ? "done" : "todo", {
      link: { label: t("guide.steps.register.link"), href: productionApps },
    }),
    step("sandbox", live && s.environment === "sandbox" ? "done" : "optional", {
      link: { label: t("guide.steps.sandbox.link"), href: sandboxApps },
      code: CODE.sandbox,
    }),
    step("key", live && !keyMissing && s.configured ? "done" : "todo", { code: CODE.key }),
    step("options", live && s.configured ? "done" : "todo", { code: CODE.options }),
    step("connect", s.connection.connected ? "done" : "todo"),
    step("sync", lastOffers?.status === "ok" ? "done" : "todo"),
    step("links", lastOffers && s.counts.unmatchedLive === 0 ? "done" : "todo"),
    step("stockCheck", s.plans.stock.plannedAt && !s.plans.stock.refused ? "done" : "todo"),
    step("allow", anyAllowed && (s.mode === "demo" || (s.connection.connected && s.missingScopes.length === 0)) ? "done" : "todo", { code: CODE.allow }),
    step("orders", writerState("orders"), { code: CODE.orders }),
    step("stock", writerState("stock"), { code: CODE.stock }),
    step("shipping", writerState("shipping"), { code: CODE.shipping }),
    step("invoices", writerState("invoices"), { code: CODE.invoices }),
    step("issues", s.lastRuns.issues?.status === "ok" ? "done" : "optional", { code: CODE.issues }),
    step("prices", writerState("prices", true), { code: CODE.prices }),
    step("publish", writerState("publish", true), { code: CODE.publish }),
  ]

  const checklist = [
    { key: "connected", done: s.connection.connected && s.missingScopes.length === 0 },
    { key: "offersComplete", done: Boolean(lastOffers?.complete) },
    { key: "linked", done: Boolean(lastOffers) && s.counts.unmatchedLive === 0 },
    { key: "stockPlanned", done: Boolean(s.plans.stock.plannedAt) && !s.plans.stock.refused },
    { key: "importReviewed", done: Boolean(s.lastRuns.import) },
    { key: "armedByPerson", done: !s.writers.some((w) => w.trippedAt && !w.armed) },
    { key: "noHeld", done: s.imports.held === 0 },
    { key: "outboxClean", done: s.outbox.shipping.failed + s.outbox.invoices.failed === 0 },
    { key: "issuesRead", done: s.lastRuns.issues?.status === "ok" },
    { key: "userAgent", done: Boolean(s.appName) },
  ].map((c) => ({
    label: t(`guide.checklist.${c.key}`),
    done: c.done,
    hint: t(`guide.checklistHints.${c.key}`, { defaultValue: "" }) || undefined,
  }))

  const faq = (t("guide.faq", { returnObjects: true }) as unknown as Array<{ q: string; a: string[] }>) ?? []

  return (
    <div className="flex flex-col gap-y-3">
      <GuideIntro
        title={t("guide.introTitle")}
        text={t("guide.introText")}
        time={t("guide.time")}
        timeLabel={t("guide.timeLabel")}
        needs={list("guide.needs")}
        needsLabel={t("guide.needsLabel")}
      />
      <GuideDiagram
        title={t("guide.diagramTitle")}
        subtitle={t("guide.diagramSubtitle")}
        nodes={[
          { title: t("guide.nodes.marketplace.title"), caption: t("guide.nodes.marketplace.caption") },
          { title: t("guide.nodes.api.title"), caption: t("guide.nodes.api.caption") },
          { title: t("guide.nodes.plugin.title"), caption: t("guide.nodes.plugin.caption"), accent: true },
          { title: t("guide.nodes.medusa.title"), caption: t("guide.nodes.medusa.caption") },
          { title: t("guide.nodes.fakturownia.title"), caption: t("guide.nodes.fakturownia.caption") },
        ]}
        links={[t("guide.links.a"), t("guide.links.b"), t("guide.links.c"), t("guide.links.d")]}
      />
      <GuideSteps
        title={t("guide.stepsTitle")}
        subtitle={t("guide.stepsSubtitle")}
        steps={steps}
        stateLabels={{
          done: t("guide.stateLabels.done"),
          todo: t("guide.stateLabels.todo"),
          optional: t("guide.stateLabels.optional"),
          later: t("guide.stateLabels.later"),
        }}
        checkLabel={t("guide.checkLabel")}
        copyLabel={t("guide.copy")}
        copiedLabel={t("guide.copied")}
      />
      <GuideChecklist title={t("guide.checklistTitle")} subtitle={t("guide.checklistSubtitle")} items={checklist} />
      <GuideFaq title={t("guide.faqTitle")} items={faq.map((f) => ({ q: f.q, a: <Paragraphs items={f.a} /> }))} />
      <ReferencesBlock status={status} lang={lang} />
    </div>
  )
}
