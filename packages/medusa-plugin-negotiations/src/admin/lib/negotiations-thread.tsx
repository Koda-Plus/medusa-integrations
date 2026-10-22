import { useRef, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  ArrowUpRightOnBox,
  ChatBubble,
  ChatBubbleLeftRight,
  CheckCircle,
  Clock,
  CurrencyDollar,
  DocumentSeries,
  DocumentText,
  ExclamationCircle,
  PencilSquare,
  ShoppingCart,
  Tag,
  User,
  XCircle,
} from "@medusajs/icons"
import { Button, Input, Label, Select, Table, Text, Textarea, clx, toast, usePrompt } from "@medusajs/ui"
import type { DraftOrderDto, MessageDto, StatusResponse, ThreadDto } from "../../modules/negotiations/lib/contract"
import { errorCode, errorMessage, useNegotiationThread, useThreadMove, type ThreadMove } from "./negotiations-api"
import { EmptyState, FilterBar, FilterButton, Section, SubpageHeader, ToneBadge, type Tone } from "./negotiations-blocks"
import { NegotiationsIcon } from "./negotiations-icon"
import { KitLoading } from "./negotiations-kit"
import {
  DemoBadge,
  Fact,
  NegotiationStatusBadge,
  customerLine,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
  fmtRelative,
  messageText,
  moveLine,
  subjectLine,
  typed,
} from "./negotiations-ui"

type Tab = "reply" | "counter" | "note"

const VALIDITY = ["", "3", "7", "14", "30"] as const

const TAB_ICON: Record<Tab, ReactNode> = { reply: <ChatBubble />, counter: <CurrencyDollar />, note: <PencilSquare /> }

/**
 * One thread as a page of its own (`?thread=<id>`): the header with the
 * moves (accept, reject, open the customer or the product), the facts, the
 * cart lines, the draft order, the conversation (customer on the left, the
 * team on the right, the moves in the middle, internal notes marked) and the
 * composer. Opens from the queue, the widgets and links.
 */
export function ThreadPage({ id, preview, status, backHref }: { id: string; preview: ThreadDto | null; status: StatusResponse | undefined; backHref: string }) {
  const { t, i18n } = useTranslation("negotiations")
  const lang = i18n.language || "en"
  const detail = useNegotiationThread(id)
  const thread: ThreadDto | null = detail.data?.thread ?? preview
  const back = { href: backHref, label: t("thread.back") }

  if (!thread) {
    return (
      <SubpageHeader back={back} icon={<NegotiationsIcon width={28} height={28} />} title={detail.isError ? t("drawer.notFound") : t("queue.loading")}>
        {detail.isError ? <EmptyState icon={<ExclamationCircle />} title={errorMessage(detail.error)} /> : <KitLoading label={t("queue.loading")} />}
      </SubpageHeader>
    )
  }
  return <ThreadBody key={thread.id} thread={thread} status={status} lang={lang} back={back} />
}

