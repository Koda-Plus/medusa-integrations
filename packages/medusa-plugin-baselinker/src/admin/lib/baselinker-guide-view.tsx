import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { InlineTip } from "@medusajs/ui"
import type { StatusResponse } from "../../modules/baselinker/lib/contract"
import { GuideChecklist, GuideDiagram, GuideFaq, GuideIntro, GuideSteps, type GuideStep, type SetupPromptSpec, type StepState } from "./baselinker-guide"
import { ReferencesBlock } from "./baselinker-panel"

/*
 * "Setup guide" view of the BaseLinker page: what the integration does, how
 * the parts talk, the steps from zero to production with a live state each,
 * the go-live checklist, troubleshooting from real failure modes, and the
 * stores running it. Every state comes from the status the page already
 * loaded: the guide never calls BaseLinker.
 */

const CONFIG = `// medusa-config.ts
plugins: [
  {
    resolve: "@koda-plus/medusa-plugin-baselinker",
    options: {
      apiToken: process.env.BASELINKER_API_TOKEN,
      inventoryId: process.env.BASELINKER_INVENTORY_ID, // a catalog, not the old storage
      warehouseId: process.env.BASELINKER_WAREHOUSE_ID, // bl_ plus the id, like bl_1234
      orderStatusId: process.env.BASELINKER_ORDER_STATUS_ID,
      customSourceId: process.env.BASELINKER_SOURCE_ID,
      priceGroupId: process.env.BASELINKER_PRICE_GROUP_ID,
      catalogSource: "medusa", // or "baselinker"
      stockSource: "baselinker", // or "medusa"
      stockSync: "plan", // "write" lets a stock writer be armed
    },
  },
]

// then
npx medusa db:migrate`

const IDS = `fulfillOnStatusIds: [<shipped>],
closedStatusIds: [<delivered>, <cancelled>],
orderImportCancelStatusIds: [<cancelled>],`

const ORDERS = `orderImportSources: ["allegro", "amazon:7245"],
orderImportRegionId: "reg_...", // default: the region of the order currency
orderImportSalesChannelId: "sc_...", // default: the store's default channel`

const INVOICES = `invoiceNumberField: "extra_field_1", // or "extra_field_2", or a custom field id: "custom:135"
invoiceNumberKinds: ["vat", "receipt"],`

const TOKEN = "BASELINKER_API_TOKEN=your-token"

