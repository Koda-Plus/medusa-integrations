import { useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowPath, LockClosedSolid } from "@medusajs/icons"
import { Badge, Button, Container, Heading, InlineTip, Input, Switch, Table, Text, clx, toast, usePrompt } from "@medusajs/ui"
import type { CatalogChangeDto, CatalogChangeStatus, SubiektStatusResponse, WriterDto, WriterKey } from "../../modules/subiekt/lib/contract"
import { skewLevel } from "../../modules/subiekt/lib/diagnostics"
import { errorMessage, useSubiektProducts, useSubiektRelease, useSubiektSync, useSubiektWriter } from "./subiekt-api"
import {
  CatalogStatusBadge,
  Field,
  FilterPills,
  Pager,
  RunStatusBadge,
  SampleList,
  fmtDateTime,
  fmtDuration,
  fmtMoney,
  fmtMs,
  fmtNumber,
  runSummary,
} from "./subiekt-ui"

/*
 * The 0.2.0 sections of the Subiekt page: what the bridge reported (Bridge),
 * the write switches (Writers) and the plan of products and prices from
 * Subiekt. The page composes them; every string comes from i18n.
 */

const PAGE_SIZE = 15

function SectionHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
      <div className="flex flex-col gap-y-1">
        <Heading level="h2">{title}</Heading>
        {subtitle ? (
          <Text size="small" className="max-w-2xl text-ui-fg-subtle">
            {subtitle}
          </Text>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Bridge diagnostics                                                  */

const LEVEL_TEXT: Record<string, string> = {
  ok: "text-ui-fg-base",
  warn: "text-ui-tag-orange-text",
  error: "text-ui-tag-red-text",
  unknown: "text-ui-fg-muted",
}

function signedMs(ms: number): string {
  const sign = ms > 0 ? "+" : ms < 0 ? "-" : ""
  return `${sign}${fmtMs(Math.abs(ms))}`
}

export function BridgeSection({ status, lang }: { status: SubiektStatusResponse; lang: string }) {
  const { t } = useTranslation("subiekt")
  const d = status.diagnostics
  const h = status.connection.health
  const none = t("connection.none")
  const skew = skewLevel(d.clockSkewMs)
  const licence = h?.subiekt?.licence === "ok" || h?.subiekt?.licence === "refused" ? h.subiekt.licence : "unknown"
  const signatureTone = d.signature === "ok" ? LEVEL_TEXT.ok : d.signature === "unknown" ? LEVEL_TEXT.unknown : LEVEL_TEXT.error
  const rejectedLater = Boolean(d.webhook.rejectedAt && (!d.webhook.lastAt || d.webhook.rejectedAt > d.webhook.lastAt))

  return (
    <Container className="divide-y p-0">
      <SectionHeader title={t("bridge.title")} subtitle={t("bridge.subtitle")} />
      {d.legacy ? (
        <div className="px-6 py-4">
          <InlineTip variant="warning" label={t("bridge.title")}>
            {t("bridge.legacy")}
          </InlineTip>
        </div>
      ) : null}
      {status.mode === "live" && h?.bridge?.mode === "fake" ? (
        <div className="px-6 py-4">
          <InlineTip variant="warning" label={t("bridge.title")}>
            {t("bridge.fakeMode")}
          </InlineTip>
        </div>
      ) : null}
      <div className="py-2">
        <Field label={t("bridge.versions")}>
          {t("bridge.versionsValue", { bridge: h?.bridge?.version ?? "?", contract: h?.bridge?.contract ?? "?", plugin: status.pluginVersion })}
        </Field>
        <Field label={t("bridge.sdk")}>{h ? t("bridge.sdkValue", { sdk: h.bridge?.sdk_version ?? none, db: h.subiekt?.database_version ?? none }) : none}</Field>
        <Field label={t("bridge.licence")}>
          <span className={licence === "refused" ? LEVEL_TEXT.error : licence === "ok" ? LEVEL_TEXT.ok : LEVEL_TEXT.unknown}>{t(`bridge.licenceStates.${licence}`)}</span>
        </Field>
        <Field label={t("bridge.started")}>{fmtDateTime(h?.bridge?.started_at, lang) || none}</Field>
        <Field label={t("bridge.latency")}>{fmtMs(d.latencyMs)}</Field>
        <Field label={t("bridge.skew")}>
          <span className={LEVEL_TEXT[skew]}>{t(`bridge.skewStates.${skew}`, { value: d.clockSkewMs === null ? "" : signedMs(d.clockSkewMs) })}</span>
        </Field>
        <Field label={t("bridge.signature")}>
          <span className={signatureTone}>{t(`bridge.signatureStates.${d.signature}`, { defaultValue: d.signature })}</span>
        </Field>
        <Field label={t("bridge.lastEvent")}>
          {h?.events ? t("bridge.lastEventValue", { id: h.events.last_id, time: fmtDateTime(h.events.last_at, lang) || none }) : none}
        </Field>
        <Field label={t("bridge.queues")}>{h?.queues ? t("bridge.queuesValue", { sfera: h.queues.sfera_pending, webhook: h.queues.webhook_pending }) : none}</Field>
        <Field label={t("bridge.webhook")}>
          <div className="flex flex-col">
            <span>{d.webhook.lastAt ? t("bridge.webhookValue", { time: fmtDateTime(d.webhook.lastAt, lang) }) : t("bridge.webhookNever")}</span>
            {rejectedLater ? (
              <span className={LEVEL_TEXT.warn}>
                {t("bridge.webhookRejected", {
                  time: fmtDateTime(d.webhook.rejectedAt, lang),
                  reason: t(`bridge.webhookReasons.${d.webhook.rejectReason ?? "missing"}`, { defaultValue: d.webhook.rejectReason ?? "" }),
                })}
              </span>
            ) : null}
          </div>
        </Field>
        <Field label={t("connection.checkedAt")}>{fmtDateTime(d.checkedAt, lang) || t("connection.never")}</Field>
      </div>
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <div className="flex flex-col gap-y-1">
          <Text size="xsmall" className="text-ui-fg-subtle">
            {t("bridge.capabilities")}
          </Text>
          <div className="flex flex-wrap gap-1">
            {d.capabilities.length === 0 ? (
              <Text size="small" className="text-ui-fg-muted">
                {none}
              </Text>
            ) : (
              d.capabilities.map((c) => (
                <Badge key={c} size="2xsmall" color="green">
                  {t(`bridge.capabilityNames.${c}`, { defaultValue: c })}
                </Badge>
              ))
            )}
          </div>
        </div>
        {d.missing.length > 0 ? (
          <div className="flex flex-col gap-y-1">
            <Text size="xsmall" className="text-ui-fg-subtle">
              {t("bridge.cannot")}
            </Text>
            <ul className="flex flex-col gap-y-1">
              {d.missing.map((m) => {
                const hint = m.reason === "bridge_config" ? t(`bridge.capabilityHints.${m.capability}`, { defaultValue: "" }) : ""
                return (
                  <li key={m.capability} className="txt-compact-small flex flex-wrap gap-x-1">
                    <span className="text-ui-fg-base">{t(`bridge.capabilityNames.${m.capability}`, { defaultValue: m.capability })}:</span>
                    <span className="text-ui-fg-subtle">{t(`bridge.reasons.${m.reason}`, { defaultValue: m.reason })}</span>
                    {hint ? <span className="font-mono text-ui-fg-muted">({hint})</span> : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Writers                                                             */

/** In the order a store usually arms them: documents first, catalog last. */
const WRITER_ORDER: WriterKey[] = ["documents", "contractors", "prices", "products"]

function WriterRow({ writer, status, lang }: { writer: WriterDto; status: SubiektStatusResponse; lang: string }) {
  const { t } = useTranslation("subiekt")
  const prompt = usePrompt()
  const toggle = useSubiektWriter()
  const name = t(`writers.names.${writer.key}`)
  const demo = status.mode === "demo"
  const o = status.options
  const description = t(`writers.descriptions.${writer.key}`, {
    cap: writer.key === "prices" ? o.maxPriceChangesPerRun : o.maxProductsPerRun,
    mode: t(`writers.documentModes.${o.salesDocument}`),
  })

  const onChange = async (armed: boolean) => {
    const ok = await prompt({
      title: armed ? t("writers.armTitle", { name }) : t("writers.disarmTitle", { name }),
      description: armed ? (demo ? t("writers.armTextDemo") : t("writers.armText")) : t("writers.disarmText"),
      confirmText: armed ? t("writers.armConfirm") : t("writers.disarmConfirm"),
      cancelText: t("writers.cancel"),
    })
    if (!ok) return
    try {
      await toggle.mutateAsync({ writer: writer.key, armed })
      toast.success(armed ? t("writers.armedToast") : t("writers.disarmedToast"))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const canArm = writer.allowed && !writer.unsupported
  return (
    <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {name}
          </Text>
          {writer.active ? (
            <Badge size="2xsmall" color="green">
              {t("writers.active")}
            </Badge>
          ) : writer.armed ? (
            <Badge size="2xsmall" color="orange">
              {t("writers.blocked")}
            </Badge>
          ) : (
            <Badge size="2xsmall" color="grey">
              {t("writers.disarmed")}
            </Badge>
          )}
          <Badge size="2xsmall" color="grey">
            <span className="inline-flex items-center gap-x-1">
              {writer.allowed ? null : <LockClosedSolid />}
              {t("writers.option", { option: writer.option })} {writer.allowed ? t("writers.allowed") : t("writers.forbidden")}
            </span>
          </Badge>
        </div>
        <Text size="small" className="max-w-2xl text-ui-fg-subtle">
          {description}
        </Text>
        {writer.unsupported ? (
          <Text size="xsmall" className="text-ui-tag-orange-text">
            {t("writers.unsupported")}
          </Text>
        ) : null}
        <Text size="xsmall" className="text-ui-fg-muted">
          {writer.changedAt
            ? t(writer.armed ? "writers.armedBy" : "writers.disarmedBy", { who: writer.changedBy ?? "?", time: fmtDateTime(writer.changedAt, lang) })
            : t("writers.never")}
        </Text>
      </div>
      <div className="flex shrink-0 items-center gap-x-2 pt-0.5">
        <Switch checked={writer.armed} disabled={toggle.isPending || (!writer.armed && !canArm)} onCheckedChange={(v) => void onChange(Boolean(v))} aria-label={name} />
      </div>
    </div>
  )
}

export function WritersSection({ status, lang }: { status: SubiektStatusResponse; lang: string }) {
  const { t } = useTranslation("subiekt")
  const writers = WRITER_ORDER.map((k) => status.writers.find((w) => w.key === k)).filter((w): w is WriterDto => Boolean(w))
  return (
    <Container className="divide-y p-0">
      <SectionHeader title={t("writers.title")} subtitle={t("writers.subtitle")} />
      {status.mode === "demo" ? (
        <div className="px-6 py-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("writers.demoNote")}
          </Text>
        </div>
      ) : null}
      <div className="divide-y">
        {writers.map((w) => (
          <WriterRow key={w.key} writer={w} status={status} lang={lang} />
        ))}
      </div>
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Products and prices from Subiekt                                    */

type ProductKind = "all" | "price" | "create"
type ProductStatusFilter = "all" | CatalogChangeStatus

const STATUS_FILTERS: CatalogChangeStatus[] = ["planned", "applied", "simulated", "over_cap", "stale", "failed", "quarantined", "skipped"]

interface ProductStats {
  subiektProducts?: number
  matched?: number
  priceChanges?: number
  unchanged?: number
  toCreate?: number
  conflicts?: number
  unmatchedVariants?: number
  noPrice?: number
  level?: string | null
  blocked?: "no_level" | "currency_mismatch" | null
  samples?: { conflicts?: string[]; unmatchedVariants?: string[]; noPrice?: string[] }
}

function ChangeCell({ change, lang }: { change: CatalogChangeDto; lang: string }) {
  const { t } = useTranslation("subiekt")
  if (change.kind === "create") return <span>{t("products.newProduct", { price: fmtMoney(change.to, change.currency, lang) })}</span>
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="text-ui-fg-muted">{fmtMoney(change.from, change.currency, lang)}</span> → {fmtMoney(change.to, change.currency, lang)}
    </span>
  )
}

export function ProductsSection({ status, lang, poll, onAction }: { status: SubiektStatusResponse; lang: string; poll: boolean; onAction: () => void }) {
  const { t } = useTranslation("subiekt")
  const [kind, setKind] = useState<ProductKind>("all")
  const [filter, setFilter] = useState<ProductStatusFilter>("all")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const q = search.trim()
  const running = status.running.includes("products")
  const products = useSubiektProducts(kind, filter, q, offset, PAGE_SIZE, poll || running)
  const sync = useSubiektSync()
  const release = useSubiektRelease()
  useEffect(() => setOffset(0), [kind, filter, q])

  const data = products.data
  const run = data?.run ?? status.lastRuns.products ?? null
  const stats = (run?.stats ?? null) as ProductStats | null
  const o = status.options
  const supported = status.mode === "demo" || status.diagnostics.capabilities.includes("products")
  const ready = status.mode === "demo" || status.configured
  const rows = data?.changes ?? []
  const summary = data?.summary

  const level = o.priceLevel || stats?.level
  const settings = t("products.settings", {
    level: level ? t("products.settingsLevel", { symbol: level }) : t("products.firstLevel"),
    type: t(`products.types.${o.priceType}`),
    target: o.priceTarget === "price_list" ? t("products.settingsTargets.price_list", { id: o.priceListId ?? "?" }) : t("products.settingsTargets.variant"),
    currency: o.priceCurrency.toUpperCase(),
  })

  const onRead = async () => {
    try {
      const r = await sync.mutateAsync("products")
      if (r.alreadyRunning) toast.info(t("toast.already"))
      else toast.success(t("toast.started"))
      onAction()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const onRelease = async (id: string) => {
    try {
      await release.mutateAsync(id)
      toast.success(t("toast.released"))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const counters: Array<[keyof ProductStats & string, number | undefined, boolean]> = stats
    ? [
        ["subiektProducts", stats.subiektProducts, false],
        ["matched", stats.matched, false],
        ["priceChanges", stats.priceChanges, false],
        ["unchanged", stats.unchanged, false],
        ["toCreate", stats.toCreate, false],
        ["conflicts", stats.conflicts, true],
        ["unmatchedVariants", stats.unmatchedVariants, true],
        ["noPrice", stats.noPrice, true],
      ]
    : []

  return (
    <Container className="divide-y p-0">
      <SectionHeader title={t("products.title")} subtitle={t("products.subtitle")}>
        {run?.dryRun ? (
          <Badge size="2xsmall" color="purple">
            {t("stock.dryRun")}
          </Badge>
        ) : null}
        {run ? <RunStatusBadge status={run.status} /> : null}
        <Button size="small" variant="secondary" disabled={!ready || !supported || !o.productSyncEnabled || running} isLoading={sync.isPending} onClick={onRead}>
          <ArrowPath />
          {running ? t("actions.running") : t("actions.products")}
        </Button>
      </SectionHeader>

      <div className="flex flex-col gap-y-1 px-6 py-3">
        <Text size="small">{settings}</Text>
        {run ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {runSummary(run, t)} {fmtDateTime(run.startedAt, lang)}, {fmtDuration(run.durationMs)}
          </Text>
        ) : (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("products.never")}
          </Text>
        )}
      </div>

      {!o.productSyncEnabled ? (
        <div className="px-6 py-4">
          <InlineTip variant="info" label={t("products.title")}>
            {t("products.disabled")}
          </InlineTip>
        </div>
      ) : !supported ? (
        <div className="px-6 py-4">
          <InlineTip variant="warning" label={t("products.title")}>
            {t("products.unsupported")}
          </InlineTip>
        </div>
      ) : null}
      {stats?.blocked ? (
        <div className="px-6 py-4">
          <InlineTip variant="warning" label={t("products.title")}>
            {t(`products.blocked.${stats.blocked}`)}
          </InlineTip>
        </div>
      ) : null}

      {counters.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-6 py-4 sm:grid-cols-4">
          {counters.map(([key, value, warn]) => (
            <div key={key} className="flex flex-col">
              <Text size="xsmall" className="text-ui-fg-subtle">
                {t(`products.counters.${key}`)}
              </Text>
              <Text size="small" weight="plus" className={clx("tabular-nums", warn && value ? "text-ui-tag-orange-text" : undefined)}>
                {fmtNumber(value ?? 0, lang)}
              </Text>
            </div>
          ))}
        </div>
      ) : null}

      {stats?.samples && (stats.samples.conflicts?.length || stats.samples.unmatchedVariants?.length || stats.samples.noPrice?.length) ? (
        <div className="flex flex-col gap-y-3 px-6 py-4">
          {stats.samples.conflicts?.length ? <SampleList label={t("products.samples.conflicts")} items={stats.samples.conflicts} /> : null}
          {stats.samples.unmatchedVariants?.length ? <SampleList label={t("products.samples.unmatchedVariants")} items={stats.samples.unmatchedVariants} /> : null}
          {stats.samples.noPrice?.length ? <SampleList label={t("products.samples.noPrice")} items={stats.samples.noPrice} /> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 px-6 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <FilterPills<ProductKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: t("products.statuses.all") },
              { value: "price", label: t("products.kinds.price") },
              { value: "create", label: t("products.kinds.create") },
            ]}
          />
          <div className="w-full md:w-56">
            <Input size="small" type="search" placeholder={t("products.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <FilterPills<ProductStatusFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("products.statuses.all"), count: summary?.total },
            ...STATUS_FILTERS.filter((s) => (summary?.[s] ?? 0) > 0 || s === filter).map((s) => ({ value: s, label: t(`products.statuses.${s}`), count: summary?.[s] })),
          ]}
        />
      </div>

      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("products.columns.product")}</Table.HeaderCell>
              <Table.HeaderCell>{t("products.columns.change")}</Table.HeaderCell>
              <Table.HeaderCell>{t("products.columns.matched")}</Table.HeaderCell>
              <Table.HeaderCell>{t("products.columns.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("products.columns.details")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <Table.Row>
                <td colSpan={5} className="px-6 py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {products.isLoading ? "" : t("products.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : (
              rows.map((c) => (
                <Table.Row key={c.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-xs">
                    <div className="flex min-w-0 flex-col">
                      <Text size="small" className="truncate text-ui-fg-base">
                        {c.title ?? c.symbol}
                      </Text>
                      <Text size="xsmall" className="truncate font-mono text-ui-fg-muted">
                        {[c.symbol, c.sku && c.sku !== c.symbol ? `SKU ${c.sku}` : null, c.ean ? `EAN ${c.ean}` : null].filter(Boolean).join(", ")}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <ChangeCell change={c} lang={lang} />
                  </Table.Cell>
                  <Table.Cell>{c.matchedBy ? t(`products.matchedBy.${c.matchedBy}`, { defaultValue: c.matchedBy }) : "-"}</Table.Cell>
                  <Table.Cell>
                    <CatalogStatusBadge status={c.status} />
                  </Table.Cell>
                  <Table.Cell className="max-w-md">
                    {c.lastError ? (
                      <Text size="small" className={c.status === "failed" || c.status === "quarantined" ? "text-ui-tag-red-text" : "text-ui-fg-subtle"}>
                        {c.lastError}
                      </Text>
                    ) : null}
                    {c.appliedAt ? (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {fmtDateTime(c.appliedAt, lang)}
                      </Text>
                    ) : null}
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pager offset={offset} limit={PAGE_SIZE} count={data?.count ?? 0} onChange={setOffset} />

      {data && data.quarantined.length > 0 ? (
        <div className="flex flex-col gap-y-2 px-6 py-4">
          <Text size="small" weight="plus">
            {t("products.quarantine")}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("products.quarantineHint")}
          </Text>
          <ul className="flex flex-col divide-y">
            {data.quarantined.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-x-4 py-2">
                <div className="flex min-w-0 flex-col">
                  <Text size="small" className="font-mono">
                    {t(`products.kinds.${item.kind}`)}: {item.key}
                  </Text>
                  {item.lastError ? (
                    <Text size="xsmall" className="text-ui-tag-red-text">
                      {item.lastError}
                    </Text>
                  ) : null}
                </div>
                <Button size="small" variant="secondary" isLoading={release.isPending && release.variables === item.id} onClick={() => onRelease(item.id)}>
                  {t("actions.release")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Container>
  )
}
