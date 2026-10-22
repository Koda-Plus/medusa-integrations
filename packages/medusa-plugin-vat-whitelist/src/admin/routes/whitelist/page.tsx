import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpRightOnBox, BarsArrowDown, Buildings, CheckCircle, Clock, CreditCard, ExclamationCircle, GlobeEurope, ListBullet, MagnifyingGlass, User, XCircle } from "@medusajs/icons"
import { Button, Container, InlineTip, Input, Label, Table, Text, toast } from "@medusajs/ui"
import { KitFetchingBar, KitLoading, KitSkeletonRows, announce } from "../../lib/whitelist-kit"
import { HelpButtons, IntegrationHeader, ModeBadge, SettingsView, communityLabels, usePageNav } from "../../lib/whitelist-guide"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, StatTile, StatTiles, ToneBadge } from "../../lib/whitelist-blocks"
import { GuideView, usePromptSpec } from "../../lib/whitelist-guide-view"
import { errorMessage, useCheckNip, useRecheckEntity, useWhitelistStatus } from "../../lib/whitelist-api"
import { WhitelistIcon } from "../../lib/whitelist-icon"
import { OptionsTab, SETTINGS_TABS, StateBadge, type SettingsTabId } from "../../lib/whitelist-ui"
import type { EntityDto, StatusResponse } from "../../../modules/whitelist/lib/contract"

/* The host of the koda.integration/1 cards learns about this plugin. */
announce({ ns: "whitelist", name: "Whitelist", adminPath: "/whitelist", Icon: WhitelistIcon })

/**
 * VAT Whitelist by Koda Plus. Panel: the counters, the check form, the
 * counterparties with their latest registry answers and the check history.
 * Setup guide and the options in use behind the tabs.
 *
 * Deep links: `?filter=` (active, exempt, problem, stale) and `?q=` (NIP, name).
 */

type Filter = "all" | "active" | "exempt" | "problem" | "stale"
const FILTERS: Filter[] = ["all", "active", "exempt", "problem", "stale"]

function matches(e: EntityDto, f: Filter): boolean {
  if (f === "active") return e.state === "active"
  if (f === "exempt") return e.state === "exempt"
  if (f === "problem") return e.state === "not_found" || e.state === "invalid"
  if (f === "stale") return e.stale
  return true
}

const scrollTo = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }))

const WhitelistPage = () => {
  const { t, i18n } = useTranslation("whitelist")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const status = useWhitelistStatus()
  const s = status.data
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)
  const hours = s?.staleHours ?? 24

  const [params, setParams] = useSearchParams()
  const filter = (FILTERS as string[]).includes(params.get("filter") ?? "") ? (params.get("filter") as Filter) : "all"
  const [q, setQ] = useState(params.get("q") ?? "")
  useEffect(() => {
    const p = new URLSearchParams(params)
    if (q) p.set("q", q)
    else p.delete("q")
    if (p.toString() !== params.toString()) setParams(p, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])
  const setFilter = (f: Filter) => {
    const p = new URLSearchParams(params)
    if (f === "all" || f === filter) p.delete("filter")
    else p.set("filter", f)
    setParams(p, { replace: true })
    scrollTo("whitelist-entities")
  }

  const onRefresh = async () => {
    const r = await status.refetch()
    if (r.isError) toast.error(t("toast.error", { error: errorMessage(r.error) }))
    else toast.success(t("toast.refreshed"))
  }
  const refresh = { key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, loading: status.isFetching, onClick: () => void onRefresh() }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <IntegrationHeader
          icon={<WhitelistIcon width={28} height={28} />}
          title={t("title")}
          badges={
            s?.demo ? (
              <ModeBadge color="blue" label={t("mode.demo")} title={t("mode.demoTitle")}>
                <Text size="small">{t("mode.demoText")}</Text>
              </ModeBadge>
            ) : null
          }
          description={t("subtitle")}
          points={[
            { icon: <Buildings />, text: t("points.nip") },
            { icon: <GlobeEurope />, text: t("points.vies") },
            { icon: <CreditCard />, text: t("points.accounts") },
            { icon: <Clock />, text: t("points.fresh", { hours }) },
            { icon: <ListBullet />, text: t("points.history") },
          ]}
          help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
          view={nav.view}
          onView={(v) => nav.go(v)}
          labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("view.settings"), more: t("actions.more") }}
          primary={nav.view === "panel" && s ? { key: "check", label: t("actions.check"), icon: <MagnifyingGlass />, onClick: () => scrollTo("whitelist-check") } : null}
          actions={
            nav.view === "panel"
              ? [refresh, { key: "customers", label: t("actions.customers"), icon: <ArrowUpRightOnBox />, onClick: () => window.location.assign("/app/customers") }]
              : nav.view === "settings"
                ? [refresh]
                : []
          }
        />
        <KitFetchingBar active={status.isFetching && !status.isLoading} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {nav.view !== "guide" && !s && status.isLoading ? <KitLoading label={t("loading")} /> : null}
        {nav.view === "panel" && s ? (
          <StatTiles columns={4}>
            <StatTile label={t("stats.entities")} value={s.counts.entities} hint={t("stats.entitiesHint")} icon={<Buildings />} active={filter === "all" && !q} onClick={() => setFilter("all")} />
            <StatTile label={t("stats.active")} value={s.counts.active} hint={t("stats.activeHint")} icon={<CheckCircle />} tone="green" active={filter === "active"} onClick={() => setFilter("active")} />
            <StatTile label={t("stats.exempt")} value={s.counts.exempt} hint={t("stats.exemptHint")} icon={<ExclamationCircle />} tone={s.counts.exempt > 0 ? "orange" : "grey"} active={filter === "exempt"} onClick={() => setFilter("exempt")} />
            <StatTile label={t("stats.notFound")} value={s.counts.not_found} hint={t("stats.notFoundHint")} icon={<XCircle />} tone={s.counts.not_found > 0 ? "red" : "grey"} active={filter === "problem"} onClick={() => setFilter("problem")} />
          </StatTiles>
        ) : null}
      </Container>

      {nav.view === "guide" ? <GuideView status={s} /> : null}

      {nav.view === "settings" && s ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[{ id: "options", label: t("settings.tab.options") }]}
        >
          <OptionsTab status={s} />
        </SettingsView>
      ) : null}

      {nav.view === "panel" && s ? (
        <>
          <CheckCard status={s} />
          <EntitiesCard status={s} filter={filter} onFilter={setFilter} q={q} onQ={setQ} loading={status.isLoading} />
          <ChecksCard status={s} />
        </>
      ) : null}
    </div>
  )
}

