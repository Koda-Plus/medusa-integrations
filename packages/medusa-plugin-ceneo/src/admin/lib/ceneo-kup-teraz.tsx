import { useTranslation } from "react-i18next"
import { ArrowPath, ArrowUpRightOnBox, BoltSolid, ExclamationCircle, LockClosedSolid, ShieldCheck } from "@medusajs/icons"
import { Button, InlineTip, Switch, Text, toast } from "@medusajs/ui"
import type { CeneoOrderDto, StatusResponse, WriterDto } from "../../modules/ceneo/lib/contract"
import type { ImportState } from "../../modules/ceneo/lib/order-input"
import { errorMessage, useRetryImport, useRunImport, useSetWriter } from "./ceneo-api"
import { Section, ToneBadge, type Tone } from "./ceneo-blocks"

const IMPORT_TONE: Record<ImportState, Tone> = {
  imported: "green",
  importing: "blue",
  queued: "blue",
  held: "orange",
  failed: "red",
  waiting_state: "grey",
  waiting_match: "orange",
  off: "grey",
}

export function ImportBadge({ o }: { o: CeneoOrderDto }) {
  const { t } = useTranslation("ceneo")
  return <ToneBadge tone={IMPORT_TONE[o.importState]}>{t(`kupTeraz.import.${o.importState}`)}</ToneBadge>
}

function when(v: string | null, lang: string): string {
  return v ? new Date(v).toLocaleString(lang, { dateStyle: "short", timeStyle: "short" }) : ""
}

function Step({ done, label, at, lang }: { done: boolean; label: string; at: string | null; lang: string }) {
  return (
    <li className="flex items-center justify-between gap-x-3">
      <span className="flex items-center gap-x-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${done ? "bg-ui-tag-green-icon" : "bg-ui-tag-neutral-icon"}`} />
        <Text size="xsmall" className={done ? "text-ui-fg-base" : "text-ui-fg-muted"}>
          {label}
        </Text>
      </span>
      <Text size="xsmall" className="tabular-nums text-ui-fg-muted">
        {when(at, lang)}
      </Text>
    </li>
  )
}

/** The import of one order and what Ceneo was told: the drawer and the order widget. */
export function ImportPanel({ o, lang, showOrderLink = true }: { o: CeneoOrderDto; lang: string; showOrderLink?: boolean }) {
  const { t } = useTranslation("ceneo")
  const retry = useRetryImport()
  const w = o.writes
  const onRetry = () =>
    retry.mutate(o.id, {
      onSuccess: () => toast.success(t("kupTeraz.retried")),
      onError: (e) => toast.error(t("toast.error", { error: errorMessage(e) })),
    })
  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-x-2">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
            {t("kupTeraz.importLabel")}
          </Text>
          <ImportBadge o={o} />
        </div>
        {showOrderLink && o.medusaOrderId ? (
          <a href={`/app/orders/${o.medusaOrderId}`} className="flex items-center gap-x-1 text-ui-fg-interactive txt-compact-xsmall-plus hover:text-ui-fg-interactive-hover">
            {t("kupTeraz.openOrder")}
            <ArrowUpRightOnBox />
          </a>
        ) : null}
      </div>
      {o.importError ? (
        <Text size="xsmall" className="text-ui-fg-error">
          {o.importError}
        </Text>
      ) : null}
      {o.importState === "held" || o.importState === "failed" ? (
        <div>
          <Button size="small" variant="secondary" onClick={onRetry} isLoading={retry.isPending}>
            <ArrowPath />
            {t("kupTeraz.retry")}
          </Button>
        </div>
      ) : null}
      {o.importState === "imported" ? (
        <ul className="flex flex-col gap-y-1 rounded-md border px-3 py-2">
          <Step done={Boolean(o.importedAt)} label={t("kupTeraz.steps.imported")} at={o.importedAt} lang={lang} />
          <Step done={Boolean(w.shopOrderIdAt)} label={t("kupTeraz.steps.shopOrderId")} at={w.shopOrderIdAt} lang={lang} />
          <Step done={Boolean(w.confirmedAt)} label={t("kupTeraz.steps.confirmed")} at={w.confirmedAt} lang={lang} />
          {w.tracking ? <Step done={Boolean(w.shipmentAt)} label={t("kupTeraz.steps.tracking", { tracking: w.tracking })} at={w.shipmentAt} lang={lang} /> : null}
          <Step done={Boolean(w.sentAt)} label={t("kupTeraz.steps.sent")} at={w.sentAt} lang={lang} />
          {w.cancelQueued || w.cancelAt ? <Step done={Boolean(w.cancelAt)} label={t("kupTeraz.steps.cancel")} at={w.cancelAt} lang={lang} /> : null}
          {w.canceledByCeneoAt ? <Step done label={t("kupTeraz.steps.canceledByCeneo")} at={w.canceledByCeneoAt} lang={lang} /> : null}
        </ul>
      ) : null}
      {w.attention ? (
        <InlineTip variant="warning" label={t("kupTeraz.attention")}>
          {w.attention}
        </InlineTip>
      ) : w.error ? (
        <Text size="xsmall" className="text-ui-fg-subtle">
          {t("kupTeraz.lastError", { error: w.error })}
        </Text>
      ) : null}
    </div>
  )
}

