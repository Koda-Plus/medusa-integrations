import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowDownTray,
  ArrowPath,
  ArrowRightOnRectangle,
  ArrowUturnLeft,
  CreditCard,
  DocumentText,
  Eye,
  History as HistoryIcon,
  Link,
  MagnifyingGlass,
  MapPin,
  PaperPlane,
  XCircle,
} from "@medusajs/icons"
import { Button, Copy, Drawer, InlineTip, Input, Label, Text, clx, toast, usePrompt } from "@medusajs/ui"
import type { ParcelDto, ParcelEventDto, ParcelSize, PlanDto, WriterDto } from "../../modules/inpost/lib/contract"
import {
  errorMessage,
  labelUrl,
  useInpostBuy,
  useInpostCancel,
  useInpostCreate,
  useInpostLink,
  useInpostLocker,
  useInpostLookup,
  useInpostParcel,
  useInpostPlan,
  useInpostPoints,
  useInpostRefresh,
  useInpostRetry,
  useInpostSize,
  useInpostSkip,
} from "./inpost-api"
import { EmptyState, RowActions, SearchInput, ToneBadge, useDebouncedValue, type RowAction } from "./inpost-blocks"
import { nb } from "./inpost-guide"
import { KitLoading } from "./inpost-kit"
import { Fact, KindBadges, LockerLines, ParcelStatus, ProblemList, TrackingCell, fmtDateTime, fmtMoney, useActorLabel, useEventText } from "./inpost-ui"

/* ------------------------------------------------------------------ */
/* The plan: read it, then create                                      */
/* ------------------------------------------------------------------ */

/** One part of the plan in a drawer: a small heading over its facts. */
function PlanPart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-2 rounded-lg border border-ui-border-base px-4 py-3">
      <Text size="xsmall" weight="plus" className="text-ui-fg-muted">
        {title}
      </Text>
      {children}
    </div>
  )
}