function ThreadBody({ thread, status, lang, back }: { thread: ThreadDto; status: StatusResponse | undefined; lang: string; back: { href: string; label: string } }) {
  const { t } = useTranslation("negotiations")
  const prompt = usePrompt()
  const move = useThreadMove()
  const [tab, setTab] = useState<Tab>("reply")
  const [reply, setReply] = useState("")
  const [counterPrice, setCounterPrice] = useState("")
  const [counterMessage, setCounterMessage] = useState("")
  const [validDays, setValidDays] = useState<string>("")
  const [note, setNote] = useState("")
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const answerRef = useRef<HTMLDivElement | null>(null)

  const active = thread.status === "open" || thread.status === "counter_offered"
  const who = customerLine(thread, t, lang)
  const subject = subjectLine(thread, t)
  const currency = thread.currencyCode
  const unitWord = thread.subject === "cart" ? t("composer.forCart") : t("composer.perUnit")
  const taxWord = status?.options.taxInclusive ? t("composer.gross") : t("composer.net")
  const busy = (m: ThreadMove) => move.isPending && move.variables?.move === m
  const value = fmtMoney(thread.value, currency, lang)

  const run = async (m: ThreadMove, body: Record<string, unknown>, done: string): Promise<boolean> => {
    try {
      await move.mutateAsync({ id: thread.id, move: m, body })
      toast.success(done)
      return true
    } catch (err) {
      const code = errorCode(err)
      toast.error(code ? t(`errors.${code}`, { defaultValue: errorMessage(err) }) : t("toast.error", { error: errorMessage(err) }))
      return false
    }
  }

  const sendReply = async () => {
    if (!reply.trim()) return void toast.error(t("toast.empty"))
    if (await run("messages", { message: reply }, t("toast.sent"))) setReply("")
  }
  const sendCounter = async () => {
    if (!counterPrice.trim()) return void toast.error(t("toast.badPrice"))
    const body: Record<string, unknown> = { price: counterPrice.trim(), message: counterMessage.trim() || undefined }
    if (validDays) body.valid_days = Number(validDays)
    if (await run("counter", body, t("toast.counter"))) {
      setCounterPrice("")
      setCounterMessage("")
    }
  }
  const saveNote = async () => {
    if (!note.trim()) return void toast.error(t("toast.empty"))
    if (await run("notes", { note }, t("toast.noted"))) setNote("")
  }
  const accept = async () => {
    if (!thread.price) return
    const price = fmtMoney(thread.price, currency, lang)
    const ok = await prompt({
      title: t("accept.title", { ref: thread.ref }),
      description: thread.subject === "cart" ? t("accept.descriptionCart", { price }) : t("accept.description", { price, qty: fmtNumber(thread.qty, lang) }),
      confirmText: t("accept.confirm"),
      cancelText: t("actions.cancel"),
    })
    if (ok) await run("accept", { price: thread.price.value }, t("toast.accepted"))
  }
  const reject = async () => {
    if (await run("reject", { message: rejectReason.trim() || undefined }, t("toast.rejected"))) {
      setRejecting(false)
      setRejectReason("")
    }
  }
  const startReject = () => {
    setRejecting(true)
    requestAnimationFrame(() => answerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  const queueDraft = async () => {
    await run("draft-order", {}, t("toast.queued"))
  }

  const tabs: Tab[] = active ? ["reply", "counter", "note"] : ["note"]
  const shownTab: Tab = tabs.includes(tab) ? tab : "note"

  return (
    <div className="flex flex-col gap-y-3">
      <SubpageHeader
        back={back}
        icon={<NegotiationsIcon width={28} height={28} />}
        title={t("drawer.title", { ref: thread.ref })}
        badges={
          <>
            <NegotiationStatusBadge status={thread.status} />
            {thread.waitingFor === "team" ? <ToneBadge tone="orange">{t("waiting.team")}</ToneBadge> : thread.waitingFor === "customer" ? <ToneBadge tone="grey">{t("waiting.customer")}</ToneBadge> : null}
            {thread.demo ? <DemoBadge /> : null}
          </>
        }
        points={[
          { icon: <User />, text: who.main },
          { icon: thread.subject === "cart" ? <ShoppingCart /> : <Tag />, text: subject.main },
          value ? { icon: <CurrencyDollar />, text: t("thread.value", { value }) } : null,
          active ? { icon: <Clock />, text: thread.expiresAt ? t("thread.expires", { time: fmtRelative(thread.expiresAt, lang) }) : t("thread.noExpiry"), title: thread.expiresAt ? fmtDateTime(thread.expiresAt, lang) : undefined } : null,
        ]}
        actions={
          <>
            {thread.customer ? (
              <Button size="small" variant="secondary" asChild>
                <Link to={`/customers/${thread.customer.id}`}>
                  <User />
                  {t("drawer.openCustomer")}
                </Link>
              </Button>
            ) : null}
            {thread.productId && thread.subject !== "cart" ? (
              <Button size="small" variant="secondary" asChild>
                <Link to={`/products/${thread.productId}`}>
                  <Tag />
                  {t("drawer.openProduct")}
                </Link>
              </Button>
            ) : null}
            {active ? (
              <>
                <Button size="small" variant="danger" onClick={startReject} disabled={rejecting}>
                  <XCircle />
                  {t("reject.button")}
                </Button>
                <Button
                  size="small"
                  onClick={() => void accept()}
                  isLoading={busy("accept")}
                  disabled={!thread.price}
                  title={thread.price ? t("accept.hint", { price: fmtMoney(thread.price, currency, lang) }) : t("errors.no_price")}
                >
                  <CheckCircle />
                  {thread.price ? t("accept.button", { price: fmtMoney(thread.price, currency, lang) }) : t("accept.buttonNoPrice")}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <Section icon={<DocumentText />} title={t("thread.facts")}>
        <div className="grid grid-cols-2 gap-4 px-6 py-4 sm:grid-cols-3 xl:grid-cols-4">
          <Fact label={t("drawer.customer")}>
            <span className="block truncate">{who.main}</span>
            {who.sub ? <span className="block truncate text-ui-fg-muted">{who.sub}</span> : null}
          </Fact>
          <Fact label={thread.subject === "cart" ? t("drawer.cart") : t("drawer.product")}>
            <span className="block">{subject.main}</span>
          </Fact>
          {thread.subject === "cart" ? (
            <Fact label={t("drawer.lines")}>{fmtNumber(thread.items?.length ?? 0, lang)}</Fact>
          ) : (
            <Fact label={t("drawer.sku")} mono>
              {thread.sku ?? (thread.subject === "product" ? <span className="font-sans text-ui-fg-muted">{t("queue.anyVariant")}</span> : "")}
            </Fact>
          )}
          {thread.subject !== "cart" ? <Fact label={t("drawer.qty")}>{fmtNumber(thread.qty, lang)}</Fact> : null}
          <Fact label={thread.subject === "cart" ? t("drawer.listCart") : t("drawer.list")}>{fmtMoney(thread.list, currency, lang) || "-"}</Fact>
          <Fact label={t("drawer.requested")}>{fmtMoney(thread.requested, currency, lang) || "-"}</Fact>
          <Fact label={t("drawer.offered")}>{fmtMoney(thread.offered, currency, lang) || "-"}</Fact>
          {thread.agreed ? <Fact label={t("drawer.agreed")}>{fmtMoney(thread.agreed, currency, lang)}</Fact> : null}
          <Fact label={t("drawer.value")}>
            {value || "-"}
            {thread.discountPercent !== null && thread.discountPercent > 0 ? (
              <span className="block text-ui-fg-muted">{t("queue.below", { percent: fmtNumber(thread.discountPercent, lang) })}</span>
            ) : null}
          </Fact>
          <Fact label={t("drawer.handledBy")}>{thread.assignedName ?? thread.assignedTo ?? "-"}</Fact>
          <Fact label={t("drawer.started")}>{fmtDateTime(thread.createdAt, lang)}</Fact>
          {active ? (
            <Fact label={thread.validUntil ? t("drawer.validUntil") : t("drawer.expires")}>
              {thread.expiresAt ? (
                <span title={fmtDateTime(thread.expiresAt, lang)}>{fmtRelative(thread.expiresAt, lang)}</span>
              ) : (
                <span className="text-ui-fg-muted">{t("drawer.noExpiry")}</span>
              )}
            </Fact>
          ) : (
            <Fact label={t("drawer.closed")}>
              {fmtDateTime(thread.closedAt, lang)}
              {thread.closedBy ? <span className="block text-ui-fg-muted">{t(`drawer.closedBy.${thread.closedBy}`, { defaultValue: thread.closedBy })}</span> : null}
            </Fact>
          )}
          {thread.currencyAssumed ? (
            <Fact label={t("drawer.currency")}>
              <span className="uppercase">{currency ?? ""}</span>
              <span className="block text-ui-fg-muted">{t("drawer.currencyAssumed")}</span>
            </Fact>
          ) : null}
        </div>
      </Section>

      {thread.items && thread.items.length > 0 ? <CartLines thread={thread} lang={lang} /> : null}

      {thread.status === "accepted" ? <DraftOrderSection thread={thread} status={status} lang={lang} busy={busy("draft-order")} onQueue={() => void queueDraft()} /> : null}

      <Section
        icon={<ChatBubbleLeftRight />}
        title={t("drawer.conversation")}
        points={[
          { icon: <User />, text: t("thread.points.left") },
          { icon: <ChatBubble />, text: t("thread.points.right") },
          { icon: <PencilSquare />, text: t("thread.points.notes") },
        ]}
      >
        <div className="flex max-h-[36rem] flex-col gap-y-3 overflow-y-auto bg-ui-bg-subtle px-6 py-4">
          {(thread.messages ?? []).length === 0 ? (
            <EmptyState compact icon={<ChatBubbleLeftRight />} title={t("drawer.noMessages")} />
          ) : (
            (thread.messages ?? []).map((m) => <Bubble key={m.id} m={m} thread={thread} lang={lang} />)
          )}
        </div>
      </Section>

      <div ref={answerRef} className="scroll-mt-4">
        <Section
          icon={<PencilSquare />}
          title={t("thread.answer")}
          points={
            active
              ? [
                  { icon: <ChatBubble />, text: t("thread.points.reply") },
                  { icon: <CurrencyDollar />, text: t("thread.points.counter") },
                  { icon: <PencilSquare />, text: t("thread.points.note") },
                ]
              : [
                  { icon: <XCircle />, text: t("thread.points.closed"), title: t("drawer.closedTip") },
                  { icon: <PencilSquare />, text: t("thread.points.notesStill") },
                ]
          }
        >
          {rejecting ? (
            <div className="flex flex-col gap-y-2 px-6 py-4">
              <Label size="xsmall" weight="plus" htmlFor="negotiations-reject-reason">
                {t("reject.title")}
              </Label>
              <Textarea id="negotiations-reject-reason" rows={2} placeholder={t("reject.placeholder")} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="small" variant="secondary" onClick={() => setRejecting(false)}>
                  {t("actions.cancel")}
                </Button>
                <Button size="small" variant="danger" onClick={() => void reject()} isLoading={busy("reject")}>
                  {t("reject.confirm")}
                </Button>
              </div>
            </div>
          ) : null}

          {tabs.length > 1 ? (
            <FilterBar>
              {tabs.map((k) => (
                <FilterButton key={k} icon={TAB_ICON[k]} label={t(`composer.${k}`)} active={shownTab === k} onClick={() => setTab(k)} />
              ))}
            </FilterBar>
          ) : null}

          <div className="px-6 py-4">
            {shownTab === "reply" ? (
              <div className="flex flex-col gap-y-2">
                <Textarea rows={3} placeholder={t("composer.replyPlaceholder")} value={reply} onChange={(e) => setReply(e.target.value)} />
                <div className="flex justify-end">
                  <Button size="small" onClick={() => void sendReply()} isLoading={busy("messages")}>
                    {t("composer.send")}
                  </Button>
                </div>
              </div>
            ) : null}

            {shownTab === "counter" ? (
              <div className="flex flex-col gap-y-3">
                <Text size="small" className="text-ui-fg-subtle">
                  {t("composer.counterHint", { unit: unitWord, tax: taxWord })}
                </Text>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr]">
                  <div className="flex flex-col gap-y-1">
                    <Label size="xsmall" weight="plus" htmlFor="negotiations-counter-price">
                      {t("composer.price", { currency: (currency ?? "").toUpperCase(), unit: unitWord })}
                    </Label>
                    <Input id="negotiations-counter-price" inputMode="decimal" placeholder={thread.price?.value ?? "0.00"} value={counterPrice} onChange={(e) => setCounterPrice(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-y-1">
                    <Label size="xsmall" weight="plus" htmlFor="negotiations-counter-valid">
                      {t("composer.validFor")}
                    </Label>
                    <Select value={validDays || "clock"} onValueChange={(v) => setValidDays(v === "clock" ? "" : v)}>
                      <Select.Trigger id="negotiations-counter-valid">
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content>
                        {VALIDITY.map((d) => (
                          <Select.Item key={d || "clock"} value={d || "clock"}>
                            {d ? t("composer.validDays", { count: Number(d) }) : t("composer.validClock", { count: status?.options.expiryDays ?? 14 })}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>
                </div>
                <Textarea rows={2} placeholder={t("composer.counterMessage")} value={counterMessage} onChange={(e) => setCounterMessage(e.target.value)} />
                <div className="flex justify-end">
                  <Button size="small" variant="secondary" onClick={() => void sendCounter()} isLoading={busy("counter")}>
                    {t("composer.sendCounter")}
                  </Button>
                </div>
              </div>
            ) : null}

            {shownTab === "note" ? (
              <div className="flex flex-col gap-y-2">
                <Text size="xsmall" className="text-ui-fg-muted">
                  {t("composer.noteHint")}
                </Text>
                <Textarea rows={2} placeholder={t("composer.notePlaceholder")} value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex justify-end">
                  <Button size="small" variant="secondary" onClick={() => void saveNote()} isLoading={busy("notes")}>
                    {t("composer.saveNote")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </Section>
      </div>
    </div>
  )
}

function CartLines({ thread, lang }: { thread: ThreadDto; lang: string }) {
  const { t } = useTranslation("negotiations")
  return (
    <Section icon={<ShoppingCart />} title={t("drawer.cartLines")}>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("drawer.product")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("drawer.qty")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("drawer.unit")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("drawer.lineTotal")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(thread.items ?? []).map((l, i) => (
              <Table.Row key={`${l.variantId ?? i}`}>
                <Table.Cell className="max-w-[16rem]">
                  <div className="flex flex-col">
                    <Text size="small" leading="compact" className="truncate">
                      {l.title}
                    </Text>
                    {l.sku ? (
                      <Text size="xsmall" leading="compact" className="truncate font-mono text-ui-fg-muted">
                        {l.sku}
                      </Text>
                    ) : null}
                  </div>
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">{fmtNumber(l.quantity, lang)}</Table.Cell>
                <Table.Cell className="text-right tabular-nums">{fmtMoney(l.unit, thread.currencyCode, lang)}</Table.Cell>
                <Table.Cell className="text-right tabular-nums">{fmtMoney(l.total, thread.currencyCode, lang)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

const DRAFT_TONE: Record<DraftOrderDto["state"], Tone> = {
  pending: "blue",
  creating: "blue",
  created: "green",
  failed: "red",
  unknown: "orange",
  blocked: "orange",
}

/** The draft order of an accepted thread: its state and link, or the way to queue it. */
function DraftOrderSection({ thread, status, lang, busy, onQueue }: { thread: ThreadDto; status: StatusResponse | undefined; lang: string; busy: boolean; onQueue: () => void }) {
  const { t } = useTranslation("negotiations")
  const writer = status?.writers.draftOrders
  const d = thread.draftOrder
  const canQueue = Boolean(writer?.allowed) && thread.subject !== "cart" && (!d || d.state === "failed" || d.state === "blocked")
  return (
    <Section
      icon={<DocumentSeries />}
      title={t("draft.title")}
      badges={
        <>
          {d ? <ToneBadge tone={DRAFT_TONE[d.state] ?? "grey"}>{t(`draft.states.${d.state}`)}</ToneBadge> : null}
          {d?.simulated ? <ToneBadge tone="purple">{t("draft.simulated")}</ToneBadge> : null}
        </>
      }
      actions={
        <>
          {d?.state === "created" && d.draftOrderId && !d.simulated ? (
            <Button size="small" variant="secondary" asChild>
              <Link to={`/draft-orders/${d.draftOrderId}`}>
                <ArrowUpRightOnBox />
                {t("draft.open")}
              </Link>
            </Button>
          ) : null}
          {canQueue ? (
            <Button size="small" variant="secondary" isLoading={busy} onClick={onQueue}>
              {d ? t("draft.retry") : t("draft.prepare")}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          {d?.state === "created"
            ? t("draft.createdText", { number: d.displayId !== null ? `#${d.displayId}` : (d.draftOrderId ?? ""), time: fmtDateTime(d.updatedAt, lang) })
            : d?.state === "blocked" || d?.state === "failed"
              ? t(`draft.reasons.${d.error ?? "unknown"}`, { defaultValue: d.error ?? "" })
              : d
                ? t(`draft.stateText.${d.state}`)
                : thread.subject === "cart"
                  ? t("draft.reasons.cart")
                  : writer?.allowed
                    ? writer.armed
                      ? t("draft.notQueued")
                      : t("draft.notArmed")
                    : t("draft.notAllowed")}
        </Text>
      </div>
    </Section>
  )
}

function Bubble({ m, thread, lang }: { m: MessageDto; thread: ThreadDto; lang: string }) {
  const { t } = useTranslation("negotiations")
  const line = moveLine(m, thread, t, lang)
  const text = messageText(m, lang)
  const time = (
    <Text size="xsmall" className="px-1 text-ui-fg-muted" title={fmtDateTime(m.createdAt, lang)}>
      {fmtRelative(m.createdAt, lang)}
    </Text>
  )

  if (m.kind === "note") {
    return (
      <div className="flex flex-col items-end gap-y-1">
        <div className="max-w-[85%] rounded-xl border border-dashed border-ui-tag-orange-border bg-ui-tag-orange-bg px-4 py-3">
          <Text size="xsmall" weight="plus" className="text-ui-tag-orange-text">
            {t("author.note", { name: m.authorName ?? t("author.admin") })}
          </Text>
          <Text size="small" className="whitespace-pre-wrap text-ui-fg-base">
            {typed(text)}
          </Text>
        </div>
        {time}
      </div>
    )
  }

  if (m.authorType === "system" || m.kind === "draft_order") {
    return (
      <div className="flex justify-center">
        <div className="flex max-w-[85%] flex-col items-center rounded-full border border-ui-border-base bg-ui-bg-base px-3 py-1 text-center">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
            {line ?? (m.kind === "draft_order" ? t("kind.draftOrder", { text }) : typed(text))}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {fmtDateTime(m.createdAt, lang)}
            {m.internal ? ` / ${t("author.internal")}` : ""}
          </Text>
        </div>
      </div>
    )
  }

  const mine = m.authorType === "admin"
  return (
    <div className={clx("flex flex-col gap-y-1", mine ? "items-end" : "items-start")}>
      <div className={clx("max-w-[85%] rounded-xl px-4 py-3 shadow-elevation-card-rest", mine ? "bg-ui-bg-interactive text-ui-fg-on-color" : "bg-ui-bg-base")}>
        <Text size="xsmall" weight="plus" className={mine ? "text-ui-fg-on-color opacity-80" : "text-ui-fg-muted"}>
          {mine ? (m.authorName ?? t("author.admin")) : (m.authorName ?? t("author.customer"))}
        </Text>
        {line ? (
          <Text size="small" weight="plus" className={mine ? "text-ui-fg-on-color" : "text-ui-fg-base"}>
            {line}
          </Text>
        ) : null}
        {text ? (
          <Text size="small" className="whitespace-pre-wrap">
            {typed(text)}
          </Text>
        ) : null}
      </div>
      {time}
    </div>
  )
}
