import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  ArchiveBox,
  ArrowUpRightOnBox,
  BarsArrowDown,
  ChartBar,
  CheckCircle,
  CircleStack,
  Clock,
  CodeCommit,
  CommandLine,
  DocumentText,
  ExclamationCircle,
  EyeSlash,
  Globe,
  Key,
  ListBullet,
  LockClosedSolid,
  ServerStack,
  Wrench,
} from "@medusajs/icons"
import { Badge, InlineTip, Table, Text, clx } from "@medusajs/ui"
import type { DeploymentDto, LogKind, MetricRange, OverviewResponse, ProblemDto, ServiceDto } from "../../modules/railway/lib/contract"
import { errorMessage, useRailwayDeployments, useRailwayLogs, useRailwayMetrics, useRailwayVariables } from "./railway-api"
import { EmptyState, EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, StatTile, StatTiles, ToneBadge, useDebouncedValue, type Tone } from "./railway-blocks"
import { KitFetchingBar, KitLoading, KitSkeletonRows } from "./railway-kit"
import { Sparkline, UsageBar, ago, clock, dateTime, duration, gb, mb, num, since } from "./railway-ui"

export type DetailTab = "deployments" | "logs" | "metrics" | "variables" | "domains"
export const DETAIL_TABS: readonly DetailTab[] = ["deployments", "logs", "metrics", "variables", "domains"]

const isDb = (s: ServiceDto) => s.kind === "postgres" || s.kind === "redis" || s.kind === "mysql" || s.kind === "mongo"

/* ------------------------------------------------------------------ */
/* Problems                                                            */
/* ------------------------------------------------------------------ */

const PROBLEM_TEXT: Record<ProblemDto["key"], string> = {
  deploy_failed: "deployFailed",
  deploy_crashed: "deployCrashed",
  instance_crashed: "instanceCrashed",
  instance_restarting: "instanceRestarting",
  memory_high: "memoryHigh",
  volume_full: "volumeFull",
  errors_many: "errorsMany",
  domain_issue: "domainIssue",
  building_long: "buildingLong",
}

export function problemText(p: ProblemDto, t: (k: string, o?: Record<string, unknown>) => string): string {
  let key = PROBLEM_TEXT[p.key]
  if (p.key === "deploy_failed" && p.params.serving) key = "deployFailedServing"
  if (p.key === "errors_many" && p.params.capped) key = "errorsManyCapped"
  return t(`problems.key.${key}`, p.params)
}

/* ------------------------------------------------------------------ */
/* Tiles and freshness                                                 */
/* ------------------------------------------------------------------ */

export function Freshness({ overview, cacheSeconds }: { overview: OverviewResponse; cacheSeconds: number }) {
  const { t } = useTranslation("railway")
  const when = ago(overview.readAt, t)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Text size="xsmall" className="text-ui-fg-muted">
        {overview.stale ? t("freshness.stale", { when }) : t("freshness.read", { when })}, {t("freshness.kept", { seconds: cacheSeconds })}
      </Text>
      {overview.partial.length ? (
        <ToneBadge tone="orange" icon={<ExclamationCircle />}>
          {t("freshness.partial", { parts: overview.partial.map((p) => t(`freshness.parts.${p}`)).join(", ") })}
        </ToneBadge>
      ) : null}
    </div>
  )
}

