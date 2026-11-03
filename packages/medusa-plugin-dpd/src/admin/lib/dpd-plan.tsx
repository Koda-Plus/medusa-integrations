import { useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowDownTray, ArrowRightOnRectangle, CheckCircle, DocumentText, MagnifyingGlass, MapPin, PaperPlane, Plus, Trash } from "@medusajs/icons"
import { Button, Drawer, IconButton, InlineTip, Input, Text, clx, toast, usePrompt } from "@medusajs/ui"
import type { BoxDto, LabelPage, PlanAddressDto, PlanDto, PlanPudoReceiverDto, PointDto, ShipmentDto, WriterDto } from "../../modules/dpd/lib/contract"
import { WRITER_OPTION } from "../../modules/dpd/lib/writers"
import {
  DpdRequestError,
  errorMessage,
  openLabel,
  useDpdAccept,
  useDpdBoxes,
  useDpdCreate,
  useDpdFetchLabel,
  useDpdLookup,
  useDpdPlan,
  useDpdSkip,
} from "./dpd-api"
import { RowActions, ToneBadge, type RowAction } from "./dpd-blocks"
import { nb } from "./dpd-guide"
import { KitLoading } from "./dpd-kit"
import { answerProblems, boxFieldErrors, canChangePoint, isBoxField, writerBlock, type BoxFieldError } from "./dpd-logic"
import { PointCard, PointChangeDialog, PointPicker } from "./dpd-point"
import { ErrorText, Fact, KindBadges, ProblemList, fmtMoney, fmtNumber } from "./dpd-ui"

/** The label pages a person can pick for the create action. */
const PAGES: readonly LabelPage[] = ["A4", "LBL_PRINTER"]

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** The text of a refused action: the dictionary's words for its code, else the server's message. */
export function useActionErrorText(): (err: unknown) => string {
  const { t, i18n } = useTranslation("dpd")
  return (err) => {
    const code = err instanceof DpdRequestError ? err.code : null
    const key = code ? `actionError.${code}` : ""
    return key && i18n.exists(key, { ns: "dpd" }) ? t(key) : nb(errorMessage(err))
  }
}

/**
 * Why the shipment writer does not write, in words: the options turn it off
 * (arming would not help, so the hint names the option) or nobody armed it.
 */
function useWriterBlockText(): (block: "off" | "not_armed") => { title: string; hint: string } {
  const { t } = useTranslation("dpd")
  return (block) =>
    block === "off"
      ? { title: t("actionError.writer_off"), hint: t("writers.blockedHint", { option: `${WRITER_OPTION.shipment}: true` }) }
      : { title: t("actionError.not_armed"), hint: "" }
}

/**
 * The toast after an action that reached DPD (or the demo client): the answer
 * is a row in its new state, and a refusal or an unclear answer is a state,
 * not an error of the request. The words of the row's error code, when it
 * has one, go under the title.
 */
function useShipmentToast(): (row: ShipmentDto, done: string) => void {
  const { t, i18n } = useTranslation("dpd")
  return (row, done) => {
    const key = row.errorCode ? `errorCode.${row.errorCode}` : ""
    const props = key && i18n.exists(key, { ns: "dpd" }) ? { description: t(key) } : undefined
    if (row.state === "labeled") toast.success(done, props)
    else if (row.state === "created") toast.warning(t("toast.createdNoLabel"), props)
    else if (row.state === "failed") toast.error(t("toast.refused"), props)
    else if (row.state === "unknown") toast.warning(t("toast.unclear"), props)
    else if (row.state === "ambiguous") toast.warning(t("toast.ambiguous"), props)
    else if (row.state === "abandoned_unknown") toast.warning(done, props)
    else toast.success(done, props)
  }
}

/** The current time, ticking while `active` (for an action that waits until a moment). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

function fmtTime(value: string, lang: string): string {
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return value
  try {
    return new Intl.DateTimeFormat(lang, { timeStyle: "short" }).format(d)
  } catch {
    return d.toISOString().slice(11, 16)
  }
}

/** kg with up to two decimals, in the admin's format. */
function fmtKg(kg: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(kg)
  } catch {
    return String(kg)
  }
}

/* ------------------------------------------------------------------ */
/* The plan: read it, then create                                      */
/* ------------------------------------------------------------------ */

