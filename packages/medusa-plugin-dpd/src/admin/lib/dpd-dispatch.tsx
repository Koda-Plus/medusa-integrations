import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowDownTray, ArrowPath, ArrowUpRightOnBox, Calendar, DocumentText, Eye, HandTruck, ListBullet, QuestionMarkCircle, TruckFast, XCircle, XMark } from "@medusajs/icons"
import { Button, Checkbox, Drawer, InlineTip, Input, Label, Prompt, RadioGroup, Select, Table, Text, clx, toast, usePrompt } from "@medusajs/ui"
import type {
  AvailabilityResponse,
  CourierOrderRequest,
  DispatchDto,
  DispatchFilter,
  DispatchPlanDto,
  DispatchPlanShipmentDto,
  DispatchResponse,
  DispatchState,
  EventDto,
  PlanAddressDto,
  ProblemDto,
  WriterDto,
  WriterKey,
} from "../../modules/dpd/lib/contract"
import {
  DpdRequestError,
  openProtocol,
  useDpdCreateDispatch,
  useDpdDispatch,
  useDpdDispatchAction,
  useDpdDispatchAvailability,
  useDpdDispatchPlan,
  useDpdDispatchStep,
  useDpdDispatches,
  useDpdGroupAvailability,
  useDpdStatus,
} from "./dpd-api"
import { EmptyTableRow, FilterBar, FilterButton, RowActions, Section, StagedLoader, ToneBadge, runFromSteps, type RowAction, type StageDef, type StageRun, type StageState } from "./dpd-blocks"
import { nb } from "./dpd-guide"
import { KitFetchingBar, KitLoading, KitSkeletonRows } from "./dpd-kit"
import {
  DISPATCH_FILTERS,
  courierBlock,
  courierRequestOf,
  courierWindowChoices,
  defaultCourierDate,
  changeReasonCode,
  courierFormAllowed,
  dispatchActionWriter,
  dispatchErrorTone,
  dispatchMainAction,
  dispatchTone,
  fmtPickupDate,
  handoverStepOf,
  isClaimedDispatch,
  latestProtocol,
  pageInRange,
  printToastKind,
  stoppedRunMovedOn,
  writerBlock,
  type DispatchWriterAction,
} from "./dpd-logic"
import { AddressLines, ShipmentActionBar, useActionErrorText, useWriterBlockText } from "./dpd-plan"
import { OrderCell, ProblemList, ShipmentStatus, WaybillCell, fmtDateTime, fmtNumber } from "./dpd-ui"

/**
 * The handover to the courier (stage 4): the selection bar of the shipment
 * list, the drawer that plans, creates and prints a handover (and orders the
 * courier), the view of one handover with its protocols, courier order,
 * shipments and history, and the list of handovers on the panel. Every call
 * to DPD goes through the server; the admin never sees a checkSum, only
 * whether the order has one.
 */

/** The page size of the handover list (the route's default limit). */
const DISPATCH_PAGE = 20

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * The text of a refused handover action: the handover's own words for the
 * codes a handover reads differently (busy, not_armed, writer_off,
 * not_found, wrong_state, plan_changed), then the words of the shipment
 * actions, else the server's message.
 */
export function useDispatchErrorText(): (err: unknown) => string {
  const { t, i18n } = useTranslation("dpd")
  const actionText = useActionErrorText()
  return (err) => {
    const code = err instanceof DpdRequestError ? err.code : null
    const key = code ? `dispatch.actionError.${code}` : ""
    return key && i18n.exists(key, { ns: "dpd" }) ? t(key) : actionText(err)
  }
}

/** The words of an error code of a handover, or "" when the dictionary has none. */
function useErrorCodeText(): (code: string | null) => string {
  const { t, i18n } = useTranslation("dpd")
  return (code) => {
    const key = code ? `errorCode.${code}` : ""
    return key && i18n.exists(key, { ns: "dpd" }) ? t(key) : ""
  }
}

/**
 * Why an action of a handover cannot run, in words: the one writer it needs
 * (dispatchActionWriter) is off in the options or not armed. null: it can.
 * Without the writers (not loaded yet) the action waits as not armed.
 */
function useDispatchBlock(writers: Record<WriterKey, WriterDto> | undefined): (action: DispatchWriterAction, state: DispatchState) => string | null {
  const blockText = useWriterBlockText()
  return (action, state) => {
    const key = dispatchActionWriter(action, state)
    const writer = writers?.[key]
    const block = writerBlock(writer, writer?.armed ?? false)
    if (!block) return null
    const text = blockText(block, key)
    return [text.title, text.hint].filter(Boolean).join(" ")
  }
}

/**
 * The pickup of a handover in words: the day and the window (the `window`
 * text), or the `none` text when no courier is ordered. The drawer and the
 * order card each pass their own words.
 */
export function useCourierText(): (d: Pick<DispatchDto, "pickupDate" | "pickupTimeFrom" | "pickupTimeTo">, lang: string, words: { window: string; none: string }) => string {
  const { t } = useTranslation("dpd")
  return (d, lang, words) => (d.pickupDate && d.pickupTimeFrom && d.pickupTimeTo ? t(words.window, { date: fmtPickupDate(d.pickupDate, lang), from: d.pickupTimeFrom, to: d.pickupTimeTo }) : t(words.none))
}

/** The words of the drawer and the list for the pickup. */
const DISPATCH_COURIER_WORDS = { window: "dispatch.courierWindow", none: "dispatch.courierNone" }

/**
 * The toast after an action that reached DPD (or the simulator): the answer
 * is the handover in its new state, and a refusal or an unclear answer is a
 * state with an error code, not an error of the request. A print passes the
 * number of protocols the handover had before it (printToastKind); a change
 * passes the handover as it was, so a kept attention code is not given as
 * the reason (changeReasonCode).
 */
function useDispatchToast(): (
  res: DispatchResponse,
  action: "print" | "order" | "reschedule" | "cancelCourier" | "resolve" | "cancel",
  protocolsBefore?: number,
  before?: Pick<DispatchDto, "attention" | "errorCode">,
) => void {
  const { t, i18n } = useTranslation("dpd")
  const codeText = useErrorCodeText()
  return (res, action, protocolsBefore = 0, before) => {
    const d = res.dispatch
    const lang = i18n.language || "en"
    const text = codeText(before ? changeReasonCode(before, d) : d.errorCode)
    const props = text ? { description: text } : undefined
    if (action === "print") {
      const kind = printToastKind(d, protocolsBefore)
      if (kind === "printed") toast.success(d.demo ? t("toast.protocolDemo") : t("toast.protocolPrinted"))
      else if (kind === "unclear") toast.warning(t("toast.protocolUnclear"), props)
      else if (kind === "refused") toast.error(t("toast.protocolRefused"), props)
      else toast.error(t("dispatch.error"))
    } else if (action === "order") {
      if (d.state === "ordered") {
        if (d.simulated) toast.success(t("toast.courierSimulated"))
        else toast.success(t("toast.courierOrdered", { date: d.pickupDate ? fmtPickupDate(d.pickupDate, lang) : "", from: d.pickupTimeFrom ?? "", to: d.pickupTimeTo ?? "" }))
      } else if (d.state === "unknown") toast.warning(t("toast.courierUnknown"), props)
      else toast.error(t("toast.courierRefused"), props)
    } else if (action === "reschedule") {
      if (d.state === "ordered" && !d.errorCode) toast.success(t("toast.courierRescheduled"))
      else toast.error(t("dispatch.error"), props)
    } else if (action === "cancelCourier") {
      if (d.state === "printed") toast.success(t("toast.courierCanceled"))
      else toast.error(t("dispatch.error"), props)
    } else if (action === "resolve") {
      toast.success(t("toast.dispatchResolved"))
    } else if (d.state === "canceled") {
      toast.success(t("toast.dispatchCanceled"))
    } else {
      toast.error(t("dispatch.error"), props)
    }
  }
}