function CheckCard({ status }: { status: StatusResponse }) {
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
    <Section
      id="whitelist-check"
      icon={<MagnifyingGlass />}
      title={t("check.title")}
      points={[
        { icon: <Buildings />, text: t("check.points.nip") },
        { icon: <GlobeEurope />, text: t("check.points.vat") },
        { icon: <Clock />, text: t("check.points.fresh", { hours: status.staleHours }) },
      ]}
    >
      <form
        className="flex flex-wrap items-end gap-3 px-6 py-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="flex min-w-[16rem] flex-1 flex-col gap-y-1">
          <Label size="xsmall">{t("check.number")}</Label>
          <Input size="small" value={nip} onChange={(e) => setNip(e.target.value)} placeholder={t("check.placeholder")} />
        </div>
        <Button type="submit" size="small" variant="primary" isLoading={check.isPending} disabled={!nip.trim()}>
          <MagnifyingGlass />
          {t("check.run")}
        </Button>
      </form>
      {check.data ? <ResultCard entity={check.data.entity} /> : null}
    </Section>
  )
}

/** The answer of the last check, as a company card. */
function ResultCard({ entity }: { entity: EntityDto }) {
  const { t } = useTranslation("whitelist")
  return (
    <div className="px-6 py-4">
      <div className="flex flex-col gap-y-1.5 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Text size="base" weight="plus" className="text-ui-fg-base">
            {entity.name || entity.nip}
          </Text>
          <StateBadge state={entity.state} />
          <ToneBadge>{t(`source.${entity.source}`)}</ToneBadge>
        </div>
        {entity.address ? (
          <Text size="small" className="text-ui-fg-subtle">
            {entity.address}
          </Text>
        ) : null}
        {entity.legal_form ? (
          <Text size="small" className="text-ui-fg-subtle">
            {entity.legal_form}
          </Text>
        ) : null}
        {entity.krs || entity.regon ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
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
          </div>
        ) : null}
        {entity.bank_accounts.length > 0 ? (
          <div className="flex flex-col gap-y-0.5 pt-1">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
              {t("result.accounts")}
            </Text>
            {entity.bank_accounts.slice(0, 3).map((a) => (
              <span key={a} className="font-mono txt-compact-xsmall text-ui-fg-base">
                {a}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function EntitiesCard({ status, filter, onFilter, q, onQ, loading }: { status: StatusResponse; filter: Filter; onFilter: (f: Filter) => void; q: string; onQ: (v: string) => void; loading: boolean }) {
  const { t, i18n } = useTranslation("whitelist")
  const lang = i18n.language || "en"
  const recheck = useRecheckEntity()
  const needle = q.trim().toLowerCase()
  const rows = useMemo(
    () => status.entities.filter((e) => matches(e, filter) && (!needle || [e.nip, e.name, e.address, e.regon, e.krs].some((x) => (x ?? "").toLowerCase().includes(needle)))),
    [status.entities, filter, needle],
  )
  const count = (f: Filter) => status.entities.filter((e) => matches(e, f)).length
  const runRecheck = (e: EntityDto) =>
    recheck.mutate(e.id, {
      onSuccess: (r) => toast.success(t(`result.${r.entity.state}`, { name: r.entity.name || r.entity.nip })),
      onError: (err) => toast.error(t("toast.error", { error: err.message })),
    })

  return (
    <Section
      id="whitelist-entities"
      icon={<Buildings />}
      title={t("entities.title")}
      points={[
        { icon: <BarsArrowDown />, text: t("entities.points.latest") },
        { icon: <ArrowPath />, text: t("entities.points.recheck") },
        { icon: <User />, text: t("entities.points.customer") },
      ]}
      actions={<SearchInput value={q} onChange={onQ} placeholder={t("entities.search")} />}
    >
      <FilterBar>
        <FilterButton icon={<ListBullet />} label={t("entities.filter.all")} count={status.entities.length} active={filter === "all"} onClick={() => onFilter("all")} />
        <FilterDivider />
        <FilterButton icon={<CheckCircle />} label={t("entities.filter.active")} count={count("active")} active={filter === "active"} onClick={() => onFilter("active")} />
        <FilterButton icon={<ExclamationCircle />} label={t("entities.filter.exempt")} count={count("exempt")} active={filter === "exempt"} onClick={() => onFilter("exempt")} />
        <FilterButton icon={<XCircle />} label={t("entities.filter.problem")} count={count("problem")} attention active={filter === "problem"} onClick={() => onFilter("problem")} />
        <FilterDivider />
        <FilterButton icon={<Clock />} label={t("entities.filter.stale")} count={count("stale")} active={filter === "stale"} onClick={() => onFilter("stale")} />
      </FilterBar>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("entities.nip")}</Table.HeaderCell>
              <Table.HeaderCell>{t("entities.name")}</Table.HeaderCell>
              <Table.HeaderCell>{t("entities.state")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("entities.accounts")}</Table.HeaderCell>
              <Table.HeaderCell>{t("entities.checked")}</Table.HeaderCell>
              <Table.HeaderCell className="w-px" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading && rows.length === 0 ? <KitSkeletonRows cols={6} /> : null}
            {!loading && rows.length === 0 ? (
              <EmptyTableRow
                cols={6}
                icon={<Buildings />}
                title={status.entities.length === 0 ? t("entities.empty") : t("entities.emptySearch")}
                points={status.entities.length === 0 ? [{ icon: <MagnifyingGlass />, text: t("entities.emptyHint") }] : undefined}
              />
            ) : null}
            {rows.map((e) => (
              <Table.Row key={e.id}>
                <Table.Cell>
                  {e.customer_id ? (
                    <Link to={`/customers/${e.customer_id}`} className="font-mono txt-compact-xsmall text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                      {e.nip}
                    </Link>
                  ) : (
                    <span className="font-mono txt-compact-xsmall">{e.nip}</span>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <span className="flex flex-col gap-y-0.5">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="txt-compact-small-plus text-ui-fg-base">{e.name ?? "-"}</span>
                      {e.demo ? <ToneBadge tone="blue">{t("mode.demo")}</ToneBadge> : null}
                    </span>
                    {e.address ? <span className="txt-compact-xsmall text-ui-fg-muted">{e.address}</span> : null}
                    {e.legal_form ? <span className="txt-compact-xsmall text-ui-fg-muted">{e.legal_form}</span> : null}
                    {e.krs || e.regon ? (
                      <span className="txt-compact-xsmall text-ui-fg-muted">
                        {e.krs ? `${t("result.krs")}: ${e.krs}` : ""}
                        {e.krs && e.regon ? " / " : ""}
                        {e.regon ? `${t("result.regon")}: ${e.regon}` : ""}
                      </span>
                    ) : null}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <span className="flex flex-wrap items-center gap-1">
                    <StateBadge state={e.state} />
                    {e.stale ? (
                      <ToneBadge tone="orange" dot>
                        {t("entities.stale")}
                      </ToneBadge>
                    ) : null}
                  </span>
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums text-ui-fg-subtle">{e.bank_accounts.length > 0 ? t("entities.accountsCount", { count: e.bank_accounts.length }) : "-"}</Table.Cell>
                <Table.Cell className="tabular-nums text-ui-fg-subtle">{new Date(e.checked_at).toLocaleString(lang)}</Table.Cell>
                <Table.Cell className="text-right">
                  <RowActions
                    actions={[
                      { key: "recheck", label: t("entities.recheck"), icon: <ArrowPath />, loading: recheck.isPending && recheck.variables === e.id, disabled: recheck.isPending, onClick: () => runRecheck(e) },
                      { key: "customer", label: t("entities.openCustomer"), icon: <ArrowUpRightOnBox />, href: `/app/customers/${e.customer_id}`, hidden: !e.customer_id },
                    ]}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

function ChecksCard({ status }: { status: StatusResponse }) {
  const { t, i18n } = useTranslation("whitelist")
  const lang = i18n.language || "en"
  return (
    <Section
      icon={<Clock />}
      title={t("checks.title")}
      points={[
        { icon: <BarsArrowDown />, text: t("checks.points.newest") },
        { icon: <ListBullet />, text: t("checks.points.every") },
      ]}
    >
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
            {status.checks.length === 0 ? <EmptyTableRow cols={4} icon={<Clock />} title={t("checks.empty")} /> : null}
            {status.checks.map((c) => (
              <Table.Row key={c.id}>
                <Table.Cell className="tabular-nums text-ui-fg-subtle">{new Date(c.created_at).toLocaleString(lang)}</Table.Cell>
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
    </Section>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "whitelist",
  icon: WhitelistIcon,
})

export default WhitelistPage
