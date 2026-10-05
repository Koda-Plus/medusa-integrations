import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowUpRightOnBox, PlaySolid } from "@medusajs/icons"
import { Badge, Button, Container, Heading, InlineTip, Input, StatusBadge, Switch, Table, Text, clx, toast, usePrompt } from "@medusajs/ui"
import type {
  OlxPlanCountsDto,
  OlxPlanItemDto,
  OlxPublicationDto,
  OlxStatusResponse,
  OlxWriterDto,
  OlxWriterKey,
  OlxWriterRunDto,
} from "../../modules/olx/lib/contract"
import { errorMessage, useOlxArm, useOlxPlan, useOlxPublications, useOlxRelease, useOlxWriterRun } from "./olx-api"
import { Chip, PlanStateBadge, ProblemList, PublicationStateBadge, WRITER_OPTION, fmtDateTime, fmtPrice } from "./olx-ui"

/*
 * The writers: one card per writer with both switches, its plan counts and
 * the last runs, and the plans below (what would change, from what to what).
 */

const PAGE_SIZE = 20
const COUNT_KEYS: Array<keyof OlxPlanCountsDto> = ["pending", "held", "applying", "unknown", "failed", "quarantined", "done"]
const COUNT_COLOR: Record<keyof OlxPlanCountsDto, "blue" | "orange" | "purple" | "red" | "green" | "grey"> = {
  pending: "blue",
  held: "orange",
  applying: "blue",
  unknown: "purple",
  failed: "orange",
  quarantined: "red",
  done: "green",
}

const pagination = (t: (k: string) => string) => ({
  of: t("pagination.of"),
  results: t("pagination.results"),
  pages: t("pagination.pages"),
  prev: t("pagination.prev"),
  next: t("pagination.next"),
})

/** "stopped:throttled" and friends, as a sentence. */
function runMessage(t: (k: string, o?: Record<string, unknown>) => string, run: OlxWriterRunDto, lang: string): string | null {
  if (!run.message) return null
  const [kind, ...rest] = run.message.split(":")
  const detail = rest.join(":")
  if (kind === "stopped") return t("writers.runMessage.stopped", { detail: t(`writers.stop.${detail}`) })
  if (kind === "blocked") {
    const reasons = detail
      .split(",")
      .filter(Boolean)
      .map((b) => (b === "not_armed" ? t("writers.off") : t(`writers.blocker.${b}`, { option: "" }) || b))
    return t("writers.runMessage.blocked", { detail: reasons.join(" ") })
  }
  if (kind === "plan_skipped") return t(`writers.skipped.${detail}`)
  if (kind === "ip_blocked") return t("writers.runMessage.ip_blocked", { detail: fmtDateTime(detail, lang) || detail })
  if (kind === "guard") return t("writers.runMessage.guard", { detail })
  return run.message
}

function RunLine({ run, lang, dry }: { run: OlxWriterRunDto; lang: string; dry: boolean }) {
  const { t } = useTranslation("olx")
  const when = fmtDateTime(run.startedAt, lang)
  const color = run.status === "ok" ? "green" : run.status === "skipped" ? "grey" : run.status === "held" ? "orange" : run.status === "partial" ? "orange" : "red"
  const message = runMessage(t, run, lang)
  return (
    <div className="flex flex-col gap-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge color={color}>{t(`writers.runStatus.${run.status}`)}</StatusBadge>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {dry ? t("writers.lastDryRun", { when }) : t("writers.lastRun", { when })}
          {": "}
          {dry
            ? t("writers.dryRunSummary", { count: run.planned })
            : t("writers.runSummary", { succeeded: run.succeeded, failed: run.failed, quarantined: run.quarantined, unknown: run.unknown })}
        </Text>
      </div>
      {message ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {message}
        </Text>
      ) : null}
      {run.actor ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {run.actor}
        </Text>
      ) : null}
    </div>
  )
}

