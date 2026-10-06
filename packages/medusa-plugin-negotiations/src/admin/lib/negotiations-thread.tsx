import { useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Drawer, Heading, InlineTip, Input, Label, Select, StatusBadge, Table, Text, Textarea, clx, toast, usePrompt } from "@medusajs/ui"
import type { DraftOrderDto, MessageDto, StatusResponse, ThreadDto } from "../../modules/negotiations/lib/contract"
import { errorCode, errorMessage, useNegotiationThread, useThreadMove, type ThreadMove } from "./negotiations-api"
import { NegotiationsIcon } from "./negotiations-icon"
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

/**
 * One thread: the facts, the conversation (customer on the left, the team on
 * the right, the moves in the middle, internal notes marked), and the moves
 * the team can make. Opens from the queue, the widgets and `?thread=<id>`.
 */
export function ThreadDrawer({ id, preview, status, onClose }: { id: string | null; preview: ThreadDto | null; status: StatusResponse | undefined; onClose: () => void }) {
  const { t, i18n } = useTranslation("negotiations")
  const lang = i18n.language || "en"
  const detail = useNegotiationThread(id)
  const thread: ThreadDto | null = detail.data?.thread ?? preview
  if (!id) return null

  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content className="max-w-2xl">
        {thread ? (
          <ThreadBody key={thread.id} thread={thread} status={status} lang={lang} onClose={onClose} />
        ) : (
          <>
            <Drawer.Header>
              <Drawer.Title>{detail.isError ? t("drawer.notFound") : t("queue.loading")}</Drawer.Title>
            </Drawer.Header>
            <Drawer.Body>
              {detail.isError ? (
                <Text size="small" className="text-ui-fg-subtle">
                  {errorMessage(detail.error)}
                </Text>
              ) : null}
            </Drawer.Body>
          </>
        )}
      </Drawer.Content>
    </Drawer>
  )
}

function ThreadBody({ thread, status, lang, onClose }: { thread: ThreadDto; status: StatusResponse | undefined; lang: string; onClose: () => void }) {
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

  const active = thread.status === "open" || thread.status === "counter_offered"
  const who = customerLine(thread, t, lang)
  const subject = subjectLine(thread, t)
  const currency = thread.currencyCode
  const unitWord = thread.subject === "cart" ? t("composer.forCart") : t("composer.perUnit")
  const taxWord = status?.options.taxInclusive ? t("composer.gross") : t("composer.net")
  const busy = (m: ThreadMove) => move.isPending && move.variables?.move === m

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
  const queueDraft = async () => {
    await run("draft-order", {}, t("toast.queued"))
  }

  const tabs: Tab[] = active ? ["reply", "counter", "note"] : ["note"]
  const shownTab: Tab = tabs.includes(tab) ? tab : "note"

  return (
    <>
      <Drawer.Header>
        <div className="flex flex-wrap items-center gap-2">
          <NegotiationsIcon width={20} height={20} />
          <Drawer.Title>{t("drawer.title", { ref: thread.ref })}</Drawer.Title>
          <NegotiationStatusBadge status={thread.status} />
          {thread.waitingFor === "team" ? (
            <Badge size="2xsmall" color="red">
              {t("waiting.team")}
            </Badge>
          ) : thread.waitingFor === "customer" ? (
            <Badge size="2xsmall" color="grey">
              {t("waiting.customer")}
            </Badge>
          ) : null}
          {thread.demo ? <DemoBadge /> : null}
        </div>
      </Drawer.Header>

      <Drawer.Body className="flex flex-col gap-y-6 overflow-y-auto">
        <div className="grid grid-cols-2 gap-4 rounded-lg border border-ui-border-base p-4 sm:grid-cols-3">
          <Fact label={t("drawer.customer")}>
            <span className="block truncate">{who.main}</span>
            {who.sub ? <span className="block truncate text-ui-fg-muted">{who.sub}</span> : null}
            {thread.customer ? (
              <Link to={`/customers/${thread.customer.id}`} className="inline-flex items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                {t("drawer.openCustomer")}
                <ArrowUpRightOnBox />
              </Link>
            ) : null}
          </Fact>
          <Fact label={thread.subject === "cart" ? t("drawer.cart") : t("drawer.product")}>
            <span className="block">{subject.main}</span>
            {thread.productId && thread.subject !== "cart" ? (
              <Link to={`/products/${thread.productId}`} className="inline-flex items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                {t("drawer.openProduct")}
                <ArrowUpRightOnBox />
              </Link>
            ) : null}
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
            {fmtMoney(thread.value, currency, lang) || "-"}
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

        {thread.items && thread.items.length > 0 ? <CartLines thread={thread} lang={lang} /> : null}

        {thread.status === "accepted" ? <DraftOrderBox thread={thread} status={status} lang={lang} busy={busy("draft-order")} onQueue={() => void queueDraft()} /> : null}

        <div className="flex flex-col gap-y-2">
          <Heading level="h3">{t("drawer.conversation")}</Heading>
          <div className="flex max-h-[28rem] flex-col gap-y-3 overflow-y-auto rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
            {(thread.messages ?? []).length === 0 ? (
              <Text size="small" className="text-ui-fg-muted">
                {t("drawer.noMessages")}
              </Text>
            ) : (
              (thread.messages ?? []).map((m) => <Bubble key={m.id} m={m} thread={thread} lang={lang} />)
            )}
          </div>
        </div>

        {!active ? (
          <InlineTip variant="info" label={t(`status.${thread.status}`)}>
            {t("drawer.closedTip")}
          </InlineTip>
        ) : null}

        <div className="flex flex-col gap-y-3">
          <div role="tablist" className="flex flex-wrap gap-1">
            {tabs.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={shownTab === k}
                onClick={() => setTab(k)}
                className={clx(
                  "txt-compact-small-plus rounded-md px-3 py-1.5 outline-none transition-fg focus-visible:shadow-borders-focus",
                  shownTab === k ? "bg-ui-bg-component text-ui-fg-base shadow-borders-base" : "text-ui-fg-subtle hover:bg-ui-bg-component-hover hover:text-ui-fg-base",
                )}
              >
                {t(`composer.${k}`)}
              </button>
            ))}
          </div>

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

          {rejecting ? (
            <div className="flex flex-col gap-y-2 rounded-lg border border-ui-border-error bg-ui-bg-subtle p-3">
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
        </div>
      </Drawer.Body>

      <Drawer.Footer>
        <Button size="small" variant="secondary" onClick={onClose}>
          {t("drawer.close")}
        </Button>
        {active ? (
          <>
            <Button size="small" variant="danger" onClick={() => setRejecting(true)} disabled={rejecting}>
              {t("reject.button")}
            </Button>
            <Button
              size="small"
              onClick={() => void accept()}
              isLoading={busy("accept")}
              disabled={!thread.price}
              title={thread.price ? t("accept.hint", { price: fmtMoney(thread.price, currency, lang) }) : t("errors.no_price")}
            >
              {thread.price ? t("accept.button", { price: fmtMoney(thread.price, currency, lang) }) : t("accept.buttonNoPrice")}
            </Button>
          </>
        ) : null}
      </Drawer.Footer>
    </>
  )
}

