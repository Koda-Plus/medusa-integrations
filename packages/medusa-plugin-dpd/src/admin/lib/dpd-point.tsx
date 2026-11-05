import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { BuildingStorefront, Cash, Clock, MagnifyingGlass, MapPin } from "@medusajs/icons"
import { Button, InlineTip, Input, Prompt, Text, clx, toast } from "@medusajs/ui"
import type { PlanPointDto, PlanResponse, PointDto, PointsSourceKind, ProblemDto } from "../../modules/dpd/lib/contract"
import { DpdRequestError, useDpdPoints, useDpdSetPoint } from "./dpd-api"
import { ToneBadge } from "./dpd-blocks"
import { nb } from "./dpd-guide"
import { KitLoading } from "./dpd-kit"
import { pointAddressLine, pointHoursRows, pointLimitParts, pointTypeKey, pointsQuery, sameSearch } from "./dpd-logic"
import { ProblemList, fmtNumber } from "./dpd-ui"

/**
 * DPD Pickup points in the admin: the card of a point (in the plan and in
 * the search), the search by postal code and city, and the confirmation of
 * a change. A point address is public data; who collects the parcel is not
 * shown here (the plan has its own part for that).
 */

/** The text of a refused request, from the caller (the plan drawer has the dictionary's words for each code). */
type ErrorText = (err: unknown) => string

/** One line of a note under a point: red for what stops the shipment, orange for a point not checked, grey for where it comes from. */
function Note({ tone, children }: { tone: "red" | "orange" | "grey"; children: ReactNode }) {
  return (
    <Text size="xsmall" className={clx(tone === "red" ? "text-ui-tag-red-text" : tone === "orange" ? "text-ui-tag-orange-text" : "text-ui-fg-muted")}>
      {children}
    </Text>
  )
}