function DryRunItems({ run, lang }: { run: OlxWriterRunDto; lang: string }) {
  const { t } = useTranslation("olx")
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-y-2">
      <button type="button" onClick={() => setOpen(!open)} className="txt-compact-xsmall-plus w-fit text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
        {t("writers.dryRunTitle", { when: fmtDateTime(run.startedAt, lang) })} ({run.items.length})
      </button>
      {open ? (
        run.items.length === 0 ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("writers.dryRunEmpty")}
          </Text>
        ) : (
          <ul className="flex max-h-56 flex-col gap-y-1 overflow-y-auto rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
            {run.items.map((i, n) => (
              <li key={`${i.olxId ?? i.variantId}-${n}`} className="flex flex-col">
                <span className="font-mono text-ui-fg-base txt-compact-xsmall break-all">{i.detail}</span>
                <span className="text-ui-fg-muted txt-compact-xsmall">{t(`writers.outcome.${i.outcome}`)}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  )
}

function WriterCard({ writer: w, status, lang }: { writer: OlxWriterDto; status: OlxStatusResponse; lang: string }) {
  const { t } = useTranslation("olx")
  const prompt = usePrompt()
  const arm = useOlxArm()
  const run = useOlxWriterRun()
  const name = t(`writers.name.${w.writer}`)
  const demo = status.mode === "demo"
  const counts = w.writer === "publish" ? "writers.publishCounts" : "writers.counts"
  const guardHeld = w.writer === "lifecycle" && status.plan.guard.held

  const onToggle = async (next: boolean) => {
    if (next) {
      const ok = await prompt({
        title: t("writers.armConfirm.title", { name }),
        description: `${t("writers.armConfirm.description", { what: t(`writers.armConfirm.what.${w.writer}`), cap: w.cap })}${demo ? ` ${t("writers.armConfirm.demo")}` : ""}`,
        confirmText: t("writers.armConfirm.confirm"),
        cancelText: t("writers.armConfirm.cancel"),
        variant: "confirmation",
      })
      if (!ok) return
    }
    try {
      await arm.mutateAsync({ writer: w.writer, armed: next })
      toast.success(next ? t("writers.toast.armed", { name }) : t("writers.toast.disarmed", { name }))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onDryRun = async () => {
    try {
      const r = await run.mutateAsync({ writer: w.writer, dryRun: true })
      if (r.alreadyRunning) toast.info(t("toast.alreadyRunning"))
      else toast.success(t("writers.toast.dryRun", { count: r.run?.planned ?? 0 }))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onRun = async () => {
    let overrideGuard = false
    if (guardHeld) {
      const ok = await prompt({
        title: t("writers.guardConfirm.title"),
        description: t("writers.guardConfirm.description", { cap: w.cap }),
        confirmText: t("writers.guardConfirm.confirm"),
        cancelText: t("writers.guardConfirm.cancel"),
        variant: "danger",
      })
      if (!ok) return
      overrideGuard = true
    }
    try {
      const r = await run.mutateAsync({ writer: w.writer, dryRun: false, overrideGuard })
      toast.info(r.alreadyRunning ? t("toast.alreadyRunning") : t("writers.toast.started", { name }))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const stateBadge = w.active ? (
    <StatusBadge color="green">{t("writers.active")}</StatusBadge>
  ) : w.armed ? (
    <StatusBadge color="orange">{t("writers.armed")}</StatusBadge>
  ) : (
    <StatusBadge color="grey">{t("writers.off")}</StatusBadge>
  )
  const blockers = w.blockers.filter((b) => b !== "not_armed")

  return (
    <div className={clx("flex flex-col gap-y-3 rounded-lg border px-4 py-4", w.active ? "border-ui-border-interactive" : "border-ui-border-base", "bg-ui-bg-component")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Text size="base" weight="plus" className="text-ui-fg-base">
              {name}
            </Text>
            {stateBadge}
          </div>
          <Text size="xsmall" className="font-mono text-ui-fg-muted">
            {t("writers.option", { option: WRITER_OPTION[w.writer] })}: {w.allowedByConfig ? t("writers.optionOn") : t("writers.optionOff")}
          </Text>
        </div>
        <Switch
          checked={w.armed}
          disabled={arm.isPending || (!w.armed && !w.allowedByConfig)}
          onCheckedChange={(next) => void onToggle(next)}
          aria-label={w.armed ? t("writers.disarm") : t("writers.arm")}
        />
      </div>
      <Text size="small" className="text-ui-fg-subtle">
        {t(`writers.desc.${w.writer}`, { currency: status.settings.currency, percent: status.settings.maxPriceChangePercent })}
      </Text>
      {blockers.length > 0 ? (
        <div className="flex flex-col gap-y-1">
          {blockers.map((b) => (
            <Text key={b} size="xsmall" className="text-ui-fg-error">
              {t(`writers.blocker.${b}`, { option: WRITER_OPTION[w.writer] })}
            </Text>
          ))}
        </div>
      ) : null}
      <Text size="xsmall" className="text-ui-fg-muted">
        {w.changedAt ? t("writers.changedBy", { who: w.changedBy ?? "?", when: fmtDateTime(w.changedAt, lang) }) : t("writers.neverSwitched")}
        {" "}
        {t("writers.cap", { cap: w.cap })}
      </Text>
      <div className="flex flex-wrap gap-1.5">
        {COUNT_KEYS.filter((k) => w.counts[k] > 0).map((k) => (
          <Badge key={k} size="2xsmall" color={COUNT_COLOR[k]}>
            <span className="tabular-nums">{w.counts[k]}</span>&nbsp;{t(`${counts}.${k}`)}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="small" variant="secondary" isLoading={run.isPending && run.variables?.dryRun === true} onClick={() => void onDryRun()}>
          {t("writers.dryRun")}
        </Button>
        <Button size="small" variant="primary" disabled={!w.active || w.running} isLoading={w.running || (run.isPending && run.variables?.dryRun === false)} onClick={() => void onRun()}>
          <PlaySolid />
          {w.running ? t("writers.running") : t("writers.runNow")}
        </Button>
      </div>
      <div className="flex flex-col gap-y-2 border-t border-ui-border-base pt-3">
        {w.lastRun ? <RunLine run={w.lastRun} lang={lang} dry={false} /> : <Text size="xsmall" className="text-ui-fg-muted">{t("writers.noRun")}</Text>}
        {w.lastDryRun ? (
          <>
            <RunLine run={w.lastDryRun} lang={lang} dry />
            <DryRunItems run={w.lastDryRun} lang={lang} />
          </>
        ) : null}
      </div>
    </div>
  )
}

export function WritersSection({ status, lang }: { status: OlxStatusResponse; lang: string }) {
  const { t } = useTranslation("olx")
  const g = status.plan.guard
  return (
    <Container className="divide-y p-0" id="olx-writers">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("writers.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("writers.subtitle")}
        </Text>
      </div>
      {g.held || status.plan.lifecycleSkipped ? (
        <div className="flex flex-col gap-2 px-6 py-4">
          {g.held ? (
            <InlineTip variant="warning" label={t("writers.name.lifecycle")}>
              {t("writers.guard", { endings: g.endings, live: g.liveLinked, limit: g.limit })}
            </InlineTip>
          ) : null}
          {status.plan.lifecycleSkipped ? (
            <InlineTip variant="warning" label={t("writers.name.lifecycle")}>
              {t(`writers.skipped.${status.plan.lifecycleSkipped}`)}
            </InlineTip>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 px-6 py-4 xl:grid-cols-3">
        {status.writers.map((w) => (
          <WriterCard key={w.writer} writer={w} status={status} lang={lang} />
        ))}
      </div>
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

function money(v: unknown, lang: string): string {
  if (!v || typeof v !== "object") return ""
  const o = v as { value?: unknown; currency?: unknown }
  const value = Number(o.value)
  return Number.isFinite(value) && typeof o.currency === "string" ? fmtPrice({ value, currency: o.currency }, lang) : ""
}

function Change({ item, lang }: { item: OlxPlanItemDto; lang: string }) {
  if (item.action === "price") {
    return (
      <span className="tabular-nums txt-compact-small">
        {money(item.from, lang)} <span className="text-ui-fg-muted">&rarr;</span> <span className="font-medium text-ui-fg-base">{money(item.to, lang)}</span>
      </span>
    )
  }
  return (
    <span className="font-mono txt-compact-xsmall">
      {String(item.from ?? "")} <span className="text-ui-fg-muted">&rarr;</span> {String(item.to ?? "")}
    </span>
  )
}

function NoteText({ item, lang }: { item: OlxPlanItemDto; lang: string }) {
  const { t, i18n } = useTranslation("olx")
  const lines: string[] = []
  if (item.lastError) lines.push(item.lastError)
  if (item.note) {
    if (item.note.startsWith("status:")) lines.push(t("plan.note.status", { status: item.note.slice(7) }))
    else if (i18n.exists(`plan.note.${item.note}`, { ns: "olx" })) lines.push(t(`plan.note.${item.note}`))
    else lines.push(item.note)
  }
  if (item.pausedAt) lines.push(t("plan.paused", { when: fmtDateTime(item.pausedAt, lang) }))
  if (lines.length === 0) return null
  return (
    <span className="flex flex-col gap-y-0.5">
      {lines.map((l, n) => (
        <Text key={n} size="xsmall" className={n === 0 && item.lastError ? "text-ui-fg-error" : "text-ui-fg-muted"}>
          {l}
        </Text>
      ))}
    </span>
  )
}

function PlanTable({ writer, lang }: { writer: "lifecycle" | "price"; lang: string }) {
  const { t } = useTranslation("olx")
  const [view, setView] = useState("open")
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [view, writer])
  const plan = useOlxPlan(writer, view, page * PAGE_SIZE, PAGE_SIZE)
  const release = useOlxRelease()
  const rows = plan.data?.items ?? []
  const count = plan.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const views = writer === "price" ? ["open", "held", "quarantined", "done", "all"] : ["open", "quarantined", "done", "all"]

  const onRelease = async (item: OlxPlanItemDto) => {
    try {
      await release.mutateAsync({ writer, id: item.id })
      toast.success(item.state === "held" ? t("plan.approved") : t("plan.released"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 px-6 py-4">
        {views.map((v) => (
          <Chip key={v} active={view === v} label={t(`plan.view.${v}`)} onClick={() => setView(v)} />
        ))}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("plan.col.advert")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plan.col.action")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plan.col.change")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plan.col.state")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plan.col.note")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <Table.Row>
                <td colSpan={5} className="py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {plan.isLoading ? "" : t("plan.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : (
              rows.map((item) => (
                <Table.Row key={item.id} className="[&_td]:py-2.5">
                  <Table.Cell className="max-w-[300px]">
                    <div className="flex flex-col gap-y-0.5">
                      <span className="txt-compact-small-plus truncate text-ui-fg-base">{item.title ?? item.olxId}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-ui-fg-muted txt-compact-xsmall">#{item.olxId}</span>
                        {item.productId ? (
                          <Link to={`/products/${item.productId}`} className="font-mono text-ui-fg-interactive txt-compact-xsmall hover:text-ui-fg-interactive-hover">
                            {item.sku ?? item.productId}
                          </Link>
                        ) : null}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col gap-y-0.5">
                      <Text size="small" weight="plus">
                        {t(`plan.action.${item.action}`)}
                      </Text>
                      {item.reason ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t(`plan.reason.${item.reason}`)}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    <Change item={item} lang={lang} />
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <PlanStateBadge state={item.state} />
                      {item.attempts > 0 && item.state !== "done" ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("plan.attempts", { count: item.attempts })}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-[320px]">
                    <div className="flex flex-col items-start gap-y-2">
                      <NoteText item={item} lang={lang} />
                      {item.state === "quarantined" || item.state === "held" ? (
                        <Button size="small" variant="secondary" isLoading={release.isPending && release.variables?.id === item.id} onClick={() => void onRelease(item)}>
                          {item.state === "held" ? t("plan.approve") : t("plan.release")}
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
      <Table.Pagination
        count={count}
        pageSize={PAGE_SIZE}
        pageIndex={page}
        pageCount={pageCount}
        canPreviousPage={page > 0}
        canNextPage={page + 1 < pageCount}
        previousPage={() => setPage((p) => Math.max(0, p - 1))}
        nextPage={() => setPage((p) => p + 1)}
        translations={pagination(t)}
      />
    </>
  )
}

/** The documented order of POST /adverts; the database (jsonb) does not keep key order. */
const PAYLOAD_ORDER = [
  "title",
  "description",
  "category_id",
  "advertiser_type",
  "external_id",
  "external_url",
  "contact",
  "location",
  "images",
  "price",
  "attributes",
]

function ordered(payload: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(payload).sort((a, b) => {
    const ia = PAYLOAD_ORDER.indexOf(a)
    const ib = PAYLOAD_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b)
  })
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = payload[k]
  return out
}

function PayloadToggle({ payload }: { payload: Record<string, unknown> }) {
  const { t } = useTranslation("olx")
  const [open, setOpen] = useState(false)
  return (
    <div className="flex w-full flex-col gap-y-1">
      <button type="button" onClick={() => setOpen(!open)} className="txt-compact-xsmall-plus w-fit text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
        {open ? t("publish.hidePayload") : t("publish.showPayload")}
      </button>
      {open ? (
        <pre className="txt-compact-xsmall max-h-64 max-w-[520px] overflow-auto rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2 font-mono text-ui-fg-base">
          {`POST /api/partner/adverts\n${JSON.stringify(ordered(payload), null, 2)}`}
        </pre>
      ) : null}
    </div>
  )
}

function PublicationDetails({ p }: { p: OlxPublicationDto }) {
  const { t } = useTranslation("olx")
  if (p.state === "published") {
    return (
      <div className="flex flex-col gap-y-1">
        {p.olxUrl ? (
          <a href={p.olxUrl} target="_blank" rel="noreferrer" className="txt-compact-small inline-flex w-fit items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("publish.openAdvert")} #{p.olxId}
            <ArrowUpRightOnBox />
          </a>
        ) : null}
        {p.adopted ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("publish.adopted")}
          </Text>
        ) : null}
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-y-2">
      {p.lastError ? (
        <Text size="xsmall" className="text-ui-fg-error">
          {p.lastError}
        </Text>
      ) : null}
      <ProblemList problems={p.missing} />
      <ProblemList problems={p.warnings} tone="warning" />
      {p.payload ? <PayloadToggle payload={p.payload} /> : null}
    </div>
  )
}

function PublicationsTable({ status }: { status: OlxStatusResponse }) {
  const { t } = useTranslation("olx")
  const [view, setView] = useState("plan")
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(0)
  useEffect(() => {
    const id = window.setTimeout(() => setQ(search.trim()), 300)
    return () => window.clearTimeout(id)
  }, [search])
  useEffect(() => setPage(0), [view, q])
  const pubs = useOlxPublications(view, q, page * PAGE_SIZE, PAGE_SIZE)
  const release = useOlxRelease()
  const rows = pubs.data?.publications ?? []
  const count = pubs.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const p = status.plan.publish

  const onRelease = async (id: string) => {
    try {
      await release.mutateAsync({ writer: "publish", id })
      toast.success(t("plan.released"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          {t("publish.summary", { candidates: p.candidates, ready: p.ready, blocked: p.blocked })}
        </Text>
        {p.reason ? (
          <InlineTip variant="info" label={t("writers.name.publish")}>
            {t(`publish.reason.${p.reason}`)}
          </InlineTip>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {["plan", "ready", "blocked", "problems", "published", "all"].map((v) => (
            <Chip key={v} active={view === v} label={t(`publish.view.${v}`)} onClick={() => setView(v)} />
          ))}
        </div>
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("adverts.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("publish.col.product")}</Table.HeaderCell>
              <Table.HeaderCell>{t("publish.col.category")}</Table.HeaderCell>
              <Table.HeaderCell>{t("publish.col.state")}</Table.HeaderCell>
              <Table.HeaderCell>{t("publish.col.details")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <Table.Row>
                <td colSpan={4} className="py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {pubs.isLoading ? "" : t("publish.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : (
              rows.map((row) => (
                <Table.Row key={row.id} className="[&_td]:py-2.5 [&_td]:align-top">
                  <Table.Cell className="max-w-[280px]">
                    <Link to={`/products/${row.productId}`} className="flex flex-col gap-y-0.5 hover:text-ui-fg-interactive">
                      <span className="txt-compact-small-plus truncate text-ui-fg-base">{row.title}</span>
                      <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{row.sku}</span>
                    </Link>
                  </Table.Cell>
                  <Table.Cell className="font-mono txt-compact-small">{row.olxCategoryId ?? ""}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <PublicationStateBadge state={row.state} />
                      {row.attempts > 0 && row.state !== "published" ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("plan.attempts", { count: row.attempts })}
                        </Text>
                      ) : null}
                      {row.state === "quarantined" || row.state === "failed" ? (
                        <Button size="small" variant="secondary" isLoading={release.isPending && release.variables?.id === row.id} onClick={() => void onRelease(row.id)}>
                          {t("plan.release")}
                        </Button>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-[560px]">
                    <PublicationDetails p={row} />
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Table.Pagination
        count={count}
        pageSize={PAGE_SIZE}
        pageIndex={page}
        pageCount={pageCount}
        canPreviousPage={page > 0}
        canNextPage={page + 1 < pageCount}
        previousPage={() => setPage((x) => Math.max(0, x - 1))}
        nextPage={() => setPage((x) => x + 1)}
        translations={pagination(t)}
      />
    </>
  )
}

export function PlansSection({ status, lang }: { status: OlxStatusResponse; lang: string }) {
  const { t } = useTranslation("olx")
  const [tab, setTab] = useState<OlxWriterKey>("lifecycle")
  const total = (w: OlxWriterKey) => {
    const c = status.writers.find((x) => x.writer === w)?.counts
    if (!c) return undefined
    return c.pending + c.held + c.failed + c.quarantined + c.unknown + c.applying
  }
  return (
    <Container className="divide-y p-0" id="olx-plans">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("plan.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("plan.subtitle")}
        </Text>
      </div>
      <div className="flex flex-wrap gap-2 px-6 py-4">
        {(["lifecycle", "price", "publish"] as const).map((w) => (
          <Chip key={w} active={tab === w} label={t(`writers.name.${w}`)} count={total(w)} onClick={() => setTab(w)} />
        ))}
      </div>
      {tab === "publish" ? <PublicationsTable status={status} /> : <PlanTable writer={tab} lang={lang} />}
    </Container>
  )
}