function CartLines({ thread, lang }: { thread: ThreadDto; lang: string }) {
  const { t } = useTranslation("negotiations")
  return (
    <div className="flex flex-col gap-y-2">
      <Heading level="h3">{t("drawer.cartLines")}</Heading>
      <div className="overflow-x-auto rounded-lg border border-ui-border-base">
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
    </div>
  )
}

const DRAFT_TONE: Record<DraftOrderDto["state"], "green" | "orange" | "red" | "grey" | "blue"> = {
  pending: "blue",
  creating: "blue",
  created: "green",
  failed: "red",
  unknown: "orange",
  blocked: "orange",
}

/** The draft order of an accepted thread: its state and link, or the way to queue it. */
function DraftOrderBox({ thread, status, lang, busy, onQueue }: { thread: ThreadDto; status: StatusResponse | undefined; lang: string; busy: boolean; onQueue: () => void }) {
  const { t } = useTranslation("negotiations")
  const writer = status?.writers.draftOrders
  const d = thread.draftOrder
  const canQueue = Boolean(writer?.allowed) && thread.subject !== "cart" && (!d || d.state === "failed" || d.state === "blocked")
  return (
    <div className="flex flex-col gap-y-2 rounded-lg border border-ui-border-base bg-ui-bg-component px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-x-2">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {t("draft.title")}
          </Text>
          {d ? <StatusBadge color={DRAFT_TONE[d.state] ?? "grey"}>{t(`draft.states.${d.state}`)}</StatusBadge> : null}
          {d?.simulated ? (
            <Badge size="2xsmall" color="purple">
              {t("draft.simulated")}
            </Badge>
          ) : null}
        </span>
        {canQueue ? (
          <Button size="small" variant="secondary" isLoading={busy} onClick={onQueue}>
            {d ? t("draft.retry") : t("draft.prepare")}
          </Button>
        ) : null}
      </div>
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
      {d?.state === "created" && d.draftOrderId && !d.simulated ? (
        <Link to={`/draft-orders/${d.draftOrderId}`} className="txt-compact-small-plus inline-flex w-fit items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {t("draft.open")}
          <ArrowUpRightOnBox />
        </Link>
      ) : null}
    </div>
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
