import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowPath, CheckCircle, Envelope, ExclamationCircle, Eye, Link, PaperPlane, Plus, Tag, User, Users, XMark } from "@medusajs/icons"
import { Button, Checkbox, FocusModal, IconButton, InlineTip, Select, Switch, Text, Textarea, clx, toast, usePrompt } from "@medusajs/ui"
import type { CodeMailRecipientDto, CodeMailResponse, CouponDto, NameMaps } from "../../modules/coupons/lib/contract"
import { COUPONS_PER_SEND_MAX, MESSAGE_MAX, sendBlockers } from "../../modules/coupons/lib/code-mail"
import { CouponsRequestError, errorMessage, useCodeMail, useCodeMails, useCoupons, usePreviewCodeMail, useSendCodeMail } from "./coupons-api"
import { EmptyState, Section, ToneBadge } from "./coupons-blocks"
import { CustomerPicker } from "./coupons-fields"
import { KeyPoints } from "./coupons-guide"
import { KitLoading } from "./coupons-kit"
import { couponSentence } from "./coupons-sentence"
import { useFormat } from "./coupons-ui"

/** Coupons another code can join in one e-mail: with a code to type, working or about to start, not this one. */
export function sendableCoupons(all: readonly CouponDto[], mainId: string | null, picked: readonly string[]): CouponDto[] {
  return all.filter((c) => c.id !== mainId && !picked.includes(c.id) && sendBlockers(c, true).length === 0)
}

/**
 * "Send the code": the code by e-mail with a short instruction, through the
 * store's own sender (option sendCode). The people of the coupon's customer
 * rule are ticked, more can be added with the creator's search. Who got it
 * before stays on the list with the date and never gets it twice. The
 * instruction starts as the coupon's sentence (without other customers'
 * names) and can be edited; the preview is the store's own e-mail, sent to
 * nobody.
 *
 * More codes can join the same e-mail ("Add a coupon to this send"): each
 * keeps its own sentence ("What it gives"), the instruction becomes the one
 * shared by all, and each code is recorded on its own coupon. A person who
 * had one of the codes gets only the others. When the store builds a link
 * (option codeLink) each code gets a button that opens the shop with it.
 */
/*
 * What this browser remembers between sends: the last instruction per coupon,
 * the last shared one (several codes) and the sender's note. Prefilled next
 * time, "From the rules again" still starts over. Never anything about people.
 */
const MEMORY_KEY = "koda.coupons.codeMail/1"
type MailMemory = { perCoupon?: Record<string, string>; shared?: string; senderNote?: string }
function readMemory(): MailMemory {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(MEMORY_KEY)
    const v = raw ? JSON.parse(raw) : null
    return v && typeof v === "object" ? (v as MailMemory) : {}
  } catch {
    return {}
  }
}
function writeMemory(change: (m: MailMemory) => MailMemory): void {
  try {
    const next = change(readMemory())
    /* The 50 latest coupons are enough; old ones drop out. */
    const per = Object.entries(next.perCoupon ?? {}).slice(-50)
    localStorage.setItem(MEMORY_KEY, JSON.stringify({ ...next, perCoupon: Object.fromEntries(per) }))
  } catch {
    /* no storage (private window): the form simply starts fresh next time */
  }
}