/** The same setup as this guide (steps "token" and "options"), for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("baselinker")
  return useMemo(() => {
    const needs = t("guide.intro.needs", { returnObjects: true }) as unknown
    return {
      service: "BaseLinker",
      pkg: "@koda-plus/medusa-plugin-baselinker",
      route: "/app/baselinker",
      summary: t("subtitle"),
      needs: Array.isArray(needs) ? (needs as string[]) : [],
      config: `${TOKEN}\n\n${CONFIG}`,
      demo: 'demo: process.env.BASELINKER_DEMO === "true",',
    }
  }, [t])
}

export function GuideView({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("baselinker")
  const demo = status.mode === "demo"
  const check = status.lastCheck
  const writers = status.writers
  const armedByPerson = writers.filter((w) => w.armed && w.armedBy === "admin")
  const writer = (key: string) => writers.find((w) => w.key === key)
  const runs = status.lastRuns
  const planRun = runs.catalog_import ?? runs.cards ?? runs.stock ?? runs.stock_push ?? runs.prices
  const catalogOk = Boolean(check?.ok && check.inventoryFound !== false && check.warehouseFound !== false) || (demo && Boolean(runs.catalog))

  const state = (done: boolean, otherwise: StepState = "todo"): StepState => (done ? "done" : otherwise)
  const steps: GuideStep[] = [
    {
      id: "token",
      title: t("guide.steps.token.title"),
      state: state(status.tokenSet || demo),
      body: <p>{t("guide.steps.token.body")}</p>,
      code: TOKEN,
      link: { label: t("guide.steps.token.link"), href: "https://api.baselinker.com/" },
      check: t("guide.steps.token.check"),
    },
    {
      id: "options",
      title: t("guide.steps.options.title"),
      state: state(status.configured),
      body: <p>{t("guide.steps.options.body")}</p>,
      code: CONFIG,
      check: t("guide.steps.options.check"),
    },
    {
      id: "catalog",
      title: t("guide.steps.catalog.title"),
      state: state(catalogOk),
      body: <p>{t("guide.steps.catalog.body")}</p>,
      link: { label: "getInventories, getInventoryWarehouses", href: "https://api.baselinker.com/index.php?method=getInventoryWarehouses" },
      check: t("guide.steps.catalog.check"),
    },
    {
      id: "ids",
      title: t("guide.steps.ids.title"),
      state: state(demo || (status.more.priceGroupId !== null && status.options.orderStatusId !== null)),
      body: <p>{t("guide.steps.ids.body")}</p>,
      code: IDS,
      link: { label: "getInventoryPriceGroups, getOrderStatusList", href: "https://api.baselinker.com/index.php?method=getInventoryPriceGroups" },
      check: t("guide.steps.ids.check"),
    },
    {
      id: "source",
      title: t("guide.steps.source.title"),
      state: state(status.options.customSourceId !== null || demo, "optional"),
      body: <p>{t("guide.steps.source.body")}</p>,
      link: { label: "Base: custom order sources", href: "https://base.com/en-EN/help/knowledgebase/custom-order-sources/" },
      check: t("guide.steps.source.check"),
    },
    {
      id: "truth",
      title: t("guide.steps.truth.title"),
      state: state(Boolean(runs.catalog) && status.counts.conflicts === 0),
      body: <p>{t("guide.steps.truth.body")}</p>,
      check: t("guide.steps.truth.check"),
    },
    {
      id: "dry-run",
      title: t("guide.steps.dryRun.title"),
      state: state(Boolean(planRun)),
      body: <p>{t("guide.steps.dryRun.body")}</p>,
      check: t("guide.steps.dryRun.check"),
    },
    {
      id: "arm",
      title: t("guide.steps.arm.title"),
      state: state(armedByPerson.some((w) => w.live), "later"),
      body: <p>{t("guide.steps.arm.body")}</p>,
      check: t("guide.steps.arm.check"),
    },
    {
      id: "orders",
      title: t("guide.steps.orders.title"),
      state: status.features2.orderImport ? state(Boolean(writer("orderImport")?.live)) : "optional",
      body: <p>{t("guide.steps.orders.body")}</p>,
      code: ORDERS,
      check: t("guide.steps.orders.check"),
    },
    {
      id: "invoices",
      title: t("guide.steps.invoices.title"),
      state: state(Boolean(writer("invoiceNumbers")?.live), "optional"),
      body: <p>{t("guide.steps.invoices.body")}</p>,
      code: INVOICES,
      link: { label: "setOrderFields, getOrderExtraFields", href: "https://api.baselinker.com/index.php?method=setOrderFields" },
      check: t("guide.steps.invoices.check"),
    },
    {
      id: "golive",
      title: t("guide.steps.golive.title"),
      state: "later",
      body: <p>{t("guide.steps.golive.body")}</p>,
    },
  ]

  const checklist: Array<{ label: string; done: boolean; hint?: string }> = [
    { label: t("guide.checklist.connection"), done: catalogOk },
    { label: t("guide.checklist.firstRead"), done: runs.catalog?.status === "ok" && runs.catalog.complete },
    {
      label: t("guide.checklist.conflicts"),
      done: Boolean(runs.catalog) && status.counts.conflicts === 0,
      hint: status.counts.conflicts > 0 ? t("guide.checklist.conflictsLeft", { count: status.counts.conflicts }) : undefined,
    },
    { label: t("guide.checklist.plans"), done: Boolean(planRun) },
    {
      label: t("guide.checklist.armed"),
      done: armedByPerson.length > 0,
      hint: armedByPerson.length > 0 ? t("guide.checklist.armedList", { list: armedByPerson.map((w) => t(`directions.writers.${w.key}`)).join(", ") }) : undefined,
    },
    { label: t("guide.checklist.quarantine"), done: status.counts2.quarantined === 0 },
    { label: t("guide.checklist.ordersOut"), done: status.counts.ordersSent > 0 },
    { label: t("guide.checklist.statuses"), done: Boolean(runs.statuses) && runs.statuses?.status !== "error" },
    { label: t("guide.checklist.journal"), done: status.journal.state === "active" || status.journal.state === "demo" },
    ...(status.features2.orderImport ? [{ label: t("guide.checklist.emails"), done: false, hint: t("guide.checklist.emailsHint") }] : []),
    { label: t("guide.checklist.alerts"), done: status.counts.ordersFailed === 0 && status.counts2.imports.failed === 0 },
  ]

  const needs = t("guide.intro.needs", { returnObjects: true }) as unknown as string[]
  const faq = t("guide.faq.items", { returnObjects: true }) as unknown as Array<{ q: string; a: string }>

  return (
    <div className="flex flex-col gap-y-3">
      {demo ? (
        <InlineTip variant="info" label={t("demo.label")}>
          {t("guide.demoNote")}
        </InlineTip>
      ) : null}
      <GuideIntro
        title={t("guide.intro.title")}
        text={t("guide.intro.text")}
        time={t("guide.intro.time")}
        needs={Array.isArray(needs) ? needs : []}
        needsLabel={t("guide.needsLabel")}
        timeLabel={t("guide.timeLabel")}
      />
      <GuideDiagram
        title={t("guide.diagram.title")}
        subtitle={t("guide.diagram.subtitle")}
        nodes={[
          { title: t("guide.diagram.nodes.marketplaces"), caption: t("guide.diagram.nodes.marketplacesCaption") },
          { title: t("guide.diagram.nodes.baselinker"), caption: t("guide.diagram.nodes.baselinkerCaption") },
          { title: t("guide.diagram.nodes.plugin"), caption: t("guide.diagram.nodes.pluginCaption"), accent: true },
          { title: t("guide.diagram.nodes.medusa"), caption: t("guide.diagram.nodes.medusaCaption") },
        ]}
        links={[t("guide.diagram.links.one"), t("guide.diagram.links.two"), t("guide.diagram.links.three")]}
      />
      <GuideSteps
        title={t("guide.steps.title")}
        subtitle={t("guide.steps.subtitle")}
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
      <GuideChecklist title={t("guide.checklist.title")} subtitle={t("guide.checklist.subtitle")} items={checklist} />
      <GuideFaq title={t("guide.faq.title")} items={(Array.isArray(faq) ? faq : []).map((f) => ({ q: f.q, a: <p>{f.a}</p> }))} />
      <ReferencesBlock status={status} lang={lang} />
    </div>
  )
}
