import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { errorMessage, useSubiektIssueDocument, useSubiektOrder, useSubiektRetry, useSubiektSendOrder } from "../lib/subiekt-api"
import { DocumentStatusBadge, TaskStatusBadge, fmtDateTime } from "../lib/subiekt-ui"
import { SubiektIcon } from "../lib/subiekt-icon"

/**
 * Order page, side column: the Subiekt documents of this order (ZK, WZ, FS,
 * PA with its KSeF number), the state of its calls to the bridge with the
 * buyer Subiekt got, and "send now", "send again", "issue the invoice".
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
  const documentBusy = documentTask ? ["pending", "running", "unknown"].includes(documentTask.status) : false
  const canceled = data.status === "canceled"
  const offerIssue = Boolean(sales && sales.option !== "none" && sales.supported && hasZk && !hasSales && !documentBusy && !canceled)

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

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <SubiektIcon width={18} height={18} className="shrink-0" />
          <Heading level="h2">{t("widget.title")}</Heading>
          {q.data?.mode === "demo" ? (
            <Badge size="2xsmall" color="purple">
              {t("widget.demo")}
            </Badge>
          ) : null}
        </div>
        <a href="/app/subiekt" className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {t("widget.more")}
        </a>
      </div>

      {q.isLoading ? null : (
        <>
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
          ) : (
            <div className="px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle">
                {create?.status === "waiting" ? t("widget.waiting") : t("widget.none")}
              </Text>
            </div>
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
                    <TaskStatusBadge status={task.status} />
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
                  {task.status === "failed" ? (
                    <div>
                      <Button size="small" variant="secondary" isLoading={retry.isPending && retry.variables === task.id} onClick={() => onRetry(task.id)}>
                        {t("actions.retry")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {!hasZk && !busy && !canceled && create?.status !== "failed" ? (
            <div className="px-6 py-4">
              <Button size="small" variant="secondary" isLoading={send.isPending} onClick={onSend}>
                {t("widget.send")}
              </Button>
            </div>
          ) : null}

          {offerIssue && sales ? (
            <div className="flex flex-col gap-y-2 px-6 py-4">
              <Text size="xsmall" className="text-ui-fg-muted">
                {sales.writerActive
                  ? t("widget.autoOn", { after: sales.after.toUpperCase() })
                  : t("widget.autoOff")}
              </Text>
              <div className="flex flex-wrap gap-2">
                {sales.option === "fs" || sales.option === "auto" ? (
                  <Button size="small" variant="secondary" isLoading={issue.isPending && issue.variables === "fs"} onClick={() => onIssue("fs")}>
                    {t("widget.issueFs")}
                  </Button>
                ) : null}
                {sales.option === "pa" || sales.option === "auto" ? (
                  <Button size="small" variant="secondary" isLoading={issue.isPending && issue.variables === "pa"} onClick={() => onIssue("pa")}>
                    {t("widget.issuePa")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default SubiektOrderWidget
