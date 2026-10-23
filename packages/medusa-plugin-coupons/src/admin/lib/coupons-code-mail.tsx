import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowPath, CheckCircle, Envelope, ExclamationCircle, Eye, PaperPlane, User, Users } from "@medusajs/icons"
import { Button, Checkbox, FocusModal, InlineTip, Text, Textarea, clx, toast, usePrompt } from "@medusajs/ui"
import type { CodeMailRecipientDto, CouponDto, NameMaps } from "../../modules/coupons/lib/contract"
import { MESSAGE_MAX } from "../../modules/coupons/lib/code-mail"
import { CouponsRequestError, errorMessage, useCodeMail, usePreviewCodeMail, useSendCodeMail } from "./coupons-api"
import { EmptyState, Section, ToneBadge } from "./coupons-blocks"
import { CustomerPicker } from "./coupons-fields"
import { KeyPoints } from "./coupons-guide"
import { KitLoading } from "./coupons-kit"
import { couponSentence } from "./coupons-sentence"
import { useFormat } from "./coupons-ui"

/**
 * "Send the code": the code by e-mail with a short instruction, through the
 * store's own sender (option sendCode). The people of the coupon's customer
 * rule are ticked, more can be added with the creator's search. Who got it
 * before stays on the list with the date and never gets it twice. The
 * instruction starts as the coupon's sentence (without other customers'
 * names) and can be edited; the preview is the store's own e-mail, sent to
 * nobody.
 */
