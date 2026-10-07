import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Container, InlineTip, Input, StatusBadge, Table, Text, toast, usePrompt } from "@medusajs/ui"
import type { AllegroPlanItemDto, AllegroPlanKind, AllegroStatusResponse } from "../../modules/allegro/lib/contract"
import { errorMessage, useAllegroPlan, useAllegroPlanRelease, useAllegroPlanRun } from "./allegro-api"
import { EmptyRow, PLAN_TONE, Pager, Pills, SectionHeader, fmtDateTime, fmtMoney, useDebounced } from "./allegro-ui"

const PAGE = 15
const FILTERS = ["changes", "planned", "deferred", "quarantined", "skipped", "in_sync", "applied", "failed", "all"] as const
type Filter = (typeof FILTERS)[number]

const WRITER: Record<AllegroPlanKind, "stock" | "prices" | "publish"> = { stock: "stock", prices: "prices", publish: "publish" }

function num(v: unknown): number | null {
  const n = Number(v)
  return v === null || v === undefined || !Number.isFinite(n) ? null : n
}

function money(v: unknown): { value: number; currency: string } | null {
  if (!v || typeof v !== "object") return null
  const o = v as { amount?: unknown; currency?: unknown }
  const value = Number(o.amount)
  return Number.isFinite(value) ? { value, currency: String(o.currency ?? "PLN") } : null
}

function NowCell({ item, lang }: { item: AllegroPlanItemDto; lang: string }) {
  const { t } = useTranslation("allegro")
  const c = item.current ?? {}
  if (item.kind === "stock") {
    const allegro = num(c.allegro)
    const medusa = num(c.medusa)
    return (
      <span className="tabular-nums txt-compact-small text-ui-fg-base">
        {allegro ?? "?"}
        <span className="text-ui-fg-muted"> / {medusa ?? "∞"}</span>
      </span>
    )
  }
  if (item.kind === "prices") {
    const min = num(c.min)
    const max = num(c.max)
    const currency = String(c.currency ?? "PLN")
    return (
      <div className="flex flex-col gap-y-0.5">
        <span className="tabular-nums txt-compact-small text-ui-fg-base">{fmtMoney(money(c), lang)}</span>
        {min !== null || max !== null ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("plans.floorCeiling", {
              min: min !== null ? fmtMoney({ value: min, currency }, lang) : "?",
              max: max !== null ? fmtMoney({ value: max, currency }, lang) : "∞",
            })}
            {c.demoBounds ? ` (${t("plans.demoBounds")})` : ""}
          </Text>
        ) : null}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-y-0.5">
      <span className="font-mono txt-compact-small text-ui-fg-base">{String(c.ean ?? "")}</span>
      {c.simulatedEan ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("plans.simulatedEan")}
        </Text>
      ) : null}
    </div>
  )
}

function TargetCell({ item, lang }: { item: AllegroPlanItemDto; lang: string }) {
  const tg = item.target ?? null
  if (!tg) return null
  if (item.kind === "stock") return <span className="tabular-nums txt-compact-small-plus text-ui-fg-base">{num(tg.quantity) ?? ""}</span>
  if (item.kind === "prices") return <span className="tabular-nums txt-compact-small-plus text-ui-fg-base">{fmtMoney(money(tg), lang)}</span>
  return (
    <div className="flex flex-col gap-y-0.5">
      <span className="txt-compact-small text-ui-fg-base">{String(tg.catalogName ?? tg.catalogProductId ?? "")}</span>
      <Text size="xsmall" className="tabular-nums text-ui-fg-muted">
        {fmtMoney(money(tg.price), lang)} {num(tg.quantity) !== null ? `x ${num(tg.quantity)}` : ""}
      </Text>
    </div>
  )
}

