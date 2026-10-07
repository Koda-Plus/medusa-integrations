import { useTranslation } from "react-i18next"
import { Badge, Container, Heading, Table, Text } from "@medusajs/ui"
import type { CheckKey, StripeChecksResponse, StripeStatusResponse } from "../../modules/stripe/lib/contract"
import { CodeBlock } from "./stripe-guide"
import { ExternalLink, Fact, VerdictBadge, fmtNumber } from "./stripe-ui"

/*
 * Settings, behind the cog: the options in use (read only, they live in
 * medusa-config.ts), the checks with what each one reads, and the access a
 * restricted key needs. Nothing here can be changed from the admin: the
 * plugin keeps no settings of its own.
 */

export const SETTINGS_TABS = ["options", "checks", "access"] as const
export type SettingsTabId = (typeof SETTINGS_TABS)[number]

const CHECKS: CheckKey[] = ["provider", "key", "account", "capabilities", "webhook", "deliveries", "domains", "regions", "capture", "orphans"]

function OnOff({ on }: { on: boolean }) {
  const { t } = useTranslation("stripe")
  return (
    <Badge size="2xsmall" color={on ? "green" : "grey"}>
      {on ? t("options.on") : t("options.off")}
    </Badge>
  )
}

export function OptionsTab({ status }: { status: StripeStatusResponse }) {
  const { t, i18n } = useTranslation("stripe")
  const lang = i18n.language || "en"
  const o = status.options
  const k = status.key
  const key = k.kind
    ? [t(`options.keyKind.${k.kind}`), k.mode ? t(`options.keyMode.${k.mode}`) : null, k.last4 ? t("options.keyEnding", { last4: k.last4 }) : null].filter(Boolean).join(", ")
    : t("options.notSet")
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("options.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("options.subtitle")}
        </Text>
      </div>
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-3">
        <Fact label={t("options.apiKey")}>{key}</Fact>
        <Fact label={t("options.demo")}>
          <OnOff on={status.mode === "demo"} />
        </Fact>
        <Fact label={t("options.providerId")} mono>
          {o.providerId}
        </Fact>
        <Fact label={t("options.providerIds")} mono>
          <span className="txt-compact-xsmall">{[o.providerIds.card, o.providerIds.blik, o.providerIds.p24].join(", ")}</span>
        </Fact>
        <Fact label={t("options.backendUrl")} mono>
          {o.backendUrl ?? <span className="font-sans text-ui-fg-subtle">{t("options.backendFromRequest")}</span>}
        </Fact>
        <Fact label={t("options.webhookUrl")} mono>
          <span className="txt-compact-xsmall break-all">{status.webhookUrl ?? status.webhookPath}</span>
        </Fact>
        <Fact label={t("options.storefrontDomains")}>
          {o.storefrontDomains.length > 0 ? <span className="font-mono txt-compact-xsmall">{o.storefrontDomains.join(", ")}</span> : null}{" "}
          <span className="text-ui-fg-subtle">({t(`options.storefrontSource.${o.storefrontSource}`)})</span>
        </Fact>
        <Fact label={t("options.cacheSeconds")}>{t("options.seconds", { count: o.cacheSeconds })}</Fact>
        <Fact label={t("options.maxPages")}>
          {o.maxPages} <span className="text-ui-fg-subtle">({t("options.maxPagesHint", { n: fmtNumber(o.maxPages * 100, lang) })})</span>
        </Fact>
        <Fact label={t("options.requestsPerSecond")}>{o.requestsPerSecond}</Fact>
        <Fact label={t("options.timeoutMs")}>{`${o.timeoutMs} ms`}</Fact>
        <Fact label={t("options.apiVersion")} mono>
          {status.apiVersion}
        </Fact>
      </div>
      <div className="px-6 py-4">
        <Text size="xsmall" className="max-w-3xl text-ui-fg-muted">
          {t("options.reads")}
        </Text>
      </div>
    </Container>
  )
}

export function ChecksTab({ status, checks }: { status: StripeStatusResponse; checks: StripeChecksResponse | undefined }) {
  const { t } = useTranslation("stripe")
  const verdictOf = (k: CheckKey) => checks?.results.find((r) => r.key === k)?.verdict
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("checksTab.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("checksTab.subtitle")}
        </Text>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("checksTab.col.check")}</Table.HeaderCell>
              <Table.HeaderCell>{t("checksTab.col.state")}</Table.HeaderCell>
              <Table.HeaderCell>{t("checksTab.col.reads")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {CHECKS.map((k) => {
              const verdict = verdictOf(k)
              return (
                <Table.Row key={k} className="[&_td]:py-2.5">
                  <Table.Cell>
                    <div className="flex flex-col">
                      <Text size="small" weight="plus">
                        {t(`checks.${k}.title`)}
                      </Text>
                      <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{k}</span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <OnOff on={status.options.checks[k] !== false} />
                      {verdict && verdict !== "off" ? <VerdictBadge verdict={verdict} /> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-md">
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {t(`checksTab.reads.${k}`)}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("checksTab.turnOff")}
        </Text>
        <CodeBlock code={`checks: { domains: false, deliveries: false },`} copyLabel={t("guide.copy")} copiedLabel={t("guide.copied")} />
      </div>
    </Container>
  )
}

const RESOURCES = ["paymentIntents", "charges", "balanceTransactions", "balance", "refunds", "disputes", "payouts", "events", "webhookEndpoints", "domains", "configurations", "account"] as const

export function AccessTab({ status }: { status: StripeStatusResponse }) {
  const { t } = useTranslation("stripe")
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("access.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("access.subtitle")}
        </Text>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("access.col.resource")}</Table.HeaderCell>
              <Table.HeaderCell>{t("access.col.used")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {RESOURCES.map((r) => (
              <Table.Row key={r} className="[&_td]:py-2">
                <Table.Cell>
                  <span className="inline-flex items-center gap-x-2">
                    <Text size="small" weight="plus">
                      {t(`access.resource.${r}`)}
                    </Text>
                    <Badge size="2xsmall" color="green">
                      Read
                    </Badge>
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle">
                    {t(`access.used.${r}`)}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("access.create")}
        </Text>
        <ExternalLink href={`${status.dashboardUrl}/apikeys`}>{t("actions.openStripe")}</ExternalLink>
      </div>
    </Container>
  )
}