/** The week of a point, Monday first; a day without a range is closed. */
function HoursList({ point }: { point: PointDto }) {
  const { t } = useTranslation("dpd")
  return (
    <div className="flex flex-col gap-y-1">
      <Text size="xsmall" className="flex items-center gap-x-1 text-ui-fg-muted">
        <Clock className="shrink-0" />
        {t("pudo.hours")}
      </Text>
      <ul className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {pointHoursRows(point.hours).map((row) => (
          <li key={row.day} className="contents">
            <span className="txt-compact-xsmall text-ui-fg-subtle">{t(`pudo.days.${row.day}`)}</span>
            <span className={clx("txt-compact-xsmall tabular-nums", row.ranges.length > 0 ? "text-ui-fg-base" : "text-ui-fg-muted")}>
              {row.ranges.length > 0 ? row.ranges.map((r) => t("pudo.range", { from: r.from, to: r.to })).join(", ") : t("pudo.closed")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * A DPD Pickup point: its name, address, type, what it does (hands out
 * parcels, cash on delivery), whether it is active now, its hours and what
 * it takes. Without a point (none chosen, a wrong id, not found, not
 * checked) the card says why, with the id. The compact card of the search
 * leaves out the hours and the note of the source (the search says it once).
 */
export function PointCard({
  point,
  pudoId,
  check,
  reason = null,
  source,
  lang,
  compact = false,
  action,
}: {
  point: PointDto | null
  /** The id the row has; null only with check "missing". */
  pudoId: string | null
  check: PlanPointDto["check"]
  /** unchecked only: why the point could not be read. */
  reason?: string | null
  source: PointsSourceKind
  lang: string
  compact?: boolean
  /** A button beside the name (Choose, in the search). */
  action?: ReactNode
}) {
  const { t } = useTranslation("dpd")
  const id = point?.id ?? pudoId ?? ""
  const limits = point ? pointLimitParts(point.limits) : null
  const limitValues = limits ? Object.fromEntries(Object.entries(limits.values).map(([k, v]) => [k, fmtNumber(v, lang)])) : {}
  return (
    <div className="flex flex-col gap-y-2">
      {point ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="txt-small-plus text-ui-fg-base">{nb(point.name)}</span>
              <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{point.id}</span>
            </div>
            {action}
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="txt-small text-ui-fg-subtle">{nb(point.address.line1)}</span>
            {point.address.line2 ? <span className="txt-small text-ui-fg-subtle">{nb(point.address.line2)}</span> : null}
            <span className="txt-small text-ui-fg-subtle">{nb(`${point.address.zip} ${point.address.city}`)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {/* A locker has its own type word; the badge says it is a locker in its icon and its tooltip. */}
            <ToneBadge icon={point.isLocker ? <MapPin /> : <BuildingStorefront />} title={point.isLocker ? t("pudo.locker") : undefined}>
              {t(`pudo.types.${pointTypeKey(point.type)}`)}
            </ToneBadge>
            {!point.active ? <ToneBadge tone="red">{t("pudo.inactive")}</ToneBadge> : null}
            {point.delivery ? <ToneBadge tone="green">{t("pudo.delivery")}</ToneBadge> : null}
            {point.cod ? (
              <ToneBadge tone="blue" icon={<Cash />}>
                {t("pudo.cod")}
              </ToneBadge>
            ) : (
              <ToneBadge>{t("pudo.noCod")}</ToneBadge>
            )}
          </div>
          {limits ? <Note tone="grey">{t(`pudo.limits.${limits.key}`, limitValues)}</Note> : null}
          {!compact && point.hours.length > 0 ? <HoursList point={point} /> : null}
        </>
      ) : (
        <span className="txt-compact-small-plus font-mono text-ui-fg-base">{id || "-"}</span>
      )}
      {check === "unchecked" ? <Note tone="orange">{reason === "not_configured" ? t("pudo.notConfigured", { id }) : t("pudo.unchecked", { id })}</Note> : null}
      {check === "not_found" ? <Note tone="red">{t("pudo.notFound", { id })}</Note> : null}
      {check === "missing" ? <Note tone="red">{t("pudo.missing")}</Note> : null}
      {check === "invalid" ? <Note tone="red">{t("pudo.invalid", { id })}</Note> : null}
      {/* Where the answer came from, when a catalog answered (a point, or no point under this id). */}
      {!compact && source !== "live" && (check === "ok" || check === "not_found") ? <Note tone="grey">{t(`pudo.source.${source}`)}</Note> : null}
    </div>
  )
}

/**
 * The search for another point: postal code (five digits) and city, then
 * the points a parcel can go to there, each with Choose. With cash on
 * delivery only points that take it are listed. The point the row has now
 * cannot be chosen again.
 */
export function PointPicker({
  cod,
  currentId,
  lang,
  errorText,
  onPick,
  onCancel,
}: {
  cod: boolean
  currentId: string | null
  lang: string
  errorText: ErrorText
  onPick: (point: PointDto) => void
  onCancel: () => void
}) {
  const { t } = useTranslation("dpd")
  const [zip, setZip] = useState("")
  const [city, setCity] = useState("")
  /* The search runs on Search, not on every key. */
  const [asked, setAsked] = useState<{ zip: string; city: string; cod: boolean } | null>(null)
  const q = useDpdPoints(asked)
  const ready = pointsQuery({ zip, city, cod }) !== null
  /* A search whose last read failed shows its error, not the points of the one before. */
  const data = q.isError ? undefined : q.data

  return (
    <div className="flex flex-col gap-y-3">
      <Text size="small" weight="plus" className="text-ui-fg-base">
        {t("pudo.searchTitle")}
      </Text>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          if (!ready) return
          /* The same search again (after "try again in a moment", or once it is old) keeps its query key, which fetches nothing by itself: read it again. */
          if (sameSearch(asked, { zip, city, cod })) {
            if (q.isError || q.isStale) void q.refetch()
          } else setAsked({ zip, city, cod })
        }}
      >
        <label className="flex min-w-0 flex-col gap-y-1 sm:w-36">
          <span className="txt-compact-xsmall text-ui-fg-muted">{t("pudo.zip")}</span>
          <Input size="small" inputMode="numeric" autoComplete="off" maxLength={6} placeholder="00-000" value={zip} onChange={(e) => setZip(e.target.value)} />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-y-1">
          <span className="txt-compact-xsmall text-ui-fg-muted">{t("pudo.city")}</span>
          <Input size="small" autoComplete="off" maxLength={50} value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <div className="flex items-center gap-1.5">
          <Button size="small" variant="secondary" type="submit" disabled={!ready} isLoading={q.isFetching}>
            <MagnifyingGlass />
            {t("pudo.search")}
          </Button>
          <Button size="small" variant="transparent" type="button" onClick={onCancel}>
            {t("plan.cancel")}
          </Button>
        </div>
      </form>
      {q.isLoading ? <KitLoading label={t("pudo.search")} /> : null}
      {q.isError ? <Note tone="red">{errorText(q.error)}</Note> : null}
      {data ? (
        data.points.length === 0 ? (
          <Note tone="grey">{t("pudo.empty")}</Note>
        ) : (
          <ul className="flex flex-col divide-y divide-ui-border-base rounded-lg border border-ui-border-base">
            {data.points.map((p) => (
              <li key={p.id} className="px-3 py-2.5">
                <PointCard
                  point={p}
                  pudoId={p.id}
                  check="ok"
                  source={data.source}
                  lang={lang}
                  compact
                  action={
                    <Button size="small" variant="secondary" type="button" disabled={p.id === currentId} onClick={() => onPick(p)}>
                      {t("pudo.select")}
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        )
      ) : null}
      {data && data.source !== "live" ? <Note tone="grey">{t(`pudo.source.${data.source}`)}</Note> : null}
    </div>
  )
}

/**
 * The confirmation of a change: where the parcel will go and a reminder
 * that the plugin does not tell the customer and that the order keeps the
 * customer's choice. The server reads the point again; a point it refuses
 * (point_refused) shows its problems here and changes nothing. On success
 * the drawer already has the new plan (useDpdSetPoint puts it in).
 */
export function PointChangeDialog({
  shipmentId,
  current,
  next,
  errorText,
  onClose,
  onDone,
}: {
  shipmentId: string
  /** The point of the plan now; null for a Pickup plan that stopped before the point. */
  current: PlanPointDto | null
  next: PointDto
  errorText: ErrorText
  onClose: () => void
  onDone: (res: PlanResponse) => void
}) {
  const { t } = useTranslation("dpd")
  const setPoint = useDpdSetPoint(shipmentId)
  /* point_refused: the problems of the point, from the body of the answer. */
  const [refused, setRefused] = useState<ProblemDto[] | null>(null)
  const same = current?.pudoId === next.id

  const confirm = async () => {
    setRefused(null)
    try {
      const res = await setPoint.mutateAsync({ pudoId: next.id })
      toast.success(t("toast.pointChanged"))
      onDone(res)
    } catch (err) {
      if (err instanceof DpdRequestError && err.code === "point_refused") setRefused(err.problems)
      else toast.error(errorText(err))
    }
  }

  return (
    <Prompt open variant="confirmation" onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Prompt.Content>
        <Prompt.Header>
          <Prompt.Title>{t("pudo.confirmTitle", { id: next.id })}</Prompt.Title>
          <Prompt.Description>{nb(t("pudo.confirmText", { name: next.name, address: pointAddressLine(next) }))}</Prompt.Description>
        </Prompt.Header>
        {refused ? (
          <div className="px-6 pt-4">
            <InlineTip variant="error" label={t("actionError.point_refused")}>
              <ProblemList items={refused} />
            </InlineTip>
          </div>
        ) : null}
        <Prompt.Footer>
          <Prompt.Cancel>{t("plan.cancel")}</Prompt.Cancel>
          <Button size="small" variant="primary" type="button" disabled={same || refused !== null} isLoading={setPoint.isPending} onClick={() => void confirm()}>
            {t("pudo.confirm")}
          </Button>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  )
}
