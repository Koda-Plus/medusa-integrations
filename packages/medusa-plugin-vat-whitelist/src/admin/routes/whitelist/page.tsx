import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, MagnifyingGlass } from "@medusajs/icons"
import { Button, Container, Heading, IconButton, Input, Table, Text, clx, toast } from "@medusajs/ui"
import { announce } from "../../lib/whitelist-kit"
import { usePageView } from "../../lib/whitelist-guide"
import { GuideView } from "../../lib/whitelist-guide-view"
import { useCheckNip, useRecheckEntity, useWhitelistStatus } from "../../lib/whitelist-api"
import { WhitelistIcon } from "../../lib/whitelist-icon"
import { EmptyLine, SampleBadge, StateBadge, StatTile } from "../../lib/whitelist-ui"
import type { EntityDto, StatusResponse } from "../../../modules/whitelist/lib/contract"

/* The host of the koda.integration/1 cards learns about this plugin. */
announce({ ns: "whitelist", name: "Whitelist", adminPath: "/whitelist", Icon: WhitelistIcon })

/**
 * VAT Whitelist by Koda Plus. One page: the check form, the counterparties
 * with their latest registry answers and the check history.
 */

const WhitelistPage = () => {
  const { t } = useTranslation("whitelist")
  const [view, setView] = usePageView()
  const status = useWhitelistStatus()
  const s = status.data
  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-x-3">
            <span className="flex items-center">
              <WhitelistIcon width={28} height={28} />
            </span>
            <div>
              <div className="flex items-center gap-x-2">
                <Heading>{t("title")}</Heading>
                {status.data?.demo ? <SampleBadge /> : null}
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {t("by")} / {t("subtitle")}
              </Text>
            </div>
          </div>
          <div role="tablist" className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              role="tab"
              aria-selected={view === "panel"}
              onClick={() => setView("panel")}
              className={clx(
                "rounded-md px-2.5 py-1.5 transition-fg",
                view === "panel" ? "bg-ui-bg-base txt-compact-small-plus text-ui-fg-base shadow-elevation-card-rest" : "txt-compact-small text-ui-fg-subtle hover:bg-ui-bg-base-hover",
              )}
            >
              {t("view.panel")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "guide"}
              onClick={() => setView("guide")}
              className={clx(
                "rounded-md px-2.5 py-1.5 transition-fg",
                view === "guide" ? "bg-ui-bg-base txt-compact-small-plus text-ui-fg-base shadow-elevation-card-rest" : "txt-compact-small text-ui-fg-subtle hover:bg-ui-bg-base-hover",
              )}
            >
              {t("view.guide")}
            </button>
          </div>
        </div>
      </Container>

      {view === "guide" ? <GuideView /> : null}

      {view === "panel" && status.isError ? (
        <Container className="p-0">
          <Text size="small" className="px-6 py-4 text-ui-fg-error">
            {t("error", { message: String(status.error) })}
          </Text>
        </Container>
      ) : null}

      {view === "panel" ? (
        <>
          <Container className="p-0">
            <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-4">
              <StatTile label={t("stats.entities")} value={s?.counts.entities ?? "-"} />
              <StatTile label={t("stats.active")} value={s?.counts.active ?? "-"} tone="green" />
              <StatTile label={t("stats.exempt")} value={s?.counts.exempt ?? "-"} tone="orange" />
              <StatTile label={t("stats.notFound")} value={s?.counts.not_found ?? "-"} tone={(s?.counts.not_found ?? 0) > 0 ? "red" : "default"} />
            </div>
          </Container>

          <CheckCard status={s} />

          <Container className="divide-y p-0">
            <div className="flex flex-col gap-1 px-6 py-4">
              <Heading level="h2">{t("entities.title")}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {t("entities.subtitle")}
              </Text>
            </div>
            {!s || s.entities.length === 0 ? (
              <EmptyLine>{t("entities.empty")}</EmptyLine>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>{t("entities.nip")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("entities.name")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("entities.state")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("entities.accounts")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("entities.checked")}</Table.HeaderCell>
                      <Table.HeaderCell />
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {s.entities.map((e) => (
                      <EntityRow key={e.id} status={s} entityId={e.id} />
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
          </Container>

          <Container className="divide-y p-0">
            <div className="flex flex-col gap-1 px-6 py-4">
              <Heading level="h2">{t("checks.title")}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {t("checks.subtitle")}
              </Text>
            </div>
            {!s || s.checks.length === 0 ? (
              <EmptyLine>{t("checks.empty")}</EmptyLine>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>{t("checks.when")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("checks.nip")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("checks.source")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("checks.state")}</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {s.checks.map((c) => (
                      <Table.Row key={c.id}>
                        <Table.Cell className="text-ui-fg-subtle">{new Date(c.created_at).toLocaleString()}</Table.Cell>
                        <Table.Cell className="font-mono txt-compact-xsmall">{c.nip}</Table.Cell>
                        <Table.Cell className="text-ui-fg-subtle">{t(`source.${c.source}`)}</Table.Cell>
                        <Table.Cell>
                          <StateBadge state={c.state} />
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
          </Container>
        </>
      ) : null}
    </div>
  )
}

function CheckCard({ status }: { status: StatusResponse | undefined }) {
  const { t } = useTranslation("whitelist")
  const check = useCheckNip()
  const [nip, setNip] = useState("")
  const submit = () => {
    if (!nip.trim()) return
    check.mutate(nip, {
      onError: (e) => toast.error(t("toast.error", { error: e.message })),
    })
  }
  return (
    <Container className="p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("check.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("check.subtitle", { hours: status?.staleHours ?? 24 })}
        </Text>
      </div>
      <div className="flex flex-wrap items-end gap-3 px-6 pb-4">
        <div className="min-w-[16rem] flex-1">
          <Input size="small" value={nip} onChange={(e) => setNip(e.target.value)} placeholder={t("check.placeholder")} />
        </div>
        <Button size="small" variant="primary" onClick={submit} disabled={check.isPending || !nip.trim()}>
          <MagnifyingGlass />
          {t("check.run")}
        </Button>
      </div>
      {check.data ? <ResultCard entity={check.data.entity} /> : null}
    </Container>
  )
}

/** The answer of the last check, as a full company card. */
function ResultCard({ entity }: { entity: EntityDto }) {
  const { t } = useTranslation("whitelist")
  return (
    <div className="mx-6 mb-4 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
          {t("result.title")}
        </Text>
        <StateBadge state={entity.state} />
      </div>
      <Text size="base" weight="plus" className="mt-2 text-ui-fg-base">
        {entity.name || entity.nip}
      </Text>
      {entity.address ? (
        <Text size="small" className="mt-0.5 text-ui-fg-subtle">
          {entity.address}
        </Text>
      ) : null}
      {entity.legal_form ? (
        <Text size="small" className="mt-0.5 text-ui-fg-subtle">
          {entity.legal_form}
        </Text>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {entity.krs ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("result.krs")}: <span className="tabular-nums">{entity.krs}</span>
          </Text>
        ) : null}
        {entity.regon ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("result.regon")}: <span className="tabular-nums">{entity.regon}</span>
          </Text>
        ) : null}
        <Text size="xsmall" className="text-ui-fg-muted">
          {t(`source.${entity.source}`)}
        </Text>
      </div>
      {entity.bank_accounts.length > 0 ? (
        <div className="mt-2">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
            {t("result.accounts")}
          </Text>
          <ul className="mt-1 flex flex-col gap-y-0.5">
            {entity.bank_accounts.slice(0, 3).map((a) => (
              <li key={a} className="font-mono txt-compact-xsmall text-ui-fg-base">
                {a}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function EntityRow({ status, entityId }: { status: StatusResponse; entityId: string }) {
  const { t } = useTranslation("whitelist")
  const recheck = useRecheckEntity()
  const entity = status.entities.find((e) => e.id === entityId)
  if (!entity) return null
  return (
    <Table.Row>
      <Table.Cell>
        {entity.customer_id ? (
          <Link to={`/customers/${entity.customer_id}`} className="font-mono txt-compact-xsmall text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {entity.nip}
          </Link>
        ) : (
          <span className="font-mono txt-compact-xsmall">{entity.nip}</span>
        )}
      </Table.Cell>
      <Table.Cell>
        <span className="flex flex-col gap-y-0.5">
          <span className="flex items-center gap-x-2">
            <span className="txt-compact-small-plus text-ui-fg-base">{entity.name ?? "-"}</span>
            {entity.demo ? <SampleBadge /> : null}
            {entity.stale ? (
              <span className="txt-compact-xsmall text-ui-fg-muted">{t("entities.stale")}</span>
            ) : null}
          </span>
          {entity.address ? <span className="txt-compact-xsmall text-ui-fg-muted">{entity.address}</span> : null}
          {entity.legal_form ? <span className="txt-compact-xsmall text-ui-fg-muted">{entity.legal_form}</span> : null}
          {entity.krs || entity.regon ? (
            <span className="txt-compact-xsmall text-ui-fg-muted">
              {entity.krs ? `${t("result.krs")}: ${entity.krs}` : ""}
              {entity.krs && entity.regon ? " / " : ""}
              {entity.regon ? `${t("result.regon")}: ${entity.regon}` : ""}
            </span>
          ) : null}
        </span>
      </Table.Cell>
      <Table.Cell>
        <StateBadge state={entity.state} />
      </Table.Cell>
      <Table.Cell className="text-ui-fg-subtle">{entity.bank_accounts.length > 0 ? t("entities.accountsCount", { count: entity.bank_accounts.length }) : "-"}</Table.Cell>
      <Table.Cell className="text-ui-fg-subtle">{new Date(entity.checked_at).toLocaleString()}</Table.Cell>
      <Table.Cell className="text-right">
        <IconButton
          variant="transparent"
          aria-label={t("entities.recheck")}
          onClick={() => recheck.mutate(entity.id, { onSuccess: (r) => toast.success(t(`result.${r.entity.state}`, { name: r.entity.name || r.entity.nip })), onError: (e) => toast.error(t("toast.error", { error: e.message })) })}
        >
          <ArrowPath />
        </IconButton>
      </Table.Cell>
    </Table.Row>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "whitelist",
  icon: WhitelistIcon,
})

export default WhitelistPage