function WriterRow({ w, lang }: { w: WriterDto; lang: string }) {
  const { t } = useTranslation("ceneo")
  const set = useSetWriter()
  const onToggle = (armed: boolean) =>
    set.mutate(
      { key: w.key, armed },
      {
        onSuccess: () => toast.success(t(armed ? "kupTeraz.writers.armed" : "kupTeraz.writers.disarmed", { name: t(`kupTeraz.writers.${w.key}.name`) })),
        onError: (e) => toast.error(errorMessage(e)),
      },
    )
  const tone: Tone = w.effective ? "green" : w.requested ? "orange" : "grey"
  return (
    <div className="flex flex-col gap-y-1.5 px-6 py-4">
      <div className="flex items-start justify-between gap-x-4">
        <div className="flex min-w-0 flex-col gap-y-0.5">
          <div className="flex items-center gap-x-2">
            <Text size="small" weight="plus">
              {t(`kupTeraz.writers.${w.key}.name`)}
            </Text>
            <ToneBadge tone={tone}>{t(w.effective ? "kupTeraz.writers.on" : w.requested ? "kupTeraz.writers.blocked" : "kupTeraz.writers.off")}</ToneBadge>
          </div>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {t(`kupTeraz.writers.${w.key}.what`)}
          </Text>
        </div>
        <Switch checked={w.requested} disabled={set.isPending || (!w.requested && w.blockers.length > 0)} onCheckedChange={onToggle} aria-label={t(`kupTeraz.writers.${w.key}.name`)} />
      </div>
      {w.blockers.map((b) => (
        <Text key={b} size="xsmall" className="flex items-center gap-x-1.5 text-ui-fg-muted">
          <LockClosedSolid className="shrink-0" />
          {t(`kupTeraz.blockers.${b}`, { key: w.key })}
        </Text>
      ))}
      {w.modeChanged ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("kupTeraz.writers.modeChanged")}
        </Text>
      ) : null}
      {w.changedAt ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("kupTeraz.writers.changed", { who: w.changedBy ?? "admin", at: when(w.changedAt, lang) })}
        </Text>
      ) : null}
      {w.tripReason && !w.requested ? (
        <InlineTip variant="error" label={t("kupTeraz.writers.tripped")}>
          {w.tripReason}
        </InlineTip>
      ) : null}
    </div>
  )
}

/** The two writers of Kup Teraz with both switches, and the button that runs them now. */
export function WritersSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("ceneo")
  const run = useRunImport()
  const k = status.kupTeraz
  const onRun = () =>
    run.mutate(undefined, {
      onSuccess: (r) => {
        const i = r.import.status === "ran" ? t("kupTeraz.ranImport", { imported: r.import.imported, failed: r.import.failed, held: r.import.held, canceled: r.import.canceled }) : t(`kupTeraz.run.${r.import.status}`)
        const w = r.writes.status === "ran" ? t("kupTeraz.ranWrites", { sent: r.writes.sent, failed: r.writes.failed }) : t(`kupTeraz.run.${r.writes.status}`)
        toast.info(`${i}. ${w}.`)
      },
      onError: (e) => toast.error(t("toast.error", { error: errorMessage(e) })),
    })
  const anyOn = status.writers.some((w) => w.effective)
  return (
    <Section
      id="ceneo-writers"
      icon={<ShieldCheck />}
      title={t("kupTeraz.title")}
      badges={status.demo ? <ToneBadge tone="purple">{t("orders.demo")}</ToneBadge> : null}
      points={[
        { icon: <LockClosedSolid />, text: t("kupTeraz.points.switches") },
        { icon: <BoltSolid />, text: t("kupTeraz.points.breaker") },
        { icon: <ExclamationCircle />, text: t("kupTeraz.points.states", { states: k.importStates.length > 0 ? k.importStates.join(", ") : "-" }) },
      ]}
      actions={
        <Button size="small" variant="secondary" onClick={onRun} isLoading={run.isPending} disabled={!anyOn}>
          <ArrowPath />
          {t("kupTeraz.runNow")}
        </Button>
      }
    >
      {status.writers.map((w) => (
        <WriterRow key={w.key} w={w} lang={lang} />
      ))}
      {!k.carrierId ? (
        <div className="px-6 py-3">
          <InlineTip variant="info" label={t("kupTeraz.carrierLabel")}>
            {t("kupTeraz.noCarrier")}
          </InlineTip>
        </div>
      ) : null}
    </Section>
  )
}