/** The state of a handover and what to know at a glance: needs a person, simulated. */
export function DispatchBadges({ dispatch: d }: { dispatch: Pick<DispatchDto, "state" | "attention" | "simulated"> }) {
  const { t } = useTranslation("dpd")
  return (
    <span className="flex flex-wrap items-center gap-1">
      <ToneBadge tone={dispatchTone(d)}>{t(`dispatch.state.${d.state}`)}</ToneBadge>
      {d.attention ? <ToneBadge tone="red">{t("dispatch.attention")}</ToneBadge> : null}
      {d.simulated ? <ToneBadge tone="purple">{t("dispatch.simulated")}</ToneBadge> : null}
    </span>
  )
}

/**
 * The last error of a handover, in the admin's language (E24): the words of
 * its error code, else a plain line that the last attempt failed. Not the
 * ErrorText of the shipments: a handover has its own states and tone
 * (dispatchErrorTone). Nothing while a request works on it.
 */
export function DispatchErrorText({ dispatch: d }: { dispatch: Pick<DispatchDto, "state" | "error" | "errorCode" | "attention"> }) {
  const { t } = useTranslation("dpd")
  const codeText = useErrorCodeText()
  const tone = dispatchErrorTone(d)
  if (!tone) return null
  const text = codeText(d.errorCode) || t("dispatch.error")
  return (
    <Text size="xsmall" className={tone === "orange" ? "text-ui-tag-orange-text" : "text-ui-tag-red-text"} title={t("dispatch.error")}>
      {text}
    </Text>
  )
}

/** The sender of a plan group on one line: who and the postal code. */
function senderLine(s: PlanAddressDto | null): string {
  if (!s) return "-"
  return nb([s.company || s.name, `${s.postalCode} ${s.city}`.trim()].filter(Boolean).join(", "))
}

