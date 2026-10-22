import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Adjustments, ArrowPath, BarsArrowDown, BellAlert, Clock, CogSixTooth, DocumentSeries, History, PencilSquare, PlaySolid, ShieldCheck } from "@medusajs/icons"
import { Button, InlineTip, Switch, Table, Text, toast } from "@medusajs/ui"
import type { PlanItemDto, StatusResponse, WriterDto } from "../../modules/negotiations/lib/contract"
import { errorCode, errorMessage, useDraftPlan, useExpireNow, useNegotiationRuns, useRunDraftOrders, useSetWriter } from "./negotiations-api"
import { CodeBlock, KeyPoints } from "./negotiations-guide"
import { EmptyTableRow, Section, ToneBadge } from "./negotiations-blocks"
import { KitSkeletonRows } from "./negotiations-kit"
import { Fact, RunStatusBadge, fmtDateTime, fmtDuration, fmtMoney, fmtNumber, runSummary } from "./negotiations-ui"

/** The demo note, in the popover of the mode badge. */
export function DemoDetails({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("negotiations")
  if (status.mode !== "demo") return null
  return (
    <>
      <span>{t("demo.text")}</span>
      <span>{t("demo.story")}</span>
      {status.demo?.seededAt ? <span>{t("demo.built", { time: fmtDateTime(status.demo.seededAt, lang), count: status.demo.threads })}</span> : null}
      <span>{t("demo.live")}</span>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* General: the options in use and the expiry                          */
/* ------------------------------------------------------------------ */

export function GeneralSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("negotiations")
  const expire = useExpireNow()
  const o = status.options
  const demo = status.mode === "demo"
  const last = status.lastRuns.expire
  const onOff = (v: boolean) => (
    <ToneBadge tone={v ? "green" : "grey"}>{v ? t("general.on") : t("general.off")}</ToneBadge>
  )

  const runExpire = async () => {
    try {
      const r = await expire.mutateAsync()
      toast.success(r.run && r.run.status !== "skipped" ? t("toast.expired", { count: r.run.counts.expired ?? 0 }) : t("toast.expireSkipped"))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  return (
    <>
      <Section
        icon={<CogSixTooth />}
        title={t("general.title")}
        pointsLabel={t("general.subtitle")}
        points={[
          { icon: <PencilSquare />, text: t("general.points.config") },
          { icon: <ShieldCheck />, text: t("general.points.readOnly"), tone: "blue" },
          { icon: <Adjustments />, text: t("general.points.defaults") },
        ]}
      >
        <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label={t("general.mode")}>{demo ? t("mode.demo") : t("mode.live")}</Fact>
          <Fact label={t("general.storeApi")}>{onOff(o.storeApi)}</Fact>
          <Fact label={t("general.customerAccept")}>{onOff(o.customerAccept)}</Fact>
          <Fact label={t("general.prices")}>{o.taxInclusive ? t("general.gross") : t("general.net")}</Fact>
          <Fact label={t("general.currency")} mono>
            {(o.defaultCurrency ?? o.storeCurrency ?? "").toUpperCase() || "-"}
            {!o.defaultCurrency && o.storeCurrency ? <span className="block font-sans text-ui-fg-muted">{t("general.storeDefault")}</span> : null}
          </Fact>
          <Fact label={t("general.maxActive")}>{fmtNumber(o.maxActivePerCustomer, lang)}</Fact>
          <Fact label={t("general.openPerHour")}>{fmtNumber(o.openPerHour, lang)}</Fact>
          <Fact label={t("general.messagesPerHour")}>{fmtNumber(o.messagesPerHour, lang)}</Fact>
          <Fact label={t("general.maxMessage")}>{t("general.characters", { count: o.maxMessageLength })}</Fact>
          <Fact label={t("general.maxQuantity")}>{fmtNumber(o.maxQuantity, lang)}</Fact>
        </div>
        <div className="px-6 py-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("general.optionsHint")}
          </Text>
        </div>
      </Section>

      <Section
        icon={<Clock />}
        title={t("expiry.title")}
        pointsLabel={o.expiryDays > 0 ? t("expiry.rule", { count: o.expiryDays }) : t("expiry.off")}
        points={[
          o.expiryDays > 0 ? { icon: <Clock />, text: t("expiry.points.days", { count: o.expiryDays }) } : { icon: <Clock />, text: t("expiry.points.off") },
          o.expiryDays > 0 && { icon: <ArrowPath />, text: t("expiry.points.restart") },
          o.expiryDays > 0 && { icon: <PencilSquare />, text: t("expiry.points.notes") },
          demo ? { icon: <ShieldCheck />, text: t("expiry.points.demo"), tone: "blue" } : { icon: <History />, text: t("expiry.points.schedule"), title: t("expiry.schedule") },
        ]}
        actions={
          <Button size="small" variant="secondary" isLoading={expire.isPending} disabled={demo} onClick={() => void runExpire()}>
            <Clock />
            {t("actions.expireNow")}
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-3">
          <Fact label={t("expiry.days")}>{o.expiryDays > 0 ? t("expiry.daysValue", { count: o.expiryDays }) : t("general.off")}</Fact>
          <Fact label={t("expiry.soon")}>{fmtNumber(status.counts.expiringSoon, lang)}</Fact>
          <Fact label={t("expiry.last")}>
            {last ? (
              <span className="flex flex-col">
                <span>{fmtDateTime(last.startedAt, lang)}</span>
                <span className="text-ui-fg-muted">{runSummary(last, t)}</span>
              </span>
            ) : (
              t("expiry.never")
            )}
          </Fact>
        </div>
      </Section>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Writers: the draft order writer and its plan                        */
/* ------------------------------------------------------------------ */

function WriterBadge({ writer }: { writer: WriterDto }) {
  const { t } = useTranslation("negotiations")
  if (!writer.allowed) return <ToneBadge tone="grey">{t("writers.blocked")}</ToneBadge>
  return <ToneBadge tone={writer.armed ? "green" : "grey"}>{writer.armed ? t("writers.armed") : t("writers.off")}</ToneBadge>
}

export function WritersSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("negotiations")
  const toggle = useSetWriter()
  const runner = useRunDraftOrders()
  const plan = useDraftPlan(true)
  const [dry, setDry] = useState<PlanItemDto[] | null>(null)
  const writer = status.writers.draftOrders
  const items = plan.data?.items ?? []

  const flip = async (on: boolean) => {
    try {
      await toggle.mutateAsync({ writer: "draftOrders", on })
      toast.success(on ? t("writers.turnedOn") : t("writers.turnedOff"))
    } catch (err) {
      const code = errorCode(err)
      toast.error(code ? t(`errors.${code}`, { defaultValue: errorMessage(err) }) : errorMessage(err))
    }
  }

  const run = async (dryRun: boolean) => {
    try {
      const r = await runner.mutateAsync({ dryRun })
      if (dryRun) {
        setDry(r.items)
        toast.info(t("plan.dryDone", { count: r.items.filter((i) => i.ready).length }))
      } else {
        setDry(null)
        toast.success(r.run ? runSummary(r.run, t) : t("plan.busy"))
        void plan.refetch()
      }
    } catch (err) {
      const code = errorCode(err)
      toast.error(code ? t(`errors.${code}`, { defaultValue: errorMessage(err) }) : errorMessage(err))
    }
  }

  return (
    <Section
      icon={<DocumentSeries />}
      title={t("writers.title")}
      pointsLabel={t("writers.subtitle")}
      points={[
        { icon: <BellAlert />, text: t("writers.points.event") },
        { icon: <ShieldCheck />, text: t("writers.points.off") },
        { icon: <BarsArrowDown />, text: t("writers.points.plan") },
      ]}
    >
      {status.mode === "demo" ? (
        <div className="px-6 py-3">
          <InlineTip variant="info" label={t("mode.demo")}>
            {t("writers.demo")}
          </InlineTip>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex max-w-3xl flex-col gap-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <Text size="small" weight="plus" className="text-ui-fg-base">
              {t("writers.names.draftOrders")}
            </Text>
            <WriterBadge writer={writer} />
          </span>
          <Text size="small" className="text-ui-fg-subtle">
            {t("writers.descriptions.draftOrders")}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {!writer.allowed
              ? t("writers.blockedHint")
              : writer.updatedAt
                ? t(writer.on ? "writers.onBy" : "writers.offBy", { who: writer.updatedBy ?? "-", time: fmtDateTime(writer.updatedAt, lang) })
                : t("writers.never")}
          </Text>
        </div>
        <Switch
          checked={writer.on && writer.allowed}
          disabled={!writer.allowed || toggle.isPending}
          onCheckedChange={(v) => void flip(v === true)}
          aria-label={t("writers.names.draftOrders")}
        />
      </div>
      {!writer.allowed ? (
        <div className="px-6 py-4">
          <CodeBlock code={`writers: { draftOrders: true }, // medusa-config.ts, options of the plugin`} copyLabel={t("guide.copy")} copiedLabel={t("guide.copied")} />
        </div>
      ) : null}

      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {t("plan.title")}
          </Text>
          <KeyPoints
            label={t("plan.subtitle", { cap: status.options.draftOrders.maxPerRun })}
            items={[
              { icon: <DocumentSeries />, text: t("plan.points.cap", { cap: status.options.draftOrders.maxPerRun }) },
              { icon: <Clock />, text: t("plan.points.every") },
              { icon: <ShieldCheck />, text: t("plan.points.dry") },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="small" variant="secondary" isLoading={runner.isPending && runner.variables?.dryRun === true} onClick={() => void run(true)}>
            <ShieldCheck />
            {t("plan.dryRun")}
          </Button>
          <Button size="small" variant="primary" disabled={!writer.armed} isLoading={runner.isPending && runner.variables?.dryRun === false} onClick={() => void run(false)}>
            <PlaySolid />
            {t("plan.run")}
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("plan.col.thread")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plan.col.customer")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plan.col.line")}</Table.HeaderCell>
              <Table.HeaderCell>{t("plan.col.state")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {plan.isLoading ? (
              <KitSkeletonRows cols={4} rows={3} />
            ) : items.length === 0 ? (
              <EmptyTableRow cols={4} icon={<DocumentSeries />} title={t("plan.empty")} />
            ) : (
              items.map((i) => (
                <Table.Row key={i.outboxId} className="align-top [&_td]:py-2.5">
                  <Table.Cell className="whitespace-nowrap font-mono">{i.thread.ref}</Table.Cell>
                  <Table.Cell className="max-w-[14rem] truncate">{i.thread.customer ?? "-"}</Table.Cell>
                  <Table.Cell className="max-w-[18rem]">
                    <span className="flex flex-col">
                      <span className="truncate">{i.thread.title ?? "-"}</span>
                      <span className="text-ui-fg-muted tabular-nums">
                        {fmtNumber(i.thread.qty, lang)} x {fmtMoney(i.thread.price, i.thread.currencyCode, lang)}
                      </span>
                    </span>
                  </Table.Cell>
                  <Table.Cell className="max-w-md">
                    <span className="flex flex-col items-start gap-y-1">
                      <ToneBadge tone={i.ready ? "green" : i.blocked ? "orange" : i.state === "failed" ? "red" : "grey"}>{i.ready ? t("plan.ready") : t(`draft.states.${i.state}`)}</ToneBadge>
                      {i.blocked ? (
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {t(`draft.reasons.${i.blocked}`, { defaultValue: i.blocked })}
                        </Text>
                      ) : null}
                      {i.error && !i.blocked ? (
                        <Text size="xsmall" className="text-ui-tag-red-text">
                          {t(`draft.reasons.${i.error}`, { defaultValue: i.error })}
                        </Text>
                      ) : null}
                    </span>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      {dry ? (
        <div className="flex flex-col gap-y-2 px-6 py-4">
          <InlineTip variant="info" label={t("plan.dryRun")}>
            {t("plan.dryText")}
          </InlineTip>
          {dry.filter((i) => i.input).map((i) => (
            <div key={i.outboxId} className="flex flex-col gap-y-1">
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                {i.thread.ref}
              </Text>
              <CodeBlock code={JSON.stringify(i.input, null, 2)} copyLabel={t("guide.copy")} copiedLabel={t("guide.copied")} />
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function RunsSection({ lang }: { lang: string }) {
  const { t } = useTranslation("negotiations")
  const runs = useNegotiationRuns(true)
  const rows = runs.data?.runs ?? []
  return (
    <Section
      icon={<History />}
      title={t("runs.title")}
      pointsLabel={t("runs.subtitle")}
      points={[
        { icon: <BarsArrowDown />, text: t("runs.points.newest") },
        { icon: <DocumentSeries />, text: t("runs.points.kinds") },
      ]}
    >
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("runs.col.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.kind")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.result")}</Table.HeaderCell>
              <Table.HeaderCell>{t("runs.col.summary")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("runs.col.duration")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {runs.isLoading ? (
              <KitSkeletonRows cols={5} rows={4} />
            ) : rows.length === 0 ? (
              <EmptyTableRow cols={5} icon={<History />} title={t("runs.empty")} />
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id} className="[&_td]:py-2.5">
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.startedAt, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {t(`runs.kinds.${r.kind}`)}
                    <span className="text-ui-fg-muted"> / {t(`runs.triggers.${r.trigger}`)}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <RunStatusBadge status={r.status} />
                  </Table.Cell>
                  <Table.Cell className="max-w-xl">
                    <Text size="small">{runSummary(r, t)}</Text>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{fmtDuration(r.durationMs)}</Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}