export function OverviewTiles({ overview, onProblems, lang }: { overview: OverviewResponse; onProblems: () => void; lang: string }) {
  const { t } = useTranslation("railway")
  const apps = overview.services.filter((s) => !isDb(s)).length
  const healthy = overview.services.filter((s) => s.latest?.state === "success" && s.instances.crashed === 0).length
  const red = overview.problems.filter((p) => p.tone === "red").length
  const orange = overview.problems.length - red
  const errors = overview.services.reduce((n, s) => n + (s.errorsLastHour ?? 0), 0)
  const scanned = overview.services.some((s) => s.errorsLastHour !== null)
  const top = [...overview.services].filter((s) => s.memory?.pct !== null && s.memory?.pct !== undefined).sort((a, b) => (b.memory!.pct ?? 0) - (a.memory!.pct ?? 0))[0]
  const memPct = top?.memory?.pct ?? null
  return (
    <StatTiles columns={5} className="px-0 py-0">
      <StatTile icon={<ServerStack />} label={t("tiles.services")} value={overview.services.length} hint={t("tiles.servicesHint", { apps, databases: overview.services.length - apps })} />
      <StatTile icon={<CheckCircle />} tone={healthy === overview.services.length ? "green" : "grey"} label={t("tiles.healthy")} value={`${healthy} / ${overview.services.length}`} hint={t("tiles.healthyHint")} />
      <StatTile
        icon={<ExclamationCircle />}
        tone={red ? "red" : orange ? "orange" : "green"}
        label={t("tiles.problems")}
        value={overview.problems.length}
        hint={overview.problems.length ? t("tiles.problemsHint", { red, orange }) : t("tiles.problemsNone")}
        onClick={overview.problems.length ? onProblems : undefined}
      />
      <StatTile icon={<Wrench />} tone={errors >= 100 ? "red" : errors >= 20 ? "orange" : "grey"} label={t("tiles.errors")} value={scanned ? num(errors, lang, 0) : "?"} hint={t("tiles.errorsHint")} />
      <StatTile icon={<ChartBar />} tone={memPct !== null && memPct >= 95 ? "red" : memPct !== null && memPct >= 85 ? "orange" : "grey"} label={t("tiles.memory")} value={memPct !== null ? `${Math.round(memPct)} %` : "?"} hint={top ? t("tiles.memoryHint", { service: top.name }) : undefined} />
    </StatTiles>
  )
}

/* ------------------------------------------------------------------ */
/* Problems section                                                    */
/* ------------------------------------------------------------------ */