function PlanBody({ plan, lang }: { plan: PlanDto; lang: string }) {
  const { t } = useTranslation("inpost")
  const [showRequest, setShowRequest] = useState(false)
  const r = plan.receiver
  const address = r.address ? [`${r.address.street} ${r.address.building_number}${r.address.flat_number ? `/${r.address.flat_number}` : ""}`, `${r.address.post_code} ${r.address.city}`].join(", ") : null
  return (
    <div className="flex flex-col gap-y-3">
      {plan.problems.length > 0 ? (
        <InlineTip variant="error" label={t("plan.problems")}>
          <ProblemList items={plan.problems} />
        </InlineTip>
      ) : null}
      <PlanPart title={t("plan.receiver")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fact label={t("plan.name")}>{r.name || <span className="text-ui-fg-muted">{t("plan.none")}</span>}</Fact>
          <Fact label={t("plan.phone")} mono>
            {r.phone ?? <span className="font-sans text-ui-tag-red-text">{t("plan.missing")}</span>}
          </Fact>
          <Fact label={t("plan.email")} mono>
            {r.email ?? <span className="font-sans text-ui-fg-muted">{t("plan.none")}</span>}
          </Fact>
          {plan.kind === "courier" ? <Fact label={t("plan.address")}>{address ?? <span className="text-ui-tag-red-text">{t("plan.missing")}</span>}</Fact> : null}
        </div>
        {r.sample ? (
          <span className="w-fit">
            <ToneBadge tone="purple">{t("plan.sampleContact")}</ToneBadge>
          </span>
        ) : null}
      </PlanPart>
      <PlanPart title={plan.kind === "locker" ? t("plan.locker") : t("plan.courier")}>
        {plan.kind === "locker" ? (
          plan.locker ? (
            <LockerLines locker={{ ...plan.locker, mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Paczkomat ${plan.locker.code} ${plan.locker.address?.line1 ?? ""} ${plan.locker.address?.line2 ?? ""}`)}` }} />
          ) : (
            <Text size="small" className="text-ui-tag-red-text">
              {t("plan.noLocker")}
            </Text>
          )
        ) : (
          <Text size="small">{t("plan.courierText")}</Text>
        )}
      </PlanPart>
      <PlanPart title={t("plan.parcel")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label={t("plan.size")}>{t(`size.long.${plan.parcel.size}`)}</Fact>
          <Fact label={t("plan.weight")}>
            {`${plan.parcel.weightKg} kg`}
            {plan.parcel.weightEstimated ? <span className="text-ui-fg-muted"> {t("plan.estimated")}</span> : null}
          </Fact>
          <Fact label={t("plan.cod")}>{plan.cod ? <span className="font-medium">{fmtMoney(plan.cod.amount, plan.cod.currency, lang)}</span> : <span className="text-ui-fg-muted">{t("plan.noCod")}</span>}</Fact>
          <Fact label={t("plan.insurance")}>{plan.insurance ? fmtMoney(plan.insurance.amount, plan.insurance.currency, lang) : <span className="text-ui-fg-muted">{t("plan.none")}</span>}</Fact>
        </div>
      </PlanPart>
      <PlanPart title={t("plan.sending")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fact label={t("plan.reference")} mono>
            {plan.reference}
          </Fact>
          <Fact label={t("plan.sendingMethod")}>{plan.sendingMethod ? t(`sendingMethod.${plan.sendingMethod}`, { defaultValue: plan.sendingMethod }) : t("plan.accountDefault")}</Fact>
          {plan.dropoffPoint ? (
            <Fact label={t("plan.dropoff")} mono>
              {plan.dropoffPoint}
            </Fact>
          ) : null}
          <Fact label={t("plan.sender")}>{plan.sender ? String(plan.sender.company_name ?? [plan.sender.first_name, plan.sender.last_name].filter(Boolean).join(" ")) : t("plan.senderOrganization")}</Fact>
          {plan.pickup ? <Fact label={t("plan.pickup")}>{nb(`${plan.pickup.name}, ${plan.pickup.address.street} ${plan.pickup.address.building_number}, ${plan.pickup.address.post_code} ${plan.pickup.address.city}`)}</Fact> : null}
        </div>
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("plan.buysOffer")}
        </Text>
      </PlanPart>
      {plan.warnings.length > 0 ? (
        <PlanPart title={t("plan.warnings")}>
          <ProblemList items={plan.warnings} tone="warning" kind="warning" />
        </PlanPart>
      ) : null}
      {plan.request ? (
        <div className="flex flex-col gap-y-2">
          <Button size="small" variant="transparent" className="w-fit" onClick={() => setShowRequest(!showRequest)}>
            {showRequest ? t("plan.hideRequest") : t("plan.showRequest")}
          </Button>
          {showRequest ? (
            <pre className="max-h-[40vh] overflow-auto rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-2 font-mono text-[11px] leading-[18px] text-ui-fg-subtle">{JSON.stringify(plan.request, null, 2)}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** The plan of one shipment, read before anything is sent; Create sends exactly this plan (its hash). */
export function PlanDrawer({ parcelId, lang, onClose, onSettings }: { parcelId: string; lang: string; onClose: () => void; onSettings?: () => void }) {
  const { t } = useTranslation("inpost")
  const q = useInpostPlan(parcelId)
  const create = useInpostCreate()
  const data = q.data
  const plan = data?.plan
  const canCreate = Boolean(plan?.ok && data?.writerArmed && data.parcel.actions.create)

  const onCreate = async () => {
    if (!plan) return
    try {
      await create.mutateAsync({ id: parcelId, planHash: plan.hash })
      toast.success(data?.mode === "demo" ? t("toast.createdDemo") : t("toast.created"))
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
      void q.refetch()
    }
  }

  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content className="max-w-2xl">
        <Drawer.Header>
          <Drawer.Title className="flex flex-wrap items-center gap-2">
            {t("plan.title")}
            {data ? <KindBadges parcel={data.parcel} /> : null}
            {data?.mode === "demo" ? <ToneBadge tone="blue">{t("demo.badge")}</ToneBadge> : null}
          </Drawer.Title>
          <Drawer.Description>{data ? t("plan.subtitle", { order: data.parcel.displayId ?? data.parcel.orderId }) : ""}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-3 overflow-y-auto">
          {q.isLoading ? <KitLoading label={t("plan.loading")} /> : null}
          {q.isError ? (
            <InlineTip variant="error" label={t("plan.title")}>
              {errorMessage(q.error)}
            </InlineTip>
          ) : null}
          {plan ? <PlanBody plan={plan} lang={lang} /> : null}
          {data && !data.writerArmed ? (
            <InlineTip variant="info" label={t("plan.notArmed")}>
              <span className="flex flex-col gap-y-2">
                <span>{t("plan.armHint")}</span>
                {onSettings ? (
                  <button type="button" className="txt-compact-small-plus w-fit text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={onSettings}>
                    {t("plan.openWriters")}
                  </button>
                ) : null}
              </span>
            </InlineTip>
          ) : null}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.close")}
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
/* Lockers: search, and pick one for a shipment not sent yet           */
/* ------------------------------------------------------------------ */

/** The locker search. With `parcelId` each result can become the shipment's locker; without it, it is a lookup. */
export function LockerDrawer({ parcelId, current, onClose }: { parcelId?: string | null; current?: string | null; onClose: () => void }) {
  const { t } = useTranslation("inpost")
  const [text, setText] = useState("")
  const q = useDebouncedValue(text.trim(), 350)
  const points = useInpostPoints(q)
  const change = useInpostLocker()
  const list = points.data?.points ?? []

  const onUse = async (code: string) => {
    if (!parcelId) return
    try {
      await change.mutateAsync({ id: parcelId, code })
      toast.success(t("toast.lockerChanged", { code }))
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content className="max-w-xl">
        <Drawer.Header>
          <Drawer.Title>{parcelId ? t("lockers.pickTitle") : t("lockers.title")}</Drawer.Title>
          <Drawer.Description>{parcelId ? t("lockers.pickSubtitle", { code: current ?? t("plan.none") }) : t("lockers.subtitle")}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-3 overflow-y-auto">
          <div className="flex flex-col gap-y-1.5">
            <SearchInput value={text} onChange={setText} autoFocus label={t("lockers.label")} placeholder={t("lockers.placeholder")} className="sm:w-full" />
            <Text size="xsmall" className="text-ui-fg-muted">
              {points.data?.demo ? t("lockers.demoNote") : t("lockers.hint")}
            </Text>
          </div>
          {points.isError ? (
            <InlineTip variant="warning" label={t("lockers.title")}>
              {errorMessage(points.error)}
            </InlineTip>
          ) : null}
          {q.length >= 2 && !points.isLoading && list.length === 0 && !points.isError ? <EmptyState compact icon={<MapPin />} title={t("lockers.empty")} /> : null}
          {points.isLoading && q.length >= 2 ? <KitLoading /> : null}
          <ul className={clx("flex flex-col divide-y divide-ui-border-base rounded-lg border border-ui-border-base", list.length === 0 && "hidden")}>
            {list.map((p) => (
              <li key={p.code} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="flex min-w-0 flex-col gap-y-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="txt-compact-small-plus font-mono text-ui-fg-base">{p.code}</span>
                    {p.is_24_7 ? <ToneBadge tone="green">24/7</ToneBadge> : null}
                    {p.payment_available ? <ToneBadge icon={<CreditCard />}>{t("lockers.payment")}</ToneBadge> : null}
                    {p.distance !== null ? <span className="txt-compact-xsmall text-ui-fg-muted">{t("lockers.distance", { m: p.distance })}</span> : null}
                    {p.code === current ? <ToneBadge tone="blue">{t("lockers.current")}</ToneBadge> : null}
                  </span>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {nb([p.address.line1, p.address.line2].filter(Boolean).join(", "))}
                  </Text>
                  {p.description ? (
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {nb(p.description)}
                    </Text>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Copy content={p.code} className="text-ui-fg-muted" />
                  {parcelId ? (
                    <Button size="small" variant="secondary" disabled={p.code === current} isLoading={change.isPending && change.variables?.code === p.code} onClick={() => void onUse(p.code)}>
                      <MapPin />
                      {t("lockers.use")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.close")}
            </Button>
          </Drawer.Close>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/* ------------------------------------------------------------------ */
/* Link a shipment found in InPost Manager                             */
/* ------------------------------------------------------------------ */

function LinkDrawer({ parcel, onClose }: { parcel: ParcelDto; onClose: () => void }) {
  const { t } = useTranslation("inpost")
  const [id, setId] = useState("")
  const link = useInpostLink()
  const valid = /^\d{1,15}$/.test(id.trim())
  const onLink = async () => {
    try {
      await link.mutateAsync({ id: parcel.id, shipmentId: id.trim() })
      toast.success(t("toast.linked"))
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{t("link.title")}</Drawer.Title>
          <Drawer.Description>{t(parcel.state === "unknown" ? "link.textUnknown" : "link.text")}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-2">
          <Label size="xsmall" weight="plus" htmlFor="inpost-link-id">
            {t("link.label")}
          </Label>
          <Input id="inpost-link-id" size="small" inputMode="numeric" placeholder="1234567890" value={id} onChange={(e) => setId(e.target.value)} />
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.close")}
            </Button>
          </Drawer.Close>
          <Button size="small" variant="primary" disabled={!valid} isLoading={link.isPending} onClick={() => void onLink()}>
            {t("link.submit")}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/* ------------------------------------------------------------------ */
/* One shipment: its facts and its history                             */
/* ------------------------------------------------------------------ */

export function History({ events, lang }: { events: ParcelEventDto[]; lang: string }) {
  const { t } = useTranslation("inpost")
  const eventText = useEventText()
  const actorLabel = useActorLabel()
  if (events.length === 0) return <EmptyState compact icon={<HistoryIcon />} title={t("detail.noHistory")} />
  return (
    <ol className="flex flex-col gap-y-2">
      {events.map((e) => (
        <li key={e.id} className="flex gap-x-2.5">
          <span className={clx("mt-1.5 h-2 w-2 shrink-0 rounded-full", e.kind === "status" || e.kind === "webhook" ? "bg-ui-tag-blue-icon" : "bg-ui-tag-neutral-icon")} />
          <div className="flex min-w-0 flex-col">
            <Text size="small" className="text-ui-fg-base">
              {nb(eventText(e))}
            </Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              {fmtDateTime(e.occurredAt, lang)}
              {e.source ? ` / ${t(`detail.source.${e.source}`, { defaultValue: e.source })}` : ""}
              {e.actor ? ` / ${actorLabel(e.actor)}` : ""}
            </Text>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function ParcelDrawer({ parcelId, lang, writers, onClose, onSettings }: { parcelId: string; lang: string; writers: Record<string, WriterDto> | undefined; onClose: () => void; onSettings?: () => void }) {
  const { t } = useTranslation("inpost")
  const actorLabel = useActorLabel()
  const q = useInpostParcel(parcelId)
  const p = q.data?.parcel
  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content className="max-w-2xl">
        <Drawer.Header>
          <Drawer.Title className="flex flex-wrap items-center gap-2">
            {p ? t("detail.title", { order: p.displayId ?? p.orderId }) : t("detail.loading")}
            {p ? <ParcelStatus parcel={p} /> : null}
          </Drawer.Title>
          <Drawer.Description>{p ? <KindBadges parcel={p} /> : null}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          {q.isLoading ? <KitLoading label={t("detail.loading")} /> : null}
          {q.isError ? (
            <InlineTip variant="error" label={t("detail.history")}>
              {errorMessage(q.error)}
            </InlineTip>
          ) : null}
          {p ? (
            <>
              {p.error ? (
                <InlineTip variant={p.state === "failed" || p.state === "unknown" ? "error" : "warning"} label={t(`state.${p.state}`)}>
                  {p.error}
                </InlineTip>
              ) : null}
              {p.problems.length > 0 ? (
                <InlineTip variant="warning" label={t("plan.problems")}>
                  <ProblemList items={p.problems} />
                </InlineTip>
              ) : null}
              {p.fulfillmentCanceledAt && p.state === "created" ? (
                <InlineTip variant="warning" label={t("detail.fulfillmentCanceled")}>
                  {t("detail.fulfillmentCanceledText")}
                </InlineTip>
              ) : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Fact label={t("detail.locker")}>{p.locker ? <LockerLines locker={p.locker} /> : t(p.kind === "courier" ? "plan.courier" : "plan.noLocker")}</Fact>
                <Fact label={t("detail.tracking")}>
                  <TrackingCell parcel={p} />
                </Fact>
                <Fact label={t("detail.shipmentId")} mono>
                  {p.shipmentId ?? "-"}
                </Fact>
                <Fact label={t("detail.reference")} mono>
                  {p.reference ?? "-"}
                </Fact>
                <Fact label={t("detail.cod")}>{p.codAmount ? fmtMoney(p.codAmount, p.currency, lang) : t("plan.noCod")}</Fact>
                <Fact label={t("detail.size")}>{p.size ? t(`size.long.${p.size}`) : t("detail.sizeDefault")}</Fact>
                {p.sendingMethod ? <Fact label={t("plan.sendingMethod")}>{t(`sendingMethod.${p.sendingMethod}`, { defaultValue: p.sendingMethod })}</Fact> : null}
                {p.dispatch ? (
                  <Fact label={t("detail.pickup")}>
                    {t(`detail.dispatch.${p.dispatch.state}`, { defaultValue: p.dispatch.state, id: p.dispatch.orderId ?? "" })}
                    {p.dispatch.error ? <span className="block text-ui-tag-red-text">{p.dispatch.error}</span> : null}
                  </Fact>
                ) : null}
                {p.offer ? <Fact label={t("detail.offer")}>{p.offer.rate !== null ? fmtMoney(String(p.offer.rate), p.offer.currency, lang) : t("detail.offerNoRate")}</Fact> : null}
                <Fact label={t("detail.createdBy")}>{actorLabel(p.createdBy) ?? "-"}</Fact>
                <Fact label={t("detail.shipmentCreatedAt")}>{fmtDateTime(p.shipmentCreatedAt, lang) || "-"}</Fact>
                <Fact label={t("detail.lastChecked")}>{fmtDateTime(p.lastCheckedAt, lang) || "-"}</Fact>
                {p.shippedMarkedAt || p.deliveredMarkedAt || p.statusWriterError ? (
                  <Fact label={t("detail.medusa")}>
                    {p.deliveredMarkedAt ? t("detail.markedDelivered") : p.shippedMarkedAt ? t("detail.markedShipped") : ""}
                    {p.statusWriterError ? <span className="block text-ui-tag-red-text">{p.statusWriterError}</span> : null}
                  </Fact>
                ) : null}
              </div>
              <div className="border-t border-ui-border-base pt-3">
                <ParcelActions parcel={p} lang={lang} writers={writers} onSettings={onSettings} layout="buttons" />
              </div>
              <Text size="small" weight="plus" className="flex items-center gap-x-1.5">
                <HistoryIcon className="text-ui-fg-muted" />
                {t("detail.history")}
              </Text>
              <History events={q.data?.events ?? []} lang={lang} />
            </>
          ) : null}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.close")}
            </Button>
          </Drawer.Close>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/* ------------------------------------------------------------------ */
/* What a person can do with a shipment                                */
/* ------------------------------------------------------------------ */


const SIZES: ParcelSize[] = ["small", "medium", "large"]

/** A format or a size letter as the icon of an action (A6, A4, B): a letter says it better than a picture. */
function Glyph({ children }: { children: string }) {
  return <span className="txt-compact-xsmall-plus flex h-[15px] min-w-[15px] items-center justify-center leading-none">{children}</span>
}

/**
 * The actions of one shipment, every one visible (never a menu). In a row
 * (`layout="row"`) the main one (read the plan and create, the label, look
 * up, try again, pay the offer) is a button with its name and the others are
 * icons with their names as tooltips; in a drawer (`layout="buttons"`) each
 * is a button with its icon and name. Writes need the shipment writer armed:
 * their buttons say so instead of failing.
 */
export function ParcelActions({
  parcel: p,
  lang,
  writers,
  onOpen,
  onSettings,
  layout = "row",
}: {
  parcel: ParcelDto
  lang: string
  writers: Record<string, WriterDto> | undefined
  onOpen?: () => void
  onSettings?: () => void
  layout?: "row" | "buttons"
}) {
  const { t } = useTranslation("inpost")
  const prompt = usePrompt()
  const [planOpen, setPlanOpen] = useState(false)
  const [lockerOpen, setLockerOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const cancel = useInpostCancel()
  const buy = useInpostBuy()
  const refresh = useInpostRefresh()
  const retry = useInpostRetry()
  const lookup = useInpostLookup()
  const skip = useInpostSkip()
  const size = useInpostSize()
  const armed = Boolean(writers?.shipment?.armed)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.success(ok)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onCancel = async () => {
    const yes = await prompt({ title: t("cancel.title"), description: t("cancel.text"), confirmText: t("cancel.confirm"), cancelText: t("cancel.back") })
    if (yes) await run(() => cancel.mutateAsync({ id: p.id }), t("toast.canceled"))
  }
  const onSkip = async () => {
    const yes = await prompt({ title: t("skip.title"), description: t("skip.text"), confirmText: t("skip.confirm"), cancelText: t("skip.back") })
    if (yes) await run(() => skip.mutateAsync({ id: p.id }), t("toast.skipped"))
  }
  const openLabel = (labelSize?: "A6" | "A4") => window.open(labelUrl(p.id, labelSize), "_blank", "noopener")

  const actions: RowAction[] = [
    { key: "create", label: t("actions.plan"), icon: <PaperPlane />, hidden: !p.actions.create, onClick: () => setPlanOpen(true) },
    { key: "plan", label: t("actions.planOnly"), icon: <DocumentText />, hidden: !p.actions.plan || p.actions.create, onClick: () => setPlanOpen(true) },
    { key: "label", label: t("actions.label"), icon: <ArrowDownTray />, hidden: !p.actions.label, onClick: () => openLabel() },
    { key: "labelA6", label: t("actions.labelA6"), icon: <Glyph>A6</Glyph>, hidden: !p.actions.label, onClick: () => openLabel("A6") },
    { key: "labelA4", label: t("actions.labelA4"), icon: <Glyph>A4</Glyph>, hidden: !p.actions.label || p.kind !== "locker", onClick: () => openLabel("A4") },
    { key: "lookup", label: t("actions.lookup"), icon: <MagnifyingGlass />, hidden: !p.actions.lookup, loading: lookup.isPending, onClick: () => void run(() => lookup.mutateAsync({ id: p.id }), t("toast.lookedUp")) },
    { key: "retry", label: t("actions.retry"), icon: <ArrowUturnLeft />, hidden: !p.actions.retry, loading: retry.isPending, onClick: () => void run(() => retry.mutateAsync({ id: p.id }), t("toast.retried")) },
    {
      key: "buy",
      label: armed ? t("actions.buy") : t("actions.buyNotArmed"),
      icon: <CreditCard />,
      hidden: !p.actions.buy,
      disabled: !armed,
      loading: buy.isPending,
      onClick: () => void run(() => buy.mutateAsync({ id: p.id }), t("toast.bought")),
    },
    { key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, hidden: !p.actions.refresh, loading: refresh.isPending, onClick: () => void run(() => refresh.mutateAsync({ id: p.id }), t("toast.refreshed")) },
    { key: "locker", label: t("actions.changeLocker"), icon: <MapPin />, hidden: !p.actions.changeLocker, onClick: () => setLockerOpen(true) },
    ...SIZES.map(
      (s): RowAction => ({
        key: `size-${s}`,
        label: t("actions.setSize", { size: t(`size.long.${s}`) }),
        icon: <Glyph>{t(`size.letter.${s}`)}</Glyph>,
        hidden: !p.actions.changeSize || s === p.size,
        loading: size.isPending && size.variables?.size === s,
        onClick: () => void run(() => size.mutateAsync({ id: p.id, size: s }), t("toast.sizeChanged", { size: t(`size.letter.${s}`) })),
      }),
    ),
    { key: "link", label: t("actions.link"), icon: <Link />, hidden: !p.actions.link, onClick: () => setLinkOpen(true) },
    { key: "details", label: t("actions.details"), icon: <Eye />, hidden: !onOpen, onClick: () => onOpen?.() },
    { key: "skip", label: t("actions.skip"), icon: <ArrowRightOnRectangle />, hidden: !p.actions.skip, onClick: () => void onSkip() },
    { key: "cancel", label: armed ? t("actions.cancel") : t("actions.cancelNotArmed"), icon: <XCircle />, danger: true, hidden: !p.actions.cancel, disabled: !armed, loading: cancel.isPending, onClick: () => void onCancel() },
  ]
  const shown = actions.filter((a) => !a.hidden)
  /* The one a warehouse needs next, in this order; the others stay icons beside it. */
  const main = ["create", "label", "lookup", "retry", "buy"].map((k) => shown.find((a) => a.key === k)).find(Boolean)

  return (
    <>
      {layout === "buttons" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {shown.map((a) => (
            <Button
              key={a.key}
              size="small"
              variant={a === main ? "primary" : "secondary"}
              disabled={a.disabled}
              isLoading={a.loading}
              onClick={a.onClick}
              className={clx("whitespace-nowrap", a.danger && "text-ui-tag-red-text")}
            >
              {a.icon}
              {a.label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-end gap-1.5">
          {main ? (
            <Button size="small" variant="secondary" disabled={main.disabled} isLoading={main.loading} title={main.label} onClick={main.onClick} className="whitespace-nowrap">
              {main.icon}
              {main.key === "create" ? t("actions.create") : main.label}
            </Button>
          ) : null}
          <RowActions actions={shown.filter((a) => a !== main)} />
        </div>
      )}
      {planOpen ? <PlanDrawer parcelId={p.id} lang={lang} onClose={() => setPlanOpen(false)} onSettings={onSettings} /> : null}
      {lockerOpen ? <LockerDrawer parcelId={p.id} current={p.locker?.code ?? null} onClose={() => setLockerOpen(false)} /> : null}
      {linkOpen ? <LinkDrawer parcel={p} onClose={() => setLinkOpen(false)} /> : null}
    </>
  )
}
