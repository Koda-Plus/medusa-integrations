import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowPath,
  ArrowUturnLeft,
  Beaker,
  CheckCircle,
  Clock,
  ComputerDesktop,
  ExclamationCircle,
  ListBullet,
  LockClosedSolid,
  MagnifyingGlass,
  PencilSquare,
  Plus,
  ShieldCheck,
  Tag,
  User,
  XCircle,
  ArrowLongRight,
} from "@medusajs/icons"
import { Button, InlineTip, Switch, Table, Text, toast, usePrompt } from "@medusajs/ui"
import type { ReactNode } from "react"
import type { CatalogChangeDto, CatalogChangeStatus, SubiektStatusResponse, WriterDto, WriterKey } from "../../modules/subiekt/lib/contract"
import { skewLevel } from "../../modules/subiekt/lib/diagnostics"
import { errorMessage, useSubiektProducts, useSubiektRelease, useSubiektSync, useSubiektWriter } from "./subiekt-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, StatTile, StatTiles, ToneBadge, useDebouncedValue } from "./subiekt-blocks"
import { KeyPoints } from "./subiekt-guide"
import { KitSkeletonRows } from "./subiekt-kit"
import {
  CatalogStatusBadge,
  Field,
  Pager,
  RunStatusBadge,
  SampleList,
  StoreColumn,
  StoreLink,
  StoreUnlinked,
  fmtDateTime,
  fmtDuration,
  fmtMoney,
  fmtMs,
  fmtNumber,
  runSummary,
} from "./subiekt-ui"

/*
 * The 0.2.0 sections of the Subiekt page: what the bridge reported (Bridge)
 * and the write switches (Writers), both in Settings, and the plan of
 * products and prices from Subiekt, in the Panel next to the store products.
 * The page composes them; every string comes from i18n.
 */

const PAGE_SIZE = 15

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
    <Section
      icon={<ComputerDesktop />}
      title={t("bridge.title")}
      points={[
        { icon: <Clock />, text: t("bridge.points.last") },
        { icon: <ShieldCheck />, text: t("bridge.points.fresh") },
      ]}
      pointsLabel={t("bridge.subtitle")}
    >
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
                <ToneBadge key={c} tone="green">
                  {t(`bridge.capabilityNames.${c}`, { defaultValue: c })}
                </ToneBadge>
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
    </Section>
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
            <ToneBadge tone="green">{t("writers.active")}</ToneBadge>
          ) : writer.armed ? (
            <ToneBadge tone="orange">{t("writers.blocked")}</ToneBadge>
          ) : (
            <ToneBadge>{t("writers.disarmed")}</ToneBadge>
          )}
          <ToneBadge icon={writer.allowed ? undefined : <LockClosedSolid />}>
            {t("writers.option", { option: writer.option })} {writer.allowed ? t("writers.allowed") : t("writers.forbidden")}
          </ToneBadge>
        </div>
        <Text size="small" className="text-ui-fg-subtle">
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
    <Section
      icon={<LockClosedSolid />}
      title={t("writers.title")}
      badges={status.mode === "demo" ? <ToneBadge tone="blue" title={t("writers.demoNote")}>{t("widget.demo")}</ToneBadge> : null}
      points={[
        { icon: <PencilSquare />, text: t("writers.points.option") },
        { icon: <User />, text: t("writers.points.person") },
        { icon: <LockClosedSolid />, text: t("writers.points.falseWins") },
      ]}
      pointsLabel={t("writers.subtitle")}
    >
      {writers.map((w) => (
        <WriterRow key={w.key} writer={w} status={status} lang={lang} />
      ))}
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Products and prices from Subiekt                                    */

type ProductKind = "all" | "price" | "create"

const STATUS_FILTERS: CatalogChangeStatus[] = ["planned", "applied", "simulated", "over_cap", "stale", "failed", "quarantined", "skipped"]

const STATUS_ICON: Record<CatalogChangeStatus, ReactNode> = {
  planned: <Clock />,
  applied: <CheckCircle />,
  simulated: <Beaker />,
  over_cap: <ArrowLongRight />,
  stale: <ArrowPath />,
  failed: <XCircle />,
  quarantined: <ExclamationCircle />,
  skipped: <ArrowUturnLeft />,
}