export function PlanSection({ kind, status, lang }: { kind: AllegroPlanKind; status: AllegroStatusResponse; lang: string }) {
  const { t } = useTranslation("allegro")
  const prompt = usePrompt()
  const [filter, setFilter] = useState<Filter>("changes")
  const [search, setSearch] = useState("")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])
  const plan = useAllegroPlan(kind, filter, q, page * PAGE, PAGE)
  const run = useAllegroPlanRun()
  const release = useAllegroPlanRelease()
  const summary = status.plans[kind]
  const writer = status.writers.find((w) => w.key === WRITER[kind])
  const armed = Boolean(writer?.effective)
  const running = status.running[kind]
  const rows = plan.data?.items ?? []
  const counts = summary.counts

  const subtitle =
    kind === "stock"
      ? t("plans.stock.subtitle", { mode: t(`plans.mode.${status.settings.stockPush}`), cap: status.settings.stockPushCap })
      : kind === "prices"
        ? t("plans.prices.subtitle", { min: status.settings.prices.minKey, max: status.settings.prices.maxKey, cap: status.settings.prices.cap })
        : t("plans.publish.subtitle", { cap: status.settings.publish.cap })

  const onDryRun = async () => {
    try {
      const r = await run.mutateAsync({ kind, mode: "plan" })
      if (r.summary.refused) toast.warning(r.summary.refusedCode === "tax_exclusive_prices" ? t("plans.taxExclusive") : r.summary.refused)
      else toast.success(t("toast.dryRunDone"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onApply = async () => {
    const ok = await prompt({ title: t("plans.applyTitle"), description: t("plans.applyText"), confirmText: t("plans.applyConfirm"), cancelText: t("writers.cancel") })
    if (!ok) return
    try {
      await run.mutateAsync({ kind, mode: "apply" })
      toast.success(t("toast.applyStarted"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onRelease = async (id: string) => {
    try {
      await release.mutateAsync(id)
      toast.success(t("toast.released"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const total = (f: Filter): number | null => {
    if (f === "all") return Object.values(counts).reduce((a, b) => a + b, 0)
    if (f === "changes") return (counts.planned ?? 0) + (counts.deferred ?? 0) + (counts.quarantined ?? 0) + (counts.applied ?? 0) + (counts.failed ?? 0) + (counts.unknown ?? 0)
    return counts[f] ?? 0
  }

  return (
    <Container className="divide-y p-0">
      <SectionHeader
        title={t(`plans.${kind}.title`)}
        subtitle={subtitle}
        actions={
          <>
            <Button size="small" variant="secondary" isLoading={run.isPending && run.variables?.mode === "plan"} disabled={running} onClick={() => void onDryRun()}>
              {t("actions.dryRun")}
            </Button>
            <Button size="small" variant="primary" isLoading={running} disabled={!armed || running} onClick={() => void onApply()} title={armed ? undefined : t("plans.notArmed")}>
              {t("actions.applyNow")}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-2 px-6 py-3">
        <Text size="xsmall" className="text-ui-fg-muted">
          {summary.plannedAt ? t("plans.plannedAt", { when: fmtDateTime(summary.plannedAt, lang) }) : t("plans.never")}
          {summary.lastApply?.at
            ? ` | ${t("plans.lastApply", { when: fmtDateTime(summary.lastApply.at, lang), applied: summary.lastApply.applied, failed: summary.lastApply.failed })}`
            : ""}
        </Text>
        {summary.refused ? (
          <InlineTip variant="error" label={t("plans.refused")}>
            {summary.refusedCode === "tax_exclusive_prices" ? t("plans.taxExclusive") : summary.refused}
          </InlineTip>
        ) : null}
        {summary.lastApply?.message ? (
          <Text size="xsmall" className="text-ui-fg-subtle">
            {summary.lastApply.message}
          </Text>
        ) : null}
        {kind === "publish" && !status.settings.publish.ready ? (
          <InlineTip variant="warning" label={t("plans.publish.title")}>
            {t("plans.optionsMissing", { missing: status.settings.publish.missing.join(", ") })}
          </InlineTip>
        ) : null}
        {!armed ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("plans.notArmed")}
          </Text>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <Pills filters={FILTERS} value={filter} onChange={setFilter} label={(f) => t(`plans.filter.${f}`)} count={total} />
        <div className="w-full lg:w-64">
          <Input size="small" type="search" placeholder={t("offers.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("plans.col.item")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plans.col.now")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plans.col.target")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plans.col.action")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plans.col.reason")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plans.col.status")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow span={6} loading={plan.isLoading} text={t("plans.empty")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5 align-top">
                  <Table.Cell className="max-w-[300px]">
                    <div className="flex flex-col gap-y-1">
                      {r.productId ? (
                        <Link to={`/products/${r.productId}`} className="txt-compact-small-plus truncate text-ui-fg-base hover:text-ui-fg-interactive">
                          {r.title}
                        </Link>
                      ) : (
                        <span className="txt-compact-small-plus truncate text-ui-fg-base">{r.title}</span>
                      )}
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{r.sku}</span>
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-x-0.5 font-mono text-ui-fg-muted txt-compact-xsmall hover:text-ui-fg-interactive">
                            #{r.allegroId}
                            <ArrowUpRightOnBox />
                          </a>
                        ) : null}
                        {r.demo ? (
                          <Badge size="2xsmall" color="purple">
                            {t("offers.sample")}
                          </Badge>
                        ) : null}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <NowCell item={r} lang={lang} />
                  </Table.Cell>
                  <Table.Cell>
                    <TargetCell item={r} lang={lang} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    <Text size="small" className={r.action === "none" ? "text-ui-fg-muted" : "text-ui-fg-base"}>
                      {t(`plans.action.${r.action}`, { defaultValue: r.action })}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="max-w-[260px]">
                    <Text size="small" className="text-ui-fg-subtle">
                      {t(`plans.reason.${r.reason}`, { defaultValue: r.reason })}
                    </Text>
                    {r.lastError ? (
                      <Text size="xsmall" className="text-ui-tag-red-text">
                        {r.lastError}
                      </Text>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <StatusBadge color={PLAN_TONE[r.status] ?? "grey"}>{t(`plans.status.${r.status}`)}</StatusBadge>
                      {r.failures > 0 ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("plans.failures", { count: r.failures })}
                        </Text>
                      ) : null}
                      {r.status === "quarantined" ? (
                        <Button size="small" variant="transparent" onClick={() => void onRelease(r.id)} isLoading={release.isPending && release.variables === r.id}>
                          {t("actions.release")}
                        </Button>
                      ) : null}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Pager count={plan.data?.count ?? 0} page={page} size={PAGE} onPage={setPage} />
    </Container>
  )
}