/** One part of the plan in the drawer: a small heading over its facts. */
function PlanPart({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
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

/** A receiver or a sender as DPD gets it: who, where, how to reach. */
function AddressLines({ address: a }: { address: PlanAddressDto }) {
  const { t } = useTranslation("dpd")
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col">
        {a.company ? <span className="txt-small-plus text-ui-fg-base">{nb(a.company)}</span> : null}
        {a.name ? <span className="txt-small text-ui-fg-base">{nb(a.name)}</span> : null}
        <span className="txt-small text-ui-fg-subtle">{nb(a.address)}</span>
        <span className="txt-small text-ui-fg-subtle">{nb(`${a.postalCode} ${a.city}, ${a.countryCode}`)}</span>
      </div>
      <div className="flex min-w-0 flex-col">
        <span className={clx("txt-small", a.phone ? "font-mono text-ui-fg-base" : "text-ui-fg-muted")}>{a.phone ?? t("plan.noPhone")}</span>
        <span className={clx("txt-small break-all", a.email ? "font-mono text-ui-fg-base" : "text-ui-fg-muted")}>{a.email ?? t("plan.noEmail")}</span>
      </div>
    </div>
  )
}

/** Who collects at a Pickup point, as DPD gets it: the name (the company when there is no name), the phone or the e-mail for the notice. */
function PudoReceiverLines({ receiver: r }: { receiver: PlanPudoReceiverDto }) {
  const { t } = useTranslation("dpd")
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col">
        {r.company ? <span className="txt-small-plus text-ui-fg-base">{nb(r.company)}</span> : null}
        <span className="txt-small text-ui-fg-base">{nb(r.name)}</span>
      </div>
      <div className="flex min-w-0 flex-col">
        <span className={clx("txt-small", r.phone ? "font-mono text-ui-fg-base" : "text-ui-fg-muted")}>{r.phone ?? t("plan.noPhone")}</span>
        <span className={clx("txt-small break-all", r.email ? "font-mono text-ui-fg-base" : "text-ui-fg-muted")}>{r.email ?? t("plan.noEmail")}</span>
      </div>
    </div>
  )
}