/** Statuses a person should look at: their count is orange while above zero. */
const STATUS_ATTENTION = new Set<CatalogChangeStatus>(["failed", "quarantined", "stale"])

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

/**
 * The Subiekt side of a plan row: the product as Subiekt knows it. A new
 * product shows its Subiekt name; a price change its symbol, because its
 * name in the row is the store's and sits in the store cell.
 */
function SubiektProductCell({ change: c }: { change: CatalogChangeDto }) {
  const codes = [c.kind === "create" ? c.symbol : null, c.ean ? `EAN ${c.ean}` : null].filter(Boolean).join(", ")
  return (
    <div className="flex min-w-0 flex-col">
      <Text size="small" className="truncate text-ui-fg-base">
        {c.kind === "create" ? c.title ?? c.symbol : c.symbol}
      </Text>
      {codes ? (
        <Text size="xsmall" className="truncate font-mono text-ui-fg-muted">
          {codes}
        </Text>
      ) : null}
    </div>
  )
}

/** The store side of a plan row: the product in Medusa, one click away, or why there is none. */
function StoreProductCell({ change: c }: { change: CatalogChangeDto }) {
  const { t } = useTranslation("subiekt")
  if (c.productId) {
    const code = c.matchedBy === "ean" ? c.ean : c.sku
    const matched = c.matchedBy && code ? t("products.matchedKey", { by: t(`products.matchedBy.${c.matchedBy}`, { defaultValue: c.matchedBy }), code }) : undefined
    return (
      <StoreLink
        to={`/products/${c.productId}`}
        title={c.title ?? c.sku ?? c.symbol}
        mono={c.sku ?? (c.ean ? `EAN ${c.ean}` : null)}
        monoTitle={matched}
        action={t("store.openProduct")}
      />
    )
  }
  if (c.kind === "create" && c.status === "applied") {
    // The writer created a draft whose SKU is the Subiekt symbol; the plan row keeps no product id, so the link searches the product list by it.
    return <StoreLink to={`/products?q=${encodeURIComponent(c.symbol)}`} title={c.title ?? c.symbol} mono={c.symbol} monoTitle={t("store.draft")} action={t("store.findProduct")} />
  }
  if (c.kind === "create") return <StoreUnlinked label={t("store.notInStore")} hint={t("store.notInStoreHint")} mono={c.symbol} />
  return <StoreUnlinked label={t("store.noProduct")} mono={c.sku ?? c.symbol} />
}

