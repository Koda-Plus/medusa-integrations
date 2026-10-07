import { useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowPath, ArrowUpRightOnBox, EllipsisHorizontal, MagnifyingGlass } from "@medusajs/icons"
import { Badge, Button, Copy, Drawer, DropdownMenu, IconButton, InlineTip, Input, Label, Text, clx, toast, usePrompt } from "@medusajs/ui"
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
import { nb } from "./inpost-guide"
import { Fact, KindBadges, LockerLines, ParcelStatus, ProblemList, TrackingCell, fmtDateTime, fmtMoney, useActorLabel, useEventText } from "./inpost-ui"

/* ------------------------------------------------------------------ */
/* The plan: read it, then create                                      */
/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: ReactNode }) {
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
      <Section title={t("plan.receiver")}>
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
          <Badge size="2xsmall" color="purple" className="w-fit">
            {t("plan.sampleContact")}
          </Badge>
        ) : null}
      </Section>
      <Section title={plan.kind === "locker" ? t("plan.locker") : t("plan.courier")}>
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
      </Section>
      <Section title={t("plan.parcel")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label={t("plan.size")}>{t(`size.long.${plan.parcel.size}`)}</Fact>
          <Fact label={t("plan.weight")}>
            {`${plan.parcel.weightKg} kg`}
            {plan.parcel.weightEstimated ? <span className="text-ui-fg-muted"> {t("plan.estimated")}</span> : null}
          </Fact>
          <Fact label={t("plan.cod")}>{plan.cod ? <span className="font-medium">{fmtMoney(plan.cod.amount, plan.cod.currency, lang)}</span> : <span className="text-ui-fg-muted">{t("plan.noCod")}</span>}</Fact>
          <Fact label={t("plan.insurance")}>{plan.insurance ? fmtMoney(plan.insurance.amount, plan.insurance.currency, lang) : <span className="text-ui-fg-muted">{t("plan.none")}</span>}</Fact>
        </div>
      </Section>
      <Section title={t("plan.sending")}>
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
      </Section>
      {plan.warnings.length > 0 ? (
        <Section title={t("plan.warnings")}>
          <ProblemList items={plan.warnings} tone="warning" kind="warning" />
        </Section>
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
            {data?.mode === "demo" ? (
              <Badge size="2xsmall" color="purple">
                {t("demo.badge")}
              </Badge>
            ) : null}
          </Drawer.Title>
          <Drawer.Description>{data ? t("plan.subtitle", { order: data.parcel.displayId ?? data.parcel.orderId }) : ""}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-3 overflow-y-auto">
          {q.isLoading ? <Text size="small" className="text-ui-fg-muted">{t("plan.loading")}</Text> : null}
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

function useDebounced(value: string, ms = 350): string {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value.trim()), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return out
}

/** The locker search. With `parcelId` each result can become the shipment's locker; without it, it is a lookup. */
export function LockerDrawer({ parcelId, current, onClose }: { parcelId?: string | null; current?: string | null; onClose: () => void }) {
  const { t } = useTranslation("inpost")
  const [text, setText] = useState("")
  const q = useDebounced(text)
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
            <Label size="xsmall" weight="plus" htmlFor="inpost-locker-search">
              {t("lockers.label")}
            </Label>
            <Input id="inpost-locker-search" size="small" type="search" autoFocus placeholder={t("lockers.placeholder")} value={text} onChange={(e) => setText(e.target.value)} />
            <Text size="xsmall" className="text-ui-fg-muted">
              {points.data?.demo ? t("lockers.demoNote") : t("lockers.hint")}
            </Text>
          </div>
          {points.isError ? (
            <InlineTip variant="warning" label={t("lockers.title")}>
              {errorMessage(points.error)}
            </InlineTip>
          ) : null}
          {q.length >= 2 && !points.isLoading && list.length === 0 && !points.isError ? (
            <Text size="small" className="text-ui-fg-muted">
              {t("lockers.empty")}
            </Text>
          ) : null}
          <ul className="flex flex-col divide-y divide-ui-border-base rounded-lg border border-ui-border-base">
            {list.map((p) => (
              <li key={p.code} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="flex min-w-0 flex-col gap-y-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="txt-compact-small-plus font-mono text-ui-fg-base">{p.code}</span>
                    {p.is_24_7 ? (
                      <Badge size="2xsmall" color="green">
                        24/7
                      </Badge>
                    ) : null}
                    {p.payment_available ? (
                      <Badge size="2xsmall" color="grey">
                        {t("lockers.payment")}
                      </Badge>
                    ) : null}
                    {p.distance !== null ? <span className="txt-compact-xsmall text-ui-fg-muted">{t("lockers.distance", { m: p.distance })}</span> : null}
                    {p.code === current ? (
                      <Badge size="2xsmall" color="blue">
                        {t("lockers.current")}
                      </Badge>
                    ) : null}
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
  if (events.length === 0) {
    return (
      <Text size="small" className="text-ui-fg-muted">
        {t("detail.noHistory")}
      </Text>
    )
  }
  return (
    <ol className="flex flex-col gap-y-2">
      {events.map((e) => (
        <li key={e.id} className="flex gap-x-2.5">
          <span className={clx("mt-1.5 h-2 w-2 shrink-0 rounded-full", e.kind === "status" ? "bg-ui-tag-blue-icon" : e.kind === "webhook" ? "bg-ui-tag-purple-icon" : "bg-ui-fg-muted")} />
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
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ui-border-base pt-3">
                <Text size="small" weight="plus">
                  {t("detail.history")}
                </Text>
                <ParcelActions parcel={p} lang={lang} writers={writers} onSettings={onSettings} />
              </div>
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

/**
 * The actions of one shipment: the main one as a button (read the plan and
 * create, the label, look up, try again, pay the offer), the rest in a menu.
 * Writes need the shipment writer armed: their buttons say so instead of
 * failing.
 */
export function ParcelActions({
  parcel: p,
  lang,
  writers,
  onOpen,
  onSettings,
  compact = false,
}: {
  parcel: ParcelDto
  lang: string
  writers: Record<string, WriterDto> | undefined
  onOpen?: () => void
  onSettings?: () => void
  compact?: boolean
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

  const main = p.actions.create ? (
    <Button size="small" variant={compact ? "secondary" : "primary"} onClick={() => setPlanOpen(true)}>
      {t("actions.plan")}
    </Button>
  ) : p.actions.label ? (
    <Button size="small" variant="secondary" onClick={() => openLabel()}>
      {t("actions.label")}
    </Button>
  ) : p.actions.lookup ? (
    <Button size="small" variant="secondary" isLoading={lookup.isPending} onClick={() => void run(() => lookup.mutateAsync({ id: p.id }), t("toast.lookedUp"))}>
      {t("actions.lookup")}
    </Button>
  ) : p.actions.retry ? (
    <Button size="small" variant="secondary" isLoading={retry.isPending} onClick={() => void run(() => retry.mutateAsync({ id: p.id }), t("toast.retried"))}>
      {t("actions.retry")}
    </Button>
  ) : p.actions.buy ? (
    <Button size="small" variant="secondary" disabled={!armed} title={!armed ? t("plan.notArmed") : undefined} isLoading={buy.isPending} onClick={() => void run(() => buy.mutateAsync({ id: p.id }), t("toast.bought"))}>
      {t("actions.buy")}
    </Button>
  ) : null

  return (
    <div className="flex items-center justify-end gap-1.5">
      {main}
      <DropdownMenu>
        <DropdownMenu.Trigger asChild>
          <IconButton size="small" variant="transparent" aria-label={t("actions.moreActions")}>
            <EllipsisHorizontal />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          {onOpen ? <DropdownMenu.Item onClick={onOpen}>{t("actions.details")}</DropdownMenu.Item> : null}
          {p.actions.plan && !p.actions.create ? <DropdownMenu.Item onClick={() => setPlanOpen(true)}>{t("actions.planOnly")}</DropdownMenu.Item> : null}
          {p.actions.refresh ? (
            <DropdownMenu.Item className="gap-x-2" onClick={() => void run(() => refresh.mutateAsync({ id: p.id }), t("toast.refreshed"))}>
              <ArrowPath />
              {t("actions.refresh")}
            </DropdownMenu.Item>
          ) : null}
          {p.actions.label ? (
            <>
              <DropdownMenu.Item className="gap-x-2" onClick={() => openLabel("A6")}>
                <ArrowUpRightOnBox />
                {t("actions.labelA6")}
              </DropdownMenu.Item>
              {p.kind === "locker" ? (
                <DropdownMenu.Item className="gap-x-2" onClick={() => openLabel("A4")}>
                  <ArrowUpRightOnBox />
                  {t("actions.labelA4")}
                </DropdownMenu.Item>
              ) : null}
            </>
          ) : null}
          {p.actions.changeLocker ? (
            <DropdownMenu.Item className="gap-x-2" onClick={() => setLockerOpen(true)}>
              <MagnifyingGlass />
              {t("actions.changeLocker")}
            </DropdownMenu.Item>
          ) : null}
          {p.actions.changeSize
            ? SIZES.filter((s) => s !== p.size).map((s) => (
                <DropdownMenu.Item key={s} onClick={() => void run(() => size.mutateAsync({ id: p.id, size: s }), t("toast.sizeChanged", { size: t(`size.letter.${s}`) }))}>
                  {t("actions.setSize", { size: t(`size.long.${s}`) })}
                </DropdownMenu.Item>
              ))
            : null}
          {p.actions.buy ? (
            <DropdownMenu.Item disabled={!armed} onClick={() => void run(() => buy.mutateAsync({ id: p.id }), t("toast.bought"))}>
              {t("actions.buy")}
            </DropdownMenu.Item>
          ) : null}
          {p.actions.lookup ? <DropdownMenu.Item onClick={() => void run(() => lookup.mutateAsync({ id: p.id }), t("toast.lookedUp"))}>{t("actions.lookup")}</DropdownMenu.Item> : null}
          {p.actions.retry ? <DropdownMenu.Item onClick={() => void run(() => retry.mutateAsync({ id: p.id }), t("toast.retried"))}>{t("actions.retry")}</DropdownMenu.Item> : null}
          {p.actions.link ? <DropdownMenu.Item onClick={() => setLinkOpen(true)}>{t("actions.link")}</DropdownMenu.Item> : null}
          {p.actions.skip || p.actions.cancel ? <DropdownMenu.Separator /> : null}
          {p.actions.skip ? <DropdownMenu.Item onClick={() => void onSkip()}>{t("actions.skip")}</DropdownMenu.Item> : null}
          {p.actions.cancel ? (
            <DropdownMenu.Item disabled={!armed} onClick={() => void onCancel()}>
              {armed ? t("actions.cancel") : t("actions.cancelNotArmed")}
            </DropdownMenu.Item>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu>
      {planOpen ? <PlanDrawer parcelId={p.id} lang={lang} onClose={() => setPlanOpen(false)} onSettings={onSettings} /> : null}
      {lockerOpen ? <LockerDrawer parcelId={p.id} current={p.locker?.code ?? null} onClose={() => setLockerOpen(false)} /> : null}
      {linkOpen ? <LinkDrawer parcel={p} onClose={() => setLinkOpen(false)} /> : null}
    </div>
  )
}