/** One part of the drawer: a small heading over its content. */
function Part({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-2 rounded-lg border border-ui-border-base px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text size="xsmall" weight="plus" className="text-ui-fg-muted">
          {title}
        </Text>
        {badge}
      </div>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The selection bar of the shipment list                              */
/* ------------------------------------------------------------------ */

/** Under the shipment list while shipments are selected: how many, hand them over, clear. Two buttons, no menu. */
export function DispatchActionBar({ count, onHandover, onClear }: { count: number; onHandover: () => void; onClear: () => void }) {
  const { t } = useTranslation("dpd")
  if (count <= 0) return null
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-ui-border-base bg-ui-bg-base px-6 py-3 shadow-elevation-card-rest">
      <Text size="small" weight="plus" className="text-ui-fg-base">
        {t("shipments.selected", { count })}
      </Text>
      <span className="flex items-center gap-2">
        <Button size="small" variant="secondary" onClick={onClear}>
          <XMark />
          {t("shipments.clearSelection")}
        </Button>
        <Button size="small" variant="primary" onClick={onHandover}>
          <HandTruck />
          {t("actions.handover")}
        </Button>
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The courier date and window                                         */
/* ------------------------------------------------------------------ */

/**
 * The date (a native date input, from today to the last day DPD takes) and
 * the window of the courier (the ui Select). The choices come from the
 * answer only: its ranges, its today and its nowTime (server, Europe/Warsaw,
 * E7), never the browser clock.
 */
function CourierWindowFields({
  availability,
  date,
  onDate,
  value,
  onValue,
  refused,
}: {
  availability: AvailabilityResponse
  date: string
  onDate: (date: string) => void
  value: string
  onValue: (value: string) => void
  /** courier_window: the problems of the date and the window the server refused. */
  refused?: ProblemDto[]
}) {
  const { t } = useTranslation("dpd")
  const dateId = useId()
  const days = availability.days
  const choices = courierWindowChoices(availability.ranges, date, availability.today, availability.nowTime)
  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-y-1">
          <Label htmlFor={dateId} size="xsmall" className="text-ui-fg-subtle">
            {t("dispatch.courier.date")}
          </Label>
          <Input id={dateId} size="small" type="date" className="w-40" min={days[0]} max={days[days.length - 1]} value={date} onChange={(e) => onDate(e.target.value)} />
        </div>
        <div className="flex min-w-[12rem] flex-col gap-y-1">
          <Text size="xsmall" className="text-ui-fg-subtle">
            {t("dispatch.courier.window")}
          </Text>
          {choices.length === 0 ? (
            <Text size="small" className="text-ui-tag-orange-text">
              {t("dispatch.courier.noWindows")}
            </Text>
          ) : (
            <Select size="small" value={choices.some((c) => c.value === value) ? value : ""} onValueChange={onValue}>
              <Select.Trigger>
                <Select.Value placeholder={t("dispatch.courier.windowPick")} />
              </Select.Trigger>
              <Select.Content>
                {choices.map((c) => (
                  <Select.Item key={c.value} value={c.value}>
                    {t("dispatch.courier.windowItem", { from: c.from, to: c.to })}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          )}
        </div>
      </div>
      {refused && refused.length > 0 ? <ProblemList items={refused} /> : null}
    </div>
  )
}

/** The date of the form: the one a person picked while DPD still takes it, else tomorrow (or today). */
function courierDate(picked: string, availability: AvailabilityResponse | undefined): string {
  if (!availability) return picked
  return availability.days.includes(picked) ? picked : (defaultCourierDate(availability.days) ?? "")
}

/* ------------------------------------------------------------------ */
/* The drawer                                                          */
/* ------------------------------------------------------------------ */

type DispatchDrawerProps =
  | { lang: string; onClose: () => void; onSettings?: () => void; shipmentIds: string[]; onCreated?: (id: string) => void; dispatchId?: never }
  | { lang: string; onClose: () => void; onSettings?: () => void; dispatchId: string; shipmentIds?: never; onCreated?: never }

/**
 * A handover in a drawer: new (the selected shipments: the plan, the courier,
 * then create, print and order in stages) or one that exists (its view).
 */
export function DispatchDrawer(props: DispatchDrawerProps) {
  return (
    <Drawer open onOpenChange={(open) => (!open ? props.onClose() : undefined)}>
      <Drawer.Content className="max-w-3xl">
        {props.dispatchId !== undefined ? (
          <DispatchView id={props.dispatchId} lang={props.lang} />
        ) : (
          <NewDispatch shipmentIds={props.shipmentIds} lang={props.lang} onSettings={props.onSettings} onCreated={props.onCreated} />
        )}
      </Drawer.Content>
    </Drawer>
  )
}

const STAGE_KEYS = ["dispatch", "protocol", "order"] as const

/** The steps of a run that starts at `from`: the earlier ones done, the rest waiting. */
function stepsFrom(keys: readonly string[], from: number): Record<string, StageState> {
  const steps: Record<string, StageState> = {}
  keys.forEach((k, i) => {
    steps[k] = { status: i < from ? "done" : "queued" }
  })
  return steps
}

/** A new handover: the plan of the selected shipments, the courier, then the run in stages. */
function NewDispatch({ shipmentIds, lang, onSettings, onCreated }: { shipmentIds: string[]; lang: string; onSettings?: () => void; onCreated?: (id: string) => void }) {
  const { t } = useTranslation("dpd")
  const prompt = usePrompt()
  const errorText = useDispatchErrorText()
  const codeText = useErrorCodeText()
  const blockText = useWriterBlockText()
  const dispatchToast = useDispatchToast()
  const [planIds, setPlanIds] = useState<string[]>(shipmentIds)
  /* Once created, the plan is off: the invalidation after each step would read it again for nothing. */
  const [createdId, setCreatedId] = useState<string | null>(null)
  const q = useDpdDispatchPlan(createdId ? null : planIds)
  const create = useDpdCreateDispatch()
  const step = useDpdDispatchStep()
  const [courier, setCourier] = useState(false)
  const [pickedDate, setPickedDate] = useState("")
  const [windowValue, setWindowValue] = useState("")
  const [run, setRun] = useState<StageRun | null>(null)
  /* What the run sends to DPD, fixed at the click: a retry sends the same order. */
  const [order, setOrder] = useState<CourierOrderRequest | null>(null)
  /* Where a run stopped: the stage, the state of the handover in the answer (null after a failed request) and when, so only a later read of the handover replaces it. */
  const [stopped, setStopped] = useState<{ stage: "protocol" | "order"; state: DispatchState | null; at: number } | null>(null)
  const live = useDpdDispatch(stopped ? createdId : null)
  const reported = useRef(false)
  const stageName: Record<(typeof STAGE_KEYS)[number], string> = { dispatch: t("dispatch.stage.dispatch"), protocol: t("dispatch.stage.protocol"), order: t("dispatch.stage.order") }

  /* A plan whose last read failed is neither shown nor confirmed: its hash may be stale. */
  const data = q.isError ? undefined : q.data
  const plan = data?.plan
  const shipmentWriter = data?.writers.shipment
  const block = data ? writerBlock(shipmentWriter, shipmentWriter?.armed ?? false) : null
  const courierStop = data && plan ? courierBlock(data.writers, plan.orderProblems) : null
  const groupKey = plan && plan.groups.length === 1 ? plan.groups[0].key : ""
  const wantsCourier = courier && courierStop === null
  const availability = useDpdGroupAvailability(wantsCourier && groupKey && !createdId ? { shipmentIds: planIds, groupKey } : null)
  const av = availability.isError ? undefined : availability.data
  const date = courierDate(pickedDate, av)
  const choice = av ? (courierWindowChoices(av.ranges, date, av.today, av.nowTime).find((c) => c.value === windowValue) ?? null) : null
  const simulated = data ? data.courierOrders !== "dpd" : false
  const canCreate = Boolean(!q.isError && !q.isFetching && plan?.ok && plan.groups.length <= 1 && block === null && (!wantsCourier || (choice && date)) && !run)

  const stageDefs: StageDef[] = [
    { key: "dispatch", name: stageName.dispatch, short: t("dispatch.stage.dispatchShort"), icon: <HandTruck />, weight: 1 },
    { key: "protocol", name: stageName.protocol, short: t("dispatch.stage.protocolShort"), icon: <DocumentText />, weight: 3 },
    ...(order ? [{ key: "order", name: stageName.order, short: t("dispatch.stage.orderShort"), icon: <TruckFast />, weight: 3 }] : []),
  ]
  const pickupBlock = courierStop?.kind === "writer" ? blockText(writerBlock(courierStop.writer, courierStop.writer.armed) ?? "not_armed", "pickup") : null

  /**
   * Runs the stages from `from`: create, print, order. A stage stops on a
   * refused request, or on an answer whose state is not the expected one
   * (printed, ordered); "Try again" starts at that stage, never at the
   * create (the handover exists by then).
   */
  const runFrom = async (from: 0 | 1 | 2, id: string | null, courierOrder: CourierOrderRequest | null, hash: string) => {
    const keys = courierOrder ? STAGE_KEYS : STAGE_KEYS.slice(0, 2)
    const steps = stepsFrom(keys, from)
    const startedAt = Date.now()
    const show = () => setRun(runFromSteps({ ...steps }, startedAt))
    let dispatchId = id
    setStopped(null)
    for (let i = from; i < keys.length; i++) {
      const key = keys[i]
      const name = stageName[key]
      steps[key] = { status: "running" }
      show()
      try {
        if (key === "dispatch") {
          const res = await create.mutateAsync({ shipmentIds: planIds, planHash: hash, print: false })
          dispatchId = res.dispatch.id
          setCreatedId(dispatchId)
        } else if (key === "protocol" && dispatchId) {
          /* Only a pending handover reaches this stage (handoverStepOf), and a pending one has no protocol yet. */
          const res = await step.mutateAsync({ id: dispatchId, action: "print" })
          dispatchToast(res, "print", 0)
          if (res.dispatch.state !== "printed") throw new StageStop(res.dispatch.errorCode, res.dispatch.state)
        } else if (key === "order" && dispatchId && courierOrder) {
          const res = await step.mutateAsync({ id: dispatchId, action: "order", body: courierOrder })
          dispatchToast(res, "order")
          if (res.dispatch.state !== "ordered") throw new StageStop(res.dispatch.errorCode, res.dispatch.state)
        }
        steps[key] = { status: "done" }
        show()
      } catch (err) {
        /* No handover yet: back to the plan, read again by the invalidation, with the reason in a toast. */
        if (key === "dispatch") {
          toast.error(errorText(err))
          setRun(null)
          return
        }
        const why = err instanceof StageStop ? codeText(err.code) || t("dispatch.error") : errorText(err)
        steps[key] = { status: "error", note: `${t("dispatch.stopped", { stage: name })} ${why}` }
        show()
        setStopped({ stage: key, state: err instanceof StageStop ? err.state : null, at: Date.now() })
        break
      }
    }
    if (dispatchId && !reported.current) {
      reported.current = true
      onCreated?.(dispatchId)
    }
  }

  const onSubmit = async () => {
    if (!plan || !canCreate) return
    const courierOrder = wantsCourier && choice && date ? courierRequestOf(date, choice) : null
    /* Ordering a courier may cost money: always asked. The protocol alone costs nothing. */
    if (courierOrder) {
      const yes = await prompt({
        title: t("dispatch.cost.title"),
        description: t(simulated ? "dispatch.cost.textSimulated" : "dispatch.cost.text", { date: fmtPickupDate(courierOrder.pickupDate, lang), from: courierOrder.pickupTimeFrom, to: courierOrder.pickupTimeTo }),
        confirmText: t("dispatch.cost.confirm"),
        cancelText: t("dispatch.cost.cancel"),
      })
      if (!yes) return
    }
    setOrder(courierOrder)
    await runFrom(0, null, courierOrder, plan.hash)
  }

  /*
   * "Try again" follows the handover as it is now: a read after the stop
   * replaces the state of the answer. Once the handover has moved on (the
   * view's own print, an order made elsewhere) the stopped run is history
   * and its loader goes; the view shows the state and its actions.
   */
  const fresh = live.data && stopped && live.dataUpdatedAt > stopped.at ? live.data.dispatch.state : null
  const nowState = fresh ?? stopped?.state ?? null
  const retryFrom = stopped ? handoverStepOf(nowState, createdId !== null, order !== null) : null
  const movedOn = stoppedRunMovedOn(stopped, fresh, retryFrom)
  const onRetry = () => {
    if (retryFrom === null) return
    void runFrom(retryFrom, createdId, order, plan?.hash ?? "")
  }

  const loader =
    run && !movedOn ? (
      <StagedLoader run={run} stages={stageDefs} doneTitle={t("dispatch.done")} columns={3} onRetry={run.status === "error" && retryFrom !== null ? onRetry : undefined} />
    ) : null

  /* After the create (done or stopped) the drawer shows the handover itself, the stages above it. */
  if (createdId && run && run.status !== "running" && run.status !== "queued") {
    return <DispatchView id={createdId} lang={lang} top={loader} />
  }

  return (
    <>
      <Drawer.Header>
        <Drawer.Title className="flex flex-wrap items-center gap-2">
          {t("dispatch.newTitle")}
          {data?.mode === "demo" ? <ToneBadge tone="blue">{t("demo.badge")}</ToneBadge> : null}
        </Drawer.Title>
        <Drawer.Description>{t("dispatch.subtitle")}</Drawer.Description>
      </Drawer.Header>
      <Drawer.Body className="flex flex-col gap-y-3 overflow-y-auto">
        {loader}
        {!run && q.isLoading ? <KitLoading label={t("dispatch.planLoading")} /> : null}
        {!run && q.isError ? (
          <InlineTip variant="error" label={t("dispatch.planFailed")}>
            {errorText(q.error)}
          </InlineTip>
        ) : null}
        {!run && plan && data ? (
          <PlanParts
            plan={plan}
            lang={lang}
            onPickGroup={(ids) => {
              setPlanIds(ids)
              setPickedDate("")
              setWindowValue("")
            }}
          />
        ) : null}
        {!run && plan && plan.groups.length <= 1 ? (
          <Part title={t("dispatch.courier.toggle")}>
            <CourierToggle checked={courier} disabled={courierStop !== null} onChange={setCourier} />
            {pickupBlock ? (
              <InlineTip variant="warning" label={pickupBlock.title}>
                <span className="flex flex-col gap-y-2">
                  {pickupBlock.hint || t("dispatch.actionError.not_armed")}
                  {onSettings ? (
                    <button type="button" className="txt-compact-small-plus w-fit text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={onSettings}>
                      {t("dispatch.courier.settings")}
                    </button>
                  ) : null}
                </span>
              </InlineTip>
            ) : null}
            {courierStop?.kind === "problems" ? (
              <InlineTip variant="warning" label={t("dispatch.courier.blockedProblems")}>
                <ProblemList items={courierStop.problems} />
              </InlineTip>
            ) : null}
            {data?.courierOrders === "simulated" ? (
              <InlineTip variant="info" label={t("writers.pickupSimulatedLabel")}>
                {t("dispatch.courier.simulated")}
              </InlineTip>
            ) : null}
            {data?.courierOrders === "demo" ? (
              <InlineTip variant="info" label={t("demo.badge")}>
                {t("dispatch.courier.demo")}
              </InlineTip>
            ) : null}
            {wantsCourier && availability.isLoading ? <KitLoading label={t("dispatch.courier.loading")} className="min-h-0 py-3" /> : null}
            {/* No hours from DPD: the courier waits, the protocol does not. The person reads the hours again or prints only; a ticked courier is never dropped quietly. */}
            {wantsCourier && availability.isError ? (
              <InlineTip variant="warning" label={t("dispatch.courier.window")}>
                <span className="flex flex-col gap-y-2">
                  {errorText(availability.error)}
                  <span className="flex flex-wrap gap-2">
                    <Button size="small" variant="secondary" isLoading={availability.isFetching} onClick={() => void availability.refetch()}>
                      {t("dispatch.courier.hoursAgain")}
                    </Button>
                    <Button size="small" variant="secondary" onClick={() => setCourier(false)}>
                      {t("dispatch.courier.printOnly")}
                    </Button>
                  </span>
                </span>
              </InlineTip>
            ) : null}
            {wantsCourier && av ? <CourierWindowFields availability={av} date={date} onDate={setPickedDate} value={windowValue} onValue={setWindowValue} /> : null}
            {wantsCourier && data?.mode === "sandbox" ? (
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("dispatch.courier.testHost")}
              </Text>
            ) : null}
          </Part>
        ) : null}
        {!run && block !== null ? (
          <InlineTip variant={block === "off" ? "warning" : "info"} label={blockText(block, "shipment").title}>
            <span className="flex flex-col gap-y-2">
              {blockText(block, "shipment").hint || t("plan.armHint")}
              {onSettings ? (
                <button type="button" className="txt-compact-small-plus w-fit text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={onSettings}>
                  {t("plan.openSettings")}
                </button>
              ) : null}
            </span>
          </InlineTip>
        ) : null}
      </Drawer.Body>
      <Drawer.Footer>
        <Drawer.Close asChild>
          <Button size="small" variant="secondary">
            {t("plan.cancel")}
          </Button>
        </Drawer.Close>
        <Button size="small" variant="primary" disabled={!canCreate} isLoading={run?.status === "running"} onClick={() => void onSubmit()}>
          <HandTruck />
          {wantsCourier ? t("dispatch.submitCourier") : t("dispatch.submit")}
        </Button>
      </Drawer.Footer>
    </>
  )
}

/** A stage answered 200 with a state other than the one expected: it stops there with the handover's error code and state. */
class StageStop extends Error {
  readonly code: string | null
  readonly state: DispatchState
  constructor(code: string | null, state: DispatchState) {
    super(code ?? "stopped")
    this.name = "StageStop"
    this.code = code
    this.state = state
  }
}

/** The courier checkbox with its hint. */
function CourierToggle({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  const { t } = useTranslation("dpd")
  const id = useId()
  return (
    <div className="flex items-start gap-x-2">
      <Checkbox id={id} checked={checked && !disabled} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span className="flex flex-col gap-y-0.5">
        <Label htmlFor={id} size="small" weight="plus">
          {t("dispatch.courier.toggle")}
        </Label>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {t("dispatch.courier.toggleHint")}
        </Text>
      </span>
    </div>
  )
}

/** The plan of a new handover: its problems, the sender groups, the shipments in and out, the sender, the parcels, the warnings. */
function PlanParts({ plan, lang, onPickGroup }: { plan: DispatchPlanDto; lang: string; onPickGroup: (ids: string[]) => void }) {
  const { t } = useTranslation("dpd")
  const candidates = plan.shipments.filter((s) => s.problems.length === 0)
  const left = plan.shipments.filter((s) => s.problems.length > 0)
  const p = plan.params
  return (
    <>
      {plan.problems.length > 0 ? <ProblemList items={plan.problems} /> : null}
      {plan.groups.length > 1 ? (
        <InlineTip variant="info" label={t("dispatch.sender")}>
          <span className="flex flex-col gap-y-2">
            <span>{t("dispatch.groups", { count: plan.groups.length })}</span>
            <ul className="flex flex-col divide-y divide-ui-border-base">
              {plan.groups.map((g) => (
                <li key={g.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="flex min-w-0 flex-col">
                    <span className="txt-small-plus text-ui-fg-base">{senderLine(g.sender)}</span>
                    <span className="txt-compact-xsmall text-ui-fg-muted">{t("dispatch.groupCount", { count: g.shipmentIds.length })}</span>
                  </span>
                  <Button size="small" variant="secondary" onClick={() => onPickGroup(g.shipmentIds)}>
                    {t("dispatch.groupPick")}
                  </Button>
                </li>
              ))}
            </ul>
          </span>
        </InlineTip>
      ) : null}
      <Part title={t("dispatch.candidates", { count: candidates.length })}>
        <PlanShipmentList shipments={candidates} lang={lang} />
      </Part>
      {left.length > 0 ? (
        <Part title={t("dispatch.left", { count: left.length })}>
          <PlanShipmentList shipments={left} lang={lang} />
          {/* A left out shipment blocks the plan and may have no box in the list any more: the rest goes without it. */}
          {candidates.length > 0 && plan.groups.length <= 1 ? (
            <Button size="small" variant="secondary" className="w-fit" onClick={() => onPickGroup(candidates.map((s) => s.id))}>
              {t("dispatch.leftDrop")}
            </Button>
          ) : null}
        </Part>
      ) : null}
      {plan.sender ? (
        <Part title={t("dispatch.sender")}>
          <AddressLines address={plan.sender} />
        </Part>
      ) : null}
      {p ? (
        <Part title={t("dispatch.params")}>
          <Text size="small" className="text-ui-fg-base">
            {t("dispatch.paramsText", { count: p.count, weight: fmtNumber(p.weightKg, lang), max: fmtNumber(p.maxWeightKg, lang) })}
          </Text>
          {p.dimsKnown ? (
            <Text size="xsmall" className="text-ui-fg-subtle">
              {t("dispatch.paramsDims", { height: fmtNumber(p.maxHeightCm, lang), width: fmtNumber(p.maxWidthCm, lang), depth: fmtNumber(p.maxDepthCm, lang) })}
            </Text>
          ) : null}
        </Part>
      ) : null}
      {plan.warnings.length > 0 ? <ProblemList items={plan.warnings} tone="orange" /> : null}
    </>
  )
}

/** The shipments of a plan, one line each: the order, the waybill, the boxes; the problems of the ones left out. */
function PlanShipmentList({ shipments, lang }: { shipments: DispatchPlanShipmentDto[]; lang: string }) {
  const { t } = useTranslation("dpd")
  if (shipments.length === 0) return null
  return (
    <ul className="flex flex-col divide-y divide-ui-border-base">
      {shipments.map((s) => (
        <li key={s.id} className="flex flex-col gap-y-1 py-1.5 first:pt-0 last:pb-0">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="txt-small-plus text-ui-fg-base">{s.displayId !== null ? `#${s.displayId}` : (s.reference ?? s.id)}</span>
            <span className="txt-compact-xsmall font-mono text-ui-fg-subtle">{s.waybills[0] ?? ""}</span>
            <span className="txt-small tabular-nums text-ui-fg-subtle">{t("dispatch.boxes", { boxes: s.boxes, weight: fmtNumber(s.weightKg, lang) })}</span>
          </span>
          {s.problems.length > 0 ? <ProblemList items={s.problems} /> : null}
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ */
/* One handover                                                        */
/* ------------------------------------------------------------------ */

/** The view of a handover: state, what needs a person, protocols, courier, shipments, history, actions. */
function DispatchView({ id, lang, top }: { id: string; lang: string; top?: ReactNode }) {
  const { t } = useTranslation("dpd")
  const errorText = useDispatchErrorText()
  const courierText = useCourierText()
  const q = useDpdDispatch(id)
  const [form, setForm] = useState<"order" | "reschedule" | null>(null)
  const [resolving, setResolving] = useState(false)
  const res = q.data
  const d = res?.dispatch
  const blockOf = useDispatchBlock(res?.writers)
  const resolveBlock = d ? blockOf("resolve", d.state) : null

  const resolveButton = d?.actions.resolve ? (
    <Button size="small" variant="secondary" className="w-fit" disabled={resolveBlock !== null} title={resolveBlock ?? undefined} onClick={() => setResolving(true)}>
      <QuestionMarkCircle />
      {t("dispatch.actions.resolve")}
    </Button>
  ) : null

  return (
    <>
      <Drawer.Header>
        <Drawer.Title className="flex flex-wrap items-center gap-2">
          {d ? t("dispatch.viewTitle", { time: fmtDateTime(d.createdAt, lang) }) : t("dispatch.title")}
          {d ? <DispatchBadges dispatch={d} /> : null}
        </Drawer.Title>
        <Drawer.Description>{d ? t("dispatch.count", { count: d.shipmentIds.length, boxes: d.boxes, weight: fmtNumber(d.weightKg, lang) }) : ""}</Drawer.Description>
      </Drawer.Header>
      <Drawer.Body className="flex flex-col gap-y-3 overflow-y-auto">
        {top}
        {q.isLoading ? <KitLoading /> : null}
        {q.isError ? (
          <InlineTip variant="error" label={t("dispatch.failed")}>
            {errorText(q.error)}
          </InlineTip>
        ) : null}
        {d && res ? (
          <>
            {isClaimedDispatch(d.state) ? (
              <Text size="small" className="text-ui-fg-subtle">
                {t("dispatch.claimed")}
              </Text>
            ) : null}
            {d.state === "unknown" ? (
              <InlineTip variant="error" label={t("dispatch.state.unknown")}>
                <span className="flex flex-col gap-y-2">
                  {t("dispatch.unknownText")}
                  {resolveButton}
                </span>
              </InlineTip>
            ) : null}
            {d.state === "ordered" && d.attention ? (
              <InlineTip variant="error" label={t("dispatch.attention")}>
                <span className="flex flex-col gap-y-2">
                  {t("dispatch.attentionText")}
                  {resolveButton}
                </span>
              </InlineTip>
            ) : null}
            <DispatchErrorText dispatch={d} />
            {d.problems.length > 0 ? <ProblemList items={d.problems} /> : null}
            {d.warnings.length > 0 ? <ProblemList items={d.warnings} tone="orange" /> : null}
            {form ? <CourierOrderForm dispatch={d} mode={form} onDone={() => setForm(null)} /> : null}

            <Part title={t("dispatch.protocols")}>
              <ProtocolList dispatch={d} lang={lang} />
            </Part>

            <Part title={t("widget.courier")}>
              <Text size="small" className="text-ui-fg-base">
                {courierText(d, lang, DISPATCH_COURIER_WORDS)}
              </Text>
              {d.orderNumber ? (
                <Text size="xsmall" className="font-mono text-ui-fg-subtle">
                  {t("dispatch.orderNumber", { number: d.orderNumber })}
                </Text>
              ) : null}
              {/* Ordered, but no checkSum to change or cancel it with: the way out is the DPD panel, then Resolve (O16). */}
              {d.state === "ordered" && !d.hasCheckSum && !d.attention ? (
                <InlineTip variant="warning" label={t("dispatch.state.ordered")}>
                  <span className="flex flex-col gap-y-2">
                    {t("dispatch.noCheckSum")}
                    {resolveButton}
                  </span>
                </InlineTip>
              ) : null}
            </Part>

            {d.sender ? (
              <Part title={t("dispatch.sender")}>
                <AddressLines address={d.sender} />
              </Part>
            ) : null}

            <Part title={t("dispatch.shipments")}>
              <DispatchShipments dispatch={d} writers={res.writers} lang={lang} />
            </Part>

            {res.events.length > 0 ? (
              <Part title={t("dispatch.historyTitle")}>
                <DispatchHistory events={res.events} lang={lang} />
              </Part>
            ) : null}
          </>
        ) : null}
      </Drawer.Body>
      <Drawer.Footer>
        <Drawer.Close asChild>
          <Button size="small" variant="secondary">
            {t("dispatch.close")}
          </Button>
        </Drawer.Close>
        {d && res ? <DispatchButtons dispatch={d} writers={res.writers} onOrder={() => setForm("order")} onReschedule={() => setForm("reschedule")} onResolve={() => setResolving(true)} /> : null}
      </Drawer.Footer>
      {d && resolving ? <ResolveDispatchDialog dispatch={d} onDone={() => setResolving(false)} /> : null}
    </>
  )
}

/** The stored protocols, newest first, each to open or download. */
function ProtocolList({ dispatch: d, lang }: { dispatch: DispatchDto; lang: string }) {
  const { t } = useTranslation("dpd")
  const errorText = useDispatchErrorText()
  const [busy, setBusy] = useState<string | null>(null)
  if (d.protocols.length === 0) {
    return (
      <Text size="small" className="text-ui-fg-muted">
        {t("dispatch.noProtocol")}
      </Text>
    )
  }
  const open = async (document: string, download: boolean) => {
    setBusy(`${document}:${download ? "d" : "o"}`)
    try {
      await openProtocol(d.id, { download, document })
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setBusy(null)
    }
  }
  const sorted = [...d.protocols].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
  return (
    <ul className="flex flex-col divide-y divide-ui-border-base">
      {sorted.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
          <span className="flex flex-wrap items-center gap-2">
            <Text size="small" className="text-ui-fg-base">
              {t("dispatch.protocolItem", { time: fmtDateTime(p.createdAt, lang), count: p.shipments })}
            </Text>
            {p.stale ? <ToneBadge tone="orange">{t("dispatch.protocolStale")}</ToneBadge> : null}
          </span>
          <span className="flex items-center gap-1.5">
            <Button size="small" variant="secondary" isLoading={busy === `${p.id}:o`} onClick={() => void open(p.id, false)}>
              <Eye />
              {t("dispatch.open")}
            </Button>
            <Button size="small" variant="secondary" isLoading={busy === `${p.id}:d`} onClick={() => void open(p.id, true)}>
              <ArrowDownTray />
              {t("dispatch.download")}
            </Button>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The shipments of a handover with their actions; a shipment whose fulfillment was canceled says so next to its withdraw (E4). */
function DispatchShipments({ dispatch: d, writers, lang }: { dispatch: DispatchDto; writers: Record<WriterKey, WriterDto>; lang: string }) {
  if (d.shipments.length === 0) return null
  return (
    <ul className="flex flex-col divide-y divide-ui-border-base">
      {d.shipments.map((s) => {
        const field = ["shipments", s.id].join(".")
        const own = d.shipmentProblems.filter((p) => p.field === field)
        return (
          <li key={s.id} className="flex flex-col gap-y-2 py-2 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <OrderCell orderId={s.orderId} displayId={s.displayId} />
              <span className="flex flex-col items-end gap-y-1">
                <ShipmentStatus shipment={s} />
                <WaybillCell shipment={s} />
              </span>
            </div>
            {own.length > 0 ? <ProblemList items={own} /> : null}
            {s.handedOverAt ? (
              <Text size="xsmall" className="text-ui-fg-muted">
                {fmtDateTime(s.handedOverAt, lang)}
              </Text>
            ) : null}
            <ShipmentActionBar shipment={s} writerArmed={writers.shipment.armed} writer={writers.shipment} pickupWriter={writers.pickup} dispatch={d} onPlan={() => undefined} />
          </li>
        )
      })}
    </ul>
  )
}

/** The history of a handover, newest first: what the plugin, DPD and a person did. */
function DispatchHistory({ events, lang }: { events: EventDto[]; lang: string }) {
  const { t, i18n } = useTranslation("dpd")
  const sorted = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  const text = (e: EventDto) => {
    const key = e.action ? `dispatch.history.${e.action}` : ""
    if (key && i18n.exists(key, { ns: "dpd" })) return t(key)
    if (e.message) return nb(e.message)
    return e.status ?? t(`history.kinds.${e.kind}`, { defaultValue: e.kind })
  }
  return (
    <ul className="flex flex-col gap-y-2 border-l border-ui-border-base pl-3">
      {sorted.map((e) => (
        <li key={e.id} className="flex flex-col">
          <Text size="xsmall" className="text-ui-fg-muted">
            {fmtDateTime(e.occurredAt, lang)}
            {e.actor ? ` / ${e.actor === "system" ? t("history.system") : e.actor}` : ""}
          </Text>
          <Text size="small" className="text-ui-fg-base">
            {text(e)}
          </Text>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ */
/* The actions of a handover                                           */
/* ------------------------------------------------------------------ */

type DispatchHandlers = { onOrder: () => void; onReschedule: () => void; onResolve: () => void; onOpen?: () => void }

/**
 * Every action of a handover as row actions, each shown only when its state
 * allows it and disabled with the reason when its writer does not write
 * (dispatchActionWriter, E14), plus the main one (dispatchMainAction) and
 * its name for the button. Opening the newest protocol needs no writer.
 */
function useDispatchActions(d: DispatchDto, writers: Record<WriterKey, WriterDto> | undefined, h: DispatchHandlers): { actions: RowAction[]; main: RowAction | null; mainName: string } {
  const { t } = useTranslation("dpd")
  const prompt = usePrompt()
  const errorText = useDispatchErrorText()
  const dispatchToast = useDispatchToast()
  const blockOf = useDispatchBlock(writers)
  const print = useDpdDispatchAction<Record<string, never>>(d.id, "print")
  const cancelCourier = useDpdDispatchAction<Record<string, never>>(d.id, "cancel-courier")
  const cancel = useDpdDispatchAction<Record<string, never>>(d.id, "cancel")
  const [opening, setOpening] = useState(false)

  const call = async (fn: () => Promise<DispatchResponse>, action: "print" | "cancelCourier" | "cancel") => {
    const protocolsBefore = d.protocols.length
    const before = { attention: d.attention, errorCode: d.errorCode }
    try {
      dispatchToast(await fn(), action, protocolsBefore, action === "cancelCourier" ? before : undefined)
    } catch (err) {
      toast.error(errorText(err))
    }
  }
  const onReprint = async () => {
    const yes = await prompt({ title: t("dispatch.reprintPrompt.title"), description: t("dispatch.reprintPrompt.text"), confirmText: t("dispatch.reprintPrompt.confirm"), cancelText: t("plan.cancel") })
    if (yes) await call(() => print.mutateAsync({}), "print")
  }
  const onCancelCourier = async () => {
    const yes = await prompt({ title: t("dispatch.cancelCourierPrompt.title"), description: t("dispatch.cancelCourierPrompt.text", { number: d.orderNumber ?? "-" }), confirmText: t("dispatch.cancelCourierPrompt.confirm"), cancelText: t("plan.cancel") })
    if (yes) await call(() => cancelCourier.mutateAsync({}), "cancelCourier")
  }
  const onCancel = async () => {
    const yes = await prompt({ title: t("dispatch.cancelPrompt.title"), description: t("dispatch.cancelPrompt.text"), confirmText: t("dispatch.cancelPrompt.confirm"), cancelText: t("plan.cancel") })
    if (yes) await call(() => cancel.mutateAsync({}), "cancel")
  }
  /* The newest protocol, opened with the admin's auth like a label. */
  const onProtocol = async () => {
    setOpening(true)
    try {
      await openProtocol(d.id, { download: false, document: latestProtocol(d)?.id })
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setOpening(false)
    }
  }

  const blocked = (action: DispatchWriterAction) => blockOf(action, d.state)
  const named = (name: string, action: DispatchWriterAction) => {
    const why = blocked(action)
    return why ? `${name}: ${why}` : name
  }
  const actions: RowAction[] = [
    { key: "print", label: named(t("dispatch.actions.print"), "print"), icon: <DocumentText />, hidden: !d.actions.print, disabled: blocked("print") !== null, loading: print.isPending, onClick: () => void call(() => print.mutateAsync({}), "print") },
    { key: "reprint", label: named(t("dispatch.actions.reprint"), "reprint"), icon: <ArrowPath />, hidden: !d.actions.reprint, disabled: blocked("reprint") !== null, loading: print.isPending, onClick: () => void onReprint() },
    { key: "protocol", label: t("dispatch.actions.protocol"), icon: <Eye />, hidden: !d.actions.protocol, loading: opening, onClick: () => void onProtocol() },
    { key: "order", label: named(t("dispatch.actions.order"), "order"), icon: <TruckFast />, hidden: !d.actions.order, disabled: blocked("order") !== null, onClick: h.onOrder },
    { key: "reschedule", label: named(t("dispatch.actions.reschedule"), "reschedule"), icon: <Calendar />, hidden: !d.actions.reschedule, disabled: blocked("reschedule") !== null, onClick: h.onReschedule },
    { key: "cancelCourier", label: named(t("dispatch.actions.cancelCourier"), "cancelCourier"), icon: <XCircle />, danger: true, hidden: !d.actions.cancelCourier, disabled: blocked("cancelCourier") !== null, loading: cancelCourier.isPending, onClick: () => void onCancelCourier() },
    { key: "resolve", label: named(t("dispatch.actions.resolve"), "resolve"), icon: <QuestionMarkCircle />, hidden: !d.actions.resolve, disabled: blocked("resolve") !== null, onClick: h.onResolve },
    { key: "cancel", label: named(t("dispatch.actions.cancel"), "cancel"), icon: <XMark />, danger: true, hidden: !d.actions.cancel, disabled: blocked("cancel") !== null, loading: cancel.isPending, onClick: () => void onCancel() },
    { key: "openDispatch", label: t("actions.openDispatch"), icon: <ArrowUpRightOnBox />, hidden: !h.onOpen, onClick: h.onOpen },
  ]
  const mainKey = dispatchMainAction(d)
  const main = mainKey ? (actions.find((a) => a.key === mainKey && !a.hidden) ?? null) : null
  return { actions: actions.filter((a) => a !== main), main, mainName: mainKey ? t(`dispatch.actions.${mainKey}`) : "" }
}

/** The main action of a handover as a button with its name, the others as icons beside it. */
function DispatchButtons({ dispatch, writers, onOrder, onReschedule, onResolve, onOpen }: { dispatch: DispatchDto; writers: Record<WriterKey, WriterDto> | undefined } & DispatchHandlers) {
  const { actions, main, mainName } = useDispatchActions(dispatch, writers, { onOrder, onReschedule, onResolve, onOpen })
  return (
    <span className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      {main ? (
        <Button size="small" variant="secondary" type="button" disabled={main.disabled} isLoading={main.loading} title={main.label} onClick={main.onClick} className="whitespace-nowrap">
          {main.icon}
          {mainName}
        </Button>
      ) : null}
      <RowActions actions={actions} />
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* The courier order                                                   */
/* ------------------------------------------------------------------ */

/**
 * The courier order of a printed handover, or a new date or window of an
 * ordered one: fresh hours from DPD, the date and the window, the cost asked
 * before it is sent, then one stage. A refused window lists its problems
 * under the fields. `dispatch` is the handover as the host reads it now; the
 * order or the change, and its "Try again", stay only while the handover
 * still allows them (courierFormAllowed), so an order that went unknown
 * waits for Resolve and is never sent again from here.
 */
export function CourierOrderForm({ dispatch, mode, onDone }: { dispatch: DispatchDto; mode: "order" | "reschedule"; onDone: () => void }) {
  const { t, i18n } = useTranslation("dpd")
  const lang = i18n.language || "en"
  const prompt = usePrompt()
  const errorText = useDispatchErrorText()
  const codeText = useErrorCodeText()
  const dispatchToast = useDispatchToast()
  const availability = useDpdDispatchAvailability(dispatch.id, true)
  const send = useDpdDispatchAction<CourierOrderRequest>(dispatch.id, mode)
  const [pickedDate, setPickedDate] = useState("")
  const [windowValue, setWindowValue] = useState("")
  const [run, setRun] = useState<StageRun | null>(null)
  const [refused, setRefused] = useState<ProblemDto[]>([])
  const [answer, setAnswer] = useState<DispatchDto | null>(null)
  const allowed = courierFormAllowed(mode, dispatch, answer)
  const av = availability.isError ? undefined : availability.data
  const date = courierDate(pickedDate, av)
  const choice = av ? (courierWindowChoices(av.ranges, date, av.today, av.nowTime).find((c) => c.value === windowValue) ?? null) : null
  const stage: StageDef = { key: "order", name: mode === "order" ? t("dispatch.stage.order") : t("dispatch.stage.reschedule"), short: t("dispatch.stage.orderShort"), icon: <TruckFast />, weight: 1 }

  const onSubmit = async () => {
    if (!choice || !date || !allowed) return
    const body = courierRequestOf(date, choice)
    const yes = await prompt({
      title: mode === "order" ? t("dispatch.cost.title") : t("dispatch.rescheduleTitle"),
      description: t(dispatch.simulated ? "dispatch.cost.textSimulated" : "dispatch.cost.text", { date: fmtPickupDate(body.pickupDate, lang), from: body.pickupTimeFrom, to: body.pickupTimeTo }),
      confirmText: mode === "order" ? t("dispatch.cost.confirm") : t("dispatch.rescheduleSubmit"),
      cancelText: t("dispatch.cost.cancel"),
    })
    if (!yes) return
    const startedAt = Date.now()
    const before = { attention: dispatch.attention, errorCode: dispatch.errorCode }
    setRefused([])
    setRun(runFromSteps({ order: { status: "running" } }, startedAt))
    try {
      const res = await send.mutateAsync(body)
      setAnswer(res.dispatch)
      dispatchToast(res, mode, 0, before)
      if (res.dispatch.state === "ordered" && !res.dispatch.errorCode) {
        setRun(null)
        onDone()
        return
      }
      setRun(runFromSteps({ order: { status: "error", note: `${t("dispatch.stopped", { stage: stage.name })} ${codeText(changeReasonCode(before, res.dispatch)) || t("dispatch.error")}` } }, startedAt))
    } catch (err) {
      if (err instanceof DpdRequestError && err.code === "courier_window") setRefused(err.problems)
      setRun(runFromSteps({ order: { status: "error", note: `${t("dispatch.stopped", { stage: stage.name })} ${errorText(err)}` } }, startedAt))
    }
  }

  return (
    <Part title={mode === "order" ? t("dispatch.orderTitle") : t("dispatch.rescheduleTitle")}>
      {run ? <StagedLoader run={run} stages={[stage]} columns={3} onRetry={run.status === "error" && allowed ? () => void onSubmit() : undefined} /> : null}
      {availability.isLoading ? <KitLoading label={t("dispatch.courier.loading")} className="min-h-0 py-3" /> : null}
      {availability.isError ? (
        <InlineTip variant="warning" label={t("dispatch.courier.window")}>
          {errorText(availability.error)}
        </InlineTip>
      ) : null}
      {av ? <CourierWindowFields availability={av} date={date} onDate={setPickedDate} value={windowValue} onValue={setWindowValue} refused={refused} /> : null}
      {dispatch.simulated ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {dispatch.mode === "demo" ? t("dispatch.courier.demo") : t("dispatch.courier.simulated")}
        </Text>
      ) : null}
      <span className="flex flex-wrap items-center justify-end gap-2">
        <Button size="small" variant="secondary" onClick={onDone}>
          {t("dispatch.cost.cancel")}
        </Button>
        <Button size="small" variant="primary" disabled={!allowed || !choice || !date || send.isPending} isLoading={send.isPending} onClick={() => void onSubmit()}>
          {mode === "order" ? <TruckFast /> : <Calendar />}
          {mode === "order" ? t("dispatch.actions.order") : t("dispatch.rescheduleSubmit")}
        </Button>
      </span>
    </Part>
  )
}

/**
 * The courier form in a drawer of its own, for the order and change buttons
 * of the handover list. It reads the handover by its id, like the view, so
 * the form always gets it as it is now, never the row of the click.
 */
function CourierOrderDrawer({ id, mode, onClose }: { id: string; mode: "order" | "reschedule"; onClose: () => void }) {
  const { t, i18n } = useTranslation("dpd")
  const lang = i18n.language || "en"
  const errorText = useDispatchErrorText()
  const q = useDpdDispatch(id)
  const d = q.data?.dispatch
  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content className="max-w-xl">
        <Drawer.Header>
          <Drawer.Title>{mode === "order" ? t("dispatch.orderTitle") : t("dispatch.rescheduleTitle")}</Drawer.Title>
          <Drawer.Description>{d ? t("dispatch.count", { count: d.shipmentIds.length, boxes: d.boxes, weight: fmtNumber(d.weightKg, lang) }) : ""}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-3 overflow-y-auto">
          {q.isLoading ? <KitLoading /> : null}
          {q.isError ? (
            <InlineTip variant="error" label={t("dispatch.failed")}>
              {errorText(q.error)}
            </InlineTip>
          ) : null}
          {d ? <CourierOrderForm dispatch={d} mode={mode} onDone={onClose} /> : null}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}

/* ------------------------------------------------------------------ */
/* Resolve                                                             */
/* ------------------------------------------------------------------ */

/**
 * What a person found in the DPD panel for a handover without a clear
 * answer (DS7, O13, O16): the courier is ordered (with its number when
 * known), or there is no courier order in DPD. The plugin asks DPD nothing.
 */
export function ResolveDispatchDialog({ dispatch, onDone }: { dispatch: DispatchDto; onDone: () => void }) {
  const { t } = useTranslation("dpd")
  const errorText = useDispatchErrorText()
  const dispatchToast = useDispatchToast()
  const resolve = useDpdDispatchAction<{ outcome: "ordered" | "not_ordered"; orderNumber?: string }>(dispatch.id, "resolve")
  const [outcome, setOutcome] = useState<"ordered" | "not_ordered">("ordered")
  const [orderNumber, setOrderNumber] = useState(dispatch.orderNumber ?? "")
  const orderedId = useId()
  const notOrderedId = useId()
  const numberId = useId()

  const onConfirm = async () => {
    const number = orderNumber.trim()
    try {
      const res = await resolve.mutateAsync(outcome === "ordered" && number ? { outcome, orderNumber: number } : { outcome })
      dispatchToast(res, "resolve")
      onDone()
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  return (
    <Prompt open variant="confirmation" onOpenChange={(open) => (!open ? onDone() : undefined)}>
      <Prompt.Content>
        <Prompt.Header>
          <Prompt.Title>{t("dispatch.resolve.title")}</Prompt.Title>
          <Prompt.Description>{t("dispatch.resolve.text")}</Prompt.Description>
        </Prompt.Header>
        <div className="flex flex-col gap-y-3 px-6 pb-4">
          <RadioGroup value={outcome} onValueChange={(v) => setOutcome(v === "not_ordered" ? "not_ordered" : "ordered")} className="flex flex-col gap-y-3">
            <div className="flex items-center gap-x-2">
              <RadioGroup.Item value="ordered" id={orderedId} />
              <Label htmlFor={orderedId} size="small">
                {t("dispatch.resolve.ordered")}
              </Label>
            </div>
            {outcome === "ordered" ? (
              <div className="flex flex-col gap-y-1 pl-6">
                <Label htmlFor={numberId} size="xsmall" className="text-ui-fg-subtle">
                  {t("dispatch.resolve.orderNumber")}
                </Label>
                <Input id={numberId} size="small" className="w-56 font-mono" maxLength={40} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
              </div>
            ) : null}
            <div className="flex items-center gap-x-2">
              <RadioGroup.Item value="not_ordered" id={notOrderedId} />
              <Label htmlFor={notOrderedId} size="small">
                {t("dispatch.resolve.notOrdered")}
              </Label>
            </div>
          </RadioGroup>
        </div>
        <Prompt.Footer>
          <Prompt.Cancel>{t("plan.cancel")}</Prompt.Cancel>
          <Button size="small" variant="primary" isLoading={resolve.isPending} onClick={() => void onConfirm()}>
            {t("dispatch.resolve.confirm")}
          </Button>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  )
}

/* ------------------------------------------------------------------ */
/* The handover list of the panel                                      */
/* ------------------------------------------------------------------ */

const FILTER_ICON: Record<DispatchFilter, ReactNode> = {
  open: <HandTruck />,
  attention: <QuestionMarkCircle />,
  all: <ListBullet />,
}

/**
 * The handovers of the current mode, newest first, by filter (open, needs a
 * person, all). Each row has its main action as a button and the others as
 * icons, with the same writer rules as the drawer; a click on the row opens
 * it.
 */
export function DispatchesSection({ filter, onFilter, onOpen }: { filter: DispatchFilter; onFilter: (f: DispatchFilter) => void; onOpen: (id: string) => void }) {
  const { t, i18n } = useTranslation("dpd")
  const lang = i18n.language || "en"
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter])
  const list = useDpdDispatches({ filter, offset: page * DISPATCH_PAGE, limit: DISPATCH_PAGE })
  /* After an action shrank the list below this page, the last page that has rows. */
  const total = list.data?.count
  useEffect(() => {
    if (total !== undefined) setPage((p) => pageInRange(p, total, DISPATCH_PAGE))
  }, [total])
  const status = useDpdStatus()
  const writers = status.data?.writers
  const rows = list.data?.dispatches ?? []
  const count = list.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / DISPATCH_PAGE))
  const counts: Record<DispatchFilter, number | null> = { open: list.data?.open ?? null, attention: list.data?.attention ?? null, all: filter === "all" ? count : null }
  /* Only the id: the drawer reads the handover itself, so the form never works on the row of the click. */
  const [form, setForm] = useState<{ id: string; mode: "order" | "reschedule" } | null>(null)
  const [resolving, setResolving] = useState<DispatchDto | null>(null)

  return (
    <Section id="dpd-dispatches" icon={<HandTruck />} title={t("dispatch.title")} description={t("dispatch.subtitle")}>
      <FilterBar>
        {DISPATCH_FILTERS.map((f) => (
          <FilterButton key={f} icon={FILTER_ICON[f]} label={t(`dispatch.filter.${f}`)} count={counts[f]} attention={f === "attention"} active={filter === f} onClick={() => onFilter(f)} />
        ))}
      </FilterBar>
      <KitFetchingBar active={list.isFetching && !list.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("dispatch.col.created")}</Table.HeaderCell>
              <Table.HeaderCell>{t("dispatch.col.sender")}</Table.HeaderCell>
              <Table.HeaderCell>{t("dispatch.col.shipments")}</Table.HeaderCell>
              <Table.HeaderCell>{t("dispatch.col.protocol")}</Table.HeaderCell>
              <Table.HeaderCell>{t("dispatch.col.courier")}</Table.HeaderCell>
              <Table.HeaderCell>{t("dispatch.col.state")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("dispatch.col.actions")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.isLoading ? <KitSkeletonRows cols={7} rows={3} /> : null}
            {!list.isLoading && list.isError ? <EmptyTableRow cols={7} icon={<HandTruck />} title={t("dispatch.failed")} /> : null}
            {!list.isLoading && !list.isError && rows.length === 0 ? (
              <EmptyTableRow
                cols={7}
                icon={FILTER_ICON[filter]}
                title={filter === "all" ? t("dispatch.emptyAll") : t("dispatch.empty")}
                points={filter === "all" ? [{ icon: <HandTruck />, text: t("dispatch.emptyHint") }] : undefined}
              />
            ) : null}
            {rows.map((d) => (
              <DispatchRow
                key={d.id}
                dispatch={d}
                writers={writers}
                lang={lang}
                onOpen={() => onOpen(d.id)}
                onOrder={() => setForm({ id: d.id, mode: "order" })}
                onReschedule={() => setForm({ id: d.id, mode: "reschedule" })}
                onResolve={() => setResolving(d)}
              />
            ))}
          </Table.Body>
        </Table>
      </div>
      <Table.Pagination
        count={count}
        pageSize={DISPATCH_PAGE}
        pageIndex={page}
        pageCount={pageCount}
        canPreviousPage={page > 0}
        canNextPage={page + 1 < pageCount}
        previousPage={() => setPage((x) => Math.max(0, x - 1))}
        nextPage={() => setPage((x) => x + 1)}
        translations={{ of: t("pagination.of"), results: t("pagination.results"), pages: t("pagination.pages"), prev: t("pagination.prev"), next: t("pagination.next") }}
      />
      {form ? <CourierOrderDrawer id={form.id} mode={form.mode} onClose={() => setForm(null)} /> : null}
      {resolving ? <ResolveDispatchDialog dispatch={resolving} onDone={() => setResolving(null)} /> : null}
    </Section>
  )
}

/** One handover of the list. */
function DispatchRow({ dispatch: d, writers, lang, onOpen, onOrder, onReschedule, onResolve }: { dispatch: DispatchDto; writers: Record<WriterKey, WriterDto> | undefined; lang: string; onOpen: () => void } & Omit<DispatchHandlers, "onOpen">) {
  const { t } = useTranslation("dpd")
  const courierText = useCourierText()
  const protocol = latestProtocol(d)
  return (
    <Table.Row className="cursor-pointer align-top [&_td]:py-2.5" onClick={onOpen}>
      <Table.Cell className="whitespace-nowrap">{fmtDateTime(d.createdAt, lang)}</Table.Cell>
      <Table.Cell className="max-w-[220px]">
        <span className="txt-small truncate text-ui-fg-base">{senderLine(d.sender)}</span>
      </Table.Cell>
      <Table.Cell className="whitespace-nowrap">
        <Text size="small">{t("dispatch.count", { count: d.shipmentIds.length, boxes: d.boxes, weight: fmtNumber(d.weightKg, lang) })}</Text>
      </Table.Cell>
      <Table.Cell>
        {protocol ? (
          <span className="flex flex-col items-start gap-y-1">
            <Text size="small">{fmtDateTime(protocol.createdAt, lang)}</Text>
            {protocol.stale ? <ToneBadge tone="orange">{t("dispatch.protocolStale")}</ToneBadge> : null}
          </span>
        ) : (
          <Text size="small" className="text-ui-fg-muted">
            {t("dispatch.noProtocol")}
          </Text>
        )}
      </Table.Cell>
      <Table.Cell>
        <span className="flex flex-col gap-y-0.5">
          <Text size="small" className={clx(!d.pickupDate && "text-ui-fg-muted")}>
            {courierText(d, lang, DISPATCH_COURIER_WORDS)}
          </Text>
          {d.orderNumber ? (
            <Text size="xsmall" className="font-mono text-ui-fg-subtle">
              {d.orderNumber}
            </Text>
          ) : null}
        </span>
      </Table.Cell>
      <Table.Cell>
        <span className="flex max-w-[260px] flex-col items-start gap-y-1">
          <DispatchBadges dispatch={d} />
          <DispatchErrorText dispatch={d} />
        </span>
      </Table.Cell>
      <Table.Cell className="text-right">
        <DispatchButtons dispatch={d} writers={writers} onOrder={onOrder} onReschedule={onReschedule} onResolve={onResolve} onOpen={onOpen} />
      </Table.Cell>
    </Table.Row>
  )
}