export function ProductsSection({ status, lang, poll, onAction }: { status: SubiektStatusResponse; lang: string; poll: boolean; onAction: () => void }) {
  const { t } = useTranslation("subiekt")
  const [kind, setKind] = useState<ProductKind>("all")
  const [filter, setFilter] = useState<CatalogChangeStatus | "all">("all")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const q = useDebouncedValue(search).trim()
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
    <Section
      id="subiekt-products"
      icon={<Tag />}
      title={t("products.title")}
      badges={
        <>
          {run?.dryRun ? <ToneBadge tone="blue">{t("stock.dryRun")}</ToneBadge> : null}
          {run ? <RunStatusBadge status={run.status} /> : null}
        </>
      }
      points={[
        { icon: <ListBullet />, text: t("products.points.plan") },
        { icon: <MagnifyingGlass />, text: t("products.points.match"), title: t("products.matching") },
        { icon: <LockClosedSolid />, text: t("products.points.writer") },
      ]}
      pointsLabel={t("products.subtitle")}
      actions={
        <>
          <SearchInput value={search} onChange={setSearch} placeholder={t("products.search")} />
          <Button size="small" variant="secondary" disabled={!ready || !supported || !o.productSyncEnabled || running} isLoading={sync.isPending} onClick={onRead}>
            <ArrowPath />
            {running ? t("actions.running") : t("actions.products")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-y-1 px-6 py-3">
        <Text size="small">{settings}</Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          {run ? `${runSummary(run, t)} ${fmtDateTime(run.startedAt, lang)}, ${fmtDuration(run.durationMs)}` : t("products.never")}
        </Text>
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
        <StatTiles columns={4}>
          {counters.map(([key, value, warn]) => (
            <StatTile key={key} label={t(`products.counters.${key}`)} value={fmtNumber(value ?? 0, lang)} tone={warn && value ? "orange" : "grey"} />
          ))}
        </StatTiles>
      ) : null}

      {stats?.samples && (stats.samples.conflicts?.length || stats.samples.unmatchedVariants?.length || stats.samples.noPrice?.length) ? (
        <div className="flex flex-col gap-y-3 px-6 py-4">
          {stats.samples.conflicts?.length ? <SampleList label={t("products.samples.conflicts")} items={stats.samples.conflicts} /> : null}
          {stats.samples.unmatchedVariants?.length ? <SampleList label={t("products.samples.unmatchedVariants")} items={stats.samples.unmatchedVariants} /> : null}
          {stats.samples.noPrice?.length ? <SampleList label={t("products.samples.noPrice")} items={stats.samples.noPrice} /> : null}
        </div>
      ) : null}

      <FilterBar>
        <FilterButton icon={<ListBullet />} label={t("products.statuses.all")} count={summary?.total} active={kind === "all" && filter === "all"} onClick={() => (setKind("all"), setFilter("all"))} />
        <FilterButton icon={<Tag />} label={t("products.kinds.price")} active={kind === "price"} onClick={() => setKind(kind === "price" ? "all" : "price")} />
        <FilterButton icon={<Plus />} label={t("products.kinds.create")} active={kind === "create"} onClick={() => setKind(kind === "create" ? "all" : "create")} />
        {STATUS_FILTERS.some((st) => (summary?.[st] ?? 0) > 0 || st === filter) ? <FilterDivider /> : null}
        {STATUS_FILTERS.filter((st) => (summary?.[st] ?? 0) > 0 || st === filter).map((st) => (
          <FilterButton
            key={st}
            icon={STATUS_ICON[st]}
            label={t(`products.statuses.${st}`)}
            count={summary?.[st]}
            attention={STATUS_ATTENTION.has(st)}
            active={filter === st}
            onClick={() => setFilter(filter === st ? "all" : st)}
          />
        ))}
      </FilterBar>

      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("products.columns.product")}</Table.HeaderCell>
              <Table.HeaderCell>{t("products.columns.change")}</Table.HeaderCell>
              <Table.HeaderCell>
                <StoreColumn label={t("products.columns.store")} hint={t("products.matching")} />
              </Table.HeaderCell>
              <Table.HeaderCell>{t("products.columns.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("products.columns.details")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {products.isLoading ? (
              <KitSkeletonRows cols={5} rows={4} />
            ) : rows.length === 0 ? (
              <EmptyTableRow cols={5} icon={<Tag />} title={t("products.empty")} />
            ) : (
              rows.map((c) => (
                <Table.Row key={c.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-[240px]">
                    <SubiektProductCell change={c} />
                  </Table.Cell>
                  <Table.Cell>
                    <ChangeCell change={c} lang={lang} />
                  </Table.Cell>
                  <Table.Cell className="max-w-[300px]">
                    <StoreProductCell change={c} />
                  </Table.Cell>
                  <Table.Cell>
                    <CatalogStatusBadge status={c.status} dot />
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
          <span className="flex flex-wrap items-center gap-2">
            <Text size="small" weight="plus">
              {t("products.quarantine")}
            </Text>
            <KeyPoints
              items={[
                { icon: <ExclamationCircle />, text: t("products.quarantinePoints.skipped"), tone: "orange" },
                { icon: <PencilSquare />, text: t("products.quarantinePoints.fix") },
              ]}
              label={t("products.quarantineHint")}
            />
          </span>
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
                <RowActions
                  actions={[
                    {
                      key: "release",
                      label: t("actions.release"),
                      icon: <ArrowUturnLeft />,
                      loading: release.isPending && release.variables === item.id,
                      onClick: () => void onRelease(item.id),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  )
}
