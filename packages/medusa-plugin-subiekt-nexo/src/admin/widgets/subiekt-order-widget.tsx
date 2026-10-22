import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowPath, ArrowUpRightOnBox, DocumentText, PaperPlane, QueueList, Receipt, ServerStack } from "@medusajs/icons"
import { Button, Heading, Text, toast } from "@medusajs/ui"
import type { TaskDto } from "../../modules/subiekt/lib/contract"
import { errorMessage, useSubiektIssueDocument, useSubiektOrder, useSubiektRetry, useSubiektSendOrder } from "../lib/subiekt-api"
import { EmptyState, StagedLoader, ToneBadge, runFromSteps, type StageState, type Tone } from "../lib/subiekt-blocks"
import { SubiektIcon } from "../lib/subiekt-icon"
import { KitLoading, WidgetFrame } from "../lib/subiekt-kit"
import { DocumentStatusBadge, TaskStatusBadge, fmtDateTime } from "../lib/subiekt-ui"

const BUSY = new Set(["pending", "running", "unknown"])

/**
 * The way of one call to the bridge as stages, computed from the task the
 * order already reports (no request of its own): the Medusa queue, the
 * bridge issuing the document, the number back in Medusa.
 */
function taskRun(task: TaskDto, hasDocument: boolean) {
  const s = task.status
  const queue: StageState = s === "pending" && task.attempts === 0 ? { status: "running" } : { status: "done" }
  const bridge: StageState =
    s === "pending" && task.attempts === 0
      ? { status: "queued" }
      : s === "failed"
        ? { status: "error", note: task.lastError ?? undefined }
        : s === "succeeded"
          ? { status: "done" }
          : { status: "running", note: task.lastError ?? undefined }
  const document: StageState = s === "succeeded" ? (hasDocument ? { status: "done" } : { status: "running" }) : { status: "queued" }
  return runFromSteps({ queue, bridge, document }, task.updatedAt ?? task.createdAt ?? Date.now())
}

/**
 * Order page, side column: the Subiekt documents of this order (ZK, WZ, FS,
 * PA with its KSeF number), the state of its calls to the bridge with the
 * buyer Subiekt got, and "send now", "send again", "issue the invoice".
 * While a call is on its way the stages show how far it got.
 * Links are plain anchors: router links break inside some admin builds.
 */
const SubiektOrderWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const { t, i18n } = useTranslation("subiekt")
  const lang = i18n.language || "en"
  const q = useSubiektOrder(data.id)
  const send = useSubiektSendOrder(data.id)
  const issue = useSubiektIssueDocument(data.id)
  const retry = useSubiektRetry()
  const documents = q.data?.documents ?? []
  const tasks = q.data?.tasks ?? []
  const sales = q.data?.salesDocument
  const create = tasks.find((task) => task.kind === "order.create")
  const documentTask = tasks.find((task) => task.kind === "order.document")
  const hasZk = documents.some((d) => d.kind === "ZK" && d.status !== "canceled")
  const hasSales = documents.some((d) => (d.kind === "FS" || d.kind === "PA") && d.status !== "canceled")
  const busy = create?.status === "pending" || create?.status === "running"
  const documentBusy = documentTask ? BUSY.has(documentTask.status) : false
  const canceled = data.status === "canceled"
  const offerIssue = Boolean(sales && sales.option !== "none" && sales.supported && hasZk && !hasSales && !documentBusy && !canceled)
  const inFlight = tasks.find((task) => (task.kind === "order.create" || task.kind === "order.document") && BUSY.has(task.status))
  const failed = tasks.some((task) => task.status === "failed")

  const state: { tone: Tone; key: string } = failed
    ? { tone: "red", key: "attention" }
    : inFlight
      ? { tone: "blue", key: "sending" }
      : hasZk
        ? { tone: "green", key: "inSubiekt" }
        : create?.status === "waiting"
          ? { tone: "grey", key: "waiting" }
          : { tone: "grey", key: "notSent" }

  const onSend = async () => {
    try {
      await send.mutateAsync()
      toast.success(t("widget.sent"))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const onIssue = async (kind: "fs" | "pa") => {
    try {
      await issue.mutateAsync(kind)
      toast.success(t("widget.issued"))
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const onRetry = async (id: string) => {
    try {
      await retry.mutateAsync(id)
      toast.success(t("toast.retried"))
      void q.refetch()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const header = (
    <div className="flex items-center justify-between gap-x-2 px-6 py-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SubiektIcon width={18} height={18} className="shrink-0" />
        <Heading level="h2">{t("widget.title")}</Heading>
        {q.data ? <ToneBadge tone={state.tone}>{t(`widget.state.${state.key}`)}</ToneBadge> : null}
        {q.data?.mode === "demo" ? <ToneBadge tone="blue">{t("widget.demo")}</ToneBadge> : null}
      </div>
      <a
        href={`/app/subiekt?q=${encodeURIComponent(String(data.display_id ?? data.id))}`}
        className="txt-compact-small inline-flex shrink-0 items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
      >
        {t("widget.more")}
        <ArrowUpRightOnBox />
      </a>
    </div>
  )

  const sendingDocument = inFlight?.kind === "order.document"
  const inFlightHasDocument = sendingDocument ? hasSales : hasZk

  return (
    <WidgetFrame header={header}>
      {q.isLoading ? (
        <KitLoading className="min-h-0 py-6" />
      ) : (
        <>
          {inFlight ? (
            <StagedLoader
              run={taskRun(inFlight, inFlightHasDocument)}
              columns={3}
              doneTitle={t("widget.run.done")}
              stages={[
                { key: "queue", name: t("widget.run.queue"), short: t("widget.run.queueShort"), icon: <QueueList />, weight: 20 },
                { key: "bridge", name: t("widget.run.bridge"), short: t("widget.run.bridgeShort"), icon: <ServerStack />, weight: 60 },
                {
                  key: "document",
                  name: t("widget.run.document"),
                  short: t("widget.run.documentShort"),
                  icon: sendingDocument ? <Receipt /> : <DocumentText />,
                  weight: 20,
                },
              ]}
            />
          ) : null}

          {documents.length > 0 ? (
            <div className="flex flex-col gap-y-2 px-6 py-4">
              {documents.map((d) => (
                <div key={d.id} className="flex items-start justify-between gap-x-2">
                  <div className="flex min-w-0 flex-col">
                    <Text size="small" weight="plus" className="font-mono">
                      {d.number}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {fmtDateTime(d.issuedAt, lang)}, {t(`documents.sources.${d.source}`, { defaultValue: d.source })}
                    </Text>
                    {d.kind === "FS" && d.status !== "canceled" ? (
                      <Text size="xsmall" className={d.ksefNumber ? "break-all font-mono text-ui-fg-subtle" : "text-ui-fg-muted"}>
                        {d.ksefNumber ? t("widget.ksef", { number: d.ksefNumber }) : t("widget.ksefWaiting")}
                      </Text>
                    ) : null}
                  </div>
                  <DocumentStatusBadge status={d.status} />
                </div>
              ))}
            </div>
          ) : inFlight ? null : (
            <EmptyState compact icon={<DocumentText />} title={create?.status === "waiting" ? t("widget.waiting") : t("widget.none")} />
          )}

          {tasks.length > 0 ? (
            <div className="flex flex-col gap-y-3 px-6 py-4">
              {tasks.map((task) => (
                <div key={task.id} className="flex flex-col gap-y-1">
                  <div className="flex items-center justify-between gap-x-2">
                    <Text size="small">
                      {task.kind === "order.document" && (task.documentKind === "fs" || task.documentKind === "pa")
                        ? t(`tasks.documentKinds.${task.documentKind}`)
                        : t(`tasks.kinds.${task.kind}`)}
                    </Text>
                    <span className="flex items-center gap-x-1">
                      <TaskStatusBadge status={task.status} />
                      {task.status === "failed" ? (
                        <Button size="small" variant="secondary" isLoading={retry.isPending && retry.variables === task.id} onClick={() => onRetry(task.id)}>
                          <ArrowPath />
                          {t("actions.retry")}
                        </Button>
                      ) : null}
                    </span>
                  </div>
                  {task.buyer ? (
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {task.buyer.source === "retail"
                        ? t("tasks.buyer.retail")
                        : t(`tasks.buyer.${task.buyer.source}`, { name: task.buyer.name ?? task.buyer.symbol ?? "?", nip: task.buyer.nip ?? "?" })}
                    </Text>
                  ) : null}
                  {task.warnings.map((w) => (
                    <Text key={w} size="xsmall" className="text-ui-tag-orange-text">
                      {w}
                    </Text>
                  ))}
                  {task.lastError && task.status !== "succeeded" ? (
                    <Text size="xsmall" className={task.status === "failed" ? "text-ui-tag-red-text" : "text-ui-fg-muted"}>
                      {task.lastError}
                    </Text>
                  ) : null}
                  {task.status === "unknown" ? (
                    <Text size="xsmall" className="text-ui-tag-orange-text">
                      {t("tasks.unknownHint")}
                    </Text>
                  ) : null}
                  {task.manualAction ? (
                    <Text size="xsmall" className="text-ui-tag-orange-text">
                      {t("tasks.manual")}
                    </Text>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {(!hasZk && !busy && !canceled && create?.status !== "failed") || (offerIssue && sales) ? (
            <div className="flex flex-col gap-y-2 px-6 py-4">
              {offerIssue && sales ? (
                <Text size="xsmall" className="text-ui-fg-muted">
                  {sales.writerActive ? t("widget.autoOn", { after: sales.after.toUpperCase() }) : t("widget.autoOff")}
                </Text>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {!hasZk && !busy && !canceled && create?.status !== "failed" ? (
                  <Button size="small" variant="secondary" isLoading={send.isPending} onClick={onSend}>
                    <PaperPlane />
                    {t("widget.send")}
                  </Button>
                ) : null}
                {offerIssue && sales && (sales.option === "fs" || sales.option === "auto") ? (
                  <Button size="small" variant="secondary" isLoading={issue.isPending && issue.variables === "fs"} onClick={() => onIssue("fs")}>
                    <DocumentText />
                    {t("widget.issueFs")}
                  </Button>
                ) : null}
                {offerIssue && sales && (sales.option === "pa" || sales.option === "auto") ? (
                  <Button size="small" variant="secondary" isLoading={issue.isPending && issue.variables === "pa"} onClick={() => onIssue("pa")}>
                    <Receipt />
                    {t("widget.issuePa")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </WidgetFrame>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default SubiektOrderWidget
