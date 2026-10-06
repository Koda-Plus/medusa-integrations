import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { InlineTip } from "@medusajs/ui"
import type { SubiektStatusResponse } from "../../modules/subiekt/lib/contract"
import { GUIDE_STEPS, guideChecks, guideStepStates, type GuideCheckKey, type GuideStepId } from "../../modules/subiekt/lib/guide"
import { GuideChecklist, GuideDiagram, GuideFaq, GuideIntro, GuideSteps, References, type DiagramNode, type GuideStep, type SetupPromptSpec } from "./subiekt-guide"
import { RichText, fmtRating, referencesFor } from "./subiekt-ui"

/*
 * The setup guide of the Subiekt page (?view=guide): from an empty Windows
 * machine to production. Every step and checklist tick reads the live status
 * the page already loaded, so the guide shows how far this store got.
 */

const LINKS = {
  insert: "https://www.insert.com.pl/programy_dla_firm/sprzedaz/subiekt_nexo_pro/opis.html",
  tunnel: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/",
  access: "https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/",
  dotnet: "https://dotnet.microsoft.com/download/dotnet/8.0",
}

/** PowerShell on the bridge machine: a secret, the installer, the read-only check. */
const SERVICE_CODE = [
  "$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString(\"x2\") })",
  ".\\deploy\\install-service.ps1 -ServiceUser \"SERWER\\integracja\"",
  "C:\\KodaSubiektBridge\\Koda.SubiektBridge.exe --check",
].join("\n")

const MEDUSA_CODE = `{
  resolve: "@koda-plus/medusa-plugin-subiekt-nexo",
  options: {
    bridgeUrl: process.env.SUBIEKT_BRIDGE_URL,
    secret: process.env.SUBIEKT_SECRET,
    cfAccessClientId: process.env.SUBIEKT_CF_ACCESS_CLIENT_ID,
    cfAccessClientSecret: process.env.SUBIEKT_CF_ACCESS_CLIENT_SECRET,
    stockLocationId: process.env.SUBIEKT_STOCK_LOCATION_ID,
    stockDryRun: true,
    salesDocument: "none",
    salesDocumentAfter: "wz",
    nipSources: ["metadata.nip", "billing_address.company"],
    priceWriter: false,
    createMissingProducts: false,
    createContractors: false,
  },
},

npx medusa db:migrate`

/**
 * The same setup as this guide (step "medusa"), for "Copy prompt" in the page
 * header. The bridge on the Windows machine is set up by a person (the guide's
 * first steps); the agent only does the Medusa side.
 */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("subiekt")
  return useMemo(() => {
    const needs = t("guide.intro.needs", { returnObjects: true }) as unknown
    return {
      service: "Subiekt nexo",
      pkg: "@koda-plus/medusa-plugin-subiekt-nexo",
      route: "/app/subiekt",
      summary: t("subtitle"),
      needs: Array.isArray(needs) ? (needs as string[]) : [],
      config: `// medusa-config.ts, in plugins: [ ... ]\n${MEDUSA_CODE}`,
      demo: 'demo: process.env.SUBIEKT_DEMO === "true" || !process.env.SUBIEKT_BRIDGE_URL,',
    }
  }, [t])
}

const CLOCK_CODE = "w32tm /resync"

const WRITERS_CODE = `priceWriter: true,
maxPriceChangesPerRun: 200,
createMissingProducts: true,
maxProductsPerRun: 20,`

const DOCUMENTS_CODE = `salesDocument: "auto",
salesDocumentAfter: "wz",
createContractors: true,`

export function GuideView({ status, lang }: { status: SubiektStatusResponse; lang: string }) {
  const { t } = useTranslation("subiekt")

  /** Arrays and objects of the guide copy, as i18next returns them. */
  function list<T>(key: string): T[] {
    const value = t(key, { returnObjects: true }) as unknown
    return Array.isArray(value) ? (value as T[]) : []
  }
  const paragraphs = (key: string) =>
    list<string>(key).map((p, i) => (
      <p key={i}>
        <RichText text={p} />
      </p>
    ))

  const checks = guideChecks(status)
  const states = guideStepStates(status)
  const extras: Partial<Record<GuideStepId, Partial<GuideStep>>> = {
    sdk: { link: { label: t("guide.links.sdk"), href: LINKS.insert } },
    service: { code: SERVICE_CODE, link: { label: t("guide.links.dotnet"), href: LINKS.dotnet } },
    tunnel: { code: `curl https://subiekt-bridge.${t("guide.domain")}/healthz`, link: { label: t("guide.links.tunnel"), href: LINKS.tunnel } },
    access: { link: { label: t("guide.links.access"), href: LINKS.access } },
    medusa: { code: MEDUSA_CODE },
    connection: { code: CLOCK_CODE },
    documents: { code: DOCUMENTS_CODE },
    prices: { code: WRITERS_CODE },
  }
  const steps: GuideStep[] = GUIDE_STEPS.map((id) => ({
    id,
    title: t(`guide.steps.${id}.title`),
    state: states[id],
    body: paragraphs(`guide.steps.${id}.body`),
    check: t(`guide.steps.${id}.check`),
    ...extras[id],
  }))
  const s = status

  const nodes = list<DiagramNode>("guide.diagram.nodes").map((n, i) => ({ ...n, accent: i === 2 }))
  const faq = list<{ q: string; a: string[] }>("guide.faq.items").map((item) => ({
    q: item.q,
    a: (item.a ?? []).map((p, i) => (
      <p key={i}>
        <RichText text={p} />
      </p>
    )),
  }))
  const references = referencesFor(s.references, lang)

  return (
    <div className="flex flex-col gap-y-3">
      <GuideIntro
        title={t("guide.intro.title")}
        text={t("guide.intro.text")}
        time={t("guide.intro.time")}
        timeLabel={t("guide.intro.timeLabel")}
        needs={list<string>("guide.intro.needs")}
        needsLabel={t("guide.intro.needsLabel")}
      />
      {s.mode === "demo" ? (
        <InlineTip variant="info" label={t("demo.label")}>
          {t("guide.demoNote")}
        </InlineTip>
      ) : null}
      <GuideDiagram title={t("guide.diagram.title")} subtitle={t("guide.diagram.subtitle")} nodes={nodes} links={list<string>("guide.diagram.links")} />
      <GuideSteps
        title={t("guide.steps.title")}
        subtitle={t("guide.steps.subtitle")}
        steps={steps}
        stateLabels={{
          done: t("guide.steps.states.done"),
          todo: t("guide.steps.states.todo"),
          optional: t("guide.steps.states.optional"),
          later: t("guide.steps.states.later"),
        }}
        checkLabel={t("guide.steps.checkLabel")}
        copyLabel={t("guide.steps.copy")}
        copiedLabel={t("guide.steps.copied")}
      />
      <GuideChecklist
        title={t("guide.checklist.title")}
        subtitle={t("guide.checklist.subtitle")}
        items={(Object.keys(checks) as GuideCheckKey[]).map((key) => ({
          label: t(`guide.checklist.items.${key}.label`),
          hint: t(`guide.checklist.items.${key}.hint`),
          done: checks[key],
        }))}
      />
      <GuideFaq title={t("guide.faq.title")} items={faq} />
      <References
        items={references}
        title={t("references.title")}
        subtitle={t("references.subtitle")}
        openLabel={t("references.open")}
        soonLabel={t("references.soon")}
        reviewLabel={t("references.review")}
        ratingLabel={(value) => fmtRating(value, lang)}
      />
    </div>
  )
}