/** The boxes of a plan, one line each, with the total and where they come from. */
function BoxLines({ boxes, lang }: { boxes: BoxDto[]; lang: string }) {
  const { t } = useTranslation("dpd")
  const side = (v: number | null) => (v === null ? "-" : fmtNumber(v, lang))
  return (
    <ul className="flex flex-col divide-y divide-ui-border-base">
      {boxes.map((b, i) => (
        <li key={b.reference ?? i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 first:pt-0 last:pb-0">
          <span className="txt-small-plus text-ui-fg-base">{t("plan.box", { n: i + 1 })}</span>
          <span className="txt-small tabular-nums text-ui-fg-subtle">
            {`${fmtKg(b.weightKg, lang)} kg`}
            {b.lengthCm !== null || b.widthCm !== null || b.heightCm !== null ? `, ${t("plan.dims", { l: side(b.lengthCm), w: side(b.widthCm), h: side(b.heightCm) })}` : ""}
          </span>
          {b.reference ? <span className="txt-compact-xsmall w-full font-mono text-ui-fg-muted">{b.reference}</span> : null}
        </li>
      ))}
    </ul>
  )
}

type BoxRow = { key: number; weightKg: string; lengthCm: string; widthCm: string; heightCm: string }

const sideText = (v: number | null): string => (v === null ? "" : String(v))

/**
 * The boxes set by hand: weight and the three sides of each, add and remove
 * (1 to 100), save, or go back to the boxes the plan computes. The server
 * checks the values; a 400 lists the fields it refused.
 */
export function BoxesEditor({ shipmentId, boxes, edited, onDone }: { shipmentId: string; boxes: BoxDto[]; edited: boolean; onDone: () => void }) {
  const { t } = useTranslation("dpd")
  const errorText = useActionErrorText()
  const save = useDpdBoxes()
  const [next, setNext] = useState(boxes.length + 1)
  const [rows, setRows] = useState<BoxRow[]>(() =>
    boxes.length > 0
      ? boxes.map((b, i) => ({ key: i, weightKg: String(b.weightKg), lengthCm: sideText(b.lengthCm), widthCm: sideText(b.widthCm), heightCm: sideText(b.heightCm) }))
      : [{ key: 0, weightKg: "", lengthCm: "", widthCm: "", heightCm: "" }],
  )
  /* A 400: the server's message, and the refused fields when it names them (box index, field). */
  const [refused, setRefused] = useState<{ message: string; fields: BoxFieldError[] } | null>(null)

  const change = (key: number, field: Exclude<keyof BoxRow, "key">, value: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)))
  /* Adding or removing a box shifts the indexes a refusal points at, so the refusal goes. */
  const add = () => {
    setRefused(null)
    setRows((rs) => (rs.length >= 100 ? rs : [...rs, { key: next, weightKg: "", lengthCm: "", widthCm: "", heightCm: "" }]))
    setNext((n) => n + 1)
  }
  const remove = (key: number) => {
    setRefused(null)
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.key !== key)))
  }
  const orNull = (v: string) => (v.trim() === "" ? null : v.trim())

  const submit = async (manual: boolean) => {
    setRefused(null)
    try {
      await save.mutateAsync({
        id: shipmentId,
        boxes: manual ? rows.map((r) => ({ weightKg: r.weightKg.trim(), lengthCm: orNull(r.lengthCm), widthCm: orNull(r.widthCm), heightCm: orNull(r.heightCm) })) : null,
      })
      toast.success(t("toast.boxesSaved"))
      onDone()
    } catch (err) {
      if (err instanceof DpdRequestError && err.status === 400) setRefused({ message: nb(err.message), fields: boxFieldErrors(err.body) })
      else toast.error(errorText(err))
    }
  }

  const fields = [
    ["weightKg", t("plan.weightKg")],
    ["lengthCm", t("plan.lengthCm")],
    ["widthCm", t("plan.widthCm")],
    ["heightCm", t("plan.heightCm")],
  ] as const
  const fieldName = (field: string) => (isBoxField(field) ? t(`plan.boxFields.${field}`) : field)
  const isRefused = (index: number, field: string) => Boolean(refused?.fields.some((f) => f.index === index && f.field === field))

  /* A row: the four values in a grid (2 by 2 on a phone, one line from sm) and the remove button beside it. */
  return (
    <div className="flex flex-col gap-y-2">
      <div className="hidden items-center gap-2 sm:flex">
        <div className="grid flex-1 grid-cols-4 gap-2">
          {fields.map(([f, label]) => (
            <Text key={f} size="xsmall" className="text-ui-fg-muted">
              {label}
            </Text>
          ))}
        </div>
        <span className="w-7 shrink-0" />
      </div>
      {rows.map((r, i) => (
        <div key={r.key} className={clx("flex flex-col gap-y-1", i > 0 && "border-ui-border-base max-sm:border-t max-sm:pt-2")}>
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle sm:hidden">
            {t("plan.box", { n: i + 1 })}
          </Text>
          <div className="flex items-start gap-2">
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
              {fields.map(([f, label]) => (
                <label key={f} className="flex min-w-0 flex-col gap-y-1">
                  <span className="txt-compact-xsmall text-ui-fg-muted sm:hidden">{label}</span>
                  <Input
                    size="small"
                    inputMode="decimal"
                    aria-label={`${t("plan.box", { n: i + 1 })}: ${label}`}
                    aria-invalid={isRefused(i, f) || undefined}
                    placeholder={label}
                    value={r[f]}
                    onChange={(e) => change(r.key, f, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <IconButton size="small" variant="transparent" type="button" className="shrink-0 max-sm:mt-5" title={t("plan.removeBox")} aria-label={t("plan.removeBox")} disabled={rows.length <= 1} onClick={() => remove(r.key)}>
              <Trash />
            </IconButton>
          </div>
        </div>
      ))}
      {refused ? (
        <InlineTip variant="error" label={t("actionError.invalid")}>
          {refused.fields.length > 0 ? (
            <ul className="flex flex-col gap-y-0.5">
              {refused.fields.map((f) => (
                <li key={`${f.index}-${f.field}`}>{`${t("plan.box", { n: f.index + 1 })}: ${fieldName(f.field)}`}</li>
              ))}
            </ul>
          ) : (
            refused.message
          )}
        </InlineTip>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="small" variant="secondary" type="button" disabled={rows.length >= 100} onClick={add}>
          <Plus />
          {t("plan.addBox")}
        </Button>
        <Button size="small" variant="primary" type="button" isLoading={save.isPending && save.variables?.boxes !== null} onClick={() => void submit(true)}>
          {t("plan.saveBoxes")}
        </Button>
        {edited ? (
          <Button size="small" variant="secondary" type="button" isLoading={save.isPending && save.variables?.boxes === null} onClick={() => void submit(false)}>
            {t("plan.resetBoxes")}
          </Button>
        ) : null}
        <Button size="small" variant="transparent" type="button" onClick={onDone}>
          {t("plan.cancel")}
        </Button>
      </div>
    </div>
  )
}

/**
 * The plan as DPD will get it: problems first, then who, what, how much, and
 * the raw request on demand. A Pickup plan shows the point read now and who
 * collects there instead of the courier receiver; with `pointChange` the
 * point part has the change button, which opens the search in place and the
 * confirmation over it.
 */
export function PlanBody({ plan, shipment, lang, pointChange = false }: { plan: PlanDto; shipment: ShipmentDto; lang: string; pointChange?: boolean }) {
  const { t } = useTranslation("dpd")
  const errorText = useActionErrorText()
  const [showRequest, setShowRequest] = useState(false)
  const [editing, setEditing] = useState(false)
  /* The point search is open; the point chosen in it waits for the confirmation. */
  const [picking, setPicking] = useState(false)
  const [next, setNext] = useState<PointDto | null>(null)
  /* What DPD said at the last attempt: dpd_* and the Pickup problems DPD gave with the plan codes (source "dpd"). */
  const dpdProblems = answerProblems(shipment.problems)
  const pickup = plan.point !== null || plan.kind === "pickup"
  return (
    <div className="flex flex-col gap-y-3">
      {plan.problems.length > 0 ? (
        <InlineTip variant="error" label={t("plan.problems")}>
          <ProblemList items={plan.problems} />
        </InlineTip>
      ) : null}
      {shipment.state === "failed" || dpdProblems.length > 0 ? (
        <InlineTip variant="warning" label={t("plan.dpdProblems")}>
          <span className="flex flex-col gap-y-1">
            <ErrorText shipment={shipment} />
            <ProblemList items={dpdProblems} />
          </span>
        </InlineTip>
      ) : null}
      {pickup ? (
        <>
          <PlanPart
            title={t("plan.point")}
            badge={
              pointChange && !picking ? (
                <Button size="small" variant="secondary" type="button" onClick={() => setPicking(true)}>
                  <MapPin />
                  {t("pudo.change")}
                </Button>
              ) : undefined
            }
          >
            {plan.point ? (
              <PointCard point={plan.point.point} pudoId={plan.point.pudoId} check={plan.point.check} reason={plan.point.reason} source={plan.point.source} lang={lang} />
            ) : (
              <Text size="small" className="text-ui-fg-muted">
                -
              </Text>
            )}
            {picking ? (
              <div className="border-t border-ui-border-base pt-3">
                <PointPicker cod={plan.cod} currentId={plan.point?.pudoId ?? null} lang={lang} errorText={errorText} onPick={setNext} onCancel={() => setPicking(false)} />
              </div>
            ) : null}
          </PlanPart>
          <PlanPart title={t("plan.pudoReceiver")}>{plan.pudoReceiver ? <PudoReceiverLines receiver={plan.pudoReceiver} /> : <Text size="small" className="text-ui-fg-muted">-</Text>}</PlanPart>
        </>
      ) : (
        <PlanPart title={t("plan.receiver")}>{plan.receiver ? <AddressLines address={plan.receiver} /> : <Text size="small" className="text-ui-fg-muted">-</Text>}</PlanPart>
      )}
      <PlanPart title={t("plan.sender")} badge={plan.senderLocationId ? <ToneBadge>{t("plan.senderLocation", { id: plan.senderLocationId })}</ToneBadge> : undefined}>
        {plan.sender ? <AddressLines address={plan.sender} /> : <Text size="small" className="text-ui-fg-muted">-</Text>}
      </PlanPart>
      <PlanPart title={t("plan.boxes")} badge={<ToneBadge tone={plan.boxesSource === "none" ? "red" : "grey"}>{t(`plan.source.${plan.boxesSource}`)}</ToneBadge>}>
        {editing ? (
          <BoxesEditor shipmentId={shipment.id} boxes={plan.boxes} edited={plan.boxesSource === "edited"} onDone={() => setEditing(false)} />
        ) : (
          <>
            {plan.boxes.length > 0 ? <BoxLines boxes={plan.boxes} lang={lang} /> : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Text size="small" weight="plus" className="tabular-nums">
                {t("plan.total", { kg: fmtKg(plan.weightKg, lang) })}
              </Text>
              {shipment.actions.boxes ? (
                <Button size="small" variant="secondary" type="button" onClick={() => setEditing(true)}>
                  {t("plan.editBoxes")}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </PlanPart>
      <PlanPart title={t("plan.cod")}>
        <Text size="small" weight={plan.codAmount ? "plus" : "regular"} className={plan.codAmount ? "tabular-nums text-ui-fg-base" : "text-ui-fg-muted"}>
          {plan.codAmount ? fmtMoney(plan.codAmount.amount, plan.codAmount.currency, lang) : t("plan.codNone")}
        </Text>
      </PlanPart>
      <PlanPart title={t("plan.reference")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fact label={t("plan.reference")} mono>
            {plan.reference}
          </Fact>
          <Fact label={t("plan.session")}>{plan.sessionType ? t(`plan.sessionTypes.${plan.sessionType}`) : "-"}</Fact>
        </div>
      </PlanPart>
      {plan.warnings.length > 0 ? (
        <PlanPart title={t("plan.warnings")}>
          <ProblemList items={plan.warnings} tone="orange" />
        </PlanPart>
      ) : null}
      {plan.request ? (
        <div className="flex flex-col gap-y-2">
          <Button size="small" variant="transparent" type="button" className="w-fit" onClick={() => setShowRequest(!showRequest)}>
            {showRequest ? t("plan.hideRequest") : t("plan.showRequest")}
          </Button>
          {showRequest ? (
            <pre className="max-h-[40vh] overflow-auto rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-2 font-mono text-[11px] leading-[18px] text-ui-fg-subtle">{JSON.stringify(plan.request, null, 2)}</pre>
          ) : null}
        </div>
      ) : null}
      {next ? (
        <PointChangeDialog
          shipmentId={shipment.id}
          current={plan.point}
          next={next}
          errorText={errorText}
          onClose={() => setNext(null)}
          onDone={() => {
            /* The drawer already has the new plan from the answer. */
            setNext(null)
            setPicking(false)
          }}
        />
      ) : null}
    </div>
  )
}

/** The label page of the create action: a sheet or the label printer. */
function PagePicker({ value, onChange }: { value: LabelPage; onChange: (page: LabelPage) => void }) {
  const { t } = useTranslation("dpd")
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Text size="small" className="text-ui-fg-subtle">
        {t("plan.page")}
      </Text>
      <div className="flex items-center gap-1" role="group" aria-label={t("plan.page")}>
        {PAGES.map((p) => (
          <Button key={p} size="small" type="button" variant={p === value ? "primary" : "secondary"} aria-pressed={p === value} onClick={() => onChange(p)}>
            {t(`account.labelPages.${p}`)}
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * The plan of one shipment, read live from the order before anything is
 * sent. Confirm sends exactly this plan (its hash); when the order changed in
 * between, the server answers plan_changed and the drawer reads the new plan.
 */
export function PlanDrawer({
  shipmentId,
  lang,
  writer,
  onClose,
  onSettings,
}: {
  shipmentId: string
  lang: string
  /** The shipment writer of the status (or of the order card): whether the options allow it. */
  writer?: Pick<WriterDto, "allowed">
  onClose: () => void
  onSettings?: () => void
}) {
  const { t } = useTranslation("dpd")
  const q = useDpdPlan(shipmentId)
  const create = useDpdCreate()
  const errorText = useActionErrorText()
  const blockText = useWriterBlockText()
  const shipmentToast = useShipmentToast()
  const [page, setPage] = useState<LabelPage | null>(null)
  /* A plan whose last read failed is neither shown nor confirmed: its hash may be stale. */
  const data = q.isError ? undefined : q.data
  const plan = data?.plan
  const shipment = data?.shipment
  const block = data ? writerBlock(writer, data.writerArmed) : null
  /* Not while the plan is read again (after a box edit or a refusal): the hash on screen may be the old one. */
  const canCreate = Boolean(!q.isError && !q.isFetching && plan?.ok && block === null && shipment?.actions.create)
  const chosenPage = page ?? data?.labelPage ?? "A4"

  /* Every answer, a refusal too, invalidates the queries (useAction), so the plan is read again by itself. */
  const onCreate = async () => {
    if (!plan) return
    try {
      const res = await create.mutateAsync({ id: shipmentId, planHash: plan.hash, page: chosenPage })
      shipmentToast(res.shipment, data?.mode === "demo" ? t("toast.createdDemo") : t("toast.created"))
      /* A refusal keeps the drawer open: the plan shows what DPD said next to the data sent. */
      if (res.shipment.state !== "failed") onClose()
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  const order = shipment ? (shipment.displayId !== null ? `#${shipment.displayId}` : (shipment.orderId ?? shipment.id)) : ""

  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content className="max-w-2xl">
        <Drawer.Header>
          <Drawer.Title className="flex flex-wrap items-center gap-2">
            {t("plan.title")}
            {shipment ? <KindBadges shipment={shipment} /> : null}
            {data?.mode === "demo" ? <ToneBadge tone="blue">{t("demo.badge")}</ToneBadge> : null}
          </Drawer.Title>
          <Drawer.Description>{shipment ? t("plan.subtitle", { order }) : ""}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-3 overflow-y-auto">
          {q.isLoading ? <KitLoading label={t("plan.loading")} /> : null}
          {q.isError ? (
            <InlineTip variant="error" label={t("plan.failed")}>
              {errorText(q.error)}
            </InlineTip>
          ) : null}
          {/* The point change needs no writer: it writes only the plugin row (DS4). */}
          {plan && shipment ? <PlanBody plan={plan} shipment={shipment} lang={lang} pointChange={canChangePoint(shipment, plan)} /> : null}
          {block === "off" ? (
            <InlineTip variant="warning" label={blockText("off").title}>
              {blockText("off").hint}
            </InlineTip>
          ) : null}
          {block === "not_armed" ? (
            <InlineTip variant="info" label={t("plan.notArmed")}>
              <span className="flex flex-col gap-y-2">
                <span>{t("plan.armHint")}</span>
                {onSettings ? (
                  <button type="button" className="txt-compact-small-plus w-fit text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={onSettings}>
                    {t("plan.openSettings")}
                  </button>
                ) : null}
              </span>
            </InlineTip>
          ) : null}
          {plan?.ok && block === null ? <PagePicker value={chosenPage} onChange={setPage} /> : null}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("plan.cancel")}
            </Button>
          </Drawer.Close>
          <Button size="small" variant="primary" disabled={!canCreate} isLoading={create.isPending} onClick={() => void onCreate()}>
            <PaperPlane />
            {data?.mode === "demo" ? t("plan.confirmDemo") : t("plan.confirm")}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/* ------------------------------------------------------------------ */
/* What a person can do with a shipment                                */
/* ------------------------------------------------------------------ */

/**
 * The actions of one shipment, every one visible (never a menu): the one a
 * warehouse needs next as a button with its name, the others as icons with
 * their names as tooltips. The actions of the row say what its state allows;
 * the calls to DPD (the label, the lookup) also need the shipment writer
 * and say why not instead of failing: off in the options, or not armed.
 * Named apart from the ShipmentActions type of the contract.
 */
export function ShipmentActionBar({
  shipment: s,
  writerArmed,
  writer,
  onPlan,
}: {
  shipment: ShipmentDto
  writerArmed: boolean
  /** The shipment writer: whether the options allow it (absent: only writerArmed counts). */
  writer?: Pick<WriterDto, "allowed">
  onPlan: () => void
}) {
  const { t, i18n } = useTranslation("dpd")
  const lang = i18n.language || "en"
  const prompt = usePrompt()
  const errorText = useActionErrorText()
  const shipmentToast = useShipmentToast()
  const fetchLabel = useDpdFetchLabel()
  const lookup = useDpdLookup()
  const accept = useDpdAccept()
  const skip = useDpdSkip()
  const now = useNow(Boolean(s.actions.lookup && s.lookupAfter))
  const tooEarly = Boolean(s.lookupAfter && Date.parse(s.lookupAfter) > now)
  const blockText = useWriterBlockText()
  const block = writerBlock(writer, writerArmed)
  const blocked = block ? [blockText(block).title, blockText(block).hint].filter(Boolean).join(" ") : ""
  const [labelBusy, setLabelBusy] = useState<"label" | "download" | null>(null)

  const run = async (fn: () => Promise<{ shipment: ShipmentDto }>, done: string) => {
    try {
      const res = await fn()
      shipmentToast(res.shipment, done)
    } catch (err) {
      toast.error(errorText(err))
    }
  }
  const onAccept = async () => {
    const yes = await prompt({ title: t("accept.title"), description: t("accept.text"), confirmText: t("accept.confirm"), cancelText: t("plan.cancel") })
    if (yes) await run(() => accept.mutateAsync({ id: s.id }), t("toast.accepted"))
  }
  const onSkip = async () => {
    const yes = await prompt({ title: t("skip.title"), description: t("skip.text"), confirmText: t("skip.confirm"), cancelText: t("plan.cancel") })
    if (yes) {
      try {
        await skip.mutateAsync({ id: s.id })
        toast.success(t("toast.skipped"))
      } catch (err) {
        toast.error(errorText(err))
      }
    }
  }
  /* The label is fetched with the admin's auth and opened from memory; a refusal (no_label) is a toast. */
  const open = async (download: boolean) => {
    setLabelBusy(download ? "download" : "label")
    try {
      await openLabel(s.id, download)
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setLabelBusy(null)
    }
  }

  const actions: RowAction[] = [
    { key: "plan", label: t("actions.plan"), icon: <PaperPlane />, hidden: !s.actions.plan, onClick: onPlan },
    {
      key: "fetchLabel",
      label: block ? `${t("actions.fetchLabel")}: ${blocked}` : t("actions.fetchLabel"),
      icon: <DocumentText />,
      hidden: !s.actions.fetchLabel,
      disabled: block !== null,
      loading: fetchLabel.isPending,
      onClick: () => void run(() => fetchLabel.mutateAsync({ id: s.id }), t("toast.labeled")),
    },
    { key: "label", label: t("actions.label"), icon: <DocumentText />, hidden: !s.actions.label, loading: labelBusy === "label", onClick: () => void open(false) },
    { key: "download", label: t("actions.download"), icon: <ArrowDownTray />, hidden: !s.actions.label, loading: labelBusy === "download", onClick: () => void open(true) },
    {
      key: "lookup",
      label: block ? `${t("actions.lookup")}: ${blocked}` : tooEarly && s.lookupAfter ? t("actions.lookupAfter", { time: fmtTime(s.lookupAfter, lang) }) : t("actions.lookup"),
      icon: <MagnifyingGlass />,
      hidden: !s.actions.lookup,
      disabled: block !== null || tooEarly,
      loading: lookup.isPending,
      onClick: () => void run(() => lookup.mutateAsync({ id: s.id }), t("toast.lookedUp")),
    },
    { key: "accept", label: t("actions.accept"), icon: <CheckCircle />, hidden: !s.actions.accept, loading: accept.isPending, onClick: () => void onAccept() },
    { key: "skip", label: t("actions.skip"), icon: <ArrowRightOnRectangle />, hidden: !s.actions.skip, loading: skip.isPending, onClick: () => void onSkip() },
  ]
  /* The button text of the main action: its name, without the reason it waits. */
  const names: Record<string, string> = { plan: t("actions.plan"), fetchLabel: t("actions.fetchLabel"), label: t("actions.label"), lookup: t("actions.lookup"), accept: t("actions.accept") }
  const shown = actions.filter((a) => !a.hidden)
  /* The one a person needs next, in this order; the others stay icons beside it. */
  const main = ["plan", "fetchLabel", "label", "lookup", "accept"].map((k) => shown.find((a) => a.key === k)).find(Boolean)
  if (shown.length === 0) return null

  return (
    <div className="flex items-center justify-end gap-1.5">
      {main ? (
        <Button size="small" variant="secondary" type="button" disabled={main.disabled} isLoading={main.loading} title={main.label} onClick={main.onClick} className="whitespace-nowrap">
          {main.icon}
          {names[main.key] ?? main.label}
        </Button>
      ) : null}
      <RowActions actions={shown.filter((a) => a !== main)} />
    </div>
  )
}