export function SendCodeModal({ coupon, names, currency, nobody, onOpenChange }: { coupon: CouponDto | null; names: NameMaps; currency: string; nobody: string | null; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const prompt = usePrompt()
  const id = coupon?.id ?? null
  const state = useCodeMail(id)
  const list = useCoupons()
  const preview = usePreviewCodeMail()
  const send = useSendCodeMail()
  const [picked, setPicked] = useState<string[]>([])
  /* Names of the people added with the search (the picker shows them as chips). */
  const [added, setAdded] = useState<Record<string, string>>({})
  const [message, setMessage] = useState("")
  const [senderNote, setSenderNote] = useState("")
  /* The instruction came from the last send, not from the rules (a hint under the field). */
  const [remembered, setRemembered] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  /* More coupons in the same e-mail and the sentence of each (the main one too, once there are several). */
  const [extra, setExtra] = useState<string[]>([])
  const [sentences, setSentences] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [link, setLink] = useState(true)
  const extraStates = useCodeMails(extra)

  const sentenceOf = (c: CouponDto) => couponSentence(c, names, t, fmt, currency, { forCustomer: true })

  /* A fresh form for each coupon: the instruction from its sentence, the people of its rule ticked. */
  useEffect(() => {
    if (!coupon) return
    const memory = readMemory()
    const last = memory.perCoupon?.[coupon.id]?.trim()
    setMessage(last || sentenceOf(coupon))
    setRemembered(Boolean(last))
    setSenderNote(memory.senderNote ?? "")
    setAdded({})
    setErrors([])
    setExtra([])
    setSentences({})
    setAdding(false)
    setLink(true)
    preview.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coupon?.id])
  useEffect(() => {
    if (state.data) setPicked(state.data.recipients.filter((r) => !r.sentAt && r.inRule).map((r) => r.customerId))
  }, [state.data])

  const all = list.data?.coupons ?? []
  const byId = new Map(all.map((c) => [c.id, c]))
  const extraCoupons = extra.map((x) => byId.get(x)).filter((c): c is CouponDto => Boolean(c))
  const multi = extraCoupons.length > 0
  const sendCoupons = coupon ? [coupon, ...extraCoupons] : []
  const choices = sendableCoupons(all, id, extra)

  const data = state.data
  /* Every coupon's state: the main one first. */
  const states: Array<{ coupon: CouponDto; data: CodeMailResponse | undefined }> = coupon ? [{ coupon, data }, ...extraCoupons.map((c, i) => ({ coupon: c, data: extraStates[i]?.data }))] : []
  const rowMap = new Map<string, CodeMailRecipientDto>()
  for (const x of states) for (const r of x.data?.recipients ?? []) if (!rowMap.has(r.customerId)) rowMap.set(r.customerId, r)
  const rows: CodeMailRecipientDto[] = [...rowMap.values()]
  const known = new Set(rows.map((r) => r.customerId))
  /* The codes a person already has, per coupon of this send. */
  const hasCodes = (cid: string) => states.filter((s) => (s.data?.sent ?? []).some((e) => e.customer_id === cid)).map((s) => s.coupon.code)
  const hasAll = (cid: string) => hasCodes(cid).length === states.length
  const sentIds = new Set(rows.filter((r) => hasAll(r.customerId)).map((r) => r.customerId))
  const toSend = picked.filter((cid) => !sentIds.has(cid))
  const newOnRule = [...new Set(states.flatMap((s) => (s.data?.customerRule ? toSend.filter((cid) => !(s.data?.recipients ?? []).find((r) => r.customerId === cid)?.inRule) : [])))]
  const extraPicked = picked.filter((cid) => !known.has(cid))
  const blockers = data?.blockers ?? []
  const extraBlocked = extraCoupons.some((_c, i) => (extraStates[i]?.data?.blockers ?? []).length > 0)
  const tooLong = message.length > MESSAGE_MAX
  const noteTooLong = senderNote.length > MESSAGE_MAX
  const sentenceBad = multi && sendCoupons.some((c) => !(sentences[c.id] ?? "").trim() || (sentences[c.id] ?? "").length > MESSAGE_MAX)
  const loadingExtra = extraStates.some((q) => q.isLoading)
  const canSend = Boolean(data && blockers.length === 0 && !extraBlocked && !loadingExtra && toSend.length > 0 && message.trim() && !tooLong && !noteTooLong && !sentenceBad)
  const codes = sendCoupons.map((c) => c.code).join(" + ")
  const audienceNote = !coupon
    ? null
    : sendCoupons.some((c) => !c.shape.customerIds.length && c.shape.groupIds.length)
      ? { icon: <ExclamationCircle />, text: t("codeMail.points.groups"), tone: "orange" as const }
      : states.some((x) => x.data?.customerRule)
        ? { icon: <Users />, text: t("codeMail.points.rule"), tone: "blue" as const }
        : { icon: <Users />, text: t("codeMail.points.everyone") }

  const toggle = (cid: string) => setPicked((p) => (p.includes(cid) ? p.filter((x) => x !== cid) : [...p, cid]))

  const addCoupon = (cid: string) => {
    const c = byId.get(cid)
    if (!c || !coupon || extra.includes(cid) || extra.length + 1 >= COUPONS_PER_SEND_MAX) return
    /* The first extra code: the main sentence moves to its code, the instruction becomes the shared one. */
    if (!multi) {
      setSentences({ [coupon.id]: message, [cid]: sentenceOf(c) })
      const shared = readMemory().shared?.trim()
      setMessage(shared || t("codeMail.sharedDefault"))
      setRemembered(Boolean(shared))
    } else setSentences((m) => ({ ...m, [cid]: sentenceOf(c) }))
    setExtra((x) => [...x, cid])
    setAdding(false)
    preview.reset()
  }
  const removeCoupon = (cid: string) => {
    const next = extra.filter((x) => x !== cid)
    setExtra(next)
    /* Back to one code: its sentence is the instruction again. */
    if (!next.length && coupon) {
      setMessage(sentences[coupon.id] ?? sentenceOf(coupon))
      setRemembered(false)
    }
    setSentences((m) => {
      const { [cid]: _gone, ...rest } = m
      void _gone
      return rest
    })
    preview.reset()
  }

  const body = () => ({
    customerIds: toSend.length ? toSend : picked,
    message,
    coupons: multi ? sendCoupons.map((c) => ({ id: c.id, sentence: sentences[c.id] ?? "" })) : undefined,
    link: data?.ability.link ? link : undefined,
    senderNote: senderNote.trim() || undefined,
  })

  const runPreview = async () => {
    if (!id) return
    try {
      await preview.mutateAsync({ id, ...body() })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const doSend = async () => {
    if (!id || !coupon) return
    setErrors([])
    const ok = await prompt({
      title: t("codeMail.confirmTitle", { code: codes }),
      description: t("codeMail.confirmText", { count: toSend.length }) + (newOnRule.length ? ` ${t("codeMail.confirmRule", { count: newOnRule.length })}` : ""),
      confirmText: t("codeMail.send", { count: toSend.length }),
      cancelText: t("codeMail.cancel"),
    })
    if (!ok) return
    try {
      const r = await send.mutateAsync({ id, ...body(), customerIds: toSend })
      if (r.sent.length) {
        toast.success(t("codeMail.sent", { count: r.sent.length, code: codes }))
        const used = message.trim()
        const note = senderNote.trim()
        writeMemory((m) => (multi ? { ...m, shared: used, senderNote: note } : { ...m, perCoupon: { ...(m.perCoupon ?? {}), [coupon.id]: used }, senderNote: note }))
      }
      if (r.failed.length) toast.warning(t("codeMail.failed", { count: r.failed.length }))
      if (!r.recorded) toast.warning(t("codeMail.notRecorded"))
      setAdded({})
      void state.refetch()
      for (const q of extraStates) void q.refetch()
      if (!r.failed.length) onOpenChange(false)
    } catch (err) {
      if (err instanceof CouponsRequestError && err.errors.length) setErrors(err.errors)
      else toast.error(errorMessage(err))
    }
  }

  const errorText = (e: string) =>
    e.startsWith("other_") ? t("codeMail.otherBlocked", { reason: t(`codeMail.blocker.${e.slice(6)}`, { defaultValue: e.slice(6) }) }) : t(`codeMail.error.${e}`, { defaultValue: t(`codeMail.blocker.${e}`, { defaultValue: e }) })

  return (
    <FocusModal open={Boolean(coupon)} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex min-w-0 items-center gap-x-2">
            <Envelope className="text-ui-fg-interactive" />
            <Text size="small" weight="plus">
              {t("codeMail.title")}
            </Text>
            <span className="truncate font-mono txt-compact-small-plus">{codes}</span>
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

              {/* The codes of the e-mail: the coupon of this page, then the added ones, each with what it gives. */}
              {data ? (
                <Section icon={<Tag />} title={t("codeMail.codes")} points={[{ icon: <Tag />, text: t("codeMail.codesCount", { count: sendCoupons.length }), tone: multi ? "blue" : "grey" }]}>
                  <div className="flex flex-col divide-y">
                    {sendCoupons.map((c, i) => {
                      const blocked = i > 0 ? extraStates[i - 1]?.data?.blockers ?? [] : []
                      return (
                        <div key={c.id} className="flex flex-col gap-y-2 px-6 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-x-2">
                              <Tag className="shrink-0 text-ui-fg-muted" />
                              <span className="truncate font-mono txt-compact-small-plus">{c.code}</span>
                              {blocked.length ? <ToneBadge tone="red">{blocked.map((b) => t(`codeMail.blocker.${b}`, { defaultValue: b })).join(" ")}</ToneBadge> : null}
                            </span>
                            {i > 0 ? (
                              <Button size="small" variant="transparent" onClick={() => removeCoupon(c.id)}>
                                <XMark />
                                {t("codeMail.removeCoupon")}
                              </Button>
                            ) : null}
                          </div>
                          {multi ? (
                            <div className="flex flex-col gap-y-1">
                              <Text size="xsmall" className="text-ui-fg-subtle">
                                {t("codeMail.sentence")}
                              </Text>
                              <Textarea rows={2} value={sentences[c.id] ?? ""} onChange={(e) => setSentences((m) => ({ ...m, [c.id]: e.target.value }))} />
                              <div className="flex items-center justify-between gap-2">
                                <Text size="xsmall" className={(sentences[c.id] ?? "").length > MESSAGE_MAX ? "text-ui-fg-error" : "text-ui-fg-muted"}>
                                  {t("codeMail.sentenceHint", { count: (sentences[c.id] ?? "").length, max: MESSAGE_MAX })}
                                </Text>
                                <Button size="small" variant="transparent" onClick={() => setSentences((m) => ({ ...m, [c.id]: sentenceOf(c) }))}>
                                  <ArrowPath />
                                  {t("codeMail.reset")}
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex flex-col gap-y-2 px-6 py-3">
                    {adding ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <Select size="small" onValueChange={(v) => addCoupon(v)}>
                            <Select.Trigger>
                              <Select.Value placeholder={choices.length ? t("codeMail.pickCoupon") : t("codeMail.noMoreCoupons")} />
                            </Select.Trigger>
                            <Select.Content>
                              {choices.map((c) => (
                                <Select.Item key={c.id} value={c.id}>
                                  {c.code}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select>
                        </div>
                        <IconButton size="small" variant="transparent" onClick={() => setAdding(false)} aria-label={t("codeMail.cancel")}>
                          <XMark />
                        </IconButton>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="small" variant="secondary" disabled={!choices.length || sendCoupons.length >= COUPONS_PER_SEND_MAX} onClick={() => setAdding(true)}>
                          <Plus />
                          {t("codeMail.addCoupon")}
                        </Button>
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {sendCoupons.length >= COUPONS_PER_SEND_MAX ? t("codeMail.maxCoupons", { max: COUPONS_PER_SEND_MAX }) : !choices.length ? t("codeMail.noMoreCoupons") : null}
                        </Text>
                      </div>
                    )}
                    {data.ability.link ? (
                      <label className="flex cursor-pointer items-center gap-x-2">
                        <Switch checked={link} onCheckedChange={(v) => (setLink(Boolean(v)), preview.reset())} />
                        <Link className="text-ui-fg-muted" />
                        <Text size="small">{t("codeMail.link")}</Text>
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("codeMail.linkHint")}
                        </Text>
                      </label>
                    ) : null}
                  </div>
                </Section>
              ) : null}

              {data ? (
                <Section icon={<Users />} title={t("codeMail.recipients")} points={[{ icon: <PaperPlane />, text: t("codeMail.toSend", { count: toSend.length }), tone: toSend.length ? "blue" : "grey" }, { icon: <CheckCircle />, text: t("codeMail.already", { count: sentIds.size }) }]}>
                  <div className="flex flex-col divide-y">
                    {rows.length === 0 ? <EmptyState compact icon={<User />} title={t("codeMail.noRecipients")} /> : null}
                    {rows.map((r) => {
                      const was = sentIds.has(r.customerId)
                      const some = was ? [] : hasCodes(r.customerId)
                      const at = (data.sent.find((e) => e.customer_id === r.customerId)?.at ?? r.sentAt) as string | null
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
                              {at && !multi ? t("codeMail.sentAt", { date: fmt.date(at) }) : t("codeMail.hasAll")}
                            </ToneBadge>
                          ) : some.length ? (
                            <ToneBadge tone="blue" icon={<CheckCircle />}>
                              {t("codeMail.hasSome", { codes: some.join(", ") })}
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
                    {multi ? t("codeMail.shared") : t("codeMail.message")}
                  </Text>
                  <Textarea rows={multi ? 3 : 5} value={message} onChange={(e) => { setMessage(e.target.value); setRemembered(false) }} />
                  <div className="flex items-center justify-between gap-2">
                    <Text size="xsmall" className={tooLong ? "text-ui-fg-error" : "text-ui-fg-muted"}>
                      {multi ? t("codeMail.sharedHint", { count: message.length, max: MESSAGE_MAX }) : t("codeMail.messageHint", { count: message.length, max: MESSAGE_MAX })}
                    </Text>
                    <Button size="small" variant="transparent" onClick={() => { if (coupon) { setMessage(multi ? t("codeMail.sharedDefault") : sentenceOf(coupon)); setRemembered(false) } }}>
                      <ArrowPath />
                      {t("codeMail.reset")}
                    </Button>
                  </div>
                  {remembered ? (
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {multi ? t("codeMail.rememberedShared") : t("codeMail.remembered")}
                    </Text>
                  ) : null}
                </div>
              ) : null}
              {data ? (
                <div className="flex flex-col gap-y-1.5">
                  <Text size="small" weight="plus">
                    {t("codeMail.senderNote")}
                  </Text>
                  <Textarea rows={2} value={senderNote} placeholder={t("codeMail.senderNotePlaceholder")} onChange={(e) => setSenderNote(e.target.value)} />
                  <div className="flex items-center justify-between gap-2">
                    <Text size="xsmall" className={noteTooLong ? "text-ui-fg-error" : "text-ui-fg-muted"}>
                      {t("codeMail.senderNoteHint", { count: senderNote.length, max: MESSAGE_MAX })}
                    </Text>
                    {senderNote ? (
                      <Button size="small" variant="transparent" onClick={() => setSenderNote("")}>
                        <XMark />
                        {t("codeMail.senderNoteClear")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {errors.length ? (
                <InlineTip variant="error" label={t("codeMail.title")}>
                  {errors.map(errorText).join(" ")}
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
                  <Button size="small" variant="secondary" isLoading={preview.isPending} disabled={!message.trim() || tooLong || noteTooLong || sentenceBad} onClick={() => void runPreview()}>
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
            <Text size="small" className="min-w-0 truncate text-ui-fg-muted">
              {newOnRule.length ? t("codeMail.ruleNote", { count: newOnRule.length }) : t("codeMail.onlyNew")}
            </Text>
            <div className="flex shrink-0 items-center gap-2">
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