export function ProblemsSection({ overview, onOpen }: { overview: OverviewResponse; onOpen: (serviceId: string, tab: DetailTab) => void }) {
  const { t } = useTranslation("railway")
  const tabOf = (p: ProblemDto): DetailTab => (p.key === "memory_high" ? "metrics" : p.key === "volume_full" || p.key === "domain_issue" ? "domains" : p.key === "deploy_failed" || p.key === "building_long" ? "deployments" : "logs")
  return (
    <Section
      id="railway-problems"
      icon={<ExclamationCircle />}
      title={t("problems.title")}
      badges={overview.problems.length ? <ToneBadge tone={overview.problems.some((p) => p.tone === "red") ? "red" : "orange"}>{overview.problems.length}</ToneBadge> : null}
      points={[{ icon: <BarsArrowDown />, text: t("problems.points.worst") }, { icon: <ListBullet />, text: t("problems.points.sources") }]}
    >
      {overview.problems.length === 0 ? (
        <EmptyState compact icon={<CheckCircle />} title={t("problems.none")} />
      ) : (
        <ul className="divide-y">
          {overview.problems.map((p, i) => (
            <li key={`${p.serviceId}-${p.key}-${i}`} className="flex items-center justify-between gap-3 px-6 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <ToneBadge tone={p.tone} icon={<ExclamationCircle />}>
                  {p.serviceName}
                </ToneBadge>
                <Text size="small" className="min-w-0 text-ui-fg-base">
                  {problemText(p, t)}
                </Text>
              </div>
              <RowActions
                actions={[
                  { key: "show", label: t("actions.show"), icon: <ArrowUpRightOnBox />, onClick: () => onOpen(p.serviceId, tabOf(p)) },
                  { key: "railway", label: t("actions.openRailway"), icon: <Globe />, href: overview.services.find((s) => s.id === p.serviceId)?.dashboardUrl ?? undefined, external: true, hidden: !overview.services.find((s) => s.id === p.serviceId)?.dashboardUrl },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

function StateBadge({ d }: { d: DeploymentDto | null }) {
  const { t } = useTranslation("railway")
  if (!d) return <ToneBadge tone="grey">{t("services.noDeploy")}</ToneBadge>
  return (
    <ToneBadge tone={d.tone as Tone} title={d.status}>
      {t(`state.${d.state}`)}
    </ToneBadge>
  )
}

function KindIcon({ s }: { s: ServiceDto }) {
  return <span className="flex shrink-0 text-ui-fg-muted [&_svg]:size-4">{isDb(s) ? <CircleStack /> : s.kind === "bucket" ? <ArchiveBox /> : <ServerStack />}</span>
}

function CommitLine({ d }: { d: DeploymentDto | null }) {
  const { t } = useTranslation("railway")
  if (!d?.commit) return null
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-ui-fg-subtle">
      <CodeCommit className="shrink-0 text-ui-fg-muted" />
      {d.commit.short ? <code className="txt-compact-xsmall shrink-0 font-mono text-ui-fg-base">{d.commit.short}</code> : null}
      <span className="txt-compact-xsmall truncate" title={d.commit.message ?? undefined}>
        {d.commit.message ?? t("deployments.noCommit")}
      </span>
    </span>
  )
}

export function ServicesSection({ overview, problems, selected, onSelect, lang }: { overview: OverviewResponse; problems: ProblemDto[]; selected: string | null; onSelect: (id: string) => void; lang: string }) {
  const { t } = useTranslation("railway")
  return (
    <Section
      id="railway-services"
      icon={<ServerStack />}
      title={t("services.title")}
      badges={<Badge size="2xsmall" color="grey">{overview.environment.name}</Badge>}
      points={[{ icon: <ListBullet />, text: t("services.points.click") }, { icon: <Clock />, text: t("services.points.active") }]}
    >
      {overview.services.length === 0 ? (
        <EmptyState icon={<ServerStack />} title={t("services.empty")} />
      ) : (
        <div className="grid grid-cols-1 gap-3 px-6 py-4 md:grid-cols-2 xl:grid-cols-3">
          {overview.services.map((s) => {
            const mine = problems.filter((p) => p.serviceId === s.id)
            const worst = mine.some((p) => p.tone === "red") ? "red" : mine.length ? "orange" : null
            const active = selected === s.id
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(s.id)}
                className={clx(
                  "flex min-w-0 flex-col gap-y-2 rounded-lg border bg-ui-bg-base p-3 text-left shadow-elevation-card-rest outline-none transition-fg hover:bg-ui-bg-base-hover focus-visible:shadow-borders-focus",
                  active ? "border-ui-border-interactive" : worst === "red" ? "border-ui-tag-red-border" : worst === "orange" ? "border-ui-tag-orange-border" : "border-ui-border-base",
                )}
              >
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <KindIcon s={s} />
                    <Text size="small" weight="plus" className="truncate text-ui-fg-base">
                      {s.name}
                    </Text>
                    <Badge size="2xsmall" color="grey">
                      {t(`services.kind.${s.kind}`)}
                    </Badge>
                  </span>
                  <StateBadge d={s.latest} />
                </span>
                <CommitLine d={s.latest} />
                <span className="txt-compact-xsmall flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-fg-muted">
                  {s.latest?.createdAt ? (
                    <span className="inline-flex items-center gap-1" title={dateTime(s.latest.createdAt, lang)}>
                      <Clock /> {ago(s.latest.createdAt, t)}
                      {s.latest.commit?.author ? `, ${s.latest.commit.author}` : s.latest.creator ? `, ${s.latest.creator}` : ""}
                    </span>
                  ) : null}
                  {s.upSince ? <span className="text-ui-tag-green-text">{t("services.up", { duration: since(s.upSince, t) })}</span> : null}
                  {s.latest && s.active && s.latest.id !== s.active.id ? <span>{t("services.serving", { when: ago(s.active.createdAt, t) })}</span> : null}
                  {s.instances.total > 0 ? <span>{t("services.instances", { running: s.instances.running, total: s.instances.total })}</span> : null}
                </span>
                {s.memory?.pct !== null && s.memory?.pct !== undefined ? (
                  <span className="flex flex-col gap-1">
                    <span className="txt-compact-xsmall text-ui-fg-muted">{t("services.memory", { used: gb(s.memory.usedGb, lang), limit: gb(s.memory.limitGb, lang) })}</span>
                    <UsageBar pct={s.memory.pct} />
                  </span>
                ) : null}
                {s.volumes.map((v) => (
                  <span key={v.id} className="flex flex-col gap-1">
                    <span className="txt-compact-xsmall text-ui-fg-muted">{t("services.volume", { name: v.name, used: mb(v.usedMB, lang), size: mb(v.sizeMB, lang) })}</span>
                    <UsageBar pct={v.pct} />
                  </span>
                ))}
                {mine.length ? (
                  <span className="flex flex-wrap gap-1">
                    {mine.map((p, i) => (
                      <ToneBadge key={i} tone={p.tone}>
                        {problemText(p, t)}
                      </ToneBadge>
                    ))}
                  </span>
                ) : s.errorsLastHour !== null ? (
                  <span className="txt-compact-xsmall text-ui-fg-muted">{s.errorsLastHour ? t("services.errors", { count: s.errorsLastHour }) : t("services.errorsNone")}</span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* One service                                                         */
/* ------------------------------------------------------------------ */

const TAB_ICON: Record<DetailTab, ReactNode> = {
  deployments: <CodeCommit />,
  logs: <CommandLine />,
  metrics: <ChartBar />,
  variables: <Key />,
  domains: <Globe />,
}

export function ServiceDetail({ service, tab, onTab, lang, logTarget, onLogs }: { service: ServiceDto; tab: DetailTab; onTab: (tab: DetailTab) => void; lang: string; logTarget: { id: string; kind: LogKind } | null; onLogs: (id: string, kind: LogKind) => void }) {
  const { t } = useTranslation("railway")
  const fallbackLogs = service.active?.id ?? service.latest?.id ?? null
  const target = logTarget ?? (fallbackLogs ? { id: fallbackLogs, kind: "deploy" as LogKind } : null)
  return (
    <div id="railway-detail" className="flex scroll-mt-4 flex-col gap-y-3">
      <div className="flex flex-wrap items-center gap-2 overflow-x-auto">
        <span className="flex items-center gap-2 pr-2">
          <KindIcon s={service} />
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {service.name}
          </Text>
        </span>
        <FilterBar className="flex-1 border-0 bg-transparent p-0">
          {DETAIL_TABS.map((k) => (
            <FilterButton key={k} icon={TAB_ICON[k]} label={t(`detail.tab.${k}`)} active={tab === k} onClick={() => onTab(k)} />
          ))}
        </FilterBar>
      </div>
      {tab === "deployments" ? <DeploymentsTab service={service} lang={lang} onLogs={onLogs} /> : null}
      {tab === "logs" ? <LogsTab service={service} target={target} lang={lang} onLogs={onLogs} /> : null}
      {tab === "metrics" ? <MetricsTab service={service} lang={lang} /> : null}
      {tab === "variables" ? <VariablesTab service={service} /> : null}
      {tab === "domains" ? <DomainsTab service={service} lang={lang} /> : null}
    </div>
  )
}

function ReadError({ error }: { error: unknown }) {
  const { t } = useTranslation("railway")
  return (
    <div className="px-6 py-4">
      <InlineTip variant="error" label={t("title")}>
        {t("error", { message: errorMessage(error) })}
      </InlineTip>
    </div>
  )
}

function DeploymentsTab({ service, lang, onLogs }: { service: ServiceDto; lang: string; onLogs: (id: string, kind: LogKind) => void }) {
  const { t } = useTranslation("railway")
  const q = useRailwayDeployments(service.id)
  const items = q.data?.items ?? []
  return (
    <Section icon={<CodeCommit />} title={t("deployments.title", { service: service.name })} points={[{ icon: <ListBullet />, text: t("deployments.points.last") }, { icon: <BarsArrowDown />, text: t("deployments.points.newest") }]}>
      {q.isError ? <ReadError error={q.error} /> : null}
      <KitFetchingBar active={q.isFetching && !q.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("deployments.col.state")}</Table.HeaderCell>
              <Table.HeaderCell>{t("deployments.col.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("deployments.col.duration")}</Table.HeaderCell>
              <Table.HeaderCell>{t("deployments.col.commit")}</Table.HeaderCell>
              <Table.HeaderCell>{t("deployments.col.author")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("deployments.col.actions")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {q.isLoading ? <KitSkeletonRows cols={6} rows={5} /> : null}
            {!q.isLoading && items.length === 0 ? <EmptyTableRow cols={6} icon={<CodeCommit />} title={t("deployments.empty")} /> : null}
            {items.map((d) => (
              <Table.Row key={d.id}>
                <Table.Cell>
                  <StateBadge d={d} />
                </Table.Cell>
                <Table.Cell>
                  <span title={dateTime(d.createdAt, lang)} className="whitespace-nowrap">
                    {ago(d.createdAt, t)}
                  </span>
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap tabular-nums">{duration(d.durationMs, t)}</Table.Cell>
                <Table.Cell className="max-w-[360px]">{d.commit ? <CommitLine d={d} /> : <span className="txt-compact-xsmall text-ui-fg-muted">{t("deployments.noCommit")}</span>}</Table.Cell>
                <Table.Cell className="whitespace-nowrap">{d.commit?.author ?? d.creator ?? ""}</Table.Cell>
                <Table.Cell className="text-right">
                  <RowActions
                    actions={[
                      { key: "logs", label: t("actions.logs"), icon: <CommandLine />, onClick: () => onLogs(d.id, "deploy") },
                      { key: "build", label: t("actions.buildLogs"), icon: <Wrench />, onClick: () => onLogs(d.id, "build") },
                      { key: "railway", label: t("actions.openRailway"), icon: <ArrowUpRightOnBox />, href: d.dashboardUrl ?? undefined, external: true, hidden: !d.dashboardUrl },
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

const WINDOWS: Array<{ minutes: number; key: string }> = [
  { minutes: 15, key: "m15" },
  { minutes: 60, key: "m60" },
  { minutes: 360, key: "m360" },
  { minutes: 0, key: "all" },
]

const SEVERITY_TEXT: Record<string, string> = {
  error: "text-ui-tag-red-text",
  warn: "text-ui-tag-orange-text",
  info: "text-ui-fg-base",
  debug: "text-ui-fg-muted",
}

function LogsTab({ service, target, lang, onLogs }: { service: ServiceDto; target: { id: string; kind: LogKind } | null; lang: string; onLogs: (id: string, kind: LogKind) => void }) {
  const { t } = useTranslation("railway")
  const [minutes, setMinutes] = useState(60)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [text, setText] = useState("")
  const q = useDebouncedValue(text.trim(), 350)
  const kind = target?.kind ?? "deploy"
  /* Build logs have no time window worth filtering: a build is a few minutes. */
  const logs = useRailwayLogs(target?.id ?? null, kind, kind === "build" ? 0 : minutes, errorsOnly, q)
  const data = logs.data
  if (!target) return <Section icon={<CommandLine />} title={t("logs.title", { service: service.name })}><EmptyState icon={<CommandLine />} title={t("logs.noDeployment")} /></Section>
  return (
    <Section
      icon={<CommandLine />}
      title={t("logs.title", { service: service.name })}
      badges={
        <>
          <Badge size="2xsmall" color="grey">
            {t("logs.deployment", { id: target.id.slice(0, 8) })}
          </Badge>
          {data?.masked ? (
            <ToneBadge tone="blue" icon={<EyeSlash />}>
              {t("logs.masked", { count: data.masked })}
            </ToneBadge>
          ) : null}
        </>
      }
      points={[{ icon: <LockClosedSolid />, text: t("logs.points.masked"), tone: "green" }, { icon: <BarsArrowDown />, text: t("logs.points.newest") }, { icon: <ServerStack />, text: t("logs.points.server") }]}
      actions={<SearchInput value={text} onChange={setText} placeholder={t("logs.search")} className="w-56" />}
    >
      <FilterBar>
        <FilterButton icon={<CommandLine />} label={t("logs.kind.deploy")} active={kind === "deploy"} onClick={() => onLogs(target.id, "deploy")} />
        <FilterButton icon={<Wrench />} label={t("logs.kind.build")} active={kind === "build"} onClick={() => onLogs(target.id, "build")} />
        <FilterDivider />
        <FilterButton icon={<ExclamationCircle />} label={t("logs.errorsOnly")} active={errorsOnly} onClick={() => setErrorsOnly((v) => !v)} />
        {kind === "deploy" ? (
          <>
            <FilterDivider />
            {WINDOWS.map((w) => (
              <FilterButton key={w.key} icon={<Clock />} label={t(`logs.window.${w.key}`)} active={minutes === w.minutes} onClick={() => setMinutes(w.minutes)} />
            ))}
          </>
        ) : null}
      </FilterBar>
      <KitFetchingBar active={logs.isFetching && !logs.isLoading} />
      {logs.isError ? <ReadError error={logs.error} /> : null}
      {logs.isLoading ? <KitLoading label={t("loading")} /> : null}
      {data && data.lines.length === 0 ? <EmptyState compact icon={<DocumentText />} title={t("logs.empty")} /> : null}
      {data && data.lines.length > 0 ? (
        <div className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2 px-6 py-2">
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("logs.lines", { count: data.lines.length })}
            </Text>
            {data.capped ? <ToneBadge tone="grey">{t("logs.capped", { count: data.limit })}</ToneBadge> : null}
          </div>
          <ol className="max-h-[560px] overflow-y-auto border-t border-ui-border-base bg-ui-bg-subtle px-4 py-2 font-mono">
            {data.lines.map((l, i) => (
              <li key={`${l.ts}-${i}`} className={clx("txt-compact-xsmall flex gap-3 py-0.5", l.error && l.severity !== "error" ? "text-ui-tag-red-text" : SEVERITY_TEXT[l.severity])}>
                <time dateTime={l.ts} title={dateTime(l.ts, lang)} className="shrink-0 tabular-nums text-ui-fg-muted">
                  {clock(l.ts, lang)}
                </time>
                <span className="min-w-0 whitespace-pre-wrap break-all">{l.message}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Section>
  )
}

function MetricTile({ title, value, hint, children }: { title: string; value: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-y-2 rounded-lg border border-ui-border-base bg-ui-bg-base p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Text size="xsmall" className="text-ui-fg-subtle">
          {title}
        </Text>
        <Text size="small" weight="plus" className="tabular-nums text-ui-fg-base">
          {value}
        </Text>
      </div>
      {children}
      {hint ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {hint}
        </Text>
      ) : null}
    </div>
  )
}

function MetricsTab({ service, lang }: { service: ServiceDto; lang: string }) {
  const { t } = useTranslation("railway")
  const [range, setRange] = useState<MetricRange>("1h")
  const q = useRailwayMetrics(service.id, range)
  const m = q.data
  const s = m?.summary
  const empty = m && m.cpu.length < 2 && m.memory.length < 2
  return (
    <Section
      icon={<ChartBar />}
      title={t("metrics.title", { service: service.name })}
      points={[{ icon: <ChartBar />, text: t("metrics.points.source") }, m ? { icon: <Clock />, text: t("metrics.points.sample", { seconds: m.sampleSeconds }) } : null]}
      actions={
        <FilterBar className="border-0 bg-transparent p-0">
          {(["1h", "6h", "24h"] as MetricRange[]).map((r) => (
            <FilterButton key={r} icon={<Clock />} label={t(`metrics.range.${r}`)} active={range === r} onClick={() => setRange(r)} />
          ))}
        </FilterBar>
      }
    >
      <KitFetchingBar active={q.isFetching && !q.isLoading} />
      {q.isError ? <ReadError error={q.error} /> : null}
      {q.isLoading ? <KitLoading label={t("loading")} /> : null}
      {empty ? <EmptyState compact icon={<ChartBar />} title={t("metrics.empty")} /> : null}
      {m && !empty ? (
        <div className="grid grid-cols-1 gap-3 px-6 py-4 lg:grid-cols-3">
          <MetricTile title={t("metrics.cpu")} value={t("metrics.cpuValue", { value: num(m.cpu.length ? m.cpu[m.cpu.length - 1].v : null, lang) })} hint={t("metrics.cpuHint", { avg: num(s?.cpuAvg, lang), max: num(s?.cpuMax, lang) })}>
            <Sparkline label={t("metrics.cpu")} series={[{ points: m.cpu, tone: "blue" }]} />
          </MetricTile>
          <MetricTile
            title={t("metrics.memory")}
            value={`${gb(s?.memoryLast, lang)}${s?.memoryPct !== null && s?.memoryPct !== undefined ? ` (${Math.round(s.memoryPct)} %)` : ""}`}
            hint={`${t("metrics.memoryHint", { max: gb(s?.memoryMax, lang) })}${m.memoryLimit ? `, ${t("metrics.memoryLimit", { limit: gb(m.memoryLimit, lang) })}` : ""}`}
          >
            <Sparkline label={t("metrics.memory")} series={[{ points: m.memory, tone: "green" }]} limit={m.memoryLimit} />
          </MetricTile>
          <MetricTile title={t("metrics.network")} value={gb((s?.rxTotal ?? 0) + (s?.txTotal ?? 0), lang)} hint={t("metrics.networkHint", { rx: gb(s?.rxTotal, lang), tx: gb(s?.txTotal, lang) })}>
            <Sparkline label={t("metrics.network")} series={[{ points: m.tx, tone: "purple" }, { points: m.rx, tone: "blue" }]} />
          </MetricTile>
        </div>
      ) : null}
    </Section>
  )
}

function VariablesTab({ service }: { service: ServiceDto }) {
  const { t } = useTranslation("railway")
  const q = useRailwayVariables(service.id)
  const [text, setText] = useState("")
  const [onlyEmpty, setOnlyEmpty] = useState(false)
  const items = q.data?.items ?? []
  const emptyCount = items.filter((v) => v.state === "empty").length
  const shown = useMemo(() => items.filter((v) => (!onlyEmpty || v.state === "empty") && v.name.toLowerCase().includes(text.trim().toLowerCase())), [items, onlyEmpty, text])
  const TONE: Record<string, Tone> = { set: "green", empty: "orange", reference: "blue" }
  return (
    <Section
      icon={<Key />}
      title={t("variables.title", { service: service.name })}
      points={[{ icon: <ListBullet />, text: t("variables.points.names") }, { icon: <LockClosedSolid />, text: t("variables.points.never"), tone: "green" }]}
      actions={<SearchInput value={text} onChange={setText} placeholder={t("variables.search")} className="w-56" />}
    >
      <FilterBar>
        <FilterButton icon={<ListBullet />} label={t("variables.filter.all")} count={items.length} active={!onlyEmpty} onClick={() => setOnlyEmpty(false)} />
        <FilterButton icon={<ExclamationCircle />} label={t("variables.filter.empty")} count={emptyCount} attention active={onlyEmpty} onClick={() => setOnlyEmpty((v) => !v)} />
      </FilterBar>
      {q.isError ? <ReadError error={q.error} /> : null}
      {q.isLoading ? <KitLoading label={t("loading")} /> : null}
      {q.data && shown.length === 0 ? <EmptyState compact icon={<Key />} title={t("variables.empty")} /> : null}
      {shown.length ? (
        <ul className="grid grid-cols-1 gap-x-6 px-6 py-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((v) => (
            <li key={v.name} className="flex min-w-0 items-center justify-between gap-2 border-b border-ui-border-base py-1.5">
              <code className="txt-compact-small min-w-0 truncate font-mono text-ui-fg-base" title={v.name}>
                {v.name}
              </code>
              <ToneBadge tone={TONE[v.state]} dot>
                {t(`variables.state.${v.state}`)}
              </ToneBadge>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  )
}

function DomainsTab({ service, lang }: { service: ServiceDto; lang: string }) {
  const { t } = useTranslation("railway")
  return (
    <Section icon={<Globe />} title={t("domains.title", { service: service.name })}>
      <div className="grid grid-cols-1 gap-6 px-6 py-4 lg:grid-cols-2">
        <div className="flex flex-col gap-y-2">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {t("domains.domains")}
          </Text>
          {service.domains.length === 0 ? (
            <Text size="small" className="text-ui-fg-muted">
              {t("domains.none")}
            </Text>
          ) : (
            <ul className="flex flex-col divide-y">
              {service.domains.map((d) => (
                <li key={d.domain} className="flex min-w-0 items-center justify-between gap-2 py-2">
                  <span className="flex min-w-0 flex-col">
                    <a href={`https://${d.domain}`} target="_blank" rel="noreferrer" className="txt-compact-small-plus truncate text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                      {d.domain}
                    </a>
                    <span className="txt-compact-xsmall text-ui-fg-muted">
                      {t(`domains.${d.kind}`)}
                      {d.note ? `: ${d.note}` : ""}
                    </span>
                  </span>
                  <ToneBadge tone={d.ok === true ? "green" : d.ok === false ? "orange" : "grey"}>{d.ok === true ? t("domains.ok") : d.ok === false ? t("domains.issue") : t("domains.unknown")}</ToneBadge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-y-2">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {t("domains.volumes")}
          </Text>
          {service.volumes.length === 0 ? (
            <Text size="small" className="text-ui-fg-muted">
              {t("domains.noVolumes")}
            </Text>
          ) : (
            service.volumes.map((v) => (
              <div key={v.id} className="flex flex-col gap-1.5 rounded-lg border border-ui-border-base p-3">
                <span className="flex items-center justify-between gap-2">
                  <span className="txt-compact-small-plus flex min-w-0 items-center gap-1.5 text-ui-fg-base">
                    <ArchiveBox className="shrink-0 text-ui-fg-muted" />
                    <span className="truncate">{v.name}</span>
                  </span>
                  {v.pct !== null ? <ToneBadge tone={v.pct >= 95 ? "red" : v.pct >= 85 ? "orange" : "green"}>{`${Math.round(v.pct)} %`}</ToneBadge> : null}
                </span>
                <UsageBar pct={v.pct} />
                <span className="txt-compact-xsmall text-ui-fg-muted">
                  {mb(v.usedMB, lang)} / {mb(v.sizeMB, lang)}, <code className="font-mono">{v.mountPath}</code>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </Section>
  )
}

/** Scrolls to an element once it is there (after a render). */
export function useScrollTo(id: string | null, ready: boolean): void {
  useEffect(() => {
    if (!id || !ready || typeof document === "undefined") return
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }, [id, ready])
}