export function SendCodeModal({ coupon, names, currency, nobody, onOpenChange }: { coupon: CouponDto | null; names: NameMaps; currency: string; nobody: string | null; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const prompt = usePrompt()
  const id = coupon?.id ?? null
  const state = useCodeMail(id)
  const preview = usePreviewCodeMail()
  const send = useSendCodeMail()
  const [picked, setPicked] = useState<string[]>([])
  /* Names of the people added with the search (the picker shows them as chips). */
  const [added, setAdded] = useState<Record<string, string>>({})
  const [message, setMessage] = useState("")
  const [errors, setErrors] = useState<string[]>([])

  /* A fresh form for each coupon: the instruction from its sentence, the people of its rule ticked. */
  useEffect(() => {
    if (!coupon) return
    setMessage(couponSentence(coupon, names, t, fmt, currency, { forCustomer: true }))
    setAdded({})
    setErrors([])
    preview.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coupon?.id])
  useEffect(() => {
    if (state.data) setPicked(state.data.recipients.filter((r) => !r.sentAt && r.inRule).map((r) => r.customerId))
  }, [state.data])

  const data = state.data
  const known = new Set((data?.recipients ?? []).map((r) => r.customerId))
  const rows: CodeMailRecipientDto[] = data?.recipients ?? []
  const sentIds = new Set(rows.filter((r) => r.sentAt).map((r) => r.customerId))
  const toSend = picked.filter((cid) => !sentIds.has(cid))
  const newOnRule = data?.customerRule ? toSend.filter((cid) => !rows.find((r) => r.customerId === cid)?.inRule) : []
  const extraPicked = picked.filter((cid) => !known.has(cid))
  const blockers = data?.blockers ?? []
  const tooLong = message.length > MESSAGE_MAX
  const canSend = Boolean(data && blockers.length === 0 && toSend.length > 0 && message.trim() && !tooLong)
  const audienceNote = useMemo(() => {
    if (!coupon) return null
    if (data?.customerRule) return { icon: <Users />, text: t("codeMail.points.rule"), tone: "blue" as const }
    if (coupon.shape.groupIds.length) return { icon: <ExclamationCircle />, text: t("codeMail.points.groups"), tone: "orange" as const }
    return { icon: <Users />, text: t("codeMail.points.everyone") }
  }, [coupon, data?.customerRule, t])

  const toggle = (cid: string) => setPicked((p) => (p.includes(cid) ? p.filter((x) => x !== cid) : [...p, cid]))

  const runPreview = async () => {
    if (!id) return
    try {
      await preview.mutateAsync({ id, customerIds: toSend.length ? toSend : picked, message })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const doSend = async () => {
    if (!id || !coupon) return
    setErrors([])
    const ok = await prompt({
      title: t("codeMail.confirmTitle", { code: coupon.code }),
      description: t("codeMail.confirmText", { count: toSend.length }) + (newOnRule.length ? ` ${t("codeMail.confirmRule", { count: newOnRule.length })}` : ""),
      confirmText: t("codeMail.send", { count: toSend.length }),
      cancelText: t("codeMail.cancel"),
    })
    if (!ok) return
    try {
      const r = await send.mutateAsync({ id, customerIds: toSend, message })
      if (r.sent.length) toast.success(t("codeMail.sent", { count: r.sent.length, code: coupon.code }))
      if (r.failed.length) toast.warning(t("codeMail.failed", { count: r.failed.length }))
      if (!r.recorded) toast.warning(t("codeMail.notRecorded"))
      setAdded({})
      void state.refetch()
      if (!r.failed.length) onOpenChange(false)
    } catch (err) {
      if (err instanceof CouponsRequestError && err.errors.length) setErrors(err.errors)
      else toast.error(errorMessage(err))
    }
  }

  return (
    <FocusModal open={Boolean(coupon)} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center gap-x-2">
            <Envelope className="text-ui-fg-interactive" />
            <Text size="small" weight="plus">
              {t("codeMail.title")}
            </Text>
            <span className="font-mono txt-compact-small-plus">{coupon?.code}</span>
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-1 overflow-hidden">
          <div className="grid h-full w-full grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:overflow-hidden">
            <div className="flex flex-col gap-y-4 p-4 lg:overflow-y-auto lg:p-6">
              <KeyPoints
                label={t("codeMail.pointsLabel")}
                items={[
                  { icon: <CheckCircle />, text: t("codeMail.points.once"), tone: "green" },
                  audienceNote,
                  { icon: <Eye />, text: t("codeMail.points.preview") },
                ]}
              />
              {!data && state.isLoading ? <KitLoading label={t("codeMail.loading")} /> : null}
              {blockers.length ? (
                <InlineTip variant="warning" label={t("codeMail.title")}>
                  {blockers.map((b) => t(`codeMail.blocker.${b}`, { defaultValue: b })).join(" ")}
                </InlineTip>
              ) : null}
              {data ? (
                <Section icon={<Users />} title={t("codeMail.recipients")} points={[{ icon: <PaperPlane />, text: t("codeMail.toSend", { count: toSend.length }), tone: toSend.length ? "blue" : "grey" }, { icon: <CheckCircle />, text: t("codeMail.already", { count: sentIds.size }) }]}>
                  <div className="flex flex-col divide-y">
                    {rows.length === 0 ? <EmptyState compact icon={<User />} title={t("codeMail.noRecipients")} /> : null}
                    {rows.map((r) => {
                      const was = Boolean(r.sentAt)
                      return (
                        <label key={r.customerId} className={clx("flex items-center justify-between gap-3 px-6 py-2.5", !was && "cursor-pointer hover:bg-ui-bg-base-hover")}>
                          <span className="flex min-w-0 items-center gap-x-3">
                            <Checkbox checked={was || picked.includes(r.customerId)} disabled={was} onCheckedChange={() => toggle(r.customerId)} />
                            <span className="flex min-w-0 flex-col">
                              <Text size="small" weight="plus" className="truncate">
                                {r.name ?? names.customers?.[r.customerId] ?? r.customerId}
                              </Text>
                              <Text size="xsmall" className="truncate text-ui-fg-subtle">
                                {r.email ?? t("codeMail.emailLater")}
                              </Text>
                            </span>
                          </span>
                          {was ? (
                            <ToneBadge tone="green" icon={<CheckCircle />}>
                              {t("codeMail.sentAt", { date: fmt.date(r.sentAt as string) })}
                            </ToneBadge>
                          ) : !r.email && r.inRule ? (
                            <ToneBadge tone="red">{t("codeMail.noEmail")}</ToneBadge>
                          ) : null}
                        </label>
                      )
                    })}
                  </div>
                  <div className="flex flex-col gap-y-2 px-6 py-4">
                    <Text size="small" weight="plus">
                      {t("codeMail.add")}
                    </Text>
                    <CustomerPicker
                      selected={extraPicked}
                      names={added}
                      nobody={nobody}
                      onName={(cid, name) => setAdded((m) => ({ ...m, [cid]: name }))}
                      onChange={(ids) => {
                        /* The picker holds only the people added here; the rule's people keep their own boxes. */
                        setPicked((p) => [...new Set([...p.filter((cid) => known.has(cid)), ...ids.filter((cid) => !sentIds.has(cid))])])
                      }}
                    />
                  </div>
                </Section>
              ) : null}
              {data ? (
                <div className="flex flex-col gap-y-1.5">
                  <Text size="small" weight="plus">
                    {t("codeMail.message")}
                  </Text>
                  <Textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
                  <div className="flex items-center justify-between gap-2">
                    <Text size="xsmall" className={tooLong ? "text-ui-fg-error" : "text-ui-fg-muted"}>
                      {t("codeMail.messageHint", { count: message.length, max: MESSAGE_MAX })}
                    </Text>
                    <Button size="small" variant="transparent" onClick={() => coupon && setMessage(couponSentence(coupon, names, t, fmt, currency, { forCustomer: true }))}>
                      <ArrowPath />
                      {t("codeMail.reset")}
                    </Button>
                  </div>
                </div>
              ) : null}
              {errors.length ? (
                <InlineTip variant="error" label={t("codeMail.title")}>
                  {errors.map((e) => t(`codeMail.error.${e}`, { defaultValue: t(`codeMail.blocker.${e}`, { defaultValue: e }) })).join(" ")}
                </InlineTip>
              ) : null}
            </div>
            {/* The store's own e-mail, rendered for the first person; nothing is sent. */}
            <aside className="flex min-h-[28rem] flex-col gap-y-3 border-t border-ui-border-base bg-ui-bg-subtle p-4 lg:border-l lg:border-t-0 lg:p-6">
              <div className="flex items-center justify-between gap-2">
                <Text size="small" weight="plus">
                  {t("codeMail.previewTitle")}
                </Text>
                {data?.ability.preview ? (
                  <Button size="small" variant="secondary" isLoading={preview.isPending} disabled={!message.trim() || tooLong} onClick={() => void runPreview()}>
                    <Eye />
                    {preview.data ? t("codeMail.previewAgain") : t("codeMail.preview")}
                  </Button>
                ) : null}
              </div>
              {preview.data ? (
                <>
                  <div className="flex flex-col gap-y-0.5">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {t("codeMail.subject")}
                    </Text>
                    <Text size="small" weight="plus">
                      {preview.data.subject}
                    </Text>
                    {preview.data.to ? (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {t("codeMail.previewTo", { email: preview.data.to })}
                      </Text>
                    ) : null}
                  </div>
                  <iframe title={t("codeMail.previewTitle")} sandbox="" srcDoc={preview.data.html} className="min-h-[24rem] w-full flex-1 rounded-lg border border-ui-border-base bg-ui-bg-base" />
                </>
              ) : (
                <EmptyState
                  compact
                  icon={<Eye />}
                  title={data?.ability.preview ? t("codeMail.previewEmpty") : t("codeMail.previewNone")}
                  className="flex-1 rounded-lg border border-dashed border-ui-border-base"
                />
              )}
            </aside>
          </div>
        </FocusModal.Body>
        <FocusModal.Footer>
          <div className="flex w-full items-center justify-between gap-2">
            <Text size="small" className="text-ui-fg-muted">
              {newOnRule.length ? t("codeMail.ruleNote", { count: newOnRule.length }) : t("codeMail.onlyNew")}
            </Text>
            <div className="flex items-center gap-2">
              <FocusModal.Close asChild>
                <Button size="small" variant="secondary">
                  {t("codeMail.cancel")}
                </Button>
              </FocusModal.Close>
              <Button size="small" disabled={!canSend} isLoading={send.isPending} onClick={() => void doSend()}>
                <PaperPlane />
                {sentIds.size ? t("codeMail.sendNew", { count: toSend.length }) : t("codeMail.send", { count: toSend.length })}
              </Button>
            </div>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}
