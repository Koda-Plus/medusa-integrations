import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowPath, Eye, EyeSlash, PlaySolid, XMark } from "@medusajs/icons"
import { Button, Checkbox, InlineTip, Label, Text, toast } from "@medusajs/ui"
import { Section, ToneBadge, type Tone } from "./avatars-blocks"
import { errorMessage, problemsOf, useCancelRender, usePublish, useQuoteRender, useStartRender, useUnpublish } from "./avatars-api"
import type { RenderState } from "../../modules/avatars/lib/constants"
import type { PresentationDetailDto, QuoteDto } from "../../modules/avatars/lib/contract"

/**
 * The render of an approved presentation, in three moves: count (the speech
 * of each clip is made and measured, nothing is ordered), confirm the exact
 * minutes, follow the clips. A ready presentation is published from here.
 */

const JOB_TONE: Record<RenderState, Tone> = { quoted: "grey", queued: "orange", ordering: "orange", rendering: "blue", ready: "green", failed: "red" }

const seconds = (ms: number | null) => (ms ? `${(ms / 1000).toFixed(1)} s` : "")

export function RenderCard({ p, dirty }: { p: PresentationDetailDto; dirty: boolean }) {
  const { t } = useTranslation("avatars")
  const quote = useQuoteRender()
  const start = useStartRender()
  const publish = usePublish()
  const unpublish = useUnpublish()
  const cancel = useCancelRender()
  const [shorts, setShorts] = useState(p.render.shorts)
  const [q, setQ] = useState<QuoteDto | null>(null)
  const [ack, setAck] = useState(false)

  const problemText = (e: unknown) => {
    const codes = problemsOf(e)
    return codes.length ? codes.map((c) => t(`problems.${c}`, { defaultValue: c })).join(", ") : errorMessage(e)
  }
  const canQuote = p.approved && !dirty && ["approved", "ready", "failed"].includes(p.state)
  const onQuote = () =>
    quote.mutate(
      { presentationId: p.id, shorts },
      {
        onSuccess: (r) => {
          setAck(false)
          setQ(r.quote)
        },
        onError: (e) => toast.error(problemText(e)),
      },
    )
  const onStart = () => {
    if (!q) return
    if (!window.confirm(t("render.confirm", { clips: q.clips.filter((c) => !c.reused).length, minutes: q.minutes.toFixed(1) }))) return
    start.mutate(
      { presentationId: p.id, quoteHash: q.quote_hash, minutes: q.minutes, acknowledgeRisky: ack },
      {
        onSuccess: () => {
          setQ(null)
          toast.success(t("render.started"))
        },
        onError: (e) => {
          setQ(null)
          toast.error(problemText(e))
        },
      },
    )
  }
  const visible = p.approved || p.jobs.length > 0 || ["rendering", "ready", "published"].includes(p.state)
  if (!visible) return null
  const items = p.render.items.length ? p.render.items : p.jobs.map((j) => j.item_id)
  const jobs = p.jobs.filter((j) => items.includes(j.item_id))
  const done = jobs.filter((j) => j.state === "ready").length
  /* Publishing needs every clip of the last render ready with its file; the server checks the same. */
  const complete = p.render.items.length > 0 && p.render.items.every((i) => p.jobs.some((j) => j.item_id === i && j.state === "ready" && Boolean(j.video_url)))
  const onCancel = () => {
    if (!window.confirm(t("render.cancelConfirm"))) return
    cancel.mutate(p.id, { onSuccess: () => toast.success(t("render.cancelled")), onError: (e) => toast.error(problemText(e)) })
  }

  return (
    <Section
      icon={<PlaySolid />}
      title={t("render.title")}
      badges={jobs.length ? <Text size="xsmall" className="text-ui-fg-muted">{t("render.progress", { done, total: items.length })}</Text> : null}
      actions={
        <div className="flex items-center gap-x-2">
          {p.state === "rendering" ? (
            <Button size="small" variant="secondary" isLoading={cancel.isPending} onClick={onCancel}>
              <XMark />
              {t("render.cancel")}
            </Button>
          ) : null}
          {p.state === "ready" && complete ? (
            <Button size="small" variant="primary" isLoading={publish.isPending} onClick={() => publish.mutate(p.id, { onSuccess: () => toast.success(t("render.published")), onError: (e) => toast.error(problemText(e)) })}>
              <Eye />
              {t("render.publish")}
            </Button>
          ) : null}
          {p.state === "published" ? (
            <Button size="small" variant="secondary" isLoading={unpublish.isPending} onClick={() => unpublish.mutate(p.id, { onSuccess: () => toast.success(t("render.unpublished")), onError: (e) => toast.error(problemText(e)) })}>
              <EyeSlash />
              {t("render.unpublish")}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-y-3 px-6 py-4">
        {canQuote ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-x-2">
              <Checkbox id="render-shorts" checked={shorts} onCheckedChange={(v) => setShorts(v === true)} />
              <Label htmlFor="render-shorts" size="small">
                {t("render.withShorts")}
              </Label>
            </div>
            <Button size="small" variant="secondary" isLoading={quote.isPending} onClick={onQuote}>
              <ArrowPath />
              {t("render.quote")}
            </Button>
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("render.quoteHint")}
            </Text>
          </div>
        ) : p.state === "review" && !p.approved ? (
          <Text size="small" className="text-ui-fg-muted">
            {t("render.approveFirst")}
          </Text>
        ) : null}

        {p.state === "ready" && !complete ? (
          <Text size="small" className="text-ui-fg-muted">
            {t("render.incomplete")}
          </Text>
        ) : null}

        {q ? (
          <InlineTip variant={q.over_limit ? "error" : q.risky.length ? "warning" : "info"} label={t("render.quoteLabel")}>
            <div className="flex flex-col gap-y-2">
              <span>{t("render.quoteText", { clips: q.clips.filter((c) => !c.reused).length, reused: q.clips.filter((c) => c.reused).length, minutes: q.minutes.toFixed(1), limit: q.limit })}</span>
              {q.over_limit ? <span>{t("render.overLimit", { limit: q.limit })}</span> : null}
              {q.risky.length ? (
                <div className="flex flex-col gap-y-1">
                  <span className="font-medium">{t("render.riskyTitle")}</span>
                  <span>{t("render.riskyText", { items: q.risky.map((r) => (r.previous_video_id ? `${r.item_id} (${r.previous_video_id})` : r.item_id)).join(", ") })}</span>
                  <div className="flex items-center gap-x-2">
                    <Checkbox id="render-risky" checked={ack} onCheckedChange={(v) => setAck(v === true)} />
                    <Label htmlFor="render-risky" size="small">
                      {t("render.riskyAck")}
                    </Label>
                  </div>
                </div>
              ) : null}
              <div>
                <Button size="small" variant="primary" disabled={q.over_limit || (q.risky.length > 0 && !ack)} isLoading={start.isPending} onClick={onStart}>
                  {q.minutes > 0 ? t("render.start", { minutes: q.minutes.toFixed(1) }) : t("render.startFree")}
                </Button>
              </div>
            </div>
          </InlineTip>
        ) : null}

        {jobs.length ? (
          <div className="flex flex-col divide-y rounded-lg border">
            {jobs.map((j) => (
              <div key={j.id} className="flex flex-col gap-y-2 px-4 py-3">
                <div className="flex items-center justify-between gap-x-3">
                  <div className="flex items-center gap-x-3">
                    <Text size="small" weight="plus">
                      {j.item_id}
                    </Text>
                    <ToneBadge tone={JOB_TONE[j.state]} dot>
                      {t(`job.${j.state}`)}
                      {j.state === "rendering" ? ` ${j.progress}%` : ""}
                    </ToneBadge>
                  </div>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {seconds(j.duration_ms)}
                  </Text>
                </div>
                {j.error ? (
                  <Text size="xsmall" className="text-ui-fg-error">
                    {j.error}
                  </Text>
                ) : null}
                {j.video_url ? <video src={j.video_url} controls preload="metadata" className="max-h-[260px] w-full max-w-[460px] rounded-md bg-ui-bg-subtle" /> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Section>
  )
}
